/**
 * Uptime charts (bucketed up/down columns + response-time line). Kept
 * identical between the admin and dashboard apps.
 *
 * Colors (validated for CVD on both surfaces): up = green, down = a deep red
 * stepped apart in lightness so red/green-blind readers can still tell them
 * apart (labels + tooltips carry it too), no data = neutral track — a gap in
 * monitoring never reads as downtime. Response time is a separate blue line.
 */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type UptimeRange = "30m" | "1h" | "24h" | "7d" | "30d";
export const UPTIME_RANGES: UptimeRange[] = ["30m", "1h", "24h", "7d", "30d"];

export interface UptimeBucket {
  t: string;
  checks: number;
  up: number;
  upRatio: number | null;
  avgLatencyMs: number | null;
}

export function chartColors(dark: boolean) {
  return {
    up: "#16a34a",
    down: dark ? "#b91c1c" : "#991b1b",
    latency: dark ? "#3987e5" : "#2a78d6",
    good: "#0ca30c",
    none: dark ? "#1e293b" : "#e2e8f0",
    surface: dark ? "#0f172a" : "#ffffff",
    grid: dark ? "#1e293b" : "#e2e8f0",
    axis: dark ? "#94a3b8" : "#64748b",
    text: dark ? "#f1f5f9" : "#0f172a",
    muted: dark ? "#94a3b8" : "#64748b",
    border: dark ? "#334155" : "#e2e8f0",
  };
}

export function formatPct(p: number | null | undefined): string {
  if (p == null) return "—";
  if (p === 100) return "100%";
  // Never round 99.996 up to a misleading "100%".
  const s = p >= 99 ? (Math.floor(p * 100) / 100).toFixed(2) : p.toFixed(1);
  return `${s}%`;
}

