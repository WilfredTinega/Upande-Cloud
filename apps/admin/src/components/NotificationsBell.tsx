import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi, ownNotificationsApi } from "../lib/api";
import { useReadErrors } from "../lib/readErrors";
import { useToast } from "../context/ToastContext";
import { playMessageChime, playNotifyChime } from "../lib/sound";
import {
  desktopState,
  disableDesktop,
  enableDesktop,
  setTitleUnread,
  showDesktop,
  type DesktopState,
} from "../lib/alerts";
import { NOTIFICATIONS_REFRESH_EVENT } from "../context/SupportContext";
import type { DeploymentError, OwnNotification } from "../types";

// How often to re-poll for new cross-tenant deployment failures so the bell
// updates without a page reload.
const POLL_MS = 20_000;

function str(meta: Record<string, unknown> | undefined, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" ? v : null;
}

/**
 * Admin TopBar bell. The admin panel is OBSERVATIONAL — it does not own the
 * users' notification feed — so the bell surfaces cross-tenant deployment
 * FAILURES (the same data as the Errors page) rather than personal notices.
 *
 * "Unread" is admin-local (stored in this browser, shared with the Errors page
 * via useReadErrors), so opening an error on either surface drops the badge on
 * both. Clicking an item jumps to the full Errors page for the detail/log/AI.
 *
 * Mirrors the dashboard NotificationsBell so the two apps feel consistent.
 */
