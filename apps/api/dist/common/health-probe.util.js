"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthConfigFor = healthConfigFor;
exports.probeHttp = probeHttp;
function healthConfigFor(app) {
    const custom = app.type !== 'static' && !!app.healthCheckPath;
    const interval = Number(process.env.HEALTH_CHECK_INTERVAL_MS ?? 3000);
    return {
        path: custom ? app.healthCheckPath : '/',
        strict: custom,
        timeoutMs: Math.min(Math.max(app.healthCheckTimeout || 5, 1), 60) * 1000,
        retries: Math.min(Math.max(app.healthCheckRetries || 10, 1), 60),
        intervalMs: Number.isFinite(interval) && interval >= 250 ? interval : 3000,
    };
}
async function probeHttp(url, health) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), health.timeoutMs);
    const started = Date.now();
    try {
        const res = await fetch(url, { redirect: 'manual', signal: controller.signal });
        const latencyMs = Date.now() - started;
        await res.arrayBuffer().catch(() => undefined);
        const good = health.strict ? res.status >= 200 && res.status < 400 : res.status < 500;
        return good
            ? { ok: true, status: res.status, latencyMs }
            : { ok: false, status: res.status, latencyMs, reason: `returned HTTP ${res.status}` };
    }
    catch (err) {
        const aborted = err instanceof Error && err.name === 'AbortError';
        return {
            ok: false,
            status: null,
            latencyMs: null,
            reason: aborted
                ? `timed out after ${health.timeoutMs / 1000}s`
                : 'connection refused (nothing listening yet)',
        };
    }
    finally {
        clearTimeout(timer);
    }
}
//# sourceMappingURL=health-probe.util.js.map