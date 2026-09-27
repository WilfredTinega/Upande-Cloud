import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as path from 'path';
import * as fs from 'fs';
import { execSync, execFile } from 'child_process';
import * as Docker from 'dockerode';
import simpleGit from 'simple-git';
import { PrismaService } from '../prisma/prisma.service';
import { LogStoreService } from './log-store.service';
import { DEPLOY_QUEUE } from './deploy.constants';
import { decrypt } from '../common/encrypt.util';
import { effectiveEnvVars } from '../common/env-scope.util';
import { isAllowedRepoUrl } from '../common/repo-url.util';
import { applyPreviewAuth, withRetryMiddleware } from '../common/preview-auth.util';
import {
  buildAppUrl,
  buildSubdomainRouterLabels,
  appSubdomainHost,
} from '../common/app-url.util';
import { appUploadDir } from '../common/upload-path.util';
import { DbProvisionService } from '../database/db-provision.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EMPTY_CONTENT_HTML_B64 } from './empty-content-page';
import { HealthConfig, healthConfigFor, probeHttp } from '../common/health-probe.util';
import {
  NODERED_IMAGE,
  NODERED_PORT,
  NODERED_DATA_DIR,
  NODERED_UID,
  NODERED_GID,
  renderNodeRedSettings,
} from '../apps/nodered';
import { BuildCacheService } from './build-cache.service';
import { GithubReporterService } from '../github/github-reporter.service';
import {
  BuildOutputCacheCounter,
  buildCacheEnabled,
  buildCacheScope,
  detectNodeBuild,
  formatBytes,
  nodeBuilderStage,
} from './build-cache.util';

// Port that static/dynamic/fullstack app containers listen on and Traefik
// routes to. Unprivileged so images running as a non-root user can bind it.
// The platform injects PORT=this and the generated nginx fallback listens here.
const APP_LISTEN_PORT = 8080;

export interface DeployJobData {
  deploymentId: string;
  appId: string;
  ref?: string;
  // Migrate: force a clean rebuild (no cache) and perform a rollback-safe
  // container swap that restores the previous container if the swap fails, so
  // the site never goes down.
  forceClean?: boolean;
  // "Clear build cache & redeploy": a forceClean deploy requested for the
  // cache (only changes the log wording).
  clearCache?: boolean;
  // Rollback: the image tag the source deployment ran. Reused as-is (no
  // rebuild) when it still exists locally — see IMAGE_RETENTION_COUNT.
  rollbackImage?: string;
  // Rollback: the exact commit to rebuild when the image has been pruned.
  commitSha?: string;
  // Preview deploy of a non-production branch (Preview row id): own
  // container/image/router/DB, never touches the production container.
  previewId?: string;
  // Promote to production: the preview branch whose image (rollbackImage,
  // re-tagged into the production repo) is started with PRODUCTION env/DB.
  promoteFrom?: string;
}

// A deploy failure that retrying cannot fix (bad rollback target, failed
// health check, ...). Skips BullMQ's retry-with-clean-cache attempts.
export class DeployAbortError extends Error {}

// The deployment was cancelled, or its app / preview deleted, while it ran.
// Nothing to record: the canceller already set the terminal state.
export class DeployCancelledError extends DeployAbortError {}

// How many of an app's most recent successful images to keep on disk so a
// rollback can reuse them instantly. Older ones are pruned after each deploy.
export function imageRetentionCount(): number {
  const n = Number(process.env.IMAGE_RETENTION_COUNT ?? 5);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
}

@Processor(DEPLOY_QUEUE)
export class DeployProcessor extends WorkerHost {
  private docker: Docker;

  constructor(
    private readonly prisma: PrismaService,
    private readonly logStore: LogStoreService,
    private readonly dbProvision: DbProvisionService,
    private readonly notifications: NotificationsService,
    private readonly buildCache: BuildCacheService,
    private readonly githubReporter: GithubReporterService,
  ) {
    super();
    this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
  }

