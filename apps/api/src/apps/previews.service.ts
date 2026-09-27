import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as Docker from 'dockerode';
import { PrismaService } from '../prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { AuditService } from '../common/audit.service';
import { DbProvisionService } from '../database/db-provision.service';
import { buildAppUrl } from '../common/app-url.util';

// Preview deploys per branch.
//
// A preview runs a non-production branch of a git app in its own container
// (upande-preview-<subdomain>), image repo (upande-preview-<subdomain>:<id>)
// and Traefik router on <app subdomain>-<branch slug>.<BASE_DOMAIN>. It never
// touches the production container, status, rollback images or database:
// DB-backed previews (fullstack apps, or any app whose env sets DATABASE_URL)
// get their own throwaway database, dropped with the preview.
//
// Limits (env): PREVIEW_MAX_PER_APP (default 3) active previews per app and
// PREVIEW_MAX_PER_ORG (default 10) per organization. PREVIEW_AUTO_DEPLOY=false
// turns off creating/updating previews from GitHub pushes.

export function previewMaxPerApp(): number {
  const n = Number(process.env.PREVIEW_MAX_PER_APP ?? 3);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 3;
}

export function previewMaxPerOrg(): number {
  const n = Number(process.env.PREVIEW_MAX_PER_ORG ?? 10);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 10;
}

export function previewAutoDeploy(): boolean {
  return (process.env.PREVIEW_AUTO_DEPLOY ?? 'true').toLowerCase() !== 'false';
}

// Git branch names allowed for previews (a conservative subset of git's rules;
// also keeps the value safe to pass to `git clone --branch`).
const BRANCH_RE = /^(?!-)(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9._/-]{1,200}(?<![./])$/;

