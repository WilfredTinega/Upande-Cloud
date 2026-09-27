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

interface AppUptime {
  range: UptimeRange;
  bucketSeconds: number;
  intervalSeconds: number;
  uptimePct: number | null;
  checks: number;
  avgLatencyMs: number | null;
  current: {
    state: "up" | "down" | "paused" | "unknown";
    appStatus: string;
    checkedAt: string | null;
    statusCode: number | null;
    latencyMs: number | null;
    error: string | null;
  };
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

const CARD = "bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-5";
const STAT_LABEL = "text-xs text-brand-500 dark:text-brand-400 uppercase tracking-wide font-medium";
const STAT_VALUE = "text-2xl font-semibold text-brand-900 dark:text-brand-50";

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function UptimeSection({ appId }: { appId: string }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [range, setRange] = useState<UptimeRange>("30m");
  const [data, setData] = useState<AppUptime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = (initial: boolean) => {
      if (initial) setLoading(true);
      request<AppUptime>(`/v1/apps/${appId}/uptime?range=${range}`)
        .then((d) => {
          if (!cancelled) {
            setData(d);
            setError(null);
          }
        })
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load uptime"))
        .finally(() => !cancelled && setLoading(false));
    };
    load(true);
    const timer = window.setInterval(() => load(false), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [appId, range]);

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">Uptime</h2>
        <RangeTabs value={range} onChange={setRange} />
      </div>

      {!data && loading ? (
        <div className={CARD}>
          <div className="flex gap-8 mb-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-7 w-20" />
              </div>
            ))}
          </div>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full mt-5" />
        </div>
      ) : error && !data ? (
        <div className={`${CARD} text-sm text-red-600 dark:text-red-400`}>{error}</div>
      ) : data ? (
        <div className={`${CARD} transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-end gap-x-10 gap-y-4 mb-5">
            <div className="flex flex-col gap-1">
              <span className={STAT_LABEL}>Uptime</span>
              <span className="text-3xl font-semibold text-brand-900 dark:text-brand-50">{formatPct(data.uptimePct)}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className={STAT_LABEL}>Avg response</span>
              <span className={STAT_VALUE}>{data.avgLatencyMs != null ? `${data.avgLatencyMs} ms` : "—"}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className={STAT_LABEL}>Incidents</span>
              <span className={STAT_VALUE}>{data.incidents.length}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={STAT_LABEL}>Now</span>
              <span
                title={
                  data.current.checkedAt
                    ? `Last check ${when(data.current.checkedAt)}${data.current.error ? ` — ${data.current.error}` : ""}`
                    : undefined
                }
              >
                <UptimeStateBadge state={data.current.state} />
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-brand-700 dark:text-brand-200">Availability</span>
            <UptimeLegend dark={dark} />
          </div>
          <UptimeBarsChart series={data.series} bucketSeconds={data.bucketSeconds} dark={dark} />

          <div className="mt-5 mb-1 text-xs font-medium text-brand-700 dark:text-brand-200">Response time</div>
          <LatencyChart series={data.series} bucketSeconds={data.bucketSeconds} dark={dark} />

          <div className="mt-5">
            <div className="text-xs font-medium text-brand-700 dark:text-brand-200 mb-2">Incidents</div>
            {data.incidents.length === 0 ? (
              <p className="text-sm text-brand-500 dark:text-brand-400">None in the last {range}</p>
            ) : (
              <ul className="divide-y divide-brand-100 dark:divide-brand-800 border-y border-brand-100 dark:border-brand-800">
                {data.incidents.map((inc) => (
                  <li key={inc.start} className="py-2 flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-sm">
                    <span className="tabular-nums text-brand-800 dark:text-brand-100 w-32 shrink-0">{when(inc.start)}</span>
                    <span className="tabular-nums font-medium text-brand-900 dark:text-brand-50 w-20 shrink-0">
                      {formatDuration(inc.durationSeconds)}
                    </span>
                    {inc.ongoing && (
                      <span className="text-xs font-medium text-red-700 dark:text-red-400">Ongoing</span>
                    )}
                    <span className="text-brand-500 dark:text-brand-400 min-w-0 break-words flex-1">{inc.reason ?? "Down"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
