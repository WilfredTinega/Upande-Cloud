import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { DeploymentLogModal } from "../components/DeploymentLogModal";
import { appsApi, githubApi } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { DomainsSection } from "../components/DomainsSection";
import { NodeRedUsersSection } from "../components/NodeRedUsersSection";
import { parseLog, StageRow } from "../components/DeployLog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DeploymentHistory } from "../components/DeploymentHistory";
import { ContainerStatusBadge } from "../components/ContainerStatusBadge";
import { HealthCheckSection } from "../components/HealthCheckSection";
import { UptimeSection } from "../components/UptimeSection";
import { PreviewsSection } from "../components/PreviewsSection";
import { GithubIntegrationSection } from "../components/GithubIntegrationSection";
import { EnvVarsSection } from "../components/EnvVarsSection";
import { Breadcrumbs, SectionCrumb, useSections } from "../components/Breadcrumbs";
import { FrameworkDetectCard } from "../components/FrameworkDetectCard";
import type { FrameworkDetection } from "../types";
import { DeployTiming } from "../components/DeployTiming";
import { playSuccessBeep, playFailureBeep } from "../lib/sound";
import type { App, Deployment, AppStatus, DeploymentHistoryItem } from "../types";
import { Select } from "../components/Select";
import { Skeleton, SkeletonCards, SkeletonLines } from "../components/Skeleton";

// ---- Status badges ----

function appStatusBadge(status: AppStatus) {
  const base = "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium";
  switch (status) {
    case "live":
      return `${base} bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300`;
    case "stopped":
    case "idle":
      return `${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`;
    case "failed":
      return `${base} bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300`;
    case "building":
      return `${base} bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300`;
    default:
      return `${base} bg-brand-100 dark:bg-brand-800 text-brand-600 dark:text-brand-400`;
  }
}

// ---- Uptime ----

