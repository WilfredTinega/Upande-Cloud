import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supportApi } from "../lib/api";
import { useAuth } from "../lib/auth";
import { playMessageChime } from "../lib/sound";
import type { SupportConversation, SupportStreamEvent } from "../types";

/** Fired on window so the bell re-polls immediately when a reply streams in. */
export const NOTIFICATIONS_REFRESH_EVENT = "upande:notifications-refresh";

// Fallback polling while the stream is down, and reconnect backoff bounds.
const POLL_MS = 15_000;
const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

type Listener = (event: SupportStreamEvent) => void;

interface SupportContextValue {
  /** The org's conversations, newest activity first (shared by page + widget). */
  conversations: SupportConversation[];
  listLoading: boolean;
  listError: string | null;
  /** Unread Upande Support messages across the org's conversations. */
  unreadCount: number;
  /** True while the live stream is connected; views poll when it's false. */
  live: boolean;
  /** Receive raw stream events (new messages, status/unread changes). */
  subscribe: (fn: Listener) => () => void;
  reloadList: () => Promise<void>;
  upsert: (c: SupportConversation) => void;
}

const SupportContext = createContext<SupportContextValue | null>(null);

function sortByRecent(list: SupportConversation[]): SupportConversation[] {
  return [...list].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

/**
 * One shared support-chat stream (GET /v1/support/stream) and conversation
 * list for the signed-in user. Feeds the sidebar badge, the Support page and
 * the floating chat widget. If the stream drops it reconnects with backoff
 * and, meanwhile, polls the list (thread views poll their own messages).
 */
export function SupportProvider({ children }: { children: ReactNode }) {
  const { user, impersonatedBy } = useAuth();
  const [conversations, setConversations] = useState<SupportConversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const listeners = useRef(new Set<Listener>());

  const upsert = useCallback((c: SupportConversation) => {
    setConversations((curr) => sortByRecent([c, ...curr.filter((x) => x.id !== c.id)]));
  }, []);

  const reloadList = useCallback(
    () =>
      supportApi
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
        es = await supportApi.stream();
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
        // Catch up on anything missed while disconnected.
        void reloadList();
      };
      es.onmessage = (e) => {
        let data: SupportStreamEvent;
        try {
          data = JSON.parse(e.data) as SupportStreamEvent;
        } catch {
          return;
        }
        if (data.kind === "ping") return;
        if (data.conversation) upsert(data.conversation);
        // A reply from support → the server just created a bell notification.
        if (data.kind === "message" && data.message?.authorRole === "admin") {
          // Live message from support: chime once per message (deduped by id
          // with the bell's alert; history/reconnect reloads never chime).
          playMessageChime(data.message.id);
          if (!impersonatedBy) window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH_EVENT));
        }
        listeners.current.forEach((fn) => fn(data));
      };
      es.onerror = () => {
        // Close and retry ourselves with backoff rather than letting the
        // browser hammer the API; polling covers the gap.
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
  }, [user, impersonatedBy, reloadList, upsert]);

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
    // Zero-size anchor (its -ml-3 cancels the flex gap) so the dot overlays
    // the icon's top-right corner without shifting it.
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
