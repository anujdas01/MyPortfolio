import React from 'react';
import { useDensity } from '../context/DashboardPrefsContext.jsx';

/**
 * The one page header: density-aware icon tile, title with inline badges,
 * optional subtitle/notes, and right-aligned actions. Every page shares the
 * same heading scale, rhythm and icon treatment through this component.
 */
export default function PageHeader({ icon: Icon, title, badges, subtitle, notes, actions }) {
  const { heading, headerIcon, headerIconSize } = useDensity();
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className={`flex flex-wrap items-center gap-2.5 font-bold ${heading}`}>
          {Icon && (
            <span className={`flex ${headerIcon} shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary`}>
              <Icon size={headerIconSize} />
            </span>
          )}
          {title}
          {badges}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        {notes && <p className="mt-2 max-w-xl text-sm text-muted">{notes}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </header>
  );
}
