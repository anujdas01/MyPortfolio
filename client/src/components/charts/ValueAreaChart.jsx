import React, { useId } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { money } from '../../utils/format.js';

function compactMoney(value) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

export default function ValueAreaChart({ snapshots, color }) {
  const uid = useId();
  const gradId = `valueFill-${uid.replace(/:/g, '')}`;
  const data = [...snapshots].reverse();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.45} />
            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
        <XAxis dataKey="asOfDate" tick={{ fontSize: 12 }} tickMargin={8} minTickGap={28} />
        <YAxis
          tick={{ fontSize: 12 }}
          tickFormatter={compactMoney}
          width={64}
          domain={['auto', 'auto']}
        />
        <Tooltip formatter={(v) => money(v)} labelFormatter={(l) => `As of ${l}`} />
        <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2} fill={`url(#${gradId})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
