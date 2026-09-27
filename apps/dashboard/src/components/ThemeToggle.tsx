import { useEffect } from "react";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../lib/auth";
import { authApi } from "../lib/api";

/**
 * Light/dark theme switch shown at the top right of the top bar. The choice is
 * saved to the signed-in user's account, and the account's saved theme is
 * applied when they sign in (on any browser or device).
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { user, impersonatedBy } = useAuth();

  // Apply the account's saved theme once it's known (on sign-in / page load).
  // Deliberately not re-run when `theme` changes, so a click isn't reverted.
  useEffect(() => {
    if (user?.theme === "light" || user?.theme === "dark") setTheme(user.theme);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.theme]);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    // Save to the account; failure is non-fatal (the local choice still applies).
    if (!!user && !impersonatedBy) authApi.updatePreferences({ theme: next }).catch(() => undefined);
  }
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={label}
      aria-label={label}
      className="p-2 rounded text-brand-500 dark:text-brand-400 hover:bg-brand-100 dark:hover:bg-brand-800 hover:text-brand-800 dark:hover:text-brand-200 transition-colors"
    >
      {theme === "dark" ? (
        // Sun: shown in dark mode, switches to light.
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true" className="h-5 w-5">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        // Moon: shown in light mode, switches to dark.
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-5 w-5">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
        </svg>
      )}
    </button>
  );
}
