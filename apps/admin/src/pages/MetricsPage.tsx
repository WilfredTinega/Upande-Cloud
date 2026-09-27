import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AdminApp, Metrics, Organization, Performance } from "../types";
import { adminApi } from "../lib/api";
import { useTheme } from "../context/ThemeContext";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { Drawer, DrawerEmpty } from "../components/Drawer";
import { Skeleton, SkeletonCards } from "../components/Skeleton";
import { UptimeOverview } from "../components/UptimeOverview";
import { ResponseTimeOverview } from "../components/ResponseTimeOverview";

interface MetricCard {
  label: string;
  key: keyof Metrics;
}

const CARDS: MetricCard[] = [
  { label: "Users", key: "users" },
  { label: "Organizations", key: "organizations" },
  { label: "Apps", key: "apps" },
  { label: "Deployments", key: "deployments" },
  { label: "Queue Depth", key: "queueDepth" },
];

// Time windows offered in the filter, expressed in minutes. Sub-day windows are
// bucketed hourly by the API; multi-day windows are bucketed daily.
const WINDOWS = [
  { label: "1h", minutes: 60 },
  { label: "2h", minutes: 2 * 60 },
  { label: "6h", minutes: 6 * 60 },
  { label: "12h", minutes: 12 * 60 },
  { label: "18h", minutes: 18 * 60 },
  { label: "24h", minutes: 24 * 60 },
  { label: "3 days", minutes: 3 * 24 * 60 },
  { label: "7 days", minutes: 7 * 24 * 60 },
  { label: "30 days", minutes: 30 * 24 * 60 },
  { label: "90 days", minutes: 90 * 24 * 60 },
];

// Status colors are shared across charts. Greens = healthy, red = failed.
const STATUS_COLOR: Record<string, string> = {
  live: "#16a34a",
  building: "#d97706",
  queued: "#64748b",
  failed: "#dc2626",
  idle: "#94a3b8",
  stopped: "#475569",
};

type MetricsTab = "uptime" | "performance" | "response";
const METRICS_TABS: { key: MetricsTab; label: string }[] = [
  { key: "uptime", label: "Uptime" },
  { key: "performance", label: "Site performance" },
  { key: "response", label: "Response time" },
];

