import { useCallback, useEffect, useState } from "react";
import { appsApi } from "../lib/api";
import { SkeletonTable } from "./Skeleton";
import { DeploymentLogModal } from "./DeploymentLogModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { useToast } from "../context/ToastContext";
import type { DeploymentHistoryItem, DeploymentStatus } from "../types";

// ---- Formatting helpers ----

export function deployStatusBadge(status: DeploymentStatus) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  switch (status) {
    case "queued":
      return `${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`;
    case "building":
      return `${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300`;
    case "live":
      return `${base} bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300`;
    case "failed":
      return `${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`;
  }
}

export function formatDuration(ms: number | null): string {
  if (ms === null || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// "Who/what triggered it" in words.
export function triggerLabel(d: DeploymentHistoryItem): string {
  const who = d.triggeredBy?.username ?? d.triggeredBy?.email;
  switch (d.trigger) {
    case "user":
      return `${d.triggerDetail === "clear-cache" ? "Clear cache & deploy" : d.forceClean ? "Migrate" : "Deploy"}${who ? ` by ${who}` : ""}`;
    case "webhook":
      return d.triggerDetail ? `GitHub ${d.triggerDetail}` : "GitHub push";
    case "rollback":
      return `Rollback${who ? ` by ${who}` : ""}`;
    case "promote":
      return `Promoted ${d.triggerDetail ?? "preview"}${who ? ` by ${who}` : ""}`;
    case "api_token":
      return `API ${d.triggerDetail ?? "token"}`;
    case "admin":
      return `Admin${who ? ` (${who})` : ""}${d.triggerDetail ? ` · ${d.triggerDetail}` : ""}`;
    default:
      return "—";
  }
}

const TH =
  "text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider whitespace-nowrap";

const PAGE = 20;

/**
 * Deploy history for an app: every deployment with status, commit, branch,
 * trigger, start time and duration, plus its full build log on demand.
 * `reloadKey` bumps (new deploy started / finished) trigger a refresh; while
 * any deployment is still queued/building the list polls.
 */
export function DeploymentHistory({
  appId,
  reloadKey,
  busy = false,
  onDeployStarted,
}: {
  appId: string;
  reloadKey: string | number;
  // A deploy is in progress: rollback is unavailable until it finishes.
  busy?: boolean;
  // Called after a rollback was queued (parent refreshes + streams the log).
  onDeployStarted?: () => void;
}) {
  const toast = useToast();
  const [rollbackTarget, setRollbackTarget] = useState<DeploymentHistoryItem | null>(null);
  const [rollingBack, setRollingBack] = useState(false);

  async function confirmRollback() {
    if (!rollbackTarget) return;
    setRollingBack(true);
    try {
      const res = await appsApi.rollback(appId, rollbackTarget.id);
      toast.success(
        res.reuseImage
          ? "Rollback started — reusing the kept image, no rebuild needed."
          : "Rollback started — rebuilding that exact commit.",
      );
      setRollbackTarget(null);
      onDeployStarted?.();
      void refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rollback failed");
    } finally {
      setRollingBack(false);
    }
  }

  const [items, setItems] = useState<DeploymentHistoryItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [logFor, setLogFor] = useState<DeploymentHistoryItem | null>(null);

  // (Re)load the first page. Older pages loaded via "Load more" are dropped on
  // refresh so the list never shows stale rows.
  const refresh = useCallback(() => {
    return appsApi
      .listDeployments(appId, { take: PAGE })
      .then((res) => {
        setItems(res.deployments);
        setNextCursor(res.nextCursor);
        setError(null);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load deployments"),
      );
  }, [appId]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadKey]);

  const inFlight = items?.some((d) => d.status === "queued" || d.status === "building") ?? false;
  useEffect(() => {
    if (!inFlight) return;
    const handle = setInterval(() => void refresh(), 5000);
    return () => clearInterval(handle);
  }, [inFlight, refresh]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await appsApi.listDeployments(appId, { take: PAGE, before: nextCursor });
      setItems((prev) => [...(prev ?? []), ...res.deployments]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load deployments");
    } finally {
      setLoadingMore(false);
    }
  }

  if (items === null && !error) {
    return (
      <SkeletonTable
        columns={["Status", "Commit", "Branch", "Triggered by", "Started", "Duration", ""]}
        rows={4}
      />
    );
  }

  if (error && !items) {
    return <p className="text-sm text-red-500 dark:text-red-400">{error}</p>;
  }

  if (!items || items.length === 0) {
    return <p className="text-sm text-brand-400 dark:text-brand-500">No deployments yet.</p>;
  }


  return (
    <>
      <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-x-auto scrollbar-hide">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-brand-200 dark:border-brand-700">
              <th className={TH}>Status</th>
              <th className={TH}>Commit</th>
              <th className={TH}>Branch</th>
              <th className={TH}>Triggered by</th>
              <th className={TH}>Started</th>
              <th className={TH}>Duration</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody>
            {items.map((d, idx) => {
              const started = d.startedAt ?? d.createdAt;
              return (
                <tr
                  key={d.id}
                  className={idx < items.length - 1 ? "border-b border-brand-100 dark:border-brand-800" : ""}
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className={deployStatusBadge(d.status)}>{d.status}</span>
                    {d.isCurrent && (
                      <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wider text-green-700 dark:text-green-400">
                        current
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 max-w-[16rem]">
                    {d.commitSha ? (
                      <div className="flex flex-col min-w-0">
                        <span className="font-mono text-xs text-brand-700 dark:text-brand-300">
                          {d.commitSha.slice(0, 7)}
                        </span>
                        {d.commitMessage && (
                          <span
                            className="text-xs text-brand-500 dark:text-brand-400 truncate"
                            title={d.commitMessage}
                          >
                            {d.commitMessage.split("\n")[0]}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-brand-400 dark:text-brand-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-brand-600 dark:text-brand-400 whitespace-nowrap">
                    {d.branch ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-brand-600 dark:text-brand-400 whitespace-nowrap">
                    {triggerLabel(d)}
                    {d.rollbackOf && (
                      <span className="block text-[11px] text-brand-400 dark:text-brand-500">
                        of {d.rollbackOf.commitSha ? d.rollbackOf.commitSha.slice(0, 7) : d.rollbackOf.id.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td
                    className="px-4 py-3 text-xs text-brand-500 dark:text-brand-400 whitespace-nowrap"
                    title={`Started ${new Date(started).toLocaleString()}${
                      d.finishedAt ? `\nFinished ${new Date(d.finishedAt).toLocaleString()}` : ""
                    }`}
                  >
                    {relativeTime(started)}
                  </td>
                  <td className="px-4 py-3 text-xs text-brand-500 dark:text-brand-400 tabular-nums whitespace-nowrap">
                    {d.status === "queued" || d.status === "building" ? "…" : formatDuration(d.durationMs)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {d.canRollback && !d.isCurrent && (
                      <button
                        onClick={() => setRollbackTarget(d)}
                        disabled={busy}
                        title={
                          busy
                            ? "A deployment is in progress"
                            : d.imageAvailable
                              ? "Redeploy this version (instant — its image is still kept)"
                              : "Redeploy this version (rebuilds this exact commit)"
                        }
                        className="mr-2 px-2.5 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-200 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        Redeploy
                      </button>
                    )}
                    <button
                      onClick={() => setLogFor(d)}
                      title={d.errorReason ?? "View the full build log"}
                      className="px-2.5 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
                    >
                      Log
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-2 text-xs text-red-500 dark:text-red-400">{error}</p>}
      {nextCursor && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
          >
            {loadingMore ? "Loading…" : "Load older deployments"}
          </button>
        </div>
      )}
      {logFor && (
        <DeploymentLogModal appId={appId} deployment={logFor} onClose={() => setLogFor(null)} />
      )}
      {rollbackTarget && (
        <ConfirmDialog
          title="Redeploy this version?"
          message={[
            `Roll back to ${
              rollbackTarget.commitSha
                ? `commit ${rollbackTarget.commitSha.slice(0, 7)}${
                    rollbackTarget.commitMessage ? ` (${rollbackTarget.commitMessage.split("\n")[0]})` : ""
                  }`
                : `deployment ${rollbackTarget.id.slice(0, 8)}`
            } from ${new Date(rollbackTarget.createdAt).toLocaleString()}.`,
            rollbackTarget.imageAvailable
              ? "Its image is still kept, so this is instant — no rebuild."
              : "Its image was pruned, so that exact commit will be rebuilt.",
            "The app's current environment variables and settings are used. The current version keeps serving until the new one passes its health check.",
          ].join("\n\n")}
          confirmLabel="Redeploy"
          busy={rollingBack}
          onConfirm={() => void confirmRollback()}
          onCancel={() => setRollbackTarget(null)}
        />
      )}
    </>
  );
}
