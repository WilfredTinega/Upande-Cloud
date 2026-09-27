import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as Docker from 'dockerode';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit.service';
import { applyPreviewAuth } from '../common/preview-auth.util';

// Password-protected previews (per app). Implemented with a Traefik basicAuth
// middleware on each preview's own router — production routers never get it.
// Only a bcrypt hash is stored (PreviewProtection) and put in the labels.
//
// Docker labels can't change on a running container, so enabling, changing or
// removing the password recreates every existing preview container from its
// current image/env/config with the new labels (a ~1s blip per preview; no
// rebuild). New preview deploys read the setting when their container starts.

const USER_RE = /^[A-Za-z0-9._-]{1,64}$/;

@Injectable()
export class PreviewProtectionService {
  private readonly logger = new Logger(PreviewProtectionService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });

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

  async get(organizationId: string, appId: string) {
    await this.assertApp(appId, organizationId);
    const row = await this.prisma.previewProtection.findUnique({ where: { appId } });
    return { enabled: !!row, username: row?.username ?? null, updatedAt: row?.updatedAt ?? null };
  }

  // Turn protection on, or change the username/password.
  async set(
    userId: string,
    organizationId: string,
    appId: string,
    dto: { username?: string; password?: string },
  ) {
    await this.assertApp(appId, organizationId);
    const existing = await this.prisma.previewProtection.findUnique({ where: { appId } });
    const username = (dto.username ?? existing?.username ?? 'preview').trim();
    if (!USER_RE.test(username)) {
      throw new BadRequestException({
        code: 'BAD_USERNAME',
        message: 'Username: 1–64 letters, digits, dot, dash or underscore.',
      });
    }
    if (dto.password === undefined && !existing) {
      throw new BadRequestException({ code: 'PASSWORD_REQUIRED', message: 'Set a password.' });
    }
    if (dto.password !== undefined && (dto.password.length < 8 || dto.password.length > 128)) {
      throw new BadRequestException({ code: 'BAD_PASSWORD', message: 'Password must be 8–128 characters.' });
    }
    // bcrypt's $2b$ and htpasswd's $2y$ are the same algorithm; $2y$ is what
    // Traefik's htpasswd parser expects.
    const passwordHash =
      dto.password !== undefined
        ? (await bcrypt.hash(dto.password, 10)).replace(/^\$2[ab]\$/, '$2y$')
        : existing!.passwordHash;
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

  async disable(userId: string, organizationId: string, appId: string) {
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

  // Recreate each existing preview container whose auth labels differ.
  private async applyToRunning(
    appId: string,
    protection: { username: string; passwordHash: string } | null,
  ): Promise<{ updated: number; failed: string[] }> {
    const previews = await this.prisma.preview.findMany({
      where: { appId },
      select: { branch: true, subdomain: true, status: true },
    });
    let updated = 0;
    const failed: string[] = [];
    for (const p of previews) {
      // A deploying preview is mid-swap: recreating its container now could
      // resurrect the old version. Its new container reads the setting when
      // it starts (deploy.processor), so skip it here.
      if (p.status === 'queued' || p.status === 'building') continue;
      try {
        if (await this.relabel(p.subdomain, protection)) updated += 1;
      } catch (err) {
        this.logger.warn(`relabel of preview ${p.subdomain} failed: ${String(err)}`);
        failed.push(p.branch);
      }
    }
    return { updated, failed };
  }

  private async relabel(
    subdomain: string,
    protection: { username: string; passwordHash: string } | null,
  ): Promise<boolean> {
    const name = `upande-preview-${subdomain}`;
    let info: Docker.ContainerInspectInfo;
    try {
      info = await this.docker.getContainer(name).inspect();
    } catch {
      return false; // no container (never deployed / removed) — nothing to relabel
    }
    const oldLabels = info.Config?.Labels ?? {};
    const labels = applyPreviewAuth(oldLabels, subdomain, protection);
    const same =
      Object.keys(labels).length === Object.keys(oldLabels).length &&
      Object.entries(labels).every(([k, v]) => oldLabels[k] === v);
    if (same) return false;

    const create = (l: Record<string, string>) =>
      this.docker.createContainer({
        // Image *id*, like the deploy rollback snapshot: survives tag pruning.
        Image: info.Image,
        name,
        Labels: l,
        Env: info.Config?.Env ?? [],
        HostConfig: {
          NetworkMode: info.HostConfig?.NetworkMode || process.env.DOCKER_NETWORK || 'upande_net',
          ...(info.HostConfig?.RestartPolicy?.Name
            ? {
                RestartPolicy: {
                  Name: info.HostConfig.RestartPolicy.Name as Docker.HostRestartPolicy['Name'],
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
      if (info.State?.Running) await c.start();
      return true;
    } catch (err) {
      // Put the previous container back so the preview stays up.
      const c = await create(oldLabels).catch(() => null);
      if (c && info.State?.Running) await c.start().catch(() => undefined);
      throw err;
    }
  }
}
