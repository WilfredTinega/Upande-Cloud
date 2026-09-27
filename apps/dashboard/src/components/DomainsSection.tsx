import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import {
  appsApi,
  type CustomDomain,
  type DomainRRSet,
  type DomainStatus,
  type DomainTargetPayload,
} from "../lib/api";
import { useToast } from "../context/ToastContext";
import { Skeleton } from "./Skeleton";
import { Select } from "./Select";
import { ConfirmDialog } from "./ConfirmDialog";

function statusBadge(status: CustomDomain["status"]) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  switch (status) {
    case "verified":
      return `${base} bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300`;
    case "failed":
      return `${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`;
    default:
      return `${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300`;
  }
}

function DnsRow({ label, value, copy = true }: { label: string; value: string | null; copy?: boolean }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!value) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  }

  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-brand-500 dark:text-brand-400 shrink-0">{label}</span>
      <span className="flex items-center gap-2 min-w-0">
        {value ? (
          <code className="font-mono text-xs text-brand-800 dark:text-brand-200 break-all text-right">
            {value}
          </code>
        ) : (
          <span className="text-xs italic text-amber-700 dark:text-amber-400">not configured</span>
        )}
        {copy && value && (
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 text-[11px] px-1.5 py-0.5 rounded border border-brand-200 dark:border-brand-700 text-brand-500 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </span>
    </div>
  );
}

function StepTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-xs font-medium text-brand-600 dark:text-brand-400 mt-3 first:mt-0 mb-1 uppercase tracking-wide">
      {children}
    </p>
  );
}

function Callout({ tone, children }: { tone: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const tones = {
    info: "bg-brand-50 dark:bg-brand-800/40 text-brand-700 dark:text-brand-300",
    warn: "bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300",
    error: "bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300",
    ok: "bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-300",
  };
  return <div className={`mt-2 rounded px-3 py-2 text-xs break-words ${tones[tone]}`}>{children}</div>;
}

// The routing record: an A record at an apex, a CNAME to the app host otherwise.
function RouteRecord({ d }: { d: CustomDomain }) {
  const r = d.instructions.routeRecord;
  return (
    <>
      <DnsRow label="Host" value={r.host} />
      <DnsRow label="Type" value={r.type} copy={false} />
      <DnsRow label="Value" value={r.value} />
      <p className="mt-1 text-[11px] text-brand-400 dark:text-brand-500">
        {r.apex
          ? "This is the root (apex) of the domain. A CNAME isn't allowed there, so use an A record. Many DNS providers write this host as @."
          : 'Some DNS providers want only the part before your domain as the host (e.g. "app" for app.example.com).'}
      </p>
      {r.note && <Callout tone="warn">{r.note}</Callout>}
    </>
  );
}

// Outcome of the last Verify: what was queried, what was found, what was expected.
function LastCheck({ d }: { d: CustomDomain }) {
  const c = d.lastCheck;
  if (!c) return null;
  return (
    <div className="mt-3">
      {!c.ownership.ok && (
        <Callout tone="error">
          <p className="font-medium mb-1">Last verification failed</p>
          <p>{c.ownership.message}</p>
        </Callout>
      )}
      {c.autoRecord && (c.autoRecord.status === "created" || c.autoRecord.status === "exists") && (
        <Callout tone="ok">{c.autoRecord.message}</Callout>
      )}
      {c.warnings.map((w, i) => (
        <Callout key={i} tone="warn">
          {w}
        </Callout>
      ))}
      <p className="mt-1 text-[11px] text-brand-400 dark:text-brand-500">
        Last checked {new Date(c.checkedAt).toLocaleString()}
      </p>
    </div>
  );
}

// ---- Live status ----------------------------------------------------------------

const BADGE_BASE = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
const BADGE_TONE = {
  ok: "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300",
  warn: "bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300",
  error: "bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300",
  info: "bg-brand-100 dark:bg-brand-800 text-brand-700 dark:text-brand-300",
};

function publicAnswers(s: DomainStatus): string[] {
  return [
    ...s.public.cname.map((v) => `CNAME ${v}`),
    ...s.public.a.map((v) => `A ${v}`),
    ...s.public.aaaa.map((v) => `AAAA ${v}`),
  ];
}

function rrsetText(r: DomainRRSet): string {
  return `${r.type} ${r.records.join(", ")}`;
}

function statusBadgeFor(s: DomainStatus): { label: string; tone: keyof typeof BADGE_TONE } {
  switch (s.state) {
    case "live":
      return { label: "Live", tone: "ok" };
    case "not_delegated":
      return { label: "Platform record set, domain not delegated", tone: "warn" };
    case "points_elsewhere": {
      const vals = [...s.public.cname, ...s.public.a, ...s.public.aaaa];
      return { label: `Points elsewhere (${vals.slice(0, 2).join(", ")}${vals.length > 2 ? ", ..." : ""})`, tone: "warn" };
    }
    case "no_record":
      return { label: "No routing record", tone: "warn" };
    case "not_resolving":
      return { label: "Not resolving", tone: "error" };
    default:
      return { label: "Status unavailable", tone: "error" };
  }
}

function StatusRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-brand-500 dark:text-brand-400 shrink-0">{label}</span>
      <span className="text-xs text-brand-800 dark:text-brand-200 text-right break-all">{children}</span>
    </div>
  );
}

