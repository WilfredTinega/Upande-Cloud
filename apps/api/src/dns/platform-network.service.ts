import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'net';
import { PrismaService } from '../prisma/prisma.service';

// Setting keys for the server's public addresses (not secret, stored in plain text).
export const SETTING_SERVER_PUBLIC_IPV4 = 'server_public_ipv4';
export const SETTING_SERVER_PUBLIC_IPV6 = 'server_public_ipv6';

export type NetworkConfigSource = 'database' | 'environment' | 'none';

export interface PlatformNetworkConfig {
  ipv4: string | null;
  ipv6: string | null;
  sources: { ipv4: NetworkConfigSource; ipv6: NetworkConfigSource };
}

export interface PlatformNetworkUpdate {
  /** undefined = keep; '' or null = clear the DB value (fall back to env). */
  ipv4?: string | null;
  ipv6?: string | null;
}

// Short cache so every domain request doesn't hit the DB; invalidated on save.
const CACHE_TTL_MS = 30_000;

/**
 * The server's public IP addresses: what custom-domain A/AAAA records point at.
 * Resolution per value: DB `Setting` (admin -> Settings -> Networking) first,
 * then env. IPv4 falls back to PUBLIC_IP when it is an IPv4 address; IPv6 falls
 * back to PUBLIC_IPV6, or to PUBLIC_IP when that is an IPv6 address. Read at
 * request time, so a change applies without restarting the API.
 */
@Injectable()
export class PlatformNetworkService {
  private cache: { value: PlatformNetworkConfig; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  async get(): Promise<PlatformNetworkConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.value;
    const value = await this.load();
    this.cache = { value, at: Date.now() };
    return value;
  }

  /**
   * The single address platform routing records point at: IPv4 when set
   * (A record), otherwise IPv6 (AAAA). Null when neither is configured.
   */
  async primaryIp(): Promise<string | null> {
    const cfg = await this.get();
    return cfg.ipv4 ?? cfg.ipv6;
  }

  /** Persist admin-provided values. Empty string / null clears the DB value. */
  async update(dto: PlatformNetworkUpdate): Promise<void> {
    const apply = async (key: string, value: string | null | undefined) => {
      if (value === undefined) return;
      const v = (value ?? '').trim();
      if (!v) {
        await this.prisma.setting.deleteMany({ where: { key } });
        return;
      }
      await this.prisma.setting.upsert({
        where: { key },
        create: { key, value: v, encrypted: false },
        update: { value: v, encrypted: false },
      });
    };
    try {
      await apply(SETTING_SERVER_PUBLIC_IPV4, dto.ipv4);
      await apply(SETTING_SERVER_PUBLIC_IPV6, dto.ipv6);
    } finally {
      this.invalidate();
    }
  }

  private async load(): Promise<PlatformNetworkConfig> {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [SETTING_SERVER_PUBLIC_IPV4, SETTING_SERVER_PUBLIC_IPV6] } },
    });
    const db = new Map(rows.map((r) => [r.key, (r.value ?? '').trim()]));
    const env = (name: string) => (this.config.get<string>(name) ?? '').trim();
    const publicIp = env('PUBLIC_IP');

    const pick = (
      key: string,
      family: 4 | 6,
      envCandidates: string[],
    ): [string | null, NetworkConfigSource] => {
      const fromDb = db.get(key);
      if (fromDb && isIP(fromDb) === family) return [fromDb, 'database'];
      const fromEnv = envCandidates.find((v) => v && isIP(v) === family);
      if (fromEnv) return [fromEnv, 'environment'];
      return [null, 'none'];
    };

    const [ipv4, v4Src] = pick(SETTING_SERVER_PUBLIC_IPV4, 4, [publicIp]);
    const [ipv6, v6Src] = pick(SETTING_SERVER_PUBLIC_IPV6, 6, [env('PUBLIC_IPV6'), publicIp]);
    return { ipv4, ipv6, sources: { ipv4: v4Src, ipv6: v6Src } };
  }
}
