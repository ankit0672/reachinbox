import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastApi } from "./toastContext";

type ToastKind = "success" | "error";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const DISMISS_AFTER_MS = 5000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((all) => [...all, { id, kind, message }]);
      setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push("success", m), error: (m) => push("error", m) }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            // Errors interrupt (alert); successes are announced politely (status).
            role={t.kind === "error" ? "alert" : "status"}
            className="pointer-events-auto flex items-start gap-2 rounded-card border border-border bg-surface p-3 text-sm shadow-popover"
          >
            {t.kind === "error" ? (
              <CircleAlert aria-hidden size={18} className="mt-px shrink-0 text-danger" />
            ) : (
              <CircleCheck aria-hidden size={18} className="mt-px shrink-0 text-primary" />
            )}
            <p className="flex-1">{t.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => dismiss(t.id)}
              className="shrink-0 text-ink-muted hover:text-ink"
            >
              <X aria-hidden size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
