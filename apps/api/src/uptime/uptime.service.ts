import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Docker from 'dockerode';
import { PrismaService } from '../prisma/prisma.service';
import { healthConfigFor, probeHttp } from '../common/health-probe.util';
import { NODERED_PORT } from '../apps/nodered';
import {
  UPTIME_RANGES,
  UptimeRange,
  uptimeConcurrency,
  uptimeIntervalSec,
  uptimeMaxTimeoutMs,
  uptimeRetentionDays,
} from './uptime.constants';

// Port app containers listen on (see APP_LISTEN_PORT in deploy.processor.ts).
const APP_LISTEN_PORT = 8080;

interface ProbeOutcome {
  up: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
}

export interface UptimeBucket {
  t: string;
  checks: number;
  up: number;
  // null = no checks in this bucket (no data, not downtime).
  upRatio: number | null;
  avgLatencyMs: number | null;
}

@Injectable()
export class UptimeService {
  private readonly logger = new Logger(UptimeService.name);
  private readonly docker = new Docker({ socketPath: '/var/run/docker.sock' });

  constructor(private readonly prisma: PrismaService) {}

  // ── Monitor ──────────────────────────────────────────────────────────
  // Probe every production app that should be serving (status "live" — a
  // failed redeploy whose previous version kept serving stays "live"). Stopped,
  // idle, failed and building apps are skipped; previews are not monitored.
  async runChecks(): Promise<{ checked: number; down: number }> {
    const apps = await this.prisma.app.findMany({
      where: { status: 'live' },
      select: {
        id: true,
        type: true,
        subdomain: true,
        healthCheckPath: true,
        healthCheckTimeout: true,
        healthCheckRetries: true,
      },
    });
    if (!apps.length) return { checked: 0, down: 0 };
    const checkedAt = new Date();
    const results: Prisma.UptimeCheckCreateManyInput[] = [];
    let next = 0;
    const worker = async () => {
      while (next < apps.length) {
        const app = apps[next++];
        const r = await this.checkApp(app);
        results.push({ appId: app.id, checkedAt, ...r });
      }
    };
    await Promise.all(Array.from({ length: Math.min(uptimeConcurrency(), apps.length) }, worker));
    // An app may have been deleted mid-run; skip rows whose app is gone.
    const existing = new Set(
      (await this.prisma.app.findMany({ where: { id: { in: results.map((r) => r.appId) } }, select: { id: true } })).map(
        (a) => a.id,
      ),
    );
    const rows = results.filter((r) => existing.has(r.appId));
    await this.prisma.uptimeCheck.createMany({ data: rows });
    return { checked: rows.length, down: rows.filter((r) => !r.up).length };
  }

  async checkApp(app: {
    type: string;
    subdomain: string;
    healthCheckPath: string | null;
    healthCheckTimeout: number;
    healthCheckRetries: number;
  }): Promise<ProbeOutcome> {
    const health = healthConfigFor(app);
    health.timeoutMs = Math.min(health.timeoutMs, uptimeMaxTimeoutMs());
    const port = app.type === 'nodered' ? NODERED_PORT : APP_LISTEN_PORT;
    const network = process.env.DOCKER_NETWORK ?? 'upande_net';
    let info: Docker.ContainerInspectInfo;
    try {
      info = await this.docker.getContainer(`upande-${app.subdomain}`).inspect();
    } catch {
      return { up: false, statusCode: null, latencyMs: null, error: 'container not found' };
    }
    if (info.State.Restarting) {
      return { up: false, statusCode: null, latencyMs: null, error: 'container is restarting (crash loop)' };
    }
    if (!info.State.Running) {
      const oom = info.State.OOMKilled ? ', out of memory' : '';
      return {
        up: false,
        statusCode: null,
        latencyMs: null,
        error: `container is not running (${info.State.Status}, exit code ${info.State.ExitCode}${oom})`,
      };
    }
    const nets = info.NetworkSettings?.Networks ?? {};
    const ip = nets[network]?.IPAddress || Object.values(nets).find((n) => n.IPAddress)?.IPAddress;
    if (!ip) return { up: false, statusCode: null, latencyMs: null, error: 'container has no network address' };
    const url = `http://${ip}:${port}${health.path}`;
    let probe = await probeHttp(url, health);
    // One quick retry so a single dropped connection isn't recorded as an outage.
    if (!probe.ok) {
      await new Promise((r) => setTimeout(r, 1000));
      probe = await probeHttp(url, health);
    }
    if (probe.ok) return { up: true, statusCode: probe.status, latencyMs: probe.latencyMs, error: null };
    return {
      up: false,
      statusCode: probe.status,
      latencyMs: probe.latencyMs,
      error: `GET ${health.path} ${probe.reason}`.slice(0, 500),
    };
  }

