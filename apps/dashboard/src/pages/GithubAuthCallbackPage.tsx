import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

/**
 * Landing page for "Sign in with GitHub". The API redirects here with the
 * session JWT in the URL fragment (#token=...&redirect=/apps) — fragments are
 * never sent to servers or leaked via Referer. We scrub it from history, adopt
 * the token, and continue into the dashboard.
 */
export function GithubAuthCallbackPage() {
  const navigate = useNavigate();
  const { adoptToken } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    window.history.replaceState(null, "", window.location.pathname);

    const token = params.get("token");
    const redirectParam = params.get("redirect");
    const redirectTo =
      redirectParam && redirectParam.startsWith("/") && !redirectParam.startsWith("//")
        ? redirectParam
        : "/apps";
    if (!token) {
      setError("GitHub sign-in did not return a session. Please try again.");
      return;
    }
    adoptToken(token)
      .then(() => navigate(redirectTo, { replace: true }))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "GitHub sign-in failed. Please try again."),
      );
  }, [adoptToken, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50 dark:bg-brand-950 px-4">
      {error ? (
        <div className="max-w-sm w-full rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-brand-900 p-6 text-center">
          <p className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</p>
          <button
            onClick={() => navigate("/login", { replace: true })}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors"
          >
            Go to login
          </button>
        </div>
      ) : (
        <p className="text-sm text-brand-500 dark:text-brand-400">Signing you in with GitHub...</p>
      )}
    </div>
  );
}
