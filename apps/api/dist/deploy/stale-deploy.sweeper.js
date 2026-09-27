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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var StaleDeploySweeper_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaleDeploySweeper = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const Docker = require("dockerode");
const prisma_service_1 = require("../prisma/prisma.service");
const deploy_constants_1 = require("./deploy.constants");
const log_store_service_1 = require("./log-store.service");
let StaleDeploySweeper = StaleDeploySweeper_1 = class StaleDeploySweeper {
    constructor(prisma, logStore, queue) {
        this.prisma = prisma;
        this.logStore = logStore;
        this.queue = queue;
        this.logger = new common_1.Logger(StaleDeploySweeper_1.name);
        this.docker = new Docker({ socketPath: '/var/run/docker.sock' });
        this.timer = null;
        this.running = false;
    }
    onModuleInit() {
        const every = Math.max(30, Number(process.env.STALE_DEPLOY_SWEEP_SECONDS ?? 120) || 120) * 1000;
        setTimeout(() => void this.sweep(), 30_000).unref();
        this.timer = setInterval(() => void this.sweep(), every);
        this.timer.unref();
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    async serving(name) {
        try {
            const i = await this.docker.getContainer(name).inspect();
            return !!i.State?.Running && !i.State?.Restarting;
        }
        catch {
            return false;
        }
    }
    async sweep() {
        if (this.running)
            return 0;
        this.running = true;
        try {
            const minutes = Math.max(1, Number(process.env.STALE_DEPLOY_MINUTES ?? 5) || 5);
            const cutoff = new Date(Date.now() - minutes * 60_000);
            const jobs = await this.queue.getJobs(['waiting', 'delayed', 'active', 'prioritized', 'waiting-children']);
            const live = new Set(jobs.map((j) => j?.data?.deploymentId).filter(Boolean));
            const stale = await this.prisma.deployment.findMany({
                where: { status: { in: ['queued', 'building'] }, createdAt: { lt: cutoff } },
                select: { id: true, appId: true, previewId: true },
                take: 200,
            });
            let fixed = 0;
            for (const d of stale) {
                if (live.has(d.id))
                    continue;
                const reason = 'Interrupted: the deploy stopped without finishing (API restart or worker crash)';
                const res = await this.prisma.deployment.updateMany({
                    where: { id: d.id, status: { in: ['queued', 'building'] } },
                    data: { status: 'failed', finishedAt: new Date(), errorReason: reason },
                });
                if (!res.count)
                    continue;
                fixed += 1;
                await this.logStore.append(d.id, `@fail Deploy|${reason}`).catch(() => undefined);
                await this.logStore.persist(d.id).catch(() => undefined);
                await this.resetOwner(d.appId, d.previewId);
            }
            const apps = await this.prisma.app.findMany({
                where: { status: 'building', deployments: { none: { status: { in: ['queued', 'building'] }, previewId: null } } },
                select: { id: true },
                take: 200,
            });
            for (const a of apps) {
                await this.resetOwner(a.id, null);
                fixed += 1;
            }
            if (fixed)
                this.logger.warn(`Unstuck ${fixed} interrupted deployment(s) / app(s)`);
            return fixed;
        }
        catch (err) {
            this.logger.warn(`stale deploy sweep failed: ${String(err)}`);
            return 0;
        }
        finally {
            this.running = false;
        }
    }
    async resetOwner(appId, previewId) {
        if (previewId) {
            const pv = await this.prisma.preview.findUnique({ where: { id: previewId }, select: { subdomain: true, status: true } });
            if (!pv || (pv.status !== 'queued' && pv.status !== 'building'))
                return;
            const inflight = await this.prisma.deployment.count({ where: { previewId, status: { in: ['queued', 'building'] } } });
            if (inflight)
                return;
            const up = await this.serving(`upande-preview-${pv.subdomain}`);
            await this.prisma.preview.updateMany({ where: { id: previewId }, data: { status: up ? 'live' : 'failed' } });
            return;
        }
        const app = await this.prisma.app.findUnique({ where: { id: appId }, select: { subdomain: true, status: true } });
        if (!app || app.status !== 'building')
            return;
        const inflight = await this.prisma.deployment.count({
            where: { appId, previewId: null, status: { in: ['queued', 'building'] } },
        });
        if (inflight)
            return;
        const up = await this.serving(`upande-${app.subdomain}`);
        await this.prisma.app.updateMany({ where: { id: appId, status: 'building' }, data: { status: up ? 'live' : 'failed' } });
    }
};
exports.StaleDeploySweeper = StaleDeploySweeper;
exports.StaleDeploySweeper = StaleDeploySweeper = StaleDeploySweeper_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(2, (0, bullmq_1.InjectQueue)(deploy_constants_1.DEPLOY_QUEUE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        log_store_service_1.LogStoreService,
        bullmq_2.Queue])
], StaleDeploySweeper);
//# sourceMappingURL=stale-deploy.sweeper.js.map