function LiveStatus({
  status,
  error,
  refreshing,
  onRefresh,
}: {
  status: DomainStatus | null;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  if (!status && !error) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-2 mt-1">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28 rounded-full" />
          <Skeleton className="h-6 w-16" />
        </div>
        <Skeleton className="h-3 w-5/6" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    );
  }
  const refreshBtn = (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      className="shrink-0 text-[11px] px-2 py-0.5 rounded border border-brand-200 dark:border-brand-700 text-brand-500 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
    >
      {refreshing ? "Checking..." : "Refresh"}
    </button>
  );
  if (!status) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
        {refreshBtn}
      </div>
    );
  }
  const badge = statusBadgeFor(status);
  const answers = publicAnswers(status);
  const customElsewhere = status.state === "live" && !status.pointsAtPlatform && status.platform !== null;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={`${BADGE_BASE} ${BADGE_TONE[badge.tone]}`}>{badge.label}</span>
          {customElsewhere && (
            <span className={`${BADGE_BASE} ${BADGE_TONE.info}`} title="The domain resolves to addresses other than this server">
              custom target
            </span>
          )}
        </span>
        {refreshBtn}
      </div>
      <p className="mt-1.5 text-xs text-brand-600 dark:text-brand-400 break-words">{status.message}</p>
      <div className="mt-1.5 divide-y divide-brand-100 dark:divide-brand-800">
        <StatusRow label="Public DNS">
          {answers.length ? answers.join(", ") : <span className="italic">nothing ({status.public.error ?? "no records"})</span>}
        </StatusRow>
        {status.platform && (
          <StatusRow label={`Platform DNS (${status.platform.zone})`}>
            {status.platform.error ? (
              <span className="text-red-600 dark:text-red-400">{status.platform.error}</span>
            ) : status.platform.rrsets.length ? (
              status.platform.rrsets.map(rrsetText).join("; ")
            ) : (
              <span className="italic">no A/AAAA/CNAME record</span>
            )}
          </StatusRow>
        )}
        {status.delegation && (
          <StatusRow label="Nameservers">
            <span className={status.delegation.ok ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}>
              {status.delegation.found.length ? status.delegation.found.join(", ") : "unknown"}
            </span>
            {!status.delegation.ok && (
              <span className="block text-brand-400 dark:text-brand-500">
                expected {status.delegation.expected.join(", ")}
              </span>
            )}
          </StatusRow>
        )}
      </div>
      <p className="mt-1 text-[11px] text-brand-400 dark:text-brand-500">
        Checked {new Date(status.checkedAt).toLocaleTimeString()} via a public resolver
        {status.cached ? " (cached)" : ""}
      </p>
    </div>
  );
}

// ---- Target editor (hosted zones) ----------------------------------------------

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// Loose IPv6 shape check; the API validates strictly.
const IPV6_RE = /^(?=.*:)[0-9a-fA-F:.]{2,45}$/;
const TTL_OPTIONS = [60, 300, 900, 1800, 3600, 14400, 86400];

function ttlLabel(t: number): string {
  if (t % 3600 === 0) return `${t / 3600} hour${t === 3600 ? "" : "s"}`;
  if (t % 60 === 0) return `${t / 60} min`;
  return `${t}s`;
}

const FIELD_CLS =
  "px-2 py-1.5 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-xs placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";

