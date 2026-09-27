import { useAuth } from "../lib/auth";

// Account control pinned to the bottom-left of the sidebar: avatar + name, and
// a single logout icon beside it (stacked under the avatar when the sidebar is
// collapsed). The theme switch is in the top bar and Account settings is a
// sidebar tab.
export function SidebarAccount({ collapsed = false }: { collapsed?: boolean }) {
  const { user, logout, impersonatedBy } = useAuth();
  // Viewing another user's account (admin impersonation): no logout here —
  // leave with "Exit" in the impersonation banner.
  const impersonating = !!impersonatedBy;

  return (
    <div className="relative mt-auto px-2 pt-3 border-t border-brand-200 dark:border-brand-700">
      <div className={`flex items-center gap-1 ${collapsed ? "flex-col" : ""}`}>
        <div
          title={collapsed ? user?.username : undefined}
          className="min-w-0 flex-1 flex items-center gap-2 p-1.5 rounded text-left overflow-hidden"
        >
          <span className="h-8 w-8 shrink-0 rounded-full bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold flex items-center justify-center uppercase">
            {user?.username?.[0] ?? "?"}
          </span>
          <div
            className={`min-w-0 flex-1 whitespace-nowrap transition-opacity duration-200 ${collapsed ? "opacity-0 w-0" : "opacity-100"}`}
            aria-hidden={collapsed || undefined}
          >
            <p className="text-sm font-medium text-brand-800 dark:text-brand-200 truncate" title={user?.username}>
              {user?.username ?? "—"}
            </p>
            <p className="text-xs text-brand-500 dark:text-brand-400 truncate" title={user?.email}>
              {user?.email ?? "—"}
            </p>
          </div>
        </div>
        {!impersonating && (
          <button
            type="button"
            onClick={logout}
            title="Log out"
            aria-label="Log out"
            className="shrink-0 w-9 p-2 rounded text-brand-500 dark:text-brand-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="M16 17l5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
