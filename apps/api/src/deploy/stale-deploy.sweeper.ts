import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as Docker from 'dockerode';
import { PrismaService } from '../prisma/prisma.service';
import { DEPLOY_QUEUE } from './deploy.constants';
import { LogStoreService } from './log-store.service';

// Unsticks deployments left "queued" / "building" with no BullMQ job behind
// them (API restarted or crashed mid-deploy, a job removed while running,
// a failure outside the processor's try). Every STALE_DEPLOY_SWEEP_SECONDS
// (default 120) such deployments older than STALE_DEPLOY_MINUTES (default 5)
// are marked failed, and their app / preview gets a real status again: live
// when its container still serves, failed otherwise. Deployments that still
// have a job (waiting, delayed, active) are never touched.

@Injectable()
export class StaleDeploySweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StaleDeploySweeper.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logStore: LogStoreService,
    @InjectQueue(DEPLOY_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    const every = Math.max(30, Number(process.env.STALE_DEPLOY_SWEEP_SECONDS ?? 120) || 120) * 1000;
    // First pass shortly after boot (catches deploys interrupted by a restart).
    setTimeout(() => void this.sweep(), 30_000).unref();
    this.timer = setInterval(() => void this.sweep(), every);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async serving(name: string): Promise<boolean> {
    try {
      const i = await this.docker.getContainer(name).inspect();
      return !!i.State?.Running && !i.State?.Restarting;
    } catch {
      return false;
    }
  }

  async sweep(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const minutes = Math.max(1, Number(process.env.STALE_DEPLOY_MINUTES ?? 5) || 5);
      const cutoff = new Date(Date.now() - minutes * 60_000);
      const jobs = await this.queue.getJobs(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children']);
      const live = new Set(jobs.map((j) => (j?.data as { deploymentId?: string } | undefined)?.deploymentId).filter(Boolean));
      const stale = await this.prisma.deployment.findMany({
        where: { status: { in: ['queued', 'building'] }, createdAt: { lt: cutoff } },
        select: { id: true, appId: true, previewId: true },
        take: 200,
      });
      let fixed = 0;
      for (const d of stale) {
        if (live.has(d.id)) continue;
        const reason = 'Interrupted: the deploy stopped without finishing (API restart or worker crash)';
        const res = await this.prisma.deployment.updateMany({
          where: { id: d.id, status: { in: ['queued', 'building'] } },
          data: { status: 'failed', finishedAt: new Date(), errorReason: reason },
        });
        if (!res.count) continue;
        fixed += 1;
        await this.logStore.append(d.id, `@fail Deploy|${reason}`).catch(() => undefined);
        await this.logStore.persist(d.id).catch(() => undefined);
        await this.resetOwner(d.appId, d.previewId);
      }
      // Apps still "building" with no in-flight deployment at all.
      const apps = await this.prisma.app.findMany({
        where: { status: 'building', deployments: { none: { status: { in: ['queued', 'building'] }, previewId: null } } },
        select: { id: true },
        take: 200,
      });
      for (const a of apps) {
        await this.resetOwner(a.id, null);
        fixed += 1;
      }
      if (fixed) this.logger.warn(`Unstuck ${fixed} interrupted deployment(s) / app(s)`);
      return fixed;
    } catch (err) {
      this.logger.warn(`stale deploy sweep failed: ${String(err)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async resetOwner(appId: string, previewId: string | null) {
    if (previewId) {
      const pv = await this.prisma.preview.findUnique({ where: { id: previewId }, select: { subdomain: true, status: true } });
      if (!pv || (pv.status !== 'queued' && pv.status !== 'building')) return;
      const inflight = await this.prisma.deployment.count({ where: { previewId, status: { in: ['queued', 'building'] } } });
      if (inflight) return;
      const up = await this.serving(`upande-preview-${pv.subdomain}`);
      await this.prisma.preview.updateMany({ where: { id: previewId }, data: { status: up ? 'live' : 'failed' } });
      return;
    }
    const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { subdomain: true, status: true } });
    if (!app || app.status !== 'building') return;
    const inflight = await this.prisma.deployment.count({
      where: { appId, previewId: null, status: { in: ['queued', 'building'] } },
    });
    if (inflight) return;
    const up = await this.serving(`upande-${app.subdomain}`);
    await this.prisma.app.updateMany({ where: { id: appId, status: 'building' }, data: { status: up ? 'live' : 'failed' } });
  }
}
