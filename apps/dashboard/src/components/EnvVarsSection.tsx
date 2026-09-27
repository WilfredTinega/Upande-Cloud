import { FormEvent, useCallback, useEffect, useState } from "react";
import { appsApi } from "../lib/api";
import { useToast } from "../context/ToastContext";
import { SkeletonTable } from "./Skeleton";
import { Select } from "./Select";
import { ConfirmDialog } from "./ConfirmDialog";
import type { EnvScope, EnvVarItem } from "../types";

const TH =
  "text-left px-4 py-3 text-xs font-semibold text-brand-500 dark:text-brand-400 uppercase tracking-wider whitespace-nowrap";
const BTN =
  "px-2.5 py-1 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-300 text-xs font-medium hover:bg-brand-50 dark:hover:bg-brand-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";
const INPUT =
  "px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm font-mono placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500";

const SCOPE_LABEL: Record<EnvScope, string> = {
  all: "All",
  production: "Production",
  preview: "Preview",
};

export function scopeBadge(scope: EnvScope): string {
  const base = "inline-block px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap";
  if (scope === "production")
    return `${base} bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300`;
  if (scope === "preview")
    return `${base} bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`;
  return `${base} bg-brand-100 text-brand-700 dark:bg-brand-800 dark:text-brand-300`;
}

function ScopeSelect({
  value,
  onChange,
  id,
}: {
  value: EnvScope;
  onChange: (s: EnvScope) => void;
  id?: string;
}) {
  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as EnvScope)}
      aria-label="Environment"
      className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-900 text-brand-900 dark:text-brand-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
    >
      <option value="all">All environments</option>
      <option value="production">Production</option>
      <option value="preview">Preview</option>
    </Select>
  );
}

