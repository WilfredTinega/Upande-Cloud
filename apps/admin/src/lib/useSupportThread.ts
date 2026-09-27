import { useCallback, useEffect, useRef, useState } from "react";
import { supportAdminApi } from "./api";
import { NOTIFICATIONS_REFRESH_EVENT, useSupport } from "../context/SupportContext";
import type { AdminSupportConversation, AdminSupportMessage, SupportStatus } from "../types";

const FALLBACK_POLL_MS = 10_000;

export interface AdminThreadState {
  conversation: AdminSupportConversation;
  messages: AdminSupportMessage[];
}

/**
 * Load one conversation for the admin inbox and keep it live: merges streamed
 * messages, marks it read while on screen, polls when the stream is down.
 * Shared by the Support page and the floating inbox widget.
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
  const { live, subscribe, upsert } = useSupport();
  const [thread, setThread] = useState<AdminThreadState | null>(null);
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
      supportAdminApi
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
    [upsert],
  );

  const load = useCallback(
    (cid: string, quiet = false) => {
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      return supportAdminApi
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

  useEffect(() => {
    return subscribe((event) => {
      const cid = idRef.current;
      if (!cid || event.conversationId !== cid) return;
      if (event.kind === "message" && event.message) {
        const msg = event.message;
        setThread((t) =>
          t && t.conversation.id === cid && !t.messages.some((m) => m.id === msg.id)
            ? { conversation: event.conversation ?? t.conversation, messages: [...t.messages, msg] }
            : t,
        );
        if (msg.authorRole === "user" && activeRef.current && !document.hidden) markRead(cid);
      } else if (event.conversation) {
        const c = event.conversation;
        setThread((t) => (t && t.conversation.id === c.id ? { ...t, conversation: c } : t));
      }
    });
  }, [subscribe, markRead]);

  useEffect(() => {
    const check = () => {
      const cid = idRef.current;
      if (cid && activeRef.current && !document.hidden && thread?.conversation.unreadCount) markRead(cid);
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, [thread?.conversation.unreadCount, active, markRead]);

  useEffect(() => {
    if (live || !id) return;
    const t = setInterval(() => void load(id, true), FALLBACK_POLL_MS);
    return () => clearInterval(t);
  }, [live, id, load]);

  const send = useCallback(
    async (body: string) => {
      const cid = idRef.current;
      if (!cid) return;
      const { conversation, message } = await supportAdminApi.reply(cid, body);
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

  const askResolution = useCallback(
    async () => {
      const cid = idRef.current;
      if (!cid) return;
      const { conversation, message } = await supportAdminApi.askResolution(cid);
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
        const { conversation } = await supportAdminApi.setStatus(cid, status);
        upsert(conversation);
        setThread((t) => (t && t.conversation.id === cid ? { ...t, conversation } : t));
      } finally {
        setStatusBusy(false);
      }
    },
    [upsert],
  );

  return { thread, loading, error, send, askResolution, setStatus, statusBusy, live };
}
