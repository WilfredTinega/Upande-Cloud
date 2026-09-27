"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const config_1 = require("@nestjs/config");
const Docker = require("dockerode");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const prisma_service_1 = require("../prisma/prisma.service");
const deploy_service_1 = require("../deploy/deploy.service");
const log_store_service_1 = require("../deploy/log-store.service");
const audit_service_1 = require("../common/audit.service");
const notifications_service_1 = require("../notifications/notifications.service");
const slug_util_1 = require("../common/slug.util");
const user_purge_service_1 = require("../common/user-purge.service");
const ai_service_1 = require("./ai.service");
const encrypt_util_1 = require("../common/encrypt.util");
const github_config_service_1 = require("../github/github-config.service");
const platform_network_service_1 = require("../dns/platform-network.service");
const net_1 = require("net");
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
let AdminService = class AdminService {
    constructor(prisma, deployService, logStore, auditService, notifications, ai, jwtService, config, userPurge, ghConfig, network) {
        this.prisma = prisma;
        this.deployService = deployService;
        this.logStore = logStore;
        this.auditService = auditService;
        this.notifications = notifications;
        this.ai = ai;
        this.jwtService = jwtService;
        this.config = config;
        this.userPurge = userPurge;
        this.ghConfig = ghConfig;
        this.network = network;
    }
    async impersonateUser(actor, userId, password, reason) {
        const actorRecord = await this.prisma.user.findUnique({
            where: { id: actor.id },
            select: { passwordHash: true, username: true },
        });
        const passwordOk = !!actorRecord?.passwordHash && (await bcrypt.compare(password, actorRecord.passwordHash));
        if (!passwordOk) {
            await this.auditService.log({
                actorUserId: actorRecord ? actor.id : undefined,
                action: 'user.impersonate.denied',
                target: userId,
                metadata: { reason: 'invalid_password' },
            });
            throw new common_1.ForbiddenException({
                code: 'INVALID_PASSWORD',
                message: 'Incorrect password.',
            });
        }
        const target = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!target)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
        if (target.role === 'superadmin') {
            throw new common_1.ForbiddenException({
                code: 'SUPERADMIN_LOCKED',
                message: 'The superadmin account cannot be impersonated.',
            });
        }
        if (target.status === 'suspended') {
            throw new common_1.ForbiddenException({
                code: 'USER_SUSPENDED',
                message: 'Cannot impersonate a suspended user. Reactivate the account first.',
            });
        }
        const token = this.jwtService.sign({
            sub: target.id,
            email: target.email,
            role: target.role,
            organizationId: target.organizationId,
            tv: target.tokenVersion,
            imp: { by: actor.id, email: actor.email },
        }, { expiresIn: '30m' });
        await this.auditService.log({
            actorUserId: actor.id,
            action: 'user.impersonate',
            target: userId,
            metadata: { targetEmail: target.email, targetRole: target.role, reason },
        });
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
        const dashboardBase = (this.config.get('DASHBOARD_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
        return {
            token,
            user: {
                id: target.id,
                email: target.email,
                role: target.role,
                status: target.status,
                organizationId: target.organizationId,
            },
            dashboardUrl: `${dashboardBase}/impersonate#token=${encodeURIComponent(token)}`,
        };
    }
    async aiStatus() {
        return { enabled: await this.ai.isConfigured() };
    }
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
    async updateSettings(actorId, dto) {
        if (dto.agentApiUrl !== undefined) {
            await this.prisma.setting.upsert({
                where: { key: SETTING_AGENT_API_URL },
                create: { key: SETTING_AGENT_API_URL, value: dto.agentApiUrl, encrypted: false },
                update: { value: dto.agentApiUrl, encrypted: false },
            });
        }
        if (dto.agentToken) {
            await this.prisma.setting.upsert({
                where: { key: SETTING_AGENT_TOKEN },
                create: { key: SETTING_AGENT_TOKEN, value: (0, encrypt_util_1.encrypt)(dto.agentToken), encrypted: true },
                update: { value: (0, encrypt_util_1.encrypt)(dto.agentToken), encrypted: true },
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
    async getAgentToken() {
        const row = await this.prisma.setting.findUnique({ where: { key: SETTING_AGENT_TOKEN } });
        if (!row)
            return null;
        return row.encrypted ? (0, encrypt_util_1.decrypt)(row.value) : row.value;
    }
    async getGithubSettings() {
        const cfg = await this.ghConfig.get();
        return {
            configured: Boolean(cfg.clientId && cfg.clientSecret),
            clientId: cfg.clientId ?? '',
            clientIdSource: cfg.sources.clientId,
            clientSecretSet: Boolean(cfg.clientSecret),
            clientSecretSource: cfg.sources.clientSecret,
            stateSecretSource: cfg.sources.stateSecret,
            homepageUrl: this.ghConfig.dashboardUrl(),
            callbackUrl: this.ghConfig.callbackUrl(),
        };
    }
    async updateGithubSettings(actorId, dto) {
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
    async testGithubSettings() {
        const cfg = await this.ghConfig.get();
        if (!cfg.clientId || !cfg.clientSecret) {
            return { ok: false, message: 'Client ID and client secret are both required.' };
        }
        let body = {};
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
            body = (await res.json().catch(() => ({})));
            if (res.status === 404 || body.error === 'Not Found') {
                return { ok: false, message: 'GitHub does not recognise this client ID.' };
            }
        }
        catch {
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
    async getNetworkSettings() {
        const cfg = await this.network.get();
        return {
            publicIpv4: cfg.ipv4 ?? '',
            publicIpv4Source: cfg.sources.ipv4,
            publicIpv6: cfg.ipv6 ?? '',
            publicIpv6Source: cfg.sources.ipv6,
            effectiveIp: cfg.ipv4 ?? cfg.ipv6 ?? null,
        };
    }
    async updateNetworkSettings(actorId, dto) {
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
    async detectPublicIp() {
        const errors = [];
        const probe = async (url, family) => {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
                if (!res.ok) {
                    errors.push(`${new URL(url).host} answered HTTP ${res.status}`);
                    return null;
                }
                const ip = (await res.text()).trim();
                if ((0, net_1.isIP)(ip) !== family) {
                    if (family === 6)
                        return null;
                    errors.push(`${new URL(url).host} returned an unexpected answer`);
                    return null;
                }
                return ip;
            }
            catch (err) {
                const reason = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'unreachable';
                errors.push(family === 4
                    ? `Could not detect the IPv4 address (${new URL(url).host} ${reason}).`
                    : `No IPv6 address detected (${new URL(url).host} ${reason}; the server may have no IPv6 connectivity).`);
                return null;
            }
        };
        const [ipv4, ipv6] = await Promise.all([
            probe('https://api.ipify.org', 4),
            probe('https://api6.ipify.org', 6),
        ]);
        return { ipv4, ipv6, errors };
    }
    async listAgentTokens() {
        const tokens = await this.prisma.agentToken.findMany({
            where: { revokedAt: null },
            select: { id: true, name: true, lastUsedAt: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
        });
        return { tokens };
    }
    async createAgentToken(actor, name) {
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
    async revokeAgentToken(actorId, id) {
        const token = await this.prisma.agentToken.findUnique({ where: { id } });
        if (!token || token.revokedAt) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Token not found' });
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
    async generateMcpConfig(actor, mcpEntryPath) {
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
    async adminDeployApp(actorId, appId, ref) {
        const app = await this.prisma.app.findUnique({ where: { id: appId } });
        if (!app) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
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
    async bulkMigrateAllSites(actor, options = {}) {
        const where = {};
        if (options.type)
            where.type = options.type;
        const apps = await this.prisma.app.findMany({
            where,
            select: { id: true, name: true, subdomain: true, type: true, status: true, branch: true },
            orderBy: { createdAt: 'asc' },
        });
        const eligible = apps.filter((a) => a.status !== 'idle' && a.status !== 'building');
        const skipped = apps.filter((a) => a.status === 'idle' || a.status === 'building');
        const queued = [];
        const failed = [];
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
                    forceClean: true,
                });
                queued.push({ appId: app.id, name: app.name, deploymentId: deployment.id });
            }
            catch (err) {
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
    async analyzeLatestForApp(actorId, appId) {
        const latest = await this.prisma.deployment.findFirst({
            where: { appId },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
        });
        if (!latest) {
            throw new common_1.NotFoundException({
                code: 'NOT_FOUND',
                message: 'This app has no deployments to analyze.',
            });
        }
        return this.analyzeDeployment(actorId, latest.id);
    }
    async listDeploymentErrors() {
        return this.notifications.listDeploymentFailures();
    }
    async listAppDeployments(appId, take = 30) {
        const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { id: true } });
        if (!app)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
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
                durationMs: d.startedAt && d.finishedAt ? d.finishedAt.getTime() - d.startedAt.getTime() : null,
                errorReason: d.errorReason,
            })),
        };
    }
    async getDeploymentLog(deploymentId) {
        const deployment = await this.prisma.deployment.findUnique({
            where: { id: deploymentId },
            select: { status: true, ref: true, createdAt: true, app: { select: { name: true } } },
        });
        if (!deployment) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Deployment not found' });
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
    async analyzeDeployment(actorId, deploymentId, errorReason) {
        const deployment = await this.prisma.deployment.findUnique({
            where: { id: deploymentId },
            include: { app: { select: { name: true, type: true } } },
        });
        if (!deployment) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Deployment not found' });
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
    async suspendUser(actorId, userId) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
        if (user.role === 'superadmin') {
            throw new common_1.ForbiddenException({
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
    async unsuspendUser(actorId, userId) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
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
    async deleteUser(actorId, userId) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
        if (user.role === 'superadmin') {
            throw new common_1.ForbiddenException({
                code: 'SUPERADMIN_LOCKED',
                message: 'The superadmin account cannot be deleted from the UI. Manage it via the CLI.',
            });
        }
        if (userId === actorId) {
            throw new common_1.ForbiddenException({
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
    async updateUser(actorId, userId, dto) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
        const movingOrg = dto.organizationId !== undefined && dto.organizationId !== user.organizationId;
        if (user.role === 'superadmin' && movingOrg) {
            throw new common_1.ForbiddenException({
                code: 'SUPERADMIN_LOCKED',
                message: 'The superadmin organization is managed via the CLI and cannot be changed here.',
            });
        }
        if (user.role === 'superadmin' && dto.password) {
            throw new common_1.ForbiddenException({
                code: 'SUPERADMIN_LOCKED',
                message: "A superadmin's password cannot be changed from the UI. Manage it via the CLI.",
            });
        }
        if (user.role === 'superadmin' &&
            actorId !== user.id &&
            ((dto.email && dto.email !== user.email) || (dto.username && dto.username !== user.username))) {
            throw new common_1.ForbiddenException({
                code: 'SUPERADMIN_LOCKED',
                message: "Only the superadmin can change the superadmin's email or username.",
            });
        }
        if (dto.email && dto.email !== user.email) {
            const taken = await this.prisma.user.findUnique({ where: { email: dto.email } });
            if (taken) {
                throw new common_1.ConflictException({ code: 'CONFLICT', message: 'Email already in use' });
            }
        }
        if (dto.username && dto.username !== user.username) {
            const taken = await this.prisma.user.findUnique({ where: { username: dto.username } });
            if (taken) {
                throw new common_1.ConflictException({ code: 'CONFLICT', message: 'Username already in use' });
            }
        }
        if (movingOrg) {
            const org = await this.prisma.organization.findUnique({
                where: { id: dto.organizationId },
                select: { id: true },
            });
            if (!org) {
                throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found' });
            }
        }
        const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : undefined;
        const updated = await this.prisma.$transaction(async (tx) => {
            if (movingOrg) {
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
                passwordChanged: dto.password ? true : undefined,
            },
        });
        return { user: updated };
    }
    async updateRole(actorId, userId, dto) {
        const user = await this.prisma.user.findUnique({ where: { id: userId } });
        if (!user)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'User not found' });
        if (user.role === 'superadmin') {
            throw new common_1.ForbiddenException({
                code: 'SUPERADMIN_LOCKED',
                message: "A superadmin's role cannot be changed from the UI. Manage it via the CLI.",
            });
        }
        if (dto.role === 'superadmin') {
            throw new common_1.ForbiddenException({
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
        const appCounts = await this.prisma.app.groupBy({
            by: ['projectId'],
            _count: { _all: true },
        });
        const projectOrg = new Map((await this.prisma.project.findMany({ select: { id: true, organizationId: true } })).map((p) => [p.id, p.organizationId]));
        const appsByOrg = new Map();
        for (const row of appCounts) {
            const orgId = projectOrg.get(row.projectId);
            if (!orgId)
                continue;
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
    async createOrganization(actorId, dto) {
        const slug = (0, slug_util_1.slugify)(dto.slug ?? dto.name);
        if (!slug) {
            throw new common_1.ConflictException({
                code: 'INVALID_SLUG',
                message: 'Could not derive a valid slug from the name.',
            });
        }
        const existing = await this.prisma.organization.findUnique({ where: { slug } });
        if (existing) {
            throw new common_1.ConflictException({
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
    async updateQuota(actorId, organizationId, dto) {
        const organization = await this.prisma.organization.findUnique({
            where: { id: organizationId },
        });
        if (!organization)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Organization not found' });
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
            metadata: dto,
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
    async adminStopApp(actorId, appId) {
        const app = await this.prisma.app.findUnique({ where: { id: appId } });
        if (!app)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
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
    async getSystem() {
        const os = await Promise.resolve().then(() => require('os'));
        const fs = await Promise.resolve().then(() => require('fs'));
        const cores = os.cpus()?.length ?? 0;
        const memTotal = os.totalmem();
        const memFree = os.freemem();
        const loadAvg = os.loadavg();
        let diskTotal = null;
        let diskFree = null;
        try {
            const statfs = fs.promises.statfs;
            if (statfs) {
                const s = await statfs('/');
                diskTotal = s.blocks * s.bsize;
                diskFree = s.bavail * s.bsize;
            }
        }
        catch {
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
            disk: diskTotal != null && diskFree != null
                ? { total: diskTotal, free: diskFree, used: diskTotal - diskFree }
                : null,
            users: { active: activeUsers, total: totalUsers },
            uptimeSeconds: Math.round(os.uptime()),
        };
    }
    async getPerformance(filter = {}, window = {}) {
        const appWhere = {};
        if (filter.appId)
            appWhere.id = filter.appId;
        if (filter.organizationId)
            appWhere.project = { organizationId: filter.organizationId };
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
        const DAY_MIN = 24 * 60;
        const rawMinutes = window.minutes != null
            ? window.minutes
            : (window.days != null ? window.days : 30) * DAY_MIN;
        const windowMinutes = Math.min(Math.max(Math.trunc(rawMinutes) || 30 * DAY_MIN, 1), 365 * DAY_MIN);
        const STEP_LADDER = [5, 10, 15, 30, 60, 120, 180, 240, 360, 720, 1440];
        const TARGET_MAX_TICKS = 48;
        const bucket = windowMinutes < 3 * DAY_MIN ? 'minute' : 'day';
        let stepMinutes = DAY_MIN;
        if (bucket === 'minute') {
            stepMinutes =
                STEP_LADDER.find((step) => windowMinutes / step <= TARGET_MAX_TICKS) ??
                    STEP_LADDER[STEP_LADDER.length - 1];
        }
        const stepMs = stepMinutes * 60 * 1000;
        const now = new Date();
        const since = new Date(now);
        if (bucket === 'minute') {
            const localRemainderMin = ((now.getHours() * 60 + now.getMinutes()) % stepMinutes);
            const snapped = new Date(now);
            snapped.setMinutes(now.getMinutes() - localRemainderMin, 0, 0);
            since.setTime(snapped.getTime() - (windowMinutes - stepMinutes) * 60 * 1000);
        }
        else {
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
        const pad = (n) => String(n).padStart(2, '0');
        const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const keyOf = (d) => {
            if (bucket === 'day')
                return localDay(d);
            const snappedMin = Math.floor((d.getHours() * 60 + d.getMinutes()) / stepMinutes) * stepMinutes;
            return `${localDay(d)}T${pad(Math.floor(snappedMin / 60))}:${pad(snappedMin % 60)}`;
        };
        const series = new Map();
        if (bucket === 'minute') {
            const slots = Math.round((now.getTime() - since.getTime()) / stepMs) + 1;
            for (let i = 0; i < slots; i++) {
                const d = new Date(since.getTime() + i * stepMs);
                const k = keyOf(d);
                series.set(k, { date: k, total: 0, live: 0, failed: 0 });
            }
        }
        else {
            const days = Math.round((now.getTime() - since.getTime()) / (DAY_MIN * 60_000)) + 1;
            for (let i = 0; i < days; i++) {
                const d = new Date(since);
                d.setUTCDate(since.getUTCDate() + i);
                const k = keyOf(d);
                series.set(k, { date: k, total: 0, live: 0, failed: 0 });
            }
        }
        const statusCounts = { queued: 0, building: 0, live: 0, failed: 0 };
        const perApp = new Map();
        for (const dep of deployments) {
            const slot = series.get(keyOf(dep.createdAt));
            if (slot) {
                slot.total += 1;
                if (dep.status === 'live')
                    slot.live += 1;
                if (dep.status === 'failed')
                    slot.failed += 1;
            }
            if (dep.status in statusCounts) {
                statusCounts[dep.status] += 1;
            }
            perApp.set(dep.appId, (perApp.get(dep.appId) ?? 0) + 1);
        }
        const finished = statusCounts.live + statusCounts.failed;
        const successRate = finished > 0 ? statusCounts.live / finished : null;
        const appStatusCounts = {};
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
        const logs = rows.map(({ actor, ...log }) => ({
            ...log,
            actorEmail: actor?.email ?? null,
        }));
        return { logs };
    }
    async getResourceUsage(filter = {}) {
        const appWhere = {};
        if (filter.appId)
            appWhere.id = filter.appId;
        if (filter.organizationId)
            appWhere.project = { organizationId: filter.organizationId };
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
        const sites = await Promise.all(apps.map(async (app) => {
            const containerName = `upande-${app.subdomain}`;
            let up = false;
            let cpuPct = null;
            let memBytes = null;
            let memLimitBytes = null;
            let uptimeSeconds = null;
            try {
                const container = docker.getContainer(containerName);
                const info = await container.inspect();
                up = info.State?.Running ?? false;
                if (up && info.State?.StartedAt) {
                    const started = new Date(info.State.StartedAt).getTime();
                    if (started > 0)
                        uptimeSeconds = Math.max(0, Math.round((Date.now() - started) / 1000));
                }
                if (up) {
                    const stats = await this.readContainerStats(container);
                    cpuPct = stats.cpuPct;
                    memBytes = stats.memBytes;
                    memLimitBytes = stats.memLimitBytes;
                }
            }
            catch {
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
                quota: app.project?.organization?.quota
                    ? {
                        cpu: app.project.organization.quota.cpu,
                        memory: app.project.organization.quota.memory,
                        disk: app.project.organization.quota.disk,
                    }
                    : null,
            };
        }));
        const byCustomer = new Map();
        for (const s of sites) {
            if (!s.organizationId)
                continue;
            const row = byCustomer.get(s.organizationId) ??
                {
                    organizationId: s.organizationId,
                    customer: s.customer ?? s.organizationId,
                    sites: 0,
                    sitesUp: 0,
                    cpuPct: 0,
                    memBytes: 0,
                    avgLatencyMs: null,
                };
            row.sites += 1;
            if (s.up)
                row.sitesUp += 1;
            row.cpuPct += s.cpuPct ?? 0;
            row.memBytes += s.memBytes ?? 0;
            byCustomer.set(s.organizationId, row);
        }
        for (const [organizationId, row] of byCustomer) {
            const latencies = sites
                .filter((s) => s.organizationId === organizationId && s.latencyMs != null)
                .map((s) => s.latencyMs);
            row.avgLatencyMs = latencies.length
                ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
                : null;
            row.cpuPct = Math.round(row.cpuPct * 10) / 10;
        }
        const responsive = sites
            .filter((s) => s.latencyMs != null)
            .sort((a, b) => a.latencyMs - b.latencyMs);
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
    async readContainerStats(container) {
        try {
            const stats = await container.stats({ stream: false });
            const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) -
                (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
            const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
            const cpuCount = stats.cpu_stats?.online_cpus ??
                stats.cpu_stats?.cpu_usage?.percpu_usage?.length ??
                1;
            const cpuPct = systemDelta > 0 && cpuDelta > 0
                ? Math.round(((cpuDelta / systemDelta) * cpuCount * 100) * 10) / 10
                : 0;
            const used = (stats.memory_stats?.usage ?? 0) - (stats.memory_stats?.stats?.cache ?? 0);
            return {
                cpuPct,
                memBytes: Math.max(0, used),
                memLimitBytes: stats.memory_stats?.limit ?? null,
            };
        }
        catch {
            return { cpuPct: null, memBytes: null, memLimitBytes: null };
        }
    }
    async probeLatency(subdomain) {
        const domain = process.env.BASE_DOMAIN ?? 'localhost';
        const host = `${subdomain}.${domain}`;
        const proxyHost = process.env.PROXY_PROBE_HOST ?? '127.0.0.1';
        const proxyPort = process.env.APP_HTTP_PORT || '80';
        const url = `http://${proxyHost}:${proxyPort}/`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const start = Date.now();
        try {
            await fetch(url, {
                method: 'HEAD',
                headers: { Host: host },
                signal: controller.signal,
                redirect: 'manual',
            });
            return Date.now() - start;
        }
        catch {
            return null;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async stopContainer(subdomain) {
        try {
            const docker = new Docker({ socketPath: '/var/run/docker.sock' });
            const container = docker.getContainer(`upande-${subdomain}`);
            await container.stop();
        }
        catch {
        }
    }
};
exports.AdminService = AdminService;
exports.AdminService = AdminService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        deploy_service_1.DeployService,
        log_store_service_1.LogStoreService,
        audit_service_1.AuditService,
        notifications_service_1.NotificationsService,
        ai_service_1.AiService,
        jwt_1.JwtService,
        config_1.ConfigService,
        user_purge_service_1.UserPurgeService,
        github_config_service_1.GithubConfigService,
        platform_network_service_1.PlatformNetworkService])
], AdminService);
//# sourceMappingURL=admin.service.js.map