import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp,
  TrendingDown,
  PiggyBank,
  Landmark,
  Scale,
  Activity,
  Users,
  Plus,
  FileDown,
  Settings as SettingsIcon,
  PencilRuler,
  Rows3,
  Armchair,
  RotateCcw,
  Check,
  GripVertical,
  ChevronUp,
  ChevronDown,
  PieChart,
  BarChart3,
  LineChart,
  AreaChart as AreaChartIcon,
  History,
  BellRing,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Sparkles,
  Eye,
  EyeOff,
  LayoutGrid,
  Layers,
  Wallet,
  Building2,
  Target,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import api from '../api/client.js';
import Card from '../components/Card.jsx';
import Spinner from '../components/Spinner.jsx';
import NetWorthChart from '../components/charts/NetWorthChart.jsx';
import AllocationChart from '../components/charts/AllocationChart.jsx';
import { money, signedMoney, pct, formatDate } from '../utils/format.js';

const RANGES = [
  { key: '3m', label: '3M' },
  { key: '6m', label: '6M' },
  { key: '1y', label: '1Y' },
  { key: 'ytd', label: 'YTD' },
  { key: 'all', label: 'All' },
];

// Versatile default order - includes new insights and liabilities widgets.
// Existing users will have missing entries appended transparently.
const DEFAULT_ORDER = ['summary', 'insights', 'trend', 'allocation', 'liabilities', 'ratios', 'accounts', 'attention'];

const SECTION_LABELS = {
  summary: 'Net worth summary',
  insights: 'Insights & performance',
  trend: 'Net worth over time',
  allocation: 'Allocation',
  liabilities: 'Liabilities breakdown',
  ratios: 'Key ratios',
  accounts: 'Accounts overview',
  attention: 'Needs attention',
};

const SECTION_DESCRIPTIONS = {
  summary: 'Headline net worth, assets and cash buffer',
  insights: 'YoY growth, monthly momentum and concentration',
  trend: 'Historical chart with flexible range & style',
  allocation: 'Asset mix by category or institution',
  liabilities: 'Debt composition and payoff focus',
  ratios: 'Debt ratio, leverage and coverage',
  accounts: 'Recently updated and top holdings',
  attention: 'Stale and never-updated accounts',
};

const SECTION_ICONS = {
  summary: Sparkles,
  insights: Zap,
  trend: LineChart,
  allocation: PieChart,
  liabilities: Scale,
  ratios: Activity,
  accounts: LayoutGrid,
  attention: BellRing,
};

const LAYOUT_STORAGE_KEY = 'mp-dashboard-layout';
const VISIBILITY_STORAGE_KEY = 'mp-dashboard-visibility';
const COLLAPSED_STORAGE_KEY = 'mp-dashboard-collapsed';
const TREND_PREFS_KEY = 'mp-dashboard-trend-prefs';
const ALLOC_PREFS_KEY = 'mp-dashboard-alloc-prefs';

function loadOrder() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY));
    if (Array.isArray(raw)) {
      const valid = raw.filter((id) => DEFAULT_ORDER.includes(id));
      const missing = DEFAULT_ORDER.filter((id) => !valid.includes(id));
      if (valid.length) return [...valid, ...missing];
      if (missing.length) return [...DEFAULT_ORDER];
    }
  } catch {
    // fall through
  }
  return [...DEFAULT_ORDER];
}

function loadVisibility() {
  try {
    const raw = JSON.parse(localStorage.getItem(VISIBILITY_STORAGE_KEY));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      return raw;
    }
  } catch {}
  return {};
}

function loadCollapsed() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY));
    if (Array.isArray(raw)) return new Set(raw);
  } catch {}
  return new Set();
}

function loadTrendPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(TREND_PREFS_KEY));
    if (raw && typeof raw === 'object') return raw;
  } catch {}
  return { chartType: 'line', showAssets: true, showLiabilities: true };
}

function loadAllocPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(ALLOC_PREFS_KEY));
    if (raw && typeof raw === 'object') return raw;
  } catch {}
  return { tab: 'assets', groupBy: 'category' };
}

function ChangeChip({ label, change }) {
  if (!change) return <span className="text-xs text-muted">{label}: no prior data</span>;
  const up = change.delta >= 0;
  const TrendIcon = up ? TrendingUp : TrendingDown;
  const cls = up ? 'text-positive' : 'text-negative';
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${cls}`}>
      <TrendIcon size={13} />
      {label}: {signedMoney(change.delta)} ({pct(change.pct)}) since {formatDate(change.since)}
    </span>
  );
}

function MetricCard({ label, value, hint, tone = 'text-text', icon: Icon, compact }) {
  return (
    <div className={`rounded-xl border border-border bg-surface shadow-sm transition-shadow hover:shadow-md ${compact ? 'p-3' : 'p-5'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
        {Icon && (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surfaceAlt text-primary">
            <Icon size={16} strokeWidth={2.25} />
          </span>
        )}
      </div>
      <p className={`mt-1 font-bold ${compact ? 'text-xl' : 'text-2xl'} ${tone}`}>{value}</p>
      {hint && <p className="mt-2 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function daysSince(isoDate) {
  if (!isoDate) return Number.POSITIVE_INFINITY;
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function share(total, value) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, (value / total) * 100));
}

