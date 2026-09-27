import { ReactNode, RefObject, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

export interface Crumb {
  label: ReactNode;
  /** Router link. */
  to?: string;
  /** Click handler (e.g. scroll to a section). */
  onClick?: () => void;
  /** Custom content instead of a plain link/button (e.g. a section menu). */
  render?: ReactNode;
}

const LINK =
  "rounded px-1 -mx-1 text-brand-500 dark:text-brand-400 hover:text-brand-900 dark:hover:text-brand-50 hover:bg-brand-100 dark:hover:bg-brand-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

function Sep() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-300 dark:text-brand-600">
      <path fillRule="evenodd" d="M7.2 14.8a.75.75 0 0 1 0-1.06L10.94 10 7.2 6.26a.75.75 0 1 1 1.06-1.06l4.27 4.27a.75.75 0 0 1 0 1.06L8.26 14.8a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
    </svg>
  );
}

/** Clickable breadcrumb trail; the last crumb is the current page. */
export function Breadcrumbs({ items, className = "" }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1.5 text-xs">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          const body = c.render ? (
            c.render
          ) : c.to && !last ? (
            <Link to={c.to} className={LINK}>
              {c.label}
            </Link>
          ) : c.onClick ? (
            <button type="button" onClick={c.onClick} className={LINK} aria-current={last ? "page" : undefined}>
              {c.label}
            </button>
          ) : (
            <span aria-current={last ? "page" : undefined} className="font-medium text-brand-800 dark:text-brand-100 truncate max-w-[16rem]">
              {c.label}
            </span>
          );
          return (
            <li key={i} className="flex items-center gap-1.5 min-w-0">
              {i > 0 && <Sep />}
              {body}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Sections of a scrollable page, from markers `<div data-crumb="Label" id="…">`
 * inside `container`. Returns the sections, the one in view, and scrollTo().
 */
export function useSections(container: RefObject<HTMLElement>, deps: unknown[] = []) {
  const [sections, setSections] = useState<{ id: string; label: string }[]>([]);
  const [current, setCurrent] = useState<string | null>(null);

  const collect = useCallback(() => {
    const el = container.current;
    if (!el) return;
    const found = Array.from(el.querySelectorAll<HTMLElement>("[data-crumb]")).map((m) => ({
      id: m.id,
      label: m.dataset.crumb ?? m.id,
    }));
    setSections((prev) =>
      prev.length === found.length && prev.every((p, i) => p.id === found[i].id && p.label === found[i].label)
        ? prev
        : found,
    );
  }, [container]);

  useEffect(() => {
    collect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collect, ...deps]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const onScroll = () => {
      const top = el.getBoundingClientRect().top + 24;
      let cur: string | null = null;
      for (const m of el.querySelectorAll<HTMLElement>("[data-crumb]")) {
        if (m.getBoundingClientRect().top <= top) cur = m.id;
      }
      // At the very top no section is "current" (the app itself is).
      setCurrent(el.scrollTop < 8 ? null : cur);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [container, sections]);

  const scrollTo = useCallback(
    (id: string | null) => {
      const el = container.current;
      if (!el) return;
      if (!id) {
        el.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const m = el.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      if (m) {
        el.scrollTo({
          top: m.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - 8,
          behavior: "smooth",
        });
      }
    },
    [container],
  );

  return { sections, current, scrollTo };
}

/** Last crumb of a sectioned page: current section + a menu of all sections. */
export function SectionCrumb({
  sections,
  current,
  onSelect,
}: {
  sections: { id: string; label: string }[];
  current: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (sections.length === 0) return null;
  const label = sections.find((s) => s.id === current)?.label ?? "Sections";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`inline-flex items-center gap-0.5 ${current ? "font-medium text-brand-800 dark:text-brand-100" : ""} ${LINK}`}
      >
        {label}
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 z-30 min-w-[11rem] max-h-72 overflow-y-auto rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 shadow-lg py-1"
        >
          {sections.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                onSelect(s.id);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-brand-50 dark:hover:bg-brand-800 ${
                s.id === current ? "font-semibold text-brand-900 dark:text-brand-50" : "text-brand-600 dark:text-brand-300"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
