import { FormEvent, useEffect, useState } from "react";
import { appsApi } from "../lib/api";
import { useToast } from "../context/ToastContext";
import type { App } from "../types";

const INPUT =
  "px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm font-mono placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";
const LABEL = "text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider";

/**
 * Per-app deploy health check. After every deploy the new container is started
 * next to the current one (not yet routed) and probed over the Docker network;
 * only a healthy build replaces the running version. Static sites are checked
 * by their web server answering, so they only expose timeout/attempts.
 */
export function HealthCheckSection({ app, onSaved }: { app: App; onSaved: () => void }) {
  const toast = useToast();
  const isStatic = app.type === "static";
  const [path, setPath] = useState(app.healthCheckPath ?? "");
  const [timeout, setTimeoutSec] = useState(String(app.healthCheckTimeout ?? 5));
  const [retries, setRetries] = useState(String(app.healthCheckRetries ?? 10));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPath(app.healthCheckPath ?? "");
    setTimeoutSec(String(app.healthCheckTimeout ?? 5));
    setRetries(String(app.healthCheckRetries ?? 10));
  }, [app.healthCheckPath, app.healthCheckTimeout, app.healthCheckRetries]);

  const dirty =
    (app.healthCheckPath ?? "") !== path.trim() ||
    String(app.healthCheckTimeout ?? 5) !== timeout ||
    String(app.healthCheckRetries ?? 10) !== retries;

  async function save(e: FormEvent) {
    e.preventDefault();
    const t = Number(timeout);
    const r = Number(retries);
    const p = path.trim();
    if (p && !p.startsWith("/")) {
      toast.error('The health-check path must start with "/".');
      return;
    }
    if (!Number.isInteger(t) || t < 1 || t > 60 || !Number.isInteger(r) || r < 1 || r > 60) {
      toast.error("Timeout and attempts must be whole numbers between 1 and 60.");
      return;
    }
    setSaving(true);
    try {
      await appsApi.update(app.id, {
        ...(isStatic ? {} : { healthCheckPath: p || null }),
        healthCheckTimeout: t,
        healthCheckRetries: r,
      });
      toast.success("Health check saved — it applies from the next deploy.");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save health check");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50 mb-3">Health check</h2>
      <form
        onSubmit={save}
        className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-5 grid gap-4 sm:grid-cols-3"
      >
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <label htmlFor="hc-path" className={LABEL}>
            Path
          </label>
          {isStatic ? (
            <p className="text-sm text-brand-600 dark:text-brand-300">
              Static sites are checked by their web server answering on <code>/</code>.
            </p>
          ) : (
            <input
              id="hc-path"
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/healthz"
              className={INPUT}
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hc-timeout" className={LABEL}>
            Timeout (s)
          </label>
          <input
            id="hc-timeout"
            type="number"
            min={1}
            max={60}
            value={timeout}
            onChange={(e) => setTimeoutSec(e.target.value)}
            className={INPUT}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="hc-retries" className={LABEL}>
            Attempts
          </label>
          <input
            id="hc-retries"
            type="number"
            min={1}
            max={60}
            value={retries}
            onChange={(e) => setRetries(e.target.value)}
            className={INPUT}
          />
        </div>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </section>
  );
}