// Human-readable elapsed time since the app last went live, e.g.
// "3d 4h", "5h 12m", "8m 3s", "42s". Returns null for non-positive spans.
function formatUptime(fromMs: number, nowMs: number): string | null {
  const sec = Math.floor((nowMs - fromMs) / 1000);
  if (sec < 0 || !Number.isFinite(sec)) return null;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---- Token section ----

interface TokenEntry {
  id: string;
  name: string;
  lastUsedAt?: string;
}

function TokensSection({ appId }: { appId: string }) {
  const toast = useToast();
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Create form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTokenName, setNewTokenName] = useState("");
  const [creating, setCreating] = useState(false);

  // Newly created plaintext token — shown once
  const [plaintextToken, setPlaintextToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    appsApi
      .listTokens(appId)
      .then(({ tokens: list }) => setTokens(list))
      .catch((err: unknown) =>
        setTokenError(err instanceof Error ? err.message : "Failed to load tokens")
      )
      .finally(() => setLoadingTokens(false));
  }, [appId]);

  async function handleCreateToken(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await appsApi.createToken(appId, newTokenName);
      setPlaintextToken(res.token);
      // Refresh token list
      const { tokens: updated } = await appsApi.listTokens(appId);
      setTokens(updated);
      setNewTokenName("");
      setShowCreateForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setCreating(false);
    }
  }

  function handleCopy() {
    if (!plaintextToken) return;
    navigator.clipboard.writeText(plaintextToken).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">Deploy Tokens</h2>
        {!showCreateForm && (
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-xs font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors"
          >
            Create Token
          </button>
        )}
      </div>

      {plaintextToken && (
        <div className="mb-4 p-4 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20">
          <p className="text-xs font-semibold text-green-800 dark:text-green-300 mb-2">
            Token created. Copy it now — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-xs bg-white dark:bg-brand-900 border border-green-200 dark:border-green-700 rounded px-3 py-2 text-brand-900 dark:text-brand-100 break-all">
              {plaintextToken}
            </code>
            <button
              onClick={handleCopy}
              className="flex-shrink-0 px-3 py-2 rounded border border-green-400 dark:border-green-600 text-green-700 dark:text-green-300 text-xs font-medium hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setPlaintextToken(null)}
            className="mt-2 text-xs text-green-600 dark:text-green-400 hover:underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {showCreateForm && (
        <form
          onSubmit={handleCreateToken}
          className="mb-4 p-4 rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800 flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="tokenName" className="text-xs font-medium text-brand-700 dark:text-brand-300">
              Token name
            </label>
            <input
              id="tokenName"
              type="text"
              required
              value={newTokenName}
              onChange={(e) => setNewTokenName(e.target.value)}
              className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
              placeholder="ci-deploy"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={creating}
              className="px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-xs font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loadingTokens && (
        <div role="status" aria-label="Loading" className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 rounded border border-brand-200 dark:border-brand-700 px-3 py-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
              <Skeleton className="ml-auto h-6 w-16" />
            </div>
          ))}
        </div>
      )}

      {tokenError && (
        <p className="text-sm text-red-500 dark:text-red-400">{tokenError}</p>
      )}

      {!loadingTokens && !tokenError && tokens.length === 0 && (
        <p className="text-sm text-brand-400 dark:text-brand-500">No deploy tokens yet.</p>
      )}

      {!loadingTokens && !tokenError && tokens.length > 0 && (
        <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-200 dark:border-brand-700">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider">Last used</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t, idx) => (
                <tr
                  key={t.id}
                  className={idx < tokens.length - 1 ? "border-b border-brand-100 dark:border-brand-800" : ""}
                >
                  <td className="px-4 py-2.5 font-medium text-brand-800 dark:text-brand-200">{t.name}</td>
                  <td className="px-4 py-2.5 text-brand-500 dark:text-brand-400 text-xs">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "Never"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- Log viewer ----
//
// The structured deploy-log model + StageRow now live in components/DeployLog,
// shared with the error-analysis pages.

// `reloadKey` changes whenever the parent triggers a new deploy/migrate; the
// viewer then reconnects to stream the new (now-latest) deployment from the
// start — so hitting Deploy makes the GitHub clone + build appear automatically.
function LogViewer({
  appId,
  reloadKey,
  onFinished,
  canShowRuntime = false,
}: {
  appId: string;
  reloadKey: number;
  onFinished?: () => void;
  // Whether the "Runtime logs" toggle is offered (the app has been deployed, so
  // there may be a running container to read logs from).
  canShowRuntime?: boolean;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [finished, setFinished] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  // Runtime-logs mode: instead of the deploy-stage log, show the running
  // container's own stdout/stderr (polled). Toggled from the panel header.
  const [showRuntime, setShowRuntime] = useState(false);
  const [runtimeLines, setRuntimeLines] = useState<string[] | null>(null);
  const [runtimeRunning, setRuntimeRunning] = useState(true);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  // Bumped by the Refresh button to force an immediate re-fetch of runtime logs.
  const [runtimeReload, setRuntimeReload] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether we should keep pinning to the bottom as new lines arrive. Set false
  // the moment the user scrolls up, restored when they scroll back to bottom.
  const stickToBottom = useRef(true);
  // Set right before we programmatically pin to the bottom, so the scroll event
  // that fires as a result isn't misread as the user scrolling away.
  const programmaticScroll = useRef(false);
  const esRef = useRef<EventSource | null>(null);
  const doneRef = useRef(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror of the streamed lines so the @end handler can inspect the final
  // state (did any stage fail?) without depending on async state updates.
  const linesRef = useRef<string[]>([]);
  // Only beep on completion when this stream was started by a user-triggered
  // deploy/migrate (reloadKey bumped), not the passive replay on page load —
  // otherwise every visit to a finished app would chime.
  const beepArmed = useRef(false);

  const connect = useCallback(() => {
    if (retryRef.current) clearTimeout(retryRef.current);
    if (esRef.current) esRef.current.close();
    setLines([]);
    linesRef.current = [];
    setConnected(false);
    setFinished(false);
    doneRef.current = false;

    const open = async () => {
      let es: EventSource;
      try {
        es = await appsApi.getLogs(appId);
      } catch {
        // No stream ticket (offline / signed out): retry unless finished.
        if (!doneRef.current) retryRef.current = setTimeout(() => void open(), 3000);
        return;
      }
      if (doneRef.current) {
        es.close();
        return;
      }
      if (esRef.current) esRef.current.close();
      esRef.current = es;

      es.onopen = () => {
        failures = 0;
        setConnected(true);
      };

      const appendLine = (e: MessageEvent) => {
        const data = e.data as string;
        // `@end` is the server's end-of-stream sentinel: the deployment reached
        // a terminal state. Stop here and do NOT auto-reconnect.
        if (data === "@end") {
          doneRef.current = true;
          setFinished(true);
          setConnected(false);
          es.close();
          // Audible cue (only for user-triggered deploys): a failed stage
          // anywhere in the log means the deploy didn't go live; otherwise it
          // succeeded.
          if (beepArmed.current) {
            beepArmed.current = false;
            const failed = parseLog(linesRef.current).stages.some(
              (s) => s.state === "failed",
            );
            if (failed) playFailureBeep();
            else playSuccessBeep();
          }
          onFinished?.(); // let the parent refresh status + deployments
          return;
        }
        linesRef.current = [...linesRef.current, data];
        setLines((prev) => [...prev, data]);
      };

      // Default (unnamed) SSE events arrive via onmessage. Also listen for a
      // named "log" event so this works regardless of how the server tags it.
      es.onmessage = appendLine;
      es.addEventListener("log", appendLine as EventListener);

      es.onerror = () => {
        setConnected(false);
        es.close();
        // The connection dropped mid-stream (proxy timeout, network blip). If
        // the deploy isn't done, reconnect shortly — the server replays the
        // full backlog, so we just reset and resync rather than freezing on
        // "Connecting…". This is the fix for the log getting stuck.
        // Exponential backoff (1.5s → 30s) so a stream that keeps failing
        // (deleted app, expired session) doesn't hammer the API.
        if (!doneRef.current) {
          const delay = Math.min(1500 * 2 ** failures, 30000);
          failures += 1;
          retryRef.current = setTimeout(() => {
            setLines([]);
            void open();
          }, delay);
        }
      };
    };

    let failures = 0;
    void open();
  }, [appId, onFinished]);

  // Reconnect on mount, when the app changes, and whenever reloadKey bumps
  // (i.e. a new deploy/migrate was triggered) so the stream follows the new build.
  // reloadKey > 0 means this reconnect came from a user-triggered deploy/migrate,
  // so arm the completion beep; the initial mount (reloadKey === 0) stays silent.
  useEffect(() => {
    if (reloadKey > 0) beepArmed.current = true;
    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      esRef.current?.close();
    };
  }, [connect, reloadKey]);

  // Runtime logs: poll the running container's stdout/stderr while the toggle
  // is on, refreshing every few seconds so new output appears live.
  useEffect(() => {
    if (!showRuntime) return;
    let cancelled = false;
    const fetchLogs = async () => {
      setRuntimeLoading(true);
      try {
        const { running, lines: rl } = await appsApi.runtimeLogs(appId);
        if (cancelled) return;
        setRuntimeRunning(running);
        setRuntimeLines(rl);
      } catch {
        // Transient (e.g. container restarting) — keep the last snapshot.
      } finally {
        if (!cancelled) setRuntimeLoading(false);
      }
    };
    void fetchLogs();
    const handle = setInterval(() => void fetchLogs(), 4000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [showRuntime, appId, runtimeReload]);

  // Auto-scroll: keep the log pinned to the bottom only while the user hasn't
  // scrolled up. Scroll the container itself (instant) instead of
  // scrollIntoView — the latter scrolls every ancestor and, with "smooth",
  // stacks animations on each new line, which made the page jump up and down.
  useEffect(() => {
    if (!stickToBottom.current) return;
    // Pin after the browser has laid out the new content. StageRow rows expand /
    // collapse and grow as lines stream in, so the final scrollHeight isn't
    // known until layout settles — a rAF guarantees we measure post-layout and
    // the latest line stays in view.
    const raf = requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el && stickToBottom.current) {
        // Mark this as a programmatic scroll so the resulting scroll event
        // doesn't get mistaken for the user scrolling away (see handleScroll).
        programmaticScroll.current = true;
        el.scrollTop = el.scrollHeight;
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [lines, showDebug, runtimeLines, showRuntime]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // When content grows, the browser keeps the old scrollTop and fires a
    // scroll event — that's NOT the user scrolling away. Ignore our own
    // programmatic pin, and treat the rare layout-growth event as still pinned
    // so we never latch stickToBottom=false behind the user's back. Only a
    // genuine upward scroll (user gesture) should detach us from the bottom.
    if (programmaticScroll.current) {
      programmaticScroll.current = false;
      return;
    }
    // Within 40px of the bottom counts as "at the bottom".
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    stickToBottom.current = atBottom;
  }, []);

  const { preamble, stages } = parseLog(lines);
  const visiblePreamble = preamble.filter((b) => showDebug || !b.debug);

  return (
    <section className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-3 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">
            {showRuntime ? "Runtime logs" : "Deploy log"}
          </h2>
          {showRuntime ? (
            <>
              <span
                className={[
                  "w-2 h-2 rounded-full",
                  runtimeRunning ? "bg-green-400 animate-pulse" : "bg-brand-400",
                ].join(" ")}
                title={runtimeRunning ? "Live container output" : "No running container"}
              />
              <span className="text-xs text-brand-400 dark:text-brand-500">
                {runtimeRunning
                  ? runtimeLoading
                    ? "Refreshing…"
                    : "Live"
                  : "Not running"}
              </span>
            </>
          ) : (
            <>
              <span
                className={[
                  "w-2 h-2 rounded-full",
                  finished ? "bg-brand-400" : connected ? "bg-green-400 animate-pulse" : "bg-yellow-400",
                ].join(" ")}
                title={finished ? "Finished" : connected ? "Streaming" : "Reconnecting"}
              />
              <span className="text-xs text-brand-400 dark:text-brand-500">
                {finished ? "Finished" : connected ? "Live" : "Reconnecting…"}
              </span>
            </>
          )}
        </div>
        <div className="flex gap-2">
          {canShowRuntime && (
            <button
              onClick={() => setShowRuntime((r) => !r)}
              className={[
                "px-3 py-1.5 rounded border text-xs font-medium transition-colors",
                showRuntime
                  ? "border-brand-500 text-brand-700 dark:text-brand-200 bg-brand-100 dark:bg-brand-800"
                  : "border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-800",
              ].join(" ")}
              title="Show the running container's own logs (live app output)"
            >
              {showRuntime ? "Show deploy log" : "Show runtime logs"}
            </button>
          )}
          {showRuntime ? (
            <button
              onClick={() => setRuntimeReload((n) => n + 1)}
              disabled={runtimeLoading}
              className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
            >
              {runtimeLoading ? "Refreshing…" : "Refresh"}
            </button>
          ) : (
            <>
              <button
                onClick={() => setShowDebug((d) => !d)}
                className={[
                  "px-3 py-1.5 rounded border text-xs font-medium transition-colors",
                  showDebug
                    ? "border-brand-500 text-brand-700 dark:text-brand-200 bg-brand-100 dark:bg-brand-800"
                    : "border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 hover:bg-brand-50 dark:hover:bg-brand-800",
                ].join(" ")}
              >
                {showDebug ? "Hide debug" : "Show debug"}
              </button>
              <button
                onClick={connect}
                className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
              >
                Reconnect
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 rounded-lg bg-brand-950 border border-brand-800 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto scrollbar-hide p-4 font-mono text-xs leading-relaxed"
        >
          {showRuntime ? (
            runtimeLines === null ? (
              <SkeletonLines lines={8} className="[&>div]:h-3 [&>div]:bg-brand-800" />
            ) : !runtimeRunning ? (
              <span className="text-brand-500">
                No running container — deploy the app to start it, then its runtime
                logs will appear here.
              </span>
            ) : runtimeLines.length === 0 ? (
              <span className="text-brand-500">No runtime output yet.</span>
            ) : (
              <pre className="text-brand-300 whitespace-pre-wrap break-all">
                {runtimeLines.join("\n")}
              </pre>
            )
          ) : lines.length === 0 ? (
            <span className="text-brand-500">
              {connected ? "Waiting for log output..." : "Connecting..."}
            </span>
          ) : (
            <>
              {visiblePreamble.map((b, i) => (
                <div
                  key={`p-${i}`}
                  className={[
                    "flex gap-2 whitespace-pre-wrap break-all",
                    b.debug ? "text-brand-500" : "text-brand-300",
                  ].join(" ")}
                >
                  <span className="text-brand-600 tabular-nums shrink-0 w-[4.5rem]">
                    {b.ts ?? ""}
                  </span>
                  <span className="min-w-0">{b.text}</span>
                </div>
              ))}
              {visiblePreamble.length > 0 && stages.length > 0 && <div className="h-2" />}
              {stages.map((s, i) => (
                <StageRow key={`s-${i}-${s.name}`} stage={s} showDebug={showDebug} />
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ---- Main page ----

type EditableAppType = "static" | "node" | "fullstack";

// Shown under the Type picker so the effect of switching is clear up front.
const APP_TYPE_HELP: Record<EditableAppType, string> = {
  static: "Builds the site and serves the output folder with a web server. No database.",
  node: "Runs your Node.js server (npm start). No managed database.",
  fullstack: "Runs your server and gives it a managed PostgreSQL database via DATABASE_URL.",
};

interface EditForm {
  type: EditableAppType;
  name: string;
  repoUrl: string;
  branch: string;
  buildCmd: string;
  outputDir: string;
}

export function AppDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const appId = id ?? "";
  // ?deployment=<id> (GitHub commit-status / PR-comment links) opens that
  // deployment's log.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedDeploymentId = searchParams.get("deployment");
  const [linkedDeployment, setLinkedDeployment] = useState<DeploymentHistoryItem | null>(null);
  useEffect(() => {
    setLinkedDeployment(null);
    if (!linkedDeploymentId || !appId) return;
    appsApi
      .listDeployments(appId, { take: 50 })
      .then((r) => setLinkedDeployment(r.deployments.find((d) => d.id === linkedDeploymentId) ?? null))
      .catch(() => undefined);
  }, [appId, linkedDeploymentId]);

  const [app, setApp] = useState<App | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [loading, setLoading] = useState(true);
  // Breadcrumbs: sections of the scrollable left column (data-crumb markers).
  const detailsRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  const [deploying, setDeploying] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // Confirmation gates for disruptive actions (stop takes the site offline;
  // migrate forces a full rebuild). Delete has its own type-the-name modal.
  const [confirmStop, setConfirmStop] = useState(false);
  const [confirmMigrate, setConfirmMigrate] = useState(false);
  // "Clear build cache & redeploy" (per-app cache; size shown in the dialog).
  const [confirmClearCache, setConfirmClearCache] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  // Bumped after a deploy/migrate so the LogViewer reconnects and streams the
  // new build automatically.
  const [logReload, setLogReload] = useState(0);

  // Edit
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [saving, setSaving] = useState(false);
  // Branches fetched (via ls-remote) for the edit form's repo URL.
  const [editBranches, setEditBranches] = useState<string[]>([]);
  const [editBranchesLoading, setEditBranchesLoading] = useState(false);
  const [editBranchesError, setEditBranchesError] = useState<string | null>(null);
  const { sections, current: currentSection, scrollTo: scrollToSection } = useSections(detailsRef, [
    app?.id,
    app?.type,
    app?.githubRepoFullName,
    loading,
    editing,
  ]);
  // Framework detection of the app's source (Configuration → Detect framework).
  const [fw, setFw] = useState<{ detection: FrameworkDetection; warnings: string[] } | null>(null);
  const [fwLoading, setFwLoading] = useState(false);
  const [fwError, setFwError] = useState<string | null>(null);

  // Auto-fetch branches while editing, debounced, whenever the repo URL changes.
  // No manual button — selecting/typing a URL refreshes the Branch dropdown.
  const editRepoUrl = editForm?.repoUrl.trim() ?? "";
  useEffect(() => {
    if (!editing || !editRepoUrl) {
      setEditBranches([]);
      setEditBranchesError(null);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      setEditBranchesLoading(true);
      setEditBranchesError(null);
      githubApi
        .listRemoteBranches(editRepoUrl)
        .then(({ branches }) => {
          if (cancelled) return;
          setEditBranches(branches);
          if (branches.length === 0) {
            setEditBranchesError("No branches found");
            return;
          }
          // Keep the current branch if still valid, else select the first.
          setEditForm((prev) =>
            prev
              ? { ...prev, branch: branches.includes(prev.branch) ? prev.branch : branches[0] }
              : prev,
          );
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setEditBranches([]);
          setEditBranchesError(
            err instanceof Error ? err.message : "Failed to fetch branches",
          );
        })
        .finally(() => {
          if (!cancelled) setEditBranchesLoading(false);
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [editing, editRepoUrl]);

  // Delete
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // The admin must type the site name to confirm deletion (GitHub-style guard).
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // Reset the typed confirmation whenever the modal opens or closes.
  useEffect(() => {
    setDeleteConfirmText("");
  }, [confirmDelete]);

  // Close the delete modal on Escape (standard modal affordance).
  useEffect(() => {
    if (!confirmDelete) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) setConfirmDelete(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmDelete, deleting]);

  // Ticking clock so the "uptime since last deploy" counter updates live.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // The app currently shown: a slow response for a previous app (quick
  // navigation between apps) must not overwrite it.
  const currentAppId = useRef(appId);
  currentAppId.current = appId;
  const fetchApp = useCallback(() => {
    const requested = appId;
    return appsApi
      .get(requested)
      .then(({ app: fetchedApp, deployments: fetchedDeps }) => {
        if (currentAppId.current !== requested) return;
        setApp(fetchedApp);
        setDeployments(fetchedDeps);
        setError(null);
      })
      .catch((err: unknown) => {
        if (currentAppId.current !== requested) return;
        setError(err instanceof Error ? err.message : "Failed to load app");
      })
      .finally(() => {
        if (currentAppId.current === requested) setLoading(false);
      });
  }, [appId]);

  // Switching apps: show the loading state instead of the previous app.
  const shownAppId = useRef(appId);
  useEffect(() => {
    if (shownAppId.current !== appId) {
      shownAppId.current = appId;
      setApp(null);
      setDeployments([]);
      setError(null);
      setLoading(true);
    }
    void fetchApp();
  }, [fetchApp, appId]);

  // Sign into the deployed app as its administrator. We open the destination tab
  // synchronously (inside the click) so the browser doesn't treat it as a popup,
  // then point it at the app's login page once the API responds.
  async function handleAdminLogin() {
    const tab = window.open("", "_blank");
    try {
      const info = await appsApi.adminLogin(appId);
      if (!tab) {
        // Popup blocked — fall back to navigating the current tab.
        window.location.assign(info.redirectUrl);
        return;
      }
      tab.location.assign(info.redirectUrl);
    } catch (err) {
      tab?.close();
      toast.error(err instanceof Error ? err.message : "Admin login failed");
    }
  }

  async function handleDeploy() {
    setDeploying(true);
    try {
      await appsApi.deploy(appId);
      setLogReload((k) => k + 1); // start streaming the new build's log
      await fetchApp();
      toast.success("Deployment started — watch the log for progress.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }

  async function handleMigrate() {
    setMigrating(true);
    try {
      await appsApi.migrate(appId);
      setConfirmMigrate(false);
      setLogReload((k) => k + 1); // start streaming the new build's log
      await fetchApp();
      toast.success("Migrate started — watch the log for progress.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Migrate failed");
    } finally {
      setMigrating(false);
    }
  }

  async function openClearCache() {
    setCacheSize(null);
    setConfirmClearCache(true);
    try {
      const c = await appsApi.buildCache(appId);
      setCacheSize(c.sizeBytes);
    } catch {
      /* size is informational only */
    }
  }

  async function handleClearCache() {
    setClearingCache(true);
    try {
      await appsApi.deploy(appId, { clearCache: true });
      setConfirmClearCache(false);
      setLogReload((k) => k + 1);
      await fetchApp();
      toast.success("Build cache cleared — clean redeploy started.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Clear cache failed");
    } finally {
      setClearingCache(false);
    }
  }

  async function handleStop() {
    setStopping(true);
    try {
      await appsApi.stop(appId);
      setConfirmStop(false);
      await fetchApp();
      toast.success("App stopped.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Stop failed");
    } finally {
      setStopping(false);
    }
  }

  // Cancel a stuck/in-progress build: stops the retrying deploy job, tears down
  // the build containers, and resets the app to "stopped" so the action buttons
  // reappear.
  async function handleCancel() {
    setCancelling(true);
    try {
      await appsApi.cancel(appId);
      await fetchApp();
      toast.success("Build cancelled.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  // Restart the running instance in place (no rebuild). Used for Node-RED to
  // reload settings.js + flows from the persistent volume.
  async function handleRestart() {
    setRestarting(true);
    try {
      await appsApi.restart(appId);
      await fetchApp();
      toast.success("Instance restarted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Restart failed");
    } finally {
      setRestarting(false);
    }
  }

  async function detectFramework() {
    if (!app) return;
    setFwLoading(true);
    setFwError(null);
    try {
      const res = await appsApi.detectAppFramework(app.id);
      setFw({ detection: res.detection, warnings: res.warnings });
    } catch (err) {
      setFw(null);
      setFwError(err instanceof Error ? err.message : "Couldn't detect the framework");
    } finally {
      setFwLoading(false);
    }
  }

  // Open the edit form with the detected type / output dir filled in.
  function applyDetection() {
    if (!app || !fw) return;
    const d = fw.detection;
    startEdit();
    setEditForm((prev) =>
      prev
        ? {
            ...prev,
            type: d.hasDockerfile && prev.type !== "static" ? prev.type : d.type,
            outputDir: d.type === "static" && d.outputDir ? d.outputDir : prev.outputDir,
          }
        : prev,
    );
  }

  function startEdit() {
    if (!app) return;
    setEditForm({
      type: app.type === "nodered" ? "static" : app.type,
      name: app.name,
      repoUrl: app.repoUrl ?? "",
      branch: app.branch ?? "",
      buildCmd: app.buildCmd ?? "",
      outputDir: app.outputDir ?? "",
    });
    setEditing(true);
    // Reset any branches fetched in a prior edit session.
    setEditBranches([]);
    setEditBranchesError(null);
  }

  async function handleSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editForm) return;
    setSaving(true);
    try {
      const typeChanged = editForm.type !== app?.type;
      const res = await appsApi.update(appId, {
        ...(typeChanged ? { type: editForm.type } : {}),
        name: editForm.name,
        repoUrl: editForm.repoUrl,
        branch: editForm.branch,
        buildCmd: editForm.buildCmd,
        outputDir: editForm.outputDir,
      });
      await fetchApp();
      setEditing(false);
      setEditForm(null);
      if (res.redeployRequired) {
        toast.success(`App type changed to ${editForm.type}. Redeploy to apply it.`);
      } else {
        toast.success("Changes saved.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    // Guard: the typed name must exactly match the app name.
    if (!app || deleteConfirmText !== app.name) return;
    setDeleting(true);
    try {
      await appsApi.remove(appId);
      toast.success(`${app.name} deleted.`);
      navigate("/apps");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (loading) {
    // Mirrors the real layout: header bar, details column, logs column.
    return (
      <div role="status" aria-label="Loading" className="flex flex-col h-full -m-6">
        <div className="shrink-0 px-6 py-4 bg-white dark:bg-brand-950 border-b border-brand-200 dark:border-brand-700">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <Skeleton className="h-3 w-56" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-28" />
              <Skeleton className="h-8 w-44" />
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          <div className="flex-1 min-w-0 p-6 flex flex-col gap-6">
            <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-5 grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-4 w-3/4" />
                </div>
              ))}
            </div>
            <SkeletonCards count={2} className="grid gap-4" cardClassName="h-32" />
          </div>
          <div className="lg:w-[45%] p-6 lg:pl-0">
            <div className="h-full min-h-[16rem] rounded-lg bg-brand-950 border border-brand-800 p-4">
              <SkeletonLines lines={10} className="[&>div]:h-3 [&>div]:bg-brand-800" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !app) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-4 py-3 border border-red-200 dark:border-red-800">
        {error ?? "App not found"}
      </p>
    );
  }

  // Uptime since the last successful deploy. Deployments arrive newest-first,
  // so the first "live" one is the deploy currently serving. Only meaningful
  // while the app itself is live (not stopped/failed/building).
  const lastLiveDeploy =
    app.status === "live"
      ? deployments.find((d) => d.status === "live")
      : undefined;
  const uptime = lastLiveDeploy
    ? formatUptime(new Date(lastLiveDeploy.createdAt).getTime(), now)
    : null;

  return (
    <div className="flex flex-col h-full -m-6">
      {/* App info — fixed header bar */}
      <div className="shrink-0 px-6 py-4 bg-white dark:bg-brand-950 border-b border-brand-200 dark:border-brand-700">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Breadcrumbs
              className="mb-1.5"
              items={[
                { label: "Apps", to: "/apps" },
                { label: app.name, onClick: () => scrollToSection(null) },
                {
                  label: "",
                  render: (
                    <SectionCrumb sections={sections} current={currentSection} onSelect={scrollToSection} />
                  ),
                },
              ]}
            />
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-brand-900 dark:text-brand-50">{app.name}</h1>
              <span className={appStatusBadge(app.status)}>{app.status}</span>
              <ContainerStatusBadge appId={appId} reloadKey={app.status} />
              {uptime && (
                <span
                  className="text-xs text-brand-500 dark:text-brand-400 tabular-nums"
                  title={`Live since ${new Date(lastLiveDeploy!.createdAt).toLocaleString()}`}
                >
                  up {uptime}
                </span>
              )}
            </div>
            {app.createdAt ? (
              <p className="mt-1 text-xs text-brand-500 dark:text-brand-400">
                Created {new Date(app.createdAt).toLocaleString()}
                {app.createdBy ? ` by ${app.createdBy}` : ""}
              </p>
            ) : (
              <p className="mt-1 text-xs text-brand-500 dark:text-brand-400 font-mono">{app.subdomain}</p>
            )}
          </div>

          {app.url && (
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={app.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors"
              >
                Access site
              </a>
              <button
                type="button"
                onClick={handleAdminLogin}
                className="inline-flex items-center px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-200 text-sm font-semibold hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
              >
                Login as administrator
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Two-column body: scrollable details on the left, fixed live logs on the right */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Left column — scrolls independently */}
        <div ref={detailsRef} className="flex-1 min-w-0 overflow-y-auto scrollbar-hide p-6">

      {app.type !== "nodered" && <div id="sec-config" data-crumb="Configuration" aria-hidden="true" />}
      {/* App detail fields / edit form. Node-RED runs the official image with no
          source repo or build, so its repo/branch/build/output fields are
          meaningless — hide the whole Configuration block for it. */}
      {app.type !== "nodered" &&
        (editing && editForm ? (
        <form
          onSubmit={handleSaveEdit}
          className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-5 flex flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="edit-type"
              className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider"
            >
              App type
            </label>
            <Select
              id="edit-type"
              value={editForm.type}
              disabled={app.status === "building"}
              onChange={(e) =>
                setEditForm((prev) =>
                  prev ? { ...prev, type: e.target.value as EditableAppType } : prev,
                )
              }
              className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
            >
              <option value="static">Static site</option>
              <option value="node">Node.js server</option>
              <option value="fullstack">Full-stack (server + database)</option>
            </Select>
            <p className="text-xs text-brand-500 dark:text-brand-400">{APP_TYPE_HELP[editForm.type]}</p>
            {editForm.type !== app.type && (
              <p className="text-xs rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 px-3 py-2">
                {app.type === "fullstack"
                  ? "Switching away from full-stack stops passing DATABASE_URL to the app. The database and its data are kept, but the app won't be connected to it."
                  : editForm.type === "fullstack"
                    ? "A managed PostgreSQL database will be created on the next deploy and passed to the app as DATABASE_URL."
                    : "The build changes on the next deploy."}{" "}
                The change takes effect when you redeploy.
              </p>
            )}
          </div>
          {(
            [
              ["name", "Name"],
              ["repoUrl", "Repository URL"],
              ["branch", "Branch"],
              ["buildCmd", "Build command"],
              ["outputDir", "Output dir"],
            ] as Array<[keyof EditForm, string]>
          ).map(([field, label]) => {
            const inputClass =
              "px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm font-mono placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";
            return (
              <div key={field} className="flex flex-col gap-1.5">
                <label
                  htmlFor={`edit-${field}`}
                  className="text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider"
                >
                  {label}
                </label>
                {field === "branch" ? (
                  // Branch is driven by the auto-fetched list (see effect above).
                  // Falls back to a text input until branches load / if none.
                  <>
                    {editBranches.length > 0 ? (
                      <Select
                        id="edit-branch"
                        value={editForm.branch}
                        onChange={(e) =>
                          setEditForm((prev) =>
                            prev ? { ...prev, branch: e.target.value } : prev,
                          )
                        }
                        className={inputClass}
                      >
                        {editBranches.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <input
                        id="edit-branch"
                        type="text"
                        value={editForm.branch}
                        onChange={(e) =>
                          setEditForm((prev) =>
                            prev ? { ...prev, branch: e.target.value } : prev,
                          )
                        }
                        className={inputClass}
                      />
                    )}
                    {editBranchesLoading && <Skeleton className="h-3 w-40" />}
                    {editBranchesError && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        {editBranchesError}
                      </p>
                    )}
                  </>
                ) : (
                  <input
                    id={`edit-${field}`}
                    type="text"
                    value={editForm[field]}
                    onChange={(e) =>
                      setEditForm((prev) =>
                        prev ? { ...prev, [field]: e.target.value } : prev,
                      )
                    }
                    className={inputClass}
                  />
                )}
              </div>
            );
          })}
          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setEditForm(null);
              }}
              className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">Configuration</h2>
          <div className="flex gap-2">
          {(
            <button
              onClick={() => void detectFramework()}
              disabled={fwLoading}
              className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
            >
              {fwLoading ? "Detecting…" : "Detect framework"}
            </button>
          )}
          <button
            onClick={startEdit}
            className="px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
          >
            Edit
          </button>
          </div>
        </div>
        {(fwLoading || fw || fwError) && (
          <div className="mb-3">
            <FrameworkDetectCard
              detection={fw?.detection ?? null}
              loading={fwLoading}
              error={fwError}
              warnings={fw?.warnings}
              onApply={fw && fw.warnings.length ? applyDetection : undefined}
              applyLabel="Apply suggested settings"
            />
          </div>
        )}
        <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 p-5 grid grid-cols-2 gap-x-8 gap-y-3">
          {app.url && (
            <div className="col-span-2">
              <dt className="text-xs font-semibold text-brand-400 dark:text-brand-500 uppercase tracking-wider mb-0.5">
                URL
              </dt>
              <dd className="text-sm font-mono break-all">
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-700 dark:text-brand-300 hover:underline"
                >
                  {app.url}
                </a>
              </dd>
            </div>
          )}
          {[
            ["Type", app.type],
            ["Source", app.source],
            ["Repository", app.repoUrl ?? "—"],
            ["Branch", app.branch ?? "—"],
            ["Build command", app.buildCmd ?? "—"],
            ["Output dir", app.outputDir ?? "—"],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-semibold text-brand-400 dark:text-brand-500 uppercase tracking-wider mb-0.5">
                {label}
              </dt>
              <dd className="text-sm text-brand-800 dark:text-brand-200 font-mono break-all">
                {value}
              </dd>
            </div>
          ))}
        </div>
        </section>
        ))}

      <div id="sec-deployments" data-crumb="Deployments" aria-hidden="true" />
      {/* Deployments */}
      <section className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">Deployments</h2>
            <DeployTiming
              appId={appId}
              reloadKey={deployments.map((d) => `${d.id}:${d.status}`).join(",")}
            />
          </div>
          {/* While a build is in progress, the Deploy / Migrate / Restart /
              Stop actions don't apply yet — but a build can hang, so we always offer Cancel as an escape hatch: it drops
              the retrying deploy job, kills the build, and resets the app. */}
          {app.status === "building" ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-brand-400 dark:text-brand-500">Building — actions available when finished.</span>
              <button
                onClick={handleCancel}
                disabled={cancelling}
                title="Cancel this build. Stops the retrying deploy job, tears down the build, and resets the app to stopped."
                className="px-4 py-2 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {cancelling ? "Cancelling..." : "Cancel build"}
              </button>
            </div>
          ) : (
          <div className="flex gap-2">
            <button
              onClick={handleDeploy}
              disabled={deploying || migrating || stopping || restarting}
              title={
                app.type === "nodered"
                  ? "Re-pull the Node-RED image and apply the current editor accounts."
                  : undefined
              }
              className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {deploying ? "Deploying..." : "Deploy"}
            </button>
            {/* Node-RED has no source build, so Migrate (clean rebuild) doesn't
                apply — offer Restart instead, which reloads settings.js + flows
                from the persistent volume in place. */}
            {app.type === "nodered" ? (
              <button
                onClick={handleRestart}
                disabled={deploying || migrating || stopping || restarting}
                title="Restart the Node-RED instance in place — reloads settings.js and flows without a rebuild."
                className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {restarting ? "Restarting..." : "Restart"}
              </button>
            ) : (
              <button
                onClick={() => setConfirmMigrate(true)}
                disabled={deploying || migrating || stopping || restarting}
                title="Force a clean rebuild and redeploy. If it fails, the previous version is restored automatically — the site stays up."
                className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {migrating ? "Migrating..." : "Migrate"}
              </button>
            )}
            {app.type !== "nodered" && (
              <button
                onClick={() => void openClearCache()}
                disabled={deploying || migrating || stopping || restarting || clearingCache}
                title="Delete this app's build cache (cached dependencies and framework caches) and redeploy from scratch."
                className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {clearingCache ? "Clearing..." : "Clear cache & redeploy"}
              </button>
            )}
            <button
              onClick={() => setConfirmStop(true)}
              disabled={deploying || migrating || stopping || restarting}
              className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {stopping ? "Stopping..." : "Stop"}
            </button>
          </div>
          )}
        </div>

        {/* Full deploy history (commit, trigger, duration, per-deploy log). The
            key changes whenever the app's latest deployments change state, so
            the history refreshes after every deploy/cancel/finish. */}
        <DeploymentHistory
          appId={appId}
          reloadKey={deployments.map((d) => `${d.id}:${d.status}`).join(",")}
          busy={app.status === "building" || deploying || migrating}
          onDeployStarted={() => {
            setLogReload((k) => k + 1); // stream the rollback's log
            void fetchApp();
          }}
        />
      </section>

      <div id="sec-uptime" data-crumb="Uptime" aria-hidden="true" />
      <UptimeSection appId={app.id} />

      {/* Env vars (scoped: all / production / preview) */}
      <div id="sec-env" data-crumb="Environment variables" aria-hidden="true" />
      <EnvVarsSection appId={app.id} />

      {/* Deploy health check (zero-downtime candidate probe) */}
      <div id="sec-health" data-crumb="Health check" aria-hidden="true" />
      <HealthCheckSection app={app} onSaved={() => void fetchApp()} />

      {app.githubRepoFullName && <div id="sec-github" data-crumb="GitHub" aria-hidden="true" />}
      {/* GitHub commit statuses + PR preview comments (GitHub-connected apps) */}
      {app.githubRepoFullName && <GithubIntegrationSection app={app} onSaved={() => void fetchApp()} />}

      <div id="sec-previews" data-crumb="Preview deploys" aria-hidden="true" />
      {/* Preview deploys per branch (own container + URL, isolated from production) */}
      <PreviewsSection
        app={app}
        onPromoted={() => {
          setLogReload((k) => k + 1); // stream the promote's log
          void fetchApp();
        }}
      />

      {/* Node-RED editor accounts (only for Node-RED apps) */}
      {app.type === "nodered" && <div id="sec-nodered" data-crumb="Node-RED users" aria-hidden="true" />}
      {app.type === "nodered" && <NodeRedUsersSection appId={appId} />}

      {/* Custom domains */}
      <div id="sec-domains" data-crumb="Domains" aria-hidden="true" />
      <DomainsSection appId={appId} />

      {/* Deploy tokens */}
      <div id="sec-tokens" data-crumb="Deploy tokens" aria-hidden="true" />
      <TokensSection appId={appId} />

          <div id="sec-danger" data-crumb="Danger zone" aria-hidden="true" />
          {/* Danger zone — delete at the bottom */}
          <section className="mt-8 pt-6 border-t border-brand-200 dark:border-brand-700">
            <h2 className="text-base font-semibold text-red-600 dark:text-red-400 mb-1">Danger zone</h2>
            <p className="text-sm text-brand-500 dark:text-brand-400 mb-3">
              Permanently delete this app, its deployments, and deploy tokens.
            </p>
            <button
              onClick={() => setConfirmDelete(true)}
              className="px-4 py-2 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              Delete
            </button>
          </section>
        </div>

        {/* Right column — live logs, fixed full height */}
        <div className="lg:w-[44%] shrink-0 min-h-0 flex flex-col border-t lg:border-t-0 lg:border-l border-brand-200 dark:border-brand-700 p-6">
          <LogViewer
            appId={appId}
            reloadKey={logReload}
            onFinished={fetchApp}
            canShowRuntime={deployments.length > 0}
          />
        </div>
      </div>

      {/* Stop confirmation — taking the site offline is disruptive. */}
      {confirmStop && (
        <ConfirmDialog
          title={`Stop ${app.name}?`}
          message="This stops the running container and takes the site offline until you deploy again. Visitors will see it as down."
          confirmLabel="Stop site"
          destructive
          busy={stopping}
          onConfirm={handleStop}
          onCancel={() => setConfirmStop(false)}
        />
      )}

      {/* Migrate confirmation — forces a full clean rebuild. */}
      {confirmMigrate && (
        <ConfirmDialog
          title={`Migrate ${app.name}?`}
          message="This forces a clean rebuild and redeploy from scratch. If the new build fails, the previous version is restored automatically, so the site stays up."
          confirmLabel="Migrate"
          busy={migrating}
          onConfirm={handleMigrate}
          onCancel={() => setConfirmMigrate(false)}
        />
      )}

      {linkedDeploymentId && (
        <DeploymentLogModal
          appId={appId}
          deployment={
            linkedDeployment ?? {
              // Not in the production history (e.g. a preview deploy): the
              // log still loads; status/branch are simply not shown.
              id: linkedDeploymentId,
              branch: null,
              commitSha: null,
              status: "" as DeploymentHistoryItem["status"],
              logTruncated: false,
              errorReason: null,
            }
          }
          onClose={() => {
            searchParams.delete("deployment");
            setSearchParams(searchParams, { replace: true });
          }}
        />
      )}

      {/* Clear build cache confirmation */}
      {confirmClearCache && (
        <ConfirmDialog
          title={`Clear build cache for ${app.name}?`}
          message={`Repeat deploys reuse cached dependencies and framework build output${
            cacheSize === null
              ? ""
              : cacheSize > 0
                ? ` (${cacheSize >= 1024 ** 3 ? `${(cacheSize / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(cacheSize / 1024 ** 2))} MB`} cached for this app)`
                : " (nothing cached yet)"
          }. This deletes the cache and redeploys from scratch — the next build will be slower. If it fails, the previous version stays up.`}
          confirmLabel="Clear cache & redeploy"
          busy={clearingCache}
          onConfirm={handleClearCache}
          onCancel={() => setConfirmClearCache(false)}
        />
      )}

      {/* Delete confirmation — centered modal popup */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => !deleting && setConfirmDelete(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50 mb-2">
              Delete {app.name}?
            </h2>
            <p className="text-sm text-brand-600 dark:text-brand-400 mb-4">
              This stops the running container and permanently removes the app, its
              deployments, and deploy tokens. This action cannot be undone.
            </p>

            <label className="block text-sm text-brand-600 dark:text-brand-400 mb-2">
              Type{" "}
              <span className="font-mono font-semibold text-brand-900 dark:text-brand-100">
                {app.name}
              </span>{" "}
              to confirm:
            </label>
            <input
              type="text"
              autoFocus
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !deleting &&
                  deleteConfirmText === app.name
                ) {
                  handleDelete();
                }
              }}
              disabled={deleting}
              placeholder={app.name}
              className="w-full mb-4 px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting || deleteConfirmText !== app.name}
                className="px-4 py-2 rounded bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
