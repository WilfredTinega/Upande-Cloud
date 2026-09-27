import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/encrypt.util';

// Setting keys for the GitHub OAuth App. The secrets are stored encrypted.
export const SETTING_GITHUB_CLIENT_ID = 'github_client_id';
export const SETTING_GITHUB_CLIENT_SECRET = 'github_client_secret';
export const SETTING_GITHUB_STATE_SECRET = 'github_state_secret';
// GitHub endpoints (GitHub Enterprise Server, or a local stub in tests):
// DB Setting first, then env GITHUB_API_URL / GITHUB_OAUTH_URL.
export const SETTING_GITHUB_API_URL = 'github_api_url';
export const SETTING_GITHUB_OAUTH_URL = 'github_oauth_url';
const DEFAULT_GITHUB_API_URL = 'https://api.github.com';
const DEFAULT_GITHUB_OAUTH_URL = 'https://github.com/login/oauth';

export type GithubConfigSource = 'database' | 'environment' | 'none';

export interface GithubOAuthConfig {
  clientId: string | null;
  clientSecret: string | null;
  /** HMAC key for OAuth `state` (explicit value, else JWT_SECRET). */
  stateSecret: string;
  sources: {
    clientId: GithubConfigSource;
    clientSecret: GithubConfigSource;
    stateSecret: GithubConfigSource;
  };
}

export interface GithubConfigUpdate {
  /** undefined = keep; '' or null = clear DB value (fall back to env). */
  clientId?: string | null;
  clientSecret?: string | null;
  stateSecret?: string | null;
}

// Short cache so every OAuth request doesn't hit the DB; invalidated on save.
const CACHE_TTL_MS = 30_000;

/**
 * Single source of truth for the GitHub OAuth App credentials.
 * Resolution per value: DB `Setting` (admin → Settings → GitHub OAuth) first,
 * then env (GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_STATE_SECRET).
 * A blank state secret falls back to JWT_SECRET — never to an empty key.
 */
@Injectable()
export class GithubConfigService {
  private cache: { value: GithubOAuthConfig; at: number } | null = null;
  private urlCache: { api: string; oauth: string; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  invalidate(): void {
    this.cache = null;
    this.urlCache = null;
  }

  private async urls(): Promise<{ api: string; oauth: string }> {
    if (this.urlCache && Date.now() - this.urlCache.at < CACHE_TTL_MS) return this.urlCache;
    let rows: { key: string; value: string }[] = [];
    try {
      rows = await this.prisma.setting.findMany({
        where: { key: { in: [SETTING_GITHUB_API_URL, SETTING_GITHUB_OAUTH_URL] } },
        select: { key: true, value: true },
      });
    } catch {
      /* DB unavailable → env/defaults */
    }
    const db = (k: string) => rows.find((r) => r.key === k)?.value?.trim() || undefined;
    const clean = (u: string) => u.replace(/\/+$/, '');
    const value = {
      api: clean(db(SETTING_GITHUB_API_URL) || this.config.get<string>('GITHUB_API_URL') || DEFAULT_GITHUB_API_URL),
      oauth: clean(db(SETTING_GITHUB_OAUTH_URL) || this.config.get<string>('GITHUB_OAUTH_URL') || DEFAULT_GITHUB_OAUTH_URL),
    };
    this.urlCache = { ...value, at: Date.now() };
    return value;
  }

  /** GitHub REST API base (default https://api.github.com). */
  async apiUrl(): Promise<string> {
    return (await this.urls()).api;
  }

  /** GitHub OAuth base (default https://github.com/login/oauth). */
  async oauthUrl(): Promise<string> {
    return (await this.urls()).oauth;
  }

  async get(): Promise<GithubOAuthConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    const value = await this.load();
    this.cache = { value, at: Date.now() };
    return value;
  }

  async isConfigured(): Promise<boolean> {
    const cfg = await this.get();
    return Boolean(cfg.clientId && cfg.clientSecret);
  }

  /** Public API base URL — used for the OAuth redirect_uri. */
  apiBaseUrl(): string {
    return (this.config.get<string>('API_PUBLIC_URL') ?? 'http://localhost:4000').replace(/\/+$/, '');
  }

  dashboardUrl(): string {
    return this.config.get<string>('DASHBOARD_URL') ?? 'http://localhost:5173';
  }

  /** The Authorization callback URL to register on the GitHub OAuth App. */
  callbackUrl(): string {
    return `${this.apiBaseUrl()}/v1/github/callback`;
  }

  /** Persist admin-provided values. Empty string / null clears the DB value. */
  async update(dto: GithubConfigUpdate): Promise<void> {
    const apply = async (key: string, value: string | null | undefined, secret: boolean) => {
      if (value === undefined) return;
      const v = (value ?? '').trim();
      if (!v) {
        await this.prisma.setting.deleteMany({ where: { key } });
        return;
      }
      const stored = secret ? encrypt(v) : v;
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: stored, encrypted: secret },
        update: { value: stored, encrypted: secret },
      });
    };
    try {
      await apply(SETTING_GITHUB_CLIENT_ID, dto.clientId, false);
      await apply(SETTING_GITHUB_CLIENT_SECRET, dto.clientSecret, true);
      await apply(SETTING_GITHUB_STATE_SECRET, dto.stateSecret, true);
    } finally {
      this.invalidate();
    }
  }

  private async load(): Promise<GithubOAuthConfig> {
    const rows = await this.prisma.setting.findMany({
      where: {
        key: {
          in: [SETTING_GITHUB_CLIENT_ID, SETTING_GITHUB_CLIENT_SECRET, SETTING_GITHUB_STATE_SECRET],
        },
      },
    });
    const db = new Map<string, string>();
    for (const r of rows) {
      if (!r.value) continue;
      try {
        db.set(r.key, r.encrypted ? decrypt(r.value) : r.value);
      } catch {
        // Undecryptable (ENCRYPTION_KEY changed) — ignore and fall back to env.
      }
    }

    const pick = (key: string, env: string): [string | null, GithubConfigSource] => {
      const fromDb = db.get(key);
      if (fromDb) return [fromDb, 'database'];
      const fromEnv = this.config.get<string>(env);
      if (fromEnv) return [fromEnv, 'environment'];
      return [null, 'none'];
    };

    const [clientId, idSrc] = pick(SETTING_GITHUB_CLIENT_ID, 'GITHUB_CLIENT_ID');
    const [clientSecret, secretSrc] = pick(SETTING_GITHUB_CLIENT_SECRET, 'GITHUB_CLIENT_SECRET');
    const [stateExplicit, stateSrc] = pick(SETTING_GITHUB_STATE_SECRET, 'GITHUB_STATE_SECRET');
    // `||` (not `??`): an empty string must fall back — an empty HMAC key makes state forgeable.
    const stateSecret = stateExplicit || this.config.get<string>('JWT_SECRET') || 'change-me';

    return {
      clientId,
      clientSecret,
      stateSecret,
      sources: { clientId: idSrc, clientSecret: secretSrc, stateSecret: stateSrc },
    };
  }
}
