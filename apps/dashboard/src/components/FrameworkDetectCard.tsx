import type { FrameworkDetection } from "../types";
import { Skeleton } from "./Skeleton";

const TYPE_LABEL: Record<FrameworkDetection["type"], string> = {
  static: "Static",
  node: "Dynamic",
  fullstack: "Full stack",
};

/** Result of framework detection: framework, suggested type/settings, notes. */
export function FrameworkDetectCard({
  detection,
  loading,
  error,
  warnings = [],
  onApply,
  applyLabel = "Apply",
}: {
  detection: FrameworkDetection | null;
  loading: boolean;
  error?: string | null;
  warnings?: string[];
  onApply?: () => void;
  applyLabel?: string;
}) {
  if (loading) {
    return (
      <div role="status" aria-label="Detecting framework" className="rounded-lg border border-brand-200 dark:border-brand-700 p-3 flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-64" />
      </div>
    );
  }
  if (error) return <p className="text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (!detection) return null;

  const d = detection;
  const facts: [string, string | null][] = [
    ["Type", TYPE_LABEL[d.type]],
    ["Build", d.buildCmd],
    ["Output", d.outputDir],
    ["Start", d.startCmd],
    ["Package manager", d.packageManager],
    ["Node", d.nodeVersion],
    ["Build-time env", d.buildTimeEnvPrefix ? `${d.buildTimeEnvPrefix}*` : null],
  ];
  const notes = [...warnings, ...d.notes];

  return (
    <div className="rounded-lg border border-lime-300 dark:border-lime-700 bg-lime-50/60 dark:bg-lime-400/5 p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-brand-800 dark:text-brand-100">
          Detected <strong>{d.framework.name}</strong>
          {d.hasDockerfile && <span className="ml-1.5 text-xs text-brand-500 dark:text-brand-400">· Dockerfile</span>}
          {d.usesDatabase && <span className="ml-1.5 text-xs text-brand-500 dark:text-brand-400">· database</span>}
        </span>
        {onApply && (
          <button
            type="button"
            onClick={onApply}
            className="px-2.5 py-1 rounded border border-lime-500 text-lime-700 dark:text-lime-300 text-xs font-medium hover:bg-lime-100 dark:hover:bg-lime-400/10 transition-colors"
          >
            {applyLabel}
          </button>
        )}
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {facts
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex gap-1">
              <dt className="text-brand-500 dark:text-brand-400">{k}</dt>
              <dd className="font-mono text-brand-800 dark:text-brand-200">{v}</dd>
            </div>
          ))}
      </dl>
      {notes.length > 0 && (
        <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-4">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
