import { useLayoutEffect, useRef } from "react";

// ~8 lines of text-sm (1.25rem line height) plus padding: 12rem.
const MAX_HEIGHT_PX = 192;

/**
 * Auto-grow a <textarea> to fit its content as the user types: reset to
 * "auto", then size to scrollHeight, capped at ~8 lines (after which it scrolls
 * internally). Shrinks back when the value is cleared (e.g. after sending).
 * Pair with `resize-none max-h-48`. Kept identical between the two apps.
 */
export function useAutoGrow(value: string, maxPx = MAX_HEIGHT_PX) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
    el.style.overflowY = el.scrollHeight > maxPx ? "auto" : "hidden";
  }, [value, maxPx]);
  return ref;
}
