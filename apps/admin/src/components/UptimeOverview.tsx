import { useEffect, useState } from "react";
import { request } from "../lib/api";
import { useTheme } from "../context/ThemeContext";
import { Skeleton } from "./Skeleton";
import { Drawer } from "./Drawer";
import { SiteUptimeAnalysis } from "./SiteUptimeAnalysis";
import {
  RangeTabs,
  UptimeBarsChart,
  UptimeLegend,
  UptimeStateBadge,
  chartColors,
  formatPct,
  type UptimeBucket,
  type UptimeRange,
} from "./UptimeCharts";

interface PlatformUptime {
  range: UptimeRange;
  bucketSeconds: number;
  uptimePct: number | null;
  checks: number;
  monitored: number;
  downNow: number;
  series: UptimeBucket[];
  apps: {
    appId: string;
    name: string;
    subdomain: string;
    type: string;
    appStatus: string;
    organizationId: string;
    organizationName: string;
    checks: number;
    downChecks: number;
    uptimePct: number | null;
    avgLatencyMs: number | null;
    state: string;
    lastCheckedAt: string | null;
    lastError: string | null;
  }[];
}

const CARD = "bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-5";
const TH = "py-2 px-3 text-xs font-medium uppercase tracking-wide text-brand-400 dark:text-brand-500";

/** Platform uptime: headline stats, platform-wide availability chart, per-site table. */
export function UptimeOverview() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const c = chartColors(dark);
  const [range, setRange] = useState<UptimeRange>("30m");
  const [data, setData] = useState<PlatformUptime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Site opened in the analysis drawer.
  const [selected, setSelected] = useState<{ id: string; name: string; org: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    request<PlatformUptime>(`/v1/admin/uptime?range=${range}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load uptime"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  return (
    <div className="mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">Uptime</h2>
        <RangeTabs value={range} onChange={setRange} />
      </div>

      {!data && loading ? (
        <div className={CARD}>
          <Skeleton className="h-4 w-1/4 mb-4" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full mt-5" />
        </div>
      ) : error && !data ? (
        <div className={`${CARD} text-sm text-red-600 dark:text-red-400`}>{error}</div>
      ) : data ? (
        <div className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Platform uptime", value: formatPct(data.uptimePct) },
              { label: "Monitored sites", value: String(data.monitored) },
              { label: "Down now", value: String(data.downNow) },
              { label: "Checks", value: data.checks.toLocaleString() },
            ].map((s) => (
              <div key={s.label} className={`${CARD} !px-4 !py-3`}>
                <div className="text-2xl font-semibold text-brand-800 dark:text-brand-100">{s.value}</div>
                <div className="text-xs text-brand-500 dark:text-brand-400 uppercase tracking-wide font-medium">
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div className={CARD}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-brand-800 dark:text-brand-100">Availability, all sites</span>
              <UptimeLegend dark={dark} />
            </div>
            <UptimeBarsChart series={data.series} bucketSeconds={data.bucketSeconds} dark={dark} height={180} />
          </div>

          <div className={`${CARD} !p-0 overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-200 dark:border-brand-700">
                  <th className={`${TH} text-left`}>Site</th>
                  <th className={`${TH} text-left`}>Customer</th>
                  <th className={`${TH} text-left`}>Now</th>
                  <th className={`${TH} text-right`}>Uptime</th>
                  <th className={`${TH} text-right`}>Avg response</th>
                  <th className={`${TH} text-left w-40`}></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
                {data.apps.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-brand-500 dark:text-brand-400">
                      No live sites
                    </td>
                  </tr>
                ) : (
                  data.apps.map((a) => (
                    <tr
                      key={a.appId}
                      onClick={() => setSelected({ id: a.appId, name: a.name, org: a.organizationName })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelected({ id: a.appId, name: a.name, org: a.organizationName });
                        }
                      }}
                      tabIndex={0}
                      title="Open site analysis"
                      className="cursor-pointer hover:bg-brand-50 dark:hover:bg-brand-800/50 focus:outline-none focus-visible:bg-brand-50 dark:focus-visible:bg-brand-800/50 transition-colors"
                    >
                      <td className="py-2 px-3">
                        <div className="text-brand-800 dark:text-brand-100 font-medium">{a.name}</div>
                        <div className="text-xs text-brand-500 dark:text-brand-400">{a.subdomain}</div>
                      </td>
                      <td className="py-2 px-3 text-brand-600 dark:text-brand-300">
                        {a.organizationName}
                        <div className="text-xs text-brand-400 dark:text-brand-500">{a.organizationId}</div>
                      </td>
                      <td className="py-2 px-3" title={a.lastError ?? undefined}>
                        <UptimeStateBadge state={a.state} />
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-brand-800 dark:text-brand-100 font-medium">
                        {formatPct(a.uptimePct)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-brand-600 dark:text-brand-300">
                        {a.avgLatencyMs != null ? `${a.avgLatencyMs} ms` : "—"}
                      </td>
                      <td className="py-2 px-3">
                        {/* Meter: up (blue) vs down (red) share over the range */}
                        <div
                          className="h-1.5 rounded-full overflow-hidden"
                          style={{ background: a.uptimePct == null ? c.none : c.down }}
                          aria-hidden="true"
                        >
                          {a.uptimePct != null && (
                            <div className="h-full" style={{ width: `${a.uptimePct}%`, background: c.up }} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <Drawer
        open={!!selected}
        title={selected?.name ?? ""}
        subtitle={selected?.org}
        onClose={() => setSelected(null)}
      >
        {selected && <SiteUptimeAnalysis key={selected.id} appId={selected.id} initialRange={range} />}
      </Drawer>
    </div>
  );
}
