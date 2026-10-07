import React, { createContext, useContext, useCallback, useState } from 'react';
import { X } from 'lucide-react';

const ToastContext = createContext(null);
let idSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((p) => p.map((t) => (t.id === id ? { ...t, closing: true } : t)));
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 280);
  }, []);

  const push = useCallback((msg, type = 'info') => {
    const id = ++idSeq;
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => dismiss(id), 4000);
  }, [dismiss]);

  const toast = useCallback((msg) => push(msg, 'info'), [push]);
  const success = useCallback((msg) => push(msg, 'success'), [push]);
  const error = useCallback((msg) => push(msg, 'error'), [push]);

  return (
    <ToastContext.Provider value={{ toast, success, error, push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg ${t.closing ? 'anim-toast-out' : 'anim-toast-in'} ${t.type === 'success' ? 'border-positive/30 bg-positive/10 text-positive' : t.type === 'error' ? 'border-negative/30 bg-negative/10 text-negative' : 'border-border bg-surface text-text'}`}
          >
            <span className="flex-1">{t.msg}</span>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
              className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast outside provider');
  return ctx;
}
