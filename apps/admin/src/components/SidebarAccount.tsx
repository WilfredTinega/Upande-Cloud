import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { getDashboardUrl } from "../lib/api";

// Account control pinned to the bottom-left of the sidebar. The identity row is a
// button that toggles a dropdown (opening upward) with a link to the dashboard;
// the icon button beside it is the (only) logout. The theme switch is
// in the top bar and Settings is a sidebar tab.
export function SidebarAccount({ collapsed = false }: { collapsed?: boolean }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative mt-auto px-2 pt-3 border-t border-brand-200 dark:border-brand-700">
      {/* Avatar + name open the menu (Dashboard link); the single logout icon
          sits beside them, stacked under the avatar when collapsed. */}
      <div className={`flex items-center gap-1 ${collapsed ? "flex-col" : ""}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={collapsed ? user?.username : undefined}
        className="min-w-0 flex-1 flex items-center gap-2 p-1.5 rounded text-left overflow-hidden hover:bg-brand-200 dark:hover:bg-brand-800 transition-colors"
      >
        <span className="h-8 w-8 shrink-0 rounded-full bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold flex items-center justify-center uppercase">
          {user?.username?.[0] ?? "?"}
        </span>
        <div
          className={`min-w-0 flex-1 whitespace-nowrap transition-opacity duration-200 ${collapsed ? "opacity-0" : "opacity-100"}`}
          aria-hidden={collapsed || undefined}
        >
          <p className="text-sm font-medium text-brand-800 dark:text-brand-200 truncate" title={user?.username}>
            {user?.username ?? "—"}
          </p>
          <p className="text-xs text-brand-500 dark:text-brand-400 truncate" title={user?.email}>
            {user?.email ?? "—"}
          </p>
        </div>
      </button>
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
      </div>

      {open && (
        <div
          role="menu"
          className={`absolute bottom-full left-3 ${collapsed ? "w-48" : "right-3"} mb-1 rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shadow-lg py-1 z-30`}
        >
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              // The dashboard is a separate app — open it in a new tab.
              window.open(getDashboardUrl(), "_blank", "noopener");
            }}
            className="w-full text-left px-3 py-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200 transition-colors"
          >
            Dashboard
          </button>
        </div>
      )}
    </div>
  );
}
