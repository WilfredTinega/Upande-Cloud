import { useState, type FormEvent } from "react";
import { supportApi } from "../lib/api";
import { Modal } from "./Modal";
import { MESSAGE_MAX } from "./SupportThread";
import { useAutoGrow } from "./useAutoGrow";
import type { SupportCategory, SupportConversation, SupportResolution, SupportStatus } from "../types";

// Shared bits of the support chat UI (Support page + floating chat widget).

export const SUBJECT_MAX = 200;

export const CATEGORY_OPTIONS: { value: SupportCategory; label: string }[] = [
  { value: "issue", label: "Issue" },
  { value: "inquiry", label: "Inquiry" },
  { value: "faqs", label: "FAQs" },
  { value: "custom", label: "Custom" },
];

export const inputCls =
  "w-full px-3 py-2 rounded border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 text-sm text-brand-900 dark:text-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400";
export const btnPrimary =
  "px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
export const btnSecondary =
  "px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors disabled:opacity-50";

export function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

export function StatusPill({ status }: { status: SupportStatus }) {
  return (
    <span
      className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold uppercase tracking-wide ${
        status === "open"
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          : "bg-brand-100 text-brand-500 dark:bg-brand-800 dark:text-brand-400"
      }`}
    >
      {status}
    </span>
  );
}

/** "Solved" once answered Yes; "Awaiting answer" while a question is pending. */
export function ResolutionBadge({
  resolution,
  status,
}: {
  resolution: SupportResolution | null | undefined;
  status: SupportStatus;
}) {
  if (resolution === "solved") {
    return (
      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold uppercase tracking-wide bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        Solved
      </span>
    );
  }
  if (resolution === "pending" && status === "open") {
    return (
      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[0.65rem] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Awaiting answer
      </span>
    );
  }
  return null;
}

/** The immutable conversation reference ("ISSUE-0001") as a small mono badge. */
export function RefBadge({ reference }: { reference: string }) {
  return (
    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[0.65rem] font-semibold tracking-tight bg-brand-100 text-brand-700 dark:bg-brand-800 dark:text-brand-200 border border-brand-200 dark:border-brand-700">
      {reference}
    </span>
  );
}

export interface CreatorGroup {
  key: string;
  label: string;
  mine: boolean;
  conversations: SupportConversation[];
  unread: number;
}

/**
 * Group the org's conversations by creator: the viewer ("You") first, then
 * other members alphabetically, then threads whose creator was removed.
 * Conversations keep their incoming order (newest activity first).
 */
export function groupByCreator(list: SupportConversation[], myUserId: string | undefined): CreatorGroup[] {
  const map = new Map<string, CreatorGroup>();
  for (const c of list) {
    const id = c.createdBy?.id ?? "";
    const mine = !!myUserId && id === myUserId;
    let g = map.get(id);
    if (!g) {
      g = {
        key: id || "former",
        label: mine ? "You" : (c.createdBy?.username ?? "Former member"),
        mine,
        conversations: [],
        unread: 0,
      };
      map.set(id, g);
    }
    g.conversations.push(c);
    g.unread += c.unreadCount;
  }
  return [...map.values()].sort((a, b) => {
    if (a.mine !== b.mine) return a.mine ? -1 : 1;
    if (!a.key || a.key === "former") return 1;
    if (!b.key || b.key === "former") return -1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Category picker + Custom title + first message. Used by the New conversation
 * modal (Support page) and the floating widget.
 */
export function NewConversationForm({
  onCreated,
  onCancel,
  compact = false,
}: {
  onCreated: (c: SupportConversation) => void;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [category, setCategory] = useState<SupportCategory>("issue");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const bodyRef = useAutoGrow(body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCustom = category === "custom";
  const ready = body.trim().length > 0 && (!isCustom || title.trim().length > 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const { conversation } = await supportApi.create(
        category,
        isCustom ? title.trim() : undefined,
        body.trim(),
      );
      onCreated(conversation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the conversation");
      setBusy(false);
    }
  };

  const label = "text-sm font-medium text-brand-700 dark:text-brand-300";

  return (
    <form onSubmit={submit} className={`flex flex-col ${compact ? "gap-3 p-4 h-full overflow-y-auto" : "gap-4"}`}>
      <div className="flex flex-col gap-1.5">
        {!compact && <span className={label}>Category</span>}
        <div
          role="radiogroup"
          aria-label="Category"
          className="grid grid-cols-4 gap-1 p-1 rounded border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-950/40"
        >
          {CATEGORY_OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={category === o.value}
              onClick={() => setCategory(o.value)}
              className={`px-2 py-1.5 rounded text-xs font-semibold transition-colors ${
                category === o.value
                  ? "bg-brand-700 text-white dark:bg-brand-200 dark:text-brand-900"
                  : "text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      {isCustom && (
        <label className="flex flex-col gap-1.5">
          {!compact && <span className={label}>Title</span>}
          <input
            autoFocus
            value={title}
            maxLength={SUBJECT_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            aria-label="Title"
            className={inputCls}
          />
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        {!compact && <span className={label}>Message</span>}
        <textarea
          ref={bodyRef}
          value={body}
          maxLength={MESSAGE_MAX}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message"
          aria-label="Message"
          className={`${inputCls} resize-none max-h-48 overflow-y-auto`}
        />
        {!compact && (
          <span className="self-end text-xs text-brand-400 dark:text-brand-500">
            {body.length}/{MESSAGE_MAX}
          </span>
        )}
      </label>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className={compact ? "flex flex-col" : "flex justify-end gap-2"}>
        {onCancel && (
          <button type="button" onClick={onCancel} className={btnSecondary}>
            Cancel
          </button>
        )}
        <button type="submit" disabled={busy || !ready} className={btnPrimary}>
          {busy ? "Sending…" : "Start conversation"}
        </button>
      </div>
    </form>
  );
}

export function NewConversationModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: SupportConversation) => void;
}) {
  return (
    <Modal title="New support conversation" onClose={onClose}>
      <NewConversationForm onCreated={onCreated} onCancel={onClose} />
    </Modal>
  );
}
