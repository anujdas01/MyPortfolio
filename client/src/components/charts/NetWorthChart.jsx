import React, { useId } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { money } from '../../utils/format.js';
import { useThemeColors } from '../useThemeColors.js';

function compact(value) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value}`;
}

export default function NetWorthChart({
  series,
  chartType = 'line',
  showAssets = true,
  showLiabilities = true,
}) {
  const { primary, positive, negative } = useThemeColors();
  const uid = useId().replace(/:/g, '');
  const areaGradId = `nw-area-${uid}`;

  if (chartType === 'area') {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
          <defs>
            <linearGradient id={areaGradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={primary} stopOpacity={0.35} />
              <stop offset="100%" stopColor={primary} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} tickMargin={8} minTickGap={32} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={compact} width={64} domain={['auto', 'auto']} />
          <Tooltip formatter={(value) => money(value)} labelFormatter={(l) => `As of ${l}`} />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Area
            type="monotone"
            dataKey="netWorth"
            name="Net Worth"
            stroke={primary}
            fill={`url(#${areaGradId})`}
            strokeWidth={2.5}
            dot={false}
            connectNulls
          />
          {showAssets && (
            <Area
              type="monotone"
              dataKey="assets"
              name="Assets"
              stroke={positive}
              fill="transparent"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
            />
          )}
          {showLiabilities && (
            <Area
              type="monotone"
              dataKey="liabilities"
              name="Liabilities"
              stroke={negative}
              fill="transparent"
              strokeWidth={1.5}
              strokeDasharray="5 4"
              dot={false}
              connectNulls
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} tickMargin={8} minTickGap={32} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={compact} width={64} domain={['auto', 'auto']} />
        <Tooltip formatter={(value) => money(value)} labelFormatter={(l) => `As of ${l}`} />
        <Legend wrapperStyle={{ fontSize: 13 }} />
        <Line
          type="monotone"
          dataKey="netWorth"
          name="Net Worth"
          stroke={primary}
          dot={false}
          strokeWidth={2.5}
          connectNulls
        />
        {showAssets && (
          <Line
            type="monotone"
            dataKey="assets"
            name="Assets"
            stroke={positive}
            dot={false}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            connectNulls
          />
        )}
        {showLiabilities && (
          <Line
            type="monotone"
            dataKey="liabilities"
            name="Liabilities"
            stroke={negative}
            dot={false}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            connectNulls
          />
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}
