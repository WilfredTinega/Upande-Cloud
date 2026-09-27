import { useState } from "react";
import type { ThreadMessage } from "./SupportThread";
import { ImpersonateDialog, type ImpersonateTarget } from "./ImpersonateDialog";
import type { AdminSupportConversation, AdminSupportMessage, SupportCategory, SupportResolution, SupportStatus } from "../types";

// Shared bits of the admin support UI (Support page + floating inbox widget).

export const btnSecondary =
  "px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors disabled:opacity-50";

export const CATEGORY_OPTIONS: { value: SupportCategory; label: string }[] = [
  { value: "issue", label: "Issue" },
  { value: "inquiry", label: "Inquiry" },
  { value: "faqs", label: "FAQs" },
  { value: "custom", label: "Custom" },
];

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

export function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString();
}

/** Admin panel shows real usernames; users only ever see "Upande Support". */
export function toThreadMessage(m: AdminSupportMessage): ThreadMessage {
  return {
    id: m.id,
    body: m.body,
    createdAt: m.createdAt,
    authorRole: m.authorRole,
    mine: m.mine,
    kind: m.kind,
    answer: m.answer,
    authorName: m.authorRole === "admin" ? `${m.byMe ? "You" : m.authorName} (support)` : m.authorName,
  };
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

export function InboxItem({
  c,
  selected,
  onSelect,
  grouped = false,
  compact = false,
}: {
  c: AdminSupportConversation;
  selected: boolean;
  onSelect: () => void;
  /** Inside an org/user group: the org line is redundant. */
  grouped?: boolean;
  compact?: boolean;
}) {
  return (
    <li>
      <button
        onClick={onSelect}
        className={`w-full text-left ${compact ? "px-3 py-2" : "px-4 py-3"} transition-colors ${
          selected ? "bg-brand-100 dark:bg-brand-800" : "hover:bg-brand-50 dark:hover:bg-brand-800/50"
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
        {!grouped && (
          <p className="mt-0.5 text-xs font-medium text-brand-600 dark:text-brand-300 truncate">{c.organization.name}</p>
        )}
        {c.lastMessage && !compact && (
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
  );
}

interface UserGroup {
  key: string;
  label: string;
  email: string | null;
  unread: number;
  conversations: AdminSupportConversation[];
}

interface OrgGroup {
  id: string;
  name: string;
  unread: number;
  count: number;
  users: UserGroup[];
}

/**
 * Group conversations by organization, then by creator. Input order (newest
 * activity first) is kept, so the most recently active org / user / thread
 * comes first at every level.
 */
export function groupByOrgUser(list: AdminSupportConversation[]): OrgGroup[] {
  const orgs = new Map<string, OrgGroup & { userMap: Map<string, UserGroup> }>();
  for (const c of list) {
    let o = orgs.get(c.organization.id);
    if (!o) {
      o = { id: c.organization.id, name: c.organization.name, unread: 0, count: 0, users: [], userMap: new Map() };
      orgs.set(c.organization.id, o);
    }
    o.count += 1;
    o.unread += c.unreadCount;
    const key = c.createdBy?.id ?? "deleted";
    let u = o.userMap.get(key);
    if (!u) {
      u = {
        key,
        label: c.createdBy?.username ?? "Deleted user",
        email: c.createdBy?.email ?? null,
        unread: 0,
        conversations: [],
      };
      o.userMap.set(key, u);
      o.users.push(u);
    }
    u.unread += c.unreadCount;
    u.conversations.push(c);
  }
  return [...orgs.values()].map(({ userMap: _unused, ...o }) => o);
}

function CountBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="shrink-0 min-w-[1.1rem] h-4 px-1 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-[0.6rem] font-bold">
      {n}
    </span>
  );
}

/** Inbox grouped by organization (collapsible) then by user. */
export function GroupedInbox({
  conversations,
  selectedId,
  onSelect,
  compact = false,
}: {
  conversations: AdminSupportConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pad = compact ? "px-3" : "px-4";

  return (
    <div className="flex-1 min-h-0 overflow-y-auto hide-scrollbar">
      {groupByOrgUser(conversations).map((o) => {
        const isOpen = !collapsed.has(o.id);
        return (
          <section key={o.id} className="border-b border-brand-200 dark:border-brand-700">
            <button
              type="button"
              onClick={() => toggle(o.id)}
              aria-expanded={isOpen}
              className={`sticky top-0 z-[1] w-full flex items-center gap-2 ${pad} py-2 bg-brand-100 dark:bg-brand-800 text-left hover:bg-brand-200/70 dark:hover:bg-brand-700/70 transition-colors`}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden
                className={`w-3.5 h-3.5 shrink-0 text-brand-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
              <span className="flex-1 min-w-0 truncate text-xs font-semibold text-brand-800 dark:text-brand-100">
                {o.name}
                <span className="ml-1.5 font-mono font-normal text-brand-400 dark:text-brand-500">{o.id}</span>
              </span>
              <span className="text-[0.7rem] text-brand-500 dark:text-brand-400">{o.count}</span>
              <CountBadge n={o.unread} />
            </button>
            {isOpen &&
              o.users.map((u) => (
                <div key={u.key}>
                  <div
                    className={`flex items-center gap-2 ${pad} py-1 bg-brand-50 dark:bg-brand-950/60 border-y border-brand-100 dark:border-brand-800 text-[0.7rem] text-brand-500 dark:text-brand-400`}
                    title={u.email ?? undefined}
                  >
                    <span className="flex-1 min-w-0 truncate font-semibold">{u.label}</span>
                    <span>{u.conversations.length}</span>
                    <CountBadge n={u.unread} />
                  </div>
                  <ul className="divide-y divide-brand-100 dark:divide-brand-800">
                    {u.conversations.map((c) => (
                      <InboxItem
                        key={c.id}
                        c={c}
                        grouped
                        compact={compact}
                        selected={c.id === selectedId}
                        onSelect={() => onSelect(c.id)}
                      />
                    ))}
                  </ul>
                </div>
              ))}
          </section>
        );
      })}
    </div>
  );
}

/** "Impersonate" for the conversation's user — hidden for superadmins and non-active users. */
export function ImpersonateButton({ user }: { user: AdminSupportConversation["createdBy"] }) {
  const [target, setTarget] = useState<ImpersonateTarget | null>(null);
  if (!user || user.role === "superadmin" || user.status !== "active") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setTarget({ id: user.id, username: user.username, email: user.email })}
        title={`Impersonate ${user.username}`}
        className={btnSecondary}
      >
        Impersonate
      </button>
      <ImpersonateDialog target={target} onClose={() => setTarget(null)} />
    </>
  );
}
