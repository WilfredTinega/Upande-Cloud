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
var UptimeProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UptimeProcessor = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const uptime_service_1 = require("./uptime.service");
const uptime_constants_1 = require("./uptime.constants");
let UptimeProcessor = UptimeProcessor_1 = class UptimeProcessor extends bullmq_1.WorkerHost {
    constructor(uptime, queue) {
        super();
        this.uptime = uptime;
        this.queue = queue;
        this.logger = new common_1.Logger(UptimeProcessor_1.name);
    }
    async onApplicationBootstrap() {
        if (process.env.UPTIME_MONITOR_ENABLED === 'false') {
            await this.queue.removeJobScheduler(uptime_constants_1.UPTIME_CHECK_JOB).catch(() => undefined);
            this.logger.log('Uptime monitor disabled (UPTIME_MONITOR_ENABLED=false)');
            return;
        }
        const every = (0, uptime_constants_1.uptimeIntervalSec)() * 1000;
        const opts = { removeOnComplete: 50, removeOnFail: 50 };
        try {
            await this.queue.upsertJobScheduler(uptime_constants_1.UPTIME_CHECK_JOB, { every }, { name: uptime_constants_1.UPTIME_CHECK_JOB, opts });
            await this.queue.upsertJobScheduler(uptime_constants_1.UPTIME_RETENTION_JOB, { every: 24 * 3600 * 1000 }, { name: uptime_constants_1.UPTIME_RETENTION_JOB, opts });
            this.logger.log(`Uptime monitor scheduled every ${every / 1000}s`);
        }
        catch (err) {
            this.logger.error(`Could not schedule the uptime monitor: ${err.message}`);
        }
    }
    async process(job) {
        if (job.name === uptime_constants_1.UPTIME_RETENTION_JOB) {
            const deleted = await this.uptime.pruneOld();
            return { deleted };
        }
        if (Date.now() - job.timestamp > (0, uptime_constants_1.uptimeIntervalSec)() * 2000)
            return { skipped: 'stale' };
        return this.uptime.runChecks();
    }
};
exports.UptimeProcessor = UptimeProcessor;
exports.UptimeProcessor = UptimeProcessor = UptimeProcessor_1 = __decorate([
    (0, bullmq_1.Processor)(uptime_constants_1.UPTIME_QUEUE, { concurrency: 1 }),
    __param(1, (0, bullmq_1.InjectQueue)(uptime_constants_1.UPTIME_QUEUE)),
    __metadata("design:paramtypes", [uptime_service_1.UptimeService,
        bullmq_2.Queue])
], UptimeProcessor);
//# sourceMappingURL=uptime.processor.js.map