export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function tickLabel(iso: string, bucketSeconds: number): string {
  const d = new Date(iso);
  if (bucketSeconds >= 86400) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (bucketSeconds >= 3600) return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function bucketLabel(iso: string, bucketSeconds: number): string {
  const a = new Date(iso);
  const b = new Date(a.getTime() + bucketSeconds * 1000);
  if (bucketSeconds >= 86400) return a.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const day = a.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const t = (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${t(a)}–${t(b)}`;
}

interface Row extends UptimeBucket {
  upPct: number;
  downPct: number;
  nonePct: number;
}

function toRows(series: UptimeBucket[]): Row[] {
  return series.map((b) => ({
    ...b,
    upPct: b.upRatio == null ? 0 : b.upRatio * 100,
    downPct: b.upRatio == null ? 0 : (1 - b.upRatio) * 100,
    nonePct: b.upRatio == null ? 100 : 0,
  }));
}

function TooltipBox({ dark, children }: { dark: boolean; children: React.ReactNode }) {
  const c = chartColors(dark);
  return (
    <div
      style={{ background: c.surface, border: `1px solid ${c.border}`, color: c.text }}
      className="rounded-md px-3 py-2 text-xs shadow-lg min-w-[10rem]"
    >
      {children}
    </div>
  );
}

function Key({ color, line }: { color: string; line?: boolean }) {
  return line ? (
    <span className="inline-block w-3 h-0.5 rounded-full align-middle" style={{ background: color }} />
  ) : (
    <span className="inline-block w-2.5 h-2.5 rounded-sm align-middle" style={{ background: color }} />
  );
}

export function UptimeLegend({ dark }: { dark: boolean }) {
  const c = chartColors(dark);
  return (
    <div className="flex items-center gap-4 text-xs text-brand-500 dark:text-brand-400">
      <span className="inline-flex items-center gap-1.5"><Key color={c.up} /> Up</span>
      <span className="inline-flex items-center gap-1.5"><Key color={c.down} /> Down</span>
      <span className="inline-flex items-center gap-1.5"><Key color={c.none} /> No data</span>
    </div>
  );
}

/** Stacked 100% columns per bucket: up (bottom), down (top), or a no-data track. */
export function UptimeBarsChart({
  series,
  bucketSeconds,
  dark,
  height = 160,
}: {
  series: UptimeBucket[];
  bucketSeconds: number;
  dark: boolean;
  height?: number;
}) {
  const c = chartColors(dark);
  const rows = toRows(series);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} barCategoryGap={1} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={(v: string) => tickLabel(v, bucketSeconds)}
          stroke={c.axis}
          tick={{ fontSize: 11, fill: c.axis }}
          tickLine={false}
          axisLine={{ stroke: c.grid }}
          minTickGap={28}
        />
        <YAxis
          domain={[0, 100]}
          ticks={[0, 50, 100]}
          tickFormatter={(v: number) => `${v}%`}
          stroke={c.axis}
          tick={{ fontSize: 11, fill: c.axis }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <Tooltip
          cursor={{ fill: dark ? "rgba(148,163,184,0.12)" : "rgba(100,116,139,0.08)" }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const r = active && payload?.[0] ? (payload[0].payload as Row) : null;
            if (!r) return null;
            return (
              <TooltipBox dark={dark}>
                <div className="font-semibold text-sm tabular-nums">
                  {r.upRatio == null ? "No data" : `${formatPct(r.upRatio * 100)} up`}
                </div>
                <div style={{ color: c.muted }} className="mt-0.5">{bucketLabel(r.t, bucketSeconds)}</div>
                {r.checks > 0 && (
                  <div className="mt-1.5 flex flex-col gap-0.5 tabular-nums">
                    <span className="flex items-center gap-1.5"><Key color={c.up} line /> {r.up} up</span>
                    {r.checks - r.up > 0 && (
                      <span className="flex items-center gap-1.5"><Key color={c.down} line /> {r.checks - r.up} down</span>
                    )}
                    {r.avgLatencyMs != null && <span style={{ color: c.muted }}>avg {r.avgLatencyMs} ms</span>}
                  </div>
                )}
              </TooltipBox>
            );
          }}
        />
        {/* Rounded segments with a 2px surface gap between up and down. */}
        <Bar dataKey="upPct" stackId="u" fill={c.up} stroke={c.surface} strokeWidth={2} radius={4} maxBarSize={24} isAnimationActive={false} />
        <Bar dataKey="downPct" stackId="u" fill={c.down} stroke={c.surface} strokeWidth={2} radius={4} maxBarSize={24} isAnimationActive={false} />
        <Bar dataKey="nonePct" stackId="u" fill={c.none} stroke={c.surface} strokeWidth={2} radius={4} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Average response time per bucket (up checks only); gaps where there's no data. */
export function LatencyChart({
  series,
  bucketSeconds,
  dark,
  height = 140,
}: {
  series: UptimeBucket[];
  bucketSeconds: number;
  dark: boolean;
  height?: number;
}) {
  const c = chartColors(dark);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={series} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={(v: string) => tickLabel(v, bucketSeconds)}
          stroke={c.axis}
          tick={{ fontSize: 11, fill: c.axis }}
          tickLine={false}
          axisLine={{ stroke: c.grid }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v: number) => `${v} ms`}
          stroke={c.axis}
          tick={{ fontSize: 11, fill: c.axis }}
          tickLine={false}
          axisLine={false}
          width={56}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: c.axis, strokeWidth: 1 }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const r = active && payload?.[0] ? (payload[0].payload as UptimeBucket) : null;
            if (!r) return null;
            return (
              <TooltipBox dark={dark}>
                <div className="font-semibold text-sm tabular-nums">
                  {r.avgLatencyMs == null ? "No data" : `${r.avgLatencyMs} ms`}
                </div>
                <div style={{ color: c.muted }} className="mt-0.5">{bucketLabel(r.t, bucketSeconds)}</div>
              </TooltipBox>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="avgLatencyMs"
          stroke={c.latency}
          strokeWidth={2}
          fill={c.latency}
          fillOpacity={0.1}
          connectNulls={false}
          dot={(props: { cx?: number; cy?: number; index?: number }) => {
            // A lone bucket between gaps has no line segment; mark it with a dot.
            const i = props.index ?? 0;
            const lone =
              series[i]?.avgLatencyMs != null &&
              series[i - 1]?.avgLatencyMs == null &&
              series[i + 1]?.avgLatencyMs == null;
            return lone && props.cx != null && props.cy != null ? (
              <circle key={i} cx={props.cx} cy={props.cy} r={4} fill={c.latency} stroke={c.surface} strokeWidth={2} />
            ) : (
              <g key={i} />
            );
          }}
          activeDot={{ r: 4, fill: c.latency, stroke: c.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Up / Down / Paused / Unknown pill: color + icon + label. */
export function UptimeStateBadge({ state }: { state: string }) {
  const map: Record<string, { label: string; cls: string; icon: string }> = {
    up: { label: "Up", cls: "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-900", icon: "●" },
    down: { label: "Down", cls: "text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900", icon: "▲" },
    paused: { label: "Not monitored", cls: "text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-800 border-brand-200 dark:border-brand-700", icon: "❚❚" },
    unknown: { label: "Pending", cls: "text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-800 border-brand-200 dark:border-brand-700", icon: "○" },
  };
  const s = map[state] ?? map.unknown;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${s.cls}`}>
      <span aria-hidden="true" className="text-[9px] leading-none">{s.icon}</span>
      {s.label}
    </span>
  );
}

