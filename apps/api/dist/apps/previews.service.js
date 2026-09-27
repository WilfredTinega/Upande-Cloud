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
var PreviewsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreviewsService = void 0;
exports.previewMaxPerApp = previewMaxPerApp;
exports.previewMaxPerOrg = previewMaxPerOrg;
exports.previewAutoDeploy = previewAutoDeploy;
const common_1 = require("@nestjs/common");
const crypto = require("crypto");
const Docker = require("dockerode");
const prisma_service_1 = require("../prisma/prisma.service");
const deploy_service_1 = require("../deploy/deploy.service");
const audit_service_1 = require("../common/audit.service");
const db_provision_service_1 = require("../database/db-provision.service");
const app_url_util_1 = require("../common/app-url.util");
function previewMaxPerApp() {
    const n = Number(process.env.PREVIEW_MAX_PER_APP ?? 3);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3;
}
function previewMaxPerOrg() {
    const n = Number(process.env.PREVIEW_MAX_PER_ORG ?? 10);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
}
function previewAutoDeploy() {
    return (process.env.PREVIEW_AUTO_DEPLOY ?? 'true').toLowerCase() !== 'false';
}
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}(?<![./])$/;
function branchSlug(branch) {
    return branch
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
let PreviewsService = PreviewsService_1 = class PreviewsService {
    constructor(prisma, deployService, auditService, dbProvision) {
        this.prisma = prisma;
        this.deployService = deployService;
        this.auditService = auditService;
        this.dbProvision = dbProvision;
        this.logger = new common_1.Logger(PreviewsService_1.name);
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    }
    async findAppForOrg(appId, organizationId) {
        const app = await this.prisma.app.findUnique({
            where: { id: appId },
            include: { project: { select: { organizationId: true, userId: true } } },
        });
        if (!app)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
        if (app.project.organizationId !== organizationId) {
            throw new common_1.ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
        }
        return app;
    }
    unsupportedReason(app) {
        if (app.type === 'nodered')
            return 'Node-RED apps run the official image — there are no branches to preview.';
        if (app.source !== 'git' || !app.repoUrl)
            return 'Previews need a git repository (uploaded apps have no branches).';
        return null;
    }
    view(p) {
        const last = p.deployments?.[0] ?? null;
        return {
            id: p.id,
            branch: p.branch,
            subdomain: p.subdomain,
            url: (0, app_url_util_1.buildAppUrl)(p.subdomain),
            status: p.status,
            commitSha: p.commitSha,
            lastDeployedAt: p.lastDeployedAt,
            createdAt: p.createdAt,
            hasDatabase: !!p.dbName,
            lastDeployment: last
                ? {
                    id: last.id,
                    status: last.status,
                    errorReason: last.errorReason,
                    createdAt: last.createdAt,
                    commitMessage: last.commitMessage,
                }
                : null,
        };
    }
    async list(organizationId, appId) {
        const app = await this.findAppForOrg(appId, organizationId);
        const [previews, orgUsed] = await Promise.all([
            this.prisma.preview.findMany({
                where: { appId },
                orderBy: { createdAt: 'desc' },
                include: {
                    deployments: {
                        orderBy: { createdAt: 'desc' },
                        take: 1,
                        select: { id: true, status: true, errorReason: true, createdAt: true, commitMessage: true },
                    },
                },
            }),
            this.prisma.preview.count({ where: { app: { project: { organizationId } } } }),
        ]);
        const reason = this.unsupportedReason(app);
        return {
            supported: !reason,
            unsupportedReason: reason,
            productionBranch: app.branch ?? 'main',
            usesThrowawayDb: app.type === 'fullstack',
            autoDeployOnPush: previewAutoDeploy() && !!app.githubWebhookId,
            limits: { perApp: previewMaxPerApp(), perOrg: previewMaxPerOrg(), orgUsed },
            previews: previews.map((p) => this.view(p)),
        };
    }
    async deploy(userId, organizationId, appId, branch) {
        const app = await this.findAppForOrg(appId, organizationId);
        const result = await this.deployBranch(app, branch, { userId, trigger: 'user' });
        await this.auditService.log({
            actorUserId: userId,
            action: result.created ? 'app.preview.create' : 'app.preview.deploy',
            target: appId,
            metadata: {
                previewId: result.preview.id,
                branch: result.preview.branch,
                subdomain: result.preview.subdomain,
                deploymentId: result.deploymentId,
            },
        });
        return {
            preview: this.view(result.preview),
            deploymentId: result.deploymentId,
            created: result.created,
        };
    }
    async deployFromWebhook(appId, branch, src) {
        if (!previewAutoDeploy())
            return { skipped: 'PREVIEW_AUTO_DEPLOY is off' };
        const app = await this.prisma.app.findUnique({
            where: { id: appId },
            include: { project: { select: { organizationId: true, userId: true } } },
        });
        if (!app)
            return { skipped: 'app not found' };
        try {
            const result = await this.deployBranch(app, branch, { ...src, trigger: 'webhook' });
            await this.auditService.log({
                action: result.created ? 'app.preview.create.webhook' : 'app.preview.deploy.webhook',
                target: appId,
                metadata: {
                    previewId: result.preview.id,
                    branch,
                    deploymentId: result.deploymentId,
                    commitSha: src.commitSha,
                },
            });
            return { previewId: result.preview.id, url: (0, app_url_util_1.buildAppUrl)(result.preview.subdomain) };
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.warn(`preview for ${appId}@${branch} not deployed: ${msg}`);
            return { skipped: msg };
        }
    }
    async deployBranch(app, rawBranch, src) {
        const reason = this.unsupportedReason(app);
        if (reason)
            throw new common_1.BadRequestException({ code: 'PREVIEW_UNSUPPORTED', message: reason });
        const branch = (rawBranch ?? '').trim().replace(/^refs\/heads\//, '');
        if (!BRANCH_RE.test(branch)) {
            throw new common_1.BadRequestException({ code: 'BAD_BRANCH', message: 'That is not a valid branch name.' });
        }
        if (branch === (app.branch ?? 'main')) {
            throw new common_1.BadRequestException({
                code: 'PRODUCTION_BRANCH',
                message: `"${branch}" is the production branch — use Deploy for it. Previews are for other branches.`,
            });
        }
        let preview = await this.prisma.preview.findUnique({
            where: { appId_branch: { appId: app.id, branch } },
        });
        let created = false;
        if (preview) {
            if (preview.status === 'queued' || preview.status === 'building') {
                throw new common_1.ConflictException({
                    code: 'PREVIEW_BUSY',
                    message: 'This preview is already deploying — wait for it to finish.',
                });
            }
        }
        else {
            const [appCount, orgCount] = await Promise.all([
                this.prisma.preview.count({ where: { appId: app.id } }),
                this.prisma.preview.count({
                    where: { app: { project: { organizationId: app.project.organizationId } } },
                }),
            ]);
            if (appCount >= previewMaxPerApp()) {
                throw new common_1.BadRequestException({
                    code: 'PREVIEW_LIMIT',
                    message: `This app already has ${appCount} preview(s) (limit ${previewMaxPerApp()}). Delete one first.`,
                });
            }
            if (orgCount >= previewMaxPerOrg()) {
                throw new common_1.BadRequestException({
                    code: 'PREVIEW_LIMIT',
                    message: `Your organization already has ${orgCount} preview(s) (limit ${previewMaxPerOrg()}). Delete one first.`,
                });
            }
            preview = await this.prisma.preview.create({
                data: {
                    appId: app.id,
                    branch,
                    subdomain: await this.allocateSubdomain(app.subdomain, branch),
                    status: 'queued',
                    createdByUserId: src.userId ?? null,
                },
            });
            created = true;
        }
        const deployment = await this.prisma.deployment.create({
            data: {
                appId: app.id,
                previewId: preview.id,
                ref: branch,
                status: 'queued',
                trigger: src.trigger,
                triggeredByUserId: src.userId ?? null,
                triggerDetail: src.detail ? `preview · ${src.detail}` : 'preview',
                commitSha: src.commitSha ?? null,
                commitMessage: src.commitMessage?.slice(0, 500) ?? null,
            },
        });
        preview = await this.prisma.preview.update({
            where: { id: preview.id },
            data: { status: 'queued', lastDeploymentId: deployment.id },
        });
        await this.deployService.enqueue({
            deploymentId: deployment.id,
            appId: app.id,
            ref: branch,
            previewId: preview.id,
        });
        return { preview, deploymentId: deployment.id, created };
    }
    async allocateSubdomain(appSubdomain, branch) {
        const hash = crypto.createHash('sha1').update(branch).digest('hex').slice(0, 6);
        const slug = branchSlug(branch) || 'branch';
        const candidates = [];
        const plain = `${appSubdomain}-${slug}`;
        if (plain.length <= 63)
            candidates.push(plain);
        const room = Math.max(1, 63 - appSubdomain.length - hash.length - 2);
        candidates.push(`${appSubdomain}-${slug.slice(0, room).replace(/-+$/, '')}-${hash}`.slice(0, 63));
        for (const c of candidates) {
            const sub = c.replace(/-+$/, '');
            const [appHit, pvHit] = await Promise.all([
                this.prisma.app.findUnique({ where: { subdomain: sub }, select: { id: true } }),
                this.prisma.preview.findUnique({ where: { subdomain: sub }, select: { id: true } }),
            ]);
            if (!appHit && !pvHit)
                return sub;
        }
        throw new common_1.ConflictException({
            code: 'PREVIEW_HOST_TAKEN',
            message: 'Could not allocate a unique preview hostname for this branch.',
        });
    }
    async remove(userId, organizationId, appId, previewId) {
        await this.findAppForOrg(appId, organizationId);
        const preview = await this.prisma.preview.findFirst({ where: { id: previewId, appId } });
        if (!preview)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Preview not found' });
        await this.teardown(preview);
        await this.auditService.log({
            actorUserId: userId,
            action: 'app.preview.delete',
            target: appId,
            metadata: { previewId, branch: preview.branch, subdomain: preview.subdomain },
        });
        return { ok: true };
    }
    async removeForBranch(appId, branch) {
        const preview = await this.prisma.preview.findUnique({
            where: { appId_branch: { appId, branch } },
        });
        if (!preview)
            return false;
        await this.teardown(preview);
        await this.auditService.log({
            action: 'app.preview.delete.webhook',
            target: appId,
            metadata: { previewId: preview.id, branch, subdomain: preview.subdomain },
        });
        return true;
    }
    async removeAllForApp(appId) {
        const previews = await this.prisma.preview.findMany({ where: { appId } });
        for (const p of previews)
            await this.teardown(p);
    }
    async teardown(preview) {
        await this.deployService.cancelForPreview(preview.id).catch(() => 0);
        const name = `upande-preview-${preview.subdomain}`;
        for (const c of [name, `${name}-candidate`]) {
            await this.docker.getContainer(c).remove({ force: true }).catch(() => undefined);
        }
        try {
            const images = await this.docker.listImages({
                filters: { reference: [`upande-preview-${preview.subdomain}:*`] },
            });
            const repo = `upande-preview-${preview.subdomain}:`;
            for (const tag of images.flatMap((i) => i.RepoTags ?? [])) {
                if (!tag.startsWith(repo))
                    continue;
                await this.docker.getImage(tag).remove({ force: true }).catch(() => undefined);
            }
        }
        catch (err) {
            this.logger.warn(`listing preview images failed: ${String(err)}`);
        }
        if (preview.dbName && preview.dbRoleName) {
            try {
                await this.dbProvision.dropPreviewDatabase(preview.dbName, preview.dbRoleName);
            }
            catch (err) {
                this.logger.warn(`dropping preview database ${preview.dbName} failed: ${String(err)}`);
            }
        }
        await this.prisma.$transaction([
            this.prisma.deployment.deleteMany({ where: { previewId: preview.id } }),
            this.prisma.preview.deleteMany({ where: { id: preview.id } }),
        ]);
    }
};
exports.PreviewsService = PreviewsService;
exports.PreviewsService = PreviewsService = PreviewsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        deploy_service_1.DeployService,
        audit_service_1.AuditService,
        db_provision_service_1.DbProvisionService])
], PreviewsService);
//# sourceMappingURL=previews.service.js.map