function branchSlug(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface PreviewSource {
  userId?: string;
  trigger: 'user' | 'webhook';
  detail?: string;
  commitSha?: string;
  commitMessage?: string;
}

@Injectable()
export class PreviewsService {
  private readonly logger = new Logger(PreviewsService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });

  constructor(
    private readonly prisma: PrismaService,
    private readonly deployService: DeployService,
    private readonly auditService: AuditService,
    private readonly dbProvision: DbProvisionService,
  ) {}

  private async findAppForOrg(appId: string, organizationId: string) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: { project: { select: { organizationId: true, userId: true } } },
    });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    if (app.project.organizationId !== organizationId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    return app;
  }

  // Why an app can't have previews (null = supported).
  private unsupportedReason(app: { type: string; source: string; repoUrl: string | null }): string | null {
    if (app.type === 'nodered') return 'Node-RED apps run the official image — there are no branches to preview.';
    if (app.source !== 'git' || !app.repoUrl) return 'Previews need a git repository (uploaded apps have no branches).';
    return null;
  }

  private view(p: {
    id: string;
    branch: string;
    subdomain: string;
    status: string;
    commitSha: string | null;
    lastDeployedAt: Date | null;
    lastDeploymentId: string | null;
    createdAt: Date;
    dbName: string | null;
    deployments?: { id: string; status: string; errorReason: string | null; createdAt: Date; commitMessage: string | null }[];
  }) {
    const last = p.deployments?.[0] ?? null;
    return {
      id: p.id,
      branch: p.branch,
      subdomain: p.subdomain,
      url: buildAppUrl(p.subdomain),
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

  async list(organizationId: string, appId: string) {
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

  // Deploy (create or redeploy) the preview of `branch` for a signed-in user.
  async deploy(userId: string, organizationId: string, appId: string, branch: string) {
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

  // GitHub push to a non-production branch. Returns null when previews are
  // off / unsupported / over the limit (the push is simply not deployed).
  async deployFromWebhook(
    appId: string,
    branch: string,
    src: Omit<PreviewSource, 'trigger' | 'userId'>,
  ): Promise<{ previewId: string; url: string } | { skipped: string }> {
    if (!previewAutoDeploy()) return { skipped: 'PREVIEW_AUTO_DEPLOY is off' };
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: { project: { select: { organizationId: true, userId: true } } },
    });
    if (!app) return { skipped: 'app not found' };
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
      return { previewId: result.preview.id, url: buildAppUrl(result.preview.subdomain) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`preview for ${appId}@${branch} not deployed: ${msg}`);
      return { skipped: msg };
    }
  }

  private async deployBranch(
    app: {
      id: string;
      subdomain: string;
      type: string;
      source: string;
      repoUrl: string | null;
      branch: string | null;
      project: { organizationId: string };
    },
    rawBranch: string,
    src: PreviewSource,
  ) {
    const reason = this.unsupportedReason(app);
    if (reason) throw new BadRequestException({ code: 'PREVIEW_UNSUPPORTED', message: reason });
    const branch = (rawBranch ?? '').trim().replace(/^refs\/heads\//, '');
    if (!BRANCH_RE.test(branch)) {
      throw new BadRequestException({ code: 'BAD_BRANCH', message: 'That is not a valid branch name.' });
    }
    if (branch === (app.branch ?? 'main')) {
      throw new BadRequestException({
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
        throw new ConflictException({
          code: 'PREVIEW_BUSY',
          message: 'This preview is already deploying — wait for it to finish.',
        });
      }
    } else {
      const [appCount, orgCount] = await Promise.all([
        this.prisma.preview.count({ where: { appId: app.id } }),
        this.prisma.preview.count({
          where: { app: { project: { organizationId: app.project.organizationId } } },
        }),
      ]);
      if (appCount >= previewMaxPerApp()) {
        throw new BadRequestException({
          code: 'PREVIEW_LIMIT',
          message: `This app already has ${appCount} preview(s) (limit ${previewMaxPerApp()}). Delete one first.`,
        });
      }
      if (orgCount >= previewMaxPerOrg()) {
        throw new BadRequestException({
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

  // <app>-<branch-slug>, a valid DNS label (<= 63 chars) that no app or other
  // preview uses. Too long / taken → shortened slug + a short branch hash.
  private async allocateSubdomain(appSubdomain: string, branch: string): Promise<string> {
    const hash = crypto.createHash('sha1').update(branch).digest('hex').slice(0, 6);
    const slug = branchSlug(branch) || 'branch';
    const candidates: string[] = [];
    const plain = `${appSubdomain}-${slug}`;
    if (plain.length <= 63) candidates.push(plain);
    const room = Math.max(1, 63 - appSubdomain.length - hash.length - 2);
    candidates.push(`${appSubdomain}-${slug.slice(0, room).replace(/-+$/, '')}-${hash}`.slice(0, 63));
    for (const c of candidates) {
      const sub = c.replace(/-+$/, '');
      const [appHit, pvHit] = await Promise.all([
        this.prisma.app.findUnique({ where: { subdomain: sub }, select: { id: true } }),
        this.prisma.preview.findUnique({ where: { subdomain: sub }, select: { id: true } }),
      ]);
      if (!appHit && !pvHit) return sub;
    }
    throw new ConflictException({
      code: 'PREVIEW_HOST_TAKEN',
      message: 'Could not allocate a unique preview hostname for this branch.',
    });
  }

  async remove(userId: string, organizationId: string, appId: string, previewId: string) {
    await this.findAppForOrg(appId, organizationId);
    const preview = await this.prisma.preview.findFirst({ where: { id: previewId, appId } });
    if (!preview) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Preview not found' });
    await this.teardown(preview);
    await this.auditService.log({
      actorUserId: userId,
      action: 'app.preview.delete',
      target: appId,
      metadata: { previewId, branch: preview.branch, subdomain: preview.subdomain },
    });
    return { ok: true };
  }

  // GitHub push that deleted a branch → drop its preview.
  async removeForBranch(appId: string, branch: string): Promise<boolean> {
    const preview = await this.prisma.preview.findUnique({
      where: { appId_branch: { appId, branch } },
    });
    if (!preview) return false;
    await this.teardown(preview);
    await this.auditService.log({
      action: 'app.preview.delete.webhook',
      target: appId,
      metadata: { previewId: preview.id, branch, subdomain: preview.subdomain },
    });
    return true;
  }

  // Every preview of an app (app deletion).
  async removeAllForApp(appId: string): Promise<void> {
    const previews = await this.prisma.preview.findMany({ where: { appId } });
    for (const p of previews) await this.teardown(p);
  }

  // Remove everything a preview owns: queued jobs, container (and with it the
  // Traefik router, which lives in the container labels), health-check
  // candidate, images, throwaway DB, and its deployment rows + logs.
  private async teardown(preview: {
    id: string;
    subdomain: string;
    dbName: string | null;
    dbRoleName: string | null;
  }): Promise<void> {
    await this.deployService.cancelForPreview(preview.id).catch(() => 0);
    const name = `upande-preview-${preview.subdomain}`;
    for (const c of [name, `${name}-candidate`]) {
      await this.docker.getContainer(c).remove({ force: true }).catch(() => undefined);
    }
    try {
      const images = await this.docker.listImages({
        filters: { reference: [`upande-preview-${preview.subdomain}:*`] },
      });
      // Remove by TAG, not image id: identical builds share one image id with
      // other apps' tags, and removing the id would delete theirs too.
      const repo = `upande-preview-${preview.subdomain}:`;
      for (const tag of images.flatMap((i) => i.RepoTags ?? [])) {
        if (!tag.startsWith(repo)) continue;
        await this.docker.getImage(tag).remove({ force: true }).catch(() => undefined);
      }
    } catch (err) {
      this.logger.warn(`listing preview images failed: ${String(err)}`);
    }
    if (preview.dbName && preview.dbRoleName) {
      try {
        await this.dbProvision.dropPreviewDatabase(preview.dbName, preview.dbRoleName);
      } catch (err) {
        this.logger.warn(`dropping preview database ${preview.dbName} failed: ${String(err)}`);
      }
    }
    await this.prisma.$transaction([
      this.prisma.deployment.deleteMany({ where: { previewId: preview.id } }),
      this.prisma.preview.deleteMany({ where: { id: preview.id } }),
    ]);
  }
}
