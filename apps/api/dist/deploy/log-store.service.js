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
exports.LogStoreService = void 0;
const common_1 = require("@nestjs/common");
const inject_redis_decorator_1 = require("../common/inject-redis.decorator");
const ioredis_1 = require("ioredis");
const prisma_service_1 = require("../prisma/prisma.service");
const LOG_KEY_PREFIX = 'deploy:logs:';
const LOG_TTL_SECONDS = 3600;
const LOG_PERSIST_MAX_BYTES = () => Number(process.env.DEPLOY_LOG_MAX_BYTES ?? 2 * 1024 * 1024);
let LogStoreService = class LogStoreService {
    constructor(redis, prisma) {
        this.redis = redis;
        this.prisma = prisma;
    }
    async append(deploymentId, line) {
        const key = `${LOG_KEY_PREFIX}${deploymentId}`;
        const stamped = `@ts:${Date.now()}\x1f${line}`;
        await this.redis.rpush(key, stamped);
        await this.redis.expire(key, LOG_TTL_SECONDS);
    }
    async getAll(deploymentId) {
        const key = `${LOG_KEY_PREFIX}${deploymentId}`;
        const live = await this.redis.lrange(key, 0, -1);
        if (live.length > 0)
            return live;
        const stored = await this.prisma.deploymentLog.findUnique({
            where: { deploymentId },
            select: { content: true },
        });
        return stored?.content ? stored.content.split('\n') : [];
    }
    async persist(deploymentId) {
        try {
            const key = `${LOG_KEY_PREFIX}${deploymentId}`;
            const lines = await this.redis.lrange(key, 0, -1);
            if (lines.length === 0)
                return;
            let kept = lines.map((l) => l.replace(/\n/g, ' '));
            let content = kept.join('\n');
            let truncated = false;
            const max = LOG_PERSIST_MAX_BYTES();
            if (Buffer.byteLength(content, 'utf8') > max) {
                truncated = true;
                let size = 0;
                const tail = [];
                for (let i = kept.length - 1; i >= 0; i--) {
                    size += Buffer.byteLength(kept[i], 'utf8') + 1;
                    if (size > max)
                        break;
                    tail.unshift(kept[i]);
                }
                kept = [
                    `@ts:${Date.now()}\x1f@info [log truncated — only the last ${tail.length} of ${lines.length} lines were kept]`,
                    ...tail,
                ];
                content = kept.join('\n');
            }
            await this.prisma.deploymentLog.upsert({
                where: { deploymentId },
                create: { deploymentId, content, lineCount: kept.length, truncated },
                update: { content, lineCount: kept.length, truncated },
            });
        }
        catch (err) {
            console.warn(`[deploy:${deploymentId}] persisting build log failed:`, err instanceof Error ? err.message : err);
        }
    }
    async getFrom(deploymentId, start) {
        const key = `${LOG_KEY_PREFIX}${deploymentId}`;
        return this.redis.lrange(key, start, -1);
    }
};
exports.LogStoreService = LogStoreService;
exports.LogStoreService = LogStoreService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, inject_redis_decorator_1.InjectRedis)()),
    __metadata("design:paramtypes", [ioredis_1.default,
        prisma_service_1.PrismaService])
], LogStoreService);
//# sourceMappingURL=log-store.service.js.map