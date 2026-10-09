import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Pencil,
  ChevronRight,
  Wallet,
  Landmark,
  Scale,
  FilterX,
  Archive,
  ArchiveRestore,
  Trash2,
  AlertCircle,
  History,
  LineChart,
  CalendarDays,
  ChartLine,
  Table,
  SlidersHorizontal,
  MoreVertical,
  X,
  Zap,
  Save,
  Building2,
  Tags,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import api from '../api/client.js';
import Spinner from '../components/Spinner.jsx';
import Modal, { EmptyState } from '../components/Modal.jsx';
import AccountForm, { kindLabel } from '../components/AccountForm.jsx';
import ValueAreaChart from '../components/charts/ValueAreaChart.jsx';
import { money, formatDate, todayISO } from '../utils/format.js';
import { AUTO_REFRESH_OPTIONS, readNextRefreshAt, writeNextRefreshAt } from '../utils/autoRefresh.js';
import { useToast } from '../context/ToastContext.jsx';
import { useThemeColors } from '../components/useThemeColors.js';
import { useAutoRefresh } from '../context/AutoRefreshContext.jsx';
import { useDensity } from '../context/DashboardPrefsContext.jsx';
import { inputCls, labelCls, errorCls, btnPrimary, btnOutline, btnCancel, btnDanger, btnDangerOutline } from '../styles.js';
import usePresence from '../hooks/usePresence.js';
import useCountUp from '../hooks/useCountUp.js';

const PAGE_SIZE = 30;

const CATEGORY_ORDER = ['Cash', 'Investment', 'Retirement', 'Real Estate', 'Personal Property', 'Liability'];

const GROUP_MODES = [
  { value: 'category', label: 'Category' },
  { value: 'institution', label: 'Institution' },
  { value: 'type', label: 'Asset / Liability' },
  { value: 'kind', label: 'Account type' },
  { value: 'status', label: 'Status (active / archived)' },
  { value: 'none', label: 'No grouping' },
];

const COLUMN_DEFS = [
  { key: 'institution', label: 'Institution', hint: 'Bank / broker name under the account title' },
  { key: 'kind', label: 'Type', hint: 'Checking, brokerage, 401(k), mortgage…' },
  { key: 'category', label: 'Category', hint: 'Cash, Investment, Retirement…' },
  { key: 'notes', label: 'Notes', hint: 'Second line preview of account notes' },
  { key: 'updated', label: 'Last updated', hint: 'Balance date next to the amount' },
];

const DEFAULT_COLUMNS = { institution: true, kind: true, category: true, notes: false, updated: true };
const COLUMNS_KEY = 'mp-accounts-columns';

function loadColumns() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLUMNS_KEY));
    if (raw && typeof raw === 'object') return { ...DEFAULT_COLUMNS, ...raw };
  } catch {}
  return { ...DEFAULT_COLUMNS };
}

function groupKeyFor(a, mode) {
  switch (mode) {
    case 'institution':
      return a.institution?.trim() || 'No institution';
    case 'type':
      return a.isAsset ? 'Assets' : 'Liabilities';
    case 'kind':
      return kindLabel(a.kind) || 'Unspecified type';
    case 'status':
      return a.archived ? 'Archived' : 'Active';
    default:
      return a.categoryName || 'Uncategorized';
  }
}

