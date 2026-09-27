import { useCallback, useEffect, useRef, useState } from "react";
import { supportApi } from "./api";
import { useAuth } from "./auth";
import { NOTIFICATIONS_REFRESH_EVENT, useSupport } from "../context/SupportContext";
import type { SupportConversation, SupportMessage, SupportStatus } from "../types";

// While the live stream is down, re-fetch the open thread this often.
const FALLBACK_POLL_MS = 10_000;

export interface SupportThreadState {
  conversation: SupportConversation;
  messages: SupportMessage[];
}

/**
 * Load one support conversation and keep it live: merges streamed messages,
 * marks it read while it's on screen, polls when the stream is down. Shared by
 * the Support page and the floating chat widget (same stream, same list state).
 */
/**
 * `onMissing` runs when the conversation no longer exists (404) — e.g. a stale
 * id left in the URL or session — so the caller can drop the selection instead
 * of showing an error.
 */
export function useSupportThread(
  id: string | null,
  active = true,
  onMissing?: () => void,
) {
  const { user, impersonatedBy } = useAuth();
  const { live, subscribe, upsert } = useSupport();
  const [thread, setThread] = useState<SupportThreadState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const idRef = useRef(id);
  idRef.current = id;
  const activeRef = useRef(active);
  activeRef.current = active;
  const onMissingRef = useRef(onMissing);
  onMissingRef.current = onMissing;

  const markRead = useCallback(
    (cid: string) => {
      // Reading during impersonation is allowed; marking read is not (the API refuses).
      if (impersonatedBy) return;
      supportApi
        .markRead(cid)
        .then(({ conversation }) => {
          upsert(conversation);
          // Reading clears this thread's bell entries server-side; resync the bell.
          window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH_EVENT));
        })
        .catch(() => {
          /* best-effort */
        });
    },
    [upsert, impersonatedBy],
  );

  const load = useCallback(
    (cid: string, quiet = false) => {
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      return supportApi
        .get(cid)
        .then((data) => {
          if (idRef.current !== cid) return;
          setThread(data);
          upsert(data.conversation);
          if (data.conversation.unreadCount > 0 && activeRef.current && !document.hidden) markRead(cid);
        })
        .catch((err: unknown) => {
          if (idRef.current === cid && (err as { status?: number })?.status === 404 && onMissingRef.current) {
            setThread(null);
            onMissingRef.current();
            return;
          }
          if (!quiet) setError(err instanceof Error ? err.message : "Failed to load conversation");
        })
        .finally(() => {
          if (!quiet) setLoading(false);
        });
    },
    [upsert, markRead],
  );

  useEffect(() => {
    setThread(null);
    if (id) void load(id);
  }, [id, load]);

  // Merge live events for this conversation.
  useEffect(() => {
    return subscribe((event) => {
      const cid = idRef.current;
      if (!cid || event.conversationId !== cid) return;
      if (event.kind === "message" && event.message) {
        const msg = { ...event.message, mine: event.message.authorUserId === user?.id };
        setThread((t) =>
          t && t.conversation.id === cid && !t.messages.some((m) => m.id === msg.id)
            ? { conversation: event.conversation ?? t.conversation, messages: [...t.messages, msg] }
            : t,
        );
        if (msg.authorRole === "admin" && activeRef.current && !document.hidden) markRead(cid);
      } else if (event.conversation) {
        const c = event.conversation;
        setThread((t) => (t && t.conversation.id === c.id ? { ...t, conversation: c } : t));
      }
    });
  }, [subscribe, markRead, user?.id]);

  // Back on the tab (or the view re-opened) with unread messages → mark read.
  useEffect(() => {
    const check = () => {
      const cid = idRef.current;
      if (cid && activeRef.current && !document.hidden && thread?.conversation.unreadCount) markRead(cid);
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [thread?.conversation.unreadCount, active, markRead]);

  // Polling fallback while the stream is disconnected.
  useEffect(() => {
    if (live || !id) return;
    const t = setInterval(() => void load(id, true), FALLBACK_POLL_MS);
    return () => clearInterval(t);
  }, [live, id, load]);

  const send = useCallback(
    async (body: string) => {
      const cid = idRef.current;
      if (!cid) return;
      const { conversation, message } = await supportApi.send(cid, body);
      upsert(conversation);
      setThread((t) =>
        t && t.conversation.id === cid
          ? {
              conversation,
              messages: t.messages.some((m) => m.id === message.id) ? t.messages : [...t.messages, message],
            }
          : t,
      );
    },
    [upsert],
  );

  const answerResolution = useCallback(
    async (solved: boolean) => {
      const cid = idRef.current;
      if (!cid) return;
      const { conversation, message } = await supportApi.answerResolution(cid, solved);
      upsert(conversation);
      setThread((t) =>
        t && t.conversation.id === cid
          ? {
              conversation,
              messages: t.messages.some((m) => m.id === message.id) ? t.messages : [...t.messages, message],
            }
          : t,
      );
    },
    [upsert],
  );

  const setStatus = useCallback(
    async (status: SupportStatus) => {
      const cid = idRef.current;
      if (!cid) return;
      setStatusBusy(true);
      try {
        const { conversation } = await supportApi.setStatus(cid, status);
        upsert(conversation);
        setThread((t) => (t && t.conversation.id === cid ? { ...t, conversation } : t));
      } finally {
        setStatusBusy(false);
      }
    },
    [upsert],
  );

  return { thread, loading, error, send, answerResolution, setStatus, statusBusy, live };
}
