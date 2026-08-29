import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { money } from '../../utils/format.js';
import { useThemeColors } from '../useThemeColors.js';

export default function AllocationChart({ data }) {
  const { palette, text } = useThemeColors();
  if (!data?.length) {
    return <p className="py-10 text-center text-sm text-muted">No asset data yet.</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="name" innerRadius={65} outerRadius={100} paddingAngle={2}>
          {data.map((entry, i) => (
            <Cell key={entry.name} fill={palette[i % palette.length]} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => money(value)} />
        <Legend wrapperStyle={{ fontSize: 13, color: text }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
