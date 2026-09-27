import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { EnvScope, isEnvScope } from '../common/env-scope.util';
import { CreateEnvVarDto, UpdateEnvVarDto } from './dto/env-var.dto';

// Per-app env vars with an environment scope (all | production | preview).
// Secret values are write-only: they are never returned by the API.
// Changes apply on the next deploy.
@Injectable()
export class EnvVarsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async assertApp(appId: string, organizationId: string) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      select: { id: true, project: { select: { organizationId: true } } },
    });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    if (app.project.organizationId !== organizationId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    }
  }

  private view(v: { id: string; key: string; value: string; isSecret: boolean; scope: string }) {
    return {
      id: v.id,
      key: v.key,
      value: v.isSecret ? null : v.value,
      isSecret: v.isSecret,
      scope: v.scope,
    };
  }

  private duplicate(key: string, scope: string) {
    return new ConflictException({
      code: 'ENV_EXISTS',
      message: `${key} already exists for ${scope === 'all' ? 'all environments' : scope}.`,
    });
  }

  async list(organizationId: string, appId: string, scope?: string) {
    await this.assertApp(appId, organizationId);
    if (scope && !isEnvScope(scope)) {
      throw new BadRequestException({ code: 'BAD_SCOPE', message: 'scope must be all, production or preview' });
    }
    const rows = await this.prisma.envVar.findMany({
      where: { appId, ...(scope ? { scope } : {}) },
      orderBy: [{ key: 'asc' }, { scope: 'asc' }],
    });
    return { envVars: rows.map((r) => this.view(r)) };
  }

  async create(userId: string, organizationId: string, appId: string, dto: CreateEnvVarDto) {
    await this.assertApp(appId, organizationId);
    const scope: EnvScope = dto.scope ?? 'all';
    const exists = await this.prisma.envVar.findUnique({
      where: { appId_key_scope: { appId, key: dto.key, scope } },
      select: { id: true },
    });
    if (exists) throw this.duplicate(dto.key, scope);
    const row = await this.prisma.envVar
      .create({ data: { appId, key: dto.key, value: dto.value, isSecret: !!dto.isSecret, scope } })
      .catch((err: unknown) => {
        // Concurrent create of the same (app, key, scope) → unique violation.
        if ((err as { code?: string })?.code === 'P2002') throw this.duplicate(dto.key, scope);
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

  async update(userId: string, organizationId: string, appId: string, envId: string, dto: UpdateEnvVarDto) {
    await this.assertApp(appId, organizationId);
    const row = await this.prisma.envVar.findFirst({ where: { id: envId, appId } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Env var not found' });
    // Un-marking a secret would reveal its value — require a new value then.
    if (row.isSecret && dto.isSecret === false && dto.value === undefined) {
      throw new BadRequestException({
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
      if (clash) throw this.duplicate(row.key, scope);
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
      .catch((err: unknown) => {
        if ((err as { code?: string })?.code === 'P2002') throw this.duplicate(row.key, scope);
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

  async remove(userId: string, organizationId: string, appId: string, envId: string) {
    await this.assertApp(appId, organizationId);
    const row = await this.prisma.envVar.findFirst({ where: { id: envId, appId } });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Env var not found' });
    await this.prisma.envVar.delete({ where: { id: row.id } });
    await this.audit.log({
      actorUserId: userId,
      action: 'app.env.delete',
      target: appId,
      metadata: { envVarId: row.id, key: row.key, scope: row.scope },
    });
    return { ok: true };
  }
}
