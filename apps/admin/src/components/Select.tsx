import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface ParsedOption {
  value: string;
  label: string;
  disabled: boolean;
}

interface SelectProps {
  value: string | number;
  /** Mirrors the native <select> event shape so call sites can read e.target.value. */
  onChange: (e: { target: { value: string } }) => void;
  /** Plain <option> elements (maps and fragments are fine), exactly as for a native <select>. */
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
  name?: string;
  title?: string;
  "aria-label"?: string;
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function parseOptions(children: ReactNode): ParsedOption[] {
  const out: ParsedOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
    }>;
    if (el.type === "option") {
      const label = textOf(el.props.children);
      out.push({
        value: el.props.value !== undefined ? String(el.props.value) : label,
        label,
        disabled: !!el.props.disabled,
      });
    } else if (el.type === Fragment || el.type === "optgroup") {
      out.push(...parseOptions(el.props.children));
    }
  });
  return out;
}

const PANEL_MAX_HEIGHT = 256;

/**
 * Themed drop-in replacement for a native <select>. Takes the same <option>
 * children and className, but renders its own option list so the popup matches
 * the UI (Poppins, brand colours, dark mode) instead of the OS default.
 */
export function Select({
  value,
  onChange,
  children,
  className = "",
  disabled,
  required,
  id,
  name,
  title,
  "aria-label": ariaLabel,
}: SelectProps) {
  const options = parseOptions(children);
  const current = String(value);
  const selectedIndex = options.findIndex((o) => o.value === current);
  const selected = options[selectedIndex] ?? options[0];

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean }>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ text: "", at: 0 });
  const listId = useId();

  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 200 && r.top > below;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 160), up });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  // Keep the highlighted option in view while navigating with the keyboard.
  useEffect(() => {
    if (open && active >= 0) {
      panelRef.current
        ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }
  }, [open, active]);

  function openList() {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }

  function choose(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    if (opt.value !== current) onChange({ target: { value: opt.value } });
    setOpen(false);
    triggerRef.current?.focus();
  }

  function step(from: number, dir: 1 | -1) {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) {
      if (!options[i].disabled) return i;
    }
    return from;
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => step(a, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => step(a, -1));
        break;
      case "Home":
        e.preventDefault();
        setActive(step(-1, 1));
        break;
      case "End":
        e.preventDefault();
        setActive(step(options.length, -1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          const t = typeahead.current;
          t.text = now - t.at > 700 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
          t.at = now;
          const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(t.text));
          if (hit >= 0) setActive(hit);
        }
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`${className} inline-flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-brand-400 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            fillRule="evenodd"
            d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Hidden native mirror keeps `required` validation and named form fields working. */}
      {(required || name) && (
        <select
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          name={name}
          required={required}
          value={current}
          onChange={() => {}}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}

      {open &&
        pos &&
        createPortal(
          <ul
            ref={panelRef}
            id={listId}
            role="listbox"
            style={{
              position: "fixed",
              left: pos.left,
              width: pos.width,
              maxHeight: PANEL_MAX_HEIGHT,
              ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
            className="z-[100] overflow-y-auto rounded-xl border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-800 p-1 shadow-lg ring-1 ring-black/5"
          >
            {options.length === 0 && (
              <li className="px-3 py-2 text-sm text-brand-400 dark:text-brand-500">No options</li>
            )}
            {options.map((o, i) => {
              const isSelected = o.value === current;
              return (
                <li
                  key={`${o.value}-${i}`}
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={o.disabled || undefined}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                  className={[
                    "flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm",
                    o.disabled
                      ? "cursor-not-allowed text-brand-400 dark:text-brand-500"
                      : "cursor-pointer",
                    !o.disabled && i === active ? "bg-brand-100 dark:bg-brand-700" : "",
                    isSelected
                      ? "font-medium text-lime-600 dark:text-lime-400"
                      : o.disabled
                        ? ""
                        : "text-brand-700 dark:text-brand-200",
                  ].join(" ")}
                >
                  <span className="truncate">{o.label}</span>
                  {isSelected && (
                    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4 shrink-0">
                      <path
                        fillRule="evenodd"
                        d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
