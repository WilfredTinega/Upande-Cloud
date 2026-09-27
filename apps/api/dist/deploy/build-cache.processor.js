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
var BuildCacheProcessor_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildCacheProcessor = exports.BUILD_CACHE_PRUNE_JOB = exports.BUILD_CACHE_QUEUE = void 0;
const common_1 = require("@nestjs/common");
const bullmq_1 = require("@nestjs/bullmq");
const bullmq_2 = require("bullmq");
const build_cache_service_1 = require("./build-cache.service");
const build_cache_util_1 = require("./build-cache.util");
exports.BUILD_CACHE_QUEUE = 'build-cache';
exports.BUILD_CACHE_PRUNE_JOB = 'build-cache-prune';
let BuildCacheProcessor = BuildCacheProcessor_1 = class BuildCacheProcessor extends bullmq_1.WorkerHost {
    constructor(cache, queue) {
        super();
        this.cache = cache;
        this.queue = queue;
        this.logger = new common_1.Logger(BuildCacheProcessor_1.name);
    }
    async onApplicationBootstrap() {
        try {
            if (!(0, build_cache_util_1.buildCacheEnabled)()) {
                await this.queue.removeJobScheduler(exports.BUILD_CACHE_PRUNE_JOB).catch(() => undefined);
                return;
            }
            const every = (0, build_cache_util_1.buildCachePruneIntervalMin)() * 60_000;
            await this.queue.upsertJobScheduler(exports.BUILD_CACHE_PRUNE_JOB, { every }, { name: exports.BUILD_CACHE_PRUNE_JOB, opts: { removeOnComplete: 20, removeOnFail: 20 } });
        }
        catch (err) {
            this.logger.error(`Could not schedule build cache pruning: ${err.message}`);
        }
    }
    async process() {
        return this.cache.enforceLimits();
    }
};
exports.BuildCacheProcessor = BuildCacheProcessor;
exports.BuildCacheProcessor = BuildCacheProcessor = BuildCacheProcessor_1 = __decorate([
    (0, bullmq_1.Processor)(exports.BUILD_CACHE_QUEUE, { concurrency: 1 }),
    __param(1, (0, bullmq_1.InjectQueue)(exports.BUILD_CACHE_QUEUE)),
    __metadata("design:paramtypes", [build_cache_service_1.BuildCacheService,
        bullmq_2.Queue])
], BuildCacheProcessor);
//# sourceMappingURL=build-cache.processor.js.map