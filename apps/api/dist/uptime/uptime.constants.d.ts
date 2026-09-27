export declare const UPTIME_QUEUE = "uptime";
export declare const UPTIME_CHECK_JOB = "uptime-check";
export declare const UPTIME_RETENTION_JOB = "uptime-retention";
export type UptimeRange = '30m' | '1h' | '24h' | '7d' | '30d';
export declare const UPTIME_RANGES: Record<UptimeRange, {
    spanSec: number;
    bucketSec: number;
}>;
export declare function parseUptimeRange(v: unknown): UptimeRange;
export declare const uptimeIntervalSec: () => number;
export declare const uptimeRetentionDays: () => number;
export declare const uptimeConcurrency: () => number;
export declare const uptimeMaxTimeoutMs: () => number;
