import { NavLink, Outlet } from "react-router-dom";
import { TopBar } from "./TopBar";
import { SidebarAccount } from "./SidebarAccount";
import { NavIcon } from "./NavIcon";
import { SIDEBAR_WIDTH, useSidebarCollapsed } from "./useSidebarCollapsed";
import { SupportNavBadge } from "../context/SupportContext";
import { useAuth } from "../lib/auth";

interface NavItem {
  label: string;
  to: string;
  /** Only render for superadmins (backend enforces the actual access). */
  superadminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Metrics", to: "/metrics" },
  { label: "Resources", to: "/resources" },
  { label: "Users", to: "/users" },
  { label: "Organizations", to: "/organizations" },
  { label: "Apps", to: "/apps" },
  { label: "DNS", to: "/dns" },
  { label: "Root Access", to: "/root-access", superadminOnly: true },
  { label: "Zone CLI", to: "/zone-cli", superadminOnly: true },
  { label: "Errors", to: "/errors" },
  { label: "Audit", to: "/audit" },
  { label: "Support", to: "/support" },
  { label: "Settings", to: "/settings" },
];

export function Layout() {
  const { user } = useAuth();
  const { collapsed, toggle } = useSidebarCollapsed();
  const navItems = NAV_ITEMS.filter(
    (item) => !item.superadminOnly || user?.role === "superadmin",
  );
  return (
    <div className="h-screen flex flex-col bg-white dark:bg-brand-950">
      <TopBar title="Upande Cloud Admin" />
      <div className="flex flex-1 min-h-0">
        <aside
          style={{ width: collapsed ? SIDEBAR_WIDTH.collapsed : SIDEBAR_WIDTH.expanded }}
          className="relative shrink-0 border-r border-brand-200 dark:border-brand-700 bg-brand-100 dark:bg-brand-900 flex flex-col py-4 transition-[width] duration-200 ease-in-out"
        >
          {/* Collapse / expand: a round button centred on the border between the
              sidebar and the main area. Collapsed, the sidebar is an icon strip
              and each tab's name shows as a tooltip. */}
          <button
            type="button"
            onClick={toggle}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="absolute top-1/2 -right-3 -translate-y-1/2 z-20 h-6 w-6 rounded-full border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 text-brand-500 dark:text-brand-400 shadow-sm flex items-center justify-center hover:bg-brand-100 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${collapsed ? "rotate-180" : ""}`}>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <nav className="flex flex-col gap-1 px-2 overflow-hidden">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  [
                    // Fixed padding keeps each icon in place while the width
                    // animates; the label fades instead of popping in/out.
                    "flex items-center gap-3 px-3 py-2 rounded text-sm font-medium whitespace-nowrap overflow-hidden transition-colors",
                    isActive
                      ? "bg-brand-800 text-white dark:bg-brand-200 dark:text-brand-900"
                      : "text-brand-600 dark:text-brand-400 hover:bg-brand-200 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200",
                  ].join(" ")
                }
              >
                <NavIcon to={item.to} />
                <span
                  className={`truncate transition-opacity duration-200 ${collapsed ? "opacity-0" : "opacity-100"}`}
                  aria-hidden={collapsed || undefined}
                >
                  {item.label}
                </span>
                {item.to === "/support" && <SupportNavBadge collapsed={collapsed} />}
              </NavLink>
            ))}
          </nav>

          {/* Account controls pinned to the bottom of the sidebar. */}
          <SidebarAccount collapsed={collapsed} />
        </aside>
        <main className="flex-1 min-w-0 min-h-0 overflow-y-auto p-6 hide-scrollbar flex flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
