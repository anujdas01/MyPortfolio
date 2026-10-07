import React, { useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Minimum gap kept between the dialog and any viewport edge.
const GUTTER = 16;
const MAX_W = 512;
const MAX_W_WIDE = 768;

export default function Modal({ open, onClose, title, children, wide = false }) {
  const overlayRef = React.useRef(null);
  const lastActive = React.useRef(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // Centering logic: the dialog is measured against the viewport and pinned to
  // its exact horizontal and vertical centre, never closer than GUTTER to an
  // edge. It runs before paint on open, then again on window resize and
  // whenever the box changes size (e.g. balance history loading in), so the
  // popup stays centred no matter what the content does. Scrolling is locked
  // first: dropping the page scrollbar widens the viewport, and the dialog
  // must be centred in the width it is actually painted in.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const el = overlayRef.current;
    if (!el) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const place = () => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const width = Math.max(160, Math.min(wide ? MAX_W_WIDE : MAX_W, vw - GUTTER * 2));
      const maxHeight = Math.max(120, vh - GUTTER * 2);
      // offset* (layout box) rather than getBoundingClientRect: the pop-in
      // animation's transform must not skew the measurement.
      el.style.width = `${width}px`;
      el.style.maxHeight = `${maxHeight}px`;
      el.style.left = `${Math.max(GUTTER, Math.round((vw - el.offsetWidth) / 2))}px`;
      el.style.top = `${Math.max(GUTTER, Math.round((vh - el.offsetHeight) / 2))}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, wide]);

  useEffect(() => {
    if (!open) return;
    lastActive.current = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') onCloseRef.current?.();
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
    // initial focus
    setTimeout(() => {
      const el = overlayRef.current?.querySelector('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
      el?.focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      try { lastActive.current?.focus?.(); } catch {}
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="anim-fade fixed inset-0 z-50 overflow-y-auto bg-black/50 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={overlayRef}
        className="anim-pop absolute flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 px-5 pb-5 pt-5 sm:px-7 sm:pt-7">
          <h2 className="min-w-0 break-words text-lg font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-surfaceAlt hover:text-text"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 pb-5 sm:px-7 sm:pb-7">{children}</div>
      </div>
    </div>,
    document.body
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