export function NotificationsBell() {
  const navigate = useNavigate();
  const { readIds, markRead, markAllRead } = useReadErrors();
  const toast = useToast();
  const [items, setItems] = useState<DeploymentError[]>([]);
  // The admin's OWN support_message notifications (a user wrote in).
  const [support, setSupport] = useState<OwnNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState<DesktopState>(() => desktopState());
  const rootRef = useRef<HTMLDivElement>(null);
  // IDs seen this session. null until the first load, which only seeds them —
  // errors / messages that already existed at page load never alert.
  const seenErrors = useRef<Set<string> | null>(null);
  const seenSupport = useRef<Set<string> | null>(null);

  // Clickable toast + chime + (opt-in, hidden tab only) desktop notification.
  const alertNew = useCallback(
    (title: string, body: string, tag: string, href: string, tone: "info" | "error", messageId?: string) => {
      const go = () => navigate(href);
      toast.toast(body, tone, { title, onClick: go });
      // Support messages share the chat stream's per-message dedupe.
      if (messageId) playMessageChime(messageId);
      else playNotifyChime();
      showDesktop(title, body, tag, go);
    },
    [toast, navigate],
  );
  const alertRef = useRef(alertNew);
  alertRef.current = alertNew;

  useEffect(() => {
    let active = true;
    const refreshErrors = () =>
      adminApi
        .getDeploymentErrors()
        .then(({ notifications }) => {
          if (!active) return;
          const known = seenErrors.current;
          if (known) {
            notifications
              .filter((e) => !known.has(e.id))
              .slice(0, 3)
              .reverse()
              .forEach((e) =>
                alertRef.current(
                  `Deployment failed: ${str(e.metadata, "appName") ?? "app"}`,
                  e.user?.email ?? e.message,
                  e.id,
                  `/errors?id=${e.id}`,
                  "error",
                ),
              );
          }
          seenErrors.current = new Set([...(known ?? []), ...notifications.map((e) => e.id)]);
          setItems(notifications);
        })
        .catch(() => {
          // Non-fatal: a failed poll must not break the admin shell.
        });
    const refreshSupport = () =>
      ownNotificationsApi
        .listRecent()
        .then(({ notifications }) => {
          if (!active) return;
          const mine = notifications.filter((n) => n.type === "support_message");
          const known = seenSupport.current;
          if (known) {
            mine
              .filter((n) => !known.has(n.id) && !n.readAt)
              .slice(0, 3)
              .reverse()
              .forEach((n) =>
                alertRef.current(
                  "New support message",
                  n.message,
                  n.id,
                  supportHref(n),
                  "info",
                  typeof n.metadata?.messageId === "string" ? n.metadata.messageId : n.id,
                ),
              );
          }
          seenSupport.current = new Set([...(known ?? []), ...mine.map((n) => n.id)]);
          setSupport(mine);
        })
        .catch(() => {
          /* non-fatal */
        });
    const refresh = () => {
      void refreshErrors();
      void refreshSupport();
    };

    refresh();
    const interval = setInterval(refresh, POLL_MS);
    // The support stream signals a new user message → re-poll right away.
    const onSupport = () => void refreshSupport();
    window.addEventListener("focus", refresh);
    window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, onSupport);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, onSupport);
    };
  }, []);

  // Close the dropdown on outside-click and Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const total = items.length;
  const errorsUnread = items.reduce((n, e) => (readIds.has(e.id) ? n : n + 1), 0);
  const readCount = total - errorsUnread;
  const supportUnread = support.filter((n) => !n.readAt).length;
  const unreadCount = errorsUnread + supportUnread;

  // "(3) Upande Cloud -- Admin" while anything is unread.
  useEffect(() => {
    setTitleUnread(unreadCount);
  }, [unreadCount]);
  useEffect(() => () => setTitleUnread(0), []);

  const openSupport = (n: OwnNotification) => {
    if (!n.readAt) {
      setSupport((curr) => curr.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      ownNotificationsApi.markRead(n.id).catch(() => {
        /* best-effort */
      });
    }
    setOpen(false);
    navigate(supportHref(n));
  };

  const toggleDesktop = async () => {
    setDesktop(desktop === "on" ? disableDesktop() : await enableDesktop());
  };

  // Open the Errors page focused on this failure, marking it read on the way.
  const openDetail = (e: DeploymentError) => {
    markRead(e.id);
    setOpen(false);
    navigate(`/errors?id=${e.id}`);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        className="relative flex items-center justify-center w-9 h-9 rounded-full text-brand-600 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[1.05rem] h-[1.05rem] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[0.65rem] font-bold leading-none">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shadow-xl overflow-hidden z-50">
          <DesktopToggle state={desktop} onToggle={() => void toggleDesktop()} />
          {support.length > 0 && (
            <div className="border-b border-brand-200 dark:border-brand-700">
              <div className="flex items-center gap-2 px-4 py-2.5">
                <span className="text-sm font-semibold text-brand-900 dark:text-brand-50">Support messages</span>
                {supportUnread > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[1.75rem] h-[1.15rem] px-2 rounded-full text-[0.65rem] font-bold leading-none tabular-nums bg-blue-600 text-white">
                    {supportUnread}
                  </span>
                )}
              </div>
              <ul className="max-h-48 overflow-y-auto hide-scrollbar divide-y divide-brand-100 dark:divide-brand-800">
                {support.slice(0, 10).map((n) => (
                  <li
                    key={n.id}
                    onClick={() => openSupport(n)}
                    className={`flex items-start gap-2.5 px-4 py-2.5 cursor-pointer transition-colors ${
                      n.readAt
                        ? "hover:bg-brand-50 dark:hover:bg-brand-800/40"
                        : "bg-brand-50/60 dark:bg-brand-800/30 hover:bg-brand-100 dark:hover:bg-brand-800/60"
                    }`}
                  >
                    <span
                      className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${n.readAt ? "bg-brand-300 dark:bg-brand-600" : "bg-blue-600"}`}
                      aria-hidden
                    />
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm break-words ${
                          n.readAt
                            ? "text-brand-500 dark:text-brand-400"
                            : "font-medium text-brand-900 dark:text-brand-50"
                        }`}
                      >
                        {n.message}
                      </p>
                      <p className="text-xs text-brand-400 dark:text-brand-500 mt-0.5">
                        {new Date(n.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-brand-200 dark:border-brand-700">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold text-brand-900 dark:text-brand-50 whitespace-nowrap">
                Deployment errors
              </span>
              {errorsUnread > 0 && (
                <span
                  title={`${errorsUnread} unread`}
                  className="inline-flex items-center justify-center min-w-[1.75rem] h-[1.15rem] px-2 rounded-full text-[0.65rem] font-bold leading-none tabular-nums bg-red-600 text-white"
                >
                  {errorsUnread}
                </span>
              )}
              {readCount > 0 && (
                <span
                  title={`${readCount} read`}
                  className="inline-flex items-center justify-center min-w-[1.75rem] h-[1.15rem] px-2 rounded-full text-[0.65rem] font-bold leading-none tabular-nums bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300"
                >
                  {readCount}
                </span>
              )}
            </div>
            {errorsUnread > 0 && (
              <button
                onClick={() => markAllRead(items.map((e) => e.id))}
                className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap shrink-0"
              >
                Mark all read
              </button>
            )}
          </div>

          {total === 0 ? (
            <p className="px-4 py-6 text-sm text-center text-brand-400 dark:text-brand-500">
              No deployment errors. 🎉
            </p>
          ) : (
            <ul className="max-h-96 overflow-y-auto hide-scrollbar divide-y divide-brand-100 dark:divide-brand-800">
              {items.map((e) => (
                <ErrorItem
                  key={e.id}
                  error={e}
                  read={readIds.has(e.id)}
                  onOpen={() => openDetail(e)}
                  onMarkRead={() => markRead(e.id)}
                />
              ))}
            </ul>
          )}

          {total > 0 && (
            <button
              onClick={() => {
                setOpen(false);
                navigate("/errors");
              }}
              className="w-full px-4 py-2.5 text-xs font-medium text-center text-brand-600 dark:text-brand-400 border-t border-brand-200 dark:border-brand-700 hover:bg-brand-50 dark:hover:bg-brand-800/50 transition-colors"
            >
              View all errors →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function supportHref(n: OwnNotification): string {
  const c = n.metadata?.conversationId;
  return typeof c === "string" ? `/support?c=${c}` : "/support";
}

// Explicit opt-in for browser notifications (shown only while the tab is hidden).
function DesktopToggle({ state, onToggle }: { state: DesktopState; onToggle: () => void }) {
  if (state === "unsupported") return null;
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-brand-100 dark:border-brand-800 text-xs">
      {state === "denied" ? (
        <span className="text-brand-400 dark:text-brand-500">Desktop notifications are blocked in your browser settings.</span>
      ) : (
        <>
          <span className="text-brand-500 dark:text-brand-400">
            {state === "on" ? "Desktop notifications on" : "Desktop notifications off"}
          </span>
          <button onClick={onToggle} className="font-medium text-brand-600 dark:text-brand-400 hover:underline">
            {state === "on" ? "Disable" : "Enable desktop notifications"}
          </button>
        </>
      )}
    </div>
  );
}

function ErrorItem({
  error,
  read,
  onOpen,
  onMarkRead,
}: {
  error: DeploymentError;
  read: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const appName = str(error.metadata, "appName") ?? "Deployment";
  const step = str(error.metadata, "step");
  const email = error.user?.email ?? "—";
  const when = new Date(error.createdAt).toLocaleString();
  const unread = !read;

  return (
    <li
      onClick={onOpen}
      className={`flex items-start gap-2.5 px-4 py-3 cursor-pointer transition-colors ${
        unread
          ? "bg-brand-50/60 dark:bg-brand-800/30 hover:bg-brand-100 dark:hover:bg-brand-800/60"
          : "hover:bg-brand-50 dark:hover:bg-brand-800/40"
      }`}
    >
      <span
        className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${
          unread ? "bg-red-600" : "bg-brand-300 dark:bg-brand-600"
        }`}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p
            className={`text-sm break-words ${
              unread
                ? "font-semibold text-brand-900 dark:text-brand-50"
                : "font-medium text-brand-500 dark:text-brand-400"
            }`}
          >
            Deployment failed: {appName}
          </p>
          {unread && (
            <span className="shrink-0 text-[0.6rem] font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
              New
            </span>
          )}
        </div>
        {step && (
          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 break-words">
            failed at {step}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1">
          <p className="text-xs text-brand-400 dark:text-brand-500 truncate">
            {email} · {when}
          </p>
        </div>
      </div>
      {unread && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onMarkRead();
          }}
          aria-label="Mark as read"
          title="Mark as read"
          className="shrink-0 text-brand-400 dark:text-brand-500 hover:text-brand-700 dark:hover:text-brand-200 transition-colors text-xs font-medium"
        >
          ✓
        </button>
      )}
    </li>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
