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
var AppsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppsService = void 0;
const common_1 = require("@nestjs/common");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const Docker = require("dockerode");
const uuid_1 = require("uuid");
const prisma_service_1 = require("../prisma/prisma.service");
const deploy_service_1 = require("../deploy/deploy.service");
const build_cache_service_1 = require("../deploy/build-cache.service");
const db_provision_service_1 = require("../database/db-provision.service");
const log_store_service_1 = require("../deploy/log-store.service");
const audit_service_1 = require("../common/audit.service");
const previews_service_1 = require("./previews.service");
const maintenance_page_1 = require("./maintenance-page");
const dns_service_1 = require("../dns/dns.service");
const platform_network_service_1 = require("../dns/platform-network.service");
const net_1 = require("net");
const client_1 = require("@prisma/client");
const custom_domain_util_1 = require("./custom-domain.util");
const app_url_util_1 = require("../common/app-url.util");
const upload_path_util_1 = require("../common/upload-path.util");
const encrypt_util_1 = require("../common/encrypt.util");
const nodered_1 = require("./nodered");
const rxjs_1 = require("rxjs");
function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 40);
}
let AppsService = AppsService_1 = class AppsService {
    constructor(prisma, deployService, logStore, auditService, dnsService, network, previews, buildCache, dbProvision) {
        this.prisma = prisma;
        this.deployService = deployService;
        this.logStore = logStore;
        this.auditService = auditService;
        this.dnsService = dnsService;
        this.network = network;
        this.previews = previews;
        this.buildCache = buildCache;
        this.dbProvision = dbProvision;
        this.statusCache = new Map();
    }
    async listApps(userId, organizationId) {
        const apps = await this.prisma.app.findMany({
            where: {
                project: {
                    organizationId,
                },
            },
            include: {
                project: { select: { id: true, name: true, slug: true } },
            },
            orderBy: { project: { name: 'asc' } },
        });
        return {
            apps: apps.map((a) => ({
                ...a,
                url: (0, app_url_util_1.buildAppUrl)(a.subdomain),
            })),
        };
    }
    async createApp(userId, organizationId, dto) {
        let project = await this.prisma.project.findFirst({
            where: { organizationId, userId },
        });
        if (dto.projectId) {
            project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
            if (!project || project.organizationId !== organizationId) {
                throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Project not found' });
            }
        }
        if (!project) {
            const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { organization: true } });
            const orgSlug = user?.organization?.slug ?? 'default';
            let projectSlug = `${orgSlug}-default`;
            const existing = await this.prisma.project.findUnique({ where: { slug: projectSlug } });
            if (existing)
                projectSlug = `${projectSlug}-${Date.now()}`;
            project = await this.prisma.project.create({
                data: {
                    organizationId,
                    userId,
                    name: 'Default',
                    slug: projectSlug,
                },
            });
        }
        const baseSlug = slugify(dto.name);
        let subdomain = baseSlug;
        const existing = await this.prisma.app.findUnique({ where: { subdomain } });
        const previewHit = existing
            ? null
            : await this.prisma.preview.findUnique({ where: { subdomain }, select: { id: true } });
        if (existing || previewHit)
            subdomain = `${baseSlug}-${(0, uuid_1.v4)().substring(0, 6)}`;
        const isNodeRed = dto.type === 'nodered';
        const noderedAdminPassword = isNodeRed
            ? crypto.randomBytes(12).toString('base64url')
            : null;
        const noderedPort = null;
        const app = await this.prisma.app.create({
            data: {
                projectId: project.id,
                name: dto.name,
                type: dto.type ?? 'static',
                source: dto.source,
                repoUrl: dto.repoUrl ?? null,
                branch: dto.branch ?? 'main',
                subdomain,
                buildCmd: dto.buildCmd ?? null,
                outputDir: dto.outputDir ?? 'dist',
                status: 'idle',
                githubRepoFullName: dto.githubRepoFullName ?? null,
                noderedVolumeName: isNodeRed ? (0, nodered_1.noderedVolumeName)(subdomain) : null,
                noderedPort,
                noderedAdminPasswordEnc: isNodeRed && noderedAdminPassword
                    ? (0, encrypt_util_1.encrypt)(noderedAdminPassword)
                    : null,
            },
        });
        if (isNodeRed && noderedAdminPassword) {
            await this.prisma.nodeRedUser.create({
                data: {
                    appId: app.id,
                    username: 'admin',
                    passwordHash: (0, nodered_1.hashNodeRedPassword)(noderedAdminPassword),
                    permission: '*',
                },
            });
        }
        await this.auditService.log({
            actorUserId: userId,
            action: 'app.create',
            target: app.id,
            metadata: { name: app.name, source: app.source, type: app.type },
        });
        await this.startMaintenanceContainer(app.subdomain);
        return { app, noderedAdminPassword: noderedAdminPassword ?? undefined };
    }
    async getApp(userId, organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        const [project, deployments] = await Promise.all([
            this.prisma.project.findUnique({
                where: { id: app.projectId },
                select: { user: { select: { email: true, username: true } } },
            }),
            this.prisma.deployment.findMany({
                where: { appId, previewId: null },
                orderBy: { createdAt: 'desc' },
                take: 20,
            }),
        ]);
        return {
            app: {
                ...app,
                url: (0, app_url_util_1.buildAppUrl)(app.subdomain),
                createdBy: project?.user?.email ?? project?.user?.username ?? null,
            },
            deployments,
        };
    }
    async getAdminLogin(userId, organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        const base = (0, app_url_util_1.buildAppUrl)(app.subdomain).replace(/\/$/, '');
        if (app.type === 'nodered' && app.noderedAdminPasswordEnc) {
            const token = await this.noderedAccessToken(app.subdomain, 'admin', (0, encrypt_util_1.decrypt)(app.noderedAdminPasswordEnc));
            await this.auditService.log({
                action: 'app.admin_login',
                target: app.id,
                metadata: { subdomain: app.subdomain },
            });
            return {
                mode: 'redirect',
                redirectUrl: `${base}/?access_token=${encodeURIComponent(token)}`,
            };
        }
        const path = app.type === 'fullstack' ? '/login' : '/';
        return { mode: 'redirect', redirectUrl: `${base}${path}` };
    }
    async noderedAccessToken(subdomain, username, password) {
        const body = new URLSearchParams({
            client_id: 'node-red-editor',
            grant_type: 'password',
            scope: '*',
            username,
            password,
        }).toString();
        const publicUrl = new URL((0, app_url_util_1.buildAppUrl)(subdomain));
        const origin = (process.env.NODERED_TRAEFIK_ORIGIN ?? publicUrl.origin).replace(/\/$/, '');
        let res;
        try {
            res = await fetch(`${origin}/auth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Host: publicUrl.host,
                },
                body,
            });
        }
        catch {
            throw new common_1.BadRequestException({
                code: 'NODERED_UNREACHABLE',
                message: 'Could not reach the Node-RED instance. Make sure it is deployed and running, then try again.',
            });
        }
        if (!res.ok) {
            throw new common_1.BadRequestException({
                code: 'NODERED_AUTH_FAILED',
                message: 'Could not sign in to Node-RED with the stored admin credentials. Reset the admin password and try again.',
            });
        }
        const data = (await res.json());
        if (!data.access_token) {
            throw new common_1.BadRequestException({
                code: 'NODERED_AUTH_FAILED',
                message: 'Node-RED did not return an access token.',
            });
        }
        return data.access_token;
    }
    async findNodeRedApp(organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        if (app.type !== 'nodered') {
            throw new common_1.BadRequestException({
                code: 'NOT_NODERED_APP',
                message: 'This app is not a Node-RED app',
            });
        }
        return app;
    }
    async listNodeRedUsers(organizationId, appId) {
        await this.findNodeRedApp(organizationId, appId);
        const users = await this.prisma.nodeRedUser.findMany({
            where: { appId },
            orderBy: { createdAt: 'asc' },
            select: {
                id: true,
                username: true,
                permission: true,
                createdAt: true,
            },
        });
        return { users };
    }
    async addNodeRedUser(userId, organizationId, appId, dto) {
        const app = await this.findNodeRedApp(organizationId, appId);
        const existing = await this.prisma.nodeRedUser.findUnique({
            where: { appId_username: { appId, username: dto.username } },
        });
        if (existing) {
            throw new common_1.ConflictException({
                code: 'USER_EXISTS',
                message: `An account named "${dto.username}" already exists`,
            });
        }
        const user = await this.prisma.nodeRedUser.create({
            data: {
                appId,
                username: dto.username,
                passwordHash: (0, nodered_1.hashNodeRedPassword)(dto.password),
                permission: dto.permission ?? '*',
            },
            select: { id: true, username: true, permission: true, createdAt: true },
        });
        await this.auditService.log({
            actorUserId: userId,
            action: 'nodered.user.add',
            target: appId,
            metadata: { username: user.username, permission: user.permission },
        });
        const applied = await this.applyNodeRedAccounts(app.subdomain, appId);
        return { user, applied };
    }
    async updateNodeRedUser(userId, organizationId, appId, nodeRedUserId, dto) {
        const app = await this.findNodeRedApp(organizationId, appId);
        const record = await this.prisma.nodeRedUser.findFirst({
            where: { id: nodeRedUserId, appId },
        });
        if (!record) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
        }
        const data = {};
        if (dto.password !== undefined) {
            data.passwordHash = (0, nodered_1.hashNodeRedPassword)(dto.password);
        }
        if (dto.permission !== undefined)
            data.permission = dto.permission;
        const user = await this.prisma.nodeRedUser.update({
            where: { id: record.id },
            data,
            select: { id: true, username: true, permission: true, createdAt: true },
        });
        if (dto.password !== undefined && record.username === 'admin') {
            await this.prisma.app.update({
                where: { id: appId },
                data: { noderedAdminPasswordEnc: (0, encrypt_util_1.encrypt)(dto.password) },
            });
        }
        await this.auditService.log({
            actorUserId: userId,
            action: 'nodered.user.update',
            target: appId,
            metadata: { username: user.username, fields: Object.keys(data) },
        });
        const applied = await this.applyNodeRedAccounts(app.subdomain, appId);
        return { user, applied };
    }
    async removeNodeRedUser(userId, organizationId, appId, nodeRedUserId) {
        const app = await this.findNodeRedApp(organizationId, appId);
        const record = await this.prisma.nodeRedUser.findFirst({
            where: { id: nodeRedUserId, appId },
        });
        if (!record) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Account not found' });
        }
        const count = await this.prisma.nodeRedUser.count({ where: { appId } });
        if (count <= 1) {
            throw new common_1.BadRequestException({
                code: 'LAST_USER',
                message: 'Cannot remove the last account — at least one editor account is required',
            });
        }
        await this.prisma.nodeRedUser.delete({ where: { id: record.id } });
        await this.auditService.log({
            actorUserId: userId,
            action: 'nodered.user.remove',
            target: appId,
            metadata: { username: record.username },
        });
        const applied = await this.applyNodeRedAccounts(app.subdomain, appId);
        return { ok: true, applied };
    }
    async applyNodeRedAccounts(subdomain, appId) {
        const users = await this.prisma.nodeRedUser.findMany({
            where: { appId },
            orderBy: { createdAt: 'asc' },
            select: { username: true, passwordHash: true, permission: true },
        });
        const settings = (0, nodered_1.renderNodeRedSettings)(users);
        try {
            const docker = new Docker({ socketPath: '/var/run/docker.sock' });
            const containerName = `upande-${subdomain}`;
            try {
                await docker.getContainer(containerName).inspect();
            }
            catch {
                return { restarted: false };
            }
            await this.writeNodeRedSettings(docker, (0, nodered_1.noderedVolumeName)(subdomain), settings);
            await docker.getContainer(containerName).restart({ t: 5 });
            return { restarted: true };
        }
        catch (err) {
            console.warn(`[apps] applying Node-RED accounts for ${subdomain} failed:`, err instanceof Error ? err.message : err);
            return { restarted: false };
        }
    }
    async writeNodeRedSettings(docker, volumeName, settings) {
        await this.ensureImage(docker, 'busybox:1.36');
        const b64 = Buffer.from(settings, 'utf8').toString('base64');
        const script = `echo ${b64} | base64 -d > ${nodered_1.NODERED_DATA_DIR}/settings.js && ` +
            `chown -R ${nodered_1.NODERED_UID}:${nodered_1.NODERED_GID} ${nodered_1.NODERED_DATA_DIR}`;
        const container = await docker.createContainer({
            Image: 'busybox:1.36',
            Cmd: ['sh', '-c', script],
            HostConfig: {
                Binds: [`${volumeName}:${nodered_1.NODERED_DATA_DIR}`],
                AutoRemove: true,
            },
        });
        await container.start();
        await container.wait();
    }
    async uploadSource(userId, organizationId, appId, files) {
        const app = await this.findAppForOrg(appId, organizationId);
        if (app.source !== 'upload') {
            throw new common_1.BadRequestException({
                code: 'NOT_UPLOAD_APP',
                message: 'This app is not configured for uploads',
            });
        }
        if (files.length === 0) {
            throw new common_1.BadRequestException({
                code: 'NO_FILES',
                message: 'No files were uploaded',
            });
        }
        const dir = (0, upload_path_util_1.appUploadDir)(appId);
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        const commonPrefix = stripCommonTopDir(files.map((f) => f.relPath));
        let written = 0;
        for (const file of files) {
            const safeRel = sanitizeRelPath(commonPrefix ? file.relPath.slice(commonPrefix.length) : file.relPath);
            if (!safeRel)
                continue;
            const dest = path.join(dir, safeRel);
            if (!dest.startsWith(dir + path.sep))
                continue;
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.writeFileSync(dest, file.buffer);
            written += 1;
        }
        await this.auditService.log({
            actorUserId: userId,
            action: 'app.upload',
            target: appId,
            metadata: { files: written },
        });
        return { ok: true, files: written };
    }
    async updateApp(userId, organizationId, appId, dto) {
        const current = await this.findAppForOrg(appId, organizationId);
        const data = {};
        if (dto.healthCheckPath !== undefined)
            data.healthCheckPath = dto.healthCheckPath || null;
        if (dto.healthCheckTimeout !== undefined)
            data.healthCheckTimeout = dto.healthCheckTimeout;
        if (dto.healthCheckRetries !== undefined)
            data.healthCheckRetries = dto.healthCheckRetries;
        if (dto.githubCommitStatus !== undefined)
            data.githubCommitStatus = dto.githubCommitStatus;
        if (dto.githubPrComments !== undefined)
            data.githubPrComments = dto.githubPrComments;
        if (dto.type !== undefined && dto.type !== current.type) {
            if (current.type === 'nodered') {
                throw new common_1.BadRequestException({
                    code: 'TYPE_CHANGE_UNSUPPORTED',
                    message: "Node-RED apps can't be switched to another type.",
                });
            }
            if (current.status === 'building') {
                throw new common_1.ConflictException({
                    code: 'APP_BUILDING',
                    message: 'Wait for the current build to finish before changing the app type.',
                });
            }
            data.type = dto.type;
        }
        if (dto.name !== undefined)
            data.name = dto.name;
        if (dto.repoUrl !== undefined)
            data.repoUrl = dto.repoUrl || null;
        if (dto.branch !== undefined)
            data.branch = dto.branch || undefined;
        if (dto.buildCmd !== undefined)
            data.buildCmd = dto.buildCmd || null;
        if (dto.outputDir !== undefined)
            data.outputDir = dto.outputDir || null;
        const app = await this.prisma.app.update({
            where: { id: appId },
            data,
        });
        await this.auditService.log({
            actorUserId: userId,
            action: 'app.update',
            target: appId,
            metadata: {
                fields: Object.keys(data),
                ...(data.type ? { typeFrom: current.type, typeTo: data.type } : {}),
            },
        });
        return { app, redeployRequired: !!data.type };
    }
    async getBuildCache(organizationId, appId) {
        await this.findAppForOrg(appId, organizationId);
        const u = await this.buildCache.usageForApp(appId);
        return { buildkit: u.buildkit, sizeBytes: u.totalBytes, entries: u.entries };
    }
    async deleteApp(userId, organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        await this.deployService.cancelForApp(appId).catch(() => 0);
        await this.stopContainer(app.subdomain);
        await this.stopContainer(`${app.subdomain}-candidate`);
        await this.previews.removeAllForApp(appId);
        await this.removeAppImages(app.subdomain);
        await this.buildCache.clearForApp(appId);
        if (app.type === 'nodered' && app.noderedVolumeName) {
            await this.removeVolume(app.noderedVolumeName);
        }
        fs.rmSync((0, upload_path_util_1.appUploadDir)(appId), { recursive: true, force: true });
        try {
            await this.dbProvision.dropForApp(appId);
        }
        catch (err) {
            new common_1.Logger(AppsService_1.name).warn(`dropping database of app ${appId} failed: ${String(err)}`);
        }
        await this.prisma.$transaction([
            this.prisma.deployToken.deleteMany({ where: { appId } }),
            this.prisma.envVar.deleteMany({ where: { appId } }),
            this.prisma.deployment.deleteMany({ where: { appId } }),
            this.prisma.app.delete({ where: { id: appId } }),
        ]);
        await this.auditService.log({
            actorUserId: userId,
            action: 'app.delete',
            target: appId,
            metadata: { name: app.name },
        });
        return { ok: true, githubRepoFullName: app.githubRepoFullName, githubWebhookId: app.githubWebhookId };
    }
    async attachWebhook(appId, organizationId, repoFullName, webhookId, webhookSecret) {
        await this.findAppForOrg(appId, organizationId);
        return this.prisma.app.update({
            where: { id: appId },
            data: {
                githubRepoFullName: repoFullName,
                githubWebhookId: webhookId,
                webhookSecret,
            },
        });
    }
    async deploy(userId, organizationId, appId, dto) {
        const app = await this.findAppForOrg(appId, organizationId);
        if (dto.clearCache)
            dto = { ...dto, forceClean: true };
        const deployment = await this.prisma.deployment.create({
            data: {
                appId,
                ref: dto.ref ?? app.branch ?? 'main',
                status: 'queued',
                trigger: 'user',
                triggeredByUserId: userId ?? null,
                forceClean: dto.forceClean === true,
                triggerDetail: dto.clearCache ? 'clear-cache' : dto.forceClean ? 'migrate' : null,
            },
        });
        await this.prisma.app.update({
            where: { id: appId },
            data: { status: 'building' },
        });
        await this.deployService.enqueue({
            deploymentId: deployment.id,
            appId,
            ref: dto.ref,
            forceClean: dto.forceClean,
            clearCache: dto.clearCache === true,
        });
        await this.auditService.log({
            actorUserId: userId ?? undefined,
            action: dto.clearCache ? 'app.deploy.clear_cache' : dto.forceClean ? 'app.migrate' : 'app.deploy',
            target: appId,
            metadata: { deploymentId: deployment.id, ref: dto.ref, forceClean: dto.forceClean },
        });
        return { deployment };
    }
    async migrate(userId, organizationId, appId, dto) {
        return this.deploy(userId, organizationId, appId, { ...dto, forceClean: true });
    }
    async deployByToken(appId, dto, source = { trigger: 'api_token' }) {
        const app = await this.prisma.app.findUnique({ where: { id: appId } });
        if (!app) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
        }
        let triggerDetail = source.detail ?? null;
        if (source.trigger === 'api_token' && source.deployTokenId && !triggerDetail) {
            const token = await this.prisma.deployToken.findUnique({
                where: { id: source.deployTokenId },
                select: { name: true },
            });
            triggerDetail = token ? `token "${token.name}"` : null;
        }
        const deployment = await this.prisma.deployment.create({
            data: {
                appId,
                ref: dto.ref ?? app.branch ?? 'main',
                status: 'queued',
                trigger: source.trigger,
                deployTokenId: source.deployTokenId ?? null,
                triggerDetail,
                commitSha: source.commitSha ?? null,
                commitMessage: source.commitMessage?.slice(0, 500) ?? null,
                forceClean: dto.forceClean === true,
            },
        });
        await this.prisma.app.update({
            where: { id: appId },
            data: { status: 'building' },
        });
        await this.deployService.enqueue({
            deploymentId: deployment.id,
            appId,
            ref: dto.ref,
            forceClean: dto.forceClean,
        });
        await this.auditService.log({
            action: source.trigger === 'webhook' ? 'app.deploy.webhook' : 'app.deploy.token',
            target: appId,
            metadata: {
                deploymentId: deployment.id,
                ref: deployment.ref,
                deployTokenId: source.deployTokenId,
                commitSha: source.commitSha,
            },
        });
        return { deployment };
    }
    async listDeployments(organizationId, appId, opts = {}) {
        const app = await this.findAppForOrg(appId, organizationId);
        const take = Math.min(Math.max(Number(opts.take) || 30, 1), 100);
        const [rows, images, current] = await Promise.all([
            this.prisma.deployment.findMany({
                where: { appId, previewId: null },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: take + 1,
                ...(opts.before ? { cursor: { id: opts.before }, skip: 1 } : {}),
                include: {
                    triggeredBy: { select: { id: true, username: true, email: true } },
                    log: { select: { lineCount: true, truncated: true } },
                    rollbackOf: { select: { id: true, commitSha: true } },
                },
            }),
            this.localImageTags(app.subdomain),
            this.prisma.deployment.findFirst({
                where: { appId, status: 'live', previewId: null },
                orderBy: { createdAt: 'desc' },
                select: { id: true },
            }),
        ]);
        const hasMore = rows.length > take;
        const page = rows.slice(0, take);
        return {
            deployments: page.map((d) => {
                const imageAvailable = !!d.imageRef && images.has(d.imageRef);
                return {
                    ...this.deploymentView(d),
                    rollbackOf: d.rollbackOf
                        ? { id: d.rollbackOf.id, commitSha: d.rollbackOf.commitSha }
                        : null,
                    isCurrent: d.id === current?.id,
                    imageAvailable,
                    canRollback: d.status === 'live' &&
                        app.type !== 'nodered' &&
                        (imageAvailable || (app.source === 'git' && !!d.commitSha)),
                };
            }),
            nextCursor: hasMore ? page[page.length - 1].id : null,
        };
    }
    async localImageTags(subdomain) {
        try {
            const docker = new Docker({ socketPath: '/var/run/docker.sock' });
            const repo = `upande-app-${subdomain}`;
            const images = await docker.listImages({ filters: { reference: [`${repo}:*`] } });
            return new Set(images.flatMap((i) => i.RepoTags ?? []));
        }
        catch {
            return new Set();
        }
    }
    async rollback(userId, organizationId, appId, deploymentId) {
        const app = await this.findAppForOrg(appId, organizationId);
        if (app.type === 'nodered') {
            throw new common_1.BadRequestException({
                code: 'ROLLBACK_UNSUPPORTED',
                message: 'Node-RED apps run the official image — use Deploy instead of a rollback.',
            });
        }
        if (app.status === 'building') {
            throw new common_1.ConflictException({
                code: 'DEPLOY_IN_PROGRESS',
                message: 'A deployment is already in progress. Wait for it to finish (or cancel it) first.',
            });
        }
        const source = await this.prisma.deployment.findFirst({
            where: { id: deploymentId, appId, previewId: null },
        });
        if (!source) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Deployment not found' });
        }
        if (source.status !== 'live') {
            throw new common_1.BadRequestException({
                code: 'ROLLBACK_NOT_SUCCESSFUL',
                message: 'Only a previously successful deployment can be redeployed.',
            });
        }
        const images = await this.localImageTags(app.subdomain);
        const imageAvailable = !!source.imageRef && images.has(source.imageRef);
        if (!imageAvailable && !(app.source === 'git' && source.commitSha)) {
            throw new common_1.BadRequestException({
                code: 'ROLLBACK_UNAVAILABLE',
                message: app.source === 'upload'
                    ? "That version's image has been pruned and uploaded sources aren't versioned, so it can't be redeployed."
                    : "That version's image has been pruned and its commit wasn't recorded, so it can't be rebuilt exactly.",
            });
        }
        const deployment = await this.prisma.deployment.create({
            data: {
                appId,
                ref: source.ref,
                status: 'queued',
                trigger: 'rollback',
                triggeredByUserId: userId,
                rollbackOfId: source.id,
                commitSha: source.commitSha,
                commitMessage: source.commitMessage,
                triggerDetail: `redeploy of ${source.id.slice(0, 8)}${imageAvailable ? '' : ' (rebuild)'}`,
            },
        });
        await this.prisma.app.update({ where: { id: appId }, data: { status: 'building' } });
        await this.deployService.enqueue({
            deploymentId: deployment.id,
            appId,
            ref: source.ref ?? undefined,
            rollbackImage: source.imageRef ?? undefined,
            commitSha: source.commitSha ?? undefined,
        });
        await this.auditService.log({
            actorUserId: userId,
            action: 'app.rollback',
            target: appId,
            metadata: {
                deploymentId: deployment.id,
                rollbackOfId: source.id,
                commitSha: source.commitSha,
                reuseImage: imageAvailable,
            },
        });
        return { deployment, reuseImage: imageAvailable };
    }
    deploymentView(d) {
        return {
            id: d.id,
            appId: d.appId,
            ref: d.ref,
            branch: d.ref,
            status: d.status,
            imageRef: d.imageRef,
            createdAt: d.createdAt,
            trigger: d.trigger,
            triggerDetail: d.triggerDetail,
            deployTokenId: d.deployTokenId,
            triggeredBy: d.triggeredBy
                ? { id: d.triggeredBy.id, username: d.triggeredBy.username, email: d.triggeredBy.email }
                : null,
            commitSha: d.commitSha,
            commitMessage: d.commitMessage,
            forceClean: d.forceClean,
            startedAt: d.startedAt,
            finishedAt: d.finishedAt,
            durationMs: d.startedAt && d.finishedAt ? d.finishedAt.getTime() - d.startedAt.getTime() : null,
            errorReason: d.errorReason,
            logPersisted: !!d.log,
            logTruncated: d.log?.truncated ?? false,
        };
    }
    streamLogs(organizationId, appId) {
        const subject = new rxjs_1.Subject();
        (async () => {
            try {
                await this.findAppForOrg(appId, organizationId);
                const latest = await this.prisma.deployment.findFirst({
                    where: { appId, previewId: null },
                    orderBy: { createdAt: 'desc' },
                });
                if (!latest) {
                    subject.next({ data: 'No deployments found for this app' });
                    subject.next({ data: '@end' });
                    subject.complete();
                    return;
                }
                const terminal = (s) => s === 'live' || s === 'failed' || s === 'stopped';
                let cursor = 0;
                const flushNew = async () => {
                    const lines = await this.logStore.getFrom(latest.id, cursor);
                    for (const line of lines) {
                        subject.next({ data: line });
                    }
                    cursor += lines.length;
                };
                await flushNew();
                let status = latest.status;
                const startedAt = Date.now();
                const MAX_MS = 15 * 60 * 1000;
                while (!terminal(status) && Date.now() - startedAt < MAX_MS) {
                    await new Promise((r) => setTimeout(r, 500));
                    await flushNew();
                    const fresh = await this.prisma.deployment.findUnique({
                        where: { id: latest.id },
                        select: { status: true },
                    });
                    status = fresh?.status ?? status;
                }
                await flushNew();
                subject.next({ data: '@end' });
                subject.complete();
            }
            catch (err) {
                subject.error(err);
            }
        })();
        return subject.asObservable();
    }
    async getDeploymentLog(organizationId, appId, deploymentId) {
        await this.findAppForOrg(appId, organizationId);
        const deployment = await this.prisma.deployment.findFirst({
            where: { id: deploymentId, appId },
            select: { status: true, ref: true, createdAt: true },
        });
        if (!deployment) {
            throw new common_1.NotFoundException('Deployment not found');
        }
        const lines = await this.logStore.getAll(deploymentId);
        return {
            status: deployment.status,
            ref: deployment.ref,
            createdAt: deployment.createdAt,
            lines,
        };
    }
    async stopApp(userId, organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        await this.stopContainer(app.subdomain);
        const updated = await this.prisma.app.update({
            where: { id: appId },
            data: { status: 'stopped' },
        });
        await this.auditService.log({
            actorUserId: userId,
            action: 'app.stop',
            target: appId,
        });
        return { app: updated };
    }
    async cancelApp(userId, organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        const removed = await this.deployService.cancelForApp(appId);
        await this.stopContainer(`${app.subdomain}-candidate`);
        await this.stopContainer(`${app.subdomain}-next`);
        const building = await this.prisma.deployment.findFirst({
            where: { appId, status: { in: ['building', 'queued'] }, previewId: null },
            orderBy: { createdAt: 'desc' },
        });
        if (building) {
            await this.prisma.deployment.update({
                where: { id: building.id },
                data: { status: 'failed' },
            });
            await this.logStore.append(building.id, '@fail Build|Cancelled by user');
            await this.prisma.deployment.update({
                where: { id: building.id },
                data: { finishedAt: new Date(), errorReason: 'Cancelled by user' },
            });
            await this.logStore.persist(building.id);
        }
        const serving = await new Docker({ socketPath: '/var/run/docker.sock' })
            .getContainer(`upande-${app.subdomain}`)
            .inspect()
            .then((i) => !!i.State?.Running)
            .catch(() => false);
        const updated = await this.prisma.app.update({
            where: { id: appId },
            data: { status: serving ? 'live' : 'stopped' },
        });
        await this.auditService.log({
            actorUserId: userId,
            action: 'app.cancel',
            target: appId,
            metadata: { subdomain: app.subdomain, jobsRemoved: removed },
        });
        return { app: updated };
    }
    async restartApp(userId, organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        const docker = new Docker({ socketPath: '/var/run/docker.sock' });
        const containerName = `upande-${app.subdomain}`;
        try {
            await docker.getContainer(containerName).inspect();
        }
        catch {
            throw new common_1.BadRequestException({
                code: 'NOT_RUNNING',
                message: 'No running instance to restart — deploy the app first.',
            });
        }
        await docker.getContainer(containerName).restart({ t: 5 });
        await this.auditService.log({
            actorUserId: userId,
            action: 'app.restart',
            target: appId,
            metadata: { subdomain: app.subdomain },
        });
        return { ok: true };
    }
    async getContainerStatus(organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        const docker = new Docker({ socketPath: '/var/run/docker.sock' });
        let info;
        try {
            info = await docker.getContainer(`upande-${app.subdomain}`).inspect();
        }
        catch {
            return { exists: false };
        }
        const st = info.State;
        const image = info.Config?.Image ?? '';
        const crashed = st.Restarting || (!st.Running && st.Status !== 'created' && st.ExitCode !== 0);
        const policy = info.HostConfig?.RestartPolicy;
        const maxRetries = policy?.Name === 'on-failure' && policy.MaximumRetryCount ? policy.MaximumRetryCount : null;
        const restartsExhausted = crashed && !st.Running && !st.Restarting && maxRetries !== null &&
            (info.RestartCount ?? 0) >= maxRetries;
        return {
            exists: true,
            state: st.Status,
            running: st.Running,
            restarting: st.Restarting,
            crashed,
            restartCount: info.RestartCount ?? 0,
            exitCode: st.ExitCode,
            oomKilled: st.OOMKilled,
            error: st.Error || null,
            startedAt: st.StartedAt,
            finishedAt: st.FinishedAt && !st.FinishedAt.startsWith('0001') ? st.FinishedAt : null,
            restartPolicy: policy?.Name
                ? `${policy.Name}${maxRetries !== null ? `:${maxRetries}` : ''}`
                : null,
            maxRetries,
            restartsExhausted,
            placeholder: !image.startsWith('upande-app-') && image !== nodered_1.NODERED_IMAGE,
        };
    }
    async getRuntimeLogs(organizationId, appId, tail = 200) {
        const app = await this.findAppForOrg(appId, organizationId);
        const docker = new Docker({ socketPath: '/var/run/docker.sock' });
        const container = docker.getContainer(`upande-${app.subdomain}`);
        try {
            await container.inspect();
        }
        catch {
            return { running: false, lines: [] };
        }
        const safeTail = Math.min(Math.max(Math.floor(tail) || 0, 1), 1000);
        const buf = (await container.logs({
            stdout: true,
            stderr: true,
            follow: false,
            tail: safeTail,
            timestamps: false,
        }));
        const text = buf
            .toString('utf8')
            .replace(/[\x00-\x08]/g, '')
            .replace(/[\x0e-\x1f]/g, '');
        const lines = text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
        return { running: true, lines };
    }
    async createToken(userId, organizationId, appId, dto) {
        await this.findAppForOrg(appId, organizationId);
        const plainToken = crypto.randomBytes(32).toString('hex');
        const hashedToken = await bcrypt.hash(plainToken, 10);
        const deployToken = await this.prisma.deployToken.create({
            data: {
                appId,
                name: dto.name,
                hashedToken,
            },
        });
        await this.auditService.log({
            actorUserId: userId,
            action: 'token.create',
            target: appId,
            metadata: { tokenId: deployToken.id, name: dto.name },
        });
        return {
            token: plainToken,
            id: deployToken.id,
            name: deployToken.name,
        };
    }
    async listTokens(userId, organizationId, appId) {
        await this.findAppForOrg(appId, organizationId);
        const tokens = await this.prisma.deployToken.findMany({
            where: { appId },
            select: { id: true, name: true, lastUsedAt: true },
            orderBy: { name: 'asc' },
        });
        return { tokens };
    }
    async listDomains(organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        const domains = await this.prisma.customDomain.findMany({
            where: { appId },
            orderBy: { createdAt: 'asc' },
        });
        const ip = await this.network.primaryIp();
        const views = await Promise.all(domains.map(async (d) => this.domainView(d, app.subdomain, await this.hostedZoneFor(organizationId, d.domain), ip)));
        return { domains: views };
    }
    async addDomain(userId, organizationId, appId, dto) {
        const app = await this.findAppForOrg(appId, organizationId);
        const domain = dto.domain.trim().toLowerCase().replace(/\.$/, '');
        const existing = await this.prisma.customDomain.findUnique({ where: { domain } });
        if (existing) {
            throw new common_1.ConflictException({
                code: 'DOMAIN_TAKEN',
                message: 'That domain is already attached to an app.',
            });
        }
        const created = await this.prisma.customDomain.create({
            data: {
                appId,
                domain,
                status: 'pending',
                verifyToken: `upande-verify=${crypto.randomBytes(16).toString('hex')}`,
            },
        });
        await this.auditService.log({
            actorUserId: userId,
            action: 'domain.add',
            target: appId,
            metadata: { domain },
        });
        const zone = await this.hostedZoneFor(organizationId, domain);
        if (zone) {
            const result = await this.checkDomain(userId, app.subdomain, created, zone);
            return { domain: result.view, verified: result.verified, message: result.message };
        }
        return { domain: this.domainView(created, app.subdomain, null, await this.network.primaryIp()) };
    }
    async verifyDomain(userId, organizationId, appId, domainId) {
        const app = await this.findAppForOrg(appId, organizationId);
        const record = await this.prisma.customDomain.findFirst({
            where: { id: domainId, appId },
        });
        if (!record) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
        }
        const zone = await this.hostedZoneFor(organizationId, record.domain);
        const result = await this.checkDomain(userId, app.subdomain, record, zone);
        await this.auditService.log({
            actorUserId: userId,
            action: 'domain.verify',
            target: appId,
            metadata: {
                domain: record.domain,
                verified: result.verified,
                method: zone ? 'platform-dns' : 'txt',
            },
        });
        return { domain: result.view, verified: result.verified, message: result.message };
    }
    async removeDomain(userId, organizationId, appId, domainId) {
        await this.findAppForOrg(appId, organizationId);
        const record = await this.prisma.customDomain.findFirst({
            where: { id: domainId, appId },
        });
        if (!record) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
        }
        let recordRemoved = false;
        let recordError = null;
        if (record.dnsZoneName && record.autoRecordType && record.autoRecordValue) {
            try {
                recordRemoved = await this.dnsService.removeRoutingRecord(userId, record.dnsZoneName, record.domain, record.autoRecordType, record.autoRecordValue);
            }
            catch (err) {
                recordError = err instanceof Error ? err.message : String(err);
            }
        }
        await this.prisma.customDomain.delete({ where: { id: record.id } });
        this.statusCache.delete(record.id);
        await this.auditService.log({
            actorUserId: userId,
            action: 'domain.remove',
            target: appId,
            metadata: { domain: record.domain, recordRemoved },
        });
        return {
            ok: true,
            recordRemoved,
            ...(recordError
                ? {
                    message: `Domain removed, but its DNS record in ${record.dnsZoneName} could not be deleted (${recordError}). Remove the ${record.autoRecordType} record for ${record.domain} manually.`,
                }
                : {}),
        };
    }
    async setDomainTarget(userId, organizationId, appId, domainId, dto) {
        const app = await this.findAppForOrg(appId, organizationId);
        const record = await this.prisma.customDomain.findFirst({
            where: { id: domainId, appId },
        });
        if (!record) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
        }
        const zone = await this.hostedZoneFor(organizationId, record.domain);
        if (!zone) {
            throw new common_1.BadRequestException({
                code: 'NOT_HOSTED',
                message: `${record.domain} isn't in a DNS zone hosted on this platform by your organization, so its records can't be changed here. Update them at your DNS provider.`,
            });
        }
        const ip = await this.network.primaryIp();
        const ttl = dto.ttl ?? 300;
        let desired;
        if (dto.mode === 'platform') {
            const t = (0, custom_domain_util_1.routeTarget)(record.domain, app.subdomain, zone.name, ip);
            if (!t.value) {
                throw new common_1.BadRequestException({
                    code: 'NO_PLATFORM_TARGET',
                    message: t.note ?? "The platform target isn't configured.",
                });
            }
            desired = { type: t.type, values: [t.value], ttl };
        }
        else {
            const type = dto.type === 'AAAA' ? 'AAAA' : 'A';
            const family = type === 'A' ? 4 : 6;
            const seen = new Set();
            const values = [];
            for (const raw of dto.values ?? []) {
                const v = raw.trim();
                if (!v)
                    continue;
                if ((0, net_1.isIP)(v) !== family) {
                    throw new common_1.BadRequestException({
                        code: 'INVALID_IP',
                        message: `"${v}" is not a valid ${family === 4 ? 'IPv4' : 'IPv6'} address (${type} record).`,
                    });
                }
                const key = (0, custom_domain_util_1.recordKey)(type, v);
                if (seen.has(key))
                    continue;
                seen.add(key);
                values.push(v);
            }
            if (!values.length) {
                throw new common_1.BadRequestException({
                    code: 'INVALID_IP',
                    message: `Enter at least one ${family === 4 ? 'IPv4' : 'IPv6'} address.`,
                });
            }
            desired = { type, values, ttl };
        }
        const managed = record.dnsZoneName === zone.name && record.autoRecordType && record.autoRecordValue
            ? { type: record.autoRecordType, values: (0, custom_domain_util_1.splitManagedValues)(record.autoRecordValue) }
            : null;
        const res = await this.dnsService.setRoutingRecord(userId, zone.name, record.domain, desired, managed, dto.confirmReplace === true);
        const desc = `${desired.type} ${record.domain} -> ${desired.values.join(', ')} (TTL ${ttl}s)`;
        if (res.status === 'confirm_required') {
            return {
                ok: false,
                confirmRequired: true,
                existing: res.unmanaged,
                message: `${record.domain} already has ${describeRRSets(res.unmanaged)} in ${zone.name}, which the platform didn't create. Confirm to replace it with ${desc}.`,
            };
        }
        const updated = await this.prisma.customDomain.update({
            where: { id: record.id },
            data: {
                dnsZoneName: zone.name,
                autoRecordType: res.managedAfter ? desired.type : null,
                autoRecordValue: res.managedAfter ? desired.values.join(',') : null,
                lastCheck: client_1.Prisma.DbNull,
                status: 'verified',
                verifiedAt: record.verifiedAt ?? new Date(),
            },
        });
        this.statusCache.delete(record.id);
        await this.auditService.log({
            actorUserId: userId,
            action: 'domain.target.update',
            target: appId,
            metadata: {
                domain: record.domain,
                zone: zone.name,
                mode: dto.mode,
                type: desired.type,
                values: desired.values,
                ttl,
                result: res.status,
                replaced: res.replaced,
                replacedUnmanaged: res.unmanaged.length > 0,
            },
        });
        const message = res.status === 'unchanged'
            ? `${desc} is already set in ${zone.name}.`
            : `Set ${desc} in ${zone.name}.` +
                (res.replaced.length ? ` Replaced ${describeRRSets(res.replaced)}.` : '') +
                ' Public DNS may take up to the old TTL to pick this up.';
        return {
            ok: true,
            message,
            domain: this.domainView(updated, app.subdomain, zone, ip),
        };
    }
    async domainStatus(organizationId, appId, domainId, refresh = false) {
        const app = await this.findAppForOrg(appId, organizationId);
        const record = await this.prisma.customDomain.findFirst({
            where: { id: domainId, appId },
        });
        if (!record) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Domain not found' });
        }
        const cached = this.statusCache.get(record.id);
        const maxAge = refresh ? AppsService_1.STATUS_MIN_REFRESH_MS : AppsService_1.STATUS_TTL_MS;
        if (cached && Date.now() - cached.at < maxAge)
            return { ...cached.value, cached: true };
        const ip = await this.network.primaryIp();
        const zone = await this.hostedZoneFor(organizationId, record.domain);
        const expected = (0, custom_domain_util_1.routeTarget)(record.domain, app.subdomain, zone?.name, ip);
        const [a, aaaa, cname] = await Promise.all([
            (0, custom_domain_util_1.resolvePublic)('A', record.domain),
            (0, custom_domain_util_1.resolvePublic)('AAAA', record.domain),
            (0, custom_domain_util_1.resolvePublic)('CNAME', record.domain),
        ]);
        const pub = {
            a: a.values,
            aaaa: aaaa.values,
            cname: cname.values,
            error: a.values.length || aaaa.values.length || cname.values.length
                ? null
                : (a.error ?? cname.error ?? 'no records'),
        };
        const pubFound = [
            ...pub.cname.map((v) => `CNAME ${v}`),
            ...pub.a.map((v) => `A ${v}`),
            ...pub.aaaa.map((v) => `AAAA ${v}`),
        ];
        const pubText = pubFound.join(', ');
        const pointsAtPlatform = (!!ip && (pub.a.includes(ip) || pub.aaaa.some((v) => (0, custom_domain_util_1.recordKey)('AAAA', v) === (0, custom_domain_util_1.recordKey)('AAAA', ip)))) ||
            (expected.type === 'CNAME' && !!expected.value && pub.cname.some((v) => (0, custom_domain_util_1.sameHost)(v, expected.value)));
        let platform = null;
        let delegation = null;
        let targetMode = 'none';
        let state;
        let message;
        if (zone) {
            const managed = record.dnsZoneName === zone.name && record.autoRecordType && record.autoRecordValue
                ? { type: record.autoRecordType, values: (0, custom_domain_util_1.splitManagedValues)(record.autoRecordValue) }
                : null;
            try {
                const rr = await this.dnsService.getRoutingRecords(zone.name, record.domain);
                platform = {
                    zone: zone.name,
                    rrsets: rr.rrsets.map((r) => ({
                        ...r,
                        managed: !!managed &&
                            r.type === managed.type &&
                            r.records.length > 0 &&
                            r.records.every((c) => managed.values.some((m) => (0, custom_domain_util_1.recordKey)(r.type, m) === (0, custom_domain_util_1.recordKey)(r.type, c))),
                    })),
                    error: null,
                };
            }
            catch (err) {
                platform = { zone: zone.name, rrsets: [], error: err instanceof Error ? err.message : String(err) };
            }
            delegation = await this.checkDelegation(zone.name);
            const rrsets = platform.rrsets;
            if (rrsets.length === 1 && expected.value && rrsets[0].type === expected.type &&
                (0, custom_domain_util_1.sameValueSet)(expected.type, rrsets[0].records, [expected.value])) {
                targetMode = 'platform';
            }
            else if (rrsets.length && rrsets.every((r) => r.type === 'A' || r.type === 'AAAA')) {
                targetMode = 'custom';
            }
            else if (rrsets.length) {
                targetMode = 'other';
            }
            const platformText = describeRRSets(rrsets);
            const publicMatches = rrsets.length > 0 &&
                rrsets.every((r) => r.type === 'CNAME'
                    ? pub.cname.some((v) => r.records.some((c) => (0, custom_domain_util_1.sameHost)(v, c)))
                    : (0, custom_domain_util_1.sameValueSet)(r.type, r.type === 'A' ? pub.a : pub.aaaa, r.records));
            if (platform.error) {
                state = 'error';
                message = `Could not read ${zone.name} from the platform DNS: ${platform.error}`;
            }
            else if (!rrsets.length) {
                state = 'no_record';
                message = `No A, AAAA or CNAME record for ${record.domain} in the ${zone.name} zone yet. Choose a target below to create one.`;
            }
            else if (!delegation.ok) {
                state = 'not_delegated';
                message = `Platform record set (${platformText}), but ${zone.name} is not delegated to the platform (current nameservers: ${delegation.found.length ? delegation.found.join(', ') : 'unknown'}). Set the nameservers at your registrar to ${delegation.expected.join(', ')}.`;
            }
            else if (publicMatches) {
                state = 'live';
                message = `Live: public DNS returns ${pubText}, matching the platform record.`;
            }
            else if (pubFound.length) {
                state = 'points_elsewhere';
                message = `Points elsewhere (${pubText}); the platform record is ${platformText}. If you just changed it, resolvers may keep the old answer for up to its TTL.`;
            }
            else {
                state = 'not_resolving';
                message = `${record.domain} doesn't resolve publicly yet (${pub.error}); the platform record is ${platformText}.`;
            }
        }
        else if (pointsAtPlatform) {
            state = 'live';
            message = `Live: public DNS returns ${pubText}, which points at this platform.`;
        }
        else if (pubFound.length) {
            state = 'points_elsewhere';
            message = `Points elsewhere (${pubText}); expected ${expected.type} ${expected.value ?? '(server IP not configured)'}.`;
        }
        else {
            state = 'not_resolving';
            message = `${record.domain} doesn't resolve publicly (${pub.error}).`;
        }
        const value = {
            domainId: record.id,
            domain: record.domain,
            checkedAt: new Date().toISOString(),
            cached: false,
            state,
            message,
            pointsAtPlatform,
            targetMode,
            serverIp: ip,
            expected: {
                type: expected.type,
                value: expected.value,
                apex: expected.apex,
                note: expected.note ?? null,
            },
            public: pub,
            platform,
            delegation: delegation
                ? { ok: delegation.ok, zone: delegation.zone, expected: delegation.expected, found: delegation.found }
                : null,
        };
        this.statusCache.set(record.id, { at: Date.now(), value });
        return value;
    }
    async managedRecordInPlace(record, zoneName) {
        if (record.dnsZoneName !== zoneName || !record.autoRecordType || !record.autoRecordValue) {
            return null;
        }
        const values = (0, custom_domain_util_1.splitManagedValues)(record.autoRecordValue);
        try {
            const rr = await this.dnsService.getRoutingRecords(zoneName, record.domain);
            const same = rr.rrsets.find((r) => r.type === record.autoRecordType);
            if (!same || !(0, custom_domain_util_1.sameValueSet)(same.type, same.records, values))
                return null;
        }
        catch {
            return null;
        }
        return {
            status: 'exists',
            type: record.autoRecordType,
            value: values.join(', '),
            message: `DNS record ${record.autoRecordType} ${record.domain} -> ${values.join(', ')} (managed by the platform) is in place in ${zoneName}.`,
        };
    }
    async hostedZoneFor(organizationId, domain) {
        const zone = await this.dnsService.findZoneForDomain(domain);
        return zone && zone.organizationId === organizationId ? zone : null;
    }
    async checkDomain(userId, appSubdomain, record, zone) {
        const ip = await this.network.primaryIp();
        const target = (0, custom_domain_util_1.routeTarget)(record.domain, appSubdomain, zone?.name, ip);
        const warnings = [];
        let verified;
        let ownership;
        let autoRecord;
        let delegation;
        const data = {};
        if (zone) {
            verified = true;
            ownership = {
                method: 'platform-dns',
                ok: true,
                zone: zone.name,
                message: `Ownership proven: ${zone.name} is a DNS zone hosted on this platform by your organization.`,
            };
            data.dnsZoneName = zone.name;
            autoRecord =
                (await this.managedRecordInPlace(record, zone.name)) ??
                    (await this.configureRoutingRecord(userId, record, zone.name, target));
            if (autoRecord.status === 'created') {
                data.autoRecordType = target.type;
                data.autoRecordValue = target.value;
            }
            if (autoRecord.status !== 'created' && autoRecord.status !== 'exists') {
                warnings.push(autoRecord.message);
            }
            delegation = await this.checkDelegation(zone.name);
            if (!delegation.ok)
                warnings.push(delegation.message);
        }
        else {
            if (record.dnsZoneName) {
                data.dnsZoneName = null;
                data.autoRecordType = null;
                data.autoRecordValue = null;
            }
            const host = `_upande-challenge.${record.domain}`;
            const txt = await (0, custom_domain_util_1.resolvePublic)('TXT', host);
            verified = txt.values.some((v) => v.trim() === record.verifyToken);
            const foundText = txt.values.length
                ? `found ${txt.values.map((v) => `"${v}"`).join(', ')}`
                : `found nothing (${txt.error ?? 'no TXT records'})`;
            ownership = {
                method: 'txt',
                ok: verified,
                host,
                expected: record.verifyToken,
                found: txt.values,
                error: txt.error,
                message: verified
                    ? `Ownership proven: TXT ${host} contains the verify token.`
                    : `Queried TXT ${host}: ${foundText}. Expected "${record.verifyToken}". DNS changes can take a few minutes to propagate.`,
            };
        }
        const routing = await this.checkRouting(target, ip);
        if (!routing.ok)
            warnings.push(routing.message);
        const check = {
            checkedAt: new Date().toISOString(),
            ownership,
            routing,
            ...(autoRecord ? { autoRecord } : {}),
            ...(delegation ? { delegation } : {}),
            warnings,
        };
        const updated = await this.prisma.customDomain.update({
            where: { id: record.id },
            data: {
                ...data,
                lastCheck: check,
                ...(verified
                    ? { status: 'verified', verifiedAt: record.verifiedAt ?? new Date() }
                    : { status: 'failed' }),
            },
        });
        let message;
        if (verified) {
            const parts = [ownership.message];
            if (autoRecord)
                parts.push(autoRecord.message);
            parts.push('Redeploy the app for the domain to go live.');
            const rest = warnings.filter((w) => w !== autoRecord?.message);
            if (rest.length)
                parts.push(`Warning: ${rest.join(' ')}`);
            message = parts.join(' ');
        }
        else {
            message = `Verification failed. ${ownership.message}`;
        }
        this.statusCache.delete(record.id);
        return { verified, message, view: this.domainView(updated, appSubdomain, zone, ip) };
    }
    async configureRoutingRecord(userId, record, zoneName, target) {
        if (!target.value) {
            return {
                status: 'skipped',
                type: target.type,
                message: `No routing record was created: ${target.note ?? 'no target is configured.'}`,
            };
        }
        const desc = `${target.type} ${record.domain} -> ${target.value}`;
        try {
            const res = await this.dnsService.ensureRoutingRecord(userId, zoneName, record.domain, target.type, target.value);
            if (res.status === 'created') {
                return { status: 'created', type: target.type, value: target.value, message: `Created DNS record ${desc} in ${zoneName}.` };
            }
            if (res.status === 'exists') {
                return { status: 'exists', type: target.type, value: target.value, message: `DNS record ${desc} already exists in ${zoneName}.` };
            }
            const existing = (res.existing ?? [])
                .map((e) => `${e.type} ${e.records.join(', ')}`)
                .join('; ');
            return {
                status: 'conflict',
                type: target.type,
                value: target.value,
                existing: res.existing,
                message: `Did not create ${desc}: ${record.domain} already has ${existing} in ${zoneName}. Replace it with ${target.type} ${target.value} on the DNS page if you want this app to serve the domain.`,
            };
        }
        catch (err) {
            return {
                status: 'error',
                type: target.type,
                value: target.value,
                message: `Could not create ${desc} in ${zoneName}: ${err instanceof Error ? err.message : String(err)}`,
            };
        }
    }
    async checkRouting(target, ip) {
        const [a, cname] = await Promise.all([
            (0, custom_domain_util_1.resolvePublic)(ip && ip.includes(':') ? 'AAAA' : 'A', target.host),
            (0, custom_domain_util_1.resolvePublic)('CNAME', target.host),
        ]);
        const cnameOk = target.type === 'CNAME' && !!target.value && cname.values.some((v) => (0, custom_domain_util_1.sameHost)(v, target.value));
        const ipOk = !!ip && a.values.includes(ip);
        const ok = cnameOk || ipOk;
        const found = [
            ...cname.values.map((v) => `CNAME ${v}`),
            ...a.values.map((v) => `${ip && ip.includes(':') ? 'AAAA' : 'A'} ${v}`),
        ];
        const foundText = found.length ? found.join(', ') : `nothing (${a.error ?? 'no records'})`;
        let message;
        if (ok) {
            message = `${target.host} points at the platform (${foundText}).`;
        }
        else if (!target.value) {
            message = `${target.host} currently resolves to ${foundText}. Can't confirm it points at this platform because the routing target isn't configured (see the routing record note).`;
        }
        else {
            message = `${target.host} currently resolves to ${foundText}; expected ${target.type} ${target.value}. Traffic won't reach this app until it does.`;
        }
        return {
            ok,
            host: target.host,
            expectedType: target.type,
            expectedValue: target.value,
            foundA: a.values,
            foundCname: cname.values,
            error: a.error && cname.error ? a.error : null,
            message,
        };
    }
    async checkDelegation(zoneName) {
        const expected = this.dnsService.platformNameservers();
        const ns = await (0, custom_domain_util_1.resolvePublic)('NS', zoneName);
        const ok = ns.values.some((v) => expected.some((e) => (0, custom_domain_util_1.sameHost)(v, e)));
        return {
            ok,
            zone: zoneName,
            expected,
            found: ns.values,
            message: ok
                ? `${zoneName} is delegated to the platform nameservers.`
                : `${zoneName} is hosted here, but public DNS says its nameservers are ${ns.values.length ? ns.values.join(', ') : `unknown (${ns.error})`}. Set the nameservers at your registrar to ${expected.join(', ')} so the records on this platform take effect.`,
        };
    }
    domainView(d, appSubdomain, zone, serverIp) {
        const zoneName = d.dnsZoneName ?? zone?.name ?? null;
        const route = (0, custom_domain_util_1.routeTarget)(d.domain, appSubdomain, zoneName, serverIp);
        return {
            id: d.id,
            domain: d.domain,
            status: d.status,
            verifiedAt: d.verifiedAt,
            createdAt: d.createdAt,
            ownershipMethod: zoneName ? 'platform-dns' : 'txt',
            hostedZone: zoneName,
            autoConfigured: !!d.dnsZoneName,
            autoRecord: d.autoRecordType && d.autoRecordValue
                ? {
                    host: d.domain,
                    type: d.autoRecordType,
                    value: d.autoRecordValue,
                    values: (0, custom_domain_util_1.splitManagedValues)(d.autoRecordValue),
                }
                : null,
            serverIp,
            lastCheck: (d.lastCheck ?? null),
            instructions: {
                txtRecord: { host: `_upande-challenge.${d.domain}`, type: 'TXT', value: d.verifyToken },
                routeRecord: {
                    host: route.host,
                    type: route.type,
                    value: route.value,
                    apex: route.apex,
                    note: route.note ?? null,
                },
            },
        };
    }
    async findAppForOrg(appId, organizationId) {
        const app = await this.prisma.app.findUnique({
            where: { id: appId },
            include: { project: { select: { organizationId: true } } },
        });
        if (!app) {
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
        }
        if (app.project.organizationId !== organizationId) {
            throw new common_1.ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
        }
        return app;
    }
    async stopContainer(subdomain) {
        try {
            const docker = new Docker({ socketPath: '/var/run/docker.sock' });
            const container = docker.getContainer(`upande-${subdomain}`);
            await container.remove({ force: true });
        }
        catch {
        }
    }
    async removeVolume(volumeName) {
        try {
            const docker = new Docker({ socketPath: '/var/run/docker.sock' });
            await docker.getVolume(volumeName).remove({ force: true });
        }
        catch (err) {
            console.warn(`[apps] removing volume ${volumeName} failed:`, err instanceof Error ? err.message : err);
        }
    }
    async removeAppImages(subdomain) {
        try {
            const docker = new Docker({ socketPath: '/var/run/docker.sock' });
            const repo = `upande-app-${subdomain}`;
            const images = await docker.listImages({
                filters: { reference: [`${repo}:*`] },
            });
            for (const tag of images.flatMap((i) => i.RepoTags ?? [])) {
                if (!tag.startsWith(`${repo}:`))
                    continue;
                try {
                    await docker.getImage(tag).remove({ force: true });
                }
                catch (err) {
                    console.warn(`[apps] removing image ${tag} failed:`, err instanceof Error ? err.message : err);
                }
            }
        }
        catch (err) {
            console.warn(`[apps] listing images for ${subdomain} failed:`, err instanceof Error ? err.message : err);
        }
    }
    async startMaintenanceContainer(subdomain) {
        try {
            const docker = new Docker({ socketPath: '/var/run/docker.sock' });
            const containerName = `upande-${subdomain}`;
            try {
                await docker.getContainer(containerName).inspect();
                return;
            }
            catch {
            }
            await this.ensureImage(docker, maintenance_page_1.MAINTENANCE_IMAGE);
            const labels = (0, app_url_util_1.buildSubdomainRouterLabels)(subdomain, 8080);
            const networkMode = process.env.DOCKER_NETWORK ?? 'upande_net';
            const container = await docker.createContainer({
                Image: maintenance_page_1.MAINTENANCE_IMAGE,
                name: containerName,
                Labels: labels,
                Cmd: (0, maintenance_page_1.maintenanceContainerCmd)(),
                HostConfig: {
                    NetworkMode: networkMode,
                    RestartPolicy: { Name: 'unless-stopped' },
                },
            });
            await container.start();
        }
        catch (err) {
            console.warn(`[apps] maintenance container for ${subdomain} not started:`, err instanceof Error ? err.message : err);
        }
    }
    async ensureImage(docker, image) {
        try {
            await docker.getImage(image).inspect();
            return;
        }
        catch {
        }
        const stream = await docker.pull(image);
        await new Promise((resolve, reject) => {
            docker.modem.followProgress(stream, (err) => err ? reject(err) : resolve());
        });
    }
};
exports.AppsService = AppsService;
AppsService.STATUS_TTL_MS = 30_000;
AppsService.STATUS_MIN_REFRESH_MS = 5_000;
exports.AppsService = AppsService = AppsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        deploy_service_1.DeployService,
        log_store_service_1.LogStoreService,
        audit_service_1.AuditService,
        dns_service_1.DnsService,
        platform_network_service_1.PlatformNetworkService,
        previews_service_1.PreviewsService,
        build_cache_service_1.BuildCacheService,
        db_provision_service_1.DbProvisionService])
], AppsService);
function sanitizeRelPath(rel) {
    const parts = rel
        .replace(/\\/g, '/')
        .split('/')
        .filter((seg) => seg && seg !== '.' && seg !== '..');
    return parts.join('/');
}
function stripCommonTopDir(relPaths) {
    const tops = new Set();
    for (const p of relPaths) {
        const top = p.replace(/\\/g, '/').split('/')[0];
        if (!top)
            return '';
        tops.add(top);
    }
    return tops.size === 1 ? `${[...tops][0]}/` : '';
}
function describeRRSets(rrs) {
    return rrs.map((r) => `${r.type} ${r.records.join(', ')}`).join('; ');
}
//# sourceMappingURL=apps.service.js.map