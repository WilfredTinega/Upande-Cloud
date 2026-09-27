import { FormEvent, useEffect, useState } from "react";
import { adminApi } from "../lib/api";

export interface ImpersonateTarget {
  id: string;
  username?: string | null;
  email: string;
}

/**
 * Confirms an impersonation with the admin's own password, then opens the
 * dashboard in a new tab signed in as the target user. Used wherever the admin
 * panel offers "Impersonate" (Users, Organizations, Apps, Support).
 */
export function ImpersonateDialog({
  target,
  onClose,
}: {
  target: ImpersonateTarget | null;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh form each time the dialog opens for a user.
  useEffect(() => {
    setPassword("");
    setReason("");
    setError(null);
    setBusy(false);
  }, [target?.id]);

  useEffect(() => {
    if (!target) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [target, busy, onClose]);

  if (!target) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target || !password || !reasonOk) return;
    setBusy(true);
    setError(null);
    try {
      const { dashboardUrl } = await adminApi.impersonateUser(target.id, password, reason.trim());
      // Open the dashboard in a new tab, already logged in as the target user.
      window.open(dashboardUrl, "_blank", "noopener");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start session");
      setBusy(false);
    }
  }

  const name = target.username || target.email;
  const reasonOk = reason.trim().length >= 5;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Impersonate ${name}`}
      onMouseDown={() => !busy && onClose()}
    >
      <form
        onSubmit={submit}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 shadow-xl flex flex-col gap-4"
      >
        <div>
          <h2 className="text-lg font-semibold text-brand-800 dark:text-brand-100">
            Impersonate {name}
          </h2>
          {target.username && (
            <p className="text-sm text-brand-500 dark:text-brand-400">{target.email}</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="impersonate-reason"
            className="text-sm font-medium text-brand-700 dark:text-brand-300"
          >
            Reason
          </label>
          <textarea
            id="impersonate-reason"
            rows={3}
            autoFocus
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            placeholder="e.g. Investigating the failed deploy reported in support"
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 resize-none focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50 transition-colors"
          />
          <p className="text-xs text-brand-400 dark:text-brand-500">
            {name} will see this and your name in a notification.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="impersonate-password"
            className="text-sm font-medium text-brand-700 dark:text-brand-300"
          >
            Your password
          </label>
          <input
            id="impersonate-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-50 transition-colors"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-800 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !password || !reasonOk}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {busy ? "Starting…" : "Impersonate"}
          </button>
        </div>
      </form>
    </div>
  );
}
