import { FormEvent, useCallback, useEffect, useState } from "react";
import { appsApi, githubApi } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Skeleton, SkeletonTable } from "./Skeleton";
import { Select } from "./Select";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeploymentLogModal } from "./DeploymentLogModal";
import { deployStatusBadge } from "./DeploymentHistory";
import type { App, PreviewItem, PreviewList, PreviewProtection, PromoteCheck } from "../types";
import { LockIcon, PreviewProtectionControl } from "./PreviewProtectionControl";

const TH =
  "text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider whitespace-nowrap";
const BTN =
  "px-2.5 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Preview deploys per branch: each non-production branch runs in its own
 * container on <app>-<branch>.<domain>, isolated from production (DB-backed
 * apps get a throwaway database). Lists active previews with URL, branch and
 * last deploy, and lets the user deploy a branch or delete a preview.
 */
export function PreviewsSection({ app, onPromoted }: { app: App; onPromoted?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<PreviewList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<string[] | null>(null);
  const [branchesError, setBranchesError] = useState<string | null>(null);
  const [branchesReload, setBranchesReload] = useState(0);
  const [deploying, setDeploying] = useState(false);
  const [redeployingId, setRedeployingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PreviewItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [logFor, setLogFor] = useState<PreviewItem | null>(null);
  const [promoteTarget, setPromoteTarget] = useState<{ preview: PreviewItem; check: PromoteCheck } | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [protection, setProtection] = useState<PreviewProtection | null>(null);

  const refresh = useCallback(
    () =>
      appsApi
        .listPreviews(app.id)
        .then((res) => {
          setData(res);
          setError(null);
        })
        .catch((err: unknown) =>
          setError(err instanceof Error ? err.message : "Failed to load previews"),
        ),
    [app.id],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    appsApi
      .getPreviewProtection(app.id)
      .then(setProtection)
      .catch(() => setProtection({ enabled: false, username: null }));
  }, [app.id]);

  // Poll while a preview is deploying.
  const inFlight =
    data?.previews.some((p) => p.status === "queued" || p.status === "building") ?? false;
  useEffect(() => {
    if (!inFlight) return;
    const handle = setInterval(() => void refresh(), 5000);
    return () => clearInterval(handle);
  }, [inFlight, refresh]);

  // The branch picker lists the connected repo's branches.
  useEffect(() => {
    if (app.source !== "git" || !app.repoUrl) return;
    let cancelled = false;
    setBranches(null);
    setBranchesError(null);
    githubApi
      .listRemoteBranches(app.repoUrl)
      .then((res) => !cancelled && setBranches(res.branches))
      .catch((err: unknown) => {
        if (cancelled) return;
        setBranches([]);
        setBranchesError(err instanceof Error ? err.message : "Couldn't load branches");
      });
    return () => {
      cancelled = true;
    };
  }, [app.source, app.repoUrl, branchesReload]);

  async function deploy(target: string, previewId?: string) {
    if (previewId) setRedeployingId(previewId);
    else setDeploying(true);
    try {
      const res = await appsApi.deployPreview(app.id, target);
      toast.success(
        res.created
          ? `Preview of ${target} is deploying — ${res.preview.url}`
          : `Redeploying the preview of ${target}.`,
      );
      if (!previewId) setBranch("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Preview deploy failed");
    } finally {
      setDeploying(false);
      setRedeployingId(null);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const b = branch.trim();
    if (b) void deploy(b);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await appsApi.deletePreview(app.id, deleteTarget.id);
      toast.success(`Preview of ${deleteTarget.branch} deleted.`);
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete preview");
    } finally {
      setDeleting(false);
    }
  }

  async function openPromote(p: PreviewItem) {
    setCheckingId(p.id);
    try {
      const check = await appsApi.promoteCheck(app.id, p.id);
      if (!check.canPromote) toast.error(check.reason ?? "This preview can't be promoted.");
      else setPromoteTarget({ preview: p, check });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Promote check failed");
    } finally {
      setCheckingId(null);
    }
  }

  async function confirmPromote(rebuild: boolean) {
    if (!promoteTarget) return;
    setPromoting(true);
    try {
      const res = await appsApi.promotePreview(app.id, promoteTarget.preview.id, rebuild);
      toast.success(
        res.reuseImage
          ? `Promoting ${promoteTarget.preview.branch} to production.`
          : `Rebuilding ${promoteTarget.preview.branch} for production.`,
      );
      setPromoteTarget(null);
      onPromoted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Promote failed");
    } finally {
      setPromoting(false);
    }
  }

  const productionBranch = data?.productionBranch ?? app.branch ?? "main";
  const available = (branches ?? []).filter(
    (b) => b !== productionBranch && !data?.previews.some((p) => p.branch === b),
  );
  const atLimit =
    !!data &&
    (data.previews.length >= data.limits.perApp || data.limits.orgUsed >= data.limits.perOrg);

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50 mb-3">Preview deploys</h2>

      {data === null && !error ? (
        <SkeletonTable columns={["Branch", "URL", "Status", "Last deploy", ""]} rows={2} />
      ) : error && !data ? (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      ) : data && !data.supported ? (
        <p className="text-sm text-brand-500 dark:text-brand-400">{data.unsupportedReason}</p>
      ) : data ? (
        <>
          <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2 mb-3">
            {branches === null ? (
              <Skeleton className="h-9 flex-1 min-w-[12rem]" />
            ) : (
              <div className="flex-1 min-w-[12rem] flex">
                <Select
                  value={available.includes(branch) ? branch : ""}
                  onChange={(e) => setBranch(e.target.value)}
                  disabled={available.length === 0}
                  aria-label="Branch to preview"
                  className="w-full px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="" disabled>
                    {branchesError
                      ? "Couldn't load branches"
                      : available.length === 0
                        ? "No other branches to preview"
                        : "Select a branch"}
                  </option>
                  {available.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <button
              type="submit"
              disabled={deploying || !available.includes(branch) || atLimit}
              title={atLimit ? "Preview limit reached — delete a preview first" : undefined}
              className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
            >
              {deploying ? "Deploying..." : "Deploy preview"}
            </button>
            <button
              type="button"
              onClick={() => setBranchesReload((k) => k + 1)}
              disabled={branches === null}
              title="Reload the repository's branches"
              className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
            >
              Refresh
            </button>
            <span className="text-xs text-brand-400 dark:text-brand-500">
              {data.previews.length}/{data.limits.perApp} for this app · {data.limits.orgUsed}/
              {data.limits.perOrg} in your organization
            </span>
          </form>
          <PreviewProtectionControl appId={app.id} protection={protection} onChange={setProtection} />
          {branchesError && (
            <p className="-mt-1 mb-3 text-xs text-red-600 dark:text-red-400">{branchesError}</p>
          )}

          {data.previews.length === 0 ? (
            <p className="text-sm text-brand-400 dark:text-brand-500">No active previews.</p>
          ) : (
            <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-x-auto scrollbar-hide">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-200 dark:border-brand-700">
                    <th className={TH}>Branch</th>
                    <th className={TH}>URL</th>
                    <th className={TH}>Status</th>
                    <th className={TH}>Last deploy</th>
                    <th className={TH} />
                  </tr>
                </thead>
                <tbody>
                  {data.previews.map((p, idx) => {
                    const busy = p.status === "queued" || p.status === "building";
                    return (
                      <tr
                        key={p.id}
                        className={
                          idx < data.previews.length - 1 ? "border-b border-brand-100 dark:border-brand-800" : ""
                        }
                      >
                        <td className="px-4 py-3 font-mono text-xs text-brand-700 dark:text-brand-300 whitespace-nowrap">
                          {p.branch}
                          {p.commitSha && (
                            <span className="block text-[11px] text-brand-400 dark:text-brand-500">
                              {p.commitSha.slice(0, 7)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs max-w-[18rem] truncate">
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-700 dark:text-brand-200 underline underline-offset-2 hover:text-brand-900 dark:hover:text-white"
                          >
                            {p.url.replace(/^https?:\/\//, "")}
                          </a>
                          {protection?.enabled && (
                            <span
                              title="Password-protected"
                              className="ml-1.5 inline-flex items-center gap-0.5 align-middle px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                            >
                              <LockIcon className="w-2.5 h-2.5" />
                              protected
                            </span>
                          )}
                          {p.hasDatabase && (
                            <span className="block text-[11px] text-brand-400 dark:text-brand-500">
                              throwaway database
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap" title={p.lastDeployment?.errorReason ?? undefined}>
                          <span className={deployStatusBadge(p.status)}>{p.status}</span>
                          {p.status === "live" && p.lastDeployment?.status === "failed" && (
                            <span className="block text-[11px] text-red-500 dark:text-red-400">last deploy failed</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-brand-500 dark:text-brand-400 whitespace-nowrap">
                          {relativeTime(p.lastDeployment?.createdAt ?? p.lastDeployedAt)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {p.lastDeployment && (
                            <button onClick={() => setLogFor(p)} className={`${BTN} mr-2`}>
                              Log
                            </button>
                          )}
                          {p.status === "live" && (
                            <button
                              onClick={() => void openPromote(p)}
                              disabled={checkingId === p.id || app.status === "building"}
                              className={`${BTN} mr-2`}
                            >
                              {checkingId === p.id ? "Checking…" : "Promote"}
                            </button>
                          )}
                          <button
                            onClick={() => void deploy(p.branch, p.id)}
                            disabled={busy || redeployingId === p.id}
                            className={`${BTN} mr-2`}
                          >
                            {redeployingId === p.id ? "Starting…" : "Redeploy"}
                          </button>
                          <button
                            onClick={() => setDeleteTarget(p)}
                            className="px-2.5 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {logFor?.lastDeployment && (
        <DeploymentLogModal
          appId={app.id}
          deployment={{
            id: logFor.lastDeployment.id,
            branch: logFor.branch,
            commitSha: logFor.commitSha,
            status: logFor.lastDeployment.status,
            logTruncated: false,
            errorReason: logFor.lastDeployment.errorReason,
          }}
          onClose={() => setLogFor(null)}
        />
      )}
      {promoteTarget &&
        (() => {
          const { preview: pv, check } = promoteTarget;
          const what = `${pv.branch}${check.commitSha ? ` (${check.commitSha.slice(0, 7)})` : ""}`;
          const mustRebuild = !check.imageAvailable;
          const warn = !check.compatible;
          const message = mustRebuild
            ? `The preview image of ${what} is gone, so its commit is rebuilt for production. Production env vars and database are used; health-checked, zero-downtime, and you can roll back from the history.`
            : warn
              ? `Build-time variables differ between preview and production: ${check.buildTimeKeys.join(", ")}.\nThe preview image has the preview values baked in.${
                  check.canRebuild ? " Rebuild the commit to promote with production values." : ""
                }`
              : `Production will run the preview image of ${what} with production env vars and database. Health-checked, zero-downtime, and you can roll back from the history.`;
          const rebuildPrimary = mustRebuild || (warn && check.canRebuild);
          return (
            <ConfirmDialog
              title="Promote to production?"
              message={message}
              confirmLabel={rebuildPrimary ? "Rebuild & promote" : "Promote"}
              secondaryAction={
                warn && !mustRebuild && check.canRebuild
                  ? { label: "Promote image anyway", onClick: () => void confirmPromote(false) }
                  : undefined
              }
              busy={promoting}
              onConfirm={() => void confirmPromote(rebuildPrimary)}
              onCancel={() => setPromoteTarget(null)}
            />
          );
        })()}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete this preview?"
          message={`The preview of ${deleteTarget.branch} (${deleteTarget.url}) will be removed: its container, image, route${
            deleteTarget.hasDatabase ? " and throwaway database" : ""
          }. Production is not affected.`}
          confirmLabel="Delete preview"
          destructive
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}
