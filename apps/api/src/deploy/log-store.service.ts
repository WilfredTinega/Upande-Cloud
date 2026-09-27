import { Injectable } from '@nestjs/common';
import { InjectRedis } from '../common/inject-redis.decorator';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

const LOG_KEY_PREFIX = 'deploy:logs:';
const LOG_TTL_SECONDS = 3600; // 1 hour
// Cap on a persisted (Postgres) build log. Only the tail is kept beyond this —
// the end of a log (the failure) is the part worth keeping.
const LOG_PERSIST_MAX_BYTES = () =>
  Number(process.env.DEPLOY_LOG_MAX_BYTES ?? 2 * 1024 * 1024);

@Injectable()
export class LogStoreService {
  constructor(
    @InjectRedis() private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  async append(deploymentId: string, line: string): Promise<void> {
    const key = `${LOG_KEY_PREFIX}${deploymentId}`;
    // Stamp every line with the wall-clock time it was emitted, as a parseable
    // prefix `@ts:<epochMillis>\x1f<line>`. The dashboard splits on \x1f to show
    // a timestamp gutter; older/plain readers can ignore it. \x1f (unit
    // separator) is used so it never collides with real log content.
    const stamped = `@ts:${Date.now()}\x1f${line}`;
    await this.redis.rpush(key, stamped);
    await this.redis.expire(key, LOG_TTL_SECONDS);
  }

  // Full log for a deployment: the live Redis copy while it exists (it is the
  // most complete while a build runs), else the copy persisted to Postgres when
  // the deployment finished — so old deployments' logs stay viewable.
  async getAll(deploymentId: string): Promise<string[]> {
    const key = `${LOG_KEY_PREFIX}${deploymentId}`;
    const live = await this.redis.lrange(key, 0, -1);
    if (live.length > 0) return live;
    const stored = await this.prisma.deploymentLog.findUnique({
      where: { deploymentId },
      select: { content: true },
    });
    return stored?.content ? stored.content.split('\n') : [];
  }

  // Copy the deployment's Redis log into Postgres (idempotent upsert). Called
  // when a deployment reaches a terminal state (live / failed / cancelled).
  // Best-effort: a persistence failure must never fail the deploy itself.
  async persist(deploymentId: string): Promise<void> {
    try {
      const key = `${LOG_KEY_PREFIX}${deploymentId}`;
      const lines = await this.redis.lrange(key, 0, -1);
      if (lines.length === 0) return;
      // Log lines never contain raw newlines (producers split on them), so a
      // newline join round-trips.
      let kept = lines.map((l) => l.replace(/\n/g, ' '));
      let content = kept.join('\n');
      let truncated = false;
      const max = LOG_PERSIST_MAX_BYTES();
      if (Buffer.byteLength(content, 'utf8') > max) {
        truncated = true;
        let size = 0;
        const tail: string[] = [];
        for (let i = kept.length - 1; i >= 0; i--) {
          size += Buffer.byteLength(kept[i], 'utf8') + 1;
          if (size > max) break;
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
    } catch (err) {
      console.warn(
        `[deploy:${deploymentId}] persisting build log failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Return log lines from `start` (0-based) to the end. Used by the SSE streamer
  // to fetch only lines it hasn't sent yet (cursor-based tailing).
  async getFrom(deploymentId: string, start: number): Promise<string[]> {
    const key = `${LOG_KEY_PREFIX}${deploymentId}`;
    return this.redis.lrange(key, start, -1);
  }
}
