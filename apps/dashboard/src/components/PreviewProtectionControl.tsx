import { FormEvent, useState } from "react";
import { appsApi } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { ConfirmDialog } from "./ConfirmDialog";
import type { PreviewProtection } from "../types";

const INPUT =
  "px-3 py-1.5 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500";
const BTN =
  "px-2.5 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

export function LockIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        d="M10 2a4 4 0 0 0-4 4v2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1V6a4 4 0 0 0-4-4Zm2 6V6a2 2 0 1 0-4 0v2h4Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

/** "Protect previews" toggle + set/change password (basic auth on preview URLs). */
export function PreviewProtectionControl({
  appId,
  protection,
  onChange,
}: {
  appId: string;
  protection: PreviewProtection | null;
  onChange: (p: PreviewProtection) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);

  const enabled = !!protection?.enabled;

  function report(res: PreviewProtection, what: string) {
    if (res.failed?.length) toast.error(`${what}, but these previews were not updated: ${res.failed.join(", ")}`);
    else toast.success(what);
  }

  function openForm() {
    setUsername(protection?.username ?? "preview");
    setPassword("");
    setEditing(true);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await appsApi.setPreviewProtection(appId, { username: username.trim(), password });
      onChange(res);
      report(res, enabled ? "Preview password changed" : "Previews protected");
      setEditing(false);
      setPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function disable() {
    setSaving(true);
    try {
      const res = await appsApi.disablePreviewProtection(appId);
      onChange(res);
      report(res, "Preview protection off");
      setConfirmOff(false);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to turn off");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
      <label className="flex items-center gap-2 text-brand-700 dark:text-brand-300 font-medium">
        <input
          type="checkbox"
          checked={enabled || editing}
          disabled={protection === null || saving}
          onChange={(e) => {
            if (e.target.checked) openForm();
            else if (enabled) setConfirmOff(true);
            else setEditing(false);
          }}
        />
        Protect previews
      </label>
      {enabled && !editing && (
        <>
          <span className="inline-flex items-center gap-1 text-xs text-brand-500 dark:text-brand-400">
            <LockIcon className="w-3 h-3" />
            {protection?.username}
          </span>
          <button type="button" onClick={openForm} className={BTN}>
            Change password
          </button>
        </>
      )}
      {editing && (
        <form onSubmit={onSave} className="flex flex-wrap items-center gap-2">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            pattern="[A-Za-z0-9._\-]{1,64}"
            aria-label="Username"
            placeholder="Username"
            autoComplete="off"
            className={`${INPUT} w-32`}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            maxLength={128}
            aria-label="Password"
            placeholder="Password"
            autoComplete="new-password"
            className={`${INPUT} w-44`}
          />
          <button type="submit" disabled={saving || password.length < 8} className={BTN}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className={BTN}>
            Cancel
          </button>
        </form>
      )}
      {confirmOff && (
        <ConfirmDialog
          title="Turn off preview protection?"
          message="Preview URLs become public again."
          confirmLabel="Turn off"
          destructive
          busy={saving}
          onConfirm={() => void disable()}
          onCancel={() => setConfirmOff(false)}
        />
      )}
    </div>
  );
}