/** 30m / 1h / 24h / 7d / 30d segmented control. */
export function RangeTabs({ value, onChange }: { value: UptimeRange; onChange: (r: UptimeRange) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-md border border-brand-200 dark:border-brand-700 p-0.5 bg-brand-50 dark:bg-brand-950">
      {UPTIME_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          role="tab"
          aria-selected={value === r}
          onClick={() => onChange(r)}
          className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
            value === r
              ? "bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 shadow-sm"
              : "text-brand-500 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-200"
          }`}
        >
          {r}
        </button>
      ))}
    </div>
  );
}


// Categorical series colors (fixed order, never cycled; validated for CVD on the
// white and brand-900 chart surfaces). A 9th series is never generated.
const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
export const MAX_SERIES = SERIES_LIGHT.length;
export function seriesColor(slot: number, dark: boolean): string {
  return (dark ? SERIES_DARK : SERIES_LIGHT)[slot];
}

export interface SiteLatencyPoint {
  t: string;
  latency: Record<string, number>;
}

/**
 * Average response time per site over time: one 2px line per site on a single
 * ms axis. Each site carries a fixed color `slot`; with ≤ 4 sites the lines are
 * also labelled at their last point. Crosshair tooltip lists every site.
 */
export function SiteLatencyChart({
  points,
  sites,
  bucketSeconds,
  dark,
  height = 240,
}: {
  points: SiteLatencyPoint[];
  sites: { id: string; name: string; slot: number }[];
  bucketSeconds: number;
  dark: boolean;
  height?: number;
}) {
  const c = chartColors(dark);
  const rows = points.map((p) => ({ t: p.t, ...p.latency }));
  const directLabels = sites.length <= 4;
  const lastIndex = (id: string) => {
    for (let i = rows.length - 1; i >= 0; i--) if ((rows[i] as Record<string, unknown>)[id] != null) return i;
    return -1;
  };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 8, right: directLabels ? 88 : 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={c.grid} vertical={false} />
        <XAxis
          dataKey="t"
          tickFormatter={(v: string) => tickLabel(v, bucketSeconds)}
          stroke={c.axis}
          tick={{ fontSize: 11, fill: c.axis }}
          tickLine={false}
          axisLine={{ stroke: c.grid }}
          minTickGap={28}
        />
        <YAxis
          tickFormatter={(v: number) => `${v} ms`}
          stroke={c.axis}
          tick={{ fontSize: 11, fill: c.axis }}
          tickLine={false}
          axisLine={false}
          width={56}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: c.axis, strokeWidth: 1 }}
          isAnimationActive={false}
          content={({ active, label }) => {
            if (!active || !label) return null;
            const row = rows.find((r) => r.t === label) as Record<string, unknown> | undefined;
            if (!row) return null;
            const items = sites
              .map((s) => ({ ...s, v: row[s.id] as number | undefined }))
              .sort((a, b) => (b.v ?? -1) - (a.v ?? -1));
            return (
              <TooltipBox dark={dark}>
                <div style={{ color: c.muted }} className="mb-1">{bucketLabel(String(label), bucketSeconds)}</div>
                {items.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-4 tabular-nums">
                    <span className="inline-flex items-center gap-1.5">
                      <Key color={seriesColor(s.slot, dark)} line /> {s.name}
                    </span>
                    <span className="font-semibold">{s.v == null ? "—" : `${s.v} ms`}</span>
                  </div>
                ))}
              </TooltipBox>
            );
          }}
        />
        {sites.map((s) => {
          const color = seriesColor(s.slot, dark);
          const last = lastIndex(s.id);
          return (
            <Line
              key={s.id}
              type="monotone"
              dataKey={s.id}
              name={s.name}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: color, stroke: c.surface, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
              label={
                directLabels
                  ? (props: { x?: number | string; y?: number | string; index?: number }) =>
                      props.index === last && props.x != null && props.y != null ? (
                        <text key={s.id} x={Number(props.x) + 8} y={Number(props.y)} dy={4} fontSize={11} fill={c.muted}>
                          {s.name.length > 12 ? `${s.name.slice(0, 11)}…` : s.name}
                        </text>
                      ) : (
                        <g key={`${s.id}-${props.index}`} />
                      )
                  : undefined
              }
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Legend for SiteLatencyChart; each entry toggles its site on/off. */
export function SiteLegend({
  sites,
  shown,
  dark,
  onToggle,
}: {
  sites: { id: string; name: string; slot: number | null }[];
  shown: Set<string>;
  dark: boolean;
  onToggle: (id: string) => void;
}) {
  const c = chartColors(dark);
  const full = shown.size >= MAX_SERIES;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {sites.map((s) => {
        const on = shown.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onToggle(s.id)}
            disabled={!on && full}
            aria-pressed={on}
            title={!on && full ? `Up to ${MAX_SERIES} sites at a time` : undefined}
            className={`inline-flex items-center gap-1.5 rounded px-1 -mx-1 transition-opacity disabled:cursor-not-allowed ${
              on ? "text-brand-700 dark:text-brand-200" : "text-brand-400 dark:text-brand-500 opacity-60"
            }`}
          >
            <Key color={on && s.slot != null ? seriesColor(s.slot, dark) : c.none} line />
            {s.name}
          </button>
        );
      })}
    </div>
  );
}
