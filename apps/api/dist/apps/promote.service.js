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
exports.PromoteService = void 0;
const common_1 = require("@nestjs/common");
const Docker = require("dockerode");
const prisma_service_1 = require("../prisma/prisma.service");
const deploy_service_1 = require("../deploy/deploy.service");
const audit_service_1 = require("../common/audit.service");
const env_scope_util_1 = require("../common/env-scope.util");
const BUILD_TIME_PREFIXES = ['VITE_', 'NEXT_PUBLIC_', 'REACT_APP_', 'NUXT_PUBLIC_', 'PUBLIC_', 'GATSBY_'];
let PromoteService = class PromoteService {
    constructor(prisma, deployService, audit) {
        this.prisma = prisma;
        this.deployService = deployService;
        this.audit = audit;
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    }
    async load(organizationId, appId, previewId) {
        const app = await this.prisma.app.findUnique({
            where: { id: appId },
            include: { project: { select: { organizationId: true } }, envVars: true },
        });
        if (!app)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
        if (app.project.organizationId !== organizationId) {
            throw new common_1.ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
        }
        const preview = await this.prisma.preview.findFirst({ where: { id: previewId, appId } });
        if (!preview)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Preview not found' });
        return { app, preview };
    }
    async imageExists(tag) {
        if (!tag)
            return false;
        try {
            await this.docker.getImage(tag).inspect();
            return true;
        }
        catch {
            return false;
        }
    }
    async containerHealthy(name) {
        try {
            const info = await this.docker.getContainer(name).inspect();
            const health = info.State?.Health?.Status;
            return !!info.State?.Running && !info.State?.Restarting && health !== 'unhealthy';
        }
        catch {
            return false;
        }
    }
    buildTimeDiff(app) {
        if (app.type !== 'static' && app.type !== 'fullstack')
            return [];
        const prod = new Map((0, env_scope_util_1.effectiveEnvVars)(app.envVars, 'production').map((v) => [v.key, v.value]));
        const prev = new Map((0, env_scope_util_1.effectiveEnvVars)(app.envVars, 'preview').map((v) => [v.key, v.value]));
        const keys = new Set([...prod.keys(), ...prev.keys()]);
        return [...keys]
            .filter((k) => BUILD_TIME_PREFIXES.some((p) => k.startsWith(p)))
            .filter((k) => prod.get(k) !== prev.get(k))
            .sort();
    }
    async check(organizationId, appId, previewId) {
        const { app, preview } = await this.load(organizationId, appId, previewId);
        const blocked = await this.blockReason(app, preview);
        const imageAvailable = await this.imageExists(preview.imageRef);
        const buildTimeKeys = this.buildTimeDiff(app);
        return {
            canPromote: !blocked,
            reason: blocked,
            branch: preview.branch,
            commitSha: preview.commitSha,
            imageAvailable,
            compatible: buildTimeKeys.length === 0,
            buildTimeKeys,
            canRebuild: app.source === 'git' && !!preview.commitSha,
        };
    }
    async blockReason(app, preview) {
        if (app.type === 'nodered')
            return 'Node-RED apps have no previews to promote.';
        if (app.status === 'building')
            return 'A production deployment is already in progress.';
        if (preview.status !== 'live')
            return 'Only a live preview can be promoted.';
        if (!(await this.containerHealthy(`upande-preview-${preview.subdomain}`))) {
            return 'The preview container is not running healthily.';
        }
        return null;
    }
    async promote(userId, organizationId, appId, previewId, opts) {
        const { app, preview } = await this.load(organizationId, appId, previewId);
        const blocked = await this.blockReason(app, preview);
        if (blocked)
            throw new common_1.ConflictException({ code: 'PROMOTE_BLOCKED', message: blocked });
        const imageAvailable = await this.imageExists(preview.imageRef);
        const canRebuild = app.source === 'git' && !!preview.commitSha;
        const rebuild = !!opts.rebuild || !imageAvailable;
        if (rebuild && !canRebuild) {
            throw new common_1.BadRequestException({
                code: 'PROMOTE_UNAVAILABLE',
                message: "The preview image is gone and its commit wasn't recorded, so it can't be promoted.",
            });
        }
        const claimed = await this.prisma.app.updateMany({
            where: { id: appId, status: { not: 'building' } },
            data: { status: 'building' },
        });
        if (!claimed.count) {
            throw new common_1.ConflictException({ code: 'PROMOTE_BLOCKED', message: 'A production deployment is already in progress.' });
        }
        const release = () => this.prisma.app.updateMany({ where: { id: appId, status: 'building' }, data: { status: app.status } }).catch(() => undefined);
        const previewDeployment = preview.lastDeploymentId
            ? await this.prisma.deployment.findUnique({
                where: { id: preview.lastDeploymentId },
                select: { id: true, commitMessage: true },
            })
            : null;
        const deployment = await this.prisma.deployment.create({
            data: {
                appId,
                ref: preview.branch,
                status: 'queued',
                trigger: 'promote',
                triggeredByUserId: userId,
                commitSha: preview.commitSha,
                commitMessage: previewDeployment?.commitMessage ?? null,
                triggerDetail: `${preview.branch}${previewDeployment ? ` · preview ${previewDeployment.id.slice(0, 8)}` : ''}${rebuild ? ' (rebuild)' : ''}`,
            },
        });
        let prodImage;
        if (!rebuild && preview.imageRef) {
            const repo = `upande-app-${app.subdomain}`;
            try {
                await this.docker.getImage(preview.imageRef).tag({ repo, tag: `promote-${deployment.id}` });
                prodImage = `${repo}:promote-${deployment.id}`;
            }
            catch (err) {
                await this.prisma.deployment.delete({ where: { id: deployment.id } }).catch(() => undefined);
                await release();
                throw new common_1.ConflictException({
                    code: 'PROMOTE_TAG_FAILED',
                    message: `Could not reuse the preview image: ${err instanceof Error ? err.message : String(err)}`,
                });
            }
        }
        await this.deployService.enqueue({
            deploymentId: deployment.id,
            appId,
            ref: preview.branch,
            rollbackImage: prodImage,
            commitSha: preview.commitSha ?? undefined,
            promoteFrom: preview.branch,
        });
        await this.audit.log({
            actorUserId: userId,
            action: 'app.preview.promote',
            target: appId,
            metadata: {
                deploymentId: deployment.id,
                previewId: preview.id,
                branch: preview.branch,
                commitSha: preview.commitSha,
                previewDeploymentId: previewDeployment?.id ?? null,
                reuseImage: !rebuild,
            },
        });
        return { deployment, reuseImage: !rebuild };
    }
};
exports.PromoteService = PromoteService;
exports.PromoteService = PromoteService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        deploy_service_1.DeployService,
        audit_service_1.AuditService])
], PromoteService);
//# sourceMappingURL=promote.service.js.map