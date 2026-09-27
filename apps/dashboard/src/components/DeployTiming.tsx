import { useEffect, useState } from "react";
import { appsApi } from "../lib/api";
import type { DeploymentHistoryItem } from "../types";
import { formatDuration } from "./DeploymentHistory";
import { Skeleton } from "./Skeleton";

/**
 * How long deploys take: a live elapsed timer while one is running, otherwise
 * the last deploy's duration plus the average of recent successful deploys.
 * `reloadKey` changes whenever a deployment changes state, so it refetches then.
 */
export function DeployTiming({ appId, reloadKey }: { appId: string; reloadKey: string }) {
  const [items, setItems] = useState<DeploymentHistoryItem[] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    appsApi
      .listDeployments(appId, { take: 10 })
      .then((res) => !cancelled && setItems(res.deployments))
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, [appId, reloadKey]);

  const latest = items?.[0];
  const running = latest && (latest.status === "queued" || latest.status === "building");

  // Tick once a second only while a deploy is running.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (items === null) return <Skeleton className="h-4 w-56" />;
  if (!latest) return null;

  if (running) {
    const since = latest.startedAt ?? latest.createdAt;
    return (
      <p className="text-xs text-brand-500 dark:text-brand-400 tabular-nums">
        {latest.status === "queued" ? "Queued" : "Deploying"} for{" "}
        <span className="font-semibold text-brand-700 dark:text-brand-200">
          {formatDuration(now - new Date(since).getTime())}
        </span>
      </p>
    );
  }

  const recent = items.filter((d) => d.status === "live" && d.durationMs !== null).slice(0, 5);
  const avg =
    recent.length > 1
      ? recent.reduce((sum, d) => sum + (d.durationMs ?? 0), 0) / recent.length
      : null;

  return (
    <p className="text-xs text-brand-500 dark:text-brand-400 tabular-nums">
      Last deploy{latest.status === "live" ? "" : ` (${latest.status})`} took{" "}
      <span className="font-semibold text-brand-700 dark:text-brand-200">
        {formatDuration(latest.durationMs)}
      </span>
      {avg !== null && (
        <>
          {" "}· average {formatDuration(avg)} over the last {recent.length} successful
        </>
      )}
    </p>
  );
}
