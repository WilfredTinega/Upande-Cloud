import { useEffect, useMemo, useState } from "react";
import type { AdminApp, AppType, BulkMigrateResult } from "../types";
import { adminApi } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useToast } from "../context/ToastContext";
import { Select } from "../components/Select";
import { SkeletonCards } from "../components/Skeleton";

// App-type filter options for the platform-wide patch/migrate wave. "" = all
// deployable sites regardless of type.
const TYPE_FILTERS: Array<{ value: "" | AppType; label: string }> = [
  { value: "", label: "All site types" },
  { value: "node", label: "Node" },
  { value: "static", label: "Static" },
  { value: "fullstack", label: "Fullstack" },
  { value: "nodered", label: "Node-RED" },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-5">
      <h2 className="text-base font-semibold text-brand-800 dark:text-brand-100">
        {title}
      </h2>
      {description && (
        <p className="mt-0.5 text-sm text-brand-500 dark:text-brand-400">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function RootAccessPage() {
  const toast = useToast();
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Platform-wide patch/migrate state.
  const [migrateType, setMigrateType] = useState<"" | AppType>("");
  const [migrateBusy, setMigrateBusy] = useState(false);
  const [migrateResult, setMigrateResult] = useState<BulkMigrateResult | null>(null);
  const [confirmMigrate, setConfirmMigrate] = useState(false);

  useEffect(() => {
    adminApi
      .getApps()
      .then(({ apps: a }) => setApps(a))
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load apps"),
      )
      .finally(() => setLoading(false));
  }, []);

  // How many sites the current type filter would actually migrate: deployed
  // before (not idle) and not mid-build. Mirrors the backend's eligibility rule
  // so the confirmation shows a truthful count.
  const eligibleCount = useMemo(() => {
    return apps.filter(
      (a) =>
        (migrateType === "" || a.type === migrateType) &&
        a.status !== "idle" &&
        a.status !== "building",
    ).length;
  }, [apps, migrateType]);

  const migrateScopeLabel =
    TYPE_FILTERS.find((t) => t.value === migrateType)?.label ?? "All site types";

  async function runBulkMigrate() {
    setMigrateBusy(true);
    setMigrateResult(null);
    try {
      const res = await adminApi.bulkMigrate(migrateType || undefined);
      setMigrateResult(res);
      // Refresh the app list so statuses reflect the now-building sites.
      adminApi
        .getApps()
        .then(({ apps: a }) => setApps(a))
        .catch(() => {
          /* non-fatal — the result summary already reflects what was queued */
        });
      if (res.queued > 0) {
        toast.success(
          `Queued ${res.queued} site${res.queued === 1 ? "" : "s"} for patch + migrate`,
        );
      } else {
        toast.info("No eligible sites to migrate");
      }
      if (res.failed > 0) {
        toast.error(`${res.failed} site${res.failed === 1 ? "" : "s"} failed to queue`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Bulk migrate failed");
    } finally {
      setMigrateBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <PageHeader title="Root Access" />
        <SkeletonCards count={3} className="mt-6 flex flex-col gap-6" cardClassName="h-36" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader title="Root Access" />

      <div className="mt-6 flex flex-col gap-6 pb-6">
        {/* Caution banner. */}
        <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          These actions rebuild live sites. Use with care.
        </div>

        {/* Platform-wide security patch + migrate across all app types. */}
        <Section
          title="Security patches & migrate all sites"
          description="Rebuild every site from scratch with the latest patches, then run migrations. A site whose build fails keeps running its old version."
        >
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="migrate-type"
                className="block text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500 mb-1.5"
              >
                Scope
              </label>
              <Select
                id="migrate-type"
                value={migrateType}
                onChange={(e) => setMigrateType(e.target.value as "" | AppType)}
                disabled={migrateBusy}
                className="rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 px-3 py-2 text-sm text-brand-800 dark:text-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-400 dark:focus:ring-brand-600 disabled:opacity-50"
              >
                {TYPE_FILTERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <button
              disabled={migrateBusy || eligibleCount === 0}
              onClick={() => setConfirmMigrate(true)}
              className="text-sm px-4 py-2 rounded bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {migrateBusy
                ? "Queueing…"
                : `Patch & migrate ${eligibleCount} site${eligibleCount === 1 ? "" : "s"}`}
            </button>
            <span className="text-xs text-brand-500 dark:text-brand-400">
              {eligibleCount === 0
                ? "No sites to rebuild."
                : `${eligibleCount} site${eligibleCount === 1 ? "" : "s"} ready`}
            </span>
          </div>

          {migrateResult && (
            <div className="mt-4 rounded border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-950 p-4">
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="text-brand-700 dark:text-brand-300">
                  <span className="font-semibold tabular-nums">{migrateResult.queued}</span> queued
                </span>
                <span className="text-brand-500 dark:text-brand-400">
                  <span className="font-semibold tabular-nums">{migrateResult.skipped}</span> skipped
                </span>
                {migrateResult.failed > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    <span className="font-semibold tabular-nums">{migrateResult.failed}</span> failed
                  </span>
                )}
                <span className="text-brand-400 dark:text-brand-500">
                  {migrateResult.total} total in scope
                </span>
              </div>

              {migrateResult.failures.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-red-600 dark:text-red-400">
                  {migrateResult.failures.map((f) => (
                    <li key={f.appId}>
                      {f.name}: {f.error}
                    </li>
                  ))}
                </ul>
              )}

              {migrateResult.skippedSites.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200">
                    {migrateResult.skippedSites.length} skipped site
                    {migrateResult.skippedSites.length === 1 ? "" : "s"}
                  </summary>
                  <ul className="mt-2 space-y-1 text-xs text-brand-500 dark:text-brand-400">
                    {migrateResult.skippedSites.map((s) => (
                      <li key={s.appId}>
                        {s.name} — {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <p className="mt-3 text-xs text-brand-400 dark:text-brand-500">
                Track progress per site on the Apps page or the Metrics queue depth.
              </p>
            </div>
          )}
        </Section>
      </div>

      {confirmMigrate && (
        <ConfirmDialog
          title="Patch & migrate all sites?"
          message={`Rebuild and migrate ${eligibleCount} site${
            eligibleCount === 1 ? "" : "s"
          } (${migrateScopeLabel}). Sites may be briefly unavailable. Failed builds keep the old version.`}
          confirmLabel={`Patch & migrate ${eligibleCount}`}
          destructive
          busy={migrateBusy}
          onConfirm={() => {
            setConfirmMigrate(false);
            void runBulkMigrate();
          }}
          onCancel={() => setConfirmMigrate(false)}
        />
      )}
    </div>
  );
}
