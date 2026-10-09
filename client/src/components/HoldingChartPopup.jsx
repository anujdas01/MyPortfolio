import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import api from '../api/client.js';
import { marketPrice, pct } from '../utils/format.js';
import { useThemeColors } from './useThemeColors.js';

const WIDTH = 300;
const CHART_H = 104;
const GAP = 10;
const CACHE_TTL_MS = 60_000;

// Session-scoped chart cache so hovering back and forth between rows doesn't
// re-hit the provider. Expires quickly — the current price keeps moving.
const cache = new Map(); // ticker -> { data, expiresAt }

function timeLabel(t) {
  return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function ChartTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-border/70 bg-surface px-2 py-1 text-xs shadow-pop">
      <p className="text-muted">{timeLabel(p.t)}</p>
      <p className="font-medium tabular-nums text-text">{marketPrice(p.close)}</p>
    </div>
  );
}

/**
 * Hover popup for a holdings row showing the stock's intraday ("today") chart.
 * Positioned above (or below) the hovered cell via a portal so the table's
 * overflow-x-auto container can't clip it.
 */
export default function HoldingChartPopup({ ticker, rect }) {
  const { positive, negative } = useThemeColors();
  const uid = useId();
  const gradId = `intraday-${uid.replace(/:/g, '')}`;
  const alive = useRef(true);
  const [state, setState] = useState(() => {
    const hit = cache.get(ticker);
    return hit && hit.expiresAt > Date.now()
      ? { status: 'ok', data: hit.data }
      : { status: 'loading', data: null, message: '' };
  });

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    const hit = cache.get(ticker);
    if (hit && hit.expiresAt > Date.now()) {
      setState({ status: 'ok', data: hit.data });
      return undefined;
    }
    setState({ status: 'loading', data: null, message: '' });
    api
      .get('/market/chart', { params: { ticker }, timeout: 15000 })
      .then((r) => {
        cache.set(ticker, { data: r.data, expiresAt: Date.now() + CACHE_TTL_MS });
        if (alive.current) setState({ status: 'ok', data: r.data });
      })
      .catch((e) => {
        if (alive.current) {
          setState({ status: 'error', data: null, message: e.response?.data?.error || 'Chart unavailable right now' });
        }
      });
    return undefined;
  }, [ticker]);

  const data = state.data;
  const change = data?.change;
  const up = !(typeof change === 'number') || change >= 0;
  const color = up ? positive : negative;

  const left = Math.max(
    8,
    Math.min(rect.left + rect.width / 2 - WIDTH / 2, (window.innerWidth || WIDTH) - WIDTH - 8)
  );
  const above = rect.top > CHART_H + 96;
  const style = {
    left: `${left}px`,
    top: `${above ? rect.top : rect.bottom}px`,
    transform: above ? 'translate(-50%, calc(-100% - 10px))' : `translate(-50%, ${GAP}px)`,
    width: `${WIDTH}px`,
  };

  return createPortal(
    <div
      style={style}
      role="tooltip"
      className="anim-pop pointer-events-none fixed z-40 rounded-xl border border-border/70 bg-surface p-3 shadow-pop"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-semibold">{ticker}</p>
          {data?.name && <p className="truncate text-xs text-muted">{data.name}</p>}
        </div>
        {data && typeof data.current === 'number' && (
          <div className="shrink-0 text-right">
            <p className="text-sm font-semibold tabular-nums">{marketPrice(data.current)}</p>
            {typeof change === 'number' && (
              <p className={`text-xs font-semibold tabular-nums ${up ? 'text-positive' : 'text-negative'}`}>
                {change >= 0 ? '+' : ''}
                {marketPrice(change)} ({pct(data.changePercent)})
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-border/60 pt-2">
        {state.status === 'loading' && (
          <p className="flex h-24 items-center justify-center text-xs text-muted">Loading today’s chart…</p>
        )}
        {state.status === 'error' && (
          <p className="flex h-24 items-center justify-center px-2 text-center text-xs text-muted">{state.message}</p>
        )}
        {state.status === 'ok' && data && data.points?.length > 0 && (
          <div style={{ height: CHART_H }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.points} margin={{ top: 4, right: 2, bottom: 0, left: 2 }}>
                <defs>
                  <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={color} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis hide domain={['auto', 'auto']} />
                <Tooltip content={<ChartTip />} cursor={{ stroke: color, strokeOpacity: 0.3 }} />
                {typeof data.previousClose === 'number' && (
                  <ReferenceLine y={data.previousClose} stroke="currentColor" strokeOpacity={0.3} strokeDasharray="3 3" />
                )}
                <Area
                  type="monotone"
                  dataKey="close"
                  stroke={color}
                  strokeWidth={1.75}
                  fill={`url(#${gradId})`}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        {state.status === 'ok' && data && (!data.points || data.points.length === 0) && (
          <p className="flex h-24 items-center justify-center text-xs text-muted">No intraday data for {ticker}.</p>
        )}
      </div>

      <p className="mt-1.5 text-center text-[10px] uppercase tracking-wide text-muted">Today · 5-min · incl. pre/post</p>
    </div>,
    document.body
  );
}
