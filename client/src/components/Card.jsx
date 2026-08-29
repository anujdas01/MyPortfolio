import React from 'react';

export default function Card({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 shadow-sm ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
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
