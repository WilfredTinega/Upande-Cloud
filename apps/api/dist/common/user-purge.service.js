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
var UserPurgeService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserPurgeService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const Docker = require("dockerode");
const prisma_service_1 = require("../prisma/prisma.service");
const db_provision_service_1 = require("../database/db-provision.service");
const previews_service_1 = require("../apps/previews.service");
let UserPurgeService = UserPurgeService_1 = class UserPurgeService {
    constructor(prisma, moduleRef) {
        this.prisma = prisma;
        this.moduleRef = moduleRef;
        this.logger = new common_1.Logger(UserPurgeService_1.name);
    }
    async purge(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                organizationId: true,
                projects: { select: { id: true, apps: { select: { id: true, subdomain: true } } } },
            },
        });
        if (!user)
            return;
        const projectIds = user.projects.map((p) => p.id);
        const apps = user.projects.flatMap((p) => p.apps);
        const appIds = apps.map((a) => a.id);
        for (const app of apps) {
            await this.removeContainer(app.subdomain);
        }
        const previews = this.moduleRef.get(previews_service_1.PreviewsService, { strict: false });
        const dbs = this.moduleRef.get(db_provision_service_1.DbProvisionService, { strict: false });
        for (const app of apps) {
            await previews.removeAllForApp(app.id).catch((e) => this.logger.warn(`previews of ${app.id}: ${String(e)}`));
            await dbs.dropForApp(app.id).catch((e) => this.logger.warn(`database of ${app.id}: ${String(e)}`));
        }
        const orgMembers = await this.prisma.user.count({
            where: { organizationId: user.organizationId },
        });
        const lastMember = orgMembers <= 1;
        await this.prisma.$transaction(async (tx) => {
            if (appIds.length) {
                await tx.deployToken.deleteMany({ where: { appId: { in: appIds } } });
                await tx.envVar.deleteMany({ where: { appId: { in: appIds } } });
                await tx.deployment.deleteMany({ where: { appId: { in: appIds } } });
                await tx.customDomain.deleteMany({ where: { appId: { in: appIds } } });
                await tx.app.deleteMany({ where: { id: { in: appIds } } });
            }
            if (projectIds.length) {
                await tx.project.deleteMany({ where: { id: { in: projectIds } } });
            }
            await tx.passwordResetToken.deleteMany({ where: { userId } });
            await tx.githubAccount.deleteMany({ where: { userId } });
            await tx.auditLog.updateMany({ where: { actorUserId: userId }, data: { actorUserId: null } });
            await tx.user.delete({ where: { id: userId } });
            if (lastMember) {
                await tx.quota.deleteMany({ where: { organizationId: user.organizationId } });
                await tx.organization.delete({ where: { id: user.organizationId } });
            }
        });
    }
    async removeContainer(subdomain) {
        try {
            const docker = new Docker({ socketPath: '/var/run/docker.sock' });
            const container = docker.getContainer(`upande-${subdomain}`);
            await container.remove({ force: true });
        }
        catch {
        }
    }
};
exports.UserPurgeService = UserPurgeService;
exports.UserPurgeService = UserPurgeService = UserPurgeService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        core_1.ModuleRef])
], UserPurgeService);
//# sourceMappingURL=user-purge.service.js.map