/** Env vars with an environment scope (all / production / preview). */
export function EnvVarsSection({ appId }: { appId: string }) {
  const toast = useToast();
  const [vars, setVars] = useState<EnvVarItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<EnvScope | "any">("any");

  const [showAdd, setShowAdd] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<EnvScope>("all");
  const [secret, setSecret] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editScope, setEditScope] = useState<EnvScope>("all");
  const [editSecret, setEditSecret] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<EnvVarItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(
    () =>
      appsApi
        .listEnvVars(appId)
        .then((res) => {
          setVars(res.envVars);
          setError(null);
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load env vars")),
    [appId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await appsApi.createEnvVar(appId, { key: key.trim(), value, scope, isSecret: secret });
      toast.success(`${key.trim()} saved. Applies on the next deploy.`);
      setKey("");
      setValue("");
      setSecret(false);
      setShowAdd(false);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save env var");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(v: EnvVarItem) {
    setEditId(v.id);
    setEditValue(v.isSecret ? "" : (v.value ?? ""));
    setEditScope(v.scope);
    setEditSecret(v.isSecret);
  }

  async function saveEdit(v: EnvVarItem) {
    setSaving(true);
    try {
      // A blank value on a secret keeps the stored one.
      const valueChanged = v.isSecret ? editValue !== "" : editValue !== (v.value ?? "");
      await appsApi.updateEnvVar(appId, v.id, {
        scope: editScope,
        isSecret: editSecret,
        ...(valueChanged ? { value: editValue } : {}),
      });
      toast.success(`${v.key} updated. Applies on the next deploy.`);
      setEditId(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update env var");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await appsApi.deleteEnvVar(appId, deleteTarget.id);
      toast.success(`${deleteTarget.key} deleted.`);
      setDeleteTarget(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete env var");
    } finally {
      setDeleting(false);
    }
  }

  const shown = (vars ?? []).filter((v) => filter === "any" || v.scope === filter);
  const filters: (EnvScope | "any")[] = ["any", "all", "production", "preview"];

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50">Environment variables</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded border border-brand-300 dark:border-brand-600 overflow-hidden" role="group" aria-label="Filter by environment">
            {filters.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === f
                    ? "bg-brand-700 text-white dark:bg-brand-200 dark:text-brand-900"
                    : "text-brand-600 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-800"
                }`}
              >
                {f === "any" ? "Everything" : SCOPE_LABEL[f]}
              </button>
            ))}
          </div>
          {!showAdd && (
            <button
              onClick={() => setShowAdd(true)}
              className="px-3 py-1.5 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-xs font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 transition-colors"
            >
              Add variable
            </button>
          )}
        </div>
      </div>

      {showAdd && (
        <form
          onSubmit={onAdd}
          className="mb-4 p-4 rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800 flex flex-wrap items-end gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="envKey" className="text-xs font-medium text-brand-700 dark:text-brand-300">
              Key
            </label>
            <input
              id="envKey"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              pattern="[A-Za-z_][A-Za-z0-9_]*"
              placeholder="API_URL"
              className={INPUT}
            />
          </div>
          <div className="flex flex-col gap-1.5 flex-1 min-w-[12rem]">
            <label htmlFor="envValue" className="text-xs font-medium text-brand-700 dark:text-brand-300">
              Value
            </label>
            <input
              id="envValue"
              type={secret ? "password" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
              className={INPUT}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="envScope" className="text-xs font-medium text-brand-700 dark:text-brand-300">
              Environment
            </label>
            <ScopeSelect id="envScope" value={scope} onChange={setScope} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-brand-700 dark:text-brand-300 pb-2">
            <input type="checkbox" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
            Secret
          </label>
          <div className="flex gap-2 pb-0.5">
            <button
              type="submit"
              disabled={saving || !key.trim()}
              className="px-3 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-xs font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-600 dark:text-brand-400 text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {vars === null && !error ? (
        <SkeletonTable columns={["Key", "Value", "Environment", ""]} rows={2} />
      ) : error && !vars ? (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-brand-400 dark:text-brand-500">No variables.</p>
      ) : (
        <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 overflow-x-auto scrollbar-hide">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-200 dark:border-brand-700">
                <th className={TH}>Key</th>
                <th className={TH}>Value</th>
                <th className={TH}>Environment</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {shown.map((v, idx) => {
                const editing = editId === v.id;
                return (
                  <tr
                    key={v.id}
                    className={idx < shown.length - 1 ? "border-b border-brand-100 dark:border-brand-800" : ""}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-brand-800 dark:text-brand-200 whitespace-nowrap">
                      {v.key}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-brand-600 dark:text-brand-300 max-w-[20rem] truncate">
                      {editing ? (
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          type={editSecret ? "password" : "text"}
                          placeholder={v.isSecret ? "Unchanged" : ""}
                          autoComplete="off"
                          aria-label={`Value of ${v.key}`}
                          className={`${INPUT} w-full py-1`}
                        />
                      ) : v.isSecret ? (
                        <span className="text-brand-400 dark:text-brand-500">••••••••</span>
                      ) : (
                        v.value
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {editing ? (
                        <div className="flex items-center gap-2">
                          <ScopeSelect value={editScope} onChange={setEditScope} />
                          <label className="flex items-center gap-1 text-xs text-brand-700 dark:text-brand-300">
                            <input
                              type="checkbox"
                              checked={editSecret}
                              onChange={(e) => setEditSecret(e.target.checked)}
                            />
                            Secret
                          </label>
                        </div>
                      ) : (
                        <>
                          <span className={scopeBadge(v.scope)}>{SCOPE_LABEL[v.scope]}</span>
                          {v.isSecret && (
                            <span className="ml-1.5 text-[11px] text-brand-400 dark:text-brand-500">secret</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {editing ? (
                        <>
                          <button onClick={() => void saveEdit(v)} disabled={saving} className={`${BTN} mr-2`}>
                            {saving ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => setEditId(null)} className={BTN}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(v)} className={`${BTN} mr-2`}>
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteTarget(v)}
                            className="px-2.5 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete ${deleteTarget.key}?`}
          message={`${deleteTarget.key} (${SCOPE_LABEL[deleteTarget.scope]}) is removed on the next deploy.`}
          confirmLabel="Delete"
          destructive
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </section>
  );
}
