import React, { useEffect, useRef, useState } from 'react';
import {
  Eye,
  Download,
  X,
  FileText,
  ListChecks,
  Wand2,
  Zap,
  FileBarChart2,
  CalendarDays,
  ClipboardList,
  TrendingUp,
  Wallet,
  AlertCircle,
} from 'lucide-react';
import api from '../api/client.js';
import Card from '../components/Card.jsx';
import Spinner from '../components/Spinner.jsx';
import NetWorthChart from '../components/charts/NetWorthChart.jsx';
import AllocationChart from '../components/charts/AllocationChart.jsx';
import { useThemeColors } from '../components/useThemeColors.js';
import { todayISO } from '../utils/format.js';

const RANGES = [
  { key: '6m', label: 'Last 6 months' },
  { key: '1y', label: 'Last 12 months' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom dates' },
];

const DEFAULT_SECTIONS = {
  cover: true,
  summary: true,
  trend: true,
  allocation: true,
  accounts: true,
  topHoldings: true,
  alerts: true,
};

const SECTION_LABELS = [
  { key: 'cover', label: 'Cover page', hint: 'Branded title page with headline net worth' },
  { key: 'summary', label: 'Executive summary', hint: 'Key metrics, changes, debt ratio & leverage' },
  { key: 'trend', label: 'Net worth trend chart', hint: 'Assets / liabilities / net worth over time' },
  { key: 'allocation', label: 'Allocation analysis', hint: 'Donut chart plus category breakdown tables' },
  { key: 'accounts', label: 'Full account listing', hint: 'Every account grouped by category with subtotals' },
  { key: 'topHoldings', label: 'Top holdings', hint: 'Largest assets and liabilities side by side' },
  { key: 'alerts', label: 'Maintenance alerts', hint: 'Accounts not updated in 45+ days' },
];

const inputCls =
  'w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none';
const labelCls = 'mb-1 block text-sm font-medium';

export default function ReportsPage() {
  const [title, setTitle] = useState('Net Worth Report');
  const [range, setRange] = useState('1y');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState(todayISO());
  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [report, setReport] = useState(null);
  const [allocation, setAllocation] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [busyMode, setBusyMode] = useState(null); // null | 'preview' | 'download'
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const trendRef = useRef(null);
  const allocRef = useRef(null);
  const previewRef = useRef(null);
  const { primary } = useThemeColors();

  useEffect(() => {
    api
      .get('/reports/net-worth', { params: { range: range === 'custom' ? 'all' : range } })
      .then((r) => setReport(r.data))
      .catch((e) => setError(e.response?.data?.error || 'Failed to load report data'));
  }, [range]);

  useEffect(() => {
    api.get('/reports/allocation').then((r) => setAllocation(r.data)).catch((e) => setError(e.response?.data?.error || 'Allocation load failed'));
    api.get('/accounts').then((r) => setAccounts(r.data.accounts)).catch((e) => setError(e.response?.data?.error || 'Accounts load failed'));
  }, []);

  const trendSeries = (() => {
    if (!report) return [];
    if (range === 'custom') {
      return report.series.filter((p) => {
        if (customFrom && p.date < customFrom) return false;
        if (customTo && p.date > customTo) return false;
        return true;
      });
    }
    return report.series;
  })();

  const toggleSection = (key) =>
    setSections((s) => ({ ...s, [key]: !s[key] }));

  useEffect(() => {
    if (range === 'custom' && customFrom && customTo && customFrom > customTo) {
      setError('Custom range: "From" date must be on or before "To".');
    } else if (error === 'Custom range: "From" date must be on or before "To".') {
      setError('');
    }
  }, [customFrom, customTo, range]); // eslint-disable-line react-hooks/exhaustive-deps

  // Shared pipeline: capture the offscreen charts and build the pdfmake doc definition.
  const buildDoc = async () => {
    const { captureChartSvg, buildReportDoc } = await import('../utils/reportPdf.js');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const [trendPng, allocPng] = await Promise.all([
      captureChartSvg(trendRef.current),
      captureChartSvg(allocRef.current),
    ]);

    const cashBuffer = (accounts || [])
      .filter((a) => a.isAsset && a.categoryName === 'Cash' && a.latestValue)
      .reduce((s, a) => s + a.latestValue, 0);

    const rangeLabel =
      range === 'custom'
        ? `${customFrom || 'start'} to ${customTo || todayISO()}`
        : RANGES.find((r) => r.key === range)?.label;

    return buildReportDoc({
      options: { ...sections, title, rangeLabel, cashBuffer },
      report: { ...report, series: trendSeries },
      allocation: allocation || { assets: [], liabilities: [] },
      accounts: accounts || [],
      trendPng,
      allocPng,
      accentHex: primary,
    });
  };

  const generate = async () => {
    setError('');
    setBusyMode('download');
    try {
      const { pdfMake } = await import('../utils/reportPdf.js');
      const doc = await buildDoc();
      pdfMake.createPdf(doc).download(`MyPortfolio-${title.replace(/[^\w]+/g, '-')}-${todayISO()}.pdf`);
    } catch (e) {
      console.error(e);
      setError(e.message || 'Could not generate the PDF.');
    } finally {
      setBusyMode(null);
    }
  };

  const preview = async () => {
    setError('');
    setBusyMode('preview');
    try {
      const { pdfMake } = await import('../utils/reportPdf.js');
      const doc = await buildDoc();
      pdfMake.createPdf(doc).getBlob((blob) => {
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setShowPreview(true);
        requestAnimationFrame(() =>
          previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        );
      });
    } catch (e) {
      console.error(e);
      setError(e.message || 'Could not render the preview.');
    } finally {
      setBusyMode(null);
    }
  };

  const closePreview = () => {
    setShowPreview(false);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  if (!report) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-bold">Reports</h2>
        <p className="text-sm text-muted">Customize and download an elegant PDF summary of your portfolio.</p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Report details" icon={FileText}>
            <div className="space-y-4">
              <div>
                <label className={labelCls} htmlFor="rep-title">Report title</label>
                <input id="rep-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className={labelCls} htmlFor="rep-range">Trend period</label>
                  <select id="rep-range" value={range} onChange={(e) => setRange(e.target.value)} className={inputCls}>
                    {RANGES.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </div>
                {range === 'custom' && (
                  <>
                    <div>
                      <label className={labelCls} htmlFor="rep-from">From</label>
                      <input id="rep-from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor="rep-to">To</label>
                      <input id="rep-to" type="date" max={todayISO()} value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={inputCls} />
                    </div>
                  </>
                )}
              </div>
            </div>
          </Card>

          <Card title="Sections to include" icon={ListChecks}>
            <ul className="divide-y divide-border">
              {SECTION_LABELS.map(({ key, label, hint }) => (
                <li key={key}>
                  <label className="flex cursor-pointer items-start gap-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={sections[key]}
                      onChange={() => toggleSection(key)}
                      className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                    />
                    <span>
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-muted">{hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setSections(DEFAULT_SECTIONS)} className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-surfaceAlt">
                Select all
              </button>
              <button
                onClick={() => setSections({ cover: true, summary: true, trend: false, allocation: false, accounts: false, topHoldings: false, alerts: false })}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-surfaceAlt"
              >
                Summary only
              </button>
            </div>
          </Card>

          {error && (
            <p className="flex items-center gap-2 rounded-md bg-negative/10 p-4 text-negative">
              <AlertCircle size={16} className="shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Generate" icon={Wand2}>
            <p className="mb-4 text-sm text-muted">
              The PDF is generated entirely on this PC — no data leaves your machine.
            </p>
            <ul className="mb-4 space-y-1.5 text-xs text-muted">
              <li className="flex items-center gap-1.5"><ListChecks size={13} /> {Object.values(sections).filter(Boolean).length} of {SECTION_LABELS.length} sections selected</li>
              <li className="flex items-center gap-1.5"><TrendingUp size={13} /> Trend: {trendSeries.length} data points</li>
              <li className="flex items-center gap-1.5"><Wallet size={13} /> {(accounts || []).filter((a) => !a.archived).length} active accounts included</li>
            </ul>
            <button
              onClick={preview}
              disabled={!!busyMode}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-border py-2.5 font-semibold transition-colors hover:bg-surfaceAlt disabled:opacity-50"
            >
              <Eye size={15} />
              {busyMode === 'preview' ? 'Rendering preview…' : 'Preview report'}
            </button>
            <button
              onClick={generate}
              disabled={!!busyMode}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Download size={15} />
              {busyMode === 'download' ? 'Generating…' : 'Download PDF'}
            </button>
          </Card>

          <Card title="Presets" icon={Zap}>
            <div className="space-y-2 text-sm">
              <button
                onClick={() => { setSections(DEFAULT_SECTIONS); setTitle('Comprehensive Net Worth Report'); setRange('all'); }}
                className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surfaceAlt px-3 py-2 text-left font-medium transition-colors hover:bg-surface"
              >
                <FileBarChart2 size={15} className="shrink-0 text-primary" />
                Comprehensive — everything, all time
              </button>
              <button
                onClick={() => { setSections({ cover: true, summary: true, trend: true, allocation: true, accounts: false, topHoldings: false, alerts: false }); setTitle('Monthly Summary'); setRange('6m'); }}
                className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surfaceAlt px-3 py-2 text-left font-medium transition-colors hover:bg-surface"
              >
                <CalendarDays size={15} className="shrink-0 text-primary" />
                Monthly summary — charts only
              </button>
              <button
                onClick={() => { setSections({ cover: false, summary: true, trend: false, allocation: false, accounts: true, topHoldings: false, alerts: true }); setTitle('Account Review'); setRange('1y'); }}
                className="flex w-full items-center gap-2.5 rounded-md border border-border bg-surfaceAlt px-3 py-2 text-left font-medium transition-colors hover:bg-surface"
              >
                <ClipboardList size={15} className="shrink-0 text-primary" />
                Account review — tables &amp; alerts
              </button>
            </div>
          </Card>
        </div>
      </div>

      <div ref={previewRef}>
        {showPreview && previewUrl && (
          <Card
            title="PDF preview"
            icon={Eye}
            action={
              <button
                onClick={closePreview}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surfaceAlt hover:text-text"
              >
                <X size={13} />
                Close preview
              </button>
            }
          >
            <iframe
              src={previewUrl}
              title="Report PDF preview"
              className="h-[80vh] w-full rounded-md border border-border bg-surfaceAlt"
            />
            <p className="mt-2 text-xs text-muted">
              This is the exact document that will be downloaded. Change any option above and click
              “Preview report” again to refresh it.
            </p>
          </Card>
        )}
      </div>

      <div aria-hidden className="pointer-events-none fixed left-[-10000px] top-0" style={{ width: 940 }}>
        <div ref={trendRef} style={{ width: 920, height: 340 }}>
          <NetWorthChart series={trendSeries} />
        </div>
        <div ref={allocRef} style={{ width: 520, height: 340 }}>
          <AllocationChart data={allocation?.assets} />
        </div>
      </div>
    </div>
  );
}
