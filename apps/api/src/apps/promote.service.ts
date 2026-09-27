import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as Docker from 'dockerode';
import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { AuditService } from '../common/audit.service';
import { effectiveEnvVars } from '../common/env-scope.util';

// "Promote to production" (like Vercel Promote): production runs a live
// preview's already-built image through the normal production pipeline —
// health check + zero-downtime swap + a new production deployment
// (trigger = promote) — so rollback works afterwards. Only the IMAGE is reused:
// the container starts with PRODUCTION-scoped env vars and the production
// database, never the preview's.
//
// The preview image is re-tagged into the production repo
// (upande-app-<subdomain>:<deploymentId>) so it is kept for rollback by
// IMAGE_RETENTION_COUNT and survives the preview being deleted.
//
// Static / fullstack frontends may bake build-time vars (VITE_, NEXT_PUBLIC_,
// ...) into the bundle; when those differ between preview and production the
// image is flagged as not directly reusable and "rebuild from commit" is
// offered instead.

const BUILD_TIME_PREFIXES = ['VITE_', 'NEXT_PUBLIC_', 'REACT_APP_', 'NUXT_PUBLIC_', 'PUBLIC_', 'GATSBY_'];

@Injectable()
export class PromoteService {
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });

  constructor(
    private readonly prisma: PrismaService,
    private readonly deployService: DeployService,
    private readonly audit: AuditService,
  ) {}

  private async load(organizationId: string, appId: string, previewId: string) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: { project: { select: { organizationId: true } }, envVars: true },
    });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    if (app.project.organizationId !== organizationId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    const preview = await this.prisma.preview.findFirst({ where: { id: previewId, appId } });
    if (!preview) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Preview not found' });
    return { app, preview };
  }

  private async imageExists(tag: string | null): Promise<boolean> {
    if (!tag) return false;
    try {
      await this.docker.getImage(tag).inspect();
      return true;
    } catch {
      return false;
    }
  }

  private async containerHealthy(name: string): Promise<boolean> {
    try {
      const info = await this.docker.getContainer(name).inspect();
      const health = info.State?.Health?.Status;
      return !!info.State?.Running && !info.State?.Restarting && health !== 'unhealthy';
    } catch {
      return false;
    }
  }

  // Keys of build-time vars whose effective value differs between preview and
  // production (values are compared, never returned).
  private buildTimeDiff(app: { type: string; envVars: { key: string; value: string; scope: string }[] }): string[] {
    if (app.type !== 'static' && app.type !== 'fullstack') return [];
    const prod = new Map(effectiveEnvVars(app.envVars, 'production').map((v) => [v.key, v.value]));
    const prev = new Map(effectiveEnvVars(app.envVars, 'preview').map((v) => [v.key, v.value]));
    const keys = new Set([...prod.keys(), ...prev.keys()]);
    return [...keys]
      .filter((k) => BUILD_TIME_PREFIXES.some((p) => k.startsWith(p)))
      .filter((k) => prod.get(k) !== prev.get(k))
      .sort();
  }

  // Everything the confirm dialog needs.
  async check(organizationId: string, appId: string, previewId: string) {
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
      // The image can run in production as-is (no build-time vars differ).
      compatible: buildTimeKeys.length === 0,
      buildTimeKeys,
      canRebuild: app.source === 'git' && !!preview.commitSha,
    };
  }

  private async blockReason(
    app: { type: string; status: string },
    preview: { status: string; subdomain: string },
  ): Promise<string | null> {
    if (app.type === 'nodered') return 'Node-RED apps have no previews to promote.';
    if (app.status === 'building') return 'A production deployment is already in progress.';
    if (preview.status !== 'live') return 'Only a live preview can be promoted.';
    if (!(await this.containerHealthy(`upande-preview-${preview.subdomain}`))) {
      return 'The preview container is not running healthily.';
    }
    return null;
  }

  async promote(
    userId: string,
    organizationId: string,
    appId: string,
    previewId: string,
    opts: { rebuild?: boolean },
  ) {
    const { app, preview } = await this.load(organizationId, appId, previewId);
    const blocked = await this.blockReason(app, preview);
    if (blocked) throw new ConflictException({ code: 'PROMOTE_BLOCKED', message: blocked });

    const imageAvailable = await this.imageExists(preview.imageRef);
    const canRebuild = app.source === 'git' && !!preview.commitSha;
    const rebuild = !!opts.rebuild || !imageAvailable;
    if (rebuild && !canRebuild) {
      throw new BadRequestException({
        code: 'PROMOTE_UNAVAILABLE',
        message: "The preview image is gone and its commit wasn't recorded, so it can't be promoted.",
      });
    }

    // Claim the app atomically so a double-click / concurrent promote can't
    // queue two production deploys.
    const claimed = await this.prisma.app.updateMany({
      where: { id: appId, status: { not: 'building' } },
      data: { status: 'building' },
    });
    if (!claimed.count) {
      throw new ConflictException({ code: 'PROMOTE_BLOCKED', message: 'A production deployment is already in progress.' });
    }
    const release = () =>
      this.prisma.app.updateMany({ where: { id: appId, status: 'building' }, data: { status: app.status } }).catch(() => undefined);

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
        triggerDetail: `${preview.branch}${previewDeployment ? ` · preview ${previewDeployment.id.slice(0, 8)}` : ''}${
          rebuild ? ' (rebuild)' : ''
        }`,
      },
    });

    // Copy the preview image into the production repo (same image id, new tag).
    let prodImage: string | undefined;
    if (!rebuild && preview.imageRef) {
      const repo = `upande-app-${app.subdomain}`;
      try {
        // Not <deploymentId>: a retry's cache clear removes exactly that tag.
        await this.docker.getImage(preview.imageRef).tag({ repo, tag: `promote-${deployment.id}` });
        prodImage = `${repo}:promote-${deployment.id}`;
      } catch (err) {
        await this.prisma.deployment.delete({ where: { id: deployment.id } }).catch(() => undefined);
        await release();
        throw new ConflictException({
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
}
