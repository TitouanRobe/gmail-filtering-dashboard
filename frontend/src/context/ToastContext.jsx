import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

const DEFAULT_DURATIONS = { success: 4000, info: 4000, warning: 6000, error: 8000 };

/**
 * Ephemeral notifications, stacked in the bottom-right corner (see
 * ToastContainer). `sticky: true` disables the auto-dismiss (used by progress
 * toasts, turned into success/error through `settleToast` once finished).
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(0);
  const timers = useRef({});

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    clearTimeout(timers.current[id]);
    delete timers.current[id];
  }, []);

  const scheduleDismiss = useCallback(
    (id, type, duration) => {
      clearTimeout(timers.current[id]);
      timers.current[id] = setTimeout(
        () => dismissToast(id),
        duration ?? DEFAULT_DURATIONS[type] ?? 4000
      );
    },
    [dismissToast]
  );

  const addToast = useCallback(
    ({ type = "info", header, content, progress = null, duration, sticky = false }) => {
      const id = `toast-${idRef.current++}`;
      setToasts((prev) => [...prev, { id, type, header, content, progress }]);
      if (!sticky) scheduleDismiss(id, type, duration);
      return id;
    },
    [scheduleDismiss]
  );

  const updateToast = useCallback((id, patch) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  /** Turns a sticky toast (progress) into an auto-dismissed one (final result). */
  const settleToast = useCallback(
    (id, patch, duration) => {
      updateToast(id, patch);
      scheduleDismiss(id, patch.type, duration);
    },
    [updateToast, scheduleDismiss]
  );

  const value = { toasts, addToast, updateToast, settleToast, dismissToast };

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
