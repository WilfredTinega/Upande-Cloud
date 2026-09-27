import { OnApplicationBootstrap } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BuildCacheService } from './build-cache.service';
export declare const BUILD_CACHE_QUEUE = "build-cache";
export declare const BUILD_CACHE_PRUNE_JOB = "build-cache-prune";
export declare class BuildCacheProcessor extends WorkerHost implements OnApplicationBootstrap {
    private readonly cache;
    private readonly queue;
    private readonly logger;
    constructor(cache: BuildCacheService, queue: Queue);
    onApplicationBootstrap(): Promise<void>;
    process(): Promise<unknown>;
}
