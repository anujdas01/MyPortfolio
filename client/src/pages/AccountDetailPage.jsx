import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  Save,
  AlertCircle,
  LineChart,
  ChartLine,
  Table,
  Wallet,
  Layers,
  Plus,
  PiggyBank,
  Gauge,
  BadgeDollarSign,
  RefreshCw,
  Upload,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart as ReLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import api from '../api/client.js';
import Card from '../components/Card.jsx';
import Spinner from '../components/Spinner.jsx';
import Modal, { EmptyState } from '../components/Modal.jsx';
import AccountForm, { kindLabel } from '../components/AccountForm.jsx';
import ValueAreaChart from '../components/charts/ValueAreaChart.jsx';
import { money, signedMoney, pct, formatDate, todayISO, marketPrice, plainAmount } from '../utils/format.js';
import { useThemeColors } from '../components/useThemeColors.js';
import { useToast } from '../context/ToastContext.jsx';
import { inputCls, labelCls, errorCls, btnPrimary, btnOutline, btnCancel, btnIcon, btnIconDanger } from '../styles.js';

const INVESTMENT_KINDS = new Set(['brokerage', 'crypto', '401k', 'roth_ira', 'traditional_ira', 'hsa', '529', 'pension']);
const INVESTMENT_CATEGORIES = new Set(['Investment', 'Retirement']);

// Auto-update cadence for live stock pricing in the holdings breakdown table.
const AUTO_UPDATE_MS = 30000;
const AUTO_UPDATE_KEY = 'mp-holdings-auto-update';

const INCOME_TYPES = [
  { value: 'dividend', label: 'Dividend' },
  { value: 'interest', label: 'Interest' },
  { value: 'distribution', label: 'Distribution' },
  { value: 'other', label: 'Other' },
];

// Sortable columns of the holdings breakdown table. Actions is excluded.
const HOLDINGS_COLUMNS = [
  { key: 'ticker', label: 'Ticker' },
  { key: 'name', label: 'Name' },
  { key: 'shares', label: 'Shares', right: true },
  { key: 'avgCost', label: 'Avg. cost', right: true },
  { key: 'costBasis', label: 'Cost basis', right: true },
  { key: 'price', label: 'Live price', right: true },
  { key: 'market', label: 'Market value', right: true },
  { key: 'gain', label: 'Gain / Loss', right: true },
  { key: 'weight', label: 'Weight', right: true },
];

const BENCHMARK_PRESETS = [
  { key: 'sp500', label: 'S&P 500 (~10%/yr)', rate: 10 },
  { key: 'balanced', label: 'Balanced 60/40 (~7%/yr)', rate: 7 },
  { key: 'bonds', label: 'Bonds (~4%/yr)', rate: 4 },
  { key: 'inflation', label: 'Inflation (~3%/yr)', rate: 3 },
  { key: 'custom', label: 'Custom…', rate: null },
];

