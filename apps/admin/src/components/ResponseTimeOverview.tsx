import { useEffect, useMemo, useState } from "react";
import { request } from "../lib/api";
import { useTheme } from "../context/ThemeContext";
import { Skeleton } from "./Skeleton";
import { Drawer } from "./Drawer";
import { SiteUptimeAnalysis } from "./SiteUptimeAnalysis";
import {
  MAX_SERIES,
  RangeTabs,
  SiteLatencyChart,
  SiteLegend,
  UptimeStateBadge,
  type SiteLatencyPoint,
  type UptimeRange,
} from "./UptimeCharts";

interface ResponseTimeData {
  bucketSeconds: number;
  latencyBySite: SiteLatencyPoint[];
  apps: {
    appId: string;
    name: string;
    subdomain: string;
    organizationId: string;
    organizationName: string;
    checks: number;
    avgLatencyMs: number | null;
    latency?: { p50: number | null; p95: number | null; max: number | null };
    lastLatencyMs?: number | null;
    state: string;
    lastError: string | null;
  }[];
}

const CARD = "bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-5";
const TH = "py-2 px-3 text-xs font-medium uppercase tracking-wide text-brand-400 dark:text-brand-500";

const ms = (v: number | null | undefined) => (v != null ? `${v.toLocaleString()} ms` : "—");

/** Response time of each site's HTTP probes: per-site chart + per-site table. */
export function ResponseTimeOverview() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [range, setRange] = useState<UptimeRange>("30m");
  const [data, setData] = useState<ResponseTimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; name: string; org: string } | null>(null);
  // Sites drawn on the chart → fixed color slot (kept while shown).
  const [slots, setSlots] = useState<Map<string, number> | null>(null);

  const sites = useMemo(
    () =>
      [...(data?.apps ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId))
        .map((a) => ({ id: a.appId, name: a.name })),
    [data],
  );
  const shownSlots = useMemo(() => {
    if (slots) return new Map([...slots].filter(([id]) => sites.some((s) => s.id === id)));
    return new Map(sites.slice(0, MAX_SERIES).map((s, i) => [s.id, i]));
  }, [slots, sites]);

  function toggleSite(id: string) {
    const next = new Map(shownSlots);
    if (next.has(id)) next.delete(id);
    else {
      if (next.size >= MAX_SERIES) return;
      const used = new Set(next.values());
      let slot = 0;
      while (used.has(slot)) slot++;
      next.set(id, slot);
    }
    setSlots(next);
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    request<ResponseTimeData>(`/v1/admin/uptime?range=${range}`)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load response times"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  // Slowest (by average) first; sites without data last.
  const rows = useMemo(
    () =>
      [...(data?.apps ?? [])].sort(
        (a, b) => (b.avgLatencyMs ?? -1) - (a.avgLatencyMs ?? -1) || a.name.localeCompare(b.name),
      ),
    [data],
  );

  return (
    <div className="mb-10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">Response time</h2>
        <RangeTabs value={range} onChange={setRange} />
      </div>

      {!data && loading ? (
        <div className={CARD}>
          <Skeleton className="h-4 w-1/4 mb-4" />
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-24 w-full mt-5" />
        </div>
      ) : error && !data ? (
        <div className={`${CARD} text-sm text-red-600 dark:text-red-400`}>{error}</div>
      ) : data ? (
        <div className={`flex flex-col gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className={CARD}>
            <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
              <span className="text-sm font-semibold text-brand-800 dark:text-brand-100">Response time per site</span>
              <SiteLegend
                sites={sites.map((s) => ({ ...s, slot: shownSlots.get(s.id) ?? null }))}
                shown={new Set(shownSlots.keys())}
                dark={dark}
                onToggle={toggleSite}
              />
            </div>
            <SiteLatencyChart
              points={data.latencyBySite}
              sites={sites
                .filter((s) => shownSlots.has(s.id))
                .map((s) => ({ ...s, slot: shownSlots.get(s.id)! }))}
              bucketSeconds={data.bucketSeconds}
              dark={dark}
            />
          </div>

          <div className={`${CARD} !p-0 overflow-x-auto`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-200 dark:border-brand-700">
                  <th className={`${TH} text-left`}>Site</th>
                  <th className={`${TH} text-left`}>Customer</th>
                  <th className={`${TH} text-left`}>Now</th>
                  <th className={`${TH} text-right`}>Last</th>
                  <th className={`${TH} text-right`}>Avg</th>
                  <th className={`${TH} text-right`}>p50</th>
                  <th className={`${TH} text-right`}>p95</th>
                  <th className={`${TH} text-right`}>Slowest</th>
                  <th className={`${TH} text-right`}>Checks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-6 text-center text-brand-500 dark:text-brand-400">
                      No live sites
                    </td>
                  </tr>
                ) : (
                  rows.map((a) => (
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
                      <td className="py-2 px-3 text-brand-600 dark:text-brand-300">{a.organizationName}</td>
                      <td className="py-2 px-3" title={a.lastError ?? undefined}>
                        <UptimeStateBadge state={a.state} />
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-brand-600 dark:text-brand-300">
                        {ms(a.lastLatencyMs)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-brand-800 dark:text-brand-100 font-medium">
                        {ms(a.avgLatencyMs)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-brand-600 dark:text-brand-300">
                        {ms(a.latency?.p50)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-brand-600 dark:text-brand-300">
                        {ms(a.latency?.p95)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-brand-600 dark:text-brand-300">
                        {ms(a.latency?.max)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-brand-500 dark:text-brand-400">
                        {a.checks.toLocaleString()}
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
