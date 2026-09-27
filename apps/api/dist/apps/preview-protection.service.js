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
var PreviewProtectionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreviewProtectionService = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = require("bcrypt");
const Docker = require("dockerode");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../common/audit.service");
const preview_auth_util_1 = require("../common/preview-auth.util");
const USER_RE = /^[A-Za-z0-9._-]{1,64}$/;
let PreviewProtectionService = PreviewProtectionService_1 = class PreviewProtectionService {
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
        this.logger = new common_1.Logger(PreviewProtectionService_1.name);
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    }
    async assertApp(appId, organizationId) {
        const app = await this.prisma.app.findUnique({
            where: { id: appId },
            select: { id: true, project: { select: { organizationId: true } } },
        });
        if (!app)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
        if (app.project.organizationId !== organizationId) {
            throw new common_1.ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
        }
    }
    async get(organizationId, appId) {
        await this.assertApp(appId, organizationId);
        const row = await this.prisma.previewProtection.findUnique({ where: { appId } });
        return { enabled: !!row, username: row?.username ?? null, updatedAt: row?.updatedAt ?? null };
    }
    async set(userId, organizationId, appId, dto) {
        await this.assertApp(appId, organizationId);
        const existing = await this.prisma.previewProtection.findUnique({ where: { appId } });
        const username = (dto.username ?? existing?.username ?? 'preview').trim();
        if (!USER_RE.test(username)) {
            throw new common_1.BadRequestException({
                code: 'BAD_USERNAME',
                message: 'Username: 1–64 letters, digits, dot, dash or underscore.',
            });
        }
        if (dto.password === undefined && !existing) {
            throw new common_1.BadRequestException({ code: 'PASSWORD_REQUIRED', message: 'Set a password.' });
        }
        if (dto.password !== undefined && (dto.password.length < 8 || dto.password.length > 128)) {
            throw new common_1.BadRequestException({ code: 'BAD_PASSWORD', message: 'Password must be 8–128 characters.' });
        }
        const passwordHash = dto.password !== undefined
            ? (await bcrypt.hash(dto.password, 10)).replace(/^\$2[ab]\$/, '$2y$')
            : existing.passwordHash;
        const row = await this.prisma.previewProtection.upsert({
            where: { appId },
            create: { appId, username, passwordHash },
            update: { username, passwordHash },
        });
        const applied = await this.applyToRunning(appId, row);
        await this.audit.log({
            actorUserId: userId,
            action: existing ? 'app.preview.protection.update' : 'app.preview.protection.enable',
            target: appId,
            metadata: { username, passwordChanged: dto.password !== undefined, ...applied },
        });
        return { enabled: true, username, ...applied };
    }
    async disable(userId, organizationId, appId) {
        await this.assertApp(appId, organizationId);
        const { count } = await this.prisma.previewProtection.deleteMany({ where: { appId } });
        const applied = await this.applyToRunning(appId, null);
        if (count) {
            await this.audit.log({
                actorUserId: userId,
                action: 'app.preview.protection.disable',
                target: appId,
                metadata: applied,
            });
        }
        return { enabled: false, username: null, ...applied };
    }
    async applyToRunning(appId, protection) {
        const previews = await this.prisma.preview.findMany({
            where: { appId },
            select: { branch: true, subdomain: true, status: true },
        });
        let updated = 0;
        const failed = [];
        for (const p of previews) {
            if (p.status === 'queued' || p.status === 'building')
                continue;
            try {
                if (await this.relabel(p.subdomain, protection))
                    updated += 1;
            }
            catch (err) {
                this.logger.warn(`relabel of preview ${p.subdomain} failed: ${String(err)}`);
                failed.push(p.branch);
            }
        }
        return { updated, failed };
    }
    async relabel(subdomain, protection) {
        const name = `upande-preview-${subdomain}`;
        let info;
        try {
            info = await this.docker.getContainer(name).inspect();
        }
        catch {
            return false;
        }
        const oldLabels = info.Config?.Labels ?? {};
        const labels = (0, preview_auth_util_1.applyPreviewAuth)(oldLabels, subdomain, protection);
        const same = Object.keys(labels).length === Object.keys(oldLabels).length &&
            Object.entries(labels).every(([k, v]) => oldLabels[k] === v);
        if (same)
            return false;
        const create = (l) => this.docker.createContainer({
            Image: info.Image,
            name,
            Labels: l,
            Env: info.Config?.Env ?? [],
            HostConfig: {
                NetworkMode: info.HostConfig?.NetworkMode || process.env.DOCKER_NETWORK || 'upande_net',
                ...(info.HostConfig?.RestartPolicy?.Name
                    ? {
                        RestartPolicy: {
                            Name: info.HostConfig.RestartPolicy.Name,
                            ...(info.HostConfig.RestartPolicy.MaximumRetryCount
                                ? { MaximumRetryCount: info.HostConfig.RestartPolicy.MaximumRetryCount }
                                : {}),
                        },
                    }
                    : {}),
                ...(info.HostConfig?.Binds?.length ? { Binds: info.HostConfig.Binds } : {}),
            },
        });
        const old = this.docker.getContainer(name);
        await old.stop({ t: 5 }).catch(() => undefined);
        await old.remove({ force: true });
        try {
            const c = await create(labels);
            if (info.State?.Running)
                await c.start();
            return true;
        }
        catch (err) {
            const c = await create(oldLabels).catch(() => null);
            if (c && info.State?.Running)
                await c.start().catch(() => undefined);
            throw err;
        }
    }
};
exports.PreviewProtectionService = PreviewProtectionService;
exports.PreviewProtectionService = PreviewProtectionService = PreviewProtectionService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], PreviewProtectionService);
//# sourceMappingURL=preview-protection.service.js.map