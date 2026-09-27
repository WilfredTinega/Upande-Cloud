import { useEffect, useMemo, useState } from "react";
import type { AdminApp, Organization, ResourceSite, ResourceUsage, SystemInfo, User } from "../types";
import { adminApi } from "../lib/api";
import { PageHeader, stickyHeadCell } from "../components/PageHeader";
import { Select } from "../components/Select";
import { Drawer, DrawerEmpty, DrawerRow } from "../components/Drawer";

// Animated skeleton block used while resource data is still loading.
function Skel({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-brand-200/70 dark:bg-brand-800 ${className}`} />;
}

// Skeleton for the fastest/slowest latency lists.
function SkelList() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skel className="h-4 w-40" />
          <Skel className="h-2 flex-1" />
          <Skel className="h-4 w-12" />
        </div>
      ))}
    </div>
  );
}

// Skeleton rows for a table body with `cols` columns.
function SkelRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="bg-white dark:bg-brand-900">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-2.5">
              <Skel className="h-4 w-full max-w-[8rem]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function fmtBytes(b: number | null): string {
  if (b == null) return "—";
  if (b === 0) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtUptime(s: number | null): string {
  if (s == null) return "—";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

function fmtCpu(p: number | null): string {
  return p == null ? "—" : `${p.toFixed(1)}%`;
}

function fmtLatency(ms: number | null): string {
  return ms == null ? "—" : `${ms} ms`;
}

// Latency tone: green fast, amber moderate, red slow.
function latencyTone(ms: number | null): string {
  if (ms == null) return "text-brand-400 dark:text-brand-500";
  if (ms < 150) return "text-green-600 dark:text-green-400";
  if (ms < 600) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function UpDot({ up }: { up: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block w-2 h-2 rounded-full ${up ? "bg-green-500" : "bg-brand-400 dark:bg-brand-600"}`}
      />
      <span className={up ? "text-green-700 dark:text-green-400" : "text-brand-500 dark:text-brand-400"}>
        {up ? "up" : "down"}
      </span>
    </span>
  );
}

function Card({
  title,
  onClick,
  children,
}: {
  title: string;
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
      <h3 className="text-sm font-semibold text-brand-800 dark:text-brand-100 mb-3">{title}</h3>
      {children}
    </div>
  );
}

// Label/value row for the host figures at the top of a drawer.
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-brand-500 dark:text-brand-400">{label}</span>
      <span className="font-medium tabular-nums text-brand-900 dark:text-brand-50">{value}</span>
    </div>
  );
}

function DrawerHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-5 mb-1 text-xs uppercase tracking-wide text-brand-400 dark:text-brand-500 first:mt-0">
      {children}
    </h3>
  );
}

// Which tile's detail is open in the drawer.
type ResourceView =
  | "cores"
  | "memory"
  | "storage"
  | "users"
  | "sites"
  | "appsCpu"
  | "appsMemory"
  | "customers"
  | "fastest"
  | "slowest";

const VIEW_TITLES: Record<ResourceView, string> = {
  cores: "CPU",
  memory: "Memory",
  storage: "Storage",
  users: "Active users",
  sites: "Sites",
  appsCpu: "Apps CPU",
  appsMemory: "Apps memory",
  customers: "Customers",
  fastest: "Fastest sites",
  slowest: "Slowest sites",
};

function SiteRows({ sites, value }: { sites: ResourceSite[]; value: (s: ResourceSite) => React.ReactNode }) {
  if (sites.length === 0) return <DrawerEmpty>No sites in scope.</DrawerEmpty>;
  return (
    <div className="-mx-3">
      {sites.map((s) => (
        <DrawerRow
          key={s.appId}
          primary={s.name}
          secondary={[s.subdomain, s.customer].filter(Boolean).join(" · ")}
          right={value(s)}
        />
      ))}
    </div>
  );
}

function ResourceDrawerBody({
  view,
  system,
  data,
  users,
}: {
  view: ResourceView;
  system: SystemInfo | null;
  data: ResourceUsage | null;
  users: User[];
}) {
  const sites = data?.sites ?? [];
  const byNum = (f: (s: ResourceSite) => number | null) =>
    [...sites].sort((a, b) => (f(b) ?? -1) - (f(a) ?? -1));
  const withLatency = sites.filter((s) => s.latencyMs != null);

  switch (view) {
    case "cores":
      return (
        <>
          {system && (
            <>
              <Fact label="Cores" value={system.cores} />
              <Fact label="Load (1 / 5 / 15 min)" value={system.loadAvg.map((l) => l.toFixed(2)).join(" / ")} />
              <Fact label="Host uptime" value={fmtUptime(system.uptimeSeconds)} />
            </>
          )}
          <DrawerHeading>Sites by CPU</DrawerHeading>
          <SiteRows sites={byNum((s) => s.cpuPct)} value={(s) => fmtCpu(s.cpuPct)} />
        </>
      );
    case "memory":
      return (
        <>
          {system && (
            <>
              <Fact label="Used" value={fmtBytes(system.memory.used)} />
              <Fact label="Free" value={fmtBytes(system.memory.free)} />
              <Fact label="Total" value={fmtBytes(system.memory.total)} />
            </>
          )}
          <DrawerHeading>Sites by memory</DrawerHeading>
          <SiteRows sites={byNum((s) => s.memBytes)} value={(s) => fmtBytes(s.memBytes)} />
        </>
      );
    case "storage":
      return system?.disk ? (
        <>
          <Fact label="Used" value={fmtBytes(system.disk.used)} />
          <Fact label="Free" value={fmtBytes(system.disk.free)} />
          <Fact label="Total" value={fmtBytes(system.disk.total)} />
          <Fact label="In use" value={`${Math.round((system.disk.used / system.disk.total) * 100)}%`} />
        </>
      ) : (
        <DrawerEmpty>Storage figures are unavailable on this host.</DrawerEmpty>
      );
    case "users": {
      const active = users.filter((u) => u.status === "active");
      if (active.length === 0) return <DrawerEmpty>No active users.</DrawerEmpty>;
      return (
        <div className="-mx-3">
          {active.map((u) => (
            <DrawerRow
              key={u.id}
              primary={u.username || u.email}
              secondary={u.email}
              right={<span className="text-xs">{u.role}</span>}
            />
          ))}
        </div>
      );
    }
    case "sites":
      return (
        <SiteRows
          sites={[...sites].sort((a, b) => Number(b.up) - Number(a.up) || a.name.localeCompare(b.name))}
          value={(s) => (
            <span className="flex items-center gap-3">
              <span className="text-xs text-brand-400 dark:text-brand-500">{fmtUptime(s.uptimeSeconds)}</span>
              <UpDot up={s.up} />
            </span>
          )}
        />
      );
    case "appsCpu":
      return <SiteRows sites={byNum((s) => s.cpuPct)} value={(s) => fmtCpu(s.cpuPct)} />;
    case "appsMemory":
      return (
        <SiteRows
          sites={byNum((s) => s.memBytes)}
          value={(s) =>
            s.memLimitBytes ? `${fmtBytes(s.memBytes)} / ${fmtBytes(s.memLimitBytes)}` : fmtBytes(s.memBytes)
          }
        />
      );
    case "customers": {
      const list = data?.byCustomer ?? [];
      if (list.length === 0) return <DrawerEmpty>No customers in scope.</DrawerEmpty>;
      return (
        <div className="-mx-3">
          {list.map((c) => (
            <DrawerRow
              key={c.organizationId}
              primary={c.customer}
              secondary={`${c.sitesUp}/${c.sites} sites up · ${fmtCpu(c.cpuPct)} CPU · ${fmtBytes(c.memBytes)}`}
              right={<span className={latencyTone(c.avgLatencyMs)}>{fmtLatency(c.avgLatencyMs)}</span>}
            />
          ))}
        </div>
      );
    }
    case "fastest":
    case "slowest": {
      const sorted = [...withLatency].sort((a, b) =>
        view === "fastest" ? (a.latencyMs ?? 0) - (b.latencyMs ?? 0) : (b.latencyMs ?? 0) - (a.latencyMs ?? 0),
      );
      return (
        <SiteRows
          sites={sorted}
          value={(s) => <span className={latencyTone(s.latencyMs)}>{fmtLatency(s.latencyMs)}</span>}
        />
      );
    }
  }
}

// Compact list of sites with a latency bar (used for fastest / slowest).
function SiteLatencyList({ sites, empty }: { sites: ResourceSite[]; empty: string }) {
  if (sites.length === 0) {
    return <p className="text-sm text-brand-400 dark:text-brand-500">{empty}</p>;
  }
  const max = Math.max(...sites.map((s) => s.latencyMs ?? 0), 1);
  return (
    <div className="flex flex-col gap-2">
      {sites.map((s) => (
        <div key={s.appId} className="flex items-center gap-3">
          <span className="text-sm text-brand-700 dark:text-brand-300 w-40 truncate" title={s.name}>
            {s.name}
          </span>
          <div className="flex-1 h-2 rounded bg-brand-100 dark:bg-brand-800 overflow-hidden">
            <div
              className="h-full bg-brand-500 dark:bg-brand-400"
              style={{ width: `${Math.max(4, ((s.latencyMs ?? 0) / max) * 100)}%` }}
            />
          </div>
          <span className={`text-sm tabular-nums w-16 text-right ${latencyTone(s.latencyMs)}`}>
            {fmtLatency(s.latencyMs)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ResourcesPage() {
  const [data, setData] = useState<ResourceUsage | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [apps, setApps] = useState<AdminApp[]>([]);

  const [organizationId, setOrgId] = useState("");
  const [appId, setAppId] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [view, setView] = useState<ResourceView | null>(null);

  // The page shell + filters render instantly; only the resource tables wait on
  // the (slower) per-container stats. `resLoading` drives the skeletons.
  const [resLoading, setResLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fast, independent loads: system capacity + filter options render right away.
  useEffect(() => {
    adminApi.getSystem().then(setSystem).catch(() => {});
    Promise.all([adminApi.getOrganizations(), adminApi.getApps()])
      .then(([o, a]) => {
        setOrganizations(o.organizations);
        setApps(a.apps);
      })
      .catch(() => {});
    // Only needed for the "Active users" drawer.
    adminApi.getUsers().then((u) => setUsers(u.users)).catch(() => {});
  }, []);

  // (Re)load resource usage on filter change. Keeps prior data visible while the
  // next snapshot loads so switching scope doesn't blank the page.
  useEffect(() => {
    let cancelled = false;
    setResLoading(true);
    adminApi
      .getResources({ organizationId: organizationId || undefined, appId: appId || undefined })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load resources");
      })
      .finally(() => {
        if (!cancelled) setResLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, appId]);

  const sitesForOrg = useMemo(
    () => (organizationId ? apps.filter((a) => a.project?.organizationId === organizationId) : apps),
    [apps, organizationId],
  );

  const selectClass =
    "px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-sm text-brand-800 dark:text-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-400";

  if (error) {
    return (
      <div className="px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
        {error}
      </div>
    );
  }

  // System (host) cards — render as soon as `system` arrives (it's fast).
  const memPct = system ? Math.round((system.memory.used / system.memory.total) * 100) : 0;
  const diskPct =
    system?.disk ? Math.round((system.disk.used / system.disk.total) * 100) : 0;
  const systemCards = system
    ? [
        { view: "cores" as const, label: "CPU cores", value: String(system.cores), sub: `load ${system.loadAvg[0]}` },
        {
          view: "memory" as const,
          label: "Memory",
          value: fmtBytes(system.memory.used),
          sub: `of ${fmtBytes(system.memory.total)} · ${memPct}%`,
        },
        {
          view: "storage" as const,
          label: "Storage",
          value: system.disk ? fmtBytes(system.disk.used) : "—",
          sub: system.disk ? `of ${fmtBytes(system.disk.total)} · ${diskPct}%` : "unavailable",
        },
        {
          view: "users" as const,
          label: "Active users",
          value: String(system.users.active),
          sub: `of ${system.users.total} total`,
        },
      ]
    : [];

  // Resource totals (from the slower per-container snapshot).
  const totalCards = data
    ? [
        { view: "sites" as const, label: "Sites", value: `${data.totals.sitesUp}/${data.totals.sites} up` },
        { view: "appsCpu" as const, label: "Apps CPU", value: fmtCpu(data.totals.cpuPct) },
        { view: "appsMemory" as const, label: "Apps memory", value: fmtBytes(data.totals.memBytes) },
        { view: "customers" as const, label: "Customers", value: data.byCustomer.length.toString() },
      ]
    : [];

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Resources
            {resLoading && (
              <span className="text-xs font-normal text-brand-400 dark:text-brand-500">
                refreshing…
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Select
              className={selectClass}
              value={organizationId}
              onChange={(e) => {
                setOrgId(e.target.value);
                setAppId("");
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
          </>
        }
      />

      {/* System capacity + deployed-app totals — one combined row */}
      <h2 className="mt-6 text-lg font-semibold text-brand-800 dark:text-brand-100 mb-3">
        System &amp; deployed apps
        {system ? (
          <span className="text-sm font-normal text-brand-400 dark:text-brand-500"> · {system.hostname}</span>
        ) : null}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3 mb-8">
        {system && data
          ? [...systemCards, ...totalCards].map((c) => (
              <button
                key={c.label}
                onClick={() => setView(c.view)}
                className="text-left bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-4 flex flex-col gap-1 hover:border-brand-300 dark:hover:border-brand-600 transition-colors"
              >
                <span className="text-[0.65rem] text-brand-500 dark:text-brand-400 uppercase tracking-wider font-semibold">
                  {c.label}
                </span>
                <span className="text-xl font-bold text-brand-800 dark:text-brand-100 tabular-nums leading-tight">
                  {c.value}
                </span>
                <span className="text-xs text-brand-400 dark:text-brand-500 truncate min-h-[1rem]">
                  {(c as { sub?: string }).sub ?? ""}
                </span>
              </button>
            ))
          : Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded-lg p-4 flex flex-col gap-2"
              >
                <Skel className="h-3 w-16" />
                <Skel className="h-6 w-20" />
                <Skel className="h-3 w-24" />
              </div>
            ))}
      </div>

      {/* Fastest / slowest */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <Card title="Fastest sites" onClick={() => setView("fastest")}>
          {data ? (
            <SiteLatencyList sites={data.fastest} empty="No responsive sites to measure." />
          ) : (
            <SkelList />
          )}
        </Card>
        <Card title="Slowest sites" onClick={() => setView("slowest")}>
          {data ? (
            <SiteLatencyList sites={data.slowest} empty="No responsive sites to measure." />
          ) : (
            <SkelList />
          )}
        </Card>
      </div>

      {/* Per customer */}
      <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100 mb-3">
        Consumption per customer
      </h2>
      <div className="rounded-lg border border-brand-200 dark:border-brand-700 mb-8">
        <table className="w-full text-sm">
          {/* Sticky column header — pins flush beneath the PageHeader. */}
          <thead>
            <tr>
              {["Customer", "Sites up", "CPU", "Memory", "Avg latency"].map((col) => (
                <th key={col} className={stickyHeadCell}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
            {!data && <SkelRows cols={5} />}
            {data && data.byCustomer.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                  No customers in scope.
                </td>
              </tr>
            )}
            {data?.byCustomer.map((c) => (
              <tr key={c.organizationId} className="bg-white dark:bg-brand-900">
                <td className="px-4 py-2.5 text-brand-800 dark:text-brand-200">{c.customer}</td>
                <td className="px-4 py-2.5 text-brand-600 dark:text-brand-400 tabular-nums">
                  {c.sitesUp}/{c.sites}
                </td>
                <td className="px-4 py-2.5 text-brand-600 dark:text-brand-400 tabular-nums">
                  {fmtCpu(c.cpuPct)}
                </td>
                <td className="px-4 py-2.5 text-brand-600 dark:text-brand-400 tabular-nums">
                  {fmtBytes(c.memBytes)}
                </td>
                <td className={`px-4 py-2.5 tabular-nums ${latencyTone(c.avgLatencyMs)}`}>
                  {fmtLatency(c.avgLatencyMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per site */}
      <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100 mb-3">
        Consumption per site
      </h2>
      <div className="rounded-lg border border-brand-200 dark:border-brand-700">
        <table className="w-full text-sm">
          <thead>
            <tr>
              {["Site", "Customer", "State", "Uptime", "CPU", "Memory", "Latency"].map(
                (col) => (
                  <th key={col} className={stickyHeadCell}>
                    {col}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
            {!data && <SkelRows cols={7} />}
            {data && data.sites.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-brand-400 dark:text-brand-500">
                  No sites in scope.
                </td>
              </tr>
            )}
            {data?.sites.map((s) => (
              <tr key={s.appId} className="bg-white dark:bg-brand-900 hover:bg-brand-50 dark:hover:bg-brand-800/50 transition-colors">
                <td className="px-4 py-2.5 text-brand-800 dark:text-brand-200" title={s.subdomain}>
                  {s.name}
                </td>
                <td className="px-4 py-2.5 text-brand-500 dark:text-brand-400">{s.customer ?? "—"}</td>
                <td className="px-4 py-2.5">
                  <UpDot up={s.up} />
                </td>
                <td className="px-4 py-2.5 text-brand-600 dark:text-brand-400 tabular-nums">
                  {fmtUptime(s.uptimeSeconds)}
                </td>
                <td className="px-4 py-2.5 text-brand-600 dark:text-brand-400 tabular-nums">
                  {fmtCpu(s.cpuPct)}
                </td>
                <td className="px-4 py-2.5 text-brand-600 dark:text-brand-400 tabular-nums">
                  {fmtBytes(s.memBytes)}
                  {s.memLimitBytes ? (
                    <span className="text-brand-400 dark:text-brand-500"> / {fmtBytes(s.memLimitBytes)}</span>
                  ) : null}
                </td>
                <td className={`px-4 py-2.5 tabular-nums ${latencyTone(s.latencyMs)}`}>
                  {fmtLatency(s.latencyMs)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-brand-400 dark:text-brand-500 mt-4">
        {data ? `Live snapshot at ${new Date(data.generatedAt).toLocaleTimeString()}. ` : ""}
        CPU and memory are read from the running containers; latency is measured through the proxy.
        Down sites report no usage.
      </p>
      <Drawer
        open={view !== null}
        title={view ? VIEW_TITLES[view] : ""}
        subtitle={system ? system.hostname : undefined}
        onClose={() => setView(null)}
      >
        {view && <ResourceDrawerBody view={view} system={system} data={data} users={users} />}
      </Drawer>
    </div>
  );
}
