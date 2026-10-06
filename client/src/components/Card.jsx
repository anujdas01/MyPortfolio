import React from 'react';

export default function Card({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-border/70 bg-surface p-6 shadow-sm ${className}`}>
      {(title || action) && (
        <header className="mb-5 flex items-center justify-between gap-3">
          {title && (
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
              {Icon && <Icon size={15} strokeWidth={2.25} className="text-primary" />}
              {title}
            </h3>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