function TargetEditor({
  appId,
  d,
  status,
  onChanged,
}: {
  appId: string;
  d: CustomDomain;
  status: DomainStatus | null;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"platform" | "custom">("platform");
  const [type, setType] = useState<"A" | "AAAA">("A");
  const [ips, setIps] = useState("");
  const [ttl, setTtl] = useState(300);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; payload: DomainTargetPayload } | null>(null);

  // Prefill from what PowerDNS currently has, until the user starts editing.
  useEffect(() => {
    if (!status?.platform || dirty) return;
    const rrsets = status.platform.rrsets;
    if (status.targetMode === "custom") {
      const r = rrsets.find((x) => x.type === "A") ?? rrsets[0];
      setMode("custom");
      setType(r.type === "AAAA" ? "AAAA" : "A");
      setIps(r.records.join("\n"));
      setTtl(r.ttl);
    } else {
      setMode("platform");
      if (rrsets[0]) setTtl(rrsets[0].ttl);
    }
  }, [status, dirty]);

  const edit = <T,>(fn: (v: T) => void) => (v: T) => {
    setDirty(true);
    setFormError(null);
    fn(v);
  };

  async function submit(payload: DomainTargetPayload) {
    setSaving(true);
    try {
      const res = await appsApi.setDomainTarget(appId, d.id, payload);
      if (!res.ok) {
        setConfirm({ message: res.message, payload: { ...payload, confirmReplace: true } });
        return;
      }
      toast.success(res.message);
      setConfirm(null);
      setDirty(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update the DNS record");
    } finally {
      setSaving(false);
    }
  }

  function handleSave(e: FormEvent) {
    e.preventDefault();
    if (mode === "platform") {
      void submit({ mode: "platform", ttl });
      return;
    }
    const values = ips.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean);
    if (!values.length) {
      setFormError(`Enter at least one ${type === "A" ? "IPv4" : "IPv6"} address.`);
      return;
    }
    const re = type === "A" ? IPV4_RE : IPV6_RE;
    const bad = values.find((v) => !re.test(v));
    if (bad) {
      setFormError(`"${bad}" is not a valid ${type === "A" ? "IPv4" : "IPv6"} address.`);
      return;
    }
    if (values.length > 10) {
      setFormError("At most 10 addresses.");
      return;
    }
    void submit({ mode: "custom", type, values, ttl });
  }

  if (!status) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-8 w-full" />
      </div>
    );
  }

  const rrsets = status.platform?.rrsets ?? [];
  const expected = status.expected;
  const unmanaged = rrsets.filter((r) => !r.managed);

  return (
    <div>
      <p className="text-xs text-brand-500 dark:text-brand-400 mb-1">Current record in {status.platform?.zone ?? d.hostedZone}:</p>
      {rrsets.length ? (
        <ul className="mb-2">
          {rrsets.map((r) => (
            <li key={r.type} className="flex flex-wrap items-center justify-between gap-2 py-0.5">
              <code className="font-mono text-xs text-brand-800 dark:text-brand-200 break-all">
                {rrsetText(r)} <span className="text-brand-400 dark:text-brand-500">(TTL {r.ttl}s)</span>
              </code>
              <span className={`${BADGE_BASE} ${r.managed ? BADGE_TONE.info : BADGE_TONE.warn}`}>
                {r.managed ? "managed by the platform" : "not created by the platform"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs italic text-brand-400 dark:text-brand-500 mb-2">none</p>
      )}

      <form onSubmit={handleSave} className="flex flex-col gap-2">
        <label className="flex items-start gap-2 text-xs text-brand-700 dark:text-brand-300">
          <input
            type="radio"
            name={`target-${d.id}`}
            checked={mode === "platform"}
            onChange={() => edit(setMode)("platform")}
            disabled={!expected.value}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Point to the platform</span>{" "}
            {expected.value ? (
              <code className="font-mono text-brand-500 dark:text-brand-400">
                ({expected.type} {expected.value})
              </code>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">(unavailable: {expected.note ?? "no target configured"})</span>
            )}
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-brand-700 dark:text-brand-300">
          <input
            type="radio"
            name={`target-${d.id}`}
            checked={mode === "custom"}
            onChange={() => edit(setMode)("custom")}
            className="mt-0.5"
          />
          <span className="font-medium">Custom IP</span>
        </label>

        {mode === "custom" && (
          <div className="ml-5 flex flex-col gap-2">
            <div className="flex gap-2 items-start">
              <Select
                className={`${FIELD_CLS} w-24`}
                value={type}
                onChange={(e) => edit(setType)(e.target.value as "A" | "AAAA")}
                aria-label="Record type"
              >
                <option value="A">A (IPv4)</option>
                <option value="AAAA">AAAA (IPv6)</option>
              </Select>
              <textarea
                value={ips}
                onChange={(e) => edit(setIps)(e.target.value)}
                rows={Math.min(4, Math.max(2, ips.split("\n").length))}
                placeholder={type === "A" ? "203.0.113.10\n203.0.113.11" : "2001:db8::10"}
                aria-label="IP addresses, one per line"
                className={`${FIELD_CLS} flex-1 font-mono`}
              />
            </div>
            <p className="text-[11px] text-brand-400 dark:text-brand-500">
              One address per line (or comma-separated). Traffic only reaches this app if these addresses route to
              this server{status.serverIp ? ` (${status.serverIp})` : ""}, e.g. a load balancer or floating IP.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-brand-500 dark:text-brand-400" htmlFor={`ttl-${d.id}`}>
            TTL
          </label>
          <Select
            id={`ttl-${d.id}`}
            className={`${FIELD_CLS} w-28`}
            value={ttl}
            onChange={(e) => edit(setTtl)(Number(e.target.value))}
          >
            {(TTL_OPTIONS.includes(ttl) ? TTL_OPTIONS : [...TTL_OPTIONS, ttl].sort((a, b) => a - b)).map((t) => (
              <option key={t} value={t}>
                {ttlLabel(t)}
              </option>
            ))}
          </Select>
          <button
            type="submit"
            disabled={saving || (mode === "platform" && !expected.value)}
            className="ml-auto text-xs px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 font-medium hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save DNS target"}
          </button>
        </div>
        {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}
        {unmanaged.length > 0 && (
          <p className="text-[11px] text-amber-700 dark:text-amber-400">
            Saving replaces {unmanaged.map(rrsetText).join("; ")}, which the platform didn't create. You'll be asked to
            confirm.
          </p>
        )}
      </form>

      {confirm && (
        <ConfirmDialog
          title="Replace existing DNS record?"
          message={confirm.message}
          confirmLabel="Replace record"
          destructive
          busy={saving}
          onConfirm={() => void submit(confirm.payload)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

// ---- One domain ---------------------------------------------------------------

function DomainCard({
  appId,
  d,
  verifying,
  onVerify,
  onRemove,
  onChanged,
}: {
  appId: string;
  d: CustomDomain;
  verifying: boolean;
  onVerify: () => void;
  onRemove: () => void;
  onChanged: () => void;
}) {
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadStatus = useCallback(
    (refresh: boolean) => {
      setRefreshing(true);
      appsApi
        .domainStatus(appId, d.id, refresh)
        .then((s) => {
          setStatus(s);
          setStatusError(null);
        })
        .catch((err: unknown) => setStatusError(err instanceof Error ? err.message : "Failed to load DNS status"))
        .finally(() => setRefreshing(false));
    },
    [appId, d.id],
  );

  // Re-query whenever the domain's DNS state changes (verify, target change).
  const stateKey = `${d.status}|${d.autoRecord?.type ?? ""}|${d.autoRecord?.value ?? ""}|${d.lastCheck?.checkedAt ?? ""}|${d.hostedZone ?? ""}`;
  useEffect(() => loadStatus(false), [loadStatus, stateKey]);

  const hosted = d.ownershipMethod === "platform-dns";

  return (
    <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-brand-900 dark:text-brand-50">{d.domain}</span>
          <span className={statusBadge(d.status)}>{d.status}</span>
          {d.autoConfigured && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-brand-100 dark:bg-brand-800 text-brand-700 dark:text-brand-300">
              auto-configured
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onVerify}
            disabled={verifying}
            className={
              d.status === "verified"
                ? "text-xs px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 font-medium hover:bg-brand-100 dark:hover:bg-brand-700 disabled:opacity-50 transition-colors"
                : "text-xs px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 font-medium hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
            }
          >
            {verifying ? "Checking..." : d.status === "verified" ? "Re-check" : "Verify"}
          </button>
          <button
            onClick={onRemove}
            className="text-xs px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 font-medium hover:bg-brand-100 dark:hover:bg-brand-700 transition-colors"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-brand-100 dark:border-brand-800">
        <StepTitle>Live status</StepTitle>
        <LiveStatus status={status} error={statusError} refreshing={refreshing} onRefresh={() => loadStatus(true)} />

        {hosted ? (
          // Zone hosted here by this org: ownership proven, record managed from here.
          <>
            {d.autoConfigured ? (
              <p className="mt-3 text-xs text-brand-600 dark:text-brand-400">
                Verified automatically: <span className="font-medium">{d.hostedZone}</span> is a DNS zone hosted on
                this platform by your organization.
              </p>
            ) : (
              d.status !== "verified" && (
                <Callout tone="info">
                  <span className="font-medium">{d.hostedZone}</span> is hosted on this platform by your organization.
                  Click <span className="font-medium">Verify</span> (no TXT record needed) to create the default routing
                  record, or choose a target below.
                </Callout>
              )
            )}
            <StepTitle>DNS target</StepTitle>
            <TargetEditor appId={appId} d={d} status={status} onChanged={onChanged} />
          </>
        ) : (
          <>
            {d.status !== "verified" && (
              <>
                <StepTitle>1. Prove ownership (TXT record)</StepTitle>
                <DnsRow label="Host" value={d.instructions.txtRecord.host} />
                <DnsRow label="Type" value={d.instructions.txtRecord.type} copy={false} />
                <DnsRow label="Value" value={d.instructions.txtRecord.value} />
              </>
            )}
            <StepTitle>
              {d.status !== "verified" ? "2. " : ""}Point traffic at the app ({d.instructions.routeRecord.type} record)
            </StepTitle>
            <RouteRecord d={d} />
            <DnsRow label="Server IP" value={d.serverIp} />
            <p className="mt-1 text-[11px] text-brand-400 dark:text-brand-500">
              This domain's DNS is hosted elsewhere, so set the record at your DNS provider. To manage it here, host
              the zone on the DNS page.
            </p>
          </>
        )}

        <LastCheck d={d} />
        {d.status === "verified" && (
          <p className="mt-2 text-[11px] text-brand-400 dark:text-brand-500">
            Redeploy the app after verifying so its router picks up this domain.
          </p>
        )}
      </div>
    </div>
  );
}

export function DomainsSection({ appId }: { appId: string }) {
  const toast = useToast();
  const [domains, setDomains] = useState<CustomDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newDomain, setNewDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  function load() {
    appsApi
      .listDomains(appId)
      .then(({ domains: list }) => setDomains(list))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load domains"))
      .finally(() => setLoading(false));
  }

  useEffect(load, [appId]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const res = await appsApi.addDomain(appId, newDomain.trim());
      setNewDomain("");
      // Domains in a zone hosted here are verified + configured right away.
      if (res.message) (res.verified ? toast.success : toast.info)(res.message);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to add domain");
    } finally {
      setAdding(false);
    }
  }

  async function handleVerify(domainId: string) {
    setVerifyingId(domainId);
    try {
      const res = await appsApi.verifyDomain(appId, domainId);
      (res.verified ? toast.success : toast.error)(res.message);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleRemove(domainId: string) {
    try {
      const res = await appsApi.removeDomain(appId, domainId);
      if (res.message) toast.error(res.message);
      else if (res.recordRemoved) toast.success("Domain removed, along with the DNS record the platform created.");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove domain");
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50 mb-3">Custom domains</h2>

      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          type="text"
          required
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
          placeholder="app.yourdomain.com"
          className="flex-1 px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
        />
        <button
          type="submit"
          disabled={adding}
          className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
        >
          {adding ? "Adding..." : "Add domain"}
        </button>
      </form>

      {loading && (
        <div role="status" aria-label="Loading" className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-4 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-7 w-20" />
            </div>
          ))}
        </div>
      )}
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

      {!loading && !error && domains.length === 0 && (
        <p className="text-sm text-brand-400 dark:text-brand-500">No custom domains yet.</p>
      )}

      <div className="flex flex-col gap-3">
        {domains.map((d) => (
          <DomainCard
            key={d.id}
            appId={appId}
            d={d}
            verifying={verifyingId === d.id}
            onVerify={() => handleVerify(d.id)}
            onRemove={() => handleRemove(d.id)}
            onChanged={load}
          />
        ))}
      </div>
    </section>
  );
}