  async pruneOld(): Promise<number> {
    const cutoff = new Date(Date.now() - uptimeRetentionDays() * 24 * 3600 * 1000);
    const { count } = await this.prisma.uptimeCheck.deleteMany({ where: { checkedAt: { lt: cutoff } } });
    return count;
  }

  // ── Queries ──────────────────────────────────────────────────────────
  private window(range: UptimeRange) {
    const { spanSec, bucketSec } = UPTIME_RANGES[range];
    const count = Math.round(spanSec / bucketSec);
    const nowBucket = Math.floor(Date.now() / 1000 / bucketSec);
    const firstBucket = nowBucket - count + 1;
    return { bucketSec, count, firstBucket, start: new Date(firstBucket * bucketSec * 1000) };
  }

  private async bucketRows(range: UptimeRange, appId?: string): Promise<{ buckets: UptimeBucket[]; checks: number; up: number; start: Date }> {
    const w = this.window(range);
    const rows = await this.prisma.$queryRaw<{ b: number; n: number; ups: number; lat: number | null }[]>`
      SELECT floor(extract(epoch from "checkedAt") / ${w.bucketSec})::int AS b,
             count(*)::int AS n,
             count(*) FILTER (WHERE up)::int AS ups,
             avg("latencyMs") FILTER (WHERE up)::float8 AS lat
      FROM "UptimeCheck"
      WHERE "checkedAt" >= ${w.start} ${appId ? Prisma.sql`AND "appId" = ${appId}` : Prisma.empty}
      GROUP BY b`;
    const byBucket = new Map(rows.map((r) => [Number(r.b), r]));
    let checks = 0;
    let up = 0;
    const buckets: UptimeBucket[] = [];
    for (let i = 0; i < w.count; i++) {
      const b = w.firstBucket + i;
      const r = byBucket.get(b);
      const n = r ? Number(r.n) : 0;
      const u = r ? Number(r.ups) : 0;
      checks += n;
      up += u;
      buckets.push({
        t: new Date(b * w.bucketSec * 1000).toISOString(),
        checks: n,
        up: u,
        upRatio: n ? u / n : null,
        avgLatencyMs: r?.lat != null ? Math.round(Number(r.lat)) : null,
      });
    }
    return { buckets, checks, up, start: w.start };
  }

