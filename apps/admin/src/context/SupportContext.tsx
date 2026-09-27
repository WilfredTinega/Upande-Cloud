import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supportAdminApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { playMessageChime } from "../lib/sound";
import type { AdminSupportConversation, AdminSupportStreamEvent } from "../types";

/** Fired on window so the bell re-polls immediately when a user message streams in. */
export const NOTIFICATIONS_REFRESH_EVENT = "upande:notifications-refresh";

const POLL_MS = 15_000;
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

type Listener = (event: AdminSupportStreamEvent) => void;

interface SupportContextValue {
  /** Every conversation (all orgs), newest activity first. Shared by the inbox page and widget. */
  conversations: AdminSupportConversation[];
  listLoading: boolean;
  listError: string | null;
  /** Unread user messages across all conversations (tab/button badge). */
  unreadCount: number;
  live: boolean;
  subscribe: (fn: Listener) => () => void;
  reloadList: () => Promise<void>;
  upsert: (c: AdminSupportConversation) => void;
}

const SupportContext = createContext<SupportContextValue | null>(null);

function sortByRecent(list: AdminSupportConversation[]): AdminSupportConversation[] {
  return [...list].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

/**
 * One shared admin support stream (GET /v1/admin/support/stream) and inbox
 * list. Reconnects with backoff when it drops and polls the list meanwhile.
 */
export function SupportProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<AdminSupportConversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const listeners = useRef(new Set<Listener>());

  const upsert = useCallback((c: AdminSupportConversation) => {
    setConversations((curr) => sortByRecent([c, ...curr.filter((x) => x.id !== c.id)]));
  }, []);

  const reloadList = useCallback(
    () =>
      supportAdminApi
        .list()
        .then(({ conversations: list }) => {
          setConversations(sortByRecent(list));
          setListError(null);
        })
        .catch((err: unknown) =>
          setListError(err instanceof Error ? err.message : "Failed to load conversations"),
        )
        .finally(() => setListLoading(false)),
    [],
  );

  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    let closed = false;
    let es: EventSource | null = null;
    let retryMs = RETRY_MIN_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      if (closed) return;
      try {
        es = await supportAdminApi.stream();
      } catch {
        // Couldn't get a stream ticket (offline / API restarting): back off.
        setLive(false);
        retryTimer = setTimeout(() => void connect(), retryMs);
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
        return;
      }
      if (closed) {
        es.close();
        return;
      }
      es.onopen = () => {
        retryMs = RETRY_MIN_MS;
        setLive(true);
        void reloadList();
      };
      es.onmessage = (e) => {
        let data: AdminSupportStreamEvent;
        try {
          data = JSON.parse(e.data) as AdminSupportStreamEvent;
        } catch {
          return;
        }
        if (data.kind === "ping") return;
        if (data.conversation) upsert(data.conversation);
        if (data.kind === "message" && data.message?.authorRole === "user") {
          // Live message from a user: chime once per message (deduped by id
          // with the bell's alert; history/reconnect reloads never chime).
          playMessageChime(data.message.id);
          window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH_EVENT));
        }
        listeners.current.forEach((fn) => fn(data));
      };
      es.onerror = () => {
        es?.close();
        setLive(false);
        if (closed) return;
        retryTimer = setTimeout(() => void connect(), retryMs);
        retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
      };
    };

    void reloadList();
    void connect();
    const poll = setInterval(() => {
      if (!es || es.readyState !== EventSource.OPEN) void reloadList();
    }, POLL_MS);

    return () => {
      closed = true;
      clearInterval(poll);
      clearTimeout(retryTimer);
      es?.close();
      setLive(false);
    };
  }, [user, reloadList, upsert]);

  const unreadCount = conversations.reduce((n, c) => n + c.unreadCount, 0);

  return (
    <SupportContext.Provider
      value={{ conversations, listLoading, listError, unreadCount, live, subscribe, reloadList, upsert }}
    >
      {children}
    </SupportContext.Provider>
  );
}

export function useSupport(): SupportContextValue {
  const ctx = useContext(SupportContext);
  if (!ctx) throw new Error("useSupport must be used within a SupportProvider");
  return ctx;
}

/** Small unread pill for the sidebar's Support tab. */
export function SupportNavBadge({ collapsed }: { collapsed: boolean }) {
  const ctx = useContext(SupportContext);
  const n = ctx?.unreadCount ?? 0;
  if (n <= 0) return null;
  if (collapsed) {
    return (
      <span className="relative w-0 h-0 -ml-3" aria-label={`${n} unread support messages`}>
        <span className="absolute -top-3 -left-1 w-2 h-2 rounded-full bg-red-600" />
      </span>
    );
  }
  return (
    <span
      aria-label={`${n} unread support messages`}
      className="ml-auto min-w-[1.25rem] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-[0.65rem] font-bold leading-none tabular-nums"
    >
      {n > 99 ? "99+" : n}
    </span>
  );
}
