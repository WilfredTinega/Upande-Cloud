import { useEffect, useState } from "react";
import { request } from "../lib/api";
import { useTheme } from "../context/ThemeContext";
import { Skeleton } from "./Skeleton";
import {
  LatencyChart,
  RangeTabs,
  UptimeBarsChart,
  UptimeLegend,
  UptimeStateBadge,
  formatDuration,
  formatPct,
  type UptimeBucket,
  type UptimeRange,
} from "./UptimeCharts";

interface SiteAnalysis {
  app: {
    id: string;
    name: string;
    subdomain: string;
    type: string;
    status: string;
    organizationId: string;
    organizationName: string;
  };
  bucketSeconds: number;
  uptimePct: number | null;
  checks: number;
  avgLatencyMs: number | null;
  latency: { p50: number | null; p95: number | null; max: number | null; min: number | null };
  statusCodes: { code: number | null; count: number }[];
  errors: { error: string; count: number; lastSeenAt: string }[];
  current: { state: string; checkedAt: string | null; statusCode: number | null; latencyMs: number | null; error: string | null };
  series: UptimeBucket[];
  incidents: {
    start: string;
    end: string | null;
    ongoing: boolean;
    durationSeconds: number;
    checks: number;
    reason: string | null;
  }[];
}

const SECTION = "text-xs font-semibold uppercase tracking-wide text-brand-400 dark:text-brand-500 mb-2";
const ms = (v: number | null) => (v == null ? "—" : `${v} ms`);

/** One site's uptime analysis: headline stats, availability, latency, status codes, down reasons, incidents. */
export function SiteUptimeAnalysis({ appId, initialRange }: { appId: string; initialRange: UptimeRange }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [range, setRange] = useState<UptimeRange>(initialRange);
  const [data, setData] = useState<SiteAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    request<SiteAnalysis>(`/v1/admin/uptime/apps/${appId}?range=${range}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load site uptime"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [appId, range]);

  if (!data && loading) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (error && !data) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>;
  if (!data) return null;

  const totalCodes = data.statusCodes.reduce((s, r) => s + r.count, 0);
  const stats = [
    { label: "Uptime", value: formatPct(data.uptimePct) },
    { label: "Avg response", value: ms(data.avgLatencyMs) },
    { label: "Median (p50)", value: ms(data.latency.p50) },
    { label: "p95", value: ms(data.latency.p95) },
    { label: "Slowest", value: ms(data.latency.max) },
    { label: "Checks", value: data.checks.toLocaleString() },
  ];

  return (
    <div className={`flex flex-col gap-6 transition-opacity ${loading ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <UptimeStateBadge state={data.current.state} />
        <RangeTabs value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-3 py-2"
          >
            <div className="text-lg font-semibold tabular-nums text-brand-800 dark:text-brand-100">{s.value}</div>
            <div className="text-[0.7rem] uppercase tracking-wide font-medium text-brand-500 dark:text-brand-400">
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className={SECTION + " !mb-0"}>Availability</h3>
          <UptimeLegend dark={dark} />
        </div>
        <UptimeBarsChart series={data.series} bucketSeconds={data.bucketSeconds} dark={dark} height={150} />
      </section>

      <section>
        <h3 className={SECTION}>Response time</h3>
        <LatencyChart series={data.series} bucketSeconds={data.bucketSeconds} dark={dark} height={150} />
      </section>

      <section>
        <h3 className={SECTION}>Status codes</h3>
        {data.statusCodes.length === 0 ? (
          <p className="text-sm text-brand-400 dark:text-brand-500">No checks in this range.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
              {data.statusCodes.map((r) => (
                <tr key={String(r.code)}>
                  <td className="py-1.5 font-mono text-brand-700 dark:text-brand-200">{r.code ?? "No response"}</td>
                  <td className="py-1.5 text-right tabular-nums text-brand-600 dark:text-brand-300">
                    {r.count.toLocaleString()}
                  </td>
                  <td className="py-1.5 pl-3 w-24 text-right tabular-nums text-brand-400 dark:text-brand-500">
                    {formatPct(totalCodes ? (r.count / totalCodes) * 100 : null)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 className={SECTION}>Down reasons</h3>
        {data.errors.length === 0 ? (
          <p className="text-sm text-brand-400 dark:text-brand-500">None in this range.</p>
        ) : (
          <ul className="divide-y divide-brand-100 dark:divide-brand-800">
            {data.errors.map((e) => (
              <li key={e.error} className="py-1.5 flex items-start justify-between gap-3 text-sm">
                <span className="text-brand-700 dark:text-brand-200 break-words">{e.error}</span>
                <span className="shrink-0 text-right tabular-nums text-brand-500 dark:text-brand-400">
                  {e.count}× · {new Date(e.lastSeenAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className={SECTION}>Incidents</h3>
        {data.incidents.length === 0 ? (
          <p className="text-sm text-brand-400 dark:text-brand-500">No incidents in this range.</p>
        ) : (
          <ul className="divide-y divide-brand-100 dark:divide-brand-800">
            {data.incidents.map((i) => (
              <li key={i.start} className="py-1.5 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-brand-700 dark:text-brand-200">{new Date(i.start).toLocaleString()}</span>
                  <span className="tabular-nums text-brand-500 dark:text-brand-400">
                    {i.ongoing ? "Ongoing · " : ""}
                    {formatDuration(i.durationSeconds)}
                  </span>
                </div>
                {i.reason && <div className="text-xs text-brand-500 dark:text-brand-400">{i.reason}</div>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
