import { useCallback, useEffect, useState } from "react";
import { appsApi } from "../lib/api";
import { Modal } from "./Modal";
import { DeployLogView } from "./DeployLog";
import { SkeletonLines } from "./Skeleton";
import type { DeploymentHistoryItem } from "../types";

/**
 * Full build log of ONE deployment from the deploy history. The API serves the
 * live Redis copy while it exists and the copy persisted to Postgres once the
 * deployment finished, so any past deployment's log can be opened.
 */
export function DeploymentLogModal({
  appId,
  deployment,
  onClose,
}: {
  appId: string;
  deployment: Pick<
    DeploymentHistoryItem,
    "id" | "branch" | "commitSha" | "status" | "logTruncated" | "errorReason"
  >;
  onClose: () => void;
}) {
  const [lines, setLines] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setRefreshing(true);
    setError(null);
    return appsApi
      .getDeploymentLog(appId, deployment.id)
      .then((res) => setLines(res.lines))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load log"),
      )
      .finally(() => setRefreshing(false));
  }, [appId, deployment.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const inFlight = deployment.status === "queued" || deployment.status === "building";

  return (
    <Modal
      title={`Deployment ${deployment.id.slice(0, 8)}`}
      onClose={onClose}
      maxWidthClass="max-w-4xl"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3 text-xs text-brand-500 dark:text-brand-400">
        <span>
          Branch <span className="font-mono text-brand-700 dark:text-brand-200">{deployment.branch ?? "—"}</span>
        </span>
        {deployment.commitSha && (
          <span>
            Commit{" "}
            <span className="font-mono text-brand-700 dark:text-brand-200">
              {deployment.commitSha.slice(0, 7)}
            </span>
          </span>
        )}
        {deployment.status && <span>Status {deployment.status}</span>}
        {deployment.logTruncated && <span>Log truncated (only the tail was kept)</span>}
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => setShowDebug((d) => !d)}
            className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
          >
            {showDebug ? "Hide debug" : "Show debug"}
          </button>
          {inFlight && (
            <button
              onClick={() => void load()}
              disabled={refreshing}
              className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          )}
        </div>
      </div>
      {deployment.errorReason && (
        <p className="mb-3 text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded px-3 py-2 whitespace-pre-wrap break-words">
          {deployment.errorReason}
        </p>
      )}
      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : lines === null ? (
        <div className="rounded-lg bg-brand-950 border border-brand-800 p-4">
          <SkeletonLines lines={10} className="[&>div]:h-3 [&>div]:bg-brand-800" />
        </div>
      ) : (
        <DeployLogView lines={lines} showDebug={showDebug} />
      )}
    </Modal>
  );
}
