import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useSupport } from "../context/SupportContext";
import { useAuth } from "../lib/auth";
import { useToast } from "../context/ToastContext";
import { useSupportThread } from "../lib/useSupportThread";
import { Skeleton, SkeletonLines } from "../components/Skeleton";
import { SupportThread } from "../components/SupportThread";
import {
  NewConversationModal,
  RefBadge,
  ResolutionBadge,
  StatusPill,
  btnPrimary,
  btnSecondary,
  groupByCreator,
  relTime,
} from "../components/SupportParts";
import type { SupportStatus } from "../types";

type Filter = "all" | SupportStatus;

/**
 * Support chat with the Upande team. Conversations belong to the organization,
 * so every member sees (and can reply to) the org's threads. Left: the
 * conversation list; right: the selected thread. List + stream state is shared
 * with the floating chat widget via SupportContext.
 */
export function SupportPage() {
  const toast = useToast();
  const { user, impersonatedBy } = useAuth();
  const { conversations, listLoading: loading, listError: error, upsert } = useSupport();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("c");
  const [filter, setFilter] = useState<Filter>("all");
  const [showNew, setShowNew] = useState(false);
  const {
    thread,
    loading: threadLoading,
    error: threadError,
    send,
    answerResolution,
    setStatus: updateStatus,
    statusBusy,
    live,
  } = useSupportThread(selectedId, true, () => select(null));

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

  const setStatus = async (status: SupportStatus) => {
    try {
      await updateStatus(status);
      toast.success(status === "closed" ? "Conversation closed" : "Conversation reopened");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update the conversation");
    }
  };

  const answer = async (solved: boolean) => {
    await answerResolution(solved);
    toast.success(solved ? "Marked as solved" : "Thanks, we'll keep going");
  };

  const visible = conversations.filter((c) => filter === "all" || c.status === filter);
  const groups = groupByCreator(visible, user?.id);

  if (loading) {
    return (
      <div role="status" aria-label="Loading" className="h-full flex flex-col">
        <h1 className="mb-6 text-xl font-semibold text-brand-900 dark:text-brand-50">Support</h1>
        <div className="flex-1 min-h-0 flex gap-4">
          <div className="w-80 shrink-0 rounded-lg border border-brand-200 dark:border-brand-700 divide-y divide-brand-100 dark:divide-brand-800 bg-white dark:bg-brand-900">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-3 flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            ))}
          </div>
          <div className="flex-1 min-w-0 rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-5 flex flex-col gap-4">
            <Skeleton className="h-6 w-1/3" />
            <SkeletonLines lines={4} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-6">
        <h1 className="text-xl font-semibold text-brand-900 dark:text-brand-50">Support</h1>
        <button onClick={() => setShowNew(true)} className={btnPrimary}>
          New conversation
        </button>
      </div>

      {error && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-4 py-3 border border-red-200 dark:border-red-800">
          {error}
        </p>
      )}

      <div className="flex-1 min-h-0 flex gap-4">
        {/* Conversation list */}
        <div className="w-80 shrink-0 flex flex-col rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 overflow-hidden">
          <div className="shrink-0 flex gap-1 p-2 border-b border-brand-200 dark:border-brand-700">
            {(["all", "open", "closed"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex-1 px-2 py-1 rounded text-xs font-medium capitalize transition-colors ${
                  filter === f
                    ? "bg-brand-800 text-white dark:bg-brand-200 dark:text-brand-900"
                    : "text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          {visible.length === 0 ? (
            <p className="px-4 py-8 text-sm text-center text-brand-400 dark:text-brand-500">
              {conversations.length === 0 ? "No conversations yet." : "Nothing here."}
            </p>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              {groups.map((g) => (
                <section key={g.key}>
                  <h3 className="sticky top-0 z-[1] flex items-center gap-2 px-4 py-1.5 bg-brand-50 dark:bg-brand-950 border-b border-brand-100 dark:border-brand-800 text-[0.7rem] font-semibold uppercase tracking-wide text-brand-500 dark:text-brand-400">
                    <span className="flex-1 min-w-0 truncate">{g.label}</span>
                    <span className="font-normal normal-case">{g.conversations.length}</span>
                    {g.unread > 0 && (
                      <span className="min-w-[1.1rem] h-4 px-1 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-[0.6rem] font-bold">
                        {g.unread}
                      </span>
                    )}
                  </h3>
                  <ul className="divide-y divide-brand-100 dark:divide-brand-800">
                    {g.conversations.map((c) => (
                      <li key={c.id}>
                        <button
                          onClick={() => select(c.id)}
                          className={`w-full text-left px-4 py-3 transition-colors ${
                            c.id === selectedId
                              ? "bg-brand-100 dark:bg-brand-800"
                              : "hover:bg-brand-50 dark:hover:bg-brand-800/50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <RefBadge reference={c.reference} />
                            <span
                              className={`flex-1 min-w-0 truncate text-sm ${
                                c.unreadCount > 0
                                  ? "font-semibold text-brand-900 dark:text-brand-50"
                                  : "font-medium text-brand-700 dark:text-brand-200"
                              }`}
                            >
                              {c.title}
                            </span>
                            {c.unreadCount > 0 && (
                              <span className="shrink-0 min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-[0.65rem] font-bold">
                                {c.unreadCount}
                              </span>
                            )}
                          </div>
                          {c.lastMessage && (
                            <p className="mt-0.5 text-xs text-brand-500 dark:text-brand-400 truncate">
                              <span className="font-medium">{c.lastMessage.authorName}:</span> {c.lastMessage.preview}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-2 text-[0.7rem] text-brand-400 dark:text-brand-500">
                            <StatusPill status={c.status} />
                            <ResolutionBadge resolution={c.resolution} status={c.status} />
                            <span>{relTime(c.lastMessageAt)}</span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* Thread */}
        <div className="flex-1 min-w-0 rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 overflow-hidden">
          {!selectedId ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-brand-500 dark:text-brand-400">Select a conversation.</p>
              <button onClick={() => setShowNew(true)} className={btnSecondary}>
                New conversation
              </button>
            </div>
          ) : threadLoading || (!thread && !threadError) ? (
            <div role="status" aria-label="Loading" className="p-5 flex flex-col gap-4">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="h-12 w-1/2 self-end" />
              <Skeleton className="h-12 w-3/5" />
            </div>
          ) : threadError || !thread ? (
            <p className="p-5 text-sm text-red-600 dark:text-red-400">{threadError ?? "Conversation not found"}</p>
          ) : (
            <SupportThread
              key={thread.conversation.id}
              messages={thread.messages}
              onSend={send}
              closed={thread.conversation.status === "closed"}
              resolutionPending={thread.conversation.resolution === "pending"}
              // Impersonation sessions are read-only (the API refuses answers).
              onAnswer={impersonatedBy ? undefined : answer}
              closedNote={
                <span className="flex items-center justify-between gap-3">
                  This conversation is closed. Reopen it to send another message.
                  <button onClick={() => void setStatus("open")} disabled={statusBusy} className={btnSecondary}>
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
                    <p className="text-xs text-brand-400 dark:text-brand-500">
                      Started {new Date(thread.conversation.createdAt).toLocaleString()}
                      {thread.conversation.createdBy ? ` by ${thread.conversation.createdBy.username}` : ""}
                      {!live && " · reconnecting…"}
                    </p>
                  </div>
                  <ResolutionBadge resolution={thread.conversation.resolution} status={thread.conversation.status} />
                  <StatusPill status={thread.conversation.status} />
                  <button
                    onClick={() => void setStatus(thread.conversation.status === "open" ? "closed" : "open")}
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

      {showNew && (
        <NewConversationModal
          onClose={() => setShowNew(false)}
          onCreated={(c) => {
            setShowNew(false);
            upsert(c);
            setFilter("all");
            select(c.id);
          }}
        />
      )}
    </div>
  );
}
