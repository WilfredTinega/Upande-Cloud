import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "success" | "error" | "info";

export interface ToastOptions {
  /** Bold heading above the message (used for incoming-notification toasts). */
  title?: string;
  /** Makes the toast clickable (e.g. jump to the page the notice is about). */
  onClick?: () => void;
  /** Override the auto-dismiss delay (ms). */
  durationMs?: number;
}

export interface Toast extends ToastOptions {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastContextValue {
  /** Show a toast. Auto-dismisses after a few seconds. */
  toast: (message: string, tone?: ToastTone, options?: ToastOptions) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
  toasts: Toast[];
}

const ToastContext = createContext<ToastContextValue | null>(null);

// Errors linger a little longer than successes so they're not missed.
const DURATION: Record<ToastTone, number> = {
  success: 4000,
  info: 4000,
  error: 6000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((curr) => curr.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, tone: ToastTone = "info", options: ToastOptions = {}) => {
      const id = nextId.current++;
      setToasts((curr) => [...curr, { id, tone, message, ...options }]);
      setTimeout(() => dismiss(id), options.durationMs ?? DURATION[tone]);
    },
    [dismiss],
  );

  const success = useCallback((message: string) => toast(message, "success"), [toast]);
  const error = useCallback((message: string) => toast(message, "error"), [toast]);
  const info = useCallback((message: string) => toast(message, "info"), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, dismiss, toasts }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
