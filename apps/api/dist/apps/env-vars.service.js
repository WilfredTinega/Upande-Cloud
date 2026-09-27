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
exports.EnvVarsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const audit_service_1 = require("../common/audit.service");
const env_scope_util_1 = require("../common/env-scope.util");
let EnvVarsService = class EnvVarsService {
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
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
    view(v) {
        return {
            id: v.id,
            key: v.key,
            value: v.isSecret ? null : v.value,
            isSecret: v.isSecret,
            scope: v.scope,
        };
    }
    duplicate(key, scope) {
        return new common_1.ConflictException({
            code: 'ENV_EXISTS',
            message: `${key} already exists for ${scope === 'all' ? 'all environments' : scope}.`,
        });
    }
    async list(organizationId, appId, scope) {
        await this.assertApp(appId, organizationId);
        if (scope && !(0, env_scope_util_1.isEnvScope)(scope)) {
            throw new common_1.BadRequestException({ code: 'BAD_SCOPE', message: 'scope must be all, production or preview' });
        }
        const rows = await this.prisma.envVar.findMany({
            where: { appId, ...(scope ? { scope } : {}) },
            orderBy: [{ key: 'asc' }, { scope: 'asc' }],
        });
        return { envVars: rows.map((r) => this.view(r)) };
    }
    async create(userId, organizationId, appId, dto) {
        await this.assertApp(appId, organizationId);
        const scope = dto.scope ?? 'all';
        const exists = await this.prisma.envVar.findUnique({
            where: { appId_key_scope: { appId, key: dto.key, scope } },
            select: { id: true },
        });
        if (exists)
            throw this.duplicate(dto.key, scope);
        const row = await this.prisma.envVar
            .create({ data: { appId, key: dto.key, value: dto.value, isSecret: !!dto.isSecret, scope } })
            .catch((err) => {
            if (err?.code === 'P2002')
                throw this.duplicate(dto.key, scope);
            throw err;
        });
        await this.audit.log({
            actorUserId: userId,
            action: 'app.env.create',
            target: appId,
            metadata: { envVarId: row.id, key: row.key, scope, isSecret: row.isSecret },
        });
        return { envVar: this.view(row) };
    }
    async update(userId, organizationId, appId, envId, dto) {
        await this.assertApp(appId, organizationId);
        const row = await this.prisma.envVar.findFirst({ where: { id: envId, appId } });
        if (!row)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Env var not found' });
        if (row.isSecret && dto.isSecret === false && dto.value === undefined) {
            throw new common_1.BadRequestException({
                code: 'SECRET_VALUE_REQUIRED',
                message: 'Enter a new value to turn a secret into a plain variable.',
            });
        }
        const scope = dto.scope ?? row.scope;
        if (scope !== row.scope) {
            const clash = await this.prisma.envVar.findUnique({
                where: { appId_key_scope: { appId, key: row.key, scope } },
                select: { id: true },
            });
            if (clash)
                throw this.duplicate(row.key, scope);
        }
        const updated = await this.prisma.envVar
            .update({
            where: { id: row.id },
            data: {
                scope,
                ...(dto.value !== undefined ? { value: dto.value } : {}),
                ...(dto.isSecret !== undefined ? { isSecret: dto.isSecret } : {}),
            },
        })
            .catch((err) => {
            if (err?.code === 'P2002')
                throw this.duplicate(row.key, scope);
            throw err;
        });
        await this.audit.log({
            actorUserId: userId,
            action: 'app.env.update',
            target: appId,
            metadata: {
                envVarId: row.id,
                key: row.key,
                scope,
                ...(scope !== row.scope ? { previousScope: row.scope } : {}),
                valueChanged: dto.value !== undefined,
                isSecret: updated.isSecret,
            },
        });
        return { envVar: this.view(updated) };
    }
    async remove(userId, organizationId, appId, envId) {
        await this.assertApp(appId, organizationId);
        const row = await this.prisma.envVar.findFirst({ where: { id: envId, appId } });
        if (!row)
            throw new common_1.NotFoundException({ code: 'NOT_FOUND', message: 'Env var not found' });
        await this.prisma.envVar.delete({ where: { id: row.id } });
        await this.audit.log({
            actorUserId: userId,
            action: 'app.env.delete',
            target: appId,
            metadata: { envVarId: row.id, key: row.key, scope: row.scope },
        });
        return { ok: true };
    }
};
exports.EnvVarsService = EnvVarsService;
exports.EnvVarsService = EnvVarsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], EnvVarsService);
//# sourceMappingURL=env-vars.service.js.map