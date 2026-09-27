import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import simpleGit from 'simple-git';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { encrypt, decrypt } from '../common/encrypt.util';
import { GithubConfigService } from './github-config.service';


// A verified GitHub push, as handed to the deploy layer (see resolveWebhookDeploy).
export interface WebhookPush {
  kind?: 'push';
  appId: string;
  ref: string;
  // true = the app's tracked (production) branch; false = another branch.
  isTrackedBranch: boolean;
  // The push deleted the branch.
  deleted: boolean;
  commitSha?: string;
  commitMessage?: string;
  pusher?: string;
}

// A verified `pull_request` webhook event (preview lifecycle + PR comment).
export interface WebhookPullRequest {
  kind: 'pull_request';
  appId: string;
  action: string; // opened | reopened | synchronize | closed | ...
  number: number;
  headRef: string;
  headSha?: string;
  title?: string;
  merged: boolean;
  // false for fork PRs (the head branch isn't in the app's repo).
  sameRepo: boolean;
  sender?: string;
}

export interface GithubRepo {
  id: number;
  fullName: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  cloneUrl: string;
}

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
    private readonly ghConfig: GithubConfigService,
  ) {}

  /** True when both OAuth credentials are set (DB setting or env). */
  isConfigured(): Promise<boolean> {
    return this.ghConfig.isConfigured();
  }

  async clientId(): Promise<string> {
    const { clientId } = await this.ghConfig.get();
    if (!clientId) {
      throw new BadRequestException({
        code: 'GITHUB_NOT_CONFIGURED',
        message: 'GitHub OAuth is not configured on this server',
      });
    }
    return clientId;
  }

  async clientSecret(): Promise<string> {
    const { clientSecret } = await this.ghConfig.get();
    if (!clientSecret) {
      throw new BadRequestException({
        code: 'GITHUB_NOT_CONFIGURED',
        message: 'GitHub OAuth is not configured on this server',
      });
    }
    return clientSecret;
  }

  apiBaseUrl(): string {
    return this.ghConfig.apiBaseUrl();
  }

  /** GitHub OAuth base URL (GitHub Enterprise / test stub override). */
  oauthUrl(): Promise<string> {
    return this.ghConfig.oauthUrl();
  }

  dashboardUrl(): string {
    return this.ghConfig.dashboardUrl();
  }

  private callbackUrl(): string {
    return this.ghConfig.callbackUrl();
  }

  // Build the GitHub consent URL. `state` carries a signed JWT-less payload:
  // we embed the userId HMAC'd so the callback can trust it without a session.
  async buildAuthorizeUrl(userId: string): Promise<{ url: string }> {
    const state = await this.signState(userId);
    const params = new URLSearchParams({
      client_id: await this.clientId(),
      redirect_uri: this.callbackUrl(),
      scope: 'repo read:user',
      state,
      allow_signup: 'false',
    });
    return { url: `${await this.ghConfig.oauthUrl()}/authorize?${params.toString()}` };
  }

  /** HMAC key for OAuth state (DB/env GITHUB_STATE_SECRET, else JWT_SECRET). */
  async stateSecret(): Promise<string> {
    return (await this.ghConfig.get()).stateSecret;
  }

  private async signState(userId: string): Promise<string> {
    const payload = `${userId}.${Date.now()}`;
    const sig = crypto
      .createHmac('sha256', await this.stateSecret())
      .update(payload)
      .digest('hex');
    return Buffer.from(`${payload}.${sig}`).toString('base64url');
  }

  private async verifyState(state: string): Promise<string> {
    let decoded: string;
    try {
      decoded = Buffer.from(state, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException({ code: 'BAD_STATE', message: 'Invalid state' });
    }
    const parts = decoded.split('.');
    if (parts.length !== 3) {
      throw new BadRequestException({ code: 'BAD_STATE', message: 'Invalid state' });
    }
    const [userId, ts, sig] = parts;
    const expected = crypto
      .createHmac('sha256', await this.stateSecret())
      .update(`${userId}.${ts}`)
      .digest('hex');
    if (
      sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ) {
      throw new BadRequestException({ code: 'BAD_STATE', message: 'State signature mismatch' });
    }
    // State valid for 10 minutes.
    if (Date.now() - Number(ts) > 10 * 60 * 1000) {
      throw new BadRequestException({ code: 'BAD_STATE', message: 'State expired' });
    }
    return userId;
  }

  // Exchange the OAuth code for a token, persist the account, redirect target.
  async handleCallback(code: string, state: string): Promise<{ redirectTo: string }> {
    const userId = await this.verifyState(state);

    const { accessToken, scope } = await this.exchangeCode(code, this.callbackUrl());

    // Identify the user.
    const ghUser = await this.githubFetch<{ id: number; login: string }>(
      accessToken,
      '/user',
    );

    await this.prisma.githubAccount.upsert({
      where: { userId },
      create: {
        userId,
        githubId: String(ghUser.id),
        login: ghUser.login,
        accessToken: encrypt(accessToken),
        scope,
      },
      update: {
        githubId: String(ghUser.id),
        login: ghUser.login,
        accessToken: encrypt(accessToken),
        scope,
      },
    });

    // Also link the GitHub identity for "Sign in with GitHub", unless this user
    // is already linked or another user owns that GitHub id.
    await this.prisma.user
      .updateMany({
        where: { id: userId, githubId: null },
        data: { githubId: String(ghUser.id) },
      })
      .catch(() => undefined); // unique violation → linked to someone else; ignore

    await this.auditService.log({
      actorUserId: userId,
      action: 'github.connect',
      target: userId,
      metadata: { login: ghUser.login },
    });

    return { redirectTo: `${this.dashboardUrl()}/apps/new?github=connected` };
  }

  /** Exchange an OAuth `code` for an access token (shared by connect + sign-in). */
  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ accessToken: string; scope: string | null }> {
    if (!code) {
      throw new BadRequestException({
        code: 'GITHUB_OAUTH_FAILED',
        message: 'GitHub did not return an authorization code',
      });
    }
    const tokenRes = await fetch(`${await this.ghConfig.oauthUrl()}/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: await this.clientId(),
        client_secret: await this.clientSecret(),
        code,
        redirect_uri: redirectUri,
      }),
    });

    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenJson.access_token) {
      throw new BadRequestException({
        code: 'GITHUB_OAUTH_FAILED',
        message: tokenJson.error_description ?? 'Failed to obtain GitHub token',
      });
    }

    return { accessToken: tokenJson.access_token, scope: tokenJson.scope ?? null };
  }

  async getStatus(userId: string): Promise<{ connected: boolean; login?: string }> {
    const account = await this.prisma.githubAccount.findUnique({
      where: { userId },
      select: { login: true },
    });
    return account ? { connected: true, login: account.login } : { connected: false };
  }

  async disconnect(userId: string): Promise<{ ok: boolean }> {
    await this.prisma.githubAccount.deleteMany({ where: { userId } });
    await this.auditService.log({
      actorUserId: userId,
      action: 'github.disconnect',
      target: userId,
    });
    return { ok: true };
  }

  async listRepos(userId: string): Promise<{ repos: GithubRepo[] }> {
    const token = await this.getToken(userId);
    const raw = await this.githubFetch<
      Array<{
        id: number;
        full_name: string;
        name: string;
        private: boolean;
        default_branch: string;
        html_url: string;
        clone_url: string;
      }>
    >(token, '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member');

    const repos: GithubRepo[] = raw.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      name: r.name,
      private: r.private,
      defaultBranch: r.default_branch,
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url,
    }));

    return { repos };
  }

  // List the branches of a repo the connected user can access, default branch first.
  async listBranches(
    userId: string,
    owner: string,
    repo: string,
  ): Promise<{ branches: string[]; defaultBranch: string }> {
    const token = await this.getToken(userId);

    const repoInfo = await this.githubFetch<{ default_branch: string }>(
      token,
      `/repos/${owner}/${repo}`,
    );

    const raw = await this.githubFetch<Array<{ name: string }>>(
      token,
      `/repos/${owner}/${repo}/branches?per_page=100`,
    );

    const names = raw.map((b) => b.name);
    const defaultBranch = repoInfo.default_branch;
    // Surface the default branch first so the UI can preselect it.
    const branches = [
      ...(names.includes(defaultBranch) ? [defaultBranch] : []),
      ...names.filter((n) => n !== defaultBranch),
    ];

    return { branches, defaultBranch };
  }

  // List branches of an arbitrary git repo URL via `git ls-remote --heads`.
  // No clone — just the remote ref advertisement. For github.com URLs we inject
  // the user's OAuth token (if connected) so private repos resolve too.
  async listRemoteBranches(
    userId: string,
    repoUrl: string,
  ): Promise<{ branches: string[] }> {
    const trimmed = repoUrl.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      throw new BadRequestException({
        code: 'BAD_REPO_URL',
        message: 'Repository URL must start with http(s)://',
      });
    }

    let authedUrl = trimmed;
    // Inject the connected token for private github.com repos.
    if (/^https:\/\/github\.com\//i.test(trimmed)) {
      const token = await this.getTokenIfConnected(userId);
      if (token) {
        authedUrl = trimmed.replace(
          /^https:\/\//i,
          `https://x-access-token:${token}@`,
        );
      }
    }

    let raw: string;
    try {
      raw = await simpleGit().listRemote(['--heads', authedUrl]);
    } catch {
      // Don't leak the token-bearing URL in the error.
      throw new BadRequestException({
        code: 'GIT_LS_REMOTE_FAILED',
        message:
          'Could not read branches from that repository. Check the URL and access.',
      });
    }

    // Each line: "<sha>\trefs/heads/<branch>"
    const branches = raw
      .split('\n')
      .map((line) => line.split('\t')[1])
      .filter((ref): ref is string => Boolean(ref) && ref.startsWith('refs/heads/'))
      .map((ref) => ref.replace('refs/heads/', ''));

    // Surface common defaults first for nicer UX.
    const preferred = ['main', 'master'];
    branches.sort((a, b) => {
      const ai = preferred.indexOf(a);
      const bi = preferred.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.localeCompare(b);
    });

    return { branches };
  }

  // Returns the decrypted access token for a connected user, or throws.
  async getToken(userId: string): Promise<string> {
    const account = await this.prisma.githubAccount.findUnique({
      where: { userId },
      select: { accessToken: true },
    });
    if (!account) {
      throw new ForbiddenException({
        code: 'GITHUB_NOT_CONNECTED',
        message: 'GitHub account not connected',
      });
    }
    return decrypt(account.accessToken);
  }

  async getTokenIfConnected(userId: string): Promise<string | null> {
    const account = await this.prisma.githubAccount.findUnique({
      where: { userId },
      select: { accessToken: true },
    });
    return account ? decrypt(account.accessToken) : null;
  }

  // Install a push webhook on the repo. Returns the hook id + generated secret.
  async createWebhook(
    userId: string,
    repoFullName: string,
    appId: string,
  ): Promise<{ hookId: string; secret: string }> {
    const token = await this.getToken(userId);
    const secret = crypto.randomBytes(32).toString('hex');
    const webhookUrl = `${this.apiBaseUrl()}/v1/github/webhook/${appId}`;

    const hook = await this.githubFetch<{ id: number }>(
      token,
      `/repos/${repoFullName}/hooks`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'web',
          active: true,
          // push → production + branch previews; pull_request → preview
          // lifecycle + the PR comment (see GithubPullRequestService).
          events: ['push', 'pull_request'],
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret,
            insecure_ssl: '0',
          },
        }),
      },
    );

    return { hookId: String(hook.id), secret };
  }

  async deleteWebhook(
    userId: string,
    repoFullName: string,
    hookId: string,
  ): Promise<void> {
    const token = await this.getTokenIfConnected(userId);
    if (!token) return;
    try {
      await this.githubFetch(token, `/repos/${repoFullName}/hooks/${hookId}`, {
        method: 'DELETE',
      });
    } catch {
      // Hook may already be gone — ignore.
    }
  }

  // Verify the X-Hub-Signature-256 header against the stored per-app secret.
  verifySignature(secret: string, payload: Buffer, signatureHeader?: string): boolean {
    if (!signatureHeader) return false;
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', secret).update(payload).digest('hex');
    const a = Buffer.from(signatureHeader);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  // Handle an incoming push webhook: verify signature, find the app, return the
  // ref to deploy (caller enqueues the deploy via AppsService to avoid a cycle).
  async resolveWebhookDeploy(
    appId: string,
    event: string | undefined,
    payload: Buffer,
    signature: string | undefined,
  ): Promise<WebhookPush | WebhookPullRequest | null> {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      select: { id: true, webhookSecret: true, branch: true, githubRepoFullName: true },
    });
    if (!app || !app.webhookSecret) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    }

    if (!this.verifySignature(app.webhookSecret, payload, signature)) {
      throw new UnauthorizedException({
        code: 'BAD_SIGNATURE',
        message: 'Webhook signature verification failed',
      });
    }

    // GitHub pings the hook on creation — acknowledge without deploying.
    if (event === 'ping') return null;
    if (event === 'pull_request') {
      const pr = JSON.parse(payload.toString('utf8')) as {
        action?: string;
        number?: number;
        pull_request?: {
          number?: number;
          title?: string;
          merged?: boolean;
          head?: { ref?: string; sha?: string; repo?: { full_name?: string } | null };
          base?: { repo?: { full_name?: string } | null };
        };
        sender?: { login?: string };
      };
      const p = pr.pull_request;
      if (!pr.action || !p?.head?.ref) return null;
      const headRepo = p.head.repo?.full_name?.toLowerCase();
      const baseRepo = (p.base?.repo?.full_name ?? app.githubRepoFullName ?? '').toLowerCase();
      return {
        kind: 'pull_request',
        appId: app.id,
        action: pr.action,
        number: p.number ?? pr.number ?? 0,
        headRef: p.head.ref,
        headSha: p.head.sha,
        title: p.title,
        merged: p.merged === true,
        sameRepo: !!headRepo && headRepo === baseRepo,
        sender: pr.sender?.login,
      };
    }
    if (event !== 'push') return null;

    const parsed = JSON.parse(payload.toString('utf8')) as {
      ref?: string;
      deleted?: boolean;
      head_commit?: { id?: string; message?: string } | null;
      pusher?: { name?: string };
      sender?: { login?: string };
    };
    // Only branch pushes (not tags).
    if (parsed.ref && !parsed.ref.startsWith('refs/heads/')) return null;
    const pushedBranch = parsed.ref?.replace('refs/heads/', '');
    const trackedBranch = app.branch ?? 'main';

    // Pushes to the app's tracked branch deploy production; pushes to any other
    // branch are handed back flagged so the caller can deploy a preview.
    return {
      appId: app.id,
      ref: pushedBranch ?? trackedBranch,
      isTrackedBranch: !pushedBranch || pushedBranch === trackedBranch,
      deleted: parsed.deleted === true,
      commitSha: parsed.head_commit?.id,
      commitMessage: parsed.head_commit?.message,
      pusher: parsed.sender?.login ?? parsed.pusher?.name,
    };
  }

  async githubFetch<T>(
    token: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const res = await fetch(`${await this.ghConfig.apiUrl()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'upande-cloud',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers as Record<string, string> | undefined),
      },
    });

    if (res.status === 401) {
      throw new ForbiddenException({
        code: 'GITHUB_TOKEN_INVALID',
        message: 'GitHub token rejected — please reconnect',
      });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new BadRequestException({
        code: 'GITHUB_API_ERROR',
        message: `GitHub API error (${res.status}): ${text.slice(0, 200)}`,
      });
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