// Placeholder for the performance charts while they load.
function ChartsSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-5 flex flex-col gap-4"
        >
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-48 w-full" />
        </div>
      ))}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  onClick,
  children,
}: {
  title: string;
  subtitle?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-5 ${
        onClick ? "cursor-pointer hover:border-brand-300 dark:hover:border-brand-600 transition-colors" : ""
      }`}
    >
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-brand-800 dark:text-brand-100">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-brand-500 dark:text-brand-400 mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

// Which chart's data is open in the drawer.
type ChartView = "series" | "outcomes" | "siteStatus" | "topSites";

const CHART_TITLES: Record<ChartView, string> = {
  series: "Deployments over time",
  outcomes: "Deployment outcomes",
  siteStatus: "Site status",
  topSites: "Most active sites",
};

// Simple table for drawer contents. The first column is left-aligned text,
// the rest are right-aligned numbers.
function DataTable({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <DrawerEmpty>No data in this window.</DrawerEmpty>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-brand-200 dark:border-brand-700">
          {head.map((h, i) => (
            <th
              key={h}
              className={`py-2 text-xs font-medium uppercase tracking-wide text-brand-400 dark:text-brand-500 ${
                i === 0 ? "text-left" : "text-right"
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td
                key={j}
                className={`py-2 ${
                  j === 0
                    ? "text-left text-brand-800 dark:text-brand-100"
                    : "text-right tabular-nums text-brand-600 dark:text-brand-300"
                }`}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatusLabel({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-2 capitalize">
      <span className="inline-block w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[status] ?? "#94a3b8" }} />
      {status}
    </span>
  );
}

export function MetricsPage() {
  const { theme } = useTheme();
  const dark = theme === "dark";

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: MetricsTab = tabParam === "performance" || tabParam === "response" ? tabParam : "uptime";
  const setTab = (next: MetricsTab) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [apps, setApps] = useState<AdminApp[]>([]);
  const [perf, setPerf] = useState<Performance | null>(null);

  // Filters. Empty organizationId/appId == "across all deployed sites" (the default).
  const [organizationId, setOrgId] = useState<string>("");
  const [appId, setAppId] = useState<string>("");
  const [minutes, setMinutes] = useState<number>(60);
  const [chartView, setChartView] = useState<ChartView | null>(null);

  const [loading, setLoading] = useState(true);
  const [perfLoading, setPerfLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load: metrics + filter options (organizations, apps).
  useEffect(() => {
    Promise.all([adminApi.getMetrics(), adminApi.getOrganizations(), adminApi.getApps()])
      .then(([m, o, a]) => {
        setMetrics(m);
        setOrganizations(o.organizations);
        setApps(a.apps);
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load metrics"),
      )
      .finally(() => setLoading(false));
  }, []);

  // (Re)load performance whenever a filter changes.
  useEffect(() => {
    setPerfLoading(true);
    adminApi
      .getPerformance({ organizationId: organizationId || undefined, appId: appId || undefined, minutes })
      .then(setPerf)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to load performance"),
      )
      .finally(() => setPerfLoading(false));
  }, [organizationId, appId, minutes]);

  // Sites shown in the site dropdown are scoped to the selected customer.
  const sitesForOrg = useMemo(
    () => (organizationId ? apps.filter((a) => a.project?.organizationId === organizationId) : apps),
    [apps, organizationId],
  );

  // Donut data for deployment outcomes; bars for current app status.
  const deploymentStatusData = useMemo(
    () =>
      perf
        ? (Object.entries(perf.deploymentStatus) as [string, number][])
            .filter(([, v]) => v > 0)
            .map(([name, value]) => ({ name, value }))
        : [],
    [perf],
  );
  const appStatusData = useMemo(
    () =>
      perf
        ? (Object.entries(perf.appStatus) as [string, number][]).map(
            ([name, value]) => ({ name, value }),
          )
        : [],
    [perf],
  );

  if (loading) {
    return (
      <div>
        <PageHeader title="Metrics" />
        <SkeletonCards
          count={5}
          className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8"
          cardClassName="h-24"
        />
        <ChartsSkeleton />
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
  if (!metrics) return null;

  // Theme-aware chart chrome.
  const axisColor = dark ? "#94a3b8" : "#64748b";
  const gridColor = dark ? "#334155" : "#e2e8f0";
  const tooltipStyle = {
    backgroundColor: dark ? "#1e293b" : "#ffffff",
    border: `1px solid ${dark ? "#334155" : "#e2e8f0"}`,
    borderRadius: 6,
    fontSize: 12,
    color: dark ? "#f1f5f9" : "#1e293b",
  };

  const selectClass =
    "px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-sm text-brand-800 dark:text-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-400";

  const successPct =
    perf?.totals.successRate != null
      ? `${Math.round(perf.totals.successRate * 100)}%`
      : "—";

  const scopeLabel = !organizationId
    ? "across all deployed sites"
    : appId
      ? `site: ${sitesForOrg.find((a) => a.id === appId)?.name ?? appId}`
      : `customer: ${organizations.find((o) => o.id === organizationId)?.name ?? organizationId}`;

  // Human-readable label for the selected time window (matches the dropdown).
  const windowLabel =
    WINDOWS.find((w) => w.minutes === minutes)?.label ??
    (minutes >= 24 * 60 ? `${Math.round(minutes / (24 * 60))} days` : `${Math.round(minutes / 60)}h`);

  // X-axis tick formatter. Minute buckets show "HH:MM" (prefixed with "MM-DD"
  // when the window spans more than a day, so multi-day sub-day windows stay
  // unambiguous); day buckets show "MM-DD".
  const spansMultipleDays = (perf?.windowMinutes ?? 0) > 24 * 60;

  // Describe the bucket granularity for the chart subtitle.
  const step = perf?.stepMinutes ?? 0;
  const bucketLabel =
    perf?.bucket === "day"
      ? "Daily"
      : step <= 0
        ? "" // unknown (stale/older API) — omit the granularity word
        : step === 60
          ? "Hourly"
          : step % 60 === 0
            ? `${step / 60}-hour`
            : `${step}-minute`;
  const formatTick = (value: string) =>
    perf?.bucket === "minute"
      ? spansMultipleDays
        ? `${value.slice(5, 10)} ${value.slice(11, 16)}`
        : value.slice(11, 16)
      : value.slice(5);

  return (
    <div>
      <PageHeader title="Metrics" />

      {/* Platform totals */}
      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {CARDS.map(({ label, key }) => (
          <div
            key={key}
            className="bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-5 flex flex-col gap-1"
          >
            <span className="text-3xl font-bold text-brand-800 dark:text-brand-100 tabular-nums">
              {metrics[key].toLocaleString()}
            </span>
            <span className="text-xs text-brand-500 dark:text-brand-400 uppercase tracking-wide font-medium">
              {label}
            </span>
          </div>
        ))}
      </div>

      {/* Uptime and Site performance are separate tabs (?tab= keeps the choice in the URL). */}
      <div role="tablist" aria-label="Metrics sections" className="flex gap-6 border-b border-brand-200 dark:border-brand-700 mb-6">
        {METRICS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px pb-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-brand-800 dark:border-brand-100 text-brand-900 dark:text-brand-50"
                : "border-transparent text-brand-500 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "uptime" && <UptimeOverview />}

      {tab === "response" && <ResponseTimeOverview />}

      {tab === "performance" && (
        <>
        {/* Performance section header + filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
              Site performance
            </h2>
            <p className="text-xs text-brand-500 dark:text-brand-400">
              Deployment activity {scopeLabel} · last {windowLabel}
              {perf ? ` · ${perf.scope.sites} site(s)` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              className={selectClass}
              value={organizationId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setAppId(""); // reset site when customer changes
              }}
              aria-label="Filter by customer"
            >
              <option value="">All customers</option>
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>

            <Select
              className={selectClass}
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              aria-label="Filter by site"
            >
              <option value="">All sites</option>
              {sitesForOrg.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>

            <Select
              className={selectClass}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              aria-label="Time window"
            >
              {WINDOWS.map((w) => (
                <option key={w.minutes} value={w.minutes}>
                  {w.label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Performance summary chips */}
        {perf && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Deployments", value: perf.totals.deployments.toLocaleString() },
              { label: "Success rate", value: successPct },
              { label: "Live", value: perf.totals.live.toLocaleString() },
              { label: "Failed", value: perf.totals.failed.toLocaleString() },
            ].map((s) => (
              <div
                key={s.label}
                className="bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg px-4 py-3"
              >
                <div className="text-2xl font-bold text-brand-800 dark:text-brand-100 tabular-nums">
                  {s.value}
                </div>
                <div className="text-xs text-brand-500 dark:text-brand-400 uppercase tracking-wide font-medium">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {perfLoading && !perf ? (
          <ChartsSkeleton />
        ) : !perf || perf.totals.deployments === 0 ? (
          <div className="bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-10 text-center text-sm text-brand-500 dark:text-brand-400">
            No deployments {scopeLabel} in the last {windowLabel}.
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Deployments over time */}
            <div className="lg:col-span-2">
              <ChartCard
                title="Deployments over time"
                subtitle={`${bucketLabel ? bucketLabel + " " : ""}deploys, split by outcome`}
                onClick={() => setChartView("series")}
              >
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={perf.series} margin={{ left: -16, right: 8, top: 4 }}>
                    <defs>
                      <linearGradient id="gLive" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16a34a" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#dc2626" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#dc2626" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11, fill: axisColor }}
                      tickFormatter={formatTick}
                      stroke={axisColor}
                      minTickGap={20}
                      interval={perf.series.length <= 14 ? 0 : "preserveStartEnd"}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: axisColor }}
                      stroke={axisColor}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelFormatter={(value) =>
                        perf.bucket === "minute"
                          ? `${String(value).slice(5, 10)} ${String(value).slice(11, 16)}`
                          : String(value).slice(5)
                      }
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area
                      type="monotone"
                      dataKey="live"
                      name="Live"
                      stroke="#16a34a"
                      fill="url(#gLive)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="failed"
                      name="Failed"
                      stroke="#dc2626"
                      fill="url(#gFailed)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Deployment outcomes donut */}
            <ChartCard
              title="Deployment outcomes"
              subtitle="Status of deploys in the window"
              onClick={() => setChartView("outcomes")}
            >
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={deploymentStatusData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {deploymentStatusData.map((d) => (
                      <Cell key={d.name} fill={STATUS_COLOR[d.name] ?? "#64748b"} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Current app status */}
            <ChartCard
              title="Site status"
              subtitle="Current state of sites in scope"
              onClick={() => setChartView("siteStatus")}
            >
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={appStatusData} margin={{ left: -16, right: 8, top: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: axisColor }}
                    stroke={axisColor}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: axisColor }}
                    stroke={axisColor}
                  />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: gridColor, opacity: 0.3 }} />
                  <Bar dataKey="value" name="Sites" radius={[4, 4, 0, 0]}>
                    {appStatusData.map((d) => (
                      <Cell key={d.name} fill={STATUS_COLOR[d.name] ?? "#64748b"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Top sites by deploy volume */}
            {perf.topSites.length > 0 && (
              <div className="lg:col-span-2">
                <ChartCard
                  title="Most active sites"
                  subtitle="By deployment count in the window"
                  onClick={() => setChartView("topSites")}
                >
                  <ResponsiveContainer width="100%" height={Math.max(160, perf.topSites.length * 34)}>
                    <BarChart
                      layout="vertical"
                      data={perf.topSites}
                      margin={{ left: 8, right: 16, top: 4 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke={gridColor} horizontal={false} />
                      <XAxis
                        type="number"
                        allowDecimals={false}
                        tick={{ fontSize: 11, fill: axisColor }}
                        stroke={axisColor}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={140}
                        tick={{ fontSize: 11, fill: axisColor }}
                        stroke={axisColor}
                      />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: gridColor, opacity: 0.3 }} />
                      <Bar
                        dataKey="deployments"
                        name="Deployments"
                        fill="#475569"
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>
            )}
          </div>
        )}
        </>
      )}
      <Drawer
        open={chartView !== null}
        title={chartView ? CHART_TITLES[chartView] : ""}
        subtitle={`${scopeLabel[0].toUpperCase()}${scopeLabel.slice(1)} · last ${windowLabel}`}
        onClose={() => setChartView(null)}
      >
        {perf && chartView === "series" && (
          <DataTable
            head={["Time", "Total", "Live", "Failed"]}
            rows={[...perf.series]
              .reverse()
              .filter((p) => p.total > 0)
              .map((p) => [formatTick(p.date), p.total, p.live, p.failed])}
          />
        )}
        {perf && chartView === "outcomes" && (
          <DataTable
            head={["Outcome", "Deploys", "Share"]}
            rows={deploymentStatusData.map((d) => [
              <StatusLabel key={d.name} status={d.name} />,
              d.value,
              `${Math.round((d.value / Math.max(perf.totals.deployments, 1)) * 100)}%`,
            ])}
          />
        )}
        {perf && chartView === "siteStatus" && (
          <>
            <DataTable
              head={["Status", "Sites"]}
              rows={appStatusData.map((d) => [<StatusLabel key={d.name} status={d.name} />, d.value])}
            />
            <h3 className="mt-6 mb-1 text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500">
              Sites in scope
            </h3>
            <DataTable
              head={["Site", "Status"]}
              rows={(appId ? sitesForOrg.filter((a) => a.id === appId) : sitesForOrg).map((a) => [
                a.name,
                <StatusLabel key={a.id} status={a.status} />,
              ])}
            />
          </>
        )}
        {perf && chartView === "topSites" && (
          <DataTable
            head={["Site", "Deploys"]}
            rows={perf.topSites.map((t) => [t.name, t.deployments])}
          />
        )}
      </Drawer>
    </div>
  );
}
