import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useSupport } from "../context/SupportContext";
import { useSupportThread } from "../lib/useSupportThread";
import { Skeleton } from "./Skeleton";
import { SupportThread } from "./SupportThread";
import { NewConversationForm, RefBadge, ResolutionBadge, StatusPill, btnSecondary, groupByCreator } from "./SupportParts";

const OPEN_KEY = "upande-support-widget-open";
const CONV_KEY = "upande-support-widget-conv";

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked: state just won't survive a reload */
  }
}

/**
 * Floating support chat: a round button fixed bottom-right on every dashboard
 * page (with the unread badge) that opens a compact panel with the most recent
 * open conversation, a conversation picker and "New conversation". Shares the
 * stream and conversation list with the Support page via SupportContext.
 * Hidden on the Support page itself, where the full view is already on screen.
 */
export function SupportWidget() {
  const { pathname } = useLocation();
  const { conversations, listLoading, unreadCount, upsert } = useSupport();
  const { user, impersonatedBy } = useAuth();
  const [open, setOpen] = useState(() => readSession(OPEN_KEY) === "1");
  const [picked, setPicked] = useState<string | null>(() => readSession(CONV_KEY));
  const [composing, setComposing] = useState(false);

  useEffect(() => writeSession(OPEN_KEY, open ? "1" : null), [open]);
  useEffect(() => writeSession(CONV_KEY, picked), [picked]);

  // Default to the most recent open conversation (else the most recent one).
  const pickedExists = picked && conversations.some((c) => c.id === picked);
  const currentId = pickedExists
    ? picked
    : (conversations.find((c) => c.status === "open") ?? conversations[0])?.id ?? null;
  const showNew = composing || (!listLoading && conversations.length === 0);

  const onSupportPage = pathname.startsWith("/support");
  const threadActive = open && !showNew && !onSupportPage;
  const { thread, loading, error, send, answerResolution, setStatus, statusBusy } = useSupportThread(
    onSupportPage ? null : currentId,
    threadActive,
  );

  if (onSupportPage) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close support chat" : unreadCount > 0 ? `Support chat, ${unreadCount} unread` : "Support chat"}
        aria-expanded={open}
        className={`fixed bottom-4 right-4 z-[55] w-14 h-14 rounded-full shadow-lg flex items-center justify-center bg-brand-700 text-white dark:bg-brand-200 dark:text-brand-900 hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors ${
          open ? "max-sm:hidden" : ""
        }`}
      >
        {open ? <CloseIcon /> : <ChatIcon />}
        {!open && unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[0.7rem] font-bold leading-none ring-2 ring-white dark:ring-brand-950">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Support chat"
          className="fixed z-[56] flex flex-col overflow-hidden border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shadow-2xl inset-x-0 bottom-0 h-[85vh] rounded-t-xl sm:inset-x-auto sm:right-4 sm:bottom-20 sm:w-[360px] sm:h-[520px] sm:max-h-[calc(100vh-7rem)] sm:rounded-lg"
        >
          {/* Panel header: conversation picker, new, full page, close. */}
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-900">
            {conversations.length > 0 && !showNew ? (
              <select
                value={currentId ?? ""}
                onChange={(e) => setPicked(e.target.value)}
                aria-label="Conversation"
                className="flex-1 min-w-0 px-2 py-1 rounded border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 text-sm text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
              >
                {groupByCreator(conversations, user?.id).map((g) => (
                  <optgroup key={g.key} label={g.label}>
                    {g.conversations.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.unreadCount > 0 ? `(${c.unreadCount}) ` : ""}
                        {c.reference} · {c.title}
                        {c.resolution === "solved" ? " · solved" : c.status === "closed" ? " · closed" : ""}
                        {c.resolution === "pending" && c.status === "open" ? " · awaiting answer" : ""}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            ) : (
              <span className="flex-1 text-sm font-semibold text-brand-900 dark:text-brand-50">New conversation</span>
            )}
            {!showNew ? (
              <IconButton label="New conversation" onClick={() => setComposing(true)}>
                <PlusIcon />
              </IconButton>
            ) : (
              conversations.length > 0 && (
                <IconButton label="Back" onClick={() => setComposing(false)}>
                  <BackIcon />
                </IconButton>
              )
            )}
            <Link
              to={currentId && !showNew ? `/support?c=${currentId}` : "/support"}
              onClick={() => setOpen(false)}
              title="Open Support page"
              aria-label="Open Support page"
              className="p-1.5 rounded text-brand-500 dark:text-brand-400 hover:bg-brand-200 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200 transition-colors"
            >
              <ExpandIcon />
            </Link>
            <IconButton label="Close" onClick={() => setOpen(false)}>
              <CloseIcon small />
            </IconButton>
          </div>

          <div className="flex-1 min-h-0">
            {listLoading ? (
              <div role="status" aria-label="Loading" className="p-4 flex flex-col gap-3">
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="h-10 w-1/2 self-end" />
                <Skeleton className="h-10 w-3/5" />
              </div>
            ) : showNew ? (
              <NewConversationForm
                compact
                onCreated={(c) => {
                  upsert(c);
                  setPicked(c.id);
                  setComposing(false);
                }}
              />
            ) : loading || (!thread && !error) ? (
              <div role="status" aria-label="Loading" className="p-4 flex flex-col gap-3">
                <Skeleton className="h-10 w-2/3" />
                <Skeleton className="h-10 w-1/2 self-end" />
              </div>
            ) : error || !thread ? (
              <p className="p-4 text-sm text-red-600 dark:text-red-400">{error ?? "Conversation not found"}</p>
            ) : (
              <SupportThread
                key={thread.conversation.id}
                messages={thread.messages}
                onSend={send}
                closed={thread.conversation.status === "closed"}
                resolutionPending={thread.conversation.resolution === "pending"}
                onAnswer={impersonatedBy ? undefined : answerResolution}
                closedNote={
                  <span className="flex items-center justify-between gap-3">
                    Closed.
                    <button onClick={() => void setStatus("open")} disabled={statusBusy} className={btnSecondary}>
                      Reopen
                    </button>
                  </span>
                }
                header={
                  <div className="flex items-center gap-2 -mx-2 -my-1">
                    <RefBadge reference={thread.conversation.reference} />
                    <span className="flex-1 min-w-0 truncate text-sm font-semibold text-brand-900 dark:text-brand-50">
                      {thread.conversation.title}
                    </span>
                    <ResolutionBadge resolution={thread.conversation.resolution} status={thread.conversation.status} />
                    <StatusPill status={thread.conversation.status} />
                  </div>
                }
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-1.5 rounded text-brand-500 dark:text-brand-400 hover:bg-brand-200 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200 transition-colors"
    >
      {children}
    </button>
  );
}

const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function ChatIcon() {
  return (
    <svg {...svgProps} className="w-6 h-6">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />
    </svg>
  );
}

function CloseIcon({ small }: { small?: boolean }) {
  return (
    <svg {...svgProps} className={small ? "w-4 h-4" : "w-6 h-6"}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...svgProps} className="w-4 h-4">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg {...svgProps} className="w-4 h-4">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg {...svgProps} className="w-4 h-4">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  );
}
