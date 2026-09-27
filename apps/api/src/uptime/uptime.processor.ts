import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { UptimeService } from './uptime.service';
import { UPTIME_CHECK_JOB, UPTIME_QUEUE, UPTIME_RETENTION_JOB, uptimeIntervalSec } from './uptime.constants';

// Runs the uptime monitor on BullMQ job schedulers. Schedulers live in Redis
// and are upserted by id, so API restarts (watch mode, several replicas) never
// create a second timer; concurrency 1 keeps one check run at a time.
@Processor(UPTIME_QUEUE, { concurrency: 1 })
export class UptimeProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(UptimeProcessor.name);

  constructor(
    private readonly uptime: UptimeService,
    @InjectQueue(UPTIME_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.UPTIME_MONITOR_ENABLED === 'false') {
      await this.queue.removeJobScheduler(UPTIME_CHECK_JOB).catch(() => undefined);
      this.logger.log('Uptime monitor disabled (UPTIME_MONITOR_ENABLED=false)');
      return;
    }
    const every = uptimeIntervalSec() * 1000;
    const opts = { removeOnComplete: 50, removeOnFail: 50 };
    try {
      await this.queue.upsertJobScheduler(UPTIME_CHECK_JOB, { every }, { name: UPTIME_CHECK_JOB, opts });
      await this.queue.upsertJobScheduler(
        UPTIME_RETENTION_JOB,
        { every: 24 * 3600 * 1000 },
        { name: UPTIME_RETENTION_JOB, opts },
      );
      this.logger.log(`Uptime monitor scheduled every ${every / 1000}s`);
    } catch (err) {
      this.logger.error(`Could not schedule the uptime monitor: ${(err as Error).message}`);
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name === UPTIME_RETENTION_JOB) {
      const deleted = await this.uptime.pruneOld();
      return { deleted };
    }
    // A run that was queued long ago (API was down) is stale — skip it.
    if (Date.now() - job.timestamp > uptimeIntervalSec() * 2000) return { skipped: 'stale' };
    return this.uptime.runChecks();
  }
}
