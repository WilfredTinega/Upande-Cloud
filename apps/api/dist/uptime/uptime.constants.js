"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uptimeMaxTimeoutMs = exports.uptimeConcurrency = exports.uptimeRetentionDays = exports.uptimeIntervalSec = exports.UPTIME_RANGES = exports.UPTIME_RETENTION_JOB = exports.UPTIME_CHECK_JOB = exports.UPTIME_QUEUE = void 0;
exports.parseUptimeRange = parseUptimeRange;
exports.UPTIME_QUEUE = 'uptime';
exports.UPTIME_CHECK_JOB = 'uptime-check';
exports.UPTIME_RETENTION_JOB = 'uptime-retention';
exports.UPTIME_RANGES = {
    '30m': { spanSec: 30 * 60, bucketSec: 60 },
    '1h': { spanSec: 3600, bucketSec: 60 },
    '24h': { spanSec: 24 * 3600, bucketSec: 15 * 60 },
    '7d': { spanSec: 7 * 24 * 3600, bucketSec: 3600 },
    '30d': { spanSec: 30 * 24 * 3600, bucketSec: 24 * 3600 },
};
function parseUptimeRange(v) {
    return v === '1h' || v === '24h' || v === '7d' || v === '30d' ? v : '30m';
}
function envInt(name, def, min, max) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n >= min ? Math.min(Math.floor(n), max) : def;
}
const uptimeIntervalSec = () => envInt('UPTIME_CHECK_INTERVAL_SECONDS', 60, 10, 3600);
exports.uptimeIntervalSec = uptimeIntervalSec;
const uptimeRetentionDays = () => envInt('UPTIME_RETENTION_DAYS', 30, 1, 3650);
exports.uptimeRetentionDays = uptimeRetentionDays;
const uptimeConcurrency = () => envInt('UPTIME_CHECK_CONCURRENCY', 5, 1, 50);
exports.uptimeConcurrency = uptimeConcurrency;
const uptimeMaxTimeoutMs = () => envInt('UPTIME_CHECK_TIMEOUT_SECONDS', 5, 1, 60) * 1000;
exports.uptimeMaxTimeoutMs = uptimeMaxTimeoutMs;
//# sourceMappingURL=uptime.constants.js.map