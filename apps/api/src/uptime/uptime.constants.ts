export const UPTIME_QUEUE = 'uptime';
export const UPTIME_CHECK_JOB = 'uptime-check';
export const UPTIME_RETENTION_JOB = 'uptime-retention';

export type UptimeRange = '30m' | '1h' | '24h' | '7d' | '30d';

// Range → total span and bucket size (seconds).
export const UPTIME_RANGES: Record<UptimeRange, { spanSec: number; bucketSec: number }> = {
  // Short ranges use 1-minute buckets (one per check at the default interval).
  '30m': { spanSec: 30 * 60, bucketSec: 60 },
  '1h': { spanSec: 3600, bucketSec: 60 },
  '24h': { spanSec: 24 * 3600, bucketSec: 15 * 60 },
  '7d': { spanSec: 7 * 24 * 3600, bucketSec: 3600 },
  '30d': { spanSec: 30 * 24 * 3600, bucketSec: 24 * 3600 },
};

// Unknown or missing ranges fall back to the default, the last 30 minutes.
export function parseUptimeRange(v: unknown): UptimeRange {
  return v === '1h' || v === '24h' || v === '7d' || v === '30d' ? v : '30m';
}

function envInt(name: string, def: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? Math.min(Math.floor(n), max) : def;
}

export const uptimeIntervalSec = () => envInt('UPTIME_CHECK_INTERVAL_SECONDS', 60, 10, 3600);
export const uptimeRetentionDays = () => envInt('UPTIME_RETENTION_DAYS', 30, 1, 3650);
export const uptimeConcurrency = () => envInt('UPTIME_CHECK_CONCURRENCY', 5, 1, 50);
// Upper bound on a single probe, whatever the app's health-check timeout is.
export const uptimeMaxTimeoutMs = () => envInt('UPTIME_CHECK_TIMEOUT_SECONDS', 5, 1, 60) * 1000;
