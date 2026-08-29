import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

function buildSeries(db) {
  const rows = db
    .prepare(
      `SELECT s.value, s.as_of_date AS date, s.account_id AS accountId, a.is_asset AS isAsset
       FROM balance_snapshots s
       JOIN accounts a ON a.id = s.account_id
       WHERE a.archived = 0
       ORDER BY s.as_of_date ASC, s.rowid ASC`
    )
    .all();

  const latest = new Map();
  const series = [];
  let curDate = null;

  const emit = (date) => {
    let assets = 0;
    let liabilities = 0;
    for (const { value, isAsset } of latest.values()) {
      if (isAsset) assets += value;
      else liabilities += value;
    }
    series.push({ date, assets, liabilities, netWorth: assets - liabilities });
  };

  for (const row of rows) {
    if (row.date !== curDate) {
      if (curDate !== null) emit(curDate);
      curDate = row.date;
    }
    latest.set(row.accountId, { value: row.value, isAsset: !!row.isAsset });
  }
  if (curDate !== null) emit(curDate);
  return series;
}

function cutoffFor(range) {
  const today = new Date();
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  switch (range) {
    case '3m':
      d.setUTCMonth(d.getUTCMonth() - 3);
      break;
    case '6m':
      d.setUTCMonth(d.getUTCMonth() - 6);
      break;
    case '1y':
      d.setUTCFullYear(d.getUTCFullYear() - 1);
      break;
    case 'ytd':
      d.setUTCMonth(0);
      d.setUTCDate(1);
      break;
    default:
      return null;
  }
  return d.toISOString().slice(0, 10);
}

function pct(delta, base) {
  if (!base) return null;
  return Math.round((delta / Math.abs(base)) * 10000) / 100;
}

export default function reportRoutes(db) {
  const r = Router();
  r.use(requireAuth);

  r.get('/net-worth', (req, res) => {
    const full = buildSeries(db);
    const last = full[full.length - 1] || null;
    const prev = full.length > 1 ? full[full.length - 2] : null;

    let monthPoint = null;
    if (last) {
      const cut = new Date();
      cut.setUTCDate(cut.getUTCDate() - 30);
      const cutStr = cut.toISOString().slice(0, 10);
      for (let i = full.length - 1; i >= 0; i--) {
        if (full[i].date <= cutStr) {
          monthPoint = full[i];
          break;
        }
      }
    }

    const range = req.query.range || 'all';
    const cut = cutoffFor(range);
    const filteredSeries = cut ? full.filter((p) => p.date >= cut) : full;

    res.json({
      current: last
        ? { assets: last.assets, liabilities: last.liabilities, netWorth: last.netWorth, asOf: last.date }
        : { assets: 0, liabilities: 0, netWorth: 0, asOf: null },
      changes: {
        sincePrevSnapshot: prev
          ? { delta: last.netWorth - prev.netWorth, pct: pct(last.netWorth - prev.netWorth, prev.netWorth), since: prev.date }
          : null,
        last30Days: monthPoint && last
          ? { delta: last.netWorth - monthPoint.netWorth, pct: pct(last.netWorth - monthPoint.netWorth, monthPoint.netWorth), since: monthPoint.date }
          : null,
      },
      series: filteredSeries,
    });
  });

  r.get('/allocation', (_req, res) => {
    const rows = db
      .prepare(
        `SELECT a.id, a.name, a.kind, a.is_asset AS isAsset,
                COALESCE(c.name, 'Uncategorized') AS category,
                (SELECT s.value FROM balance_snapshots s WHERE s.account_id = a.id
                  ORDER BY s.as_of_date DESC, s.rowid DESC LIMIT 1) AS latestValue
         FROM accounts a LEFT JOIN account_categories c ON c.id = a.category_id
         WHERE a.archived = 0`
      )
      .all();

    const assets = new Map();
    const liabilities = new Map();
    for (const row of rows) {
      if (row.latestValue === null) continue;
      const bucket = row.isAsset ? assets : liabilities;
      bucket.set(row.category, (bucket.get(row.category) || 0) + row.latestValue);
    }
    res.json({
      assets: [...assets.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
      liabilities: [...liabilities.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    });
  });

  return r;
}
