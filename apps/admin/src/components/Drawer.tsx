import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ANIM_MS = 200;

/**
 * Panel that slides in from the right over a dimmed backdrop. Closes on
 * Escape, backdrop click or the close button. Stays mounted for the length of
 * the exit animation so closing slides out instead of vanishing.
 */
export function Drawer({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Next frame, so the off-screen start position renders before sliding in.
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), ANIM_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white dark:bg-brand-900 border-l border-brand-200 dark:border-brand-700 shadow-2xl outline-none transition-transform duration-200 ease-out ${
          shown ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-brand-100 dark:border-brand-800">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-brand-900 dark:text-brand-50 truncate">{title}</h2>
            {subtitle && (
              <p className="mt-0.5 text-xs text-brand-400 dark:text-brand-500">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-brand-400 hover:bg-brand-100 hover:text-brand-700 dark:hover:bg-brand-800 dark:hover:text-brand-200 transition-colors"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** A plain list row for drawer contents: primary text, secondary text, right-hand value. */
export function DrawerRow({
  primary,
  secondary,
  right,
  onClick,
}: {
  primary: ReactNode;
  secondary?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="min-w-0">
        <div className="text-sm font-medium text-brand-800 dark:text-brand-100 truncate">{primary}</div>
        {secondary && (
          <div className="text-xs text-brand-500 dark:text-brand-400 truncate">{secondary}</div>
        )}
      </div>
      {right && <div className="shrink-0 text-sm tabular-nums text-brand-600 dark:text-brand-300">{right}</div>}
    </>
  );
  const cls =
    "flex w-full items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-left";
  return onClick ? (
    <button onClick={onClick} className={`${cls} hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Shown in a drawer when the tile has nothing to list. */
export function DrawerEmpty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-brand-400 dark:text-brand-500">{children}</p>;
}
