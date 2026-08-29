import React, { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ open, onClose, title, children }) {
  const overlayRef = React.useRef(null);
  const lastActive = React.useRef(null);
  useEffect(() => {
    if (!open) return;
    lastActive.current = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab' && overlayRef.current) {
        const focusable = overlayRef.current.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    // body scroll lock
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // initial focus
    setTimeout(() => {
      const el = overlayRef.current?.querySelector('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
      el?.focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      try { lastActive.current?.focus?.(); } catch {}
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div ref={overlayRef} className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surfaceAlt hover:text-text"
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint, children }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      {Icon && (
        <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-surfaceAlt text-muted">
          <Icon size={22} strokeWidth={1.75} />
        </span>
      )}
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-sm text-sm text-muted">{hint}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}
