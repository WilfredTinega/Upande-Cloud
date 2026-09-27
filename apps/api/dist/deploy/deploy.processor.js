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
exports.DEFAULT_APP_RESTART_POLICY = exports.DeployProcessor = exports.DeployCancelledError = exports.DeployAbortError = void 0;
exports.imageRetentionCount = imageRetentionCount;
exports.demuxDockerLogs = demuxDockerLogs;
exports.appRestartPolicy = appRestartPolicy;
const bullmq_1 = require("@nestjs/bullmq");
const path = require("path");
const fs = require("fs");
const child_process_1 = require("child_process");
const Docker = require("dockerode");
const simple_git_1 = require("simple-git");
const prisma_service_1 = require("../prisma/prisma.service");
const log_store_service_1 = require("./log-store.service");
const deploy_constants_1 = require("./deploy.constants");
const encrypt_util_1 = require("../common/encrypt.util");
const env_scope_util_1 = require("../common/env-scope.util");
const repo_url_util_1 = require("../common/repo-url.util");
const preview_auth_util_1 = require("../common/preview-auth.util");
const app_url_util_1 = require("../common/app-url.util");
const upload_path_util_1 = require("../common/upload-path.util");
const db_provision_service_1 = require("../database/db-provision.service");
const notifications_service_1 = require("../notifications/notifications.service");
const empty_content_page_1 = require("./empty-content-page");
const health_probe_util_1 = require("../common/health-probe.util");
const nodered_1 = require("../apps/nodered");
const build_cache_service_1 = require("./build-cache.service");
const github_reporter_service_1 = require("../github/github-reporter.service");
const build_cache_util_1 = require("./build-cache.util");
const APP_LISTEN_PORT = 8080;
class DeployAbortError extends Error {
}
exports.DeployAbortError = DeployAbortError;
class DeployCancelledError extends DeployAbortError {
}
exports.DeployCancelledError = DeployCancelledError;
function imageRetentionCount() {
    const n = Number(process.env.IMAGE_RETENTION_COUNT ?? 5);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 5;
}
let DeployProcessor = class DeployProcessor extends bullmq_1.WorkerHost {
    constructor(prisma, logStore, dbProvision, notifications, buildCache, githubReporter) {
        super();
        this.prisma = prisma;
        this.logStore = logStore;
        this.dbProvision = dbProvision;
        this.notifications = notifications;
        this.buildCache = buildCache;
        this.githubReporter = githubReporter;
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
    }
    async process(job) {
        const { deploymentId, appId } = job.data;
        const maxAttempts = job.opts.attempts ?? 1;
        const attempt = job.attemptsMade + 1;
        const isRetry = job.attemptsMade > 0;
        const forceClean = job.data.forceClean === true;
        const cleanBuild = isRetry || forceClean;
        const startedAt = Date.now();
        await this.info(deploymentId, attempt > 1
            ? `Build started (attempt ${attempt} of ${maxAttempts})`
            : 'Build started');
        this.debug(deploymentId, `deployment=${deploymentId} job.id=${job.id} appId=${appId} ref=${job.data.ref ?? '(default)'}`);
        this.debug(deploymentId, `runtime: node=${process.version} platform=${process.platform} arch=${process.arch} pid=${process.pid}`);
        this.debug(deploymentId, `env: DOCKER_NETWORK=${process.env.DOCKER_NETWORK ?? 'upande_net'} NODE_ENV=${process.env.NODE_ENV ?? '(unset)'}`);
        await this.prisma.deployment.update({
            where: { id: deploymentId },
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
            await this.stageFail(deploymentId, 'Initializing', 'App not found');
            await this.markFailed(deploymentId, appId, 'App not found', 'Initializing');
            return;
        }
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
            await this.info(deploymentId, `Preview of branch ${preview.branch} → ${(0, app_url_util_1.buildAppUrl)(preview.subdomain)} (separate container, isolated from production)`);
        }
        const anyDatabaseUrl = app.envVars.some((v) => v.key === 'DATABASE_URL');
        app.envVars = (0, env_scope_util_1.effectiveEnvVars)(app.envVars, preview ? 'preview' : 'production');
        const imageRepo = preview ? `upande-preview-${preview.subdomain}` : `upande-app-${app.subdomain}`;
        this.debug(deploymentId, `app: name=${app.name} subdomain=${app.subdomain} type=${app.type} source=${app.source} branch=${app.branch ?? 'main'}`);
        this.debug(deploymentId, `app config: buildCmd=${app.buildCmd ?? '(default)'} outputDir=${app.outputDir ?? 'dist'} envVars=${app.envVars.length} github=${app.githubRepoFullName ?? '(none)'}`);
        const workDir = `/tmp/upande-build-${deploymentId}`;
        let currentStage = 'Initializing';
        try {
            currentStage = 'Preparing';
            const prepStart = Date.now();
            await this.stageStart(deploymentId, currentStage);
            if (isRetry) {
                await this.info(deploymentId, `Retry ${job.attemptsMade}: clearing build cache`);
                await this.clearCaches(deploymentId, imageRepo, app.id);
            }
            else if (forceClean) {
                await this.info(deploymentId, job.data.clearCache
                    ? 'Clear build cache & redeploy: removing this app\'s build cache'
                    : 'Migrate: clean rebuild — clearing build cache');
                await this.clearCaches(deploymentId, imageRepo, app.id);
            }
            this.debug(deploymentId, `work dir ${workDir}`);
            if (fs.existsSync(workDir)) {
                this.debug(deploymentId, 'removing stale work dir');
                fs.rmSync(workDir, { recursive: true, force: true });
            }
            fs.mkdirSync(workDir, { recursive: true });
            await this.stageOk(deploymentId, currentStage, prepStart);
            let reuseImage = null;
            if (job.data.rollbackImage && app.type !== 'nodered' && !preview) {
                if (await this.imageExists(job.data.rollbackImage)) {
                    reuseImage = job.data.rollbackImage;
                    await this.info(deploymentId, job.data.promoteFrom
                        ? `Promote: reusing the preview image of ${job.data.promoteFrom} as ${reuseImage} (no rebuild, production env)`
                        : `Rollback: reusing the previously built image ${reuseImage} (no rebuild)`);
                }
                else if (app.source === 'git' && job.data.commitSha) {
                    await this.info(deploymentId, `Rollback: image ${job.data.rollbackImage} was pruned — rebuilding commit ${job.data.commitSha.slice(0, 7)}`);
                }
                else {
                    throw new DeployAbortError(app.source === 'upload'
                        ? 'The image for that version was pruned and uploaded sources are not versioned, so it cannot be rebuilt. Upload the files again and deploy.'
                        : 'The image for that version was pruned and its commit is unknown, so it cannot be rebuilt exactly.');
                }
            }
            if (reuseImage) {
                this.debug(deploymentId, 'skipping source checkout (image reused)');
            }
            else if (app.type === 'nodered') {
                await this.info(deploymentId, 'Node-RED app — running the official image (no source build)');
            }
            else if (app.source === 'git' && app.repoUrl) {
                currentStage = 'Cloning repository';
                const cloneStart = Date.now();
                await this.stageStart(deploymentId, currentStage);
                const branch = preview?.branch || job.data.ref || app.branch || 'main';
                await this.info(deploymentId, `${app.repoUrl} (branch ${branch})`);
                this.debug(deploymentId, `git clone --depth 1 --branch ${branch} (token redacted)`);
                const cloneUrl = await this.authenticatedCloneUrl(app);
                if (job.data.commitSha) {
                    await this.info(deploymentId, `Checking out commit ${job.data.commitSha}`);
                    await this.checkoutCommit(workDir, cloneUrl, job.data.commitSha);
                }
                else {
                    const git = (0, simple_git_1.default)();
                    await git.clone(cloneUrl, workDir, ['--depth', '1', '--branch', branch]);
                }
                this.debug(deploymentId, `cloned files: ${this.listDir(workDir)}`);
                await this.recordCommit(deploymentId, workDir);
                await this.stageOk(deploymentId, currentStage, cloneStart);
                await this.githubReporter.reportDeployment(deploymentId, 'pending', {
                    log: (l) => this.info(deploymentId, l),
                });
            }
            else if (app.source === 'upload') {
                currentStage = 'Copying uploaded files';
                const copyStart = Date.now();
                await this.stageStart(deploymentId, currentStage);
                const srcDir = (0, upload_path_util_1.appUploadDir)(app.id);
                if (!fs.existsSync(srcDir) || fs.readdirSync(srcDir).length === 0) {
                    throw new Error('No uploaded files found for this app. Upload your code folder, then deploy.');
                }
                fs.cpSync(srcDir, workDir, { recursive: true });
                await this.info(deploymentId, `copied uploaded files: ${this.listDir(workDir)}`);
                await this.stageOk(deploymentId, currentStage, copyStart);
            }
            else {
                await this.info(deploymentId, 'No source configured — nothing to build');
            }
            let imageTag;
            if (reuseImage) {
                currentStage = 'Reusing image';
                const reuseStart = Date.now();
                await this.stageStart(deploymentId, currentStage);
                imageTag = reuseImage;
                await this.info(deploymentId, `Image ready: ${imageTag}`);
                await this.stageOk(deploymentId, currentStage, reuseStart);
            }
            else if (app.type === 'nodered') {
                currentStage = 'Pulling Node-RED image';
                const pullStart = Date.now();
                await this.stageStart(deploymentId, currentStage);
                await this.ensureImage(deploymentId, nodered_1.NODERED_IMAGE, true);
                imageTag = nodered_1.NODERED_IMAGE;
                await this.info(deploymentId, `Image ready: ${nodered_1.NODERED_IMAGE}`);
                await this.stageOk(deploymentId, currentStage, pullStart);
            }
            else {
                currentStage = 'Building';
                const buildStart = Date.now();
                await this.stageStart(deploymentId, currentStage);
                imageTag = `${imageRepo}:${deploymentId}`;
                this.debug(deploymentId, `image tag: ${imageTag}`);
                await this.buildImage(deploymentId, workDir, imageTag, app, cleanBuild);
                await this.stageOk(deploymentId, currentStage, buildStart);
            }
            const containerName = preview
                ? `upande-preview-${preview.subdomain}`
                : `upande-${app.subdomain}`;
            const userPort = Number(app.envVars.find((v) => v.key === 'PORT')?.value?.trim());
            const containerPort = app.type === 'nodered'
                ? nodered_1.NODERED_PORT
                : app.type !== 'static' && Number.isInteger(userPort) && userPort > 0 && userPort < 65536
                    ? userPort
                    : APP_LISTEN_PORT;
            let labels = preview
                ? this.buildPreviewLabels(preview.subdomain, containerPort, app.id, preview.id)
                : this.buildTraefikLabels(app.subdomain, containerPort, app.customDomains);
            if (preview) {
                const protection = await this.prisma.previewProtection.findUnique({ where: { appId: app.id } });
                labels = (0, preview_auth_util_1.applyPreviewAuth)(labels, preview.subdomain, protection);
                if (protection)
                    await this.info(deploymentId, 'Preview is password-protected');
            }
            if (app.type !== 'nodered')
                labels = (0, preview_auth_util_1.withRetryMiddleware)(labels, containerName);
            const networkMode = process.env.DOCKER_NETWORK ?? 'upande_net';
            const previewNeedsDb = !!preview && (app.type === 'fullstack' || anyDatabaseUrl);
            const envList = app.envVars
                .filter((v) => !(preview && v.key === 'DATABASE_URL'))
                .map((v) => `${v.key}=${v.value}`);
            if (preview) {
                envList.push('UPANDE_PREVIEW=true', `UPANDE_PREVIEW_BRANCH=${preview.branch}`);
            }
            if (app.type !== 'nodered' && !app.envVars.some((v) => v.key === 'PORT')) {
                envList.push(`PORT=${containerPort}`);
            }
            const extraBinds = [];
            if (preview) {
                if (previewNeedsDb) {
                    currentStage = 'Provisioning preview database';
                    const dbStart = Date.now();
                    await this.stageStart(deploymentId, currentStage);
                    try {
                        const db = await this.dbProvision.ensureForPreview(preview.id, preview.subdomain);
                        envList.push(`DATABASE_URL=${this.dbProvision.buildAppDatabaseUrl(db)}`);
                        await this.info(deploymentId, `Throwaway preview database ready: ${db.dbName} (the production database is never used by previews)`);
                        await this.stageOk(deploymentId, currentStage, dbStart);
                    }
                    catch (dbErr) {
                        const reason = dbErr instanceof Error ? dbErr.message : String(dbErr);
                        throw new Error(`Preview database provisioning failed: ${reason}`);
                    }
                }
            }
            else if (app.type === 'fullstack') {
                const userSetDbUrl = app.envVars.some((v) => v.key === 'DATABASE_URL');
                if (userSetDbUrl) {
                    await this.info(deploymentId, 'DATABASE_URL is set via env vars — skipping managed database');
                }
                else {
                    currentStage = 'Provisioning database';
                    const dbStart = Date.now();
                    await this.stageStart(deploymentId, currentStage);
                    try {
                        await this.info(deploymentId, 'Provisioning managed database');
                        const db = await this.dbProvision.ensureForApp(app.id, app.subdomain);
                        const url = this.dbProvision.buildAppDatabaseUrl(db);
                        envList.push(`DATABASE_URL=${url}`);
                        this.debug(deploymentId, `injected DATABASE_URL for db=${db.dbName} role=${db.roleName} host=${db.host}:${db.port}`);
                        await this.info(deploymentId, `Database ready: ${db.dbName} (reachable at ${db.host}:${db.port})`);
                        await this.stageOk(deploymentId, currentStage, dbStart);
                    }
                    catch (dbErr) {
                        const reason = dbErr instanceof Error ? dbErr.message : String(dbErr);
                        throw new Error(`Database provisioning failed: ${reason}`);
                    }
                }
            }
            if (app.type === 'nodered') {
                const volume = app.noderedVolumeName ?? `upande-nodered-${app.subdomain}`;
                currentStage = 'Configuring Node-RED';
                const cfgStart = Date.now();
                await this.stageStart(deploymentId, currentStage);
                try {
                    await this.info(deploymentId, `Routing this instance via Traefik on ${(0, app_url_util_1.appSubdomainHost)(app.subdomain)} (-> container ${nodered_1.NODERED_PORT})`);
                    await this.info(deploymentId, `Writing settings.js to the /data volume (${volume})`);
                    await this.info(deploymentId, `Applying adminAuth for ${app.noderedUsers.length} editor account(s): ${app.noderedUsers.map((u) => u.username).join(', ') || '(none)'}`);
                    const settings = (0, nodered_1.renderNodeRedSettings)(app.noderedUsers.map((u) => ({
                        username: u.username,
                        passwordHash: u.passwordHash,
                        permission: u.permission,
                    })));
                    await this.writeNodeRedSettings(deploymentId, volume, settings);
                    extraBinds.push(`${volume}:${nodered_1.NODERED_DATA_DIR}`);
                    await this.info(deploymentId, 'Flows, nodes and credentials persist in this volume across redeploys');
                    await this.info(deploymentId, `Node-RED ready with ${app.noderedUsers.length} editor account(s)`);
                    await this.stageOk(deploymentId, currentStage, cfgStart);
                }
                catch (nrErr) {
                    const reason = nrErr instanceof Error ? nrErr.message : String(nrErr);
                    throw new Error(`Node-RED provisioning failed: ${reason}`);
                }
            }
            const health = this.healthConfig(app);
            const usesProdDb = !preview && (app.type === 'fullstack' || envList.some((e) => e.startsWith('DATABASE_URL=')));
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
            }
            else if (usesProdDb) {
                await this.info(deploymentId, 'Database-backed app: the new container is health-checked in place (no throwaway candidate against the production database)');
            }
            await this.assertStillWanted(deploymentId);
            currentStage = app.type === 'nodered' ? 'Starting Node-RED' : 'Deploying';
            const deployStart = Date.now();
            await this.stageStart(deploymentId, currentStage);
            if (!preview && app.customDomains.length) {
                await this.info(deploymentId, `Routing custom domains: ${app.customDomains.map((d) => d.domain).join(', ')}`);
            }
            const createApp = (name) => this.docker.createContainer({
                Image: imageTag,
                name,
                Labels: labels,
                HostConfig: {
                    NetworkMode: networkMode,
                    RestartPolicy: appRestartPolicy(),
                    ...(extraBinds.length ? { Binds: extraBinds } : {}),
                },
                Env: envList,
            });
            const live = await this.docker
                .getContainer(containerName)
                .inspect()
                .catch(() => null);
            const traefikOnly = (l) => JSON.stringify(Object.entries(l)
                .filter(([k]) => k.startsWith('traefik.'))
                .sort(([a], [b]) => a.localeCompare(b)));
            const canOverlap = app.type !== 'nodered' &&
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
                    if (!post.ok)
                        throw new DeployAbortError(`Health check failed — ${post.reason}`);
                }
                catch (err) {
                    await next.remove({ force: true }).catch(() => undefined);
                    await this.info(deploymentId, 'New version is unhealthy — removed it; the previous version kept serving');
                    throw err;
                }
                await this.info(deploymentId, 'New version healthy — retiring the previous container (no downtime)');
                await new Promise((r) => setTimeout(r, 3000));
                await this.stopContainerIfExists(deploymentId, containerName);
                await next.rename({ name: containerName });
            }
            else {
                if (live?.State?.Running && app.type !== 'nodered') {
                    this.debug(deploymentId, 'router labels changed — using stop/start swap (brief interruption)');
                }
                const backup = await this.snapshotContainer(deploymentId, containerName);
                if (backup) {
                    this.debug(deploymentId, `backup captured: image=${backup.image} (will restore this if the swap fails)`);
                }
                try {
                    await this.stopContainerIfExists(deploymentId, containerName);
                    this.debug(deploymentId, `creating container ${containerName} (image=${imageTag} network=${networkMode} port=${containerPort})`);
                    const container = await createApp(containerName);
                    await container.start();
                    this.debug(deploymentId, `container id=${container.id.slice(0, 12)} started`);
                    if (app.type === 'nodered') {
                        await this.tailNodeRedStartup(deploymentId, container);
                    }
                    const post = await this.waitHealthy(deploymentId, container, networkMode, containerPort, health);
                    if (!post.ok) {
                        throw new DeployAbortError(`Health check failed after the swap — ${post.reason}`);
                    }
                }
                catch (swapErr) {
                    const reason = swapErr instanceof Error ? swapErr.message : String(swapErr);
                    await this.info(deploymentId, `Swap failed (${reason}) — restoring the previous container`);
                    if (backup) {
                        const restored = await this.restoreContainer(deploymentId, containerName, backup);
                        if (restored) {
                            await this.info(deploymentId, 'Previous version restored — site is still up');
                        }
                        else {
                            await this.info(deploymentId, 'WARNING: could not restore the previous container — site may be down');
                        }
                    }
                    else {
                        await this.info(deploymentId, 'No previous container to restore (first deploy)');
                    }
                    throw swapErr;
                }
            }
            await this.stageOk(deploymentId, currentStage, deployStart);
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
                    await this.info(deploymentId, 'The preview was deleted during the deploy — removing it');
                    await this.stopContainerIfExists(deploymentId, containerName);
                    await this.docker.getImage(imageTag).remove({ force: true }).catch(() => undefined);
                }
            }
            else {
                await this.prisma.app.update({
                    where: { id: appId },
                    data: { status: 'live' },
                });
            }
            await this.info(deploymentId, `Deployed in ${this.elapsed(startedAt)}`);
            await this.info(deploymentId, `Live at ${(0, app_url_util_1.buildAppUrl)(preview ? preview.subdomain : app.subdomain)}`);
            await this.githubReporter.reportDeployment(deploymentId, 'success', {
                log: (l) => this.info(deploymentId, l),
            });
            this.debug(deploymentId, `removing work dir ${workDir}`);
            fs.rmSync(workDir, { recursive: true, force: true });
            if (preview) {
                await this.prunePreviewImages(deploymentId, imageRepo, imageTag);
            }
            else if (app.type !== 'nodered') {
                await this.pruneOldImages(deploymentId, app.id, app.subdomain, imageTag);
            }
            await this.logStore.persist(deploymentId);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error ? err.stack : undefined;
            await this.stageFail(deploymentId, currentStage, message);
            if (stack) {
                for (const line of stack.split('\n').slice(1)) {
                    this.debug(deploymentId, line.trim());
                }
            }
            try {
                fs.rmSync(workDir, { recursive: true, force: true });
                this.debug(deploymentId, 'work dir cleaned after failure');
            }
            catch {
            }
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
                await this.info(deploymentId, `Attempt ${attempt} of ${maxAttempts} failed — retrying with a clean cache`);
                throw err;
            }
            await this.markFailed(deploymentId, appId, err instanceof DeployAbortError
                ? message
                : `${message} (after ${maxAttempts} attempts)`, currentStage, preview?.id);
        }
    }
    async assertStillWanted(deploymentId) {
        const d = await this.prisma.deployment.findUnique({
            where: { id: deploymentId },
            select: { status: true, errorReason: true, appId: true, previewId: true },
        });
        if (!d)
            throw new DeployCancelledError('the app or preview was deleted during the deploy');
        if (d.status === 'failed')
            throw new DeployCancelledError(d.errorReason ?? 'cancelled');
        const app = await this.prisma.app.findUnique({ where: { id: d.appId }, select: { id: true } });
        if (!app)
            throw new DeployCancelledError('the app was deleted during the deploy');
        if (d.previewId) {
            const pv = await this.prisma.preview.findUnique({ where: { id: d.previewId }, select: { id: true } });
            if (!pv)
                throw new DeployCancelledError('the preview was deleted during the deploy');
        }
    }
    healthConfig(app) {
        return (0, health_probe_util_1.healthConfigFor)(app);
    }
    async checkCandidate(deploymentId, c) {
        await this.info(deploymentId, `Starting the new version alongside the current one and probing GET ${c.health.path} ` +
            `(${c.health.strict ? 'expects 2xx/3xx' : 'web server must answer'}; ` +
            `${c.health.retries} attempts, ${c.health.timeoutMs / 1000}s timeout)`);
        await this.stopContainerIfExists(deploymentId, c.name);
        const candidate = await this.docker.createContainer({
            Image: c.image,
            name: c.name,
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
                await this.info(deploymentId, 'The new version is unhealthy — nothing was swapped; the current version keeps serving.');
                throw new DeployAbortError(`New version unhealthy — ${result.reason}`);
            }
        }
        finally {
            try {
                await candidate.remove({ force: true });
            }
            catch {
            }
        }
    }
    async waitHealthy(deploymentId, container, networkMode, port, health) {
        let lastReason = 'no response';
        await new Promise((r) => setTimeout(r, Math.min(health.intervalMs, 750)));
        for (let attempt = 1; attempt <= health.retries; attempt++) {
            let info;
            try {
                info = await container.inspect();
            }
            catch {
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
                    await this.info(deploymentId, `Health check passed: GET ${health.path} → ${probe.status} (attempt ${attempt}/${health.retries})`);
                    return { ok: true };
                }
                lastReason = probe.reason;
            }
            else {
                lastReason = 'container has no network address yet';
            }
            await this.info(deploymentId, `Health check ${attempt}/${health.retries}: GET ${health.path} — ${lastReason}`);
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
    async probe(url, health) {
        return (0, health_probe_util_1.probeHttp)(url, health);
    }
    async copyContainerLogs(deploymentId, container) {
        try {
            const buf = (await container.logs({ stdout: true, stderr: true, tail: 30 }));
            const lines = demuxDockerLogs(buf)
                .replace(/[\x00-\x08]/g, '')
                .replace(/[\x0e-\x1f]/g, '')
                .split('\n')
                .map((l) => l.trimEnd())
                .filter(Boolean);
            if (lines.length) {
                await this.info(deploymentId, 'Last output from the new container:');
                for (const l of lines)
                    this.logSync(deploymentId, `[app] ${l}`);
            }
        }
        catch {
        }
    }
    async isAppContainerServing(name) {
        try {
            const info = await this.docker.getContainer(name).inspect();
            const image = info.Config?.Image ?? '';
            return (info.State.Running &&
                (image.startsWith('upande-app-') || image.startsWith('upande-preview-') || image === nodered_1.NODERED_IMAGE));
        }
        catch {
            return false;
        }
    }
    async imageExists(tag) {
        try {
            await this.docker.getImage(tag).inspect();
            return true;
        }
        catch {
            return false;
        }
    }
    async checkoutCommit(workDir, cloneUrl, sha) {
        try {
            const git = (0, simple_git_1.default)(workDir);
            await git.init();
            await git.addRemote('origin', cloneUrl);
            await git.fetch(['--depth', '1', 'origin', sha]);
            await git.checkout(['--detach', 'FETCH_HEAD']);
        }
        catch {
            fs.rmSync(workDir, { recursive: true, force: true });
            fs.mkdirSync(workDir, { recursive: true });
            await (0, simple_git_1.default)().clone(cloneUrl, workDir);
            await (0, simple_git_1.default)(workDir).checkout(['--detach', sha]);
        }
    }
    async pruneOldImages(deploymentId, appId, subdomain, currentImage) {
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
            const keep = new Set([currentImage]);
            for (const d of recent) {
                if (keep.size >= keepN)
                    break;
                if (d.imageRef && onDisk.has(d.imageRef))
                    keep.add(d.imageRef);
            }
            let removed = 0;
            for (const img of images) {
                for (const tag of img.RepoTags ?? []) {
                    if (!tag.startsWith(`${repo}:`) || keep.has(tag))
                        continue;
                    try {
                        await this.docker.getImage(tag).remove();
                        removed += 1;
                    }
                    catch (err) {
                        this.debug(deploymentId, `could not prune ${tag}: ${String(err)}`);
                    }
                }
            }
            this.debug(deploymentId, `image retention: keeping ${keep.size} image(s) (IMAGE_RETENTION_COUNT=${keepN}), pruned ${removed}`);
        }
        catch (err) {
            this.debug(deploymentId, `image retention failed: ${String(err)}`);
        }
    }
    async recordCommit(deploymentId, workDir) {
        try {
            const latest = (await (0, simple_git_1.default)(workDir).log({ maxCount: 1 })).latest;
            if (!latest)
                return;
            await this.prisma.deployment.update({
                where: { id: deploymentId },
                data: {
                    commitSha: latest.hash,
                    commitMessage: latest.message.slice(0, 500),
                },
            });
            await this.info(deploymentId, `Commit ${latest.hash.slice(0, 7)}: ${latest.message}`);
        }
        catch (err) {
            this.debug(deploymentId, `could not read commit info: ${String(err)}`);
        }
    }
    async authenticatedCloneUrl(app) {
        const repoUrl = app.repoUrl ?? '';
        if (!(0, repo_url_util_1.isAllowedRepoUrl)(repoUrl)) {
            throw new DeployAbortError('Repository URL must be an http(s):// git URL');
        }
        if (!app.githubRepoFullName ||
            !app.project?.userId ||
            !repoUrl.startsWith('https://github.com/')) {
            return repoUrl;
        }
        const account = await this.prisma.githubAccount.findUnique({
            where: { userId: app.project.userId },
            select: { accessToken: true },
        });
        if (!account)
            return repoUrl;
        try {
            const token = (0, encrypt_util_1.decrypt)(account.accessToken);
            return repoUrl.replace('https://github.com/', `https://x-access-token:${token}@github.com/`);
        }
        catch {
            return repoUrl;
        }
    }
    buildTraefikLabels(subdomain, containerPort, customDomains) {
        const resolver = process.env.ACME_RESOLVER;
        const labels = (0, app_url_util_1.buildSubdomainRouterLabels)(subdomain, containerPort);
        for (const { domain } of customDomains) {
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
    buildPreviewLabels(previewSubdomain, containerPort, appId, previewId) {
        const resolver = process.env.ACME_RESOLVER;
        const r = `pv-${previewSubdomain}`;
        const labels = {
            'traefik.enable': 'true',
            [`traefik.http.routers.${r}.rule`]: `Host(\`${(0, app_url_util_1.appSubdomainHost)(previewSubdomain)}\`)`,
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
    async prunePreviewImages(deploymentId, imageRepo, currentImage) {
        try {
            const images = await this.docker.listImages({ filters: { reference: [`${imageRepo}:*`] } });
            for (const tag of images.flatMap((i) => i.RepoTags ?? [])) {
                if (tag === currentImage || !tag.startsWith(`${imageRepo}:`))
                    continue;
                await this.docker.getImage(tag).remove().catch((err) => this.debug(deploymentId, `could not prune ${tag}: ${String(err)}`));
            }
        }
        catch (err) {
            this.debug(deploymentId, `preview image prune failed: ${String(err)}`);
        }
    }
    async buildImage(deploymentId, workDir, imageTag, app, noCache = false) {
        const repoDockerfile = fs.existsSync(path.join(workDir, 'Dockerfile'));
        if (repoDockerfile) {
            await this.log(deploymentId, 'Repository provides a Dockerfile — building with it (skipping nixpacks/fallback)');
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
            const args = ['build', '.', '--name', imageTag];
            if (app.buildCmd) {
                args.push('--build-cmd', app.buildCmd);
            }
            if (noCache) {
                args.push('--no-cache');
            }
            if ((0, build_cache_util_1.buildCacheEnabled)())
                args.push('--cache-key', (0, build_cache_util_1.buildCacheScope)(app.id));
            await this.runCommand(deploymentId, 'nixpacks', args, workDir);
        }
        else {
            await this.log(deploymentId, 'nixpacks binary not found, using Dockerfile fallback');
            const installMarker = await this.generateDockerfile(workDir, app, deploymentId);
            fs.writeFileSync(path.join(workDir, '.dockerignore'), ['.git', 'Dockerfile', '.dockerignore'].join('\n'), 'utf8');
            await this.runDockerBuild(deploymentId, workDir, imageTag, noCache, app.id, installMarker);
        }
    }
    async checkNixpacks() {
        try {
            (0, child_process_1.execSync)('which nixpacks', { stdio: 'ignore' });
            return true;
        }
        catch {
            return false;
        }
    }
    async generateDockerfile(workDir, app, deploymentId) {
        const hasPackageJson = fs.existsSync(path.join(workDir, 'package.json'));
        let installMarker = null;
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
        const purgeStockHtmlStep = 'RUN rm -rf /usr/share/nginx/html/* /usr/share/nginx/html/.??*';
        const emptyContentGuardStep = [
            'RUN if [ ! -f /usr/share/nginx/html/index.html ]; then \\',
            `      echo ${empty_content_page_1.EMPTY_CONTENT_HTML_B64} | base64 -d > /usr/share/nginx/html/index.html && \\`,
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
        let dockerfile;
        if (hasPackageJson) {
            const outputDir = app.outputDir ?? 'dist';
            const plan = (0, build_cache_util_1.detectNodeBuild)(workDir);
            const buildkit = (0, build_cache_util_1.buildCacheEnabled)() && (await this.buildCache.buildkitAvailable());
            installMarker = plan.installCmd;
            if (deploymentId) {
                await this.info(deploymentId, `Build cache: ${plan.pm}${plan.lockfile ? ` (${plan.lockfile})` : ' (no lockfile)'} — ${plan.isolatedReason}` +
                    (buildkit ? '; BuildKit cache mounts for package + framework caches' : ''));
            }
            const builderStage = (0, build_cache_util_1.buildCacheEnabled)()
                ? (0, build_cache_util_1.nodeBuilderStage)(plan, { scope: (0, build_cache_util_1.buildCacheScope)(app.id), buildkit, buildCmd: app.buildCmd })
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
        }
        else {
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
    async tailNodeRedStartup(deploymentId, container, timeoutMs = 25000) {
        await this.info(deploymentId, 'Starting Node-RED — streaming startup logs');
        try {
            const stream = (await container.logs({
                follow: true,
                stdout: true,
                stderr: true,
                tail: 0,
                timestamps: false,
            }));
            await new Promise((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled)
                        return;
                    settled = true;
                    clearTimeout(timer);
                    try {
                        stream.destroy?.();
                    }
                    catch {
                    }
                    resolve();
                };
                const timer = setTimeout(() => {
                    this.logSync(deploymentId, '@debug Node-RED startup log tail timed out — instance continues in the background');
                    finish();
                }, timeoutMs);
                stream.on('data', (chunk) => {
                    const text = chunk.toString('utf8').replace(/[\x00-\x08]/g, '');
                    for (const raw of text.split('\n')) {
                        const line = raw.replace(/[\x0e-\x1f]/g, '').trimEnd();
                        if (!line)
                            continue;
                        this.logSync(deploymentId, line);
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
        }
        catch (err) {
            this.debug(deploymentId, `could not tail Node-RED logs: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async ensureImage(deploymentId, image, showProgress = false) {
        try {
            await this.docker.getImage(image).inspect();
            if (showProgress) {
                await this.info(deploymentId, `Image ${image} already present locally`);
            }
            else {
                this.debug(deploymentId, `image ${image} already present`);
            }
            return;
        }
        catch {
        }
        if (showProgress) {
            await this.info(deploymentId, `${image}: Pulling from Docker Hub`);
        }
        const stream = await this.docker.pull(image);
        const lastStatus = new Map();
        await new Promise((resolve, reject) => {
            this.docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()), (event) => {
                if (!event.status || !event.id)
                    return;
                if (showProgress) {
                    if (lastStatus.get(event.id) !== event.status) {
                        lastStatus.set(event.id, event.status);
                        this.logSync(deploymentId, `${event.id}: ${event.status}`);
                    }
                }
                else {
                    this.debug(deploymentId, `pull ${event.id}: ${event.status}`);
                }
            });
        });
    }
    async writeNodeRedSettings(deploymentId, volume, settings) {
        await this.ensureImage(deploymentId, 'busybox:1.36');
        const b64 = Buffer.from(settings, 'utf8').toString('base64');
        const script = `echo ${b64} | base64 -d > ${nodered_1.NODERED_DATA_DIR}/settings.js && ` +
            `chown -R ${nodered_1.NODERED_UID}:${nodered_1.NODERED_GID} ${nodered_1.NODERED_DATA_DIR}`;
        const container = await this.docker.createContainer({
            Image: 'busybox:1.36',
            Cmd: ['sh', '-c', script],
            HostConfig: {
                Binds: [`${volume}:${nodered_1.NODERED_DATA_DIR}`],
                AutoRemove: false,
            },
        });
        try {
            await container.start();
            const result = await container.wait();
            const code = result.StatusCode ?? 0;
            if (code !== 0) {
                throw new Error(`writing Node-RED settings.js exited with code ${code}`);
            }
        }
        finally {
            try {
                await container.remove({ force: true });
            }
            catch {
            }
        }
    }
    async runDockerBuild(deploymentId, workDir, imageTag, noCache = false, appId, installMarker) {
        await this.log(deploymentId, `Building Docker image: ${imageTag}${noCache ? ' (--no-cache)' : ''}`);
        const buildkit = (0, build_cache_util_1.buildCacheEnabled)() && (await this.buildCache.buildkitAvailable());
        const counter = new build_cache_util_1.BuildOutputCacheCounter(installMarker ?? '');
        const args = ['build'];
        if (buildkit)
            args.push('--progress=plain');
        if (noCache)
            args.push('--no-cache');
        args.push('-t', imageTag, workDir);
        await this.runCommand(deploymentId, 'docker', args, undefined, buildkit ? { DOCKER_BUILDKIT: '1' } : undefined, (line) => counter.feed(line));
        await this.log(deploymentId, 'Docker build complete');
        await this.reportBuildCache(deploymentId, counter, noCache, buildkit, appId);
    }
    async reportBuildCache(deploymentId, counter, noCache, buildkit, appId) {
        try {
            const { steps, cached, depsCached } = counter.stats();
            const usage = appId && (0, build_cache_util_1.buildCacheEnabled)() ? await this.buildCache.usageForApp(appId) : null;
            const size = usage && usage.totalBytes > 0 ? `; app build cache now ${(0, build_cache_util_1.formatBytes)(usage.totalBytes)}` : '';
            const builder = buildkit ? 'BuildKit' : 'legacy builder';
            let msg;
            if (noCache) {
                msg = `Build cache: not used (clean build, ${builder})${size}`;
            }
            else if (depsCached) {
                msg = `Build cache hit: used build cache for ${cached} of ${steps} steps — dependency install restored from cache (${builder})${size}`;
            }
            else if (counter.tracksInstall()) {
                msg = `Build cache: dependencies installed fresh (first build for this app or lockfile changed); ${cached} of ${steps} steps cached (${builder})${size}`;
            }
            else if (cached > 0) {
                msg = `Build cache hit: used build cache for ${cached} of ${steps} steps (${builder})${size}`;
            }
            else {
                msg = `Build cache: miss — nothing reusable yet (${builder})${size}`;
            }
            await this.info(deploymentId, msg);
        }
        catch (err) {
            this.debug(deploymentId, `build cache report failed: ${String(err)}`);
        }
    }
    async runCommand(deploymentId, file, args, cwd, env, onLine) {
        const display = `${file} ${args.join(' ')}`;
        const start = Date.now();
        this.debug(deploymentId, `exec: ${display}${cwd ? ` (cwd=${cwd})` : ''}`);
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.execFile)(file, args, {
                cwd,
                maxBuffer: 64 * 1024 * 1024,
                env: env ? { ...process.env, ...env } : process.env,
            });
            child.stdout?.on('data', (data) => {
                const lines = data.toString().split('\n').filter(Boolean);
                for (const line of lines) {
                    this.logSync(deploymentId, line);
                    onLine?.(line);
                }
            });
            child.stderr?.on('data', (data) => {
                const lines = data.toString().split('\n').filter(Boolean);
                for (const line of lines) {
                    this.logSync(deploymentId, `[stderr] ${line}`);
                    onLine?.(line);
                }
            });
            child.on('close', (code) => {
                this.debug(deploymentId, `exec done: ${file} exited code=${code} (${this.elapsed(start)})`);
                if (code === 0) {
                    resolve();
                }
                else {
                    reject(new Error(`Command exited with code ${code}: ${display}`));
                }
            });
            child.on('error', (err) => {
                this.debug(deploymentId, `exec error: ${file}: ${err.message}`);
                reject(err);
            });
        });
    }
    async clearCaches(deploymentId, imageRepo, appId) {
        const workDir = `/tmp/upande-build-${deploymentId}`;
        try {
            if (fs.existsSync(workDir)) {
                fs.rmSync(workDir, { recursive: true, force: true });
                this.debug(deploymentId, `cleared stale work dir ${workDir}`);
            }
        }
        catch (err) {
            this.debug(deploymentId, `work dir clear failed: ${String(err)}`);
        }
        try {
            await this.docker.getImage(`${imageRepo}:${deploymentId}`).remove({ force: true });
            this.debug(deploymentId, `removed partial image for ${deploymentId}`);
        }
        catch {
            this.debug(deploymentId, `no partial image for ${deploymentId}`);
        }
        try {
            const { removedEntries, reclaimedBytes } = await this.buildCache.clearForApp(appId);
            await this.info(deploymentId, removedEntries > 0
                ? `Build cache cleared (${removedEntries} entr${removedEntries === 1 ? 'y' : 'ies'}, ${(0, build_cache_util_1.formatBytes)(reclaimedBytes)} freed)`
                : 'Build cache cleared (nothing cached yet)');
        }
        catch (err) {
            this.debug(deploymentId, `build cache clear failed: ${String(err)}`);
        }
    }
    async runCommandSafe(deploymentId, file, args) {
        try {
            await this.runCommand(deploymentId, file, args);
        }
        catch (err) {
            this.debug(deploymentId, `(ignored) ${file} failed: ${String(err)}`);
        }
    }
    logSync(deploymentId, line) {
        this.logStore.append(deploymentId, line).catch(() => { });
    }
    async log(deploymentId, line) {
        console.log(`[deploy:${deploymentId}] ${line}`);
        await this.logStore.append(deploymentId, line);
    }
    async info(deploymentId, text) {
        await this.log(deploymentId, `@info ${text}`);
    }
    async stageStart(deploymentId, name) {
        await this.log(deploymentId, `@stage ${name}`);
    }
    async stageOk(deploymentId, name, startMs) {
        await this.log(deploymentId, `@ok ${name}|${this.elapsed(startMs)}`);
    }
    async stageFail(deploymentId, name, reason) {
        await this.log(deploymentId, `@fail ${name}|${reason}`);
    }
    debug(deploymentId, line) {
        if (process.env.DEPLOY_DEBUG === 'false')
            return;
        console.debug(`[deploy:${deploymentId}] [debug] ${line}`);
        this.logSync(deploymentId, `@debug ${line}`);
    }
    elapsed(startMs) {
        const ms = Date.now() - startMs;
        if (ms < 1000)
            return `${ms}ms`;
        const s = ms / 1000;
        if (s < 60)
            return `${s.toFixed(1)}s`;
        const m = Math.floor(s / 60);
        const rem = Math.round(s % 60);
        return `${m}m ${rem}s`;
    }
    listDir(dir) {
        try {
            return fs.readdirSync(dir).slice(0, 50).join(', ') || '(empty)';
        }
        catch {
            return '(unreadable)';
        }
    }
    async markFailed(deploymentId, appId, reason, step = 'Deploy', previewId) {
        await this.log(deploymentId, `Deployment failed: ${reason}`);
        await this.prisma.deployment.updateMany({
            where: { id: deploymentId },
            data: {
                status: 'failed',
                finishedAt: new Date(),
                errorReason: `${step}: ${reason}`.slice(0, 2000),
            },
        });
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
        await this.githubReporter.reportDeployment(deploymentId, step === 'Initializing' ? 'error' : 'failure', { reason: `${step}: ${reason}`, log: (l) => this.info(deploymentId, l) });
        await this.logStore.persist(deploymentId);
        if (!existing)
            return;
        if (previewId && !preview)
            return;
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
        }
        catch (err) {
            this.debug(deploymentId, `failed to create notification: ${String(err)}`);
        }
    }
    async stopContainerIfExists(deploymentId, name) {
        try {
            const container = this.docker.getContainer(name);
            const info = await container.inspect();
            this.debug(deploymentId, `existing container ${name}: running=${info.State.Running} — removing`);
            if (info.State.Running) {
                await container.stop();
            }
            await container.remove({ force: true });
            this.debug(deploymentId, `removed existing container ${name}`);
        }
        catch {
            this.debug(deploymentId, `no existing container ${name} to remove`);
        }
    }
    async snapshotContainer(deploymentId, name) {
        try {
            const info = await this.docker.getContainer(name).inspect();
            const image = info.Image;
            const networkMode = info.HostConfig?.NetworkMode || process.env.DOCKER_NETWORK || 'upande_net';
            return {
                image,
                labels: info.Config?.Labels ?? {},
                env: info.Config?.Env ?? [],
                networkMode,
                restartPolicy: info.HostConfig?.RestartPolicy?.Name
                    ? {
                        Name: info.HostConfig.RestartPolicy.Name,
                        ...(info.HostConfig.RestartPolicy.MaximumRetryCount
                            ? { MaximumRetryCount: info.HostConfig.RestartPolicy.MaximumRetryCount }
                            : {}),
                    }
                    : appRestartPolicy(),
                binds: info.HostConfig?.Binds ?? [],
            };
        }
        catch {
            this.debug(deploymentId, `no running container ${name} to snapshot`);
            return null;
        }
    }
    async restoreContainer(deploymentId, name, backup) {
        try {
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
            this.debug(deploymentId, `restored container ${name} from image ${backup.image.slice(0, 19)}`);
            return true;
        }
        catch (err) {
            this.debug(deploymentId, `restore failed: ${String(err)}`);
            return false;
        }
    }
};
exports.DeployProcessor = DeployProcessor;
exports.DeployProcessor = DeployProcessor = __decorate([
    (0, bullmq_1.Processor)(deploy_constants_1.DEPLOY_QUEUE),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        log_store_service_1.LogStoreService,
        db_provision_service_1.DbProvisionService,
        notifications_service_1.NotificationsService,
        build_cache_service_1.BuildCacheService,
        github_reporter_service_1.GithubReporterService])
], DeployProcessor);
function demuxDockerLogs(buf) {
    const parts = [];
    let i = 0;
    while (i + 8 <= buf.length && buf[i] <= 2 && buf[i + 1] === 0 && buf[i + 2] === 0 && buf[i + 3] === 0) {
        const size = buf.readUInt32BE(i + 4);
        parts.push(buf.subarray(i + 8, i + 8 + size).toString('utf8'));
        i += 8 + size;
    }
    if (i < buf.length)
        parts.push(buf.subarray(i).toString('utf8'));
    return parts.join('');
}
exports.DEFAULT_APP_RESTART_POLICY = 'on-failure:5';
function appRestartPolicy() {
    const raw = (process.env.APP_RESTART_POLICY || exports.DEFAULT_APP_RESTART_POLICY).trim();
    const [name, max] = raw.split(':');
    if (name === 'on-failure') {
        const n = Number(max);
        return {
            Name: 'on-failure',
            ...(Number.isFinite(n) && n > 0 ? { MaximumRetryCount: Math.floor(n) } : {}),
        };
    }
    if (name === 'always' || name === 'no' || name === 'unless-stopped')
        return { Name: name };
    return { Name: 'on-failure', MaximumRetryCount: 5 };
}
//# sourceMappingURL=deploy.processor.js.map