import { useEffect, useState } from "react";
import { adminApi } from "../lib/api";
import type { AdminDeployment } from "../types";
import { Drawer } from "./Drawer";
import { DeployLogView } from "./DeployLog";
import { Skeleton, SkeletonLines } from "./Skeleton";

function statusClass(status: AdminDeployment["status"]): string {
  switch (status) {
    case "live":
      return "text-green-700 dark:text-green-400";
    case "failed":
      return "text-red-600 dark:text-red-400";
    case "building":
      return "text-yellow-700 dark:text-yellow-400";
    default:
      return "text-brand-500 dark:text-brand-400";
  }
}

function duration(ms: number | null): string {
  if (ms === null) return "";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function trigger(d: AdminDeployment): string {
  const who = d.triggeredBy ? ` by ${d.triggeredBy}` : "";
  switch (d.trigger) {
    case "user":
      return `${d.forceClean ? "migrate" : "deploy"}${who}`;
    case "webhook":
      return d.triggerDetail ?? "GitHub push";
    case "rollback":
      return `rollback${who}`;
    case "promote":
      return `promoted ${d.triggerDetail ?? "preview"}${who}`;
    case "api_token":
      return d.triggerDetail ?? "API token";
    case "admin":
      return `admin${who}${d.triggerDetail ? ` · ${d.triggerDetail}` : ""}`;
    default:
      return "unknown trigger";
  }
}

/**
 * Deploy history section of the admin app detail pane: every deployment of the
 * selected app with status, commit, trigger and duration; click one to read
 * its full (persisted) build log in a drawer.
 */
export function AppDeployHistory({ appId }: { appId: string }) {
  const [items, setItems] = useState<AdminDeployment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AdminDeployment | null>(null);
  const [lines, setLines] = useState<string[] | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    setItems(null);
    setError(null);
    adminApi
      .getAppDeployments(appId)
      .then((r) => setItems(r.deployments))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [appId]);

  useEffect(() => {
    if (!open) return;
    setLines(null);
    adminApi
      .getDeploymentLog(open.id)
      .then((r) => setLines(r.lines))
      .catch(() => setLines([]));
  }, [open]);

  return (
    <div className="px-5 pb-5">
      <h3 className="text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500 mb-2">
        Deploy history
      </h3>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {!items && !error && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}
      {items && items.length === 0 && (
        <p className="text-xs text-brand-400 dark:text-brand-500">No deployments yet.</p>
      )}
      {items && items.length > 0 && (
        <ul className="flex flex-col divide-y divide-brand-100 dark:divide-brand-800">
          {items.map((d) => (
            <li key={d.id}>
              <button
                onClick={() => setOpen(d)}
                title={d.errorReason ?? "View build log"}
                className="w-full text-left py-2 px-1 -mx-1 rounded hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className={`font-semibold ${statusClass(d.status)}`}>{d.status}</span>
                  <span className="font-mono text-brand-600 dark:text-brand-300">
                    {d.commitSha ? d.commitSha.slice(0, 7) : d.ref ?? "—"}
                  </span>
                  <span className="ml-auto tabular-nums text-brand-400 dark:text-brand-500">
                    {duration(d.durationMs)}
                  </span>
                </div>
                <div className="text-xs text-brand-500 dark:text-brand-400 truncate">
                  {trigger(d)} · {new Date(d.startedAt ?? d.createdAt).toLocaleString()}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Drawer
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `Deployment ${open.id.slice(0, 8)}` : ""}
        subtitle={open ? `${open.status} · ${open.ref ?? ""} · ${trigger(open)}` : undefined}
      >
        {open?.errorReason && (
          <p className="mb-3 text-xs text-red-700 dark:text-red-300 whitespace-pre-wrap break-words">
            {open.errorReason}
          </p>
        )}
        <button
          onClick={() => setShowDebug((v) => !v)}
          className="mb-3 text-xs px-3 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-700 transition-colors"
        >
          {showDebug ? "Hide debug" : "Show debug"}
        </button>
        {lines === null ? (
          <div className="rounded-lg bg-brand-950 border border-brand-800 p-4">
            <SkeletonLines lines={8} className="[&>div]:h-3 [&>div]:bg-brand-800" />
          </div>
        ) : (
          <DeployLogView lines={lines} showDebug={showDebug} />
        )}
      </Drawer>
    </div>
  );
}