export default function DashboardPage() {
  const [report, setReport] = useState(null);
  const [allocation, setAllocation] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [range, setRange] = useState('1y');
  const [error, setError] = useState('');

  // Layout customization state - versatile & persistent
  const [order, setOrder] = useState(loadOrder);
  const [visibility, setVisibility] = useState(loadVisibility);
  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const [editLayout, setEditLayout] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [compactView, setCompactView] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('mp-dashboard-compact')) || false;
    } catch {
      return false;
    }
  });
  const [trendPrefs, setTrendPrefs] = useState(loadTrendPrefs);
  const [allocPrefs, setAllocPrefs] = useState(loadAllocPrefs);

  const isVisible = (id) => visibility[id] !== false;

  useEffect(() => {
    api
      .get('/reports/net-worth', { params: { range } })
      .then((r) => setReport(r.data))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load report'));
  }, [range]);

  useEffect(() => {
    api.get('/reports/allocation').then((r) => setAllocation(r.data)).catch((e) => {
      console.warn('allocation failed', e.response?.data?.error || e.message);
    });
    api.get('/accounts').then((r) => setAccounts(r.data.accounts)).catch((e) => {
      setError(e.response?.data?.error || 'Failed to load accounts');
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(order)); } catch {}
  }, [order]);
  useEffect(() => {
    try { localStorage.setItem(VISIBILITY_STORAGE_KEY, JSON.stringify(visibility)); } catch {}
  }, [visibility]);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...collapsed])); } catch {}
  }, [collapsed]);
  useEffect(() => {
    try { localStorage.setItem('mp-dashboard-compact', JSON.stringify(compactView)); } catch {}
  }, [compactView]);
  useEffect(() => {
    try { localStorage.setItem(TREND_PREFS_KEY, JSON.stringify(trendPrefs)); } catch {}
  }, [trendPrefs]);
  useEffect(() => {
    try { localStorage.setItem(ALLOC_PREFS_KEY, JSON.stringify(allocPrefs)); } catch {}
  }, [allocPrefs]);

  // ---- Hooks must stay above early returns (React #310) ----
  // Derive series safely even when report is still loading
  const seriesForInsights = report?.series ?? null;
  const allAccountsForMix = accounts || [];

  const insights = useMemo(() => {
    const s = seriesForInsights;
    if (!s?.length) return null;
    if (s.length < 2) return { avgMonthly: null, best: null, worst: null, months: s.length };
    let best = { delta: -Infinity, date: null };
    let worst = { delta: Infinity, date: null };
    let sum = 0;
    for (let i = 1; i < s.length; i++) {
      const delta = s[i].netWorth - s[i - 1].netWorth;
      sum += delta;
      if (delta > best.delta) best = { delta, date: s[i].date, prev: s[i - 1].date };
      if (delta < worst.delta) worst = { delta, date: s[i].date, prev: s[i - 1].date };
    }
    const avgMonthly = sum / (s.length - 1);
    const last3 = s.slice(-4);
    let momentum = null;
    if (last3.length >= 2) {
      const recentDelta = last3[last3.length - 1].netWorth - last3[0].netWorth;
      momentum = recentDelta / Math.max(1, last3.length - 1);
    }
    return { avgMonthly, best, worst, months: s.length, momentum };
  }, [seriesForInsights]);

  const institutionMix = useMemo(() => {
    const map = new Map();
    let total = 0;
    for (const a of allAccountsForMix) {
      if (a.archived || !a.latestValue) continue;
      const isAssetTarget = allocPrefs.tab === 'liabilities' ? !a.isAsset : a.isAsset;
      if (!isAssetTarget) continue;
      const key = a.institution?.trim() || 'No institution';
      map.set(key, (map.get(key) || 0) + a.latestValue);
      total += a.latestValue;
    }
    return [...map.entries()].map(([name, val]) => ({ name, total: val, pct: share(total, val) })).sort((a, b) => b.total - a.total);
  }, [allAccountsForMix, allocPrefs.tab]);

  if (error) {
    return (
      <p className="flex items-center gap-2 rounded-md bg-negative/10 p-4 text-negative">
        <AlertCircle size={16} className="shrink-0" />
        {error}
      </p>
    );
  }
  if (!report) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const moveSection = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    setOrder((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(fromId);
      const toIdx = next.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(toIdx, 0, next.splice(fromIdx, 1)[0]);
      return next;
    });
  };

  const moveByOffset = (id, offset) => {
    setOrder((prev) => {
      const idx = prev.indexOf(id);
      const target = idx + offset;
      if (idx === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const toggleVisibility = (id) => {
    setVisibility((prev) => ({ ...prev, [id]: prev[id] === false ? true : false }));
  };

  const toggleCollapsed = (id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDragStart = (key) => (e) => {
    setDragId(key);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', key); } catch {}
  };
  const handleDragEnter = (key) => (e) => {
    e.preventDefault();
    if (dragId && dragId !== key) setOverId(key);
  };
  const handleDrop = (key) => (e) => {
    e.preventDefault();
    const source = dragId || (() => { try { return e.dataTransfer.getData('text/plain'); } catch { return null; } })();
    moveSection(source, key);
    setDragId(null);
    setOverId(null);
  };
  const endDrag = () => { setDragId(null); setOverId(null); };

  const { current, changes, series } = report;
  const allAccounts = accounts || [];

  const recent = [...allAccounts]
    .filter((a) => a.latestDate)
    .sort((a, b) => (a.latestDate < b.latestDate ? 1 : -1))
    .slice(0, 6);

  const topAssets = [...allAccounts]
    .filter((a) => a.isAsset && a.latestValue !== null && a.latestValue !== undefined)
    .sort((a, b) => b.latestValue - a.latestValue)
    .slice(0, 5);

  const topLiabilities = [...allAccounts]
    .filter((a) => !a.isAsset && a.latestValue !== null && a.latestValue !== undefined)
    .sort((a, b) => b.latestValue - a.latestValue)
    .slice(0, 5);

  const yoyChange = (() => {
    if (!series?.length || !current?.netWorth) return null;
    const cut = new Date(); cut.setUTCFullYear(cut.getUTCFullYear()-1);
    const cutStr = cut.toISOString().slice(0,10);
    let idx = -1;
    for (let i=series.length-1;i>=0;i--) if (series[i].date <= cutStr) { idx=i; break; }
    if (idx===-1) return null;
    const base = series[idx].netWorth;
    const delta = current.netWorth - base;
    const pctVal = base ? Math.round((delta/Math.abs(base))*10000)/100 : null;
    return { delta, pct: pctVal, since: series[idx].date };
  })();

  const neverUpdated = [...allAccounts].filter((a)=>!a.archived && !a.latestDate).slice(0,5);
  const staleAccounts = [...allAccounts]
    .filter((a) => !a.archived && a.latestDate && daysSince(a.latestDate) >= 45)
    .sort((a, b) => daysSince(b.latestDate) - daysSince(a.latestDate))
    .slice(0, 5);

  const cashBuffer = allAccounts
    .filter((a) => a.isAsset && a.categoryName === 'Cash' && a.latestValue)
    .reduce((sum, a) => sum + a.latestValue, 0);

  const debtRatio = current.assets > 0 ? current.liabilities / current.assets : null;
  const leverage = current.netWorth > 0 && current.liabilities > 0 ? current.liabilities / current.netWorth : null;
  const cashCoverage = current.liabilities > 0 ? cashBuffer / current.liabilities : null;

  const totalAssets = current.assets || 0;
  const totalLiabilities = current.liabilities || 0;

  const assetMix = (allocation?.assets || []).map((row) => ({ ...row, pct: share(totalAssets, row.total) }));
  const liabilityMix = (allocation?.liabilities || []).map((row) => ({ ...row, pct: share(totalLiabilities, row.total) }));

  const deltaCls = (d) => (d >= 0 ? 'text-positive' : 'text-negative');

  const hiddenCount = DEFAULT_ORDER.filter((id) => !isVisible(id)).length;
  const visibleOrder = order.filter(isVisible);

  // Concentration risk: largest asset share
  const largestAssetShare = (() => {
    if (!assetMix.length || !totalAssets) return null;
    return assetMix[0].pct;
  })();

  const sectionContent = {
    summary: (
      <div className={`grid grid-cols-1 gap-4 xl:grid-cols-5 ${compactView ? 'p-3' : 'p-5'}`}>
        <div className={`rounded-xl border border-border bg-surface shadow-sm xl:col-span-2 ${compactView ? 'p-3' : 'p-5'}`}>
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
            <Sparkles size={14} className="text-primary" />
            Net Worth
          </h3>
          <p className={`font-bold ${compactView ? 'text-2xl' : 'text-3xl'} ${deltaCls(current.netWorth >= 0 ? 1 : -1)}`}>
            {money(current.netWorth)}
          </p>
          <div className="mt-2 space-y-1">
            <ChangeChip label="Since previous" change={changes.sincePrevSnapshot} />
            <ChangeChip label="Last 30 days" change={changes.last30Days} />
            {yoyChange && <ChangeChip label="YoY" change={yoyChange} />}
          </div>
        </div>
        <MetricCard label="Assets" value={money(current.assets)} hint={`As of ${formatDate(current.asOf)}`} tone="text-positive" icon={Landmark} compact={compactView} />
        <MetricCard label="Liabilities" value={money(current.liabilities)} hint={`${staleAccounts.length ? `${staleAccounts.length} stale` : 'All fresh'}`} tone="text-negative" icon={Scale} compact={compactView} />
        <MetricCard label="Cash Buffer" value={money(cashBuffer)} hint={`${cashCoverage !== null ? `${(cashCoverage*100).toFixed(0)}% of liabilities` : 'Total in Cash category'}`} icon={PiggyBank} compact={compactView} />
      </div>
    ),

    insights: (
      <div className={`grid grid-cols-1 gap-4 lg:grid-cols-4 ${compactView ? 'p-3' : 'p-5'}`}>
        <div className={`rounded-xl border border-border bg-surface p-4 shadow-sm ${compactView ? 'p-3' : 'p-4'}`}>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Zap size={13} className="text-primary" /> Avg monthly</p>
          <p className={`mt-1 font-bold ${insights?.avgMonthly >=0 ? 'text-positive' : 'text-negative'} ${compactView ? 'text-lg' : 'text-xl'}`}>{insights?.avgMonthly == null ? '—' : signedMoney(Math.round(insights.avgMonthly))}</p>
          <p className="mt-1 text-xs text-muted">Over {insights?.months || 0} snapshots</p>
        </div>
        <div className={`rounded-xl border border-border bg-surface p-4 shadow-sm ${compactView ? 'p-3' : 'p-4'}`}>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><ArrowUpRight size={13} className="text-positive" /> Best month</p>
          <p className={`mt-1 font-bold text-positive ${compactView ? 'text-lg' : 'text-xl'}`}>{insights?.best ? signedMoney(insights.best.delta) : '—'}</p>
          <p className="mt-1 text-xs text-muted">{insights?.best ? formatDate(insights.best.date) : 'No data'}</p>
        </div>
        <div className={`rounded-xl border border-border bg-surface p-4 shadow-sm ${compactView ? 'p-3' : 'p-4'}`}>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><ArrowDownRight size={13} className="text-negative" /> Worst month</p>
          <p className={`mt-1 font-bold ${insights?.worst && insights.worst.delta < 0 ? 'text-negative' : 'text-text'} ${compactView ? 'text-lg' : 'text-xl'}`}>{insights?.worst ? signedMoney(insights.worst.delta) : '—'}</p>
          <p className="mt-1 text-xs text-muted">{insights?.worst ? formatDate(insights.worst.date) : 'No data'}</p>
        </div>
        <div className={`rounded-xl border border-border bg-surface p-4 shadow-sm ${compactView ? 'p-3' : 'p-4'}`}>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Target size={13} className="text-primary" /> Concentration</p>
          <p className={`mt-1 font-bold ${largestAssetShare !== null && largestAssetShare > 50 ? 'text-accent' : 'text-text'} ${compactView ? 'text-lg' : 'text-xl'}`}>{largestAssetShare === null ? '—' : `${largestAssetShare.toFixed(1)}%`}</p>
          <p className="mt-1 text-xs text-muted">Largest category share</p>
        </div>
      </div>
    ),

    ratios: (
      <div className={`grid grid-cols-1 gap-4 lg:grid-cols-4 ${compactView ? 'p-3' : 'p-5'}`}>
        <MetricCard label="Debt Ratio" value={debtRatio === null ? '—' : `${(debtRatio * 100).toFixed(1)}%`} hint="Liabilities / assets" tone={debtRatio !== null && debtRatio > 0.5 ? 'text-negative' : 'text-text'} icon={Scale} compact={compactView} />
        <MetricCard label="Leverage" value={leverage === null ? '—' : `${leverage.toFixed(2)}x`} hint="Liabilities / net worth" tone={leverage !== null && leverage > 1 ? 'text-negative' : 'text-text'} icon={Activity} compact={compactView} />
        <MetricCard label="Cash Coverage" value={cashCoverage === null ? '—' : `${(cashCoverage * 100).toFixed(0)}%`} hint="Cash vs liabilities" tone={cashCoverage !== null && cashCoverage < 0.2 ? 'text-accent' : 'text-text'} icon={PiggyBank} compact={compactView} />
        <MetricCard label="Tracked Accounts" value={String(allAccounts.filter((a) => !a.archived).length)} hint={`${allAccounts.filter((a) => a.latestDate).length} with history`} icon={Users} compact={compactView} />
      </div>
    ),

    allocation: (
      <div className={`${compactView ? 'p-3' : 'p-5'} space-y-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border p-1">
            {[
              { key: 'assets', label: 'Assets', count: assetMix.length },
              { key: 'liabilities', label: 'Liabilities', count: liabilityMix.length },
            ].map((t) => (
              <button key={t.key} onClick={() => setAllocPrefs((p)=>({ ...p, tab: t.key }))} className={`rounded-md px-3 py-1 text-xs font-semibold ${allocPrefs.tab===t.key ? 'bg-primary text-white' : 'text-muted hover:text-text'}`}>
                {t.label} ({t.count})
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Building2 size={13} /> Group by:
          </div>
          <select value={allocPrefs.groupBy} onChange={(e)=> setAllocPrefs((p)=> ({ ...p, groupBy: e.target.value }))} className="rounded-md border border-border bg-surface px-2 py-1 text-xs">
            <option value="category">Category</option>
            <option value="institution">Institution</option>
          </select>
          <span className="ml-auto text-xs text-muted">{allocPrefs.tab === 'assets' ? `${money(totalAssets)} total` : `${money(totalLiabilities)} total`}</span>
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <Card title={`${allocPrefs.tab === 'assets' ? 'Asset' : 'Liability'} allocation`} icon={PieChart}>
            <AllocationChart data={allocPrefs.tab === 'assets' ? allocation?.assets : allocation?.liabilities} />
          </Card>
          <Card title={allocPrefs.groupBy === 'institution' ? 'By institution' : 'Breakdown'} icon={BarChart3}>
            {(() => {
              const rows = allocPrefs.groupBy === 'institution' ? institutionMix : (allocPrefs.tab === 'assets' ? assetMix : liabilityMix);
              if (!rows.length) return <p className={`py-10 text-center text-sm ${compactView ? 'text-xs' : ''} text-muted`}>Add balances to see breakdown.</p>;
              return (
                <div className="space-y-3">
                  {rows.slice(0, 8).map((row) => (
                    <div key={row.name}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="truncate pr-2">{row.name}</span>
                        <span className="shrink-0 font-medium text-muted">{money(row.total)} ({row.pct.toFixed(1)}%)</span>
                      </div>
                      <div className="h-2 rounded-full bg-surfaceAlt">
                        <div className={`h-full rounded-full ${compactView ? 'h-1.5' : 'h-2'} ${allocPrefs.tab === 'liabilities' ? 'bg-negative' : 'bg-primary'}`} style={{ width: `${row.pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </Card>
          <Card title="Quick actions" icon={PiggyBank}>
            <div className="space-y-2">
              <Link to="/accounts" className={`flex items-center gap-2.5 rounded-md border border-border ${compactView ? 'px-2.5 py-1.5 text-sm' : 'px-3 py-2'} font-medium transition-colors hover:border-primary/40 hover:bg-surfaceAlt`}>
                <Plus size={15} className="text-primary" /> Add or update balances
              </Link>
              <Link to="/reports" className={`flex items-center gap-2.5 rounded-md border border-border ${compactView ? 'px-2.5 py-1.5 text-sm' : 'px-3 py-2'} font-medium transition-colors hover:border-primary/40 hover:bg-surfaceAlt`}>
                <FileDown size={15} className="text-primary" /> Create PDF report
              </Link>
              <Link to="/settings" className={`flex items-center gap-2.5 rounded-md border border-border ${compactView ? 'px-2.5 py-1.5 text-sm' : 'px-3 py-2'} font-medium transition-colors hover:border-primary/40 hover:bg-surfaceAlt`}>
                <SettingsIcon size={15} className="text-primary" /> Manage themes & users
              </Link>
              <p className={`pt-1 ${compactView ? 'text-xs' : 'text-sm'} text-muted`}>Tip: switch Group by to Institution for a cross-bank view.</p>
            </div>
          </Card>
        </div>
      </div>
    ),

    liabilities: (
      <div className={`grid grid-cols-1 gap-6 xl:grid-cols-3 ${compactView ? 'p-3' : 'p-5'}`}>
        <Card title="Liability mix" icon={PieChart}>
          {!liabilityMix.length ? (
            <p className="py-10 text-center text-sm text-muted">No liability balances - great!</p>
          ) : (
            <AllocationChart data={allocation?.liabilities} />
          )}
        </Card>
        <Card title="Debt breakdown" icon={Layers}>
          {!liabilityMix.length ? (
            <p className="py-10 text-center text-sm text-muted">No debts tracked.</p>
          ) : (
            <div className="space-y-3">
              {liabilityMix.slice(0,6).map((row)=> (
                <div key={row.name}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>{row.name}</span>
                    <span className="font-medium text-muted">{money(row.total)} ({row.pct.toFixed(1)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-surfaceAlt">
                    <div className="h-full rounded-full bg-negative" style={{ width: `${row.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title="Payoff focus" icon={Target}>
          {!topLiabilities.length ? (
            <p className="py-10 text-center text-sm text-muted">No liabilities to prioritize.</p>
          ) : (
            <div className="space-y-2">
              {topLiabilities.map((a)=> (
                <Link key={a.id} to={`/accounts/${a.id}`} className="flex items-center justify-between rounded-md border border-border px-3 py-2 hover:border-negative/40 hover:bg-surfaceAlt">
                  <div>
                    <p className="text-sm font-medium">{a.name}</p>
                    <p className="text-xs text-muted">{a.categoryName}</p>
                  </div>
                  <span className="font-semibold text-negative">{money(a.latestValue)}</span>
                </Link>
              ))}
              <p className="pt-2 text-xs text-muted">Largest debts first - consider avalanche or snowball strategy.</p>
            </div>
          )}
        </Card>
      </div>
    ),

    trend: (
      <Card
        title="Net worth over time"
        icon={trendPrefs.chartType === 'area' ? AreaChartIcon : LineChart}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold ${range === r.key ? 'bg-primary text-white' : 'bg-surfaceAlt text-muted hover:text-text'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <span className="hidden h-4 w-px bg-border sm:block" />
            <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
              <button onClick={() => setTrendPrefs((p)=>({ ...p, chartType: 'line' }))} className={`rounded px-1.5 py-0.5 ${trendPrefs.chartType==='line' ? 'bg-surfaceAlt text-text' : 'text-muted'}`} title="Line chart"><LineChart size={14} /></button>
              <button onClick={() => setTrendPrefs((p)=>({ ...p, chartType: 'area' }))} className={`rounded px-1.5 py-0.5 ${trendPrefs.chartType==='area' ? 'bg-surfaceAlt text-text' : 'text-muted'}`} title="Area chart"><AreaChartIcon size={14} /></button>
            </div>
            <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={trendPrefs.showAssets} onChange={(e)=> setTrendPrefs((p)=> ({ ...p, showAssets: e.target.checked }))} className="h-3 w-3 accent-[var(--color-primary)]" /> Assets</label>
            <label className="flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={trendPrefs.showLiabilities} onChange={(e)=> setTrendPrefs((p)=> ({ ...p, showLiabilities: e.target.checked }))} className="h-3 w-3 accent-[var(--color-primary)]" /> Debt</label>
          </div>
        }
      >
        <NetWorthChart series={series} chartType={trendPrefs.chartType} showAssets={trendPrefs.showAssets} showLiabilities={trendPrefs.showLiabilities} />
        {insights?.momentum != null && (
          <p className="mt-2 text-center text-xs text-muted">Recent momentum: <span className={insights.momentum >=0 ? 'text-positive' : 'text-negative'}>{signedMoney(Math.round(insights.momentum))}/mo</span> (last 3 snapshots)</p>
        )}
      </Card>
    ),

    accounts: (
      <div className={`grid grid-cols-1 gap-6 xl:grid-cols-3 ${compactView ? 'p-3' : 'p-5'}`}>
        <Card title="Recently updated" icon={History}>
          {!recent.length ? (
            <p className={`py-10 text-center text-sm ${compactView ? 'text-xs' : ''} text-muted`}>No balances yet - <Link to="/accounts" className="text-primary hover:underline">add an account</Link> to get started.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((a) => (
                <li key={a.id}>
                  <Link to={`/accounts/${a.id}`} className={`flex items-center justify-between rounded-md px-2 transition-colors hover:bg-surfaceAlt ${compactView ? 'py-1.5' : 'py-2.5'}`}>
                    <div>
                      <p className="font-medium">{a.name}</p>
                      <p className={`text-xs text-muted ${compactView ? 'text-[0.6rem]' : ''}`}>{a.categoryName} - updated {formatDate(a.latestDate)}</p>
                    </div>
                    <p className={a.isAsset ? 'font-semibold text-positive' : 'font-semibold text-negative'}>{money(a.latestValue)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Top assets" icon={Landmark}>
          {!topAssets.length ? (
            <p className={`py-10 text-center text-sm ${compactView ? 'text-xs' : ''} text-muted`}>No asset balances yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {topAssets.map((a) => (
                <li key={a.id}>
                  <Link to={`/accounts/${a.id}`} className={`flex items-center justify-between rounded-md px-2 transition-colors hover:bg-surfaceAlt ${compactView ? 'py-1.5' : 'py-2.5'}`}>
                    <div>
                      <p className="font-medium">{a.name}</p>
                      <p className={`text-xs text-muted ${compactView ? 'text-[0.6rem]' : ''}`}>{a.categoryName || 'Uncategorized'}</p>
                    </div>
                    <p className="font-semibold text-positive">{money(a.latestValue)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Top liabilities" icon={Scale}>
          {!topLiabilities.length ? (
            <p className={`py-10 text-center text-sm ${compactView ? 'text-xs' : ''} text-muted`}>No liabilities recorded.</p>
          ) : (
            <ul className="divide-y divide-border">
              {topLiabilities.map((a) => (
                <li key={a.id}>
                  <Link to={`/accounts/${a.id}`} className={`flex items-center justify-between rounded-md px-2 transition-colors hover:bg-surfaceAlt ${compactView ? 'py-1.5' : 'py-2.5'}`}>
                    <div>
                      <p className="font-medium">{a.name}</p>
                      <p className={`text-xs text-muted ${compactView ? 'text-[0.6rem]' : ''}`}>{a.categoryName || 'Uncategorized'}</p>
                    </div>
                    <p className="font-semibold text-negative">{money(a.latestValue)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    ),

    attention: (
      <Card title="Needs attention" icon={BellRing}>
        {!staleAccounts.length && !neverUpdated.length ? (
          <p className="flex items-center gap-2 text-sm text-positive"><CheckCircle2 size={16} /> Great job - all active accounts were updated within the last 45 days.</p>
        ) : (
          <div className="space-y-3">
            {neverUpdated.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Never updated ({neverUpdated.length})</p>
                <div className="space-y-2">
                  {neverUpdated.map((a) => (
                    <div key={a.id} className={`flex items-center justify-between rounded-md border border-border px-3 transition-colors hover:border-primary/40 ${compactView ? 'py-1.5' : 'py-2'}`}>
                      <div className="flex items-center gap-2.5">
                        <AlertTriangle size={15} className="shrink-0 text-accent" />
                        <div>
                          <p className="font-medium">{a.name}</p>
                          <p className={`text-xs text-muted ${compactView ? 'text-[0.6rem]' : ''}`}>No balance history yet</p>
                        </div>
                      </div>
                      <Link to={`/accounts/${a.id}`} className="text-sm font-medium text-primary hover:underline">Update now</Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {staleAccounts.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Stale ≥45 days ({staleAccounts.length})</p>
                <div className="space-y-2">
                  {staleAccounts.map((a) => (
                    <div key={a.id} className={`flex items-center justify-between rounded-md border border-border px-3 transition-colors hover:border-primary/40 ${compactView ? 'py-1.5' : 'py-2'}`}>
                      <div className="flex items-center gap-2.5">
                        <AlertTriangle size={15} className="shrink-0 text-accent" />
                        <div>
                          <p className="font-medium">{a.name}</p>
                          <p className={`text-xs text-muted ${compactView ? 'text-[0.6rem]' : ''}`}>Last updated {daysSince(a.latestDate)} days ago ({formatDate(a.latestDate)})</p>
                        </div>
                      </div>
                      <Link to={`/accounts/${a.id}`} className="text-sm font-medium text-primary hover:underline">Update now</Link>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    ),
  };

  return (
    <div className={`space-y-6 ${compactView ? 'space-y-3' : ''}`}>
      {/* Top toolbar: versatile controls */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {editLayout ? (
          <>
            <span className="mr-auto hidden text-xs text-muted sm:inline">Drag by handle, toggle eyes to hide, or use arrows. Changes save automatically.</span>
            <button onClick={() => { setVisibility({}); setOrder([...DEFAULT_ORDER]); setCollapsed(new Set()); setTrendPrefs({ chartType:'line', showAssets:true, showLiabilities:true}); setAllocPrefs({ tab:'assets', groupBy:'category'}); }} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surfaceAlt hover:text-text">
              <RotateCcw size={14} /> Reset all
            </button>
            <button onClick={() => { setEditLayout(false); endDrag(); }} className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90">
              <Check size={15} /> Done
            </button>
          </>
        ) : (
          <button onClick={() => setEditLayout(true)} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surfaceAlt hover:text-text">
            <PencilRuler size={14} /> Customize dashboard
          </button>
        )}
        <button onClick={() => setCompactView(!compactView)} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-muted transition-colors hover:bg-surfaceAlt hover:text-text">
          {compactView ? <Armchair size={14} /> : <Rows3 size={14} />} {compactView ? 'Comfortable' : 'Compact'}
        </button>
      </div>

      {/* Hidden widgets gallery - only in edit mode */}
      {editLayout && hiddenCount > 0 && (
        <div className="rounded-xl border border-dashed border-border bg-surfaceAlt/50 p-4">
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><EyeOff size={13} /> Hidden widgets ({hiddenCount})</h4>
          <p className="mb-3 text-xs text-muted">These sections are hidden from your dashboard. Click Show to restore them - they will return to their previous position.</p>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_ORDER.filter((id)=> !isVisible(id)).map((id)=> {
              const Icon = SECTION_ICONS[id] || Layers;
              return (
                <button key={id} onClick={()=> toggleVisibility(id)} className="flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-surface">
                  <Icon size={13} className="text-primary" /> {SECTION_LABELS[id]} <Eye size={13} className="text-muted" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick add widget bar - versatile */}
      {editLayout && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3">
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted"><Wallet size={13} /> Widgets:</span>
          {DEFAULT_ORDER.map((id)=> {
            const Icon = SECTION_ICONS[id] || Layers;
            const visible = isVisible(id);
            return (
              <button
                key={id}
                onClick={()=> toggleVisibility(id)}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${visible ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-surfaceAlt text-muted line-through'}`}
                title={SECTION_DESCRIPTIONS[id]}
              >
                <Icon size={12} /> {SECTION_LABELS[id]} {visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state when all hidden */}
      {visibleOrder.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center">
          <LayoutGrid size={28} className="mx-auto mb-3 text-muted" />
          <h3 className="font-semibold">No widgets visible</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">You have hidden every dashboard section. Use Customize to restore widgets, or reset your layout.</p>
          <button onClick={() => setVisibility({})} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">Show all widgets</button>
        </div>
      ) : (
        visibleOrder.map((key) => {
          const isDragging = editLayout && dragId === key;
          const isDropTarget = editLayout && overId === key && dragId !== key;
          const isCollapsed = collapsed.has(key);
          const Icon = SECTION_ICONS[key] || Layers;
          return (
            <div
              key={key}
              draggable={editLayout}
              onDragStart={editLayout ? handleDragStart(key) : undefined}
              onDragEnter={editLayout ? handleDragEnter(key) : undefined}
              onDragOver={editLayout ? (e) => e.preventDefault() : undefined}
              onDrop={editLayout ? handleDrop(key) : undefined}
              onDragEnd={editLayout ? endDrag : undefined}
              className={`relative rounded-xl border bg-surface shadow-sm transition-all ${editLayout ? 'cursor-grab active:cursor-grabbing border-dashed' : 'border-border'} ${isDragging ? 'opacity-40' : ''} ${isDropTarget ? 'ring-2 ring-primary ring-offset-2 ring-offset-[var(--color-bg)]' : ''} ${isCollapsed ? 'opacity-90' : ''}`}
            >
              {/* Edit toolbar per widget */}
              {editLayout ? (
                <div className="absolute -top-3 right-4 z-20 flex select-none items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-0.5 shadow">
                  <GripVertical size={13} className="cursor-grab text-muted" />
                  <span className="px-1 text-xs font-semibold">{SECTION_LABELS[key]}</span>
                  <span className="mx-0.5 h-4 w-px bg-border" />
                  <button type="button" tabIndex={-1} onClick={() => toggleVisibility(key)} className="rounded-full p-0.5 text-muted hover:text-text" title="Hide widget" aria-label={`Hide ${SECTION_LABELS[key]}`}><EyeOff size={13} /></button>
                  <button type="button" tabIndex={-1} onClick={() => toggleCollapsed(key)} className="rounded-full p-0.5 text-muted hover:text-text" title={isCollapsed ? 'Expand' : 'Collapse'}>{isCollapsed ? <Maximize2 size={13} /> : <Minimize2 size={13} />}</button>
                  <span className="mx-0.5 h-4 w-px bg-border" />
                  <button type="button" tabIndex={-1} onClick={() => moveByOffset(key, -1)} disabled={order.indexOf(key) === 0} className="rounded-full p-0.5 text-muted transition-colors hover:text-text disabled:opacity-30" aria-label={`Move ${SECTION_LABELS[key]} up`}><ChevronUp size={13} /></button>
                  <button type="button" tabIndex={-1} onClick={() => moveByOffset(key, 1)} disabled={order.indexOf(key) === order.length - 1} className="rounded-full p-0.5 text-muted transition-colors hover:text-text disabled:opacity-30" aria-label={`Move ${SECTION_LABELS[key]} down`}><ChevronDown size={13} /></button>
                </div>
              ) : (
                <button onClick={() => toggleCollapsed(key)} className="absolute right-3 top-3 z-10 rounded-md p-1 text-muted hover:bg-surfaceAlt hover:text-text" title={isCollapsed ? 'Expand section' : 'Collapse section'} aria-label={isCollapsed ? `Expand ${SECTION_LABELS[key]}` : `Collapse ${SECTION_LABELS[key]}`}>
                  {isCollapsed ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                </button>
              )}

              {/* Versatile collapse wrapper */}
              {isCollapsed ? (
                <div className={`flex items-center gap-2 px-5 ${compactView ? 'py-3' : 'py-4'}`}>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surfaceAlt text-primary"><Icon size={15} /></span>
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{SECTION_LABELS[key]}</h3>
                  <span className="text-xs text-muted">- collapsed</span>
                  <button onClick={()=> toggleCollapsed(key)} className="ml-auto text-xs font-medium text-primary hover:underline">Expand</button>
                </div>
              ) : (
                <div className={editLayout ? 'pt-2' : ''}>{sectionContent[key]}</div>
              )}
            </div>
          );
        })
      )}

      {/* Footer hint when not editing */}
      {!editLayout && visibleOrder.length > 0 && (
        <p className="text-center text-xs text-muted">Tip: Click <span className="inline-flex items-center gap-1 font-medium text-text"><PencilRuler size={12} /> Customize dashboard</span> to reorder, hide/show, or collapse widgets. Drag handles, chart style and grouping preferences are saved automatically.</p>
      )}
    </div>
  );
}
