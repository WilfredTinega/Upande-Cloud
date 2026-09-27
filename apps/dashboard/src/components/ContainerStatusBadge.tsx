import { useEffect, useState } from "react";
import { appsApi } from "../lib/api";
import { Skeleton } from "./Skeleton";
import type { ContainerStatus } from "../types";

const POLL_MS = 10000;

/**
 * Live runtime state of the app's container, shown in the app header: running,
 * crashed / crash-looping (the restart policy restarts it up to its retry
 * limit, then gives up — "crashed"), and how many times Docker has restarted
 * it since the last deploy.
 */
export function ContainerStatusBadge({ appId, reloadKey }: { appId: string; reloadKey?: unknown }) {
  const [status, setStatus] = useState<ContainerStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      appsApi
        .containerStatus(appId)
        .then((s) => !cancelled && setStatus(s))
        .catch(() => {
          // Transient — keep the last known state.
        });
    void load();
    const handle = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [appId, reloadKey]);

  if (status === null) return <Skeleton className="h-5 w-28 rounded-full" />;
  if (!status.exists || status.placeholder) return null;

  const base = "inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium";
  const restarts =
    status.restartCount > 0
      ? ` · ${status.restartCount} restart${status.restartCount === 1 ? "" : "s"}`
      : "";
  const detail = [
    `Container ${status.state}`,
    `Restart policy: ${status.restartPolicy ?? "none"}`,
    `Restarts since last deploy: ${status.restartCount}${status.maxRetries ? ` (max ${status.maxRetries})` : ""}`,
    status.restartsExhausted
      ? "Docker stopped restarting it — fix the error and redeploy (or press Restart)."
      : "",
    status.exitCode ? `Last exit code: ${status.exitCode}` : "",
    status.oomKilled ? "Killed: out of memory" : "",
    status.error ? `Error: ${status.error}` : "",
    status.startedAt ? `Started ${new Date(status.startedAt).toLocaleString()}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  if (status.crashed) {
    return (
      <span
        className={`${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`}
        title={detail}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        {status.restarting
          ? "Crashed · restarting"
          : status.restartsExhausted
            ? `Crashed · gave up after ${status.restartCount} restart${status.restartCount === 1 ? "" : "s"}`
            : `Crashed (exit ${status.exitCode})`}
        {status.restartsExhausted ? "" : restarts}
        {status.oomKilled ? " · OOM" : ""}
      </span>
    );
  }
  if (!status.running) {
    return (
      <span className={`${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`} title={detail}>
        Container {status.state}
      </span>
    );
  }
  return (
    <span
      className={`${base} ${
        status.restartCount > 0
          ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300"
          : "bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
      }`}
      title={detail}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
      Running{restarts}
    </span>
  );
}
