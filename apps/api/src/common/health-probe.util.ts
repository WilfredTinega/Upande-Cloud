// Shared HTTP health probing, used by the deploy health check
// (deploy.processor.ts) and the uptime monitor (uptime/uptime.service.ts).
// Probes go to the container's IP inside the Docker network, never through
// Traefik, so they measure the app itself.

export interface HealthConfig {
  // Path probed, e.g. "/" or "/healthz".
  path: string;
  // true: must answer 2xx/3xx; false: any non-5xx response = web server is up.
  strict: boolean;
  timeoutMs: number;
  retries: number;
  intervalMs: number;
}

// Resolve an app's health-check settings. Static sites (and apps without a
// configured path) only need the web server to answer; a configured path
// must return 2xx/3xx.
export function healthConfigFor(app: {
  type: string;
  healthCheckPath: string | null;
  healthCheckTimeout: number;
  healthCheckRetries: number;
}): HealthConfig {
  const custom = app.type !== 'static' && !!app.healthCheckPath;
  const interval = Number(process.env.HEALTH_CHECK_INTERVAL_MS ?? 3000);
  return {
    path: custom ? app.healthCheckPath! : '/',
    strict: custom,
    timeoutMs: Math.min(Math.max(app.healthCheckTimeout || 5, 1), 60) * 1000,
    retries: Math.min(Math.max(app.healthCheckRetries || 10, 1), 60),
    intervalMs: Number.isFinite(interval) && interval >= 250 ? interval : 3000,
  };
}

export type ProbeResult =
  | { ok: true; status: number; latencyMs: number }
  | { ok: false; status: number | null; latencyMs: number | null; reason: string };

// One GET against the URL. Never throws.
export async function probeHttp(url: string, health: Pick<HealthConfig, 'strict' | 'timeoutMs'>): Promise<ProbeResult> {
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
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      ok: false,
      status: null,
      latencyMs: null,
      reason: aborted
        ? `timed out after ${health.timeoutMs / 1000}s`
        : 'connection refused (nothing listening yet)',
    };
  } finally {
    clearTimeout(timer);
  }
}