export default function AccountsPage({ refreshKey = 0 }) {
  const [accounts, setAccounts] = useState(null);
  const [categories, setCategories] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editHistory, setEditHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const { error: toastError, success: toastSuccess } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showArchived, setShowArchived] = useState(() => searchParams.get('archived') === '1');
  const [page, setPage] = useState(() => Number(searchParams.get('page')) || 1);

  // Filter / grouping state — initialized from URL
  const [query, setQuery] = useState(() => searchParams.get('q') || '');
  const [inputQuery, setInputQuery] = useState(() => searchParams.get('q') || '');
  const [groupBy, setGroupBy] = useState(() => GROUP_MODES.some(m=>m.value===searchParams.get('group')) ? searchParams.get('group') : 'category');
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get('cat') || 'all');
  const [assetFilter, setAssetFilter] = useState(() => ['all','assets','liabilities'].includes(searchParams.get('type')) ? searchParams.get('type') : 'all');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const { primary, positive, negative } = useThemeColors();
  // Historic amounts — opened in a slide-over drawer so the list never reflows
  const [drawerAccount, setDrawerAccount] = useState(null);
  const [drawerId, setDrawerId] = useState(null); // null = closed
  const drawerPresence = usePresence(drawerId != null, 200);
  const [historyData, setHistoryData] = useState({}); // id -> snapshots[]
  const [historyLoading, setHistoryLoading] = useState({}); // id -> bool
  const [historyError, setHistoryError] = useState({}); // id -> string
  const [historyView, setHistoryView] = useState({}); // id -> 'chart' | 'table'

  // ---- NEW: bulk selection -------------------------------------------------
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkCategoryOpen, setBulkCategoryOpen] = useState(false);
  const [bulkCategoryId, setBulkCategoryId] = useState('');
  const [bulkInstitutionOpen, setBulkInstitutionOpen] = useState(false);
  const [bulkInstitution, setBulkInstitution] = useState('');

  // ---- NEW: column visibility ----------------------------------------------
  const [columns, setColumns] = useState(loadColumns);
  useEffect(() => {
    try { localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns)); } catch {}
  }, [columns]);
  const showCol = (k) => columns[k] !== false;

  // Consolidated "View" popover (grouping, filters-by-state, columns) and the
  // per-row overflow menu share one outside-click / Escape handler.
  const [viewOpen, setViewOpen] = useState(false);
  const viewMenu = usePresence(viewOpen, 160);
  const viewRef = useRef(null);
  const [rowMenuId, setRowMenuId] = useState(null);
  useEffect(() => {
    if (!viewOpen && rowMenuId == null) return undefined;
    const onDown = (e) => {
      if (viewOpen && viewRef.current && !viewRef.current.contains(e.target)) setViewOpen(false);
      if (rowMenuId != null && !e.target.closest('[data-row-menu]')) setRowMenuId(null);
    };
    const onEsc = (e) => {
      if (e.key !== 'Escape') return;
      setViewOpen(false);
      setRowMenuId(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [viewOpen, rowMenuId]);

  // Close the history drawer on Escape.
  useEffect(() => {
    if (drawerId == null) return undefined;
    const onEsc = (e) => {
      if (e.key === 'Escape') setDrawerId(null);
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [drawerId]);

  // ---- NEW: inline quick balance update ------------------------------------
  const [quickId, setQuickId] = useState(null);
  const [quickForm, setQuickForm] = useState({ value: '', date: todayISO(), note: '' });
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickError, setQuickError] = useState('');

  // ---- NEW: market-value auto refresh on page load ---------------------------
  const { enabled: autoRefresh, setAutoRefreshEnabled: setAutoRefresh, intervalMs } = useAutoRefresh();
  const { page: pageCls, heading, headerIcon, headerIconSize } = useDensity();
  const refreshCadenceLabel =
    AUTO_REFRESH_OPTIONS.find((o) => o.seconds * 1000 === intervalMs)?.label || `${intervalMs / 1000}s`;
  const [autoStatus, setAutoStatus] = useState(null); // { state: 'working'|'done'|'error', text }
  const marketBusy = useRef(false); // never stack refresh requests
  const nextAutoAt = useRef(0); // timestamp of the next auto-refresh tick
  const [countdown, setCountdown] = useState(() => Math.ceil(intervalMs / 1000)); // seconds until that tick

  const load = useCallback(() => {
    api.get('/accounts', { params: { includeArchived: showArchived ? 1 : 0 } })
      .then((r) => setAccounts(r.data.accounts))
      .catch(() => setAccounts([]));
  }, [showArchived]);

  useEffect(() => {
    load();
    api
      .get('/accounts/categories')
      .then((r) => setCategories(r.data.categories))
      .catch(() => {});
  }, [load, refreshKey]);

  // Reprice brokerage/retirement accounts from live quotes, then reload the
  // list so fresh values show immediately. Idempotent: at most one snapshot
  // row per account per day, with the live total overwriting any manual entry.
// `background` runs (the configured auto-refresh cadence) skip the transient
// "working" banner so the status line doesn't flash on every tick.
  const runMarketRefresh = useCallback(async ({ background = false } = {}) => {
    if (marketBusy.current) return; // a refresh is already in flight
    marketBusy.current = true;
    if (!background) setAutoStatus({ state: 'working', text: 'Refreshing market values…' });
    try {
      // Timeout releases the busy flag even if the response never arrives,
      // so one hung request can't kill the auto-refresh loop.
      const { data } = await api.post(
        '/accounts/refresh-market-values',
        { asOfDate: todayISO() },
        { timeout: 20000 }
      );
      const n = (data.created?.length || 0) + (data.updated?.length || 0);
      const skips = data.skipped?.length || 0;
      if (n === 0 && skips === 0) {
        setAutoStatus(null); // nothing priceable — stay quiet
      } else {
        const bits = [];
        if (n > 0) bits.push(`${n} account${n === 1 ? '' : 's'} updated`);
        if (skips > 0) {
          const shown = (data.skipped || [])
            .slice(0, 3)
            .map((s) => `${s.name}: ${(s.reason || '').slice(0, 70)}`);
          bits.push(
            `${skips} skipped — ${shown.join('; ')}${skips > 3 ? ` (+${skips - 3} more)` : ''}`
          );
        }
        setAutoStatus({ state: 'done', text: `Market refresh: ${bits.join(' · ')}` });
      }
      load();
    } catch {
      // Market data is a nice-to-have — never block the page on it.
      setAutoStatus({ state: 'error', text: 'Market refresh unavailable — showing last recorded values.' });
    } finally {
      marketBusy.current = false;
      // A manual run starts a fresh countdown so the next auto tick waits a
      // full interval instead of firing immediately.
      if (!background) {
        nextAutoAt.current = Date.now() + intervalMs;
        writeNextRefreshAt(nextAutoAt.current);
        setCountdown(Math.ceil(intervalMs / 1000));
      }
    }
  }, [load, intervalMs]);

  // Auto-update: reprice once on load, then keep stock pricing fresh on the
  // configured cadence (Settings → Auto-refresh, 30s – 5 min) while the toggle
  // is on. Ticks are skipped while the tab is hidden so a backgrounded tab
  // doesn't hammer the quote provider; the busy flag in runMarketRefresh keeps
  // a slow response from stacking requests. The 1-second ticker keeps the
  // countdown in the Refresh prices button aligned with the real next-tick
  // timestamp rather than a drifting counter.
  useEffect(() => {
    if (!autoRefresh) return undefined;
    // Continue the shared countdown from the previous page, and never reprice
    // immediately on a freshly loaded page — the first tick waits for the
    // remaining time (a full interval when nothing was stored).
    const now = Date.now();
    let next = readNextRefreshAt();
    if (!Number.isFinite(next) || next <= now) next = now + intervalMs;
    writeNextRefreshAt(next);
    nextAutoAt.current = next;

    let mainTimer;
    const schedule = () => {
      const wait = Math.max(0, nextAutoAt.current - Date.now());
      mainTimer = setTimeout(() => {
        if (document.hidden) {
          nextAutoAt.current = Date.now() + intervalMs;
          writeNextRefreshAt(nextAutoAt.current);
        } else {
          runMarketRefresh({ background: true });
          nextAutoAt.current = Date.now() + intervalMs;
          writeNextRefreshAt(nextAutoAt.current);
        }
        schedule();
      }, wait + 60);
    };
    const tock = () => setCountdown(Math.max(0, Math.ceil((nextAutoAt.current - Date.now()) / 1000)));
    tock();
    schedule();
    const sec = setInterval(tock, 1000);
    return () => {
      clearTimeout(mainTimer);
      clearInterval(sec);
    };
  }, [autoRefresh, runMarketRefresh, intervalMs]);

  // Debounce search input → query (300ms)
  useEffect(() => {
    const t = setTimeout(() => setQuery(inputQuery), 300);
    return () => clearTimeout(t);
  }, [inputQuery]);

  // Sync filters → URL
  useEffect(() => {
    const next = {};
    if (query) next.q = query;
    if (groupBy !== 'category') next.group = groupBy;
    if (categoryFilter !== 'all') next.cat = categoryFilter;
    if (assetFilter !== 'all') next.type = assetFilter;
    if (showArchived) next.archived = '1';
    if (page !== 1) next.page = String(page);
    setSearchParams(next, { replace: true });
  }, [query, groupBy, categoryFilter, assetFilter, showArchived, page, setSearchParams]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [query, categoryFilter, assetFilter, showArchived, groupBy]);

  const filtersActive =
    query.trim() !== '' || categoryFilter !== 'all' || assetFilter !== 'all' || showArchived || groupBy !== 'category';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (accounts || []).filter((a) => {
      if (!showArchived && a.archived) return false;
      if (assetFilter === 'assets' && !a.isAsset) return false;
      if (assetFilter === 'liabilities' && a.isAsset) return false;
      if (categoryFilter !== 'all' && String(a.categoryId) !== categoryFilter) return false;
      if (q) {
        const hay = [a.name, a.institution, a.categoryName, kindLabel(a.kind), a.notes]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [accounts, query, categoryFilter, assetFilter, showArchived]);

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const grouped = useMemo(() => {
    if (groupBy === 'none') {
      const list = [...paginated].sort((x, y) => x.name.localeCompare(y.name));
      return [['All accounts', list]];
    }
    const map = new Map();
    for (const a of paginated) {
      const key = groupKeyFor(a, groupBy);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(a);
    }
    const entries = [...map.entries()];
    for (const [, list] of entries) list.sort((x, y) => x.name.localeCompare(y.name));
    if (groupBy === 'category') {
      entries.sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a[0]);
        const ib = CATEGORY_ORDER.indexOf(b[0]);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
      });
    } else {
      entries.sort((a, b) => a[0].localeCompare(b[0]));
    }
    return entries;
  }, [paginated, groupBy]);

  const totals = useMemo(() => {
    const t = { assets: 0, liabilities: 0 };
    for (const a of filtered) {
      if (a.archived) continue;
      if (a.isAsset) t.assets += a.latestValue || 0;
      else t.liabilities += a.latestValue || 0;
    }
    return t;
  }, [filtered]);

  // Headline figures glide toward their new values (mountFromZero gives the net
  // worth total a load-in flourish, matching the dashboard). Declared before the
  // early return so the hook count stays stable.
  const assetsShown = useCountUp(totals.assets);
  const liabilitiesShown = useCountUp(totals.liabilities);
  const netWorthShown = useCountUp(totals.assets - totals.liabilities, { mountFromZero: true });

  if (!accounts) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const toggleGroup = (key) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openHistoryDrawer = (a) => {
    setDrawerAccount(a);
    setDrawerId(a.id);
    // lazily fetch when opening and not yet cached
    if (!historyData[a.id] && !historyLoading[a.id]) {
      setHistoryLoading((m) => ({ ...m, [a.id]: true }));
      setHistoryError((m) => ({ ...m, [a.id]: '' }));
      api
        .get(`/accounts/${a.id}/snapshots`)
        .then((r) => {
          setHistoryData((m) => ({ ...m, [a.id]: r.data.snapshots || [] }));
        })
        .catch((e) => {
          setHistoryError((m) => ({ ...m, [a.id]: e.response?.data?.error || 'Failed to load history' }));
        })
        .finally(() => setHistoryLoading((m) => ({ ...m, [a.id]: false })));
    }
  };

  const closeHistoryDrawer = () => setDrawerId(null);

  const archiveAccount = (a) => {
    api
      .patch(`/accounts/${a.id}`, { archived: !a.archived })
      .then(() => {
        load();
        toastSuccess(a.archived ? 'Account restored' : 'Account archived');
      })
      .catch((err) => toastError(err.response?.data?.error || 'Archive failed'));
  };

  const clearFilters = () => {
    setInputQuery('');
    setQuery('');
    setCategoryFilter('all');
    setAssetFilter('all');
    setGroupBy('category');
    setShowArchived(false);
    setPage(1);
  };

  const openAdd = () => {
    setEditing(null);
    setEditHistory([]);
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (account) => {
    setEditing(account);
    setEditHistory([]);
    setFormError('');
    setModalOpen(true);
    api
      .get(`/accounts/${account.id}/snapshots`)
      .then((r) => setEditHistory(r.data.snapshots || []))
      .catch(() => setEditHistory([]));
  };

  // ---- selection helpers ---------------------------------------------------
  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectIds = (ids, checked) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  const allPageSelected = paginated.length > 0 && paginated.every((a) => selected.has(a.id));

  const bulkPatch = async (patch) => {
    const ids = [...selected];
    if (!ids.length) return;
    setBulkBusy(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => api.patch(`/accounts/${id}`, patch)));
      const failed = results.filter((r) => r.status === 'rejected').length;
      if (failed === 0) toastSuccess(`Updated ${ids.length} account${ids.length === 1 ? '' : 's'}`);
      else if (failed < ids.length) toastSuccess(`Updated ${ids.length - failed} of ${ids.length} accounts`);
      else toastError('Bulk update failed');
      setSelected(new Set());
      load();
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkCategory = async (e) => {
    e?.preventDefault?.();
    if (!bulkCategoryId) return;
    await bulkPatch({ categoryId: Number(bulkCategoryId) });
    setBulkCategoryOpen(false);
    setBulkCategoryId('');
  };

  const handleBulkInstitution = async (e) => {
    e?.preventDefault?.();
    await bulkPatch({ institution: bulkInstitution.trim() || null });
    setBulkInstitutionOpen(false);
    setBulkInstitution('');
  };

  // ---- quick update ---------------------------------------------------------
  const openQuick = (a) => {
    setQuickId(a.id);
    setQuickForm({
      value: a.latestValue !== null && a.latestValue !== undefined ? String(a.latestValue) : '',
      date: todayISO(),
      note: '',
    });
    setQuickError('');
  };

  const submitQuick = async (e) => {
    e?.preventDefault?.();
    if (!quickId) return;
    const value = Number(quickForm.value);
    if (!Number.isFinite(value) || value < 0) {
      setQuickError('Enter a valid non-negative amount.');
      return;
    }
    setQuickBusy(true);
    setQuickError('');
    try {
      await api.post(`/accounts/${quickId}/snapshots`, {
        value,
        asOfDate: quickForm.date,
        note: quickForm.note.trim() || undefined,
      });
      setAccounts((prev) =>
        (prev || []).map((a) =>
          a.id === quickId ? { ...a, latestValue: value, latestDate: quickForm.date } : a
        )
      );
      setHistoryData((m) => {
        const next = { ...m };
        delete next[quickId];
        return next;
      });
      setQuickId(null);
      toastSuccess('Balance updated');
    } catch (err) {
      setQuickError(err.response?.data?.error || 'Could not save balance');
    } finally {
      setQuickBusy(false);
    }
  };

  const subtitleFor = (a) => {
    const parts = [];
    if (showCol('institution') && groupBy !== 'institution' && a.institution) parts.push(a.institution);
    if (showCol('kind') && groupBy !== 'kind' && kindLabel(a.kind)) parts.push(kindLabel(a.kind));
    if (showCol('category') && groupBy !== 'category' && a.categoryName) parts.push(a.categoryName);
    return parts.join(' · ') || '—';
  };

  const handleSubmit = async (form) => {
    setBusy(true);
    setFormError('');
    // Duplicate name+institution guard (case-insensitive)
    const norm = (s) => (s||'').trim().toLowerCase();
    const dup = (accounts||[]).find((a) => norm(a.name)===norm(form.name) && norm(a.institution)===norm(form.institution) && (!editing || a.id!==editing.id));
    if (dup) {
      const ok = window.confirm(`An account named "${dup.name}"` + (dup.institution?` at ${dup.institution}`:'') + ` already exists. Create anyway?`);
      if (!ok) { setBusy(false); return; }
    }
    try {
      const { opening, balanceUpdate, ...accountData } = form;
      if (editing) {
        await api.patch(`/accounts/${editing.id}`, accountData);
        if (balanceUpdate) {
          try {
            await api.post(`/accounts/${editing.id}/snapshots`, balanceUpdate);
          } catch {
            setModalOpen(false);
            load();
            toastError('Account updated, but the new balance could not be saved. Try again from the account page.');
            return;
          }
        }
        toastSuccess('Account updated');
      } else {
        const created = await api.post('/accounts', accountData);
        if (opening) {
          try {
            await api.post(`/accounts/${created.data.account.id}/snapshots`, opening);
          } catch {
            setModalOpen(false);
            load();
            toastError('Account created, but the opening balance could not be saved. You can add it from the account page.');
            return;
          }
        }
        toastSuccess('Account created');
      }
      setModalOpen(false);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setBusy(true);
    try {
      await api.delete(`/accounts/${confirmDelete.id}`, { params: { permanent: 1 } });
      setConfirmDelete(null);
      load();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Delete failed');
      setModalOpen(false);
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  };

  const visibleCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageStart = filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const pageEnd = Math.min(page * PAGE_SIZE, filtered.length);

  return (
    <div className={pageCls}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={`flex items-center gap-2.5 ${heading} font-bold`}>
          <span className={`flex ${headerIcon} items-center justify-center rounded-lg bg-primary/10 text-primary`}>
            <Wallet size={headerIconSize} />
          </span>
          Accounts
          <span className="text-sm font-normal text-muted">· {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => runMarketRefresh()}
            title={autoRefresh ? `Reprice brokerage & retirement accounts now — auto-refresh in ${countdown}s` : 'Reprice brokerage & retirement accounts now'}
            className={btnOutline}
          >
            <RefreshCw size={14} />
            Refresh prices
            {autoRefresh && <span className="tabular-nums">({countdown}s)</span>}
          </button>
          <button onClick={openAdd} className={`${btnPrimary} whitespace-nowrap`}>
            <Plus size={16} />
            Add account
          </button>
        </div>
      </header>

      {autoStatus && (
        <p
          className={`anim-fade flex items-center gap-1.5 rounded-md px-3 py-2 text-xs ${
            autoStatus.state === 'error'
              ? 'bg-negative/10 text-negative'
              : autoStatus.state === 'working'
                ? 'bg-surfaceAlt text-muted'
                : 'bg-positive/10 text-positive'
          }`}
          role="status"
        >
          {autoStatus.state === 'working' ? (
            <RefreshCw size={12} className="animate-spin" />
          ) : autoStatus.state === 'done' ? (
            <CheckCircle2 size={12} />
          ) : (
            <AlertCircle size={12} />
          )}
          {autoStatus.text}
        </p>
      )}

      {!accounts.length ? (
        <EmptyState
          icon={Wallet}
          title="No accounts yet"
          hint="Track bank accounts, investments, property and loans to see your full net worth picture."
        >
          <button onClick={openAdd} className={btnPrimary}>
            <Plus size={15} />
            Add your first account
          </button>
        </EmptyState>
      ) : (
        <>
          {/* Headline totals */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-5 py-4 shadow-sm">
              <Landmark size={18} className="text-positive" />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Total Assets</p>
                <p className="text-lg font-bold text-positive">{money(assetsShown)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-5 py-4 shadow-sm">
              <Scale size={18} className="text-negative" />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Total Liabilities</p>
                <p className="text-lg font-bold text-negative">{money(liabilitiesShown)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 rounded-xl border border-border bg-surface px-5 py-4 shadow-sm">
              <Wallet size={18} className={totals.assets - totals.liabilities >= 0 ? 'text-positive' : 'text-negative'} />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Net Worth</p>
                <p className={`text-lg font-bold ${totals.assets - totals.liabilities >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {money(netWorthShown)}
                </p>
              </div>
            </div>
          </div>

          {/* Filters toolbar */}
          <section aria-label="Filters" className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="min-w-[220px] flex-1">
              <label htmlFor="acc-search" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                Search
              </label>
              <div className="relative">
                <input
                  id="acc-search"
                  type="search"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  placeholder="Name, institution, type, notes…"
                  className={`${inputCls} pl-9`}
                />
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              </div>
            </div>
            <div>
              <label htmlFor="acc-filter-cat" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                Category
              </label>
              <select id="acc-filter-cat" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={inputCls}>
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="acc-filter-type" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                Type
              </label>
              <select id="acc-filter-type" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} className={inputCls}>
                <option value="all">Assets &amp; liabilities</option>
                <option value="assets">Assets only</option>
                <option value="liabilities">Liabilities only</option>
              </select>
            </div>
            <div className="relative" ref={viewRef}>
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Display</span>
              <button
                type="button"
                onClick={() => setViewOpen((o) => !o)}
                aria-expanded={viewOpen}
                className={btnOutline}
              >
                <SlidersHorizontal size={15} />
                View
              </button>
              {viewMenu.present && (
                <div className={`${viewMenu.closing ? 'anim-pop-out' : 'anim-pop'} absolute right-0 z-30 mt-2 w-72 rounded-xl border border-border bg-surface p-4 shadow-lg`}>
                  <label htmlFor="acc-groupby" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                    Group by
                  </label>
                  <select id="acc-groupby" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={inputCls}>
                    {GROUP_MODES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>

                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm" title="List archived accounts too">
                      <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
                      Show archived accounts
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm" title={`Reprice brokerage & retirement accounts from live quotes every ${refreshCadenceLabel}`}>
                      <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
                      Auto-refresh market prices
                    </label>
                  </div>

                  <p className="mb-2 mt-3 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted">Visible details</p>
                  <div className="space-y-1">
                    {COLUMN_DEFS.map((c) => (
                      <label key={c.key} className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-surfaceAlt" title={c.hint}>
                        <input
                          type="checkbox"
                          checked={showCol(c.key)}
                          onChange={() => setColumns((prev) => ({ ...prev, [c.key]: !prev[c.key] }))}
                          className="mt-0.5 h-4 w-4 accent-[var(--color-primary)]"
                        />
                        <span>
                          <span className="block text-sm font-medium">{c.label}</span>
                          <span className="block text-xs text-muted">{c.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>

                  <div className="mt-3 flex gap-2 border-t border-border pt-3">
                    <button
                      type="button"
                      onClick={() => setColumns({ ...DEFAULT_COLUMNS })}
                      className="flex-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-surfaceAlt"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewOpen(false)}
                      className="flex-1 rounded-md bg-primary px-2 py-1.5 text-xs font-semibold text-onPrimary hover:opacity-90"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
            {filtersActive && (
              <button onClick={clearFilters} className={btnOutline}>
                <FilterX size={15} />
                Clear filters
              </button>
            )}
          </section>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <section
              aria-label="Bulk actions"
              className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-surface p-3 shadow-md"
            >
              <span className="mr-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                {selected.size} selected
              </span>
              <button
                onClick={() => bulkPatch({ archived: true })}
                disabled={bulkBusy}
                className={btnOutline}
              >
                <Archive size={14} /> Archive
              </button>
              <button
                onClick={() => bulkPatch({ archived: false })}
                disabled={bulkBusy}
                className={btnOutline}
              >
                <ArchiveRestore size={14} /> Restore
              </button>
              <button
                onClick={() => { setBulkCategoryId(''); setBulkCategoryOpen(true); }}
                disabled={bulkBusy}
                className={btnOutline}
              >
                <Tags size={14} /> Set category
              </button>
              <button
                onClick={() => { setBulkInstitution(''); setBulkInstitutionOpen(true); }}
                disabled={bulkBusy}
                className={btnOutline}
              >
                <Building2 size={14} /> Set institution
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="ml-auto flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-muted hover:text-text"
              >
                <X size={14} /> Clear
              </button>
              {bulkBusy && <span className="text-xs text-muted">Working…</span>}
            </section>
          )}

          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <label className="flex cursor-pointer items-center gap-1.5 hover:text-text" title="Select all accounts on this page">
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={(e) => selectIds(paginated.map((a) => a.id), e.target.checked)}
                className="h-4 w-4 accent-[var(--color-primary)]"
              />
              Select page
            </label>
            <span>·</span>
            Showing <span className="font-semibold text-text">{filtered.length ? `${pageStart}-${pageEnd} of ${visibleCount}` : 0}</span> of {accounts.length} accounts
            {groupBy !== 'none' && grouped.length > 1 && (
              <>
                <span>·</span>
                <button onClick={() => setCollapsed(new Set())} className="hover:text-text hover:underline">Expand all</button>
                <span>·</span>
                <button
                  onClick={() => setCollapsed(new Set(grouped.map(([key]) => key)))}
                  className="hover:text-text hover:underline"
                >
                  Collapse all
                </button>
              </>
            )}
            {filtersActive && <span className="italic">(totals reflect current filters)</span>}
          </p>

          {!filtered.length ? (
            <EmptyState
              icon={Search}
              title="No accounts match your filters"
              hint="Try adjusting the search or clearing the filters to see more accounts."
            >
              {filtersActive && (
                <button onClick={clearFilters} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-primary hover:bg-surfaceAlt">
                  <FilterX size={14} />
                  Clear filters
                </button>
              )}
            </EmptyState>
          ) : (
            grouped.map(([groupLabel, list], gi) => {
              let assets = 0;
              let liabilities = 0;
              for (const a of list) {
                if (a.archived) continue;
                if (a.isAsset) assets += a.latestValue || 0;
                else liabilities += a.latestValue || 0;
              }
              const net = assets - liabilities;
              const isCollapsed = collapsed.has(groupLabel);
              const groupIds = list.map((a) => a.id);
              const groupSelected = groupIds.filter((id) => selected.has(id)).length;
              const groupAll = groupIds.length > 0 && groupSelected === groupIds.length;
              return (
                <section
                  key={groupLabel}
                  className="anim-rise overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
                  style={{ animationDelay: `${Math.min(gi, 8) * 50}ms` }}
                >
                  <div className="flex w-full items-center justify-between gap-3 border-b border-border bg-surfaceAlt px-5 py-3">
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={groupAll}
                        ref={(el) => { if (el) el.indeterminate = groupSelected > 0 && !groupAll; }}
                        onChange={(e) => selectIds(groupIds, e.target.checked)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select all in ${groupLabel}`}
                        className="h-4 w-4 accent-[var(--color-primary)]"
                      />
                      <button
                        type="button"
                        onClick={() => toggleGroup(groupLabel)}
                        aria-expanded={!isCollapsed}
                        className="flex items-center gap-2 text-left hover:opacity-90"
                      >
                        <ChevronRight
                          size={14}
                          aria-hidden="true"
                          className={`text-muted transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                        />
                        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{groupLabel}</h3>
                        <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">{list.length}</span>
                        {groupSelected > 0 && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{groupSelected} selected</span>
                        )}
                      </button>
                    </span>
                    <span className={`text-sm font-semibold ${net >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {money(net)}
                    </span>
                  </div>
                  <div className="mp-collapse" data-open={!isCollapsed}>
                    <div className="mp-collapse-inner">
                    <ul className="divide-y divide-border">
                      {list.map((a) => {
                        const isSel = selected.has(a.id);
                        const isQuickOpen = quickId === a.id;
                        const isMenuOpen = rowMenuId === a.id;
                        return (
                          <li key={a.id} className={`${a.archived ? 'opacity-50' : ''} ${isSel ? 'bg-primary/[0.04]' : ''}`}>
                            <div className="flex items-center justify-between gap-3 px-5 py-3">
                              <div className="flex min-w-0 items-start gap-2.5">
                                <input
                                  type="checkbox"
                                  checked={isSel}
                                  onChange={() => toggleSelect(a.id)}
                                  aria-label={`Select ${a.name}`}
                                  className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                                />
                                <div className="min-w-0">
                                  <Link viewTransition to={`/accounts/${a.id}`} className="font-medium text-text u-grow hover:text-primary">
                                    {a.name}
                                    {a.archived && <span className="ml-2 rounded bg-surfaceAlt px-1.5 py-0.5 text-xs text-muted">archived</span>}
                                  </Link>
                                  <p className="truncate text-xs text-muted">
                                    {subtitleFor(a)}
                                  </p>
                                  {showCol('notes') && a.notes && (
                                    <p className="mt-0.5 truncate text-xs italic text-muted">“{a.notes.slice(0, 90)}{a.notes.length > 90 ? '…' : ''}”</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 sm:gap-2">
                                <div className="hidden text-right sm:block">
                                  <p className={a.isAsset ? 'font-semibold text-positive' : 'font-semibold text-negative'}>
                                    {money(a.latestValue)}
                                  </p>
                                  {showCol('updated') && <p className="text-xs text-muted">{formatDate(a.latestDate)}</p>}
                                </div>
                                <div className="block text-right sm:hidden">
                                  <p className={`text-sm font-semibold ${a.isAsset ? 'text-positive' : 'text-negative'}`}>{money(a.latestValue)}</p>
                                </div>
                                <button
                                  onClick={() => (isQuickOpen ? setQuickId(null) : openQuick(a))}
                                  aria-label={isQuickOpen ? `Close quick update for ${a.name}` : `Quick update balance for ${a.name}`}
                                  aria-expanded={isQuickOpen}
                                  title="Quick update balance without leaving this page"
                                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                    isQuickOpen
                                      ? 'border-primary/40 bg-primary/10 text-primary'
                                      : 'border-border text-muted hover:bg-surfaceAlt hover:text-text'
                                  }`}
                                >
                                  <Zap size={14} />
                                  <span className="hidden md:inline">Quick update</span>
                                </button>
                                <div className="relative" data-row-menu>
                                  <button
                                    type="button"
                                    onClick={() => setRowMenuId(isMenuOpen ? null : a.id)}
                                    aria-haspopup="menu"
                                    aria-expanded={isMenuOpen}
                                    aria-label={`More actions for ${a.name}`}
                                    title="More actions"
                                    className={`rounded-md p-1.5 transition-colors ${isMenuOpen ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-surfaceAlt hover:text-text'}`}
                                  >
                                    <MoreVertical size={16} />
                                  </button>
                                  {isMenuOpen && (
                                    <div role="menu" className="anim-pop absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl">
                                      <button role="menuitem" onClick={() => { setRowMenuId(null); openHistoryDrawer(a); }} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition-colors hover:bg-surfaceAlt">
                                        <History size={14} className="text-muted" /> History
                                      </button>
                                      <button role="menuitem" onClick={() => { setRowMenuId(null); openEdit(a); }} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition-colors hover:bg-surfaceAlt">
                                        <Pencil size={14} className="text-muted" /> Edit
                                      </button>
                                      <button role="menuitem" onClick={() => { setRowMenuId(null); archiveAccount(a); }} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-medium transition-colors hover:bg-surfaceAlt">
                                        {a.archived ? <ArchiveRestore size={14} className="text-muted" /> : <Archive size={14} className="text-muted" />}
                                        {a.archived ? 'Restore' : 'Archive'}
                                      </button>
                                      <button role="menuitem" onClick={() => { setRowMenuId(null); setConfirmDelete(a); }} className="flex w-full items-center gap-2.5 border-t border-border px-4 py-2 text-left text-sm font-medium text-negative transition-colors hover:bg-negative/10">
                                        <Trash2 size={14} /> Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="mp-collapse" data-open={isQuickOpen}>
                              <div className="mp-collapse-inner">
                            {isQuickOpen && (
                              <div className="anim-fade border-t border-dashed border-border bg-surfaceAlt/40 px-5 py-3">
                                <form onSubmit={submitQuick} className="flex flex-wrap items-end gap-2">
                                  <div className="w-36">
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor={`q-value-${a.id}`}>New value ($)</label>
                                    <input
                                      id={`q-value-${a.id}`}
                                      type="number"
                                      step="any"
                                      min={0}
                                      required
                                      autoFocus
                                      value={quickForm.value}
                                      onChange={(e) => setQuickForm((f) => ({ ...f, value: e.target.value }))}
                                      className={`${inputCls}`}
                                      placeholder="e.g. 5200"
                                    />
                                  </div>
                                  <div className="w-36">
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor={`q-date-${a.id}`}>Date</label>
                                    <input
                                      id={`q-date-${a.id}`}
                                      type="date"
                                      required
                                      max={todayISO()}
                                      value={quickForm.date}
                                      onChange={(e) => setQuickForm((f) => ({ ...f, date: e.target.value }))}
                                      className={`${inputCls}`}
                                    />
                                  </div>
                                  <div className="min-w-[160px] flex-1">
                                    <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted" htmlFor={`q-note-${a.id}`}>Note</label>
                                    <input
                                      id={`q-note-${a.id}`}
                                      value={quickForm.note}
                                      onChange={(e) => setQuickForm((f) => ({ ...f, note: e.target.value }))}
                                      placeholder="optional"
                                      className={`${inputCls}`}
                                    />
                                  </div>
                                  <button
                                    type="submit"
                                    disabled={quickBusy}
                                    className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-onPrimary hover:opacity-90 disabled:opacity-50"
                                  >
                                    <Save size={13} /> {quickBusy ? 'Saving…' : 'Save'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setQuickId(null)}
                                    className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-surfaceAlt hover:text-text"
                                  >
                                    Cancel
                                  </button>
                                </form>
                                {quickError && <p className="mt-2 rounded-md bg-negative/10 px-3 py-1.5 text-xs text-negative">{quickError}</p>}
                                <p className="mt-1.5 text-xs text-muted">Tip: this records a new snapshot — history is kept. For corrections, use the detail page table.</p>
                              </div>
                            )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    </div>
                  </div>
                </section>
              );
            })
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className={btnOutline}>Previous</button>
              <span className="text-sm text-muted">Page {page} of {totalPages}</span>
              <button disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} className={btnOutline}>Next</button>
            </div>
          )}
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.name}` : 'Add account'}>
        <AccountForm
          key={editing ? `edit-${editing.id}` : 'new'}
          categories={categories}
          initial={editing}
          history={editHistory}
          onSubmit={handleSubmit}
          busy={busy}
          error={formError}
        />
        {editing && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <button
              onClick={() =>
                api
                  .patch(`/accounts/${editing.id}`, { archived: !editing.archived })
                  .then(() => {
                    setModalOpen(false);
                    load();
                    toastSuccess(editing.archived ? 'Account restored' : 'Account archived');
                  })
                  .catch((err)=> toastError(err.response?.data?.error || 'Archive failed'))
              }
              className={`${btnOutline} w-full justify-center gap-2`}
            >
              <Archive size={14} />
              {editing.archived ? 'Restore account' : 'Archive account'}
            </button>
            <button
              onClick={() => setConfirmDelete(editing)}
              className={`${btnDangerOutline} w-full`}
            >
              <Trash2 size={14} />
              Delete permanently
            </button>
          </div>
        )}
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete permanently?">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-negative/10 text-negative">
            <AlertCircle size={20} />
          </span>
          <p className="text-sm text-muted">
            This will delete <strong>{confirmDelete?.name}</strong> and all of its balance history. Consider archiving instead.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => setConfirmDelete(null)} className={btnCancel}>
            Cancel
          </button>
          <button onClick={handleDelete} disabled={busy} className={btnDanger}>
            <Trash2 size={14} />
            Delete forever
          </button>
        </div>
      </Modal>

      {/* Bulk: set category */}
      <Modal open={bulkCategoryOpen} onClose={() => setBulkCategoryOpen(false)} title={`Set category — ${selected.size} account${selected.size === 1 ? '' : 's'}`}>
        <form onSubmit={handleBulkCategory} className="space-y-4">
          <div>
            <label htmlFor="bulk-cat" className={labelCls}>Category</label>
            <select
              id="bulk-cat"
              value={bulkCategoryId}
              onChange={(e) => setBulkCategoryId(e.target.value)}
              className={inputCls}
              required
            >
              <option value="">Choose…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setBulkCategoryOpen(false)} className={btnCancel}>Cancel</button>
            <button type="submit" disabled={bulkBusy || !bulkCategoryId} className={btnPrimary}>
              {bulkBusy ? 'Working…' : 'Apply'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Bulk: set institution */}
      <Modal open={bulkInstitutionOpen} onClose={() => setBulkInstitutionOpen(false)} title={`Set institution — ${selected.size} account${selected.size === 1 ? '' : 's'}`}>
        <form onSubmit={handleBulkInstitution} className="space-y-4">
          <div>
            <label htmlFor="bulk-inst" className={labelCls}>Institution (empty clears it)</label>
            <input
              id="bulk-inst"
              value={bulkInstitution}
              onChange={(e) => setBulkInstitution(e.target.value)}
              placeholder="e.g. Vanguard"
              className={inputCls}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setBulkInstitutionOpen(false)} className={btnCancel}>Cancel</button>
            <button type="submit" disabled={bulkBusy} className={btnPrimary}>
              {bulkBusy ? 'Working…' : 'Apply'}
            </button>
          </div>
        </form>
      </Modal>

      {drawerPresence.present && drawerAccount && (() => {
        const a = drawerAccount;
        const snaps = historyData[a.id] || null;
        const isLoading = !!historyLoading[a.id];
        const hErr = historyError[a.id];
        const view = historyView[a.id] || 'chart';
        const histColor = a.isAsset ? positive : negative;
        return (
          <div
            className={`${drawerPresence.closing ? 'anim-fade-out' : 'anim-fade'} fixed inset-0 z-40 bg-black/40`}
            onMouseDown={(e) => e.target === e.currentTarget && closeHistoryDrawer()}
            role="dialog"
            aria-modal="true"
            aria-label={`History for ${a.name}`}
          >
            <div className={`${drawerPresence.closing ? 'anim-pop-out' : 'anim-pop'} absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-surface shadow-2xl`}>
              <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    <CalendarDays size={15} className="text-muted" /> Historic amounts
                  </h3>
                  <p className="truncate text-xs text-muted">{a.name}{a.institution ? ` · ${a.institution}` : ''}</p>
                </div>
                <button onClick={closeHistoryDrawer} aria-label="Close" title="Close" className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-surfaceAlt hover:text-text">
                  <X size={18} />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
                    <button
                      type="button"
                      onClick={() => setHistoryView((m) => ({ ...m, [a.id]: 'chart' }))}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        view === 'chart' ? 'bg-surfaceAlt text-text shadow-sm' : 'text-muted hover:text-text'
                      }`}
                    >
                      <ChartLine size={13} /> Chart
                    </button>
                    <button
                      type="button"
                      onClick={() => setHistoryView((m) => ({ ...m, [a.id]: 'table' }))}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                        view === 'table' ? 'bg-surfaceAlt text-text shadow-sm' : 'text-muted hover:text-text'
                      }`}
                    >
                      <Table size={13} /> Table
                    </button>
                  </div>
                  {snaps && <span className="text-xs text-muted">{snaps.length} {snaps.length === 1 ? 'entry' : 'entries'}</span>}
                </div>

                {isLoading ? (
                  <div className="flex justify-center py-12"><Spinner /></div>
                ) : hErr ? (
                  <p className={errorCls}>{hErr}</p>
                ) : !snaps || snaps.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-muted">
                    No historic balances yet. Use <span className="font-medium text-text">quick update (⚡)</span> to record the first one.
                  </p>
                ) : view === 'chart' ? (
                  <ValueAreaChart snapshots={snaps} color={histColor || primary} />
                ) : (
                  <div className="overflow-auto rounded-lg border border-border bg-surface">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 border-b border-border/80 bg-surfaceAlt/60 text-left text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-4 py-2.5">Date</th>
                          <th className="px-4 py-2.5 text-right">Amount</th>
                          <th className="px-4 py-2.5 text-right">Change</th>
                          <th className="px-4 py-2.5">Note</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {snaps.map((s, idx) => {
                          const prev = snaps[idx + 1];
                          const delta = prev ? s.value - prev.value : null;
                          return (
                            <tr key={s.id} className="hover:bg-surfaceAlt/50">
                              <td className="whitespace-nowrap px-4 py-2.5">{formatDate(s.asOfDate)}</td>
                              <td className={`whitespace-nowrap px-4 py-2.5 text-right font-medium ${a.isAsset ? 'text-positive' : 'text-negative'}`}>{money(s.value)}</td>
                              <td className={`whitespace-nowrap px-4 py-2.5 text-right text-xs ${delta == null ? 'text-muted' : delta >= 0 ? 'text-positive' : 'text-negative'}`}>
                                {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${money(delta)}`}
                              </td>
                              <td className="max-w-[180px] truncate px-4 py-2.5 text-xs text-muted">{s.note || '—'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <Link viewTransition to={`/accounts/${a.id}`} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  <LineChart size={12} /> Open full account page <ChevronRight size={12} />
                </Link>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
