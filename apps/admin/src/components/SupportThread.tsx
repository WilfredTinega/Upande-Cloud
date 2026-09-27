import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useAutoGrow } from "./useAutoGrow";
import { useChatMute } from "../lib/useChatMute";

/** Minimal message shape the thread renders (both apps map onto this). */
export interface ThreadMessage {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  authorRole: "user" | "admin";
  /** Right-aligned "own side" bubble. */
  mine: boolean;
  kind?: "text" | "resolution_request" | "resolution_answer";
  /** resolution_answer only: true = solved. */
  answer?: boolean | null;
}

type Outcome = "pending" | "solved" | "unsolved" | "superseded" | "none";

/**
 * Outcome of each "Is this solved?" card: the first answer after it (before the
 * next question), else pending (latest question while one is pending), else
 * superseded (a newer question followed) or none (dropped by a close).
 */
function resolutionOutcomes(messages: ThreadMessage[], pending: boolean): Map<string, Outcome> {
  const out = new Map<string, Outcome>();
  let open: string | null = null;
  for (const m of messages) {
    if (m.kind === "resolution_request") {
      if (open) out.set(open, "superseded");
      open = m.id;
    } else if (m.kind === "resolution_answer" && open) {
      out.set(open, m.answer ? "solved" : "unsolved");
      open = null;
    }
  }
  if (open) out.set(open, pending ? "pending" : "none");
  return out;
}

const outcomeLabel: Record<Exclude<Outcome, "pending">, string> = {
  solved: "Solved",
  unsolved: "Not solved",
  superseded: "Superseded",
  none: "No answer",
};

