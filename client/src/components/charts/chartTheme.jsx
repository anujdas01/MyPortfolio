import React from 'react';
import { money } from '../../utils/format.js';

/** Axis tick formatter shared by every chart: $1.2M / $45K / $850. */
export function compactMoney(value) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

export const chartGrid = { strokeDasharray: '3 3', opacity: 0.25 };
export const chartAxisTick = { fontSize: 12 };
export const chartMargin = { top: 8, right: 16, bottom: 0, left: 8 };

/** Area fill fade shared by all gradient areas (40% at top -> 3% at baseline). */
export const gradientStops = [
  { offset: '0%', opacity: 0.4 },
  { offset: '100%', opacity: 0.03 },
];

/** Shared tooltip card used via `<Tooltip content={<ChartTooltip ... />} />`. */
export function ChartTooltip({ active, payload, label, labelFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border/70 bg-surface px-3 py-2 text-xs shadow-pop">
      {label != null && (
        <p className="mb-1 text-muted">{labelFormatter ? labelFormatter(label) : label}</p>
      )}
      {payload.map((entry, i) => (
        <p key={entry.dataKey ?? i} className="flex items-center gap-1.5 font-medium tabular-nums text-text">
          {entry.color && (
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
          )}
          {entry.name ? `${entry.name}: ` : ''}
          {money(entry.value)}
        </p>
      ))}
    </div>
  );
}

/** Consistent empty state for a chart with no data. */
export function ChartEmpty({ children = 'No data yet.' }) {
  return <p className="py-10 text-center text-sm text-muted">{children}</p>;
}
