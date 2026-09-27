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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeployService = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const deploy_constants_1 = require("./deploy.constants");
let DeployService = class DeployService {
    constructor(deployQueue) {
        this.deployQueue = deployQueue;
    }
    async enqueue(data) {
        const job = await this.deployQueue.add(deploy_constants_1.DEPLOY_JOB, data, {
            attempts: Number(process.env.DEPLOY_MAX_ATTEMPTS ?? 3),
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        });
        return job;
    }
    async getQueueDepth() {
        const [waiting, active] = await Promise.all([
            this.deployQueue.getWaitingCount(),
            this.deployQueue.getActiveCount(),
        ]);
        return waiting + active;
    }
    async cancelForApp(appId) {
        const jobs = await this.deployQueue.getJobs([
            'waiting',
            'delayed',
            'active',
            'failed',
        ]);
        let removed = 0;
        for (const job of jobs) {
            if (job.data?.appId !== appId)
                continue;
            if (job.data?.previewId)
                continue;
            try {
                await job.remove();
                removed += 1;
            }
            catch {
            }
        }
        return removed;
    }
    async cancelForPreview(previewId) {
        const jobs = await this.deployQueue.getJobs(['waiting', 'delayed', 'active', 'failed']);
        let removed = 0;
        for (const job of jobs) {
            if (job.data?.previewId !== previewId)
                continue;
            try {
                await job.remove();
                removed += 1;
            }
            catch {
            }
        }
        return removed;
    }
};
exports.DeployService = DeployService;
exports.DeployService = DeployService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, bullmq_1.InjectQueue)(deploy_constants_1.DEPLOY_QUEUE)),
    __metadata("design:paramtypes", [bullmq_2.Queue])
], DeployService);
//# sourceMappingURL=deploy.service.js.map