function ResolutionCard({
  m,
  outcome,
  onAnswer,
}: {
  m: ThreadMessage;
  outcome: Outcome;
  onAnswer?: (solved: boolean) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const d = new Date(m.createdAt);
  const answer = async (solved: boolean) => {
    if (!onAnswer || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAnswer(solved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the answer.");
    } finally {
      setBusy(false);
    }
  };
  const chip =
    outcome === "solved"
      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
      : outcome === "unsolved"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
        : "bg-brand-100 text-brand-500 dark:bg-brand-800 dark:text-brand-400";
  return (
    <div className="self-center w-full max-w-sm rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 px-4 py-3 flex flex-col gap-2.5 text-center">
      <span className="text-xs text-brand-500 dark:text-brand-400">
        <span className="font-medium text-brand-700 dark:text-brand-300">{m.authorName}</span>
        {" · "}
        <time dateTime={m.createdAt} title={d.toLocaleString()}>
          {timeLabel(d)}
        </time>
      </span>
      <p className="text-sm font-semibold text-brand-900 dark:text-brand-50">{m.body}</p>
      {outcome === "pending" && onAnswer ? (
        <div className="flex justify-center gap-2">
          <button
            type="button"
            onClick={() => void answer(true)}
            disabled={busy}
            className="px-4 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors disabled:opacity-50"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => void answer(false)}
            disabled={busy}
            className="px-4 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-semibold hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors disabled:opacity-50"
          >
            No
          </button>
        </div>
      ) : (
        <span className={`self-center px-2 py-0.5 rounded text-[0.7rem] font-semibold uppercase tracking-wide ${chip}`}>
          {outcome === "pending" ? "Awaiting answer" : outcomeLabel[outcome]}
        </span>
      )}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

export const MESSAGE_MAX = 5000;

function dayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function timeLabel(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/**
 * Chat thread: day-grouped bubbles (own side right-aligned), author + time on
 * each, auto-scroll to the newest message, and a composer where Enter sends
 * and Shift+Enter inserts a newline. Kept identical between the dashboard and
 * admin apps.
 */
export function SupportThread({
  messages,
  onSend,
  closed,
  closedNote,
  header,
  placeholder = "Write a message…",
  resolutionPending = false,
  onAnswer,
}: {
  messages: ThreadMessage[];
  onSend: (body: string) => Promise<void>;
  closed: boolean;
  /** Shown instead of the composer when the conversation is closed. */
  closedNote?: ReactNode;
  header: ReactNode;
  placeholder?: string;
  /** A "Is this solved?" question is awaiting an answer. */
  resolutionPending?: boolean;
  /** Present on the user side: renders Yes / No on the pending card. */
  onAnswer?: (solved: boolean) => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const textareaRef = useAutoGrow(draft);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Stick to the bottom unless the reader scrolled up to read history.
  const pinned = useRef(true);
  const lastCount = useRef(0);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const grew = messages.length > lastCount.current;
    const lastMine = messages[messages.length - 1]?.mine;
    // First render of a thread, own message, or reader already at the bottom.
    if (lastCount.current === 0 || (grew && (lastMine || pinned.current))) {
      el.scrollTop = el.scrollHeight;
      pinned.current = true;
    }
    lastCount.current = messages.length;
  }, [messages]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || closed) return;
    if (body.length > MESSAGE_MAX) {
      setSendError(`Messages can be at most ${MESSAGE_MAX} characters.`);
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await onSend(body);
      setDraft("");
      textareaRef.current?.focus();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Could not send the message.");
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter is a newline. Ignore Enter while an IME is
    // composing (e.g. picking a CJK candidate).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  let lastDay = "";
  const outcomes = resolutionOutcomes(messages, resolutionPending && !closed);
  const over = draft.length > MESSAGE_MAX;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-b border-brand-200 dark:border-brand-700">
        <div className="flex-1 min-w-0">{header}</div>
        <MuteToggle />
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3"
      >
        {messages.length === 0 && (
          <p className="m-auto text-sm text-brand-400 dark:text-brand-500">No messages yet.</p>
        )}
        {messages.map((m) => {
          const d = new Date(m.createdAt);
          const day = dayLabel(d);
          const showDay = day !== lastDay;
          lastDay = day;
          return (
            <div key={m.id} className="flex flex-col">
              {showDay && (
                <div className="my-2 flex items-center gap-3 text-[0.7rem] font-medium uppercase tracking-wide text-brand-400 dark:text-brand-500">
                  <span className="flex-1 h-px bg-brand-100 dark:bg-brand-800" />
                  {day}
                  <span className="flex-1 h-px bg-brand-100 dark:bg-brand-800" />
                </div>
              )}
              {m.kind === "resolution_request" ? (
                <ResolutionCard m={m} outcome={outcomes.get(m.id) ?? "none"} onAnswer={onAnswer} />
              ) : m.kind === "resolution_answer" ? (
                <div className="self-center flex items-center gap-1.5 text-xs text-brand-500 dark:text-brand-400">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${m.answer ? "bg-green-500" : "bg-amber-500"}`}
                    aria-hidden="true"
                  />
                  <span className="font-medium text-brand-700 dark:text-brand-300">
                    {m.answer ? m.body : `${m.body} · ${m.authorName}`}
                  </span>
                  {" · "}
                  <time dateTime={m.createdAt} title={d.toLocaleString()}>
                    {timeLabel(d)}
                  </time>
                </div>
              ) : (
              <div className={`flex flex-col max-w-[75%] ${m.mine ? "self-end items-end" : "self-start items-start"}`}>
                <span className="mb-1 text-xs text-brand-500 dark:text-brand-400">
                  <span className="font-medium text-brand-700 dark:text-brand-300">{m.authorName}</span>
                  {" · "}
                  <time dateTime={m.createdAt} title={d.toLocaleString()}>
                    {timeLabel(d)}
                  </time>
                </span>
                <div
                  className={`rounded-lg px-3.5 py-2 text-sm whitespace-pre-wrap break-words ${
                    m.mine
                      ? "bg-brand-700 text-white dark:bg-brand-200 dark:text-brand-900 rounded-br-sm"
                      : "bg-brand-100 text-brand-900 dark:bg-brand-800 dark:text-brand-50 rounded-bl-sm"
                  }`}
                >
                  {m.body}
                </div>
              </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-brand-200 dark:border-brand-700 px-5 py-3">
        {closed ? (
          <div className="text-sm text-brand-500 dark:text-brand-400">{closedNote ?? "This conversation is closed."}</div>
        ) : (
          <>
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                aria-label="Message"
                className="flex-1 resize-none max-h-48 overflow-y-auto px-3 py-2 rounded border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 text-sm text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || !draft.trim() || over}
                className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
            {(sendError || draft.length > MESSAGE_MAX - 500) && (
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className="text-red-600 dark:text-red-400">{sendError}</span>
              {draft.length > MESSAGE_MAX - 500 && (
                <span className={over ? "text-red-600 dark:text-red-400" : "text-brand-400 dark:text-brand-500"}>
                  {draft.length}/{MESSAGE_MAX}
                </span>
              )}
            </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Speaker toggle for the incoming-message chime (remembered per browser). */
function MuteToggle() {
  const [muted, toggle] = useChatMute();
  return (
    <button
      type="button"
      onClick={toggle}
      title={muted ? "Unmute message sound" : "Mute message sound"}
      aria-label={muted ? "Unmute message sound" : "Mute message sound"}
      aria-pressed={muted}
      className="shrink-0 p-1.5 rounded text-brand-500 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200 transition-colors"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="w-4 h-4">
        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
        {muted ? <path d="m23 9-6 6M17 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />}
      </svg>
    </button>
  );
}