function yearsBetween(fromISO, toISO) {
  const a = new Date(`${fromISO}T00:00:00`).getTime();
  const b = new Date(`${toISO}T00:00:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (b - a) / (1000 * 60 * 60 * 24 * 365.25));
}

export default function AccountDetailPage() {
  const { id } = useParams();
  const { primary, positive } = useThemeColors();
  const { success: toastSuccess, error: toastError } = useToast();
  const [account, setAccount] = useState(null);
  const [snapshots, setSnapshots] = useState(null);
  const [categories, setCategories] = useState([]);
  const [error, setError] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const [balanceForm, setBalanceForm] = useState({ value: '', asOfDate: todayISO(), note: '' });
  const [balanceError, setBalanceError] = useState('');
  const [snapError, setSnapError] = useState('');
  const [hasMoreSnaps, setHasMoreSnaps] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [editingSnap, setEditingSnap] = useState(null);
  const [editSnapForm, setEditSnapForm] = useState({ value: '', asOfDate: '', note: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [historyView, setHistoryView] = useState('chart'); // 'chart' | 'table'

  // ---- Holdings ------------------------------------------------------------
  const [holdings, setHoldings] = useState(null);
  const [holdingsError, setHoldingsError] = useState('');
  const [holdingForm, setHoldingForm] = useState({ ticker: '', name: '', shares: '', avgCost: '' });
  const [holdingBusy, setHoldingBusy] = useState(false);
  const [holdingFormError, setHoldingFormError] = useState('');
  const [editingHolding, setEditingHolding] = useState(null);
  const [editHoldingForm, setEditHoldingForm] = useState({ ticker: '', name: '', shares: '', avgCost: '', assetType: '' });
  const [deleteHolding, setDeleteHolding] = useState(null);
  const [sort, setSort] = useState({ key: null, dir: 'asc' }); // holdings table sorting

  // ---- Income events --------------------------------------------------------
  const [income, setIncome] = useState(null);
  const [incomeError, setIncomeError] = useState('');
  const [incomeForm, setIncomeForm] = useState({ type: 'dividend', amount: '', date: todayISO(), holdingId: '', note: '' });
  const [incomeBusy, setIncomeBusy] = useState(false);
  const [incomeFormError, setIncomeFormError] = useState('');

  // ---- Benchmark ------------------------------------------------------------
  const [benchmarkPreset, setBenchmarkPreset] = useState('balanced');
  const [customRate, setCustomRate] = useState('7');

  // ---- Live ticker lookup (add-holding form) --------------------------------
  const [quote, setQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const lookupTimer = useRef(null);

  // ---- Symbol search picker (stocks, ETFs, crypto) ---------------------------
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settledSymbol, setSettledSymbol] = useState(null); // explicitly chosen symbol
  const [pickedAssetType, setPickedAssetType] = useState(null); // Yahoo type of the pick
  const searchTimer = useRef(null);

  const TYPE_BADGES = { EQUITY: 'Stock', ETF: 'ETF', CRYPTOCURRENCY: 'Crypto', MUTUALFUND: 'Fund' };

  // ---- Live prices for the holdings table -----------------------------------
  const [liveQuotes, setLiveQuotes] = useState({});
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveError, setLiveError] = useState('');
  const [marketBusy, setMarketBusy] = useState(false);
  const liveBusy = useRef(false); // keeps auto-update ticks from stacking requests

  // ---- Auto-update of stock pricing (toggle in the Holdings breakdown header)
  const [autoUpdate, setAutoUpdate] = useState(() => {
    try {
      const v = localStorage.getItem(AUTO_UPDATE_KEY);
      return v === null ? true : v === '1';
    } catch {
      return true;
    }
  });
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState(null); // Date of last good poll
  const nextAutoAt = useRef(0); // timestamp of the next auto-update tick
  const [countdown, setCountdown] = useState(() => Math.ceil(AUTO_UPDATE_MS / 1000)); // seconds until that tick

  useEffect(() => {
    try { localStorage.setItem(AUTO_UPDATE_KEY, autoUpdate ? '1' : '0'); } catch {}
  }, [autoUpdate]);

  // ---- Cash sleeve (settlement / sweep fund) --------------------------------
  const [cashEditing, setCashEditing] = useState(false);
  const [cashAmount, setCashAmount] = useState('');
  const [cashBusy, setCashBusy] = useState(false);
  const [cashError, setCashError] = useState('');

  // ---- Robinhood CSV import ---------------------------------------------------
  const [rhPreview, setRhPreview] = useState(null);
  const [rhBusy, setRhBusy] = useState(false);
  const [rhError, setRhError] = useState('');
  const rhFileRef = useRef(null);
  // Set once the user types in the Update balance form, so the periodic
  // auto-update reloads never overwrite an in-progress edit.
  const balanceTouched = useRef(false);

  const load = useCallback(() => {
    api
      .get(`/accounts/${id}`)
      .then((r) => {
        setAccount(r.data.account);
        if (balanceTouched.current) return;
        setBalanceForm((f) => ({
          ...f,
          value: r.data.account.latestValue !== null && r.data.account.latestValue !== undefined ? String(r.data.account.latestValue) : '',
        }));
      })
      .catch((e) => setError(e.response?.data?.error || 'Account not found'));
    api.get(`/accounts/${id}/snapshots`).then((r) => { setSnapshots(r.data.snapshots); setHasMoreSnaps(!!r.data.hasMore); setSnapError(''); }).catch((e) => setSnapError(e.response?.data?.error || 'Failed to load snapshots'));
  }, [id]);

  const loadHoldings = useCallback(() => {
    api
      .get(`/accounts/${id}/holdings`)
      .then((r) => {
        setHoldings(r.data.holdings || []);
        setHoldingsError('');
      })
      .catch((e) => {
        // Table may not exist on old DBs until server restart re-runs schema.
        setHoldings([]);
        setHoldingsError(e.response?.data?.error || '');
      });
  }, [id]);

  const loadIncome = useCallback(() => {
    api
      .get(`/accounts/${id}/income`, { params: { limit: 500 } })
      .then((r) => {
        setIncome(r.data.income || []);
        setIncomeError('');
      })
      .catch((e) => {
        setIncome([]);
        setIncomeError(e.response?.data?.error || '');
      });
  }, [id]);

  // Older pages are appended rather than replacing, so the chart and the table
  // keep growing until the account's full history is on screen.
  const loadOlder = async () => {
    setLoadingOlder(true);
    setSnapError('');
    try {
      const offset = snapshots.length;
      const { data } = await api.get(`/accounts/${id}/snapshots`, { params: { offset } });
      setSnapshots((prev) => [...prev, ...(data.snapshots || [])]);
      setHasMoreSnaps(!!data.hasMore);
    } catch (e) {
      setSnapError(e.response?.data?.error || 'Failed to load older balances');
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    load();
    loadHoldings();
    loadIncome();
    api.get('/accounts/categories').then((r) => setCategories(r.data.categories)).catch(() => {});
  }, [load, loadHoldings, loadIncome]);

  // Debounced symbol search: offers an explicit picker so ambiguous symbols
  // (BTC spot vs BTC ETF) are chosen, never guessed. An unambiguous exact
  // match is picked automatically — unless it is a bare base with a `-USD`
  // crypto pair in the results, which always needs an explicit choice.
  useEffect(() => {
    const raw = holdingForm.ticker.trim();
    if (raw.length < 1 || !/^[A-Za-z0-9.\- ]{1,32}$/.test(raw)) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchOpen(false);
      return undefined;
    }
    if (settledSymbol && settledSymbol === raw.toUpperCase()) {
      setSearchOpen(false);
      return undefined; // already chose this exact symbol
    }
    setSearchLoading(true);
    setSearchResults([]);
    setSearchOpen(true);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/market/search', { params: { q: raw } });
        const results = data.results || [];
        setSearchResults(results);
        const upper = raw.toUpperCase();
        const exact = results.find((r) => r.symbol === upper);
        const spotPair = results.find((r) => r.symbol === `${upper}-USD`);
        if (exact && !spotPair) {
          pickSymbol(exact);
        } else if (results.length === 0) {
          setSearchOpen(false);
        }
      } catch {
        setSearchOpen(false); // the price lookup below still reports availability
      } finally {
        setSearchLoading(false);
      }
    }, 400);
    return () => clearTimeout(searchTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdingForm.ticker]);

  const pickSymbol = (r) => {
    setSettledSymbol(r.symbol);
    setPickedAssetType(r.type || null);
    setHoldingForm((f) => ({
      ...f,
      ticker: r.symbol,
      name: f.name.trim() ? f.name : r.name || '',
    }));
    setSearchOpen(false);
  };

  // Price lookup for the settled (explicitly chosen) symbol only — never for
  // half-typed input — and auto-fills the name field when still empty.
  useEffect(() => {
    const t = (settledSymbol || '').trim().toUpperCase();
    setQuote(null);
    setQuoteError('');
    if (!t) {
      setQuoteLoading(false);
      return undefined;
    }
    if (!/^[A-Z0-9.\-=^]{1,16}$/.test(t)) {
      setQuoteLoading(false);
      return undefined;
    }
    setQuoteLoading(true);
    clearTimeout(lookupTimer.current);
    lookupTimer.current = setTimeout(async () => {
      try {
        const { data } = await api.get('/market/quote', { params: { ticker: t } });
        setQuote(data);
        setHoldingForm((f) => (f.name.trim() ? f : { ...f, name: data.name || '' }));
      } catch (e) {
        if (e.response?.status === 404) setQuoteError(`No market data for "${t}" — pick a symbol from search.`);
        else setQuoteError('Live quotes are unavailable right now — you can still add the holding manually.');
      } finally {
        setQuoteLoading(false);
      }
    }, 300);
    return () => clearTimeout(lookupTimer.current);
  }, [settledSymbol]);

  // Batch live prices for every holding in the table. Guards against the two
  // ways auto-update can silently die: the busy ref stops ticks from stacking
  // requests, and the request timeout guarantees the flag is always released
  // even if a response never comes back. Per-ticker failures (Yahoo rate
  // limits at a 30s cadence) keep the last good price instead of blanking the
  // table — only a fully failed batch surfaces an error.
  const loadLiveQuotes = useCallback(async () => {
    if (!holdings?.length || liveBusy.current) return;
    liveBusy.current = true;
    setLiveLoading(true);
    setLiveError('');
    try {
      const tickers = [...new Set(holdings.map((h) => h.ticker))].join(',');
      const { data } = await api.get('/market/quotes', { params: { tickers }, timeout: 15000 });
      const incoming = data.quotes || {};
      const okCount = Object.values(incoming).filter((q) => q?.ok && Number.isFinite(q.price)).length;
      setLiveQuotes((prev) => {
        const merged = { ...prev };
        for (const [ticker, q] of Object.entries(incoming)) {
          if (q?.ok && Number.isFinite(q.price)) merged[ticker] = q;
          else if (!(prev[ticker]?.ok && Number.isFinite(prev[ticker].price))) merged[ticker] = q;
        }
        return merged;
      });
      if (okCount > 0) setPricesUpdatedAt(new Date());
      else setLiveError('Live prices are unavailable right now — showing last prices.');
    } catch {
      setLiveError('Live prices are unavailable right now — showing last prices.');
    } finally {
      liveBusy.current = false;
      setLiveLoading(false);
    }
  }, [holdings]);

  useEffect(() => {
    loadLiveQuotes();
  }, [loadLiveQuotes]);

  // Auto-update: refresh live stock pricing and record the current balance
  // from those prices every 30 seconds while the toggle is on. Ticks are
  // skipped while the tab is hidden so a backgrounded tab doesn't hammer the
  // quote provider; both calls guard themselves against overlapping runs.
  // A 1-second ticker keeps the countdown in the Refresh button in sync with
  // the real next-tick timestamp rather than a drifting counter.
  useEffect(() => {
    if (!autoUpdate || !holdings?.length) return undefined;
    nextAutoAt.current = Date.now() + AUTO_UPDATE_MS;
    const refresh = () => {
      nextAutoAt.current = Date.now() + AUTO_UPDATE_MS;
      if (document.hidden) return;
      loadLiveQuotes();
      saveMarketValue({ background: true });
    };
    const tock = () => setCountdown(Math.max(0, Math.ceil((nextAutoAt.current - Date.now()) / 1000)));
    tock();
    const main = setInterval(refresh, AUTO_UPDATE_MS);
    const sec = setInterval(tock, 1000);
    return () => {
      clearInterval(main);
      clearInterval(sec);
    };
  }, [autoUpdate, loadLiveQuotes, holdings?.length]);

  useEffect(() => {
    setMarketResult(null);
  }, [id]);

  const fillCostFromMarket = () => {
    if (!quote) return;
    setHoldingFormError('');
    setHoldingForm((f) => ({ ...f, avgCost: plainAmount(quote.price) }));
  };

  // Record today's balance from live quotes (same rules as the Accounts-page
  // auto refresh: overwrites today's balance, skips when quotes are down).
  // The result renders inline under the button so every click has visible,
  // point-of-interaction feedback — nothing fails silently.
  const [marketResult, setMarketResult] = useState(null); // { ok: boolean, text: string }
  const marketBusyRef = useRef(false); // prevents auto-update ticks from stacking

  // `background` runs come from the 30-second auto-update: they record today's
  // balance from live prices and reload the account silently — no inline
  // result message, no "Checking market…" button flicker, no stacking.
  const saveMarketValue = async ({ background = false } = {}) => {
    if (background && marketBusyRef.current) return;
    marketBusyRef.current = true;
    if (!background) {
      setMarketBusy(true);
      setMarketResult(null);
    }
    try {
      const { data } = await api.post(
        '/accounts/refresh-market-values',
        { accountIds: [Number(id)], asOfDate: todayISO() },
        { timeout: 20000 }
      );
      const item = data.created?.[0] || data.updated?.[0];
      if (item) {
        load(); // refresh balance + history so Current balance reflects the new value
        if (background) return;
        const positionCount = (holdings || []).length;
        const bits = [`Updated to ${money(item.newValue)} (was ${money(item.oldValue)})`];
        bits.push(
          `${positionCount} position${positionCount === 1 ? '' : 's'}` +
            (item.cash ? ` + ${money(item.cash)} cash` : '')
        );
        if (item.overrodeManual) bits.push('replaced today’s manual entry');
        setMarketResult({ ok: true, text: bits.join(' · ') });
      } else if (background) {
        // unchanged or skipped — nothing new to show or reload
      } else if (data.unchanged?.[0]) {
        setMarketResult({
          ok: true,
          text: `Already at market value (${money(data.unchanged[0].value)}) — today's balance matches live holdings.`,
        });
      } else if (data.skipped?.[0]) {
        setMarketResult({ ok: false, text: `Not updated: ${data.skipped[0].reason}.` });
      } else {
        setMarketResult({ ok: false, text: 'Not updated: no priceable holdings.' });
      }
    } catch (e) {
      if (!background) setMarketResult({ ok: false, text: e.response?.data?.error || 'Market refresh failed.' });
    } finally {
      marketBusyRef.current = false;
      if (!background) setMarketBusy(false);
    }
  };

  // Robinhood activity CSV: preview first (dry run), then confirm to apply.
  const startRobinhoodImport = () => {
    setRhError('');
    rhFileRef.current?.click();
  };

  const handleRobinhoodFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setRhError('File is too large (max 5 MB).');
      return;
    }
    setRhBusy(true);
    setRhError('');
    try {
      const content = await f.text();
      if (!content.trim()) throw new Error('File is empty.');
      const { data } = await api.post(`/accounts/${id}/import/robinhood`, { content, dryRun: true });
      setRhPreview({ ...data, content });
    } catch (err) {
      setRhError(err.response?.data?.error || err.message || 'Could not parse this file.');
    } finally {
      setRhBusy(false);
    }
  };

  const confirmRobinhoodImport = async () => {
    if (!rhPreview?.content) return;
    setRhBusy(true);
    try {
      const { data } = await api.post(`/accounts/${id}/import/robinhood`, { content: rhPreview.content });
      setRhPreview(null);
      load();
      loadHoldings();
      loadIncome();
      const positionCount = data.holdingsCreated + data.holdingsUpdated;
      const bits = [
        `${positionCount} position${positionCount === 1 ? '' : 's'} added/updated`,
        `${data.incomeAdded} income ${data.incomeAdded === 1 ? 'entry' : 'entries'}`,
      ];
      if (data.holdingsRemoved?.length) {
        bits.push(`${data.holdingsRemoved.length} removed (${data.holdingsRemoved.map((h) => h.ticker).join(', ')})`);
      }
      if (data.incomeSkipped) bits.push(`${data.incomeSkipped} already recorded`);
      toastSuccess(`Robinhood import: ${bits.join(' · ')}`);
    } catch (err) {
      setRhError(err.response?.data?.error || 'Import failed.');
    } finally {
      setRhBusy(false);
    }
  };

  const submitBalance = async (e) => {
    e.preventDefault();
    setBalanceError('');
    setMarketResult(null); // a manual save supersedes the last refresh message
    setBusy(true);
    try {
      await api.post(`/accounts/${id}/snapshots`, {
        value: Number(balanceForm.value),
        asOfDate: balanceForm.asOfDate,
        note: balanceForm.note || undefined,
      });
      setBalanceForm((f) => ({ ...f, note: '' }));
      balanceTouched.current = false;
      load();
    } catch (err) {
      setBalanceError(err.response?.data?.error || 'Could not save balance');
    } finally {
      setBusy(false);
    }
  };

  const startEditSnap = (s) => {
    setEditingSnap(s);
    setEditSnapForm({ value: String(s.value), asOfDate: s.asOfDate, note: s.note || '' });
    setBalanceError('');
  };

  const submitEditSnap = async (e) => {
    e.preventDefault();
    if (!editingSnap) return;
    setBusy(true);
    setBalanceError('');
    try {
      await api.patch(`/accounts/${id}/snapshots/${editingSnap.id}`, {
        value: Number(editSnapForm.value),
        asOfDate: editSnapForm.asOfDate,
        note: editSnapForm.note || null,
      });
      setEditingSnap(null);
      load();
    } catch (err) {
      setBalanceError(err.response?.data?.error || 'Could not update balance');
    } finally { setBusy(false); }
  };

  const confirmDeleteSnap = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.delete(`/accounts/${id}/snapshots/${deleteTarget.id}`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      setBalanceError(err.response?.data?.error || 'Could not delete balance');
    } finally { setBusy(false); }
  };

  // ---- holdings actions ------------------------------------------------------
  const submitHolding = async (e) => {
    e.preventDefault();
    setHoldingFormError('');
    const shares = Number(holdingForm.shares);
    const avgCost = Number(holdingForm.avgCost);
    if (!holdingForm.ticker.trim()) {
      setHoldingFormError('Ticker is required (e.g. VTI, AAPL).');
      return;
    }
    if (!Number.isFinite(shares) || shares <= 0) {
      setHoldingFormError('Shares must be a positive number.');
      return;
    }
    if (!Number.isFinite(avgCost) || avgCost < 0) {
      setHoldingFormError('Average cost must be a non-negative number (price paid per share).');
      return;
    }
    const costBasis = Math.round(shares * avgCost * 100) / 100;
    setHoldingBusy(true);
    try {
      await api.post(`/accounts/${id}/holdings`, {
        ticker: holdingForm.ticker.trim(),
        name: holdingForm.name.trim() || undefined,
        shares,
        costBasis,
        ...(pickedAssetType ? { assetType: pickedAssetType } : {}),
      });
      setHoldingForm({ ticker: '', name: '', shares: '', avgCost: '' });
      setSettledSymbol(null);
      setPickedAssetType(null);
      setSearchOpen(false);
      loadHoldings();
      toastSuccess('Holding added');
    } catch (err) {
      setHoldingFormError(err.response?.data?.error || 'Could not add holding');
    } finally {
      setHoldingBusy(false);
    }
  };

  const startEditHolding = (h) => {
    setEditingHolding(h);
    const avg = h.shares ? h.costBasis / h.shares : '';
    setEditHoldingForm({
      ticker: h.ticker || '',
      name: h.name || '',
      shares: String(h.shares ?? ''),
      avgCost: avg === '' ? '' : plainAmount(avg),
      assetType: h.assetType || '',
    });
    setHoldingFormError('');
  };

  const submitEditHolding = async (e) => {
    e.preventDefault();
    if (!editingHolding) return;
    const shares = Number(editHoldingForm.shares);
    const avgCost = Number(editHoldingForm.avgCost);
    if (!Number.isFinite(shares) || shares <= 0) {
      setHoldingFormError('Shares must be a positive number.');
      return;
    }
    if (!Number.isFinite(avgCost) || avgCost < 0) {
      setHoldingFormError('Average cost must be a non-negative number (price paid per share).');
      return;
    }
    setHoldingBusy(true);
    setHoldingFormError('');
    try {
      await api.patch(`/accounts/${id}/holdings/${editingHolding.id}`, {
        ticker: editHoldingForm.ticker.trim(),
        name: editHoldingForm.name.trim() || null,
        shares,
        costBasis: Math.round(shares * avgCost * 100) / 100,
        assetType: editHoldingForm.assetType || null,
      });
      setEditingHolding(null);
      loadHoldings();
      toastSuccess('Holding updated');
    } catch (err) {
      setHoldingFormError(err.response?.data?.error || 'Could not update holding');
    } finally {
      setHoldingBusy(false);
    }
  };

  const confirmDeleteHolding = async () => {
    if (!deleteHolding) return;
    setHoldingBusy(true);
    try {
      await api.delete(`/accounts/${id}/holdings/${deleteHolding.id}`);
      setDeleteHolding(null);
      loadHoldings();
      toastSuccess('Holding removed');
    } catch (err) {
      toastError(err.response?.data?.error || 'Could not delete holding');
    } finally {
      setHoldingBusy(false);
    }
  };

  // ---- income actions ---------------------------------------------------------
  const submitIncome = async (e) => {
    e.preventDefault();
    setIncomeFormError('');
    const amount = Number(incomeForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setIncomeFormError('Amount must be a positive number.');
      return;
    }
    setIncomeBusy(true);
    try {
      await api.post(`/accounts/${id}/income`, {
        type: incomeForm.type,
        amount,
        asOfDate: incomeForm.date,
        holdingId: incomeForm.holdingId ? Number(incomeForm.holdingId) : undefined,
        note: incomeForm.note.trim() || undefined,
      });
      setIncomeForm((f) => ({ ...f, amount: '', note: '' }));
      loadIncome();
      toastSuccess('Income recorded');
    } catch (err) {
      setIncomeFormError(err.response?.data?.error || 'Could not record income');
    } finally {
      setIncomeBusy(false);
    }
  };

  const deleteIncome = async (incomeId) => {
    try {
      await api.delete(`/accounts/${id}/income/${incomeId}`);
      loadIncome();
      toastSuccess('Income entry removed');
    } catch (err) {
      toastError(err.response?.data?.error || 'Could not delete income');
    }
  };

  // ---- derived ---------------------------------------------------------------
  const holdingsTotals = useMemo(() => {
    const list = holdings || [];
    let shares = 0;
    let cost = 0;
    for (const h of list) {
      shares += Number(h.shares) || 0;
      cost += Number(h.costBasis) || 0;
    }
    return { count: list.length, cost };
  }, [holdings]);

  const incomeTotals = useMemo(() => {
    const list = income || [];
    const byType = { dividend: 0, interest: 0, distribution: 0, other: 0 };
    let total = 0;
    let ytd = 0;
    let ttm = 0;
    const year = new Date().getFullYear();
    const cut = new Date();
    cut.setUTCFullYear(cut.getUTCFullYear() - 1);
    const cutStr = cut.toISOString().slice(0, 10);
    for (const ev of list) {
      const amt = Number(ev.amount) || 0;
      total += amt;
      if (byType[ev.type] !== undefined) byType[ev.type] += amt;
      else byType.other += amt;
      if ((ev.asOfDate || '').startsWith(String(year))) ytd += amt;
      if ((ev.asOfDate || '') >= cutStr) ttm += amt;
    }
    return { total, ytd, ttm, byType, count: list.length };
  }, [income]);

  const liveTotals = useMemo(() => {
    let market = 0;
    let priced = 0;
    for (const h of holdings || []) {
      const q = liveQuotes[h.ticker];
      if (q?.ok && Number.isFinite(q.price)) {
        market += (Number(h.shares) || 0) * q.price;
        priced += 1;
      }
    }
    const cash = Number(account?.cashBalance) || 0;
    return { market, cash, total: market + cash, priced, gain: market - holdingsTotals.cost };
  }, [holdings, liveQuotes, holdingsTotals.cost, account]);

  const saveCash = async (e) => {
    e.preventDefault();
    const v = cashAmount.trim() === '' ? 0 : Number(cashAmount);
    if (!Number.isFinite(v) || v < 0) {
      setCashError('Enter a non-negative amount (blank counts as $0).');
      return;
    }
    setCashBusy(true);
    setCashError('');
    try {
      await api.patch(`/accounts/${id}`, { cashBalance: Math.round(v * 100) / 100 });
      setCashEditing(false);
      load();
      toastSuccess('Cash balance updated');
    } catch (err) {
      setCashError(err.response?.data?.error || 'Could not save cash balance');
    } finally {
      setCashBusy(false);
    }
  };

  const benchmark = useMemo(() => {
    if (!snapshots?.length) return null;
    const preset = BENCHMARK_PRESETS.find((p) => p.key === benchmarkPreset);
    const annualPct = preset?.rate ?? Number(customRate);
    if (!Number.isFinite(annualPct)) return null;
    const ordered = [...snapshots].reverse(); // oldest → newest
    const start = ordered[0];
    if (!start || !start.value) return null;
    const data = ordered.map((s) => {
      const y = yearsBetween(start.asOfDate, s.asOfDate);
      const bench = start.value * Math.pow(1 + annualPct / 100, y);
      return { date: s.asOfDate, actual: s.value, benchmark: Math.round(bench * 100) / 100 };
    });
    const last = ordered[ordered.length - 1];
    const years = yearsBetween(start.asOfDate, last.asOfDate);
    const actualGrowth = start.value ? ((last.value - start.value) / start.value) * 100 : 0;
    const benchLast = data[data.length - 1]?.benchmark ?? start.value;
    const benchGrowth = start.value ? ((benchLast - start.value) / start.value) * 100 : 0;
    const cagr = years > 0 && start.value > 0 && last.value > 0
      ? (Math.pow(last.value / start.value, 1 / years) - 1) * 100
      : null;
    return { data, actualGrowth, benchGrowth, outperformance: actualGrowth - benchGrowth, cagr, annualPct, years, start };
  }, [snapshots, benchmarkPreset, customRate]);

  if (error && !account) {
    return (
      <p className="flex items-center gap-2 rounded-md bg-negative/10 p-4 text-negative">
        <AlertCircle size={16} className="shrink-0" />
        {error}
      </p>
    );
  }
  if (!account || !snapshots) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const latest = snapshots[0];
  const prior = snapshots[1];
  const delta = latest && prior ? latest.value - prior.value : null;
  const currentValue = latest?.value ?? account.latestValue ?? 0;
  const totalCost = holdingsTotals.cost;
  const cashBalance = Number(account.cashBalance) || 0;
  const unrealized = currentValue - totalCost - cashBalance;
  const showHoldings = account.isAsset && (INVESTMENT_KINDS.has(account.kind) || INVESTMENT_CATEGORIES.has(account.categoryName) || (holdings?.length ?? 0) > 0);
  const ttmYield = currentValue > 0 ? (incomeTotals.ttm / currentValue) * 100 : null;

  // Stocks vs crypto split: stored asset type wins, otherwise Yahoo crypto
  // pairs (BASE-QUOTE like BTC-USD) classify as crypto. Plain dashed stock
  // tickers (BRK-B) never end in a quote currency, so the fallback is safe.
  const isCryptoHolding = (h) =>
    h.assetType === 'CRYPTOCURRENCY' || (!h.assetType && /-(USD|USDT|EUR|GBP|BTC|ETH)$/i.test(h.ticker || ''));
  const stockHoldings = (holdings || []).filter((h) => !isCryptoHolding(h));
  const cryptoHoldings = (holdings || []).filter((h) => isCryptoHolding(h));
  const cryptoCount = cryptoHoldings.length;

  const sectionStats = (list) => {
    let cost = 0;
    let market = 0;
    let priced = 0;
    for (const h of list) {
      cost += Number(h.costBasis) || 0;
      const q = liveQuotes[h.ticker];
      if (q?.ok && Number.isFinite(q.price)) {
        market += (Number(h.shares) || 0) * q.price;
        priced++;
      }
    }
    return { cost, market, priced, gain: market - cost };
  };
  const stockStats = sectionStats(stockHoldings);
  const cryptoStats = sectionStats(cryptoHoldings);
  const splitSections = stockHoldings.length > 0 && cryptoHoldings.length > 0;

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  // Comparable value for a column; unpriced rows return null and always sink
  // to the bottom regardless of direction.
  const sortValue = (h, key) => {
    const shares = Number(h.shares) || 0;
    const cost = Number(h.costBasis) || 0;
    const q = liveQuotes[h.ticker];
    const live = q?.ok && Number.isFinite(q.price) ? q.price : null;
    switch (key) {
      case 'ticker':
        return (h.ticker || '').toUpperCase();
      case 'name':
        return (h.name || '').toUpperCase();
      case 'shares':
        return shares;
      case 'avgCost':
        return shares ? cost / shares : 0;
      case 'costBasis':
      case 'weight': // weight is costBasis / totalCost — same ordering
        return cost;
      case 'price':
        return live;
      case 'market':
        return live === null ? null : shares * live;
      case 'gain':
        return live === null ? null : shares * live - cost;
      default:
        return null;
    }
  };

  const sortedHoldings = (list) => {
    if (!sort.key) return list;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va === null) return vb === null ? 0 : 1;
      if (vb === null) return -1;
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
  };

  const holdingRow = (h) => {
    const avg = h.shares ? h.costBasis / h.shares : 0;
    const weight = totalCost ? (h.costBasis / totalCost) * 100 : 0;
    const lq = liveQuotes[h.ticker];
    const live = lq?.ok && Number.isFinite(lq.price) ? lq.price : null;
    const mkt = live !== null ? (Number(h.shares) || 0) * live : null;
    const gain = mkt !== null ? mkt - h.costBasis : null;
    return (
      <tr key={h.id} className="hover:bg-surfaceAlt/40">
        <td className="px-4 py-2.5 font-mono font-semibold">{h.ticker}</td>
        <td className="max-w-[200px] truncate px-4 py-2.5 text-muted">{h.name || '—'}</td>
        <td className="px-4 py-2.5 text-right">{Number(h.shares).toLocaleString('en-US', { maximumFractionDigits: 8 })}</td>
        <td className="px-4 py-2.5 text-right">{marketPrice(avg)}</td>
        <td className="px-4 py-2.5 text-right font-medium">{money(h.costBasis)}</td>
        <td className="px-4 py-2.5 text-right">{live === null ? <span className="text-muted">—</span> : marketPrice(live)}</td>
        <td className="px-4 py-2.5 text-right font-medium">{mkt === null ? <span className="text-muted">—</span> : money(mkt)}</td>
        <td className={`px-4 py-2.5 text-right text-xs font-semibold ${gain === null ? 'text-muted' : gain >= 0 ? 'text-positive' : 'text-negative'}`}>
          {gain === null ? (
            '—'
          ) : (
            <span className="inline-flex items-center justify-end gap-1">
              {gain >= 0 ? <TrendingUp size={13} className="shrink-0" /> : <TrendingDown size={13} className="shrink-0" />}
              {`${signedMoney(Math.round(gain * 100) / 100)} (${h.costBasis ? pct((gain / h.costBasis) * 100) : '—'})`}
            </span>
          )}
        </td>
        <td className="px-4 py-2.5 text-right">
          <span className="mr-2 text-xs text-muted">{weight.toFixed(1)}%</span>
          <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-surfaceAlt align-middle">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, weight)}%` }} />
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">
          <span className="inline-flex gap-1">
            <button onClick={() => startEditHolding(h)} className={btnIcon} title="Edit"><Pencil size={13} /></button>
            <button onClick={() => setDeleteHolding(h)} className={btnIconDanger} title="Remove"><Trash2 size={13} /></button>
          </span>
        </td>
      </tr>
    );
  };

  const sectionHeader = (label, list, stats) => (
    <tr key={`section-${label}`} className="bg-surfaceAlt/60">
      <td colSpan={10} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {label} · {list.length} position{list.length === 1 ? '' : 's'} · {money(stats.cost)} cost
        {stats.priced > 0 && (
          <> · <span className={stats.gain >= 0 ? 'text-positive' : 'text-negative'}>{money(stats.market)} market ({signedMoney(Math.round(stats.gain * 100) / 100)})</span></>
        )}
      </td>
    </tr>
  );

  return (
    <div className="space-y-6">
      <nav className="text-sm text-muted">
        <Link to="/accounts" className="inline-flex items-center gap-1 transition-colors hover:text-primary hover:underline">
          <ChevronLeft size={15} />
          Accounts
        </Link>
        <span className="mx-2">/</span>
        <span>{account.name}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex flex-wrap items-center gap-3 text-2xl font-bold">
            {account.name}
            {!account.isAsset && (
              <span className="rounded-full bg-negative/10 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-negative">
                liability
              </span>
            )}
            {account.archived && (
              <span className="rounded-full bg-surfaceAlt px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
                archived
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {[account.institution, account.categoryName, kindLabel(account.kind)].filter(Boolean).join(' · ') || '—'}
          </p>
          {account.notes && <p className="mt-2 max-w-xl text-sm text-muted">{account.notes}</p>}
        </div>
        <button
          onClick={() => {
            setFormError('');
            setEditOpen(true);
          }}
          className="flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-surfaceAlt"
        >
          <Pencil size={14} />
          Edit details
        </button>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Current balance" className="lg:col-span-1">
          <p className={`text-3xl font-bold ${account.isAsset ? 'text-positive' : 'text-negative'}`}>
            {money(currentValue)}
          </p>
          {delta !== null ? (
            <p className={`mt-1 flex items-center gap-1 text-sm font-medium ${delta >= 0 === !!account.isAsset ? 'text-positive' : 'text-negative'}`}>
              {delta >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {money(Math.abs(delta))} vs previous entry
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">Add a second entry to see change</p>
          )}
          {latest && <p className="mt-2 text-xs text-muted">As of {formatDate(latest.asOfDate)}</p>}
          {showHoldings && holdings && holdings.length > 0 && (totalCost > 0 || cashBalance > 0) && (
            <div className="mt-3 rounded-lg bg-surfaceAlt/50 px-3 py-2 text-xs">
              <p className="flex justify-between"><span className="text-muted">Cost basis</span><span className="font-semibold">{money(totalCost)}</span></p>
              {cashBalance > 0 && (
                <p className="mt-1 flex justify-between"><span className="text-muted">Cash</span><span className="font-semibold">{money(cashBalance)}</span></p>
              )}
              <p className="mt-1 flex justify-between">
                <span className="text-muted">Unrealized</span>
                <span className={`font-semibold ${unrealized >= 0 ? 'text-positive' : 'text-negative'}`}>{signedMoney(Math.round(unrealized * 100) / 100)} ({totalCost ? pct((unrealized / totalCost) * 100) : ''})</span>
              </p>
            </div>
          )}
          {showHoldings && !!holdings?.length && (
            <button
              onClick={() => saveMarketValue()}
              disabled={marketBusy}
              className={`mt-3 ${btnOutline} w-full justify-center`}
              title="Record today's balance from live holding prices"
            >
              <RefreshCw size={14} className={marketBusy ? 'animate-spin' : ''} />
              {marketBusy ? 'Checking market…' : 'Update from market value'}
            </button>
          )}
          {marketResult && (
            <p
              role="status"
              className={`anim-fade mt-2 rounded-md px-3 py-1.5 text-xs ${marketResult.ok ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'}`}
            >
              {marketResult.text}
            </p>
          )}
        </Card>

        <Card title="Update balance" className="lg:col-span-2">
          <form onSubmit={submitBalance} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_150px_1fr_auto]">
            <div>
              <label htmlFor="bal-value" className={labelCls}>New value ($)</label>
              <input
                id="bal-value"
                type="number"
                step="any"
                required
                value={balanceForm.value}
                onChange={(e) => { balanceTouched.current = true; setBalanceForm((f) => ({ ...f, value: e.target.value })); }}
                className={`${inputCls}`}
              />
            </div>
            <div>
              <label htmlFor="bal-date" className={labelCls}>Date</label>
              <input
                id="bal-date"
                type="date"
                required
                max={todayISO()}
                value={balanceForm.asOfDate}
                onChange={(e) => setBalanceForm((f) => ({ ...f, asOfDate: e.target.value }))}
                className={`${inputCls}`}
              />
            </div>
            <div>
              <label htmlFor="bal-note" className={labelCls}>Note (optional)</label>
              <input
                id="bal-note"
                value={balanceForm.note}
                onChange={(e) => setBalanceForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="e.g. quarterly statement"
                className={`${inputCls}`}
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className={`${btnPrimary} whitespace-nowrap`}
            >
              <Save size={15} />
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
          {balanceError && <p className={`${errorCls} mt-3`}>{balanceError}</p>}
        </Card>
      </div>

      <Card title="Balance history" icon={LineChart}>
        {!snapshots.length ? (
          <EmptyState
            icon={Wallet}
            title="No balances recorded yet"
            hint="Save your first balance entry above to start tracking this account."
          />
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-border bg-surfaceAlt/50 p-0.5">
                <button
                  type="button"
                  onClick={() => setHistoryView('chart')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    historyView === 'chart' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                  }`}
                >
                  <ChartLine size={14} />
                  Chart
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryView('table')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    historyView === 'table' ? 'bg-surface text-text shadow-sm' : 'text-muted hover:text-text'
                  }`}
                >
                  <Table size={14} />
                  Table
                </button>
              </div>
              <span className="text-xs text-muted">
                {snapshots.length} entries{hasMoreSnaps ? ' (older available)' : ''}
              </span>
            </div>

            {hasMoreSnaps && (
              <div className="mb-3 text-center">
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={loadingOlder}
                  className={btnOutline}
                >
                  {loadingOlder ? 'Loading…' : 'Load older balances'}
                </button>
              </div>
            )}

            {snapError && <p className={`${errorCls} mt-3`}>{snapError}</p>}

            {historyView === 'chart' ? (
              <ValueAreaChart snapshots={snapshots} color={primary} />
            ) : (
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-border/80 bg-surfaceAlt/60 text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-2.5">Date</th>
                      <th className="px-4 py-2.5 text-right">Value</th>
                      <th className="px-4 py-2.5">Note</th>
                      <th className="px-4 py-2.5">Recorded</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {snapshots.map((s) => (
                      <tr key={s.id} className="hover:bg-surfaceAlt/40">
                        <td className="px-4 py-2.5">{formatDate(s.asOfDate)}</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${account.isAsset ? 'text-positive' : 'text-negative'}`}>
                          {money(s.value)}
                        </td>
                        <td className="max-w-[220px] truncate px-4 py-2.5 text-muted">{s.note || '—'}</td>
                        <td className="px-4 py-2.5 text-xs text-muted">
                          {(() => { try { return new Date(s.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return s.createdAt; } })()}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className="inline-flex gap-1">
                            <button onClick={() => startEditSnap(s)} className={btnIcon} aria-label={`Edit ${formatDate(s.asOfDate)}`} title="Edit"><Pencil size={13} /></button>
                            <button onClick={() => setDeleteTarget(s)} className={btnIconDanger} aria-label={`Delete ${formatDate(s.asOfDate)}`} title="Delete"><Trash2 size={13} /></button>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {balanceError && <p className={`${errorCls} mt-3`}>{balanceError}</p>}
          </>
        )}
      </Card>

      {/* Holdings breakdown */}
      {showHoldings && (
        <Card
          title="Holdings breakdown"
          icon={Layers}
          action={
            <span className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted">
              {liveLoading && liveTotals.priced === 0 ? (
                'Refreshing prices…'
              ) : liveTotals.priced > 0 ? (
                <>Live · {money(liveTotals.cash > 0 ? liveTotals.total : liveTotals.market)}{liveTotals.cash > 0 ? ' total' : ' mkt'} ({signedMoney(Math.round(liveTotals.gain * 100) / 100)})</>
              ) : holdings ? (
                <>{holdings.length} position{holdings.length === 1 ? '' : 's'} · {money(totalCost)} cost{cryptoCount > 0 && stockHoldings.length > 0 ? ` (${stockHoldings.length} stocks · ${cryptoCount} crypto)` : ''}</>
              ) : (
                'loading…'
              )}
              {pricesUpdatedAt && (
                <span className="tabular-nums" title="Last successful price update">
                  · updated {pricesUpdatedAt.toLocaleTimeString()}
                </span>
              )}
              <button
                onClick={startRobinhoodImport}
                disabled={rhBusy}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium transition-colors hover:bg-surfaceAlt hover:text-text disabled:opacity-50"
                title="Import positions & dividends from a Robinhood activity CSV"
              >
                <Upload size={12} />
                Robinhood CSV
              </button>
              <button
                onClick={loadLiveQuotes}
                disabled={liveLoading || !holdings?.length}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium transition-colors hover:bg-surfaceAlt hover:text-text disabled:opacity-50"
                title={autoUpdate ? `Refresh live prices — auto-update in ${countdown}s` : 'Refresh live prices'}
              >
                <RefreshCw size={12} className={liveLoading ? 'animate-spin' : ''} />
                Refresh
                {autoUpdate && !!holdings?.length && (
                  <span className="tabular-nums text-muted">({countdown}s)</span>
                )}
              </button>
              <label
                className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 font-medium transition-colors hover:bg-surfaceAlt hover:text-text"
                title={`Auto-update stock prices every ${AUTO_UPDATE_MS / 1000} seconds`}
              >
                <input
                  type="checkbox"
                  checked={autoUpdate}
                  onChange={(e) => setAutoUpdate(e.target.checked)}
                  className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                />
                Auto-update
              </label>
            </span>
          }
        >
          <input
            ref={rhFileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={handleRobinhoodFile}
            className="hidden"
            aria-label="Choose a Robinhood activity CSV to import"
          />
          {rhBusy && !rhPreview && (
            <p className="mb-3 flex items-center gap-2 rounded-md bg-surfaceAlt/60 px-3 py-2 text-xs text-muted">
              <RefreshCw size={12} className="animate-spin" />
              Reading your Robinhood file…
            </p>
          )}
          {rhError && (
            <p className={`${errorCls} mb-3`}>{rhError}</p>
          )}
          {holdingsError && (
            <p className={`${errorCls} mb-3`}>{holdingsError}</p>
          )}

          {/* Cash sleeve — settlement / sweep fund alongside the positions */}
          <div className="mb-3 rounded-lg border border-border bg-surfaceAlt/40 px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <PiggyBank size={14} className="text-primary" />
                Cash (settlement)
              </span>
              {!cashEditing && (
                <>
                  <strong>{money(cashBalance)}</strong>
                  {account.cashUpdatedAt && (
                    <span className="text-xs text-muted">as of {formatDate(account.cashUpdatedAt)}</span>
                  )}
                  <button
                    onClick={() => { setCashAmount(cashBalance ? String(cashBalance) : ''); setCashError(''); setCashEditing(true); }}
                    className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surfaceAlt hover:text-text"
                  >
                    <Pencil size={12} /> {cashBalance ? 'Edit' : 'Add cash'}
                  </button>
                </>
              )}
            </div>
            {cashEditing && (
              <form onSubmit={saveCash} className="mt-2 flex flex-wrap items-end gap-2">
                <div className="w-44">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="cash-amount">Cash balance ($)</label>
                  <input
                    id="cash-amount"
                    type="number"
                    step="any"
                    min={0}
                    autoFocus
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                    placeholder="e.g. 1500"
                    className={`${inputCls}`}
                  />
                </div>
                <button
                  type="submit"
                  disabled={cashBusy}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-onPrimary hover:opacity-90 disabled:opacity-50"
                >
                  <Save size={13} /> {cashBusy ? 'Saving…' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={() => setCashEditing(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surfaceAlt hover:text-text"
                >
                  Cancel
                </button>
              </form>
            )}
            {cashError && <p className="mt-2 rounded-md bg-negative/10 px-3 py-1.5 text-xs text-negative">{cashError}</p>}
            {!cashEditing && (
              <p className="mt-1.5 text-xs text-muted">Uninvested cash counts toward the account value and is included in market refreshes.</p>
            )}
          </div>

          {!holdings ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : holdings.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted">
              No holdings yet — type a ticker below, or import a Robinhood activity CSV with the button above. Great for brokerage, 401(k) and IRA accounts.
            </p>
          ) : (
            <>
            {liveError && (
              <p className={`${errorCls} mb-3`}>{liveError}</p>
            )}
            <div className="mb-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="border-b border-border/80 bg-surfaceAlt/60 text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    {HOLDINGS_COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                        className={`px-4 py-2.5 ${c.right ? 'text-right' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(c.key)}
                          title={`Sort by ${c.label}`}
                          className={`flex w-full items-center gap-1 uppercase tracking-wide transition-colors hover:text-text ${
                            c.right ? 'justify-end' : ''
                          } ${sort.key === c.key ? 'text-text' : ''}`}
                        >
                          {c.label}
                          {sort.key === c.key ? (
                            sort.dir === 'asc' ? <ChevronUp size={12} className="shrink-0" /> : <ChevronDown size={12} className="shrink-0" />
                          ) : (
                            <ArrowUpDown size={11} className="shrink-0 opacity-40" />
                          )}
                        </button>
                      </th>
                    ))}
                    <th className="px-4 py-2.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {splitSections && sectionHeader('Stocks & ETFs', stockHoldings, stockStats)}
                  {sortedHoldings(stockHoldings).map(holdingRow)}
                  {splitSections && sectionHeader('Crypto', cryptoHoldings, cryptoStats)}
                  {sortedHoldings(cryptoHoldings).map(holdingRow)}
                </tbody>
                {liveTotals.priced > 0 && (
                  <tfoot className="border-t-2 border-border bg-surfaceAlt/40 text-sm font-semibold">
                    <tr>
                      <td colSpan={4} className="px-4 py-2.5 text-xs uppercase tracking-wide text-muted">Live totals ({liveTotals.priced}/{holdings.length} priced)</td>
                      <td className="px-4 py-2.5 text-right">{money(totalCost)}</td>
                      <td className="px-4 py-2.5" />
                      <td className="px-4 py-2.5 text-right" title={liveTotals.cash > 0 ? `Securities ${money(liveTotals.market)} + cash ${money(liveTotals.cash)}` : undefined}>
                        {money(liveTotals.total)}
                        {liveTotals.cash > 0 && <span className="ml-1 text-[10px] font-normal text-muted">incl. cash</span>}
                      </td>
                      <td className={`px-4 py-2.5 text-right text-xs ${liveTotals.gain >= 0 ? 'text-positive' : 'text-negative'}`}>
                        <span className="inline-flex items-center justify-end gap-1">
                          {liveTotals.gain >= 0 ? <TrendingUp size={13} className="shrink-0" /> : <TrendingDown size={13} className="shrink-0" />}
                          {signedMoney(Math.round(liveTotals.gain * 100) / 100)}
                        </span>
                      </td>
                      <td colSpan={2} className="px-4 py-2.5" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            </>
          )}

          {/* Live ticker lookup status */}
          {quoteLoading && (
            <p className="mb-2 flex items-center gap-2 rounded-md bg-surfaceAlt/60 px-3 py-2 text-xs text-muted">
              <RefreshCw size={12} className="animate-spin" />
              Looking up {holdingForm.ticker.trim().toUpperCase()}…
            </p>
          )}
          {!quoteLoading && quote && (
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-primary/25 bg-primary/[0.06] px-3 py-2 text-xs">
              <span>
                <strong>{quote.ticker}</strong>
                {quote.name && <span className="text-muted"> · {quote.name}</span>}
              </span>
              <span className="font-semibold">
                {marketPrice(quote.price)}{quote.currency && quote.currency !== 'USD' ? ` ${quote.currency}` : ''}
              </span>
              {quote.asOf && <span className="text-muted">live as of {formatDate(quote.asOf)}</span>}
              <button
                type="button"
                onClick={fillCostFromMarket}
                className="ml-auto font-semibold text-primary hover:underline"
                title="Fill average cost with the live price"
              >
                Use live price
              </button>
            </div>
          )}
          {!quoteLoading && !quote && quoteError && (
            <p className="mb-2 rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{quoteError}</p>
          )}

          <form onSubmit={submitHolding} className="grid grid-cols-2 gap-3 rounded-lg bg-surfaceAlt/40 p-3 sm:grid-cols-[110px_1fr_110px_130px_auto]">
            <div className="relative">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="h-ticker">
                Ticker{searchLoading && <span className="ml-1 font-normal normal-case"> · searching…</span>}
              </label>
              <input
                id="h-ticker"
                value={holdingForm.ticker}
                onChange={(e) => {
                  setSettledSymbol(null);
                  setPickedAssetType(null);
                  setHoldingForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }));
                }}
                onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); }}
                onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                onFocus={() => { if (searchResults.length) setSearchOpen(true); }}
                placeholder="VTI or BTC"
                autoComplete="off"
                className={`${inputCls} font-mono`}
              />
              {searchOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-lg">
                  {searchLoading && searchResults.length === 0 ? (
                    <p className="px-2.5 py-2 text-xs text-muted">Searching…</p>
                  ) : searchResults.length === 0 ? (
                    <p className="px-2.5 py-2 text-xs text-muted">No matches — check the symbol.</p>
                  ) : (
                    <ul className="max-h-56 overflow-y-auto py-1">
                      {searchResults.map((r) => (
                        <li key={r.symbol}>
                          <button
                            type="button"
                            onMouseDown={(e) => { e.preventDefault(); pickSymbol(r); }}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-surfaceAlt"
                          >
                            <span className="font-mono font-semibold">{r.symbol}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-muted">{r.name || r.exchange || ''}</span>
                            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                              {TYPE_BADGES[r.type] || r.type}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="h-name">Name</label>
              <input id="h-name" value={holdingForm.name} onChange={(e) => setHoldingForm((f) => ({ ...f, name: e.target.value }))} placeholder="Total Stock Market" className={`${inputCls}`} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="h-shares">Shares</label>
              <input id="h-shares" type="number" step="any" min={0} value={holdingForm.shares} onChange={(e) => setHoldingForm((f) => ({ ...f, shares: e.target.value }))} placeholder="10" className={`${inputCls}`} />
            </div>
            <div>
              <label className="mb-1 block whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="h-cost">Avg. cost/share</label>
              <input id="h-cost" type="number" step="any" min={0} value={holdingForm.avgCost} onChange={(e) => setHoldingForm((f) => ({ ...f, avgCost: e.target.value }))} placeholder="220.50" className={`${inputCls}`} />
            </div>
            <div className="col-span-2 flex items-end sm:col-span-1">
              <button type="submit" disabled={holdingBusy} className={`${btnPrimary} w-full whitespace-nowrap`}>
                <Plus size={14} /> {holdingBusy ? 'Adding…' : 'Add'}
              </button>
            </div>
          </form>
          {holdingFormError && <p className={`${errorCls} mt-2`}>{holdingFormError}</p>}
          <p className="mt-2 text-xs text-muted">
            Type a ticker (stocks, ETFs or crypto like BTC) and pick the exact symbol — its name and latest price fill in automatically. Enter the average price you paid per share; total cost basis is computed automatically
            {(() => {
              const s = Number(holdingForm.shares);
              const a = Number(holdingForm.avgCost);
              if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(a) || a < 0) return '.';
              return ` — currently ${money(Math.round(s * a * 100) / 100)}.`;
            })()}
          </p>
        </Card>
      )}

      {/* Income tracking */}
      <Card
        title="Dividends & interest"
        icon={PiggyBank}
        action={
          <span className="text-xs text-muted">
            {income ? `${incomeTotals.count} event${incomeTotals.count === 1 ? '' : 's'} · ${money(incomeTotals.total)} all-time` : ''}
          </span>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border bg-surfaceAlt/40 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-muted">Trailing 12m</p>
            <p className="font-bold text-positive">{money(incomeTotals.ttm)}</p>
          </div>
          <div className="rounded-lg border border-border bg-surfaceAlt/40 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-muted">This year</p>
            <p className="font-bold">{money(incomeTotals.ytd)}</p>
          </div>
          <div className="rounded-lg border border-border bg-surfaceAlt/40 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-muted">Yield (TTM)</p>
            <p className="font-bold">{ttmYield === null ? '—' : `${ttmYield.toFixed(2)}%`}</p>
          </div>
          <div className="rounded-lg border border-border bg-surfaceAlt/40 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-muted">Dividends / Interest</p>
            <p className="truncate font-bold">{money(incomeTotals.byType.dividend)} <span className="font-normal text-muted">/ {money(incomeTotals.byType.interest)}</span></p>
          </div>
        </div>

        {incomeError && <p className={`${errorCls} mb-3`}>{incomeError}</p>}

        {!income ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : income.length === 0 ? (
          <p className="mb-3 rounded-md border border-dashed border-border px-4 py-5 text-center text-sm text-muted">
            No income recorded yet — log dividends, interest or distributions below to track yield.
          </p>
        ) : (
          <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-border/80 bg-surfaceAlt/60 text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Holding / Note</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {income.map((ev) => (
                  <tr key={ev.id} className="hover:bg-surfaceAlt/40">
                    <td className="whitespace-nowrap px-4 py-2.5">{formatDate(ev.asOfDate)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        <BadgeDollarSign size={11} /> {ev.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-positive">{money(ev.amount)}</td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 text-xs text-muted">
                      {[
                        holdings?.find((h) => h.id === ev.holdingId)?.ticker,
                        ev.note,
                      ].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => deleteIncome(ev.id)} className={btnIconDanger} title="Delete"><Trash2 size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <form onSubmit={submitIncome} className="grid grid-cols-2 gap-3 rounded-lg bg-surfaceAlt/40 p-3 sm:grid-cols-[130px_120px_140px_130px_1fr_auto]">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="i-type">Type</label>
            <select id="i-type" value={incomeForm.type} onChange={(e) => setIncomeForm((f) => ({ ...f, type: e.target.value }))} className={`${inputCls}`}>
              {INCOME_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="i-amount">Amount ($)</label>
            <input id="i-amount" type="number" step="any" min={0} required value={incomeForm.amount} onChange={(e) => setIncomeForm((f) => ({ ...f, amount: e.target.value }))} className={`${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="i-date">Date</label>
            <input id="i-date" type="date" required max={todayISO()} value={incomeForm.date} onChange={(e) => setIncomeForm((f) => ({ ...f, date: e.target.value }))} className={`${inputCls}`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="i-holding">Holding</label>
            <select id="i-holding" value={incomeForm.holdingId} onChange={(e) => setIncomeForm((f) => ({ ...f, holdingId: e.target.value }))} className={`${inputCls}`}>
              <option value="">— account —</option>
              {(holdings || []).map((h) => (
                <option key={h.id} value={h.id}>{h.ticker}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor="i-note">Note</label>
            <input id="i-note" value={incomeForm.note} onChange={(e) => setIncomeForm((f) => ({ ...f, note: e.target.value }))} placeholder="optional" className={`${inputCls}`} />
          </div>
          <div className="col-span-2 flex items-end sm:col-span-1">
            <button type="submit" disabled={incomeBusy} className={`${btnPrimary} w-full whitespace-nowrap`}>
              <Plus size={14} /> {incomeBusy ? 'Saving…' : 'Log'}
            </button>
          </div>
        </form>
        {incomeFormError && <p className={`${errorCls} mt-2`}>{incomeFormError}</p>}
      </Card>

      {/* Benchmark comparison */}
      <Card
        title="Benchmark comparison"
        icon={Gauge}
        action={
          <div className="flex items-center gap-2">
            <select value={benchmarkPreset} onChange={(e) => setBenchmarkPreset(e.target.value)} className="rounded-md border border-border bg-surface px-2 py-1 text-xs" title="Benchmark annual growth assumption">
              {BENCHMARK_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
            {benchmarkPreset === 'custom' && (
              <input
                type="number"
                step="any"
                value={customRate}
                onChange={(e) => setCustomRate(e.target.value)}
                className="w-20 rounded-md border border-border bg-surface px-2 py-1 text-xs"
                title="Custom annual %"
              />
            )}
          </div>
        }
      >
        {!benchmark ? (
          <p className="py-6 text-center text-sm text-muted">Add at least one balance with a positive value to compare against a benchmark.</p>
        ) : (
          <>
            <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-surfaceAlt/40 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted">Actual growth</p>
                <p className={`font-bold ${benchmark.actualGrowth >= 0 ? 'text-positive' : 'text-negative'}`}>{pct(Math.round(benchmark.actualGrowth * 100) / 100)}</p>
                <p className="text-xs text-muted">since {formatDate(benchmark.start.asOfDate)}</p>
              </div>
              <div className="rounded-lg border border-border bg-surfaceAlt/40 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted">Benchmark ({benchmark.annualPct}%)</p>
                <p className="font-bold">{pct(Math.round(benchmark.benchGrowth * 100) / 100)}</p>
                <p className="text-xs text-muted">{benchmark.years.toFixed(1)} yrs</p>
              </div>
              <div className="rounded-lg border border-border bg-surfaceAlt/40 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted">Outperformance</p>
                <p className={`font-bold ${benchmark.outperformance >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {benchmark.outperformance >= 0 ? '+' : ''}{(benchmark.outperformance).toFixed(1)} pp
                </p>
                <p className="text-xs text-muted">actual − benchmark</p>
              </div>
              <div className="rounded-lg border border-border bg-surfaceAlt/40 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-muted">Actual CAGR</p>
                <p className="font-bold">{benchmark.cagr === null ? '—' : `${benchmark.cagr.toFixed(1)}%/yr`}</p>
                <p className="text-xs text-muted">compound annual</p>
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ReLineChart data={benchmark.data} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} tickMargin={8} minTickGap={40} />
                  <YAxis tick={{ fontSize: 12 }} width={70} tickFormatter={(v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)} domain={['auto', 'auto']} />
                  <Tooltip formatter={(v) => money(v)} labelFormatter={(l) => `As of ${l}`} />
                  <Legend />
                  <Line type="monotone" dataKey="actual" name={account.name} stroke={primary} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="benchmark" name={`Benchmark ${benchmark.annualPct}%`} stroke={positive} strokeWidth={2} strokeDasharray="6 3" dot={false} />
                </ReLineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-2 text-xs text-muted">
              Hypothetical growth of the first balance ({money(benchmark.start.value)} on {formatDate(benchmark.start.asOfDate)}) at {benchmark.annualPct}% per year. Contributions/withdrawals also move the blue line — use it as a rough hurdle, not a precise attribution.
            </p>
          </>
        )}
      </Card>

      <Modal open={!!editingSnap} onClose={() => setEditingSnap(null)} title="Edit balance">
        <form onSubmit={submitEditSnap} className="space-y-4">
          <div>
            <label className={labelCls}>Value ($)</label>
            <input type="number" step="any" required value={editSnapForm.value} onChange={(e) => setEditSnapForm((f) => ({ ...f, value: e.target.value }))} className={`${inputCls}`} />
          </div>
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" required value={editSnapForm.asOfDate} onChange={(e) => setEditSnapForm((f) => ({ ...f, asOfDate: e.target.value }))} className={`${inputCls}`} />
          </div>
          <div>
            <label className={labelCls}>Note</label>
            <input value={editSnapForm.note} onChange={(e) => setEditSnapForm((f) => ({ ...f, note: e.target.value }))} placeholder="optional" className={`${inputCls}`} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditingSnap(null)} className={btnCancel}>Cancel</button>
            <button type="submit" disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editingHolding} onClose={() => setEditingHolding(null)} title={`Edit ${editingHolding?.ticker || 'holding'}`}>
        <form onSubmit={submitEditHolding} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Ticker</label>
              <input value={editHoldingForm.ticker} onChange={(e) => setEditHoldingForm((f) => ({ ...f, ticker: e.target.value.toUpperCase() }))} className={`${inputCls} font-mono`} required />
            </div>
            <div>
              <label className={labelCls}>Shares</label>
              <input type="number" step="any" min={0} required value={editHoldingForm.shares} onChange={(e) => setEditHoldingForm((f) => ({ ...f, shares: e.target.value }))} className={`${inputCls}`} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Name</label>
            <input value={editHoldingForm.name} onChange={(e) => setEditHoldingForm((f) => ({ ...f, name: e.target.value }))} className={`${inputCls}`} />
          </div>
          <div>
            <label className={labelCls}>Asset type</label>
            <select
              value={editHoldingForm.assetType}
              onChange={(e) => setEditHoldingForm((f) => ({ ...f, assetType: e.target.value }))}
              className={`${inputCls}`}
            >
              <option value="">Auto-detect (ticker)</option>
              <option value="EQUITY">Stock</option>
              <option value="ETF">ETF</option>
              <option value="MUTUALFUND">Fund</option>
              <option value="CRYPTOCURRENCY">Crypto</option>
            </select>
            <p className="mt-1 text-xs text-muted">Controls whether the position lists under Stocks &amp; ETFs or Crypto.</p>
          </div>
          <div>
            <label className={labelCls}>Avg. cost ($/share)</label>
            <input type="number" step="any" min={0} required value={editHoldingForm.avgCost} onChange={(e) => setEditHoldingForm((f) => ({ ...f, avgCost: e.target.value }))} className={`${inputCls}`} />
            {(() => {
              const s = Number(editHoldingForm.shares);
              const a = Number(editHoldingForm.avgCost);
              if (!Number.isFinite(s) || s <= 0 || !Number.isFinite(a) || a < 0) return null;
              return <p className="mt-1 text-xs text-muted">Total cost basis: <span className="font-semibold text-text">{money(Math.round(s * a * 100) / 100)}</span></p>;
            })()}
          </div>
          {holdingFormError && <p className={errorCls}>{holdingFormError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditingHolding(null)} className={btnCancel}>Cancel</button>
            <button type="submit" disabled={holdingBusy} className={btnPrimary}>{holdingBusy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteHolding} onClose={() => setDeleteHolding(null)} title="Remove holding?">
        <p className="text-sm text-muted">Remove <strong className="font-mono">{deleteHolding?.ticker}</strong> ({deleteHolding?.shares} shares)? Balance history is kept — only the position row is deleted.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setDeleteHolding(null)} className={btnCancel}>Cancel</button>
          <button onClick={confirmDeleteHolding} disabled={holdingBusy} className="rounded-md bg-negative px-4 py-2 text-sm font-semibold text-onNegative hover:opacity-90 disabled:opacity-50">{holdingBusy ? 'Removing…' : 'Remove'}</button>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete balance">
        <p className="text-sm text-muted">Delete balance of {deleteTarget ? money(deleteTarget.value) : ''} on {deleteTarget ? formatDate(deleteTarget.asOfDate) : ''}? This cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setDeleteTarget(null)} className={btnCancel}>Cancel</button>
          <button onClick={confirmDeleteSnap} disabled={busy} className="rounded-md bg-negative px-4 py-2 text-sm font-semibold text-onNegative hover:opacity-90 disabled:opacity-50">{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </Modal>

      <Modal open={!!rhPreview} onClose={() => !rhBusy && setRhPreview(null)} title="Robinhood import preview" wide>
        {!rhPreview ? null : (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {rhPreview.stats.rows} rows → <strong className="text-text">{rhPreview.positions.length} position{rhPreview.positions.length === 1 ? '' : 's'}</strong>
              {' '}and <strong className="text-text">{rhPreview.income.length} income {rhPreview.income.length === 1 ? 'entry' : 'entries'}</strong>.
              Nothing is saved until you confirm.
            </p>

            {rhPreview.positions.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b border-border/80 bg-surfaceAlt/60 text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Ticker</th>
                      <th className="px-3 py-2 text-right">Shares</th>
                      <th className="px-3 py-2 text-right">Avg. cost</th>
                      <th className="px-3 py-2 text-right">Total cost</th>
                      <th className="px-3 py-2 text-right">Buys / Sells</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rhPreview.positions.map((p) => (
                      <tr key={p.ticker}>
                        <td className="px-3 py-1.5">
                          <span className="font-mono font-semibold">{p.ticker}</span>
                          {p.name && <span className="ml-2 text-xs text-muted">{p.name}</span>}
                          {p.dripBuys > 0 && <span className="ml-2 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">DRIP ×{p.dripBuys}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right">{p.shares.toLocaleString('en-US', { maximumFractionDigits: 6 })}</td>
                        <td className="px-3 py-1.5 text-right">{marketPrice(p.avgCost)}</td>
                        <td className="px-3 py-1.5 text-right font-medium">{money(p.costBasis)}</td>
                        <td className="px-3 py-1.5 text-right text-xs text-muted">{p.buys} / {p.sells}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {rhPreview.income.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  Income to add ({rhPreview.income.length})
                </p>
                <div className="max-h-36 overflow-y-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-border">
                      {rhPreview.income.map((ev, i) => (
                        <tr key={`${ev.asOfDate}-${ev.type}-${ev.amount}-${i}`}>
                          <td className="whitespace-nowrap px-3 py-1.5">{formatDate(ev.asOfDate)}</td>
                          <td className="px-3 py-1.5">
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{ev.type}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-semibold text-positive">{money(ev.amount)}</td>
                          <td className="max-w-[200px] truncate px-3 py-1.5 text-xs text-muted">{ev.ticker || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {(rhPreview.pendingRemovals?.length > 0) && (
              <p className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">
                Will be removed from your holdings (sold out): {rhPreview.pendingRemovals.join(', ')}.
              </p>
            )}

            {rhPreview.closedPositions.filter((c) => !(rhPreview.pendingRemovals || []).includes(c.ticker)).length > 0 && (
              <p className="rounded-md bg-surfaceAlt/60 px-3 py-2 text-xs text-muted">
                Fully sold in the file but kept (no buy history to confirm against):{' '}
                {rhPreview.closedPositions.filter((c) => !(rhPreview.pendingRemovals || []).includes(c.ticker)).map((c) => c.ticker).join(', ')}.
              </p>
            )}

            {(rhPreview.warnings.length > 0 || rhPreview.ignored.length > 0 || rhPreview.optionsSkipped > 0) && (
              <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
                <p className="mb-1 font-semibold">Needs a look before confirming:</p>
                <ul className="list-disc space-y-0.5 pl-4 text-muted">
                  {rhPreview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {rhPreview.ignored.map((g) => (
                    <li key={g.code}>{g.count} “{g.code}” row{g.count === 1 ? '' : 's'} not counted (e.g. cash transfers).</li>
                  ))}
                  {rhPreview.optionsSkipped > 0 && (
                    <li>{rhPreview.optionsSkipped} options row{rhPreview.optionsSkipped === 1 ? '' : 's'} skipped — holdings track shares only.</li>
                  )}
                </ul>
              </div>
            )}

            {rhError && <p className={errorCls}>{rhError}</p>}

            <p className="text-xs text-muted">
              Tip: after importing, use “Update from market value” to record today&apos;s balance.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setRhPreview(null)}               disabled={rhBusy} className={btnCancel}>Cancel</button>
              <button onClick={confirmRobinhoodImport} disabled={rhBusy || (rhPreview.positions.length === 0 && rhPreview.income.length === 0)} className={btnPrimary}>
                <Upload size={14} /> {rhBusy ? 'Importing…' : `Import ${rhPreview.positions.length + rhPreview.income.length} items`}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${account.name}`}>
        <AccountForm
          key={`detail-${account.id}-${JSON.stringify(account)}`}
          categories={categories}
          initial={account}
          history={snapshots}
          busy={busy}
          error={formError}
          onSubmit={async (form) => {
            setBusy(true);
            setFormError('');
            try {
              await api.patch(`/accounts/${account.id}`, form);
              setEditOpen(false);
              load();
            } catch (err) {
              setFormError(err.response?.data?.error || 'Save failed');
            } finally {
              setBusy(false);
            }
          }}
        />
      </Modal>
    </div>
  );
}
