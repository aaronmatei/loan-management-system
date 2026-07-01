import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
} from "react";
import { CheckCircle, AlertTriangle, Info, X } from "lucide-react";

// Lightweight toast system for UI feedback (e.g. "Segment saved",
// "Copied"). Presentation-only — toasts NEVER trigger data changes; they
// just acknowledge a UI action. Mount <ToastProvider> once near the app
// root and call useToast() anywhere.

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  // No-op fallback so a component that calls useToast outside the provider
  // doesn't crash (it just won't show anything).
  return ctx || { toast: () => {} };
}

const ICONS = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info,
};
const TONES = {
  success: "text-money-pos",
  error: "text-money-neg",
  info: "text-ocean-600",
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);

  const dismiss = useCallback(
    (id) => setToasts((prev) => prev.filter((t) => t.id !== id)),
    [],
  );

  const toast = useCallback(
    (message, { type = "success", duration = 3000 } = {}) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev, { id, message, type }]);
      if (duration > 0) setTimeout(() => dismiss(id), duration);
      return id;
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))]"
        role="region"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.type] || Info;
          return (
            <div
              key={t.id}
              className="flex items-start gap-3 bg-surface border border-slate-200 dark:border-slate-700 rounded-xl shadow-card px-4 py-3 animate-[lf-toast-in_0.2s_ease-out]"
            >
              <Icon size={18} className={`mt-0.5 ${TONES[t.type]}`} />
              <p className="flex-1 text-sm text-slate-700 dark:text-slate-200">
                {t.message}
              </p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X size={15} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
