/**
 * Skeleton placeholders shown while data loads. They mimic the shape of the
 * content that is coming (table rows, cards, text) so the page does not jump
 * when it arrives. Kept identical between the admin and dashboard apps.
 */

/** A single pulsing block. Size it with className (e.g. "h-4 w-32"). */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-brand-200/70 dark:bg-brand-800 ${className}`}
    />
  );
}

// Varying widths so rows and lines don't look like a solid grid.
const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-2/5"];

/** Skeleton <tr> rows for inside an existing <tbody>. */
export function SkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="bg-white dark:bg-brand-900">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className={`h-4 max-w-[10rem] ${WIDTHS[(r + c) % WIDTHS.length]}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** A whole bordered table: header cells plus skeleton rows. */
export function SkeletonTable({
  columns,
  rows = 6,
  className = "",
}: {
  /** Column headings; pass a number to render placeholder headings instead. */
  columns: readonly string[] | number;
  rows?: number;
  className?: string;
}) {
  const cols = typeof columns === "number" ? columns : columns.length;
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`rounded-lg border border-brand-200 dark:border-brand-700 overflow-hidden ${className}`}
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-brand-50 dark:bg-brand-800 border-b border-brand-200 dark:border-brand-700">
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i} className="text-left px-4 py-3 font-medium text-brand-600 dark:text-brand-400">
                {typeof columns === "number" ? <Skeleton className="h-4 w-20" /> : columns[i]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
          <SkeletonRows rows={rows} cols={cols} />
        </tbody>
      </table>
    </div>
  );
}

/** Stacked text lines, e.g. for a paragraph or a log panel. */
export function SkeletonLines({ lines = 4, className = "" }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${WIDTHS[i % WIDTHS.length]}`} />
      ))}
    </div>
  );
}

/** A grid of card placeholders (stat tiles, app cards, settings panels). */
export function SkeletonCards({
  count = 4,
  className = "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
  cardClassName = "h-28",
}: {
  count?: number;
  className?: string;
  cardClassName?: string;
}) {
  return (
    <div role="status" aria-label="Loading" className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={`rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-4 flex flex-col gap-3 ${cardClassName}`}
        >
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
