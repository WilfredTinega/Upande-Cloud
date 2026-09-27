import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as Docker from 'dockerode';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { LogStoreService } from '../deploy/log-store.service';
import { AuditService } from '../common/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { slugify } from '../common/slug.util';
import { UserPurgeService } from '../common/user-purge.service';
import { AiService } from './ai.service';
import { encrypt, decrypt } from '../common/encrypt.util';
import { UpdateQuotaDto } from './dto/update-quota.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { UpdateGithubSettingsDto } from './dto/update-github-settings.dto';
import { GithubConfigService } from '../github/github-config.service';
import { UpdateNetworkSettingsDto } from './dto/update-network-settings.dto';
import { PlatformNetworkService } from '../dns/platform-network.service';
import { isIP } from 'net';

// Keys for the agent/MCP connection settings. The token is stored encrypted.
const SETTING_AGENT_API_URL = 'agent_api_url';
const SETTING_AGENT_TOKEN = 'agent_token';
const SETTING_AGENT_ID = 'agent_id';

const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  role: true,
  status: true,
  organizationId: true,
  createdAt: true,
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deployService: DeployService,
    private readonly logStore: LogStoreService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ai: AiService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly userPurge: UserPurgeService,
    private readonly ghConfig: GithubConfigService,
    private readonly network: PlatformNetworkService,
  ) {}

  /**
   * Mint a short-lived session token to log in to the dashboard AS another user
   * ("impersonation"). The token carries an `imp` claim recording the admin who
   * started the session, so the dashboard can show a banner and audit can trace
   * it. Expires fast (30 min) and never grants superadmin.
   */
  async impersonateUser(
    actor: { id: string; email: string; role: string },
    userId: string,
    password: string,
    reason: string,
  ) {
    // Re-authenticate: the admin must confirm with their own password. Agent
    // (MCP) tokens have no password, so they can never impersonate.
    const actorRecord = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { passwordHash: true, username: true },
    });
    const passwordOk =
      !!actorRecord?.passwordHash && (await bcrypt.compare(password, actorRecord.passwordHash));
    if (!passwordOk) {
      await this.auditService.log({
        actorUserId: actorRecord ? actor.id : undefined,
        action: 'user.impersonate.denied',
        target: userId,
        metadata: { reason: 'invalid_password' },
      });
      // 403, not 401: a wrong confirmation password must not end the admin's session.
      throw new ForbiddenException({
        code: 'INVALID_PASSWORD',
        message: 'Incorrect password.',
      });
    }

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    // The platform superadmin (Administrator) cannot be impersonated — it is a
    // CLI-only account and impersonating it would be a privilege-escalation path.
    if (target.role === 'superadmin') {
      throw new ForbiddenException({
        code: 'SUPERADMIN_LOCKED',
        message: 'The superadmin account cannot be impersonated.',
      });
    }
    if (target.status === 'suspended') {
      throw new ForbiddenException({
        code: 'USER_SUSPENDED',
        message: 'Cannot impersonate a suspended user. Reactivate the account first.',
      });
    }

    const token = this.jwtService.sign(
      {
        sub: target.id,
        email: target.email,
        role: target.role,
        organizationId: target.organizationId,
        tv: target.tokenVersion,
        // Marks this as an impersonation session and records who started it.
        imp: { by: actor.id, email: actor.email },
      },
      { expiresIn: '30m' },
    );

    await this.auditService.log({
      actorUserId: actor.id,
      action: 'user.impersonate',
      target: userId,
      metadata: { targetEmail: target.email, targetRole: target.role, reason },
    });

    // Notify the impersonated user so they learn (on their next real login)
    // that an admin signed in as them. Shown until they clear it.
    await this.notifications.create({
      userId: target.id,
      organizationId: target.organizationId,
      type: 'account_impersonated',
      message: `${actorRecord?.username ?? 'An administrator'} (${actor.email}) signed in to your account. Reason: ${reason}`,
      metadata: {
        byEmail: actor.email,
        byUsername: actorRecord?.username ?? null,
        byUserId: actor.id,
        reason,
        at: new Date().toISOString(),
      },
    });

    const dashboardBase = (
      this.config.get<string>('DASHBOARD_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');

    return {
      token,
      user: {
        id: target.id,
        email: target.email,
        role: target.role,
        status: target.status,
        organizationId: target.organizationId,
      },
      // Fragment, not query: never sent to the server, so the token stays out
      // of access logs / proxies (the dashboard scrubs it from history).
      dashboardUrl: `${dashboardBase}/impersonate#token=${encodeURIComponent(token)}`,
    };
  }

  /** Whether AI features are available (Mistral configured via UI or env). */
  async aiStatus() {
    return { enabled: await this.ai.isConfigured() };
  }

  // ---- Platform settings (agent / MCP connection) ----

  // Returns settings for the UI. The token is never sent back in plaintext —
  // only whether one is set, so the field can show "configured".
  async getSettings() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: [SETTING_AGENT_API_URL, SETTING_AGENT_TOKEN, SETTING_AGENT_ID] } },
    });
    const map = new Map(rows.map((r) => [r.key, r]));
    return {
      agentApiUrl: map.get(SETTING_AGENT_API_URL)?.value ?? '',
      agentTokenSet: map.has(SETTING_AGENT_TOKEN),
      agentId: map.get(SETTING_AGENT_ID)?.value ?? '',
    };
  }

  async updateSettings(actorId: string, dto: UpdateSettingsDto) {
    if (dto.agentApiUrl !== undefined) {
      await this.prisma.setting.upsert({
        where: { key: SETTING_AGENT_API_URL },
        create: { key: SETTING_AGENT_API_URL, value: dto.agentApiUrl, encrypted: false },
        update: { value: dto.agentApiUrl, encrypted: false },
      });
    }
    // Only overwrite the token when a non-empty new value is provided.
    if (dto.agentToken) {
      await this.prisma.setting.upsert({
        where: { key: SETTING_AGENT_TOKEN },
        create: { key: SETTING_AGENT_TOKEN, value: encrypt(dto.agentToken), encrypted: true },
        update: { value: encrypt(dto.agentToken), encrypted: true },
      });
    }
    if (dto.agentId !== undefined) {
      await this.prisma.setting.upsert({
        where: { key: SETTING_AGENT_ID },
        create: { key: SETTING_AGENT_ID, value: dto.agentId, encrypted: false },
        update: { value: dto.agentId, encrypted: false },
      });
    }

    await this.auditService.log({
      actorUserId: actorId,
      action: 'settings.update',
      target: 'agent',
      metadata: { agentApiUrl: dto.agentApiUrl, tokenChanged: Boolean(dto.agentToken) },
    });

    return this.getSettings();
  }

  // Internal: resolve the decrypted agent token (used by tooling that needs it).
  async getAgentToken(): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_AGENT_TOKEN } });
    if (!row) return null;
    return row.encrypted ? decrypt(row.value) : row.value;
  }

  // ---- GitHub OAuth App (sign-in with GitHub + repo connect) ----

  // Secrets are write-only: only whether they're set and where they come from.
  async getGithubSettings() {
    const cfg = await this.ghConfig.get();
    return {
      configured: Boolean(cfg.clientId && cfg.clientSecret),
      clientId: cfg.clientId ?? '',
      clientIdSource: cfg.sources.clientId,
      clientSecretSet: Boolean(cfg.clientSecret),
      clientSecretSource: cfg.sources.clientSecret,
      stateSecretSource: cfg.sources.stateSecret,
      // Exact values to enter on github.com → New OAuth App.
      homepageUrl: this.ghConfig.dashboardUrl(),
      callbackUrl: this.ghConfig.callbackUrl(),
    };
  }

  async updateGithubSettings(actorId: string, dto: UpdateGithubSettingsDto) {
    await this.ghConfig.update({
      clientId: dto.clientId,
      clientSecret: dto.clearClientSecret ? null : dto.clientSecret || undefined,
      stateSecret: dto.clearStateSecret ? null : dto.stateSecret || undefined,
    });
    await this.auditService.log({
      actorUserId: actorId,
      action: 'settings.update',
      target: 'github',
      metadata: {
        clientId: dto.clientId,
        clientSecretChanged: Boolean(dto.clientSecret) || Boolean(dto.clearClientSecret),
        stateSecretChanged: Boolean(dto.stateSecret) || Boolean(dto.clearStateSecret),
      },
    });
    return this.getGithubSettings();
  }

  /**
   * Check the effective client id + secret with GitHub by exchanging a bogus
   * code: GitHub answers `bad_verification_code` when the credentials are
   * valid, `incorrect_client_credentials` for a wrong secret and 404 for an
   * unknown client id. No token is ever issued.
   */
  async testGithubSettings(): Promise<{ ok: boolean; message: string }> {
    const cfg = await this.ghConfig.get();
    if (!cfg.clientId || !cfg.clientSecret) {
      return { ok: false, message: 'Client ID and client secret are both required.' };
    }
    let body: { error?: string; error_description?: string } = {};
    try {
      const res = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code: 'upande-credentials-check',
        }),
        signal: AbortSignal.timeout(10_000),
      });
      body = (await res.json().catch(() => ({}))) as typeof body;
      if (res.status === 404 || body.error === 'Not Found') {
        return { ok: false, message: 'GitHub does not recognise this client ID.' };
      }
    } catch {
      return { ok: false, message: 'Could not reach github.com from the API server.' };
    }
    if (body.error === 'bad_verification_code') {
      return { ok: true, message: 'GitHub accepted the client ID and secret.' };
    }
    if (body.error === 'incorrect_client_credentials') {
      return { ok: false, message: 'GitHub rejected the client secret for this client ID.' };
    }
    return {
      ok: false,
      message: `Unexpected response from GitHub: ${body.error_description ?? body.error ?? 'unknown'}`,
    };
  }

  // ---- Networking (server public IP for custom-domain records) ----

  async getNetworkSettings() {
    const cfg = await this.network.get();
    return {
      publicIpv4: cfg.ipv4 ?? '',
      publicIpv4Source: cfg.sources.ipv4,
      publicIpv6: cfg.ipv6 ?? '',
      publicIpv6Source: cfg.sources.ipv6,
      // What platform A/AAAA records point at (IPv4 preferred).
      effectiveIp: cfg.ipv4 ?? cfg.ipv6 ?? null,
    };
  }

  async updateNetworkSettings(actorId: string, dto: UpdateNetworkSettingsDto) {
    const before = await this.network.get();
    await this.network.update({ ipv4: dto.publicIpv4, ipv6: dto.publicIpv6 });
    const after = await this.network.get();
    await this.auditService.log({
      actorUserId: actorId,
      action: 'settings.update',
      target: 'network',
      metadata: {
        publicIpv4: dto.publicIpv4,
        publicIpv6: dto.publicIpv6,
        before: { ipv4: before.ipv4, ipv6: before.ipv6 },
        after: { ipv4: after.ipv4, ipv6: after.ipv6 },
      },
    });
    return this.getNetworkSettings();
  }

  /**
   * Ask a public "what is my IP" service which address the API server's
   * outbound traffic comes from. Only runs when the admin clicks Detect; the
   * result is a suggestion (not saved). Behind NAT or a proxy it can differ
   * from the address inbound traffic should use.
   */
  async detectPublicIp(): Promise<{ ipv4: string | null; ipv6: string | null; errors: string[] }> {
    const errors: string[] = [];
    const probe = async (url: string, family: 4 | 6): Promise<string | null> => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
          errors.push(`${new URL(url).host} answered HTTP ${res.status}`);
          return null;
        }
        const ip = (await res.text()).trim();
        if (isIP(ip) !== family) {
          if (family === 6) return null; // no IPv6 connectivity: the v6 endpoint may answer over v4
          errors.push(`${new URL(url).host} returned an unexpected answer`);
          return null;
        }
        return ip;
      } catch (err) {
        const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'unreachable';
        errors.push(
          family === 4
            ? `Could not detect the IPv4 address (${new URL(url).host} ${reason}).`
            : `No IPv6 address detected (${new URL(url).host} ${reason}; the server may have no IPv6 connectivity).`,
        );
        return null;
      }
    };
    const [ipv4, ipv6] = await Promise.all([
      probe('https://api.ipify.org', 4),
      probe('https://api6.ipify.org', 6),
    ]);
    return { ipv4, ipv6, errors };
  }

  // ---- Permanent agent tokens (for the MCP agent) ----

  async listAgentTokens() {
    const tokens = await this.prisma.agentToken.findMany({
      where: { revokedAt: null },
      select: { id: true, name: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return { tokens };
  }

  /** Create a long-lived agent token. Returns the plaintext ONCE. */
  async createAgentToken(actor: { id: string; organizationId: string; role: string }, name: string) {
    const plaintext = `ztk_${crypto.randomBytes(24).toString('hex')}`;
    const created = await this.prisma.agentToken.create({
      data: {
        name: name || 'mcp-agent',
        tokenHash: crypto.createHash('sha256').update(plaintext).digest('hex'),
        userId: actor.id,
        organizationId: actor.organizationId,
        role: actor.role,
      },
      select: { id: true, name: true, createdAt: true },
    });

    await this.auditService.log({
      actorUserId: actor.id,
      action: 'agent_token.create',
      target: created.id,
      metadata: { name: created.name },
    });

    return { ...created, token: plaintext };
  }

  async revokeAgentToken(actorId: string, id: string) {
    const token = await this.prisma.agentToken.findUnique({ where: { id } });
    if (!token || token.revokedAt) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Token not found' });
    }
    await this.prisma.agentToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    await this.auditService.log({
      actorUserId: actorId,
      action: 'agent_token.revoke',
      target: id,
    });
    return { ok: true };
  }

  /**
   * Build an .mcp.json launch config wiring the MCP server to the configured
   * base URL and a freshly minted agent token. The token is created here (shown
   * once, embedded in the file) so the operator can download a ready-to-use config.
   */
  async generateMcpConfig(
    actor: { id: string; organizationId: string; role: string },
    mcpEntryPath: string,
  ) {
    const settings = await this.getSettings();
    const apiUrl = settings.agentApiUrl || 'http://localhost:4000';
    const { token } = await this.createAgentToken(actor, 'mcp-config');

    return {
      mcpServers: {
        'upande-cloud': {
          command: 'node',
          args: [mcpEntryPath],
          env: {
            UPANDE_API_URL: apiUrl,
            UPANDE_AGENT_TOKEN: token,
          },
        },
      },
    };
  }

  /** Trigger a deployment for any app (admin/agent scope, cross-tenant). */
  async adminDeployApp(actorId: string, appId: string, ref?: string) {
    const app = await this.prisma.app.findUnique({ where: { id: appId } });
    if (!app) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    }
    const deployment = await this.prisma.deployment.create({
      data: {
        appId,
        ref: ref ?? app.branch ?? 'main',
        status: 'queued',
        trigger: 'admin',
        triggeredByUserId: actorId,
      },
    });
    await this.prisma.app.update({ where: { id: appId }, data: { status: 'building' } });
    await this.deployService.enqueue({ deploymentId: deployment.id, appId, ref });
    await this.auditService.log({
      actorUserId: actorId,
      action: 'app.deploy',
      target: appId,
      metadata: { deploymentId: deployment.id, ref, via: 'admin' },
    });
    return { deployment };
  }

  /**
   * Platform-wide security-patch + migration: trigger a forced clean rebuild
   * ("migrate") of EVERY deployable site across all tenants. A clean,
   * no-cache rebuild re-pulls base images and reinstalls dependencies (that's
   * how security patches land), and the deploy pipeline runs each app's
   * migration step on the way up. The swap is
   * rollback-safe per app — if a site's new build fails to come up, its previous
   * container is restored, so a bad patch can't take a site down.
   *
   * Cross-tenant (admin scope), so there's no org filtering. Optionally narrowed
   * to a single app type (e.g. only Node-RED sites). Sites that have never been
   * deployed (no source/image to rebuild) and sites already building are skipped
   * so we don't enqueue doomed or duplicate jobs.
   *
   * Every eligible site is enqueued immediately; the deploy worker's concurrency
   * throttles how many actually build in parallel, the rest wait in the queue.
   */
  async bulkMigrateAllSites(
    actor: { id: string; email: string },
    options: { type?: string } = {},
  ) {
    const where: Prisma.AppWhereInput = {};
    if (options.type) where.type = options.type as Prisma.EnumAppTypeFilter['equals'];

    const apps = await this.prisma.app.findMany({
      where,
      select: { id: true, name: true, subdomain: true, type: true, status: true, branch: true },
      orderBy: { createdAt: 'asc' },
    });

    // A site is eligible only if it has been deployed before (has something to
    // rebuild) and isn't mid-build. `idle` = created but never deployed.
    const eligible = apps.filter(
      (a) => a.status !== 'idle' && a.status !== 'building',
    );
    const skipped = apps.filter(
      (a) => a.status === 'idle' || a.status === 'building',
    );

    // Create a queued deployment + flip the app to building, then enqueue a
    // forced clean rebuild for each eligible site. Done per-app and best-effort:
    // one app failing to enqueue must not abort the rest of the wave.
    const queued: Array<{ appId: string; name: string; deploymentId: string }> = [];
    const failed: Array<{ appId: string; name: string; error: string }> = [];
    for (const app of eligible) {
      try {
        const deployment = await this.prisma.deployment.create({
          data: {
            appId: app.id,
            ref: app.branch ?? 'main',
            status: 'queued',
            trigger: 'admin',
            triggeredByUserId: actor.id,
            triggerDetail: 'bulk migrate',
            forceClean: true,
          },
        });
        await this.prisma.app.update({
          where: { id: app.id },
          data: { status: 'building' },
        });
        await this.deployService.enqueue({
          deploymentId: deployment.id,
          appId: app.id,
          ref: app.branch ?? undefined,
          // The defining flag: clean, no-cache rebuild + rollback-safe swap.
          forceClean: true,
        });
        queued.push({ appId: app.id, name: app.name, deploymentId: deployment.id });
      } catch (err) {
        failed.push({
          appId: app.id,
          name: app.name,
          error: err instanceof Error ? err.message : 'enqueue failed',
        });
      }
    }

    await this.auditService.log({
      actorUserId: actor.id,
      action: 'platform.bulk_migrate',
      target: options.type ? `type:${options.type}` : 'all-sites',
      metadata: {
        type: options.type ?? null,
        total: apps.length,
        queued: queued.length,
        skipped: skipped.length,
        failed: failed.length,
      },
    });

    return {
      total: apps.length,
      queued: queued.length,
      skipped: skipped.length,
      failed: failed.length,
      deployments: queued,
      skippedSites: skipped.map((a) => ({
        appId: a.id,
        name: a.name,
        status: a.status,
        reason: a.status === 'building' ? 'already building' : 'never deployed',
      })),
      failures: failed,
    };
  }

  /** Analyze an app's most recent deployment (convenience for the admin UI,
   *  which has app ids on hand rather than deployment ids). */
  async analyzeLatestForApp(actorId: string, appId: string) {
    const latest = await this.prisma.deployment.findFirst({
      where: { appId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!latest) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'This app has no deployments to analyze.',
      });
    }
    return this.analyzeDeployment(actorId, latest.id);
  }

  /**
   * Send a deployment's build log to the AI for a plain-English failure
   * diagnosis. Admin-only (the controller enforces the role).
   */
  // Deployment-failure notifications across ALL orgs (admin is cross-tenant),
  // for the admin Errors page. Read-only / observational.
  async listDeploymentErrors() {
    return this.notifications.listDeploymentFailures();
  }

  // Deploy history of one app for the admin Apps page (cross-tenant, no org
  // scoping). Newest first; the log itself is fetched per deployment.
  async listAppDeployments(appId: string, take = 30) {
    const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { id: true } });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    const rows = await this.prisma.deployment.findMany({
      where: { appId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take || 30, 1), 100),
      include: { triggeredBy: { select: { username: true, email: true } } },
    });
    return {
      deployments: rows.map((d) => ({
        id: d.id,
        ref: d.ref,
        status: d.status,
        trigger: d.trigger,
        triggerDetail: d.triggerDetail,
        triggeredBy: d.triggeredBy?.username ?? d.triggeredBy?.email ?? null,
        commitSha: d.commitSha,
        commitMessage: d.commitMessage,
        forceClean: d.forceClean,
        createdAt: d.createdAt,
        startedAt: d.startedAt,
        finishedAt: d.finishedAt,
        durationMs:
          d.startedAt && d.finishedAt ? d.finishedAt.getTime() - d.startedAt.getTime() : null,
        errorReason: d.errorReason,
      })),
    };
  }

  // The full stored log for one deployment, for the admin Errors analysis view.
  // Admin is cross-tenant so there's no org scoping here (unlike the dashboard's
  // org-scoped variant). Returns what's in Redis (logs have a TTL).
  async getDeploymentLog(deploymentId: string) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { status: true, ref: true, createdAt: true, app: { select: { name: true } } },
    });
    if (!deployment) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deployment not found' });
    }
    const lines = await this.logStore.getAll(deploymentId);
    return {
      deploymentId,
      appName: deployment.app?.name ?? 'unknown',
      status: deployment.status,
      ref: deployment.ref,
      createdAt: deployment.createdAt,
      lines,
    };
  }

  async analyzeDeployment(
    actorId: string,
    deploymentId: string,
    errorReason?: string,
  ) {
    const deployment = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      include: { app: { select: { name: true, type: true } } },
    });
    if (!deployment) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Deployment not found' });
    }

    const lines = await this.logStore.getAll(deploymentId);
    const log = lines.join('\n') || '(no logs were captured for this deployment)';

    const analysis = await this.ai.analyzeDeploymentLog({
      appName: deployment.app?.name ?? 'unknown',
      appType: deployment.app?.type ?? 'unknown',
      log,
      errorReason: errorReason?.trim() || undefined,
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'deployment.ai_analyze',
      target: deploymentId,
      metadata: { status: deployment.status },
    });

    return { deploymentId, status: deployment.status, analysis };
  }

  async listUsers() {
    const users = await this.prisma.user.findMany({
      select: USER_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return { users };
  }

  async suspendUser(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    // The platform superadmin (the Administrator) is managed only from the CLI and
    // cannot be suspended through the admin UI/API.
    if (user.role === 'superadmin') {
      throw new ForbiddenException({
        code: 'SUPERADMIN_LOCKED',
        message: 'The superadmin account cannot be suspended from the UI. Manage it via the CLI.',
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'suspended' },
      select: USER_SELECT,
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'user.suspend',
      target: userId,
    });

    return { user: updated };
  }

  /** Reactivate a previously suspended user. */
  async unsuspendUser(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: 'active' },
      select: USER_SELECT,
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'user.unsuspend',
      target: userId,
    });

    return { user: updated };
  }

  /**
   * Permanently delete a user from the admin panel, including everything they
   * own (projects, apps and their running containers). The platform superadmin
   * cannot be deleted from the UI.
   */
  async deleteUser(actorId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    if (user.role === 'superadmin') {
      throw new ForbiddenException({
        code: 'SUPERADMIN_LOCKED',
        message: 'The superadmin account cannot be deleted from the UI. Manage it via the CLI.',
      });
    }
    if (userId === actorId) {
      // Admins use the self-service flow for their own account, not this one,
      // so a mis-click here can't wipe the acting admin.
      throw new ForbiddenException({
        code: 'CANNOT_DELETE_SELF',
        message: 'Use account deletion in your own dashboard to remove your own account.',
      });
    }

    await this.userPurge.purge(userId);

    await this.auditService.log({
      actorUserId: actorId,
      action: 'user.delete',
      target: userId,
      metadata: { email: user.email },
    });

    return { ok: true };
  }

  /**
   * Edit a user's account (username/email) and optionally reassign them to a
   * different organization. Reassigning moves the user AND their projects (apps
   * live under projects) so the whole ownership tree stays with the user. The
   * platform superadmin cannot be reassigned from the UI.
   */
  async updateUser(actorId: string, userId: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    const movingOrg = dto.organizationId !== undefined && dto.organizationId !== user.organizationId;

    if (user.role === 'superadmin' && movingOrg) {
      throw new ForbiddenException({
        code: 'SUPERADMIN_LOCKED',
        message: 'The superadmin organization is managed via the CLI and cannot be changed here.',
      });
    }

    // The superadmin password is CLI-managed and cannot be reset from the UI.
    if (user.role === 'superadmin' && dto.password) {
      throw new ForbiddenException({
        code: 'SUPERADMIN_LOCKED',
        message: "A superadmin's password cannot be changed from the UI. Manage it via the CLI.",
      });
    }

    // Another admin changing the superadmin's email/username could then take
    // the account over via "forgot password". Only the superadmin may.
    if (
      user.role === 'superadmin' &&
      actorId !== user.id &&
      ((dto.email && dto.email !== user.email) || (dto.username && dto.username !== user.username))
    ) {
      throw new ForbiddenException({
        code: 'SUPERADMIN_LOCKED',
        message: "Only the superadmin can change the superadmin's email or username.",
      });
    }

    // Uniqueness checks (email/username are unique) — give a clear conflict error
    // rather than a raw Prisma failure.
    if (dto.email && dto.email !== user.email) {
      const taken = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (taken) {
        throw new ConflictException({ code: 'CONFLICT', message: 'Email already in use' });
      }
    }
    if (dto.username && dto.username !== user.username) {
      const taken = await this.prisma.user.findUnique({ where: { username: dto.username } });
      if (taken) {
        throw new ConflictException({ code: 'CONFLICT', message: 'Username already in use' });
      }
    }

    // Verify the target organization exists before moving.
    if (movingOrg) {
      const org = await this.prisma.organization.findUnique({
        where: { id: dto.organizationId },
        select: { id: true },
      });
      if (!org) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found' });
      }
    }

    // Hash a new password if one was supplied (admin override).
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (movingOrg) {
        // Move the user's projects to the new org too, so apps follow the user.
        await tx.project.updateMany({
          where: { userId },
          data: { organizationId: dto.organizationId },
        });
      }
      return tx.user.update({
        where: { id: userId },
        data: {
          ...(dto.username !== undefined && { username: dto.username }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(movingOrg && { organizationId: dto.organizationId }),
          // An admin-set password is temporary: force the user to choose their
          // own on next login.
          // Admin-set password → the user's existing sessions end.
          ...(passwordHash && { passwordHash, mustChangePassword: true, tokenVersion: { increment: 1 } }),
        },
        select: USER_SELECT,
      });
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'user.update',
      target: userId,
      metadata: {
        username: dto.username,
        email: dto.email,
        organizationId: movingOrg ? dto.organizationId : undefined,
        // Record that the password was reset, never the value itself.
        passwordChanged: dto.password ? true : undefined,
      },
    });

    return { user: updated };
  }

  async updateRole(actorId: string, userId: string, dto: UpdateRoleDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });

    // Superadmin is a CLI-only role. The UI/API may never change an existing
    // superadmin's role, nor grant superadmin to anyone else.
    if (user.role === 'superadmin') {
      throw new ForbiddenException({
        code: 'SUPERADMIN_LOCKED',
        message: "A superadmin's role cannot be changed from the UI. Manage it via the CLI.",
      });
    }
    if (dto.role === 'superadmin') {
      throw new ForbiddenException({
        code: 'SUPERADMIN_LOCKED',
        message: 'The superadmin role can only be granted from the CLI.',
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { role: dto.role },
      select: USER_SELECT,
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'user.role',
      target: userId,
      metadata: { role: dto.role },
    });

    return { user: updated };
  }

  async listOrganizations() {
    const organizations = await this.prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        quota: true,
        _count: { select: { users: true, projects: true } },
      },
    });
    // App count is per-org but apps hang off projects, so aggregate separately
    // and fold the totals into each organization.
    const appCounts = await this.prisma.app.groupBy({
      by: ['projectId'],
      _count: { _all: true },
    });
    const projectOrg = new Map(
      (await this.prisma.project.findMany({ select: { id: true, organizationId: true } })).map(
        (p) => [p.id, p.organizationId],
      ),
    );
    const appsByOrg = new Map<string, number>();
    for (const row of appCounts) {
      const orgId = projectOrg.get(row.projectId);
      if (!orgId) continue;
      appsByOrg.set(orgId, (appsByOrg.get(orgId) ?? 0) + row._count._all);
    }
    return {
      organizations: organizations.map((o) => ({
        ...o,
        counts: {
          users: o._count.users,
          projects: o._count.projects,
          apps: appsByOrg.get(o.id) ?? 0,
        },
      })),
    };
  }

  // Admins create organizations; users then register into them by slug. Also
  // provisions the default quota so the org is immediately usable.
  async createOrganization(actorId: string, dto: CreateOrganizationDto) {
    const slug = slugify(dto.slug ?? dto.name);
    if (!slug) {
      throw new ConflictException({
        code: 'INVALID_SLUG',
        message: 'Could not derive a valid slug from the name.',
      });
    }

    const existing = await this.prisma.organization.findUnique({ where: { slug } });
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `An organization with slug "${slug}" already exists.`,
      });
    }

    const organization = await this.prisma.organization.create({
      data: {
        name: dto.name,
        slug,
        plan: 'free',
        status: 'active',
        quota: {
          create: {
            maxApps: 5,
            cpu: '1',
            memory: '512m',
            disk: '5g',
            buildMinutes: 60,
            maxConcurrentDeploys: 2,
          },
        },
      },
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'organization.create',
      target: organization.id,
      metadata: { name: organization.name, slug: organization.slug },
    });

    return { organization };
  }

  async updateQuota(actorId: string, organizationId: string, dto: UpdateQuotaDto) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found' });

    const quota = await this.prisma.quota.upsert({
      where: { organizationId },
      create: {
        organizationId,
        maxApps: dto.maxApps ?? 5,
        cpu: dto.cpu ?? '1',
        memory: dto.memory ?? '512m',
        disk: dto.disk ?? '5g',
        buildMinutes: dto.buildMinutes ?? 60,
        maxConcurrentDeploys: dto.maxConcurrentDeploys ?? 2,
        maxDnsZones: dto.maxDnsZones ?? 0,
      },
      update: {
        ...(dto.maxApps !== undefined && { maxApps: dto.maxApps }),
        ...(dto.cpu !== undefined && { cpu: dto.cpu }),
        ...(dto.memory !== undefined && { memory: dto.memory }),
        ...(dto.disk !== undefined && { disk: dto.disk }),
        ...(dto.buildMinutes !== undefined && { buildMinutes: dto.buildMinutes }),
        ...(dto.maxConcurrentDeploys !== undefined && { maxConcurrentDeploys: dto.maxConcurrentDeploys }),
        ...(dto.maxDnsZones !== undefined && { maxDnsZones: dto.maxDnsZones }),
      },
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'org.quota',
      target: organizationId,
      metadata: dto as Record<string, unknown>,
    });

    return { quota };
  }

  async listAllApps() {
    const apps = await this.prisma.app.findMany({
      include: {
        project: {
          select: {
            organizationId: true,
            name: true,
            userId: true,
            user: { select: { email: true, username: true } },
          },
        },
      },
      orderBy: { project: { name: 'asc' } },
    });
    return { apps };
  }

  async adminStopApp(actorId: string, appId: string) {
    const app = await this.prisma.app.findUnique({ where: { id: appId } });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });

    await this.stopContainer(app.subdomain);

    const updated = await this.prisma.app.update({
      where: { id: appId },
      data: { status: 'stopped' },
    });

    await this.auditService.log({
      actorUserId: actorId,
      action: 'admin.app.stop',
      target: appId,
    });

    return { app: updated };
  }

  async getMetrics() {
    const [users, organizations, apps, deployments, queueDepth] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.organization.count(),
      this.prisma.app.count(),
      this.prisma.deployment.count(),
      this.deployService.getQueueDepth(),
    ]);

    return { users, organizations, apps, deployments, queueDepth };
  }

  /**
   * Host-level capacity: CPU cores, total/used memory and disk, plus the number
   * of active users on the platform. Memory comes from the OS; disk from a
   * filesystem stat of the data root; "active users" are accounts not suspended.
   */
  async getSystem() {
    const os = await import('os');
    const fs = await import('fs');

    const cores = os.cpus()?.length ?? 0;
    const memTotal = os.totalmem();
    const memFree = os.freemem();
    const loadAvg = os.loadavg(); // [1m, 5m, 15m]

    // Disk usage of the filesystem holding the build/data root. statfs gives
    // block counts; total = blocks*bsize, free = bavail*bsize.
    let diskTotal: number | null = null;
    let diskFree: number | null = null;
    try {
      const statfs = (fs.promises as unknown as {
        statfs?: (p: string) => Promise<{ blocks: number; bavail: number; bsize: number }>;
      }).statfs;
      if (statfs) {
        const s = await statfs('/');
        diskTotal = s.blocks * s.bsize;
        diskFree = s.bavail * s.bsize;
      }
    } catch {
      // statfs unsupported (older Node / platform) — leave disk null.
    }

    const [activeUsers, totalUsers] = await Promise.all([
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count(),
    ]);

    return {
      hostname: os.hostname(),
      cores,
      loadAvg: loadAvg.map((n) => Math.round(n * 100) / 100),
      memory: { total: memTotal, free: memFree, used: memTotal - memFree },
      disk:
        diskTotal != null && diskFree != null
          ? { total: diskTotal, free: diskFree, used: diskTotal - diskFree }
          : null,
      users: { active: activeUsers, total: totalUsers },
      uptimeSeconds: Math.round(os.uptime()),
    };
  }

  /**
   * Aggregated deployment performance across all deployed sites, with optional
   * filtering by customer (org) and/or site (app). Powers the admin charts.
   *
   * "Performance" here is deployment activity/health (the data we persist):
   * deployments over time, success vs failure, current app-status breakdown,
   * and the busiest sites. Runtime container stats are not collected yet.
   *
   * @param window  trailing window for the time series. Pass `minutes` for
   *   precise sub-day ranges (e.g. 60 = last hour) or `days` for day ranges.
   *   When the window is 3 days or less the series is bucketed hourly; longer
   *   windows are bucketed daily.
   */
  async getPerformance(
    filter: { organizationId?: string; appId?: string } = {},
    window: { minutes?: number; days?: number } = {},
  ) {
    // Resolve the set of appIds in scope from the (org, app) filter. App is
    // linked to an org via Project, so an org filter walks project.organizationId.
    const appWhere: Prisma.AppWhereInput = {};
    if (filter.appId) appWhere.id = filter.appId;
    if (filter.organizationId) appWhere.project = { organizationId: filter.organizationId };

    const scopedApps = await this.prisma.app.findMany({
      where: appWhere,
      select: {
        id: true,
        name: true,
        status: true,
        subdomain: true,
        project: { select: { organizationId: true, organization: { select: { name: true } } } },
      },
    });
    const appIds = scopedApps.map((a) => a.id);

    // Resolve the trailing window in minutes. `minutes` wins when given;
    // otherwise fall back to `days`. Clamp to [1 minute, 365 days].
    const DAY_MIN = 24 * 60;
    const rawMinutes =
      window.minutes != null
        ? window.minutes
        : (window.days != null ? window.days : 30) * DAY_MIN;
    const windowMinutes = Math.min(
      Math.max(Math.trunc(rawMinutes) || 30 * DAY_MIN, 1),
      365 * DAY_MIN,
    );

    // Bucketing strategy. Sub-day windows are bucketed at a fine, fixed minute
    // step so the chart reads as near-realtime (e.g. 1h => 5-minute slots = 12
    // ticks); windows of 3 days or more are bucketed daily.
    //
    // `stepMinutes` is chosen from a "nice" ladder so that the number of ticks
    // stays in a readable band (~12-48). The smallest step (5 minutes) wins for
    // the 1h default, giving exactly 12 ticks.
    const STEP_LADDER = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440];
    const TARGET_MAX_TICKS = 48;
    const bucket: 'minute' | 'day' = windowMinutes < 3 * DAY_MIN ? 'minute' : 'day';

    let stepMinutes = DAY_MIN;
    if (bucket === 'minute') {
      stepMinutes =
        STEP_LADDER.find((step) => windowMinutes / step <= TARGET_MAX_TICKS) ??
        STEP_LADDER[STEP_LADDER.length - 1];
    }

    // Build the bucket boundaries in the SERVER's local timezone (the machine the
    // dashboard runs on), so the chart labels read in local wall-clock time
    // rather than UTC. For minute buckets we snap "now" down to the step grid in
    // local time and walk back; for daily, back from local midnight.
    const stepMs = stepMinutes * 60 * 1000;
    const now = new Date();
    const since = new Date(now);
    if (bucket === 'minute') {
      // Snap to the local-time step grid: subtract the local-clock remainder
      // within the step (minutes/seconds/ms), so boundaries land on :00, :05, …
      // of the machine's local clock regardless of its UTC offset.
      const localRemainderMin =
        ((now.getHours() * 60 + now.getMinutes()) % stepMinutes);
      const snapped = new Date(now);
      snapped.setMinutes(now.getMinutes() - localRemainderMin, 0, 0);
      since.setTime(snapped.getTime() - (windowMinutes - stepMinutes) * 60 * 1000);
    } else {
      since.setHours(0, 0, 0, 0);
      const windowDaysSpan = Math.ceil(windowMinutes / DAY_MIN);
      since.setDate(since.getDate() - (windowDaysSpan - 1));
    }

    const deployments = appIds.length
      ? await this.prisma.deployment.findMany({
          where: { appId: { in: appIds }, createdAt: { gte: since } },
          select: { appId: true, status: true, createdAt: true },
        })
      : [];

    // Time series, zero-filled so the chart shows gaps as zero. The `date` field
    // is a LOCAL-time key (no trailing Z): "YYYY-MM-DD" for day buckets, or
    // "YYYY-MM-DDTHH:mm" snapped to the step grid for minute buckets. Keys are
    // built from local-clock components so the client renders machine-local time.
    const pad = (n: number) => String(n).padStart(2, '0');
    const localDay = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const keyOf = (d: Date) => {
      if (bucket === 'day') return localDay(d);
      // Snap to the local step grid before keying.
      const snappedMin =
        Math.floor((d.getHours() * 60 + d.getMinutes()) / stepMinutes) * stepMinutes;
      return `${localDay(d)}T${pad(Math.floor(snappedMin / 60))}:${pad(snappedMin % 60)}`;
    };

    const series = new Map<
      string,
      { date: string; total: number; live: number; failed: number }
    >();
    if (bucket === 'minute') {
      const slots = Math.round((now.getTime() - since.getTime()) / stepMs) + 1;
      for (let i = 0; i < slots; i++) {
        const d = new Date(since.getTime() + i * stepMs);
        const k = keyOf(d);
        series.set(k, { date: k, total: 0, live: 0, failed: 0 });
      }
    } else {
      const days = Math.round((now.getTime() - since.getTime()) / (DAY_MIN * 60_000)) + 1;
      for (let i = 0; i < days; i++) {
        const d = new Date(since);
        d.setUTCDate(since.getUTCDate() + i);
        const k = keyOf(d);
        series.set(k, { date: k, total: 0, live: 0, failed: 0 });
      }
    }

    // Status breakdown across the deployments in scope/window.
    const statusCounts = { queued: 0, building: 0, live: 0, failed: 0 };
    // Per-site deployment counts (for "top sites").
    const perApp = new Map<string, number>();

    for (const dep of deployments) {
      const slot = series.get(keyOf(dep.createdAt));
      if (slot) {
        slot.total += 1;
        if (dep.status === 'live') slot.live += 1;
        if (dep.status === 'failed') slot.failed += 1;
      }
      if (dep.status in statusCounts) {
        statusCounts[dep.status as keyof typeof statusCounts] += 1;
      }
      perApp.set(dep.appId, (perApp.get(dep.appId) ?? 0) + 1);
    }

    const finished = statusCounts.live + statusCounts.failed;
    const successRate = finished > 0 ? statusCounts.live / finished : null;

    // Current app-status distribution (live/failed/stopped/...) over scope.
    const appStatusCounts: Record<string, number> = {};
    for (const a of scopedApps) {
      appStatusCounts[a.status] = (appStatusCounts[a.status] ?? 0) + 1;
    }

    const appNameById = new Map(scopedApps.map((a) => [a.id, a.name]));
    const topSites = [...perApp.entries()]
      .map(([appId, count]) => ({
        appId,
        name: appNameById.get(appId) ?? appId,
        deployments: count,
      }))
      .sort((a, b) => b.deployments - a.deployments)
      .slice(0, 10);

    return {
      // windowDays kept for backward compatibility; windowMinutes + bucket are
      // the precise values the client uses for labelling.
      windowDays: Math.max(1, Math.round(windowMinutes / DAY_MIN)),
      windowMinutes,
      bucket,
      stepMinutes,
      since: since.toISOString(),
      scope: {
        organizationId: filter.organizationId ?? null,
        appId: filter.appId ?? null,
        sites: scopedApps.length,
      },
      totals: {
        deployments: deployments.length,
        live: statusCounts.live,
        failed: statusCounts.failed,
        queued: statusCounts.queued,
        building: statusCounts.building,
        successRate,
      },
      series: [...series.values()],
      deploymentStatus: statusCounts,
      appStatus: appStatusCounts,
      topSites,
    };
  }

  async getAuditLogs() {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { actor: { select: { email: true } } },
    });
    // Flatten the actor relation to an actorEmail so the UI can show who
    // triggered the action without exposing the full user record.
    const logs = rows.map(({ actor, ...log }) => ({
      ...log,
      actorEmail: actor?.email ?? null,
    }));
    return { logs };
  }

  /**
   * Live resource usage, uptime and responsiveness per site, rolled up per
   * customer. Data comes from the Docker engine (CPU/memory/uptime from the
   * running container) plus an HTTP latency probe (how fast the site responds)
   * and the org quota (allocated limits). Sites whose container is not running
   * report zero usage and `up: false`.
   *
   * Everything is best-effort and resilient: if the Docker socket or a probe is
   * unavailable, that field is null/zero rather than failing the whole request.
   */
  async getResourceUsage(filter: { organizationId?: string; appId?: string } = {}) {
    const appWhere: Prisma.AppWhereInput = {};
    if (filter.appId) appWhere.id = filter.appId;
    if (filter.organizationId) appWhere.project = { organizationId: filter.organizationId };

    const apps = await this.prisma.app.findMany({
      where: appWhere,
      select: {
        id: true,
        name: true,
        subdomain: true,
        status: true,
        project: {
          select: {
            organizationId: true,
            organization: { select: { name: true, quota: true } },
          },
        },
      },
    });

    const docker = new Docker({ socketPath: '/var/run/docker.sock' });

    // Gather per-site metrics in parallel; each site is independently best-effort.
    const sites = await Promise.all(
      apps.map(async (app) => {
        const containerName = `upande-${app.subdomain}`;
        let up = false;
        let cpuPct: number | null = null;
        let memBytes: number | null = null;
        let memLimitBytes: number | null = null;
        let uptimeSeconds: number | null = null;

        try {
          const container = docker.getContainer(containerName);
          const info = await container.inspect();
          up = info.State?.Running ?? false;
          if (up && info.State?.StartedAt) {
            const started = new Date(info.State.StartedAt).getTime();
            if (started > 0) uptimeSeconds = Math.max(0, Math.round((Date.now() - started) / 1000));
          }
          if (up) {
            const stats = await this.readContainerStats(container);
            cpuPct = stats.cpuPct;
            memBytes = stats.memBytes;
            memLimitBytes = stats.memLimitBytes;
          }
        } catch {
          // No container / not running — leave defaults (up=false, nulls).
        }

        const latencyMs = up ? await this.probeLatency(app.subdomain) : null;

        return {
          appId: app.id,
          name: app.name,
          subdomain: app.subdomain,
          organizationId: app.project?.organizationId ?? null,
          customer: app.project?.organization?.name ?? null,
          status: app.status,
          up,
          cpuPct,
          memBytes,
          memLimitBytes,
          uptimeSeconds,
          latencyMs,
          // Allocated limits from the owning organization's quota.
          quota: app.project?.organization?.quota
            ? {
                cpu: app.project.organization.quota.cpu,
                memory: app.project.organization.quota.memory,
                disk: app.project.organization.quota.disk,
              }
            : null,
        };
      }),
    );

    // Roll up per customer (org).
    const byCustomer = new Map<
      string,
      {
        organizationId: string;
        customer: string;
        sites: number;
        sitesUp: number;
        cpuPct: number;
        memBytes: number;
        avgLatencyMs: number | null;
      }
    >();
    for (const s of sites) {
      if (!s.organizationId) continue;
      const row =
        byCustomer.get(s.organizationId) ??
        {
          organizationId: s.organizationId,
          customer: s.customer ?? s.organizationId,
          sites: 0,
          sitesUp: 0,
          cpuPct: 0,
          memBytes: 0,
          avgLatencyMs: null as number | null,
        };
      row.sites += 1;
      if (s.up) row.sitesUp += 1;
      row.cpuPct += s.cpuPct ?? 0;
      row.memBytes += s.memBytes ?? 0;
      byCustomer.set(s.organizationId, row);
    }
    // Average latency per customer over its responsive sites.
    for (const [organizationId, row] of byCustomer) {
      const latencies = sites
        .filter((s) => s.organizationId === organizationId && s.latencyMs != null)
        .map((s) => s.latencyMs as number);
      row.avgLatencyMs = latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null;
      row.cpuPct = Math.round(row.cpuPct * 10) / 10;
    }

    // Fastest / slowest responsive sites (by measured latency).
    const responsive = sites
      .filter((s) => s.latencyMs != null)
      .sort((a, b) => (a.latencyMs as number) - (b.latencyMs as number));
    const fastest = responsive.slice(0, 5);
    const slowest = [...responsive].reverse().slice(0, 5);

    return {
      generatedAt: new Date().toISOString(),
      scope: { organizationId: filter.organizationId ?? null, appId: filter.appId ?? null, sites: sites.length },
      totals: {
        sites: sites.length,
        sitesUp: sites.filter((s) => s.up).length,
        cpuPct: Math.round(sites.reduce((a, s) => a + (s.cpuPct ?? 0), 0) * 10) / 10,
        memBytes: sites.reduce((a, s) => a + (s.memBytes ?? 0), 0),
      },
      sites,
      byCustomer: [...byCustomer.values()].sort((a, b) => b.cpuPct - a.cpuPct),
      fastest,
      slowest,
    };
  }

  /**
   * Read a single CPU/memory sample from a running container. Docker's stats API
   * returns cumulative CPU counters; one non-streaming read already includes a
   * precpu snapshot, so we can derive an instantaneous percentage from it.
   */
  private async readContainerStats(
    container: Docker.Container,
  ): Promise<{ cpuPct: number | null; memBytes: number | null; memLimitBytes: number | null }> {
    try {
      // A single non-streaming stats read already carries a `precpu_stats`
      // snapshot (Docker samples ~1s prior), so we can derive CPU% from one
      // call — no priming read or sleep, which keeps this fast.
      const stats: any = await container.stats({ stream: false });
      const cpuDelta =
        (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) -
        (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
      const systemDelta =
        (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
      const cpuCount =
        stats.cpu_stats?.online_cpus ??
        stats.cpu_stats?.cpu_usage?.percpu_usage?.length ??
        1;
      const cpuPct =
        systemDelta > 0 && cpuDelta > 0
          ? Math.round(((cpuDelta / systemDelta) * cpuCount * 100) * 10) / 10
          : 0;
      // Memory: usage minus cache, like `docker stats`.
      const used =
        (stats.memory_stats?.usage ?? 0) - (stats.memory_stats?.stats?.cache ?? 0);
      return {
        cpuPct,
        memBytes: Math.max(0, used),
        memLimitBytes: stats.memory_stats?.limit ?? null,
      };
    } catch {
      return { cpuPct: null, memBytes: null, memLimitBytes: null };
    }
  }

  /**
   * Measure how quickly a site responds, as a user would experience it: the
   * request goes through Traefik (the same proxy that serves real traffic),
   * targeting the app's host rule. We hit Traefik's HTTP entrypoint and set the
   * Host header so it routes to the right site. Returns round-trip milliseconds,
   * or null if unreachable within the timeout.
   */
  private async probeLatency(subdomain: string): Promise<number | null> {
    const domain = process.env.BASE_DOMAIN ?? 'localhost';
    const host = `${subdomain}.${domain}`;
    // Reach Traefik's HTTP entrypoint directly on the host (published port).
    const proxyHost = process.env.PROXY_PROBE_HOST ?? '127.0.0.1';
    const proxyPort = process.env.APP_HTTP_PORT || '80';
    const url = `http://${proxyHost}:${proxyPort}/`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const start = Date.now();
    try {
      // Any HTTP response (even 404) counts as "responsive" — we measure latency,
      // not correctness. The Host header makes Traefik route to this site.
      await fetch(url, {
        method: 'HEAD',
        headers: { Host: host },
        signal: controller.signal,
        redirect: 'manual',
      });
      return Date.now() - start;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async stopContainer(subdomain: string): Promise<void> {
    try {
      const docker = new Docker({ socketPath: '/var/run/docker.sock' });
      const container = docker.getContainer(`upande-${subdomain}`);
      await container.stop();
    } catch {
      // Container may not be running — ignore
    }
  }

}