  async process(job: Job<DeployJobData>): Promise<void> {
    const { deploymentId, appId } = job.data;

    // BullMQ retries failed jobs (see DeployService.enqueue). attemptsMade is 0
    // on the first run, 1 on the first retry, etc.
    const maxAttempts = job.opts.attempts ?? 1;
    const attempt = job.attemptsMade + 1;
    const isRetry = job.attemptsMade > 0;
    // Migrate forces a clean build from the very first attempt. A retry always
    // builds clean too. Either one means: prune caches + build with --no-cache.
    const forceClean = job.data.forceClean === true;
    const cleanBuild = isRetry || forceClean;
    const startedAt = Date.now();

    await this.info(
      deploymentId,
      attempt > 1
        ? `Build started (attempt ${attempt} of ${maxAttempts})`
        : 'Build started',
    );
    this.debug(deploymentId, `deployment=${deploymentId} job.id=${job.id} appId=${appId} ref=${job.data.ref ?? '(default)'}`);
    this.debug(
      deploymentId,
      `runtime: node=${process.version} platform=${process.platform} arch=${process.arch} pid=${process.pid}`,
    );
    this.debug(
      deploymentId,
      `env: DOCKER_NETWORK=${process.env.DOCKER_NETWORK ?? 'upande_net'} NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`,
    );

    await this.prisma.deployment.update({
      where: { id: deploymentId },
      // startedAt marks the first attempt; retries keep the original start so
      // the recorded duration covers the whole deploy.
      data: { status: 'building', ...(isRetry ? {} : { startedAt: new Date() }) },
    });

    const app = await this.prisma.app.findUnique({
      where: { id: appId },
      include: {
        envVars: true,
        project: { select: { userId: true } },
        customDomains: { where: { status: 'verified' } },
        noderedUsers: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!app) {
      // Missing app is not transient — fail permanently, do not retry.
      await this.stageFail(deploymentId, 'Initializing', 'App not found');
      await this.markFailed(deploymentId, appId, 'App not found', 'Initializing');
      return;
    }

    // ── Preview deploy (non-production branch) ──────────────────────────
    // Same pipeline, but its own container / image repo / Traefik router and
    // (for DB-backed apps) its own throwaway database. Never touches the
    // production container, app status, rollback images or database.
    const preview = job.data.previewId
      ? await this.prisma.preview.findUnique({ where: { id: job.data.previewId } })
      : null;
    if (job.data.previewId && (!preview || app.type === 'nodered' || app.source !== 'git')) {
      const why = !preview
        ? 'The preview was deleted'
        : 'Preview deploys need a git-sourced app (not Node-RED)';
      await this.stageFail(deploymentId, 'Initializing', why);
      await this.markFailed(deploymentId, appId, why, 'Initializing', job.data.previewId);
      return;
    }
    if (preview) {
      await this.prisma.preview.update({
        where: { id: preview.id },
        data: { status: 'building', lastDeploymentId: deploymentId },
      });
      await this.info(
        deploymentId,
        `Preview of branch ${preview.branch} → ${buildAppUrl(preview.subdomain)} (separate container, isolated from production)`,
      );
    }
    // Environment-scoped env vars: production gets all+production, previews
    // all+preview (a scoped value beats the `all` one for the same key).
    // Any DATABASE_URL (whatever its scope) still marks the app as DB-backed,
    // so its previews keep getting a throwaway database.
    const anyDatabaseUrl = app.envVars.some((v) => v.key === 'DATABASE_URL');
    app.envVars = effectiveEnvVars(app.envVars, preview ? 'preview' : 'production');
    const imageRepo = preview ? `upande-preview-${preview.subdomain}` : `upande-app-${app.subdomain}`;

    this.debug(
      deploymentId,
      `app: name=${app.name} subdomain=${app.subdomain} type=${app.type} source=${app.source} branch=${app.branch ?? 'main'}`,
    );
    this.debug(
      deploymentId,
      `app config: buildCmd=${app.buildCmd ?? '(default)'} outputDir=${app.outputDir ?? 'dist'} envVars=${app.envVars.length} github=${app.githubRepoFullName ?? '(none)'}`,
    );

    const workDir = `/tmp/upande-build-${deploymentId}`;
    let currentStage = 'Initializing';

    try {
      // ── Stage: Preparing ──────────────────────────────────────────────
      currentStage = 'Preparing';
      const prepStart = Date.now();
      await this.stageStart(deploymentId, currentStage);
      if (isRetry) {
        await this.info(deploymentId, `Retry ${job.attemptsMade}: clearing build cache`);
        await this.clearCaches(deploymentId, imageRepo, app.id);
      } else if (forceClean) {
        await this.info(
          deploymentId,
          job.data.clearCache
            ? 'Clear build cache & redeploy: removing this app\'s build cache'
            : 'Migrate: clean rebuild — clearing build cache',
        );
        await this.clearCaches(deploymentId, imageRepo, app.id);
      }
      this.debug(deploymentId, `work dir ${workDir}`);
      if (fs.existsSync(workDir)) {
        this.debug(deploymentId, 'removing stale work dir');
        fs.rmSync(workDir, { recursive: true, force: true });
      }
      fs.mkdirSync(workDir, { recursive: true });
      await this.stageOk(deploymentId, currentStage, prepStart);

      // ── Rollback: reuse the previously built image when it still exists ──
      let reuseImage: string | null = null;
      if (job.data.rollbackImage && app.type !== 'nodered' && !preview) {
        if (await this.imageExists(job.data.rollbackImage)) {
          reuseImage = job.data.rollbackImage;
          await this.info(
            deploymentId,
            job.data.promoteFrom
              ? `Promote: reusing the preview image of ${job.data.promoteFrom} as ${reuseImage} (no rebuild, production env)`
              : `Rollback: reusing the previously built image ${reuseImage} (no rebuild)`,
          );
        } else if (app.source === 'git' && job.data.commitSha) {
          await this.info(
            deploymentId,
            `Rollback: image ${job.data.rollbackImage} was pruned — rebuilding commit ${job.data.commitSha.slice(0, 7)}`,
          );
        } else {
          throw new DeployAbortError(
            app.source === 'upload'
              ? 'The image for that version was pruned and uploaded sources are not versioned, so it cannot be rebuilt. Upload the files again and deploy.'
              : 'The image for that version was pruned and its commit is unknown, so it cannot be rebuilt exactly.',
          );
        }
      }

      // ── Stage: Cloning repository ─────────────────────────────────────
      // Node-RED apps have no source repo — they run the official image — so
      // there is nothing to clone or copy.
      if (reuseImage) {
        this.debug(deploymentId, 'skipping source checkout (image reused)');
      } else if (app.type === 'nodered') {
        await this.info(
          deploymentId,
          'Node-RED app — running the official image (no source build)',
        );
      } else if (app.source === 'git' && app.repoUrl) {
        currentStage = 'Cloning repository';
        const cloneStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        // An explicit ref on the job (API/webhook) wins over the app's branch.
        const branch = preview?.branch || job.data.ref || app.branch || 'main';
        await this.info(deploymentId, `${app.repoUrl} (branch ${branch})`);
        this.debug(deploymentId, `git clone --depth 1 --branch ${branch} (token redacted)`);
        const cloneUrl = await this.authenticatedCloneUrl(app);
        if (job.data.commitSha) {
          // Pinned commit (rollback rebuild): fetch exactly that commit.
          await this.info(deploymentId, `Checking out commit ${job.data.commitSha}`);
          await this.checkoutCommit(workDir, cloneUrl, job.data.commitSha);
        } else {
          const git = simpleGit();
          await git.clone(cloneUrl, workDir, ['--depth', '1', '--branch', branch]);
        }
        this.debug(deploymentId, `cloned files: ${this.listDir(workDir)}`);
        await this.recordCommit(deploymentId, workDir);
        await this.stageOk(deploymentId, currentStage, cloneStart);
        // GitHub-connected apps: commit status "pending" (+ PR comment for
        // previews). Best-effort — never fails the deploy.
        await this.githubReporter.reportDeployment(deploymentId, 'pending', {
          log: (l) => this.info(deploymentId, l),
        });
      } else if (app.source === 'upload') {
        currentStage = 'Copying uploaded files';
        const copyStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        const srcDir = appUploadDir(app.id);
        if (!fs.existsSync(srcDir) || fs.readdirSync(srcDir).length === 0) {
          throw new Error(
            'No uploaded files found for this app. Upload your code folder, then deploy.',
          );
        }
        // Copy the uploaded source tree into the build work dir.
        fs.cpSync(srcDir, workDir, { recursive: true });
        await this.info(deploymentId, `copied uploaded files: ${this.listDir(workDir)}`);
        await this.stageOk(deploymentId, currentStage, copyStart);
      } else {
        await this.info(deploymentId, 'No source configured — nothing to build');
      }

      // ── Stage: Building image ─────────────────────────────────────────
      // Each app type has a different "build": Node-RED pulls the official
      // image (no build); everything else runs nixpacks/Dockerfile. Name the stage after what is
      // actually happening so the deploy log reads true to the process.
      let imageTag: string;
      if (reuseImage) {
        currentStage = 'Reusing image';
        const reuseStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        imageTag = reuseImage;
        await this.info(deploymentId, `Image ready: ${imageTag}`);
        await this.stageOk(deploymentId, currentStage, reuseStart);
      } else if (app.type === 'nodered') {
        // Node-RED runs the official image directly — there is nothing to
        // build, so the stage is the image pull. ensureImage streams real
        // pull progress (layer-by-layer) under this stage.
        currentStage = 'Pulling Node-RED image';
        const pullStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        await this.ensureImage(deploymentId, NODERED_IMAGE, true);
        imageTag = NODERED_IMAGE;
        await this.info(deploymentId, `Image ready: ${NODERED_IMAGE}`);
        await this.stageOk(deploymentId, currentStage, pullStart);
      } else {
        currentStage = 'Building';
        const buildStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        imageTag = `${imageRepo}:${deploymentId}`;
        this.debug(deploymentId, `image tag: ${imageTag}`);
        await this.buildImage(deploymentId, workDir, imageTag, app, cleanBuild);
        await this.stageOk(deploymentId, currentStage, buildStart);
      }

      // Shared container parameters. The image was built above while the old
      // container kept serving (no downtime during the long build). Per-type
      // provisioning (DB, Node-RED settings) runs in its own stage
      // below; the rollback-safe container swap is the final stage.
      const containerName = preview
        ? `upande-preview-${preview.subdomain}`
        : `upande-${app.subdomain}`;

      // The port Traefik proxies to, per app type:
      //   nodered  → editor on 1880
      //   else (static / dynamic / fullstack) → APP_LISTEN_PORT (8080).
      // 8080 (not 80) is deliberate: it's unprivileged, so the app works whether
      // its image runs as root or a non-root user. Both the generated nginx
      // fallback and a repo's own Node server are made to listen here:
      //   - the platform injects PORT=<containerPort> below (PaaS convention),
      //   - the generated fallback templates `listen $PORT` from it.
      // A server app (dynamic / full stack) whose env sets a numeric PORT
      // listens there, so route + health-check that port instead of 8080
      // (otherwise Traefik hits a closed port → 502). Static sites are served
      // by the platform's nginx on 8080 regardless.
      const userPort = Number(app.envVars.find((v) => v.key === 'PORT')?.value?.trim());
      const containerPort =
        app.type === 'nodered'
          ? NODERED_PORT
          : app.type !== 'static' && Number.isInteger(userPort) && userPort > 0 && userPort < 65536
            ? userPort
            : APP_LISTEN_PORT;
      // Every app type — Node-RED included — is routed by Traefik on its
      // subdomain (container :containerPort behind <subdomain>.<BASE_DOMAIN>), so
      // the public URL stays clean with no host port.
      // Previews get only their own <app>-<branch> router (no custom domains).
      let labels = preview
        ? this.buildPreviewLabels(preview.subdomain, containerPort, app.id, preview.id)
        : this.buildTraefikLabels(app.subdomain, containerPort, app.customDomains);
      // Password-protected previews: basicAuth on the preview router only
      // (read now, after the build, so a recent password change is applied).
      if (preview) {
        const protection = await this.prisma.previewProtection.findUnique({ where: { appId: app.id } });
        labels = applyPreviewAuth(labels, preview.subdomain, protection);
        if (protection) await this.info(deploymentId, 'Preview is password-protected');
      }
      // Retry middleware for the zero-downtime overlap swap (see below).
      if (app.type !== 'nodered') labels = withRetryMiddleware(labels, containerName);
      const networkMode = process.env.DOCKER_NETWORK ?? 'upande_net';
      // Previews never inherit a DATABASE_URL (it may be production's) — a
      // DB-backed preview gets its own throwaway database below.
      const previewNeedsDb =
        !!preview && (app.type === 'fullstack' || anyDatabaseUrl);
      const envList = app.envVars
        .filter((v) => !(preview && v.key === 'DATABASE_URL'))
        .map((v) => `${v.key}=${v.value}`);
      if (preview) {
        envList.push('UPANDE_PREVIEW=true', `UPANDE_PREVIEW_BRANCH=${preview.branch}`);
      }
      // Make the app listen on the SAME port Traefik routes to. A $PORT-honouring
      // server (the PaaS convention, used by the generated fallback and most Node
      // apps) then binds the right port; without this it picks its own default
      // (e.g. 3000/8000) that won't match containerPort → 502 Bad Gateway.
      // Node-RED listens on a fixed port, so skip it. A
      // user-set PORT env var always wins (we never override an explicit value).
      if (app.type !== 'nodered' && !app.envVars.some((v) => v.key === 'PORT')) {
        envList.push(`PORT=${containerPort}`);
      }
      // Extra HostConfig bits populated per app type (Node-RED needs a
      // persistent volume bind for its data dir).
      const extraBinds: string[] = [];

      // ── Per-app database ──────────────────────────────────────────────
      // Full-stack apps get a managed database provisioned inside the shared
      // Postgres server (reuse the platform's Postgres). The connection string
      // is injected as DATABASE_URL unless the user already set one explicitly.
      if (preview) {
        if (previewNeedsDb) {
          currentStage = 'Provisioning preview database';
          const dbStart = Date.now();
          await this.stageStart(deploymentId, currentStage);
          try {
            const db = await this.dbProvision.ensureForPreview(preview.id, preview.subdomain);
            envList.push(`DATABASE_URL=${this.dbProvision.buildAppDatabaseUrl(db)}`);
            await this.info(
              deploymentId,
              `Throwaway preview database ready: ${db.dbName} (the production database is never used by previews)`,
            );
            await this.stageOk(deploymentId, currentStage, dbStart);
          } catch (dbErr: unknown) {
            const reason = dbErr instanceof Error ? dbErr.message : String(dbErr);
            throw new Error(`Preview database provisioning failed: ${reason}`);
          }
        }
      } else if (app.type === 'fullstack') {
        const userSetDbUrl = app.envVars.some((v) => v.key === 'DATABASE_URL');
        if (userSetDbUrl) {
          await this.info(
            deploymentId,
            'DATABASE_URL is set via env vars — skipping managed database',
          );
        } else {
          currentStage = 'Provisioning database';
          const dbStart = Date.now();
          await this.stageStart(deploymentId, currentStage);
          try {
            await this.info(deploymentId, 'Provisioning managed database');
            const db = await this.dbProvision.ensureForApp(app.id, app.subdomain);
            const url = this.dbProvision.buildAppDatabaseUrl(db);
            envList.push(`DATABASE_URL=${url}`);
            this.debug(
              deploymentId,
              `injected DATABASE_URL for db=${db.dbName} role=${db.roleName} host=${db.host}:${db.port}`,
            );
            await this.info(
              deploymentId,
              `Database ready: ${db.dbName} (reachable at ${db.host}:${db.port})`,
            );
            await this.stageOk(deploymentId, currentStage, dbStart);
          } catch (dbErr: unknown) {
            const reason = dbErr instanceof Error ? dbErr.message : String(dbErr);
            // A provisioning failure is fatal for a full-stack app — without a
            // database the backend can't function. Surface it as a deploy failure.
            throw new Error(`Database provisioning failed: ${reason}`);
          }
        }
      }

      // ── Node-RED: persistent volume + settings.js ─────────────────────
      // Node-RED keeps its flows, installed nodes and settings.js in a named
      // volume mounted at /data so they survive restarts/redeploys. We render
      // settings.js (with adminAuth from the app's editor accounts) into the
      // volume BEFORE the container starts so the editor is protected from the
      // first boot.
      if (app.type === 'nodered') {
        const volume = app.noderedVolumeName ?? `upande-nodered-${app.subdomain}`;
        currentStage = 'Configuring Node-RED';
        const cfgStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        try {
          await this.info(
            deploymentId,
            `Routing this instance via Traefik on ${appSubdomainHost(app.subdomain)} (-> container ${NODERED_PORT})`,
          );
          await this.info(
            deploymentId,
            `Writing settings.js to the /data volume (${volume})`,
          );
          await this.info(
            deploymentId,
            `Applying adminAuth for ${app.noderedUsers.length} editor account(s): ${
              app.noderedUsers.map((u) => u.username).join(', ') || '(none)'
            }`,
          );
          const settings = renderNodeRedSettings(
            app.noderedUsers.map((u) => ({
              username: u.username,
              passwordHash: u.passwordHash,
              permission: u.permission,
            })),
          );
          await this.writeNodeRedSettings(deploymentId, volume, settings);
          extraBinds.push(`${volume}:${NODERED_DATA_DIR}`);
          await this.info(
            deploymentId,
            'Flows, nodes and credentials persist in this volume across redeploys',
          );
          await this.info(
            deploymentId,
            `Node-RED ready with ${app.noderedUsers.length} editor account(s)`,
          );
          await this.stageOk(deploymentId, currentStage, cfgStart);
        } catch (nrErr: unknown) {
          const reason = nrErr instanceof Error ? nrErr.message : String(nrErr);
          throw new Error(`Node-RED provisioning failed: ${reason}`);
        }
      }

      // ── Stage: Health check (zero-downtime candidate) ─────────────────
      // Start the new image under a temporary name with NO Traefik routing
      // and probe it over the Docker network (container IP). The live
      // container keeps serving untouched; only a healthy build is swapped in.
      // Node-RED shares its data volume with the running instance, so it is
      // only checked after the swap (and rolled back if unhealthy).
      // Database-backed production apps skip the throwaway candidate: it would
      // boot (run migrations, workers, crons) against the PRODUCTION database
      // and then be discarded. They are health-checked once, as the real new
      // container, before the old one is retired (below).
      const health = this.healthConfig(app);
      const usesProdDb =
        !preview && (app.type === 'fullstack' || envList.some((e) => e.startsWith('DATABASE_URL=')));
      if (app.type !== 'nodered' && !usesProdDb) {
        currentStage = 'Health check';
        const hcStart = Date.now();
        await this.stageStart(deploymentId, currentStage);
        await this.checkCandidate(deploymentId, {
          name: `${containerName}-candidate`,
          image: imageTag,
          networkMode,
          env: envList,
          binds: extraBinds,
          port: containerPort,
          health,
        });
        await this.stageOk(deploymentId, currentStage, hcStart);
      } else if (usesProdDb) {
        await this.info(
          deploymentId,
          'Database-backed app: the new container is health-checked in place (no throwaway candidate against the production database)',
        );
      }

      // Cancelled (or the app/preview deleted) while building → stop here,
      // before touching the live container.
      await this.assertStillWanted(deploymentId);

      // ── Stage: starting the container ─────────────────────────────────
      currentStage = app.type === 'nodered' ? 'Starting Node-RED' : 'Deploying';
      const deployStart = Date.now();
      await this.stageStart(deploymentId, currentStage);
      if (!preview && app.customDomains.length) {
        await this.info(
          deploymentId,
          `Routing custom domains: ${app.customDomains.map((d) => d.domain).join(', ')}`,
        );
      }
      // No host ports are published for any app type — Traefik reaches every
      // container over the upande_net network and routes the subdomain to it.
      const createApp = (name: string) =>
        this.docker.createContainer({
          Image: imageTag,
          name,
          Labels: labels,
          HostConfig: {
            NetworkMode: networkMode,
            // Auto-restart crashed apps (APP_RESTART_POLICY, default
            // on-failure:5 — gives up after 5 restarts so a broken app shows
            // as crashed instead of looping forever); restart counts surface
            // on the app page.
            RestartPolicy: appRestartPolicy(),
            ...(extraBinds.length ? { Binds: extraBinds } : {}),
          },
          Env: envList,
        });

      // Zero-downtime overlap: when the new container's Traefik labels are
      // identical to the live one's, start it next to the live container —
      // Traefik load-balances both (the retry middleware re-sends requests the
      // booting one refuses) — health-check it, then retire the old container
      // and take over its name. Differing router labels would conflict in
      // Traefik (it drops the router → 404), and Node-RED shares its data
      // volume, so those fall back to the stop → start swap with restore.
      const live = await this.docker
        .getContainer(containerName)
        .inspect()
        .catch(() => null);
      const traefikOnly = (l: Record<string, string>) =>
        JSON.stringify(
          Object.entries(l)
            .filter(([k]) => k.startsWith('traefik.'))
            .sort(([a], [b]) => a.localeCompare(b)),
        );
      const canOverlap =
        app.type !== 'nodered' &&
        !!live?.State?.Running &&
        traefikOnly(live.Config?.Labels ?? {}) === traefikOnly(labels);

      if (canOverlap) {
        const nextName = `${containerName}-next`;
        await this.stopContainerIfExists(deploymentId, nextName);
        this.debug(deploymentId, `creating ${nextName} next to the live container (image=${imageTag} port=${containerPort})`);
        const next = await createApp(nextName);
        try {
          await next.start();
          const post = await this.waitHealthy(deploymentId, next, networkMode, containerPort, health);
          if (!post.ok) throw new DeployAbortError(`Health check failed — ${post.reason}`);
        } catch (err) {
          await next.remove({ force: true }).catch(() => undefined);
          await this.info(deploymentId, 'New version is unhealthy — removed it; the previous version kept serving');
          throw err;
        }
        await this.info(deploymentId, 'New version healthy — retiring the previous container (no downtime)');
        // Give Traefik time to register the new server (its Docker provider
        // throttles events, ~2s) before the old one goes away.
        await new Promise((r) => setTimeout(r, 3000));
        await this.stopContainerIfExists(deploymentId, containerName);
        await next.rename({ name: containerName });
      } else {
        // Stop → start swap. Snapshot the old container first so that, if the
        // swap fails, it is recreated from the exact image it was running.
        if (live?.State?.Running && app.type !== 'nodered') {
          this.debug(deploymentId, 'router labels changed — using stop/start swap (brief interruption)');
        }
        const backup = await this.snapshotContainer(deploymentId, containerName);
        if (backup) {
          this.debug(
            deploymentId,
            `backup captured: image=${backup.image} (will restore this if the swap fails)`,
          );
        }
        try {
          await this.stopContainerIfExists(deploymentId, containerName);
          this.debug(
            deploymentId,
            `creating container ${containerName} (image=${imageTag} network=${networkMode} port=${containerPort})`,
          );
          const container = await createApp(containerName);
          await container.start();
          this.debug(deploymentId, `container id=${container.id.slice(0, 12)} started`);

          // Node-RED boots a few seconds after the container starts (it loads
          // settings.js, starts the flow runtime and the editor). Tail its logs
          // into the deploy log so the user sees the runtime come up.
          if (app.type === 'nodered') {
            await this.tailNodeRedStartup(deploymentId, container);
          }

          // Confirm the routed container is healthy too (for Node-RED this is
          // the only check). Unhealthy → the catch below restores the previous
          // container.
          const post = await this.waitHealthy(deploymentId, container, networkMode, containerPort, health);
          if (!post.ok) {
            throw new DeployAbortError(`Health check failed after the swap — ${post.reason}`);
          }
        } catch (swapErr: unknown) {
          // The swap failed. Bring the previous container back so the site stays
          // up, then rethrow so the deployment is recorded as failed.
          const reason = swapErr instanceof Error ? swapErr.message : String(swapErr);
          await this.info(
            deploymentId,
            `Swap failed (${reason}) — restoring the previous container`,
          );
          if (backup) {
            const restored = await this.restoreContainer(
              deploymentId,
              containerName,
              backup,
            );
            if (restored) {
              await this.info(deploymentId, 'Previous version restored — site is still up');
            } else {
              await this.info(
                deploymentId,
                'WARNING: could not restore the previous container — site may be down',
              );
            }
          } else {
            await this.info(
              deploymentId,
              'No previous container to restore (first deploy)',
            );
          }
          throw swapErr;
        }
      }
      await this.stageOk(deploymentId, currentStage, deployStart);

      // The app / preview may have been deleted during the swap: then remove
      // what we just started instead of leaving an orphaned, routed container.
      const recorded = await this.prisma.deployment.updateMany({
        where: { id: deploymentId, status: { not: 'failed' } },
        data: { status: 'live', imageRef: imageTag, finishedAt: new Date(), errorReason: null },
      });
      if (recorded.count === 0) {
        const cancelled = await this.prisma.deployment.findUnique({ where: { id: deploymentId }, select: { id: true } });
        if (!cancelled) {
          await this.stopContainerIfExists(deploymentId, containerName);
          await this.docker.getImage(imageTag).remove({ force: true }).catch(() => undefined);
          throw new DeployCancelledError('the app or preview was deleted during the deploy — removed the new container');
        }
        throw new DeployCancelledError('cancelled during the swap — the new version is running; redeploy or stop as needed');
      }

      if (preview) {
        const dep = await this.prisma.deployment.findUnique({
          where: { id: deploymentId },
          select: { commitSha: true },
        });
        const updated = await this.prisma.preview.updateMany({
          where: { id: preview.id },
          data: {
            status: 'live',
            imageRef: imageTag,
            commitSha: dep?.commitSha ?? null,
            lastDeployedAt: new Date(),
            lastDeploymentId: deploymentId,
          },
        });
        if (updated.count === 0) {
          // Deleted while building — don't leave an orphaned container behind.
          await this.info(deploymentId, 'The preview was deleted during the deploy — removing it');
          await this.stopContainerIfExists(deploymentId, containerName);
          await this.docker.getImage(imageTag).remove({ force: true }).catch(() => undefined);
        }
      } else {
        await this.prisma.app.update({
          where: { id: appId },
          data: { status: 'live' },
        });
      }

      await this.info(deploymentId, `Deployed in ${this.elapsed(startedAt)}`);
      await this.info(deploymentId, `Live at ${buildAppUrl(preview ? preview.subdomain : app.subdomain)}`);
      await this.githubReporter.reportDeployment(deploymentId, 'success', {
        log: (l) => this.info(deploymentId, l),
      });

      // Cleanup build dir
      this.debug(deploymentId, `removing work dir ${workDir}`);
      fs.rmSync(workDir, { recursive: true, force: true });
      // Keep the last IMAGE_RETENTION_COUNT images for instant rollback; prune
      // the rest (best-effort).
      if (preview) {
        // Previews keep only their current image (no rollback for previews).
        await this.prunePreviewImages(deploymentId, imageRepo, imageTag);
      } else if (app.type !== 'nodered') {
        await this.pruneOldImages(deploymentId, app.id, app.subdomain, imageTag);
      }
      // Keep the full build log beyond the Redis TTL (deploy history).
      await this.logStore.persist(deploymentId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      await this.stageFail(deploymentId, currentStage, message);
      if (stack) {
        for (const line of stack.split('\n').slice(1)) {
          this.debug(deploymentId, line.trim());
        }
      }

      // Always clean the work dir so the next attempt starts fresh.
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
        this.debug(deploymentId, 'work dir cleaned after failure');
      } catch {
        // ignore cleanup errors
      }

      // Cancelled / deleted meanwhile (e.g. Cancel removed the health-check
      // container, which surfaced as a failure): the canceller already set the
      // terminal state — don't overwrite it or retry.
      const current = await this.prisma.deployment
        .findUnique({ where: { id: deploymentId }, select: { status: true } })
        .catch(() => undefined);
      if (err instanceof DeployCancelledError || current === null || current?.status === 'failed') {
        await this.info(deploymentId, `Stopped: ${message}`).catch(() => undefined);
        await this.docker.getImage(`${imageRepo}:${deploymentId}`).remove({ force: true }).catch(() => undefined);
        await this.logStore.persist(deploymentId).catch(() => undefined);
        return;
      }

      if (attempt < maxAttempts && !(err instanceof DeployAbortError)) {
        // Let BullMQ retry: throwing re-queues the job with backoff.
        await this.info(
          deploymentId,
          `Attempt ${attempt} of ${maxAttempts} failed — retrying with a clean cache`,
        );
        throw err;
      }

      // Attempts exhausted — record the terminal failure. The stage that failed
      // (e.g. "Cloning repository") becomes the notification's title; the full
      // error text is kept as detail for the analysis page.
      await this.markFailed(
        deploymentId,
        appId,
        err instanceof DeployAbortError
          ? message
          : `${message} (after ${maxAttempts} attempts)`,
        currentStage,
        preview?.id,
      );
    }
  }

  // Right before touching the live container: was this deployment cancelled,
  // or its app / preview deleted, while it was building?
  private async assertStillWanted(deploymentId: string): Promise<void> {
    const d = await this.prisma.deployment.findUnique({
      where: { id: deploymentId },
      select: { status: true, errorReason: true, appId: true, previewId: true },
    });
    if (!d) throw new DeployCancelledError('the app or preview was deleted during the deploy');
    if (d.status === 'failed') throw new DeployCancelledError(d.errorReason ?? 'cancelled');
    const app = await this.prisma.app.findUnique({ where: { id: d.appId }, select: { id: true } });
    if (!app) throw new DeployCancelledError('the app was deleted during the deploy');
    if (d.previewId) {
      const pv = await this.prisma.preview.findUnique({ where: { id: d.previewId }, select: { id: true } });
      if (!pv) throw new DeployCancelledError('the preview was deleted during the deploy');
    }
  }

  // Resolve an app's health-check settings (shared with the uptime monitor).
  private healthConfig(app: {
    type: string;
    healthCheckPath: string | null;
    healthCheckTimeout: number;
    healthCheckRetries: number;
  }): HealthConfig {
    return healthConfigFor(app);
  }

  // Start the new image as an unrouted candidate container, wait for it to be
  // healthy, then remove it. Throws (non-retryable) if it never gets healthy;
  // the live container is never touched here.
  private async checkCandidate(
    deploymentId: string,
    c: {
      name: string;
      image: string;
      networkMode: string;
      env: string[];
      binds: string[];
      port: number;
      health: HealthConfig;
    },
  ): Promise<void> {
    await this.info(
      deploymentId,
      `Starting the new version alongside the current one and probing GET ${c.health.path} ` +
        `(${c.health.strict ? 'expects 2xx/3xx' : 'web server must answer'}; ` +
        `${c.health.retries} attempts, ${c.health.timeoutMs / 1000}s timeout)`,
    );
    await this.stopContainerIfExists(deploymentId, c.name);
    const candidate = await this.docker.createContainer({
      Image: c.image,
      name: c.name,
      // Not routed by Traefik — the live container keeps all the traffic.
      Labels: { 'traefik.enable': 'false', 'upande.role': 'health-candidate' },
      HostConfig: {
        NetworkMode: c.networkMode,
        RestartPolicy: { Name: 'no' },
        ...(c.binds.length ? { Binds: c.binds } : {}),
      },
      Env: c.env,
    });
    try {
      await candidate.start();
      const result = await this.waitHealthy(deploymentId, candidate, c.networkMode, c.port, c.health);
      if (!result.ok) {
        await this.info(
          deploymentId,
          'The new version is unhealthy — nothing was swapped; the current version keeps serving.',
        );
        throw new DeployAbortError(`New version unhealthy — ${result.reason}`);
      }
    } finally {
      try {
        await candidate.remove({ force: true });
      } catch {
        // already gone
      }
    }
  }

  // Poll a container over the Docker network until it answers the health
  // check. Never throws; returns the reason on failure. A container that exits
  // fails fast (with its last log lines copied into the deploy log).
  private async waitHealthy(
    deploymentId: string,
    container: Docker.Container,
    networkMode: string,
    port: number,
    health: HealthConfig,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    let lastReason = 'no response';
    // Give the process a moment to bind its port before the first probe.
    await new Promise((r) => setTimeout(r, Math.min(health.intervalMs, 750)));
    for (let attempt = 1; attempt <= health.retries; attempt++) {
      let info: Docker.ContainerInspectInfo;
      try {
        info = await container.inspect();
      } catch {
        return { ok: false, reason: 'the container disappeared' };
      }
      if (!info.State.Running || info.State.Restarting) {
        await this.copyContainerLogs(deploymentId, container);
        return {
          ok: false,
          reason: `the container exited (exit code ${info.State.ExitCode}${info.State.OOMKilled ? ', out of memory' : ''}) before becoming healthy`,
        };
      }
      const nets = info.NetworkSettings?.Networks ?? {};
      const ip = nets[networkMode]?.IPAddress || Object.values(nets).find((n) => n.IPAddress)?.IPAddress;
      if (ip) {
        const url = `http://${ip}:${port}${health.path}`;
        const probe = await this.probe(url, health);
        if (probe.ok) {
          await this.info(
            deploymentId,
            `Health check passed: GET ${health.path} → ${probe.status} (attempt ${attempt}/${health.retries})`,
          );
          return { ok: true };
        }
        lastReason = probe.reason;
      } else {
        lastReason = 'container has no network address yet';
      }
      await this.info(
        deploymentId,
        `Health check ${attempt}/${health.retries}: GET ${health.path} — ${lastReason}`,
      );
      if (attempt < health.retries) {
        await new Promise((r) => setTimeout(r, health.intervalMs));
      }
    }
    await this.copyContainerLogs(deploymentId, container);
    return {
      ok: false,
      reason: `GET ${health.path} ${lastReason} after ${health.retries} attempts`,
    };
  }

  private async probe(
    url: string,
    health: HealthConfig,
  ): Promise<{ ok: true; status: number } | { ok: false; reason: string }> {
    return probeHttp(url, health);
  }

  // Copy a container's last output into the deploy log (why it's unhealthy).
  private async copyContainerLogs(deploymentId: string, container: Docker.Container): Promise<void> {
    try {
      const buf = (await container.logs({ stdout: true, stderr: true, tail: 30 })) as unknown as Buffer;
      const lines = demuxDockerLogs(buf)
        .replace(/[\x00-\x08]/g, '')
        .replace(/[\x0e-\x1f]/g, '')
        .split('\n')
        .map((l) => l.trimEnd())
        .filter(Boolean);
      if (lines.length) {
        await this.info(deploymentId, 'Last output from the new container:');
        for (const l of lines) this.logSync(deploymentId, `[app] ${l}`);
      }
    } catch {
      // no logs available
    }
  }

  // Is a real app container (not the maintenance placeholder) running under
  // this name?
  private async isAppContainerServing(name: string): Promise<boolean> {
    try {
      const info = await this.docker.getContainer(name).inspect();
      const image = info.Config?.Image ?? '';
      return (
        info.State.Running &&
        (image.startsWith('upande-app-') || image.startsWith('upande-preview-') || image === NODERED_IMAGE)
      );
    } catch {
      return false;
    }
  }

  private async imageExists(tag: string): Promise<boolean> {
    try {
      await this.docker.getImage(tag).inspect();
      return true;
    } catch {
      return false;
    }
  }

  // Check out exactly one commit (rollback rebuild of a pruned image). GitHub
  // and most hosts allow fetching a reachable SHA directly; fall back to a
  // full clone + checkout when a server refuses fetch-by-SHA.
  private async checkoutCommit(workDir: string, cloneUrl: string, sha: string): Promise<void> {
    try {
      const git = simpleGit(workDir);
      await git.init();
      await git.addRemote('origin', cloneUrl);
      await git.fetch(['--depth', '1', 'origin', sha]);
      await git.checkout(['--detach', 'FETCH_HEAD']);
    } catch {
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.mkdirSync(workDir, { recursive: true });
      await simpleGit().clone(cloneUrl, workDir);
      await simpleGit(workDir).checkout(['--detach', sha]);
    }
  }

  // Image retention: keep the images of the app's last IMAGE_RETENTION_COUNT
  // successful deployments (plus the one just deployed) and remove the rest.
  // Never forced, so an image a container still uses is left alone.
  private async pruneOldImages(
    deploymentId: string,
    appId: string,
    subdomain: string,
    currentImage: string,
  ): Promise<void> {
    try {
      const keepN = imageRetentionCount();
      const recent = await this.prisma.deployment.findMany({
        where: { appId, status: 'live', imageRef: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { imageRef: true },
        take: 200,
      });
      const repo = `upande-app-${subdomain}`;
      const images = await this.docker.listImages({ filters: { reference: [`${repo}:*`] } });
      const onDisk = new Set(images.flatMap((i) => i.RepoTags ?? []));
      // Count only images that still exist, so already-pruned ones don't use
      // up retention slots.
      const keep = new Set<string>([currentImage]);
      for (const d of recent) {
        if (keep.size >= keepN) break;
        if (d.imageRef && onDisk.has(d.imageRef)) keep.add(d.imageRef);
      }
      let removed = 0;
      for (const img of images) {
        for (const tag of img.RepoTags ?? []) {
          if (!tag.startsWith(`${repo}:`) || keep.has(tag)) continue;
          try {
            await this.docker.getImage(tag).remove();
            removed += 1;
          } catch (err) {
            this.debug(deploymentId, `could not prune ${tag}: ${String(err)}`);
          }
        }
      }
      this.debug(
        deploymentId,
        `image retention: keeping ${keep.size} image(s) (IMAGE_RETENTION_COUNT=${keepN}), pruned ${removed}`,
      );
    } catch (err) {
      this.debug(deploymentId, `image retention failed: ${String(err)}`);
    }
  }

  // Record the commit that was checked out (deploy history). Best-effort — a
  // repo without history (or a git failure) just leaves the fields empty.
  private async recordCommit(deploymentId: string, workDir: string): Promise<void> {
    try {
      const latest = (await simpleGit(workDir).log({ maxCount: 1 })).latest;
      if (!latest) return;
      await this.prisma.deployment.update({
        where: { id: deploymentId },
        data: {
          commitSha: latest.hash,
          commitMessage: latest.message.slice(0, 500),
        },
      });
      await this.info(deploymentId, `Commit ${latest.hash.slice(0, 7)}: ${latest.message}`);
    } catch (err) {
      this.debug(deploymentId, `could not read commit info: ${String(err)}`);
    }
  }

  // For GitHub-connected apps over HTTPS, inject the owner's OAuth token so
  // private repos clone. Falls back to the bare URL for public repos / no token.
  private async authenticatedCloneUrl(app: {
    repoUrl: string | null;
    githubRepoFullName?: string | null;
    project?: { userId: string } | null;
  }): Promise<string> {
    const repoUrl = app.repoUrl ?? '';
    // http(s) only: a file:// URL or local path would deploy (and expose)
    // files from this server. Also guards rows saved before validation.
    if (!isAllowedRepoUrl(repoUrl)) {
      throw new DeployAbortError('Repository URL must be an http(s):// git URL');
    }
    if (
      !app.githubRepoFullName ||
      !app.project?.userId ||
      !repoUrl.startsWith('https://github.com/')
    ) {
      return repoUrl;
    }

    const account = await this.prisma.githubAccount.findUnique({
      where: { userId: app.project.userId },
      select: { accessToken: true },
    });
    if (!account) return repoUrl;

    try {
      const token = decrypt(account.accessToken);
      // https://x-access-token:<token>@github.com/owner/repo.git
      return repoUrl.replace(
        'https://github.com/',
        `https://x-access-token:${token}@github.com/`,
      );
    } catch {
      return repoUrl;
    }
  }

  // Builds the Traefik labels for an app container: the default
  // <slug>.localhost router plus one router per verified custom domain. When
  // ACME_RESOLVER is set (the VPS), custom-domain routers also request TLS via
  // Let's Encrypt; locally (no resolver) they stay HTTP.
  private buildTraefikLabels(
    subdomain: string,
    containerPort: number,
    customDomains: { domain: string }[],
  ): Record<string, string> {
    const resolver = process.env.ACME_RESOLVER; // e.g. "letsencrypt" on the VPS
    // Default router on <slug>.<BASE_DOMAIN> (HTTPS on the VPS, HTTP locally).
    const labels: Record<string, string> = buildSubdomainRouterLabels(
      subdomain,
      containerPort,
    );

    for (const { domain } of customDomains) {
      // Router name must be a safe Traefik identifier.
      const router = `d-${domain.replace(/[^a-z0-9]/gi, '-')}`;
      labels[`traefik.http.routers.${router}.rule`] = `Host(\`${domain}\`)`;
      labels[`traefik.http.routers.${router}.service`] = subdomain;
      if (resolver) {
        labels[`traefik.http.routers.${router}.entrypoints`] = 'websecure';
        labels[`traefik.http.routers.${router}.tls`] = 'true';
        labels[`traefik.http.routers.${router}.tls.certresolver`] = resolver;
      }
    }
    return labels;
  }

  // Traefik labels for a preview container: ONE router on
  // <app>-<branch-slug>.<BASE_DOMAIN>. Router/service names are prefixed
  // "pv-" so they can never clash with an app's own router. Custom domains are
  // never routed to previews.
  private buildPreviewLabels(
    previewSubdomain: string,
    containerPort: number,
    appId: string,
    previewId: string,
  ): Record<string, string> {
    const resolver = process.env.ACME_RESOLVER;
    const r = `pv-${previewSubdomain}`;
    const labels: Record<string, string> = {
      'traefik.enable': 'true',
      [`traefik.http.routers.${r}.rule`]: `Host(\`${appSubdomainHost(previewSubdomain)}\`)`,
      [`traefik.http.routers.${r}.service`]: r,
      [`traefik.http.services.${r}.loadbalancer.server.port`]: String(containerPort),
      'upande.role': 'preview',
      'upande.app': appId,
      'upande.preview': previewId,
    };
    if (resolver) {
      labels[`traefik.http.routers.${r}.entrypoints`] = 'websecure';
      labels[`traefik.http.routers.${r}.tls`] = 'true';
      labels[`traefik.http.routers.${r}.tls.certresolver`] = resolver;
    }
    return labels;
  }

  // Previews keep just the image they currently run.
  private async prunePreviewImages(
    deploymentId: string,
    imageRepo: string,
    currentImage: string,
  ): Promise<void> {
    try {
      const images = await this.docker.listImages({ filters: { reference: [`${imageRepo}:*`] } });
      for (const tag of images.flatMap((i) => i.RepoTags ?? [])) {
        if (tag === currentImage || !tag.startsWith(`${imageRepo}:`)) continue;
        await this.docker.getImage(tag).remove().catch((err) =>
          this.debug(deploymentId, `could not prune ${tag}: ${String(err)}`),
        );
      }
    } catch (err) {
      this.debug(deploymentId, `preview image prune failed: ${String(err)}`);
    }
  }

  private async buildImage(
    deploymentId: string,
    workDir: string,
    imageTag: string,
    app: {
      id: string;
      buildCmd?: string | null;
      outputDir?: string | null;
      type: string;
    },
    noCache = false,
  ): Promise<void> {
    // A repo that ships its own Dockerfile wins over nixpacks and the generated
    // fallback — it's the most explicit statement of how the author wants the
    // image built. Use it as-is and DON'T write a .dockerignore that excludes
    // "Dockerfile" (that would drop the repo's own build file from the context).
    const repoDockerfile = fs.existsSync(path.join(workDir, 'Dockerfile'));
    if (repoDockerfile) {
      await this.log(
        deploymentId,
        'Repository provides a Dockerfile — building with it (skipping nixpacks/fallback)',
      );
      // Respect the repo's own .dockerignore. If it has none, add a minimal one
      // that only drops .git from the context — crucially NOT "Dockerfile",
      // which the repo needs in the build context.
      if (!fs.existsSync(path.join(workDir, '.dockerignore'))) {
        fs.writeFileSync(path.join(workDir, '.dockerignore'), '.git\n', 'utf8');
      }
      await this.runDockerBuild(deploymentId, workDir, imageTag, noCache, app.id);
      return;
    }

    const nixpacksAvailable = await this.checkNixpacks();
    this.debug(deploymentId, `builder selection: nixpacks=${nixpacksAvailable} noCache=${noCache}`);

    if (nixpacksAvailable) {
      await this.log(deploymentId, 'nixpacks binary found — building with nixpacks');
      // Pass arguments as an array (no shell) so a malicious buildCmd cannot be
      // interpreted as host shell. Run with cwd=workDir instead of `cd`.
      const args = ['build', '.', '--name', imageTag];
      if (app.buildCmd) {
        args.push('--build-cmd', app.buildCmd);
      }
      if (noCache) {
        // nixpacks passes through Docker build flags via --no-cache.
        args.push('--no-cache');
      }
      // Per-app BuildKit cache-mount key (nixpacks' own package caches).
      if (buildCacheEnabled()) args.push('--cache-key', buildCacheScope(app.id));
      await this.runCommand(deploymentId, 'nixpacks', args, workDir);
    } else {
      await this.log(deploymentId, 'nixpacks binary not found, using Dockerfile fallback');
      const installMarker = await this.generateDockerfile(workDir, app, deploymentId);
      // Keep .git and the generated Dockerfile out of the image build context.
      fs.writeFileSync(
        path.join(workDir, '.dockerignore'),
        ['.git', 'Dockerfile', '.dockerignore'].join('\n'),
        'utf8',
      );
      await this.runDockerBuild(deploymentId, workDir, imageTag, noCache, app.id, installMarker);
    }
  }

  private async checkNixpacks(): Promise<boolean> {
    try {
      execSync('which nixpacks', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private async generateDockerfile(
    workDir: string,
    app: { id: string; buildCmd?: string | null; outputDir?: string | null; type: string },
    deploymentId?: string,
  ): Promise<string | null> {
    const hasPackageJson = fs.existsSync(path.join(workDir, 'package.json'));
    // Marks the dependency-install step in the build output (cache reporting).
    let installMarker: string | null = null;

    // SPA-aware nginx config: serve real files, but fall back to /index.html
    // for unknown paths so client-side routes (e.g. /services on a React Router
    // app) work on direct load / refresh instead of returning 404. Stock
    // nginx:alpine has no such fallback, which 404s every deep link. Written
    // inside the image via a RUN heredoc (not a context file) so nothing extra
    // lands in the build context or the served html root.
    const spaConfStep = [
      'RUN printf \'%s\\n\' \\',
      `  'server {' \\`,
      `  '    listen ${APP_LISTEN_PORT};' \\`,
      "  '    server_name _;' \\",
      "  '    root /usr/share/nginx/html;' \\",
      "  '    index index.html;' \\",
      "  '    location / { try_files $uri $uri/ /index.html; }' \\",
      "  '}' > /etc/nginx/conf.d/default.conf",
    ].join('\n');

    // "No content" guard, baked into every image. Two parts:
    //  1. Purge stock nginx's html dir BEFORE copying the build output, so its
    //     "Welcome to nginx!" index.html can never survive a contentless deploy.
    //  2. After the copy, if there is still no index.html at the web root, drop
    //     in our branded "nothing deployed here" page (404) instead. This is the
    //     last RUN, so it sees the final state of the copied output.
    // Without this, an empty build (wrong output dir, empty repo) leaves the web
    // root either empty or carrying nginx's default page — the visitor sees raw
    // nginx branding instead of a page we control.
    const purgeStockHtmlStep = 'RUN rm -rf /usr/share/nginx/html/* /usr/share/nginx/html/.??*';
    const emptyContentGuardStep = [
      'RUN if [ ! -f /usr/share/nginx/html/index.html ]; then \\',
      `      echo ${EMPTY_CONTENT_HTML_B64} | base64 -d > /usr/share/nginx/html/index.html && \\`,
      // Serve the placeholder for every path with a 404 — there is no real app.
      "      printf '%s\\n' \\",
      `        'server {' \\`,
      `        '    listen ${APP_LISTEN_PORT};' \\`,
      "        '    server_name _;' \\",
      "        '    root /usr/share/nginx/html;' \\",
      "        '    location / { return 404; }' \\",
      "        '    error_page 404 /index.html;' \\",
      "        '    location = /index.html { internal; add_header Cache-Control \"no-store\" always; }' \\",
      "        '}' > /etc/nginx/conf.d/default.conf; \\",
      '    fi',
    ].join('\n');

    let dockerfile: string;
    if (hasPackageJson) {
      // Node project: install deps, run the build, serve the output dir.
      // Build cache: the install runs in its own per-app layer before the
      // source is copied (reused while the lockfile is unchanged), plus
      // per-app BuildKit cache mounts for package-manager/framework caches.
      const outputDir = app.outputDir ?? 'dist';
      const plan = detectNodeBuild(workDir);
      const buildkit = buildCacheEnabled() && (await this.buildCache.buildkitAvailable());
      installMarker = plan.installCmd;
      if (deploymentId) {
        await this.info(
          deploymentId,
          `Build cache: ${plan.pm}${plan.lockfile ? ` (${plan.lockfile})` : ' (no lockfile)'} — ${plan.isolatedReason}` +
            (buildkit ? '; BuildKit cache mounts for package + framework caches' : ''),
        );
      }
      const builderStage = buildCacheEnabled()
        ? nodeBuilderStage(plan, { scope: buildCacheScope(app.id), buildkit, buildCmd: app.buildCmd })
        : [
            'FROM node:20-alpine AS builder',
            'WORKDIR /app',
            'COPY package*.json ./',
            'RUN npm install --legacy-peer-deps',
            'COPY . .',
            `RUN ${app.buildCmd ?? 'npm install && npm run build'}`,
          ];
      dockerfile = [
        ...builderStage,
        '',
        'FROM nginx:alpine',
        purgeStockHtmlStep,
        spaConfStep,
        'COPY --from=builder /app/' + outputDir + ' /usr/share/nginx/html',
        emptyContentGuardStep,
        `EXPOSE ${APP_LISTEN_PORT}`,
        'CMD ["nginx", "-g", "daemon off;"]',
      ].join('\n');
      if (deploymentId) {
        this.debug(deploymentId, 'Dockerfile: detected package.json — Node build + nginx serve (SPA fallback, no-content guard)');
      }
    } else {
      // Plain static site (no package.json): serve the repo files directly.
      dockerfile = [
        'FROM nginx:alpine',
        purgeStockHtmlStep,
        spaConfStep,
        'COPY . /usr/share/nginx/html',
        emptyContentGuardStep,
        `EXPOSE ${APP_LISTEN_PORT}`,
        'CMD ["nginx", "-g", "daemon off;"]',
      ].join('\n');
      if (deploymentId) {
        this.debug(deploymentId, 'Dockerfile: no package.json — serving static files directly via nginx (SPA fallback, no-content guard)');
      }
    }

    fs.writeFileSync(path.join(workDir, 'Dockerfile'), dockerfile, 'utf8');
    return installMarker;
  }

  // Tail a freshly-started Node-RED container's logs into the deploy log so the
  // user can watch the runtime boot. Follows the stream until Node-RED reports
  // it is up ("Server now running" / "Started flows") or a timeout elapses —
  // whichever comes first — then detaches (the container keeps running). The
  // detach never throws: this is observability only and must not fail a deploy
  // whose container already started successfully.
  private async tailNodeRedStartup(
    deploymentId: string,
    container: Docker.Container,
    timeoutMs = 25000,
  ): Promise<void> {
    await this.info(deploymentId, 'Starting Node-RED — streaming startup logs');
    try {
      const stream = (await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 0,
        timestamps: false,
      })) as unknown as NodeJS.ReadableStream & { destroy?: () => void };

      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            stream.destroy?.();
          } catch {
            // Already closed — ignore.
          }
          resolve();
        };

        const timer = setTimeout(() => {
          this.logSync(
            deploymentId,
            '@debug Node-RED startup log tail timed out — instance continues in the background',
          );
          finish();
        }, timeoutMs);

        stream.on('data', (chunk: Buffer) => {
          // Docker multiplexes stdout/stderr with an 8-byte header per frame;
          // strip the control bytes and emit clean lines.
          const text = chunk.toString('utf8').replace(/[\x00-\x08]/g, '');
          for (const raw of text.split('\n')) {
            const line = raw.replace(/[\x0e-\x1f]/g, '').trimEnd();
            if (!line) continue;
            this.logSync(deploymentId, line);
            // Node-RED prints these once the editor + flow runtime are up.
            if (/Server now running|Started flows|Started modules/i.test(line)) {
              this.logSync(deploymentId, '@info Node-RED is up and serving the editor');
              finish();
            }
          }
        });
        stream.on('error', finish);
        stream.on('end', finish);
        stream.on('close', finish);
      });
    } catch (err) {
      // Couldn't attach — note it but don't fail the deploy.
      this.debug(
        deploymentId,
        `could not tail Node-RED logs: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Pull an image if it isn't already present locally, streaming pull progress
  // to the deploy log. Used for the official Node-RED image (no build step).
  // When `showProgress` is set, per-layer status is surfaced as normal output
  // (the Node-RED "install" the user wants to see); otherwise it stays as dimmed
  // debug (e.g. the internal busybox helper pull).
  private async ensureImage(
    deploymentId: string,
    image: string,
    showProgress = false,
  ): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      if (showProgress) {
        await this.info(deploymentId, `Image ${image} already present locally`);
      } else {
        this.debug(deploymentId, `image ${image} already present`);
      }
      return;
    } catch {
      // Not present — pull it.
    }
    if (showProgress) {
      await this.info(deploymentId, `${image}: Pulling from Docker Hub`);
    }
    const stream = await this.docker.pull(image);
    // Collapse Docker's chatty per-chunk progress into one line per layer state
    // transition (e.g. "Downloading" → "Download complete" → "Pull complete").
    const lastStatus = new Map<string, string>();
    await new Promise<void>((resolve, reject) => {
      this.docker.modem.followProgress(
        stream,
        (err: Error | null) => (err ? reject(err) : resolve()),
        (event: { status?: string; id?: string }) => {
          if (!event.status || !event.id) return;
          if (showProgress) {
            // Only emit when this layer's status actually changes, so the log
            // shows the real pull (layer-by-layer) without thousands of lines.
            if (lastStatus.get(event.id) !== event.status) {
              lastStatus.set(event.id, event.status);
              this.logSync(deploymentId, `${event.id}: ${event.status}`);
            }
          } else {
            this.debug(deploymentId, `pull ${event.id}: ${event.status}`);
          }
        },
      );
    });
  }

  // Write the generated settings.js into the Node-RED data volume via a
  // short-lived busybox container (the volume isn't on the host FS). Content is
  // passed base64 so nothing in it can break the shell command.
  private async writeNodeRedSettings(
    deploymentId: string,
    volume: string,
    settings: string,
  ): Promise<void> {
    await this.ensureImage(deploymentId, 'busybox:1.36');
    const b64 = Buffer.from(settings, 'utf8').toString('base64');
    // Write settings.js, then hand the whole /data volume to the Node-RED user
    // (uid:gid 1000:1000). The official image runs as that non-root user, so an
    // unowned (root) volume makes Node-RED fail to start with EACCES on
    // /data/node_modules. chown -R is idempotent and cheap on the small dir.
    const script =
      `echo ${b64} | base64 -d > ${NODERED_DATA_DIR}/settings.js && ` +
      `chown -R ${NODERED_UID}:${NODERED_GID} ${NODERED_DATA_DIR}`;
    const container = await this.docker.createContainer({
      Image: 'busybox:1.36',
      Cmd: ['sh', '-c', script],
      HostConfig: {
        Binds: [`${volume}:${NODERED_DATA_DIR}`],
        AutoRemove: false,
      },
    });
    try {
      await container.start();
      const result = await container.wait();
      const code = (result as { StatusCode?: number }).StatusCode ?? 0;
      if (code !== 0) {
        throw new Error(`writing Node-RED settings.js exited with code ${code}`);
      }
    } finally {
      try {
        await container.remove({ force: true });
      } catch {
        // Already gone — ignore.
      }
    }
  }

  private async runDockerBuild(
    deploymentId: string,
    workDir: string,
    imageTag: string,
    noCache = false,
    appId?: string,
    installMarker?: string | null,
  ): Promise<void> {
    await this.log(deploymentId, `Building Docker image: ${imageTag}${noCache ? ' (--no-cache)' : ''}`);
    // BuildKit (buildx plugin present): force it on and stream plain progress,
    // which also lets us count CACHED steps. Legacy builder otherwise.
    const buildkit = buildCacheEnabled() && (await this.buildCache.buildkitAvailable());
    const counter = new BuildOutputCacheCounter(installMarker ?? '');
    // Build with whichever builder the daemon provides. We intentionally do NOT
    // pass `--progress=plain`: it is BuildKit-only and the legacy builder rejects
    // it (exit 125). When BuildKit *is* active (DOCKER_BUILDKIT=1 in the
    // environment, or a daemon that defaults to it) `docker build` still streams
    // full logs to stderr, which we capture. `--no-cache` is valid on both.
    const args = ['build'];
    if (buildkit) args.push('--progress=plain');
    if (noCache) args.push('--no-cache');
    args.push('-t', imageTag, workDir);
    await this.runCommand(
      deploymentId,
      'docker',
      args,
      undefined,
      buildkit ? { DOCKER_BUILDKIT: '1' } : undefined,
      (line) => counter.feed(line),
    );
    await this.log(deploymentId, 'Docker build complete');
    await this.reportBuildCache(deploymentId, counter, noCache, buildkit, appId);
  }

  // One deploy-log line saying how much of the build came from the app's
  // build cache. Observability only — never throws.
  private async reportBuildCache(
    deploymentId: string,
    counter: BuildOutputCacheCounter,
    noCache: boolean,
    buildkit: boolean,
    appId?: string,
  ): Promise<void> {
    try {
      const { steps, cached, depsCached } = counter.stats();
      const usage = appId && buildCacheEnabled() ? await this.buildCache.usageForApp(appId) : null;
      const size = usage && usage.totalBytes > 0 ? `; app build cache now ${formatBytes(usage.totalBytes)}` : '';
      const builder = buildkit ? 'BuildKit' : 'legacy builder';
      let msg: string;
      if (noCache) {
        msg = `Build cache: not used (clean build, ${builder})${size}`;
      } else if (depsCached) {
        msg = `Build cache hit: used build cache for ${cached} of ${steps} steps — dependency install restored from cache (${builder})${size}`;
      } else if (counter.tracksInstall()) {
        msg = `Build cache: dependencies installed fresh (first build for this app or lockfile changed); ${cached} of ${steps} steps cached (${builder})${size}`;
      } else if (cached > 0) {
        msg = `Build cache hit: used build cache for ${cached} of ${steps} steps (${builder})${size}`;
      } else {
        msg = `Build cache: miss — nothing reusable yet (${builder})${size}`;
      }
      await this.info(deploymentId, msg);
    } catch (err) {
      this.debug(deploymentId, `build cache report failed: ${String(err)}`);
    }
  }

  // Runs a program with an explicit argument array and no shell, so untrusted
  // values (image tags, build commands, paths) cannot inject host shell syntax.
  private async runCommand(
    deploymentId: string,
    file: string,
    args: string[],
    cwd?: string,
    env?: Record<string, string>,
    onLine?: (line: string) => void,
  ): Promise<void> {
    const display = `${file} ${args.join(' ')}`;
    const start = Date.now();
    this.debug(deploymentId, `exec: ${display}${cwd ? ` (cwd=${cwd})` : ''}`);
    return new Promise((resolve, reject) => {
      // Larger buffer so big build outputs are not truncated.
      const child = execFile(file, args, {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        env: env ? { ...process.env, ...env } : process.env,
      });

      child.stdout?.on('data', (data: string) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.logSync(deploymentId, line);
          onLine?.(line);
        }
      });

      child.stderr?.on('data', (data: string) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          this.logSync(deploymentId, `[stderr] ${line}`);
          onLine?.(line);
        }
      });

      child.on('close', (code) => {
        this.debug(
          deploymentId,
          `exec done: ${file} exited code=${code} (${this.elapsed(start)})`,
        );
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Command exited with code ${code}: ${display}`));
        }
      });

      child.on('error', (err) => {
        this.debug(deploymentId, `exec error: ${file}: ${err.message}`);
        reject(err);
      });
    });
  }

  // Clear build caches so a retry does not reuse a poisoned layer/dir. Best
  // effort: cache-clearing failures must not abort the deploy.
  private async clearCaches(deploymentId: string, imageRepo: string, appId: string): Promise<void> {
    // 1. Remove any stale build working directory.
    const workDir = `/tmp/upande-build-${deploymentId}`;
    try {
      if (fs.existsSync(workDir)) {
        fs.rmSync(workDir, { recursive: true, force: true });
        this.debug(deploymentId, `cleared stale work dir ${workDir}`);
      }
    } catch (err) {
      this.debug(deploymentId, `work dir clear failed: ${String(err)}`);
    }

    // 2. Remove a half-built image for THIS deployment (tags are unique per
    // deployment, so older images can't be "stale"). Earlier images are kept
    // on purpose — they back instant rollbacks (pruned by pruneOldImages).
    try {
      await this.docker.getImage(`${imageRepo}:${deploymentId}`).remove({ force: true });
      this.debug(deploymentId, `removed partial image for ${deploymentId}`);
    } catch {
      this.debug(deploymentId, `no partial image for ${deploymentId}`);
    }

    // 3. Drop THIS app's build cache (dependency layers + cache mounts). Scoped
    // to the app: other apps' caches are never touched.
    try {
      const { removedEntries, reclaimedBytes } = await this.buildCache.clearForApp(appId);
      await this.info(
        deploymentId,
        removedEntries > 0
          ? `Build cache cleared (${removedEntries} entr${removedEntries === 1 ? 'y' : 'ies'}, ${formatBytes(reclaimedBytes)} freed)`
          : 'Build cache cleared (nothing cached yet)',
      );
    } catch (err) {
      this.debug(deploymentId, `build cache clear failed: ${String(err)}`);
    }
  }

  // Like runCommand but never rejects — used for best-effort cache clearing.
  private async runCommandSafe(
    deploymentId: string,
    file: string,
    args: string[],
  ): Promise<void> {
    try {
      await this.runCommand(deploymentId, file, args);
    } catch (err) {
      this.debug(deploymentId, `(ignored) ${file} failed: ${String(err)}`);
    }
  }

  // ---- Structured logging ----
  //
  // Each emitted line is prefixed with a level token the dashboard parses and
  // strips to render a Netlify-style grouped, timed deploy log:
  //   @stage <name>        — begin a stage group (e.g. "Building")
  //   @ok <name>|<time>     — stage finished OK, with elapsed time
  //   @fail <name>|<reason> — stage failed
  //   @info <text>          — normal informational line
  //   @cmd <text>           — a command being executed (accent/monospace)
  //   @debug <text>         — verbose diagnostic (dimmed, collapsible)
  //   (anything else)       — raw program output under the current stage
  // Older clients that don't parse the tokens still get readable text.

  private logSync(deploymentId: string, line: string): void {
    // Fire-and-forget append to Redis
    this.logStore.append(deploymentId, line).catch(() => {});
  }

  private async log(deploymentId: string, line: string): Promise<void> {
    console.log(`[deploy:${deploymentId}] ${line}`);
    await this.logStore.append(deploymentId, line);
  }

  // Informational line shown in the main flow.
  private async info(deploymentId: string, text: string): Promise<void> {
    await this.log(deploymentId, `@info ${text}`);
  }

  // Begin a named stage group.
  private async stageStart(deploymentId: string, name: string): Promise<void> {
    await this.log(deploymentId, `@stage ${name}`);
  }

  // Mark the current stage finished with its elapsed time.
  private async stageOk(deploymentId: string, name: string, startMs: number): Promise<void> {
    await this.log(deploymentId, `@ok ${name}|${this.elapsed(startMs)}`);
  }

  private async stageFail(deploymentId: string, name: string, reason: string): Promise<void> {
    await this.log(deploymentId, `@fail ${name}|${reason}`);
  }

  // Verbose debug line. Captured to the log store (so it streams to the UI,
  // where it renders dimmed) and mirrored to stdout. DEPLOY_DEBUG=false silences.
  private debug(deploymentId: string, line: string): void {
    if (process.env.DEPLOY_DEBUG === 'false') return;
    console.debug(`[deploy:${deploymentId}] [debug] ${line}`);
    this.logSync(deploymentId, `@debug ${line}`);
  }

  private elapsed(startMs: number): string {
    const ms = Date.now() - startMs;
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const rem = Math.round(s % 60);
    return `${m}m ${rem}s`;
  }

  private listDir(dir: string): string {
    try {
      return fs.readdirSync(dir).slice(0, 50).join(', ') || '(empty)';
    } catch {
      return '(unreadable)';
    }
  }

  private async markFailed(
    deploymentId: string,
    appId: string,
    reason: string,
    step = 'Deploy',
    previewId?: string,
  ): Promise<void> {
    await this.log(deploymentId, `Deployment failed: ${reason}`);
    // updateMany: the row may be gone (app / preview deleted mid-deploy).
    await this.prisma.deployment.updateMany({
      where: { id: deploymentId },
      data: {
        status: 'failed',
        finishedAt: new Date(),
        errorReason: `${step}: ${reason}`.slice(0, 2000),
      },
    });
    // A failed deploy whose previous version is still up (the health check
    // rejected the new build, or the swap was rolled back) leaves the app live.
    const existing = await this.prisma.app.findUnique({
      where: { id: appId },
      select: { subdomain: true },
    });
    const preview = previewId
      ? await this.prisma.preview.findUnique({ where: { id: previewId } })
      : null;
    const stillServing = preview
      ? await this.isAppContainerServing(`upande-preview-${preview.subdomain}`)
      : existing
        ? await this.isAppContainerServing(`upande-${existing.subdomain}`)
        : false;
    if (stillServing) {
      await this.info(deploymentId, 'The previous version is still serving.');
    }
    // GitHub commit status / PR comment → failure (best-effort, never throws).
    await this.githubReporter.reportDeployment(
      deploymentId,
      step === 'Initializing' ? 'error' : 'failure',
      { reason: `${step}: ${reason}`, log: (l) => this.info(deploymentId, l) },
    );
    // Persist after the last line so the stored log is complete.
    await this.logStore.persist(deploymentId);
    if (!existing) return;
    // The preview was deleted meanwhile: nothing to report (and never report
    // it as a production failure).
    if (previewId && !preview) return;
    // A preview failure only affects the preview — never the app's status.
    if (preview) {
      await this.prisma.preview.update({
        where: { id: preview.id },
        data: { status: stillServing ? 'live' : 'failed' },
      });
    }
    const app = previewId
      ? await this.prisma.app.findUniqueOrThrow({
          where: { id: appId },
          select: { name: true, project: { select: { userId: true, organizationId: true } } },
        })
      : await this.prisma.app.update({
          where: { id: appId },
          data: { status: stillServing ? 'live' : 'failed' },
          select: {
            name: true,
            project: { select: { userId: true, organizationId: true } },
          },
        });

    // Notify the app owner that the deployment failed. The message stays
    // CONCISE — it names the app and the failing step only; the full error text
    // lives in metadata.reason for the analysis page, so we never dump a wall of
    // build output into the toast/bell.
    try {
      await this.notifications.create({
        userId: app.project.userId,
        organizationId: app.project.organizationId,
        type: 'deployment_failed',
        message: preview
          ? `Preview deploy of "${app.name}" (branch ${preview.branch}) failed at "${step}".`
          : `Deployment of "${app.name}" failed at "${step}".`,
        metadata: {
          appId,
          deploymentId,
          step,
          reason,
          appName: app.name,
          ...(preview ? { previewId: preview.id, branch: preview.branch } : {}),
        },
      });
    } catch (err) {
      this.debug(deploymentId, `failed to create notification: ${String(err)}`);
    }
  }

  private async stopContainerIfExists(deploymentId: string, name: string): Promise<void> {
    try {
      const container = this.docker.getContainer(name);
      const info = await container.inspect();
      this.debug(deploymentId, `existing container ${name}: running=${info.State.Running} — removing`);
      if (info.State.Running) {
        await container.stop();
      }
      await container.remove({ force: true });
      this.debug(deploymentId, `removed existing container ${name}`);
    } catch {
      // Container does not exist — that is fine
      this.debug(deploymentId, `no existing container ${name} to remove`);
    }
  }

  // Capture enough of the currently-running container to recreate it verbatim
  // if a deploy swap fails. Returns null when there is no existing container
  // (e.g. the very first deploy) — nothing to roll back to in that case.
  private async snapshotContainer(
    deploymentId: string,
    name: string,
  ): Promise<ContainerBackup | null> {
    try {
      const info = await this.docker.getContainer(name).inspect();
      // Pin to the image *ID* (not tag): even if the tag is later pruned, the
      // ID keeps the layers alive as long as we recreate from it promptly.
      const image = info.Image;
      const networkMode =
        info.HostConfig?.NetworkMode || process.env.DOCKER_NETWORK || 'upande_net';
      return {
        image,
        labels: info.Config?.Labels ?? {},
        env: info.Config?.Env ?? [],
        networkMode,
        restartPolicy: info.HostConfig?.RestartPolicy?.Name
          ? {
              Name: info.HostConfig.RestartPolicy.Name as Docker.HostRestartPolicy['Name'],
              ...(info.HostConfig.RestartPolicy.MaximumRetryCount
                ? { MaximumRetryCount: info.HostConfig.RestartPolicy.MaximumRetryCount }
                : {}),
            }
          : appRestartPolicy(),
        binds: info.HostConfig?.Binds ?? [],
      };
    } catch {
      this.debug(deploymentId, `no running container ${name} to snapshot`);
      return null;
    }
  }

  // Recreate the previous container from a snapshot. Best-effort: this runs on
  // the failure path, so it must not throw — a failure here is logged and the
  // caller reports the site may be down.
  private async restoreContainer(
    deploymentId: string,
    name: string,
    backup: ContainerBackup,
  ): Promise<boolean> {
    try {
      // Remove whatever half-created container may exist under the name first.
      await this.stopContainerIfExists(deploymentId, name);
      const container = await this.docker.createContainer({
        Image: backup.image,
        name,
        Labels: backup.labels,
        HostConfig: {
          NetworkMode: backup.networkMode,
          RestartPolicy: backup.restartPolicy,
          ...(backup.binds.length ? { Binds: backup.binds } : {}),
        },
        Env: backup.env,
      });
      await container.start();
      this.debug(
        deploymentId,
        `restored container ${name} from image ${backup.image.slice(0, 19)}`,
      );
      return true;
    } catch (err) {
      this.debug(deploymentId, `restore failed: ${String(err)}`);
      return false;
    }
  }
}

