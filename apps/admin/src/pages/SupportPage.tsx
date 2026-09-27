import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { Select } from "../components/Select";
import { Skeleton, SkeletonLines } from "../components/Skeleton";
import { SupportThread } from "../components/SupportThread";
import {
  CATEGORY_OPTIONS,
  GroupedInbox,
  ImpersonateButton,
  RefBadge,
  ResolutionBadge,
  StatusPill,
  btnSecondary,
  toThreadMessage,
} from "../components/SupportParts";
import { useSupport } from "../context/SupportContext";
import { useToast } from "../context/ToastContext";
import { useSupportThread } from "../lib/useSupportThread";
import type { SupportCategory, SupportStatus } from "../types";

type StatusFilter = "all" | SupportStatus | "unread";

const selectCls =
  "text-sm rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-700 dark:text-brand-300 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";
/**
 * Reference / title search. "issue-3", "ISSUE 0003" and "issue3" all match
 * ISSUE-0003; anything else is a case-insensitive substring match.
 */
function matchesSearch(reference: string, title: string, raw: string): boolean {
  const q = raw.trim().toLowerCase();
  if (!q) return true;
  const m = /^(issue|inquiry|faqs|custom)[\s-]*0*(\d+)$/.exec(q);
  if (m) return reference === `${m[1].toUpperCase()}-${(m[2] || "0").padStart(4, "0")}`;
  return reference.toLowerCase().includes(q) || title.toLowerCase().includes(q);
}

/**
 * Cross-tenant support inbox: every organization's conversations with
 * status / unread / organization filters, and the thread view for replying.
 */
export function SupportPage() {
  const toast = useToast();
  const { conversations, listLoading, listError } = useSupport();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("c");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [orgFilter, setOrgFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"" | SupportCategory>("");
  const [search, setSearch] = useState("");
  const { thread, loading, error, send, askResolution, setStatus, statusBusy, live } = useSupportThread(
    selectedId,
    true,
    () => select(null),
  );

  // Function declaration (hoisted) so the hook above can drop a stale ?c= id.
  function select(id: string | null) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (id) next.set("c", id);
        else next.delete("c");
        return next;
      },
      { replace: true },
    );
  }

  const orgs = useMemo(() => {
    const m = new Map<string, string>();
    conversations.forEach((c) => m.set(c.organization.id, c.organization.name));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [conversations]);

  const visible = conversations.filter(
    (c) =>
      (statusFilter === "all" ||
        (statusFilter === "unread" ? c.unreadCount > 0 : c.status === statusFilter)) &&
      (!orgFilter || c.organization.id === orgFilter) &&
      (!categoryFilter || c.category === categoryFilter) &&
      matchesSearch(c.reference, c.title, search),
  );
  const unreadTotal = conversations.reduce((n, c) => n + c.unreadCount, 0);

  const changeStatus = async (status: SupportStatus) => {
    try {
      await setStatus(status);
      toast.success(status === "closed" ? "Conversation closed" : "Conversation reopened");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the conversation");
    }
  };

  const ask = async () => {
    try {
      await askResolution();
      toast.success("Question sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send the question");
    }
  };

  return (
    <div className="h-full flex flex-col">
      <PageHeader
        title="Support"
        actions={
          <>
            {unreadTotal > 0 && (
              <span className="text-sm text-brand-500 dark:text-brand-400">{unreadTotal} unread</span>
            )}
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              title="Filter by status"
              className={selectCls}
            >
              <option value="open">Open</option>
              <option value="unread">Unread</option>
              <option value="closed">Closed</option>
              <option value="all">All</option>
            </Select>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ISSUE-0001 or title"
              aria-label="Search by reference or title"
              className={`${selectCls} w-44`}
            />
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as "" | SupportCategory)}
              title="Filter by category"
              className={selectCls}
            >
              <option value="">All categories</option>
              {CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              title="Filter by organization"
              className={selectCls}
            >
              <option value="">All organizations</option>
              {orgs.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </>
        }
      />

      {listError && (
        <div className="mt-6 px-4 py-3 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
          {listError}
        </div>
      )}

      <div className="mt-6 flex-1 min-h-0 flex gap-4">
        {/* Inbox */}
        <div className="w-80 shrink-0 flex flex-col rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 overflow-hidden">
          {listLoading ? (
            <div role="status" aria-label="Loading" className="divide-y divide-brand-100 dark:divide-brand-800">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-4 py-3 flex flex-col gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="px-4 py-8 text-sm text-center text-brand-400 dark:text-brand-500">No conversations.</p>
          ) : (
            <GroupedInbox conversations={visible} selectedId={selectedId} onSelect={(id) => select(id)} />
          )}
        </div>

        {/* Thread */}
        <div className="flex-1 min-w-0 rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 overflow-hidden">
          {!selectedId ? (
            <div className="h-full flex items-center justify-center p-6 text-sm text-brand-400 dark:text-brand-500">
              Select a conversation.
            </div>
          ) : loading || (!thread && !error) ? (
            <div role="status" aria-label="Loading" className="p-5 flex flex-col gap-4">
              <Skeleton className="h-6 w-1/3" />
              <SkeletonLines lines={2} />
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="h-12 w-1/2 self-end" />
            </div>
          ) : error || !thread ? (
            <p className="p-5 text-sm text-red-600 dark:text-red-400">{error ?? "Conversation not found"}</p>
          ) : (
            <SupportThread
              key={thread.conversation.id}
              messages={thread.messages.map(toThreadMessage)}
              onSend={send}
              placeholder="Reply as Upande Support…"
              closed={thread.conversation.status === "closed"}
              resolutionPending={thread.conversation.resolution === "pending"}
              closedNote={
                <span className="flex items-center justify-between gap-3">
                  This conversation is closed.
                  <button onClick={() => void changeStatus("open")} disabled={statusBusy} className={btnSecondary}>
                    Reopen
                  </button>
                </span>
              }
              header={
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <RefBadge reference={thread.conversation.reference} />
                      <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50 truncate">
                        {thread.conversation.title}
                      </h2>
                    </div>
                    <p className="text-xs text-brand-400 dark:text-brand-500 truncate">
                      {thread.conversation.organization.name} ({thread.conversation.organization.id})
                      {thread.conversation.createdBy
                        ? ` · ${thread.conversation.createdBy.username} <${thread.conversation.createdBy.email}>`
                        : ""}
                      {" · "}
                      {new Date(thread.conversation.createdAt).toLocaleString()}
                      {!live && " · reconnecting…"}
                    </p>
                  </div>
                  <ImpersonateButton user={thread.conversation.createdBy} />
                  <ResolutionBadge resolution={thread.conversation.resolution} status={thread.conversation.status} />
                  <StatusPill status={thread.conversation.status} />
                  {thread.conversation.status === "open" && (
                    <button onClick={() => void ask()} className={btnSecondary}>
                      Ask if resolved
                    </button>
                  )}
                  <button
                    onClick={() => void changeStatus(thread.conversation.status === "open" ? "closed" : "open")}
                    disabled={statusBusy}
                    className={btnSecondary}
                  >
                    {thread.conversation.status === "open" ? "Close" : "Reopen"}
                  </button>
                </div>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
