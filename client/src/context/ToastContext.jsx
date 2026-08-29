import React, { createContext, useContext, useCallback, useState } from 'react';

const ToastContext = createContext(null);
let idSeq = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => setToasts((p) => p.filter((t) => t.id !== id)), []);

  const push = useCallback((msg, type = 'info') => {
    const id = ++idSeq;
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => remove(id), 4000);
  }, [remove]);

  const toast = useCallback((msg) => push(msg, 'info'), [push]);
  const success = useCallback((msg) => push(msg, 'success'), [push]);
  const error = useCallback((msg) => push(msg, 'error'), [push]);

  return (
    <ToastContext.Provider value={{ toast, success, error, push }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg ${t.type === 'success' ? 'border-positive/30 bg-positive/10 text-positive' : t.type === 'error' ? 'border-negative/30 bg-negative/10 text-negative' : 'border-border bg-surface text-text'}`}>
            {t.msg}
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
