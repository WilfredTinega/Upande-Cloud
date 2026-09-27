import { useEffect, useState } from "react";

const STORAGE_KEY = "upande-sidebar-collapsed";
// Widths the fixed-position page chrome (e.g. the admin PageHeader) reads via
// the --sidebar-w CSS variable, so it stays aligned when the sidebar collapses.
export const SIDEBAR_WIDTH = { expanded: "13rem", collapsed: "4rem" } as const;

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Collapsed/expanded state of the sidebar, remembered per browser. */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // Storage unavailable (private mode etc.) — the toggle still works for this visit.
    }
    document.documentElement.style.setProperty(
      "--sidebar-w",
      collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded,
    );
  }, [collapsed]);

  return { collapsed, toggle: () => setCollapsed((c) => !c) };
}