  async getAppUptime(appId: string, organizationId: string, range: UptimeRange) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      select: { id: true, status: true, project: { select: { organizationId: true } } },
    });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    if (app.project.organizationId !== organizationId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Access denied' });
    }
    return this.buildAppUptime(app.id, app.status, range);
  }

  async buildAppUptime(appId: string, appStatus: string, range: UptimeRange) {
    const { buckets, checks, up, start } = await this.bucketRows(range, appId);
    const [latest, incidents, latencyStats, statusCodes, errors] = await Promise.all([
      this.prisma.uptimeCheck.findFirst({ where: { appId }, orderBy: { checkedAt: 'desc' } }),
      this.incidents(appId, start, appStatus),
      this.latencyStats(appId, start),
      this.prisma.$queryRaw<{ code: number | null; n: number }[]>`
        SELECT "statusCode" AS code, count(*)::int AS n FROM "UptimeCheck"
        WHERE "appId" = ${appId} AND "checkedAt" >= ${start}
        GROUP BY "statusCode" ORDER BY n DESC`,
      this.prisma.$queryRaw<{ error: string; n: number; last: Date }[]>`
        SELECT error, count(*)::int AS n, max("checkedAt") AS last FROM "UptimeCheck"
        WHERE "appId" = ${appId} AND "checkedAt" >= ${start} AND NOT up AND error IS NOT NULL
        GROUP BY error ORDER BY n DESC LIMIT 10`,
    ]);
    const lat = buckets.filter((b) => b.avgLatencyMs != null);
    const totalUp = buckets.reduce((s, b) => s + (b.avgLatencyMs != null ? b.up : 0), 0);
    return {
      range,
      bucketSeconds: UPTIME_RANGES[range].bucketSec,
      intervalSeconds: uptimeIntervalSec(),
      uptimePct: checks ? Math.round((up / checks) * 100000) / 1000 : null,
      checks,
      avgLatencyMs: totalUp
        ? Math.round(lat.reduce((s, b) => s + b.avgLatencyMs! * b.up, 0) / totalUp)
        : null,
      current: {
        state: appStatus !== 'live' ? 'paused' : !latest ? 'unknown' : latest.up ? 'up' : 'down',
        appStatus,
        checkedAt: latest?.checkedAt ?? null,
        statusCode: latest?.statusCode ?? null,
        latencyMs: latest?.latencyMs ?? null,
        error: latest?.error ?? null,
      },
      // Response-time distribution over successful checks in the range.
      latency: latencyStats,
      // How checks answered: HTTP status code (null = no response at all).
      statusCodes: statusCodes.map((r) => ({ code: r.code, count: Number(r.n) })),
      // Most common reasons the app was down.
      errors: errors.map((r) => ({ error: r.error, count: Number(r.n), lastSeenAt: r.last })),
      series: buckets,
      incidents,
    };
  }

  private async latencyStats(appId: string, start: Date) {
    const [r] = await this.prisma.$queryRaw<
      { p50: number | null; p95: number | null; max: number | null; min: number | null }[]
    >`
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs")::float8 AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float8 AS p95,
             max("latencyMs")::float8 AS max, min("latencyMs")::float8 AS min
      FROM "UptimeCheck"
      WHERE "appId" = ${appId} AND "checkedAt" >= ${start} AND up AND "latencyMs" IS NOT NULL`;
    const round = (v: number | null | undefined) => (v == null ? null : Math.round(Number(v)));
    return { p50: round(r?.p50), p95: round(r?.p95), max: round(r?.max), min: round(r?.min) };
  }

  // Admin: one site's full analysis (any org).
  async getAppAnalysisAdmin(appId: string, range: UptimeRange) {
    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      select: {
        id: true,
        name: true,
        subdomain: true,
        type: true,
        status: true,
        project: { select: { organization: { select: { id: true, name: true } } } },
      },
    });
    if (!app) throw new NotFoundException({ code: 'NOT_FOUND', message: 'App not found' });
    return {
      app: {
        id: app.id,
        name: app.name,
        subdomain: app.subdomain,
        type: app.type,
        status: app.status,
        organizationId: app.project.organization.id,
        organizationName: app.project.organization.name,
      },
      ...(await this.buildAppUptime(app.id, app.status, range)),
    };
  }

  // Contiguous runs of down checks (gaps-and-islands: each up check starts a
  // new group, so the down checks sharing a group are one incident). The
  // incident ends at the first up check after it; still open if none yet.
  private async incidents(appId: string, start: Date, appStatus: string) {
    const rows = await this.prisma.$queryRaw<
      { started: Date; lastDown: Date; ended: Date | null; checks: number; reason: string | null; isLatest: boolean }[]
    >`
      WITH c AS (
        SELECT "checkedAt", up, error,
               count(*) FILTER (WHERE up) OVER (ORDER BY "checkedAt") AS grp
        FROM "UptimeCheck"
        WHERE "appId" = ${appId} AND "checkedAt" >= ${start}
      ),
      d AS (
        SELECT grp, min("checkedAt") AS started, max("checkedAt") AS "lastDown", count(*)::int AS checks,
               (array_agg(error ORDER BY "checkedAt"))[1] AS reason
        FROM c WHERE NOT up GROUP BY grp
      ),
      e AS (SELECT grp, min("checkedAt") AS ended FROM c WHERE up GROUP BY grp)
      SELECT d.started, d."lastDown", e.ended, d.checks, d.reason,
             d."lastDown" = (SELECT max("checkedAt") FROM c) AS "isLatest"
      FROM d LEFT JOIN e ON e.grp = d.grp + 1
      ORDER BY d.started DESC
      LIMIT 50`;
    const now = Date.now();
    return rows.map((r) => {
      const ongoing = !r.ended && r.isLatest && appStatus === 'live';
      const end = r.ended ?? (ongoing ? null : r.lastDown);
      return {
        start: r.started,
        end,
        ongoing,
        durationSeconds: Math.max(0, Math.round(((end ? new Date(end).getTime() : now) - new Date(r.started).getTime()) / 1000)),
        checks: Number(r.checks),
        reason: r.reason,
      };
    });
  }

  // Admin: per-app uptime across the platform plus a platform-wide series.
  async getPlatformUptime(range: UptimeRange) {
    const { buckets, checks, up, start } = await this.bucketRows(range);
    const perApp = await this.prisma.$queryRaw<
      {
        appId: string;
        n: number;
        ups: number;
        lat: number | null;
        downs: number;
        p50: number | null;
        p95: number | null;
        lmax: number | null;
      }[]
    >`
      SELECT "appId", count(*)::int AS n, count(*) FILTER (WHERE up)::int AS ups,
             avg("latencyMs") FILTER (WHERE up)::float8 AS lat,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE up)::float8 AS p50,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs") FILTER (WHERE up)::float8 AS p95,
             max("latencyMs") FILTER (WHERE up)::float8 AS lmax,
             count(*) FILTER (WHERE NOT up)::int AS downs
      FROM "UptimeCheck" WHERE "checkedAt" >= ${start} GROUP BY "appId"`;
    const latest = await this.prisma.$queryRaw<
      {
        appId: string;
        up: boolean;
        checkedAt: Date;
        error: string | null;
        statusCode: number | null;
        latencyMs: number | null;
      }[]
    >`
      SELECT DISTINCT ON ("appId") "appId", up, "checkedAt", error, "statusCode", "latencyMs"
      FROM "UptimeCheck" WHERE "checkedAt" >= ${start}
      ORDER BY "appId", "checkedAt" DESC`;
    // Average response time per site per bucket, for the "latency per site" chart.
    const w = this.window(range);
    const latRows = await this.prisma.$queryRaw<{ appId: string; b: number; lat: number | null }[]>`
      SELECT "appId", floor(extract(epoch from "checkedAt") / ${w.bucketSec})::int AS b,
             avg("latencyMs") FILTER (WHERE up)::float8 AS lat
      FROM "UptimeCheck" WHERE "checkedAt" >= ${w.start}
      GROUP BY "appId", b`;
    const ids = new Set(perApp.map((p) => p.appId));
    const apps = await this.prisma.app.findMany({
      where: { OR: [{ status: 'live' }, { id: { in: [...ids] } }] },
      select: {
        id: true,
        name: true,
        subdomain: true,
        type: true,
        status: true,
        project: { select: { organization: { select: { id: true, name: true } } } },
      },
    });
    const statsBy = new Map(perApp.map((p) => [p.appId, p]));
    const latestBy = new Map(latest.map((l) => [l.appId, l]));
    const rows = apps
      .map((a) => {
        const s = statsBy.get(a.id);
        const l = latestBy.get(a.id);
        return {
          appId: a.id,
          name: a.name,
          subdomain: a.subdomain,
          type: a.type,
          appStatus: a.status,
          organizationId: a.project.organization.id,
          organizationName: a.project.organization.name,
          checks: s ? Number(s.n) : 0,
          downChecks: s ? Number(s.downs) : 0,
          uptimePct: s && s.n ? Math.round((Number(s.ups) / Number(s.n)) * 100000) / 1000 : null,
          avgLatencyMs: s?.lat != null ? Math.round(Number(s.lat)) : null,
          // Response-time distribution of successful probes over the range, and
          // the latest probe's time.
          latency: {
            p50: s?.p50 != null ? Math.round(Number(s.p50)) : null,
            p95: s?.p95 != null ? Math.round(Number(s.p95)) : null,
            max: s?.lmax != null ? Math.round(Number(s.lmax)) : null,
          },
          lastLatencyMs: l?.up && l.latencyMs != null ? Number(l.latencyMs) : null,
          state: a.status !== 'live' ? 'paused' : !l ? 'unknown' : l.up ? 'up' : 'down',
          lastCheckedAt: l?.checkedAt ?? null,
          lastError: l && !l.up ? l.error : null,
        };
      })
      .sort((x, y) => (x.uptimePct ?? 101) - (y.uptimePct ?? 101) || x.name.localeCompare(y.name));
    return {
      range,
      bucketSeconds: UPTIME_RANGES[range].bucketSec,
      uptimePct: checks ? Math.round((up / checks) * 100000) / 1000 : null,
      checks,
      monitored: rows.filter((r) => r.appStatus === 'live').length,
      downNow: rows.filter((r) => r.state === 'down').length,
      series: buckets,
      // One row per bucket: { t, latency: { [appId]: avg ms | null } }.
      latencyBySite: (() => {
        const byBucket = new Map<number, Record<string, number>>();
        for (const r of latRows) {
          if (r.lat == null) continue;
          const b = Number(r.b);
          const m = byBucket.get(b) ?? {};
          m[r.appId] = Math.round(Number(r.lat));
          byBucket.set(b, m);
        }
        return Array.from({ length: w.count }, (_, i) => {
          const b = w.firstBucket + i;
          return { t: new Date(b * w.bucketSec * 1000).toISOString(), latency: byBucket.get(b) ?? {} };
        });
      })(),
      apps: rows,
    };
  }
}
