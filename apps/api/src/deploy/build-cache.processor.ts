import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BuildCacheService } from './build-cache.service';
import { buildCacheEnabled, buildCachePruneIntervalMin } from './build-cache.util';

export const BUILD_CACHE_QUEUE = 'build-cache';
export const BUILD_CACHE_PRUNE_JOB = 'build-cache-prune';

// Bounded build cache: a BullMQ job scheduler (upserted by id, so restarts and
// replicas never duplicate it) runs the age / size-cap prune periodically.
@Processor(BUILD_CACHE_QUEUE, { concurrency: 1 })
export class BuildCacheProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(BuildCacheProcessor.name);

  constructor(
    private readonly cache: BuildCacheService,
    @InjectQueue(BUILD_CACHE_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      if (!buildCacheEnabled()) {
        await this.queue.removeJobScheduler(BUILD_CACHE_PRUNE_JOB).catch(() => undefined);
        return;
      }
      const every = buildCachePruneIntervalMin() * 60_000;
      await this.queue.upsertJobScheduler(
        BUILD_CACHE_PRUNE_JOB,
        { every },
        { name: BUILD_CACHE_PRUNE_JOB, opts: { removeOnComplete: 20, removeOnFail: 20 } },
      );
    } catch (err) {
      this.logger.error(`Could not schedule build cache pruning: ${(err as Error).message}`);
    }
  }

  async process(): Promise<unknown> {
    return this.cache.enforceLimits();
  }
}