interface ContainerBackup {
  image: string;
  labels: Record<string, string>;
  env: string[];
  networkMode: string;
  restartPolicy: Docker.HostRestartPolicy;
  binds: string[];
}

export type { HealthConfig } from '../common/health-probe.util';

// Docker multiplexes non-TTY container logs into frames: an 8-byte header
// ([stream, 0, 0, 0, size(4, BE)]) followed by the payload. Strip the headers.
export function demuxDockerLogs(buf: Buffer): string {
  const parts: string[] = [];
  let i = 0;
  while (i + 8 <= buf.length && buf[i] <= 2 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 0) {
    const size = buf.readUInt32BE(i + 4);
    parts.push(buf.subarray(i + 8, i + 8 + size).toString('utf8'));
    i += 8 + size;
  }
  if (i < buf.length) parts.push(buf.subarray(i).toString('utf8'));
  return parts.join('');
}

// Docker restart policy for app containers (APP_RESTART_POLICY):
// "on-failure:5" (default), "on-failure[:<max>]", "unless-stopped", "always"
// or "no". The default restarts a crashed app up to 5 times and then gives up,
// so an app that can never start (bad config, missing DB, ...) ends up
// "crashed" instead of crash-looping forever; `unless-stopped`/`always` retry
// endlessly.
export const DEFAULT_APP_RESTART_POLICY = 'on-failure:5';
export function appRestartPolicy(): Docker.HostRestartPolicy {
  const raw = (process.env.APP_RESTART_POLICY || DEFAULT_APP_RESTART_POLICY).trim();
  const [name, max] = raw.split(':');
  if (name === 'on-failure') {
    const n = Number(max);
    return {
      Name: 'on-failure',
      ...(Number.isFinite(n) && n > 0 ? { MaximumRetryCount: Math.floor(n) } : {}),
    };
  }
  if (name === 'always' || name === 'no' || name === 'unless-stopped') return { Name: name };
  return { Name: 'on-failure', MaximumRetryCount: 5 };
}
