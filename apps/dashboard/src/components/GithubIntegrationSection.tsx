import { useState } from "react";
import { appsApi } from "../lib/api";
import { useToast } from "../context/ToastContext";
import type { App } from "../types";

type ToggleKey = "githubCommitStatus" | "githubPrComments";

const TOGGLES: { key: ToggleKey; label: string; help: string }[] = [
  {
    key: "githubCommitStatus",
    label: "Commit status checks",
    help: 'Sets "Upande Cloud — production" / "Upande Cloud — preview" checks (pending, success, failure) on each deployed commit, linking to the deployment.',
  },
  {
    key: "githubPrComments",
    label: "Pull request comments",
    help: "Posts one comment on the branch's open pull request with the preview URL, status, commit and deploy log — and edits that same comment on later deploys.",
  },
];

/**
 * GitHub PR integration for apps connected to a GitHub repo. Both toggles
 * default on. Reporting uses the app owner's GitHub connection and never fails
 * a deploy — GitHub errors show up as warnings in the deploy log.
 */
export function GithubIntegrationSection({ app, onSaved }: { app: App; onSaved: () => void }) {
  const toast = useToast();
  const [saving, setSaving] = useState<ToggleKey | null>(null);

  async function toggle(key: ToggleKey, value: boolean) {
    setSaving(key);
    try {
      await appsApi.update(app.id, { [key]: value });
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-base font-semibold text-brand-900 dark:text-brand-50 mb-1">GitHub</h2>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-3">
        Deploys of <code className="font-mono">{app.githubRepoFullName}</code> are reported back to GitHub.
      </p>
      <div className="bg-white dark:bg-brand-900 rounded-lg border border-brand-200 dark:border-brand-700 divide-y divide-brand-100 dark:divide-brand-800">
        {TOGGLES.map((t) => {
          const on = app[t.key] !== false;
          return (
            <label key={t.key} className="flex items-start gap-3 p-4 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 accent-brand-700"
                checked={on}
                disabled={saving !== null}
                onChange={(e) => void toggle(t.key, e.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-brand-900 dark:text-brand-50">
                  {t.label}
                  {saving === t.key && <span className="ml-2 text-xs text-brand-400">Saving…</span>}
                </span>
                <span className="text-xs text-brand-500 dark:text-brand-400">{t.help}</span>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
