import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { notificationsApi, appsApi } from "../lib/api";
import {
  notificationTitle,
  notificationDeploymentId,
  notificationAppId,
} from "../lib/notifications";
import { DeployLogView } from "../components/DeployLog";
import { Skeleton } from "../components/Skeleton";
import { Breadcrumbs } from "../components/Breadcrumbs";
import type { Notification } from "../types";

interface DeploymentLog {
  status: string;
  ref: string | null;
  createdAt: string;
  lines: string[];
}

/**
 * Error-analysis page for a single notification (currently deployment
 * failures). Shows the failing step, the full error reason, and the complete
 * stored deploy log so the user can investigate in detail — the depth the
 * toast/bell deliberately omit.
 */
export function ErrorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const notifId = id ?? "";

  const [notification, setNotification] = useState<Notification | null>(null);
  const [log, setLog] = useState<DeploymentLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    notificationsApi
      .getOne(notifId)
      .then(async ({ notification: n }) => {
        if (!active) return;
        setNotification(n);
        const appId = notificationAppId(n);
        const deploymentId = notificationDeploymentId(n);
        if (appId && deploymentId) {
          try {
            const fetched = await appsApi.getDeploymentLog(appId, deploymentId);
            if (active) setLog(fetched);
          } catch {
            // The log may have expired (TTL) — not fatal; we still show the
            // reason from the notification metadata below.
            if (active) setLog(null);
          }
        }
      })
      .catch((err: unknown) =>
        active && setError(err instanceof Error ? err.message : "Could not load this error"),
      )
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [notifId]);

  if (loading) {
    return (
      <div role="status" aria-label="Loading" className="max-w-4xl">
        <BackLink />
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="mt-5 bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-5 grid grid-cols-2 gap-x-8 gap-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-5 h-64 w-full" />
      </div>
    );
  }

  if (error || !notification) {
    return (
      <div>
        <BackLink />
        <p className="mt-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-4 py-3 border border-red-200 dark:border-red-800">
          {error ?? "Error not found"}
        </p>
      </div>
    );
  }

  const meta = notification.metadata ?? {};
  const step = typeof meta.step === "string" ? meta.step : null;
  const reason = typeof meta.reason === "string" ? meta.reason : null;
  const appId = notificationAppId(notification);
  const when = new Date(notification.createdAt).toLocaleString();

  const appName = typeof meta.appName === "string" ? meta.appName : null;

  return (
    <div className="max-w-4xl">
      <Breadcrumbs
        items={[
          { label: "Errors", to: "/errors" },
          ...(appId ? [{ label: appName ?? "App", to: `/apps/${appId}` }] : []),
          { label: notification.type === "deployment_failed" ? "Deployment failed" : "Details" },
        ]}
      />

      <div className="mt-3 flex items-start gap-3">
        <span className="mt-1.5 shrink-0 w-2.5 h-2.5 rounded-full bg-red-600" aria-hidden />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-brand-900 dark:text-brand-50 break-words">
            {notificationTitle(notification)}
          </h1>
          <p className="text-sm text-brand-500 dark:text-brand-400 mt-0.5">{when}</p>
        </div>
      </div>

      {/* Summary card */}
      <dl className="mt-5 bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-5 grid grid-cols-2 gap-x-8 gap-y-3">
        <Field label="Failed step" value={step ?? "—"} />
        <Field
          label="Deployment status"
          value={log?.status ?? (typeof meta.deploymentId === "string" ? "unknown" : "—")}
        />
        <Field label="Branch / ref" value={log?.ref ?? "—"} mono />
        <Field
          label="App"
          value={
            appId ? (
              <Link to={`/apps/${appId}`} className="text-brand-600 dark:text-brand-400 hover:underline">
                Open app →
              </Link>
            ) : (
              "—"
            )
          }
        />
      </dl>

      {/* Full error reason — the detail kept out of the toast/bell. */}
      {reason && (
        <section className="mt-6">
          <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50 mb-2">Error</h2>
          <pre className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-4 text-sm text-red-700 dark:text-red-300 whitespace-pre-wrap break-words font-mono">
            {reason}
          </pre>
        </section>
      )}

      {/* Full deploy log */}
      <section className="mt-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">Deploy log</h2>
          <button
            onClick={() => setShowDebug((d) => !d)}
            className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
          >
            {showDebug ? "Hide debug" : "Show debug"}
          </button>
        </div>
        <DeployLogView lines={log?.lines ?? []} showDebug={showDebug} />
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold text-brand-400 dark:text-brand-500 uppercase tracking-wider mb-0.5">
        {label}
      </dt>
      <dd
        className={`text-sm text-brand-800 dark:text-brand-200 break-all ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function BackLink() {
  return <Breadcrumbs items={[{ label: "Errors", to: "/errors" }, { label: "Details" }]} />;
}
