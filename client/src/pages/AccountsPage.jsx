import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Pencil,
  ChevronRight,
  ChevronDown,
  Wallet,
  Landmark,
  Scale,
  FilterX,
  Archive,
  Trash2,
  AlertCircle,
  History,
  LineChart,
  CalendarDays,
} from 'lucide-react';
import api from '../api/client.js';
import Spinner from '../components/Spinner.jsx';
import Modal, { EmptyState } from '../components/Modal.jsx';
import AccountForm, { kindLabel } from '../components/AccountForm.jsx';
import ValueAreaChart from '../components/charts/ValueAreaChart.jsx';
import { money, formatDate } from '../utils/format.js';
import { useToast } from '../context/ToastContext.jsx';
import { useThemeColors } from '../components/useThemeColors.js';

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

const inputCls =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm focus:border-primary focus:outline-none';

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
  // Historic amounts per-account (versatile inline history)
  const [historyOpen, setHistoryOpen] = useState(() => new Set());
  const [historyData, setHistoryData] = useState({}); // id -> snapshots[]
  const [historyLoading, setHistoryLoading] = useState({}); // id -> bool
  const [historyError, setHistoryError] = useState({}); // id -> string

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

  const toggleHistory = (accountId) => {
    setHistoryOpen((prev) => {
      const next = new Set(prev);
      const willOpen = !next.has(accountId);
      if (willOpen) next.add(accountId);
      else next.delete(accountId);
      return next;
    });
    // lazily fetch when opening and not yet cached
    const already = historyData[accountId];
    const loading = historyLoading[accountId];
    const isOpen = historyOpen.has(accountId);
    if (!isOpen && !already && !loading) {
      setHistoryLoading((m) => ({ ...m, [accountId]: true }));
      setHistoryError((m) => ({ ...m, [accountId]: '' }));
      api
        .get(`/accounts/${accountId}/snapshots`)
        .then((r) => {
          setHistoryData((m) => ({ ...m, [accountId]: r.data.snapshots || [] }));
        })
        .catch((e) => {
          setHistoryError((m) => ({ ...m, [accountId]: e.response?.data?.error || 'Failed to load history' }));
        })
        .finally(() => setHistoryLoading((m) => ({ ...m, [accountId]: false })));
    }
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
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (account) => {
    setEditing(account);
    setFormError('');
    setModalOpen(true);
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
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-xl font-bold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Wallet size={17} />
          </span>
          Accounts
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="h-4 w-4 accent-[var(--color-primary)]" />
            Show archived
          </label>
          <button onClick={openAdd} className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
            <Plus size={15} />
            Add account
          </button>
        </div>
      </header>

      {!accounts.length ? (
        <EmptyState
          icon={Wallet}
          title="No accounts yet"
          hint="Track bank accounts, investments, property and loans to see your full net worth picture."
        >
          <button onClick={openAdd} className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">
            <Plus size={15} />
            Add your first account
          </button>
        </EmptyState>
      ) : (
        <>
          {/* Filters & grouping toolbar */}
          <section aria-label="Filters" className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="relative min-w-[220px] flex-1">
              <label htmlFor="acc-search" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                Search
              </label>
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
            <div>
              <label htmlFor="acc-groupby" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">
                Group by
              </label>
              <select id="acc-groupby" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className={inputCls}>
                {GROUP_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
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
            {filtersActive && (
              <button onClick={clearFilters} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surfaceAlt hover:text-text">
                <FilterX size={15} />
                Clear filters
              </button>
            )}
          </section>

          <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
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
            {filtersActive && <span className="italic">(totals below reflect current filters)</span>}
            {paginated.length > 0 && (
              <>
                <span>·</span>
                <button
                  onClick={() => {
                    const allOpen = paginated.every((a) => historyOpen.has(a.id));
                    if (allOpen) {
                      setHistoryOpen((prev) => {
                        const n = new Set(prev);
                        paginated.forEach((a) => n.delete(a.id));
                        return n;
                      });
                    } else {
                      setHistoryOpen((prev) => {
                        const n = new Set(prev);
                        paginated.forEach((a) => n.add(a.id));
                        return n;
                      });
                      paginated.forEach((a) => {
                        if (!historyData[a.id] && !historyLoading[a.id]) {
                          setHistoryLoading((m) => ({ ...m, [a.id]: true }));
                          setHistoryError((m) => ({ ...m, [a.id]: '' }));
                          api.get(`/accounts/${a.id}/snapshots`).then((r)=> setHistoryData((m)=> ({...m,[a.id]: r.data.snapshots||[]}))).catch((e)=> setHistoryError((m)=> ({...m,[a.id]: e.response?.data?.error || 'Failed to load history'}))).finally(()=> setHistoryLoading((m)=> ({...m,[a.id]: false})));
                        }
                      });
                    }
                  }}
                  className="inline-flex items-center gap-1 hover:text-text hover:underline"
                >
                  <History size={12} /> {paginated.every((a)=> historyOpen.has(a.id)) ? 'Hide historic amounts' : 'Show historic amounts'}
                </button>
              </>
            )}
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
            grouped.map(([groupLabel, list]) => {
              let assets = 0;
              let liabilities = 0;
              for (const a of list) {
                if (a.archived) continue;
                if (a.isAsset) assets += a.latestValue || 0;
                else liabilities += a.latestValue || 0;
              }
              const net = assets - liabilities;
              const isCollapsed = collapsed.has(groupLabel);
              return (
                <section key={groupLabel} className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
                  <button
                    type="button"
                    onClick={() => toggleGroup(groupLabel)}
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center justify-between gap-3 border-b border-border bg-surfaceAlt px-5 py-3 text-left hover:opacity-90"
                  >
                    <span className="flex items-center gap-2">
                      <ChevronRight
                        size={14}
                        aria-hidden="true"
                        className={`text-muted transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}
                      />
                      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{groupLabel}</h3>
                      <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-muted">{list.length}</span>
                    </span>
                    <span className={`text-sm font-semibold ${net >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {money(net)}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <ul className="divide-y divide-border">
                      {list.map((a) => {
                        const isHistoryOpen = historyOpen.has(a.id);
                        const snaps = historyData[a.id] || null;
                        const isLoading = !!historyLoading[a.id];
                        const hErr = historyError[a.id];
                        const histColor = a.isAsset ? positive : negative;
                        return (
                          <li key={a.id} className={`${a.archived ? 'opacity-50' : ''}`}>
                            <div className="flex items-center justify-between gap-3 px-5 py-3">
                              <div className="min-w-0">
                                <Link to={`/accounts/${a.id}`} className="font-medium text-text hover:text-primary hover:underline">
                                  {a.name}
                                  {a.archived && <span className="ml-2 rounded bg-surfaceAlt px-1.5 py-0.5 text-xs text-muted">archived</span>}
                                </Link>
                                <p className="truncate text-xs text-muted">
                                  {[
                                    ...(groupBy !== 'institution' ? [a.institution] : []),
                                    ...(groupBy !== 'kind' ? [kindLabel(a.kind)] : []),
                                    ...(groupBy !== 'category' ? [a.categoryName] : []),
                                  ].filter(Boolean).join(' · ') || '—'}
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5 sm:gap-2">
                                <div className="hidden text-right sm:block">
                                  <p className={a.isAsset ? 'font-semibold text-positive' : 'font-semibold text-negative'}>
                                    {money(a.latestValue)}
                                  </p>
                                  <p className="text-xs text-muted">{formatDate(a.latestDate)}</p>
                                </div>
                                <div className="block text-right sm:hidden">
                                  <p className={`text-sm font-semibold ${a.isAsset ? 'text-positive' : 'text-negative'}`}>{money(a.latestValue)}</p>
                                </div>
                                <button
                                  onClick={() => toggleHistory(a.id)}
                                  aria-label={isHistoryOpen ? `Hide history for ${a.name}` : `Show history for ${a.name}`}
                                  aria-expanded={isHistoryOpen}
                                  className={`rounded-md p-1.5 transition-colors ${isHistoryOpen ? 'bg-primary/10 text-primary' : 'text-muted hover:bg-surfaceAlt hover:text-text'}`}
                                  title={isHistoryOpen ? 'Hide historic amounts' : 'View historic amounts'}
                                >
                                  <History size={14} />
                                </button>
                                <button onClick={() => openEdit(a)} aria-label={`Edit ${a.name}`} className="rounded-md p-1.5 text-muted transition-colors hover:bg-surfaceAlt hover:text-text">
                                  <Pencil size={14} />
                                </button>
                              </div>
                            </div>
                            {isHistoryOpen && (
                              <div className="border-t border-border bg-surfaceAlt/40 px-5 py-4">
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                  <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                                    <CalendarDays size={13} /> Historic amounts — {a.name}
                                  </h4>
                                  <Link to={`/accounts/${a.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                                    <LineChart size={12} /> Full page <ChevronDown size={12} className="rotate-[-90deg]" />
                                  </Link>
                                </div>
                                {isLoading ? (
                                  <div className="flex justify-center py-8"><Spinner /></div>
                                ) : hErr ? (
                                  <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{hErr}</p>
                                ) : !snaps || snaps.length === 0 ? (
                                  <p className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-sm text-muted">
                                    No historic balances yet. Use <span className="font-medium text-text">Update balance</span> on the detail page to record the first one.
                                  </p>
                                ) : (
                                  <>
                                    <ValueAreaChart snapshots={snaps} color={histColor || primary} />
                                    <div className="mt-4 max-h-64 overflow-auto rounded-lg border border-border bg-surface">
                                      <table className="w-full text-sm">
                                        <thead className="sticky top-0 bg-surfaceAlt text-left text-xs uppercase tracking-wide text-muted">
                                          <tr>
                                            <th className="px-3 py-2">Date</th>
                                            <th className="px-3 py-2 text-right">Amount</th>
                                            <th className="px-3 py-2 text-right">Change</th>
                                            <th className="px-3 py-2">Note</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border">
                                          {snaps.map((s, idx) => {
                                            const prev = snaps[idx + 1];
                                            const delta = prev ? s.value - prev.value : null;
                                            return (
                                              <tr key={s.id} className="hover:bg-surfaceAlt/50">
                                                <td className="whitespace-nowrap px-3 py-2">{formatDate(s.asOfDate)}</td>
                                                <td className={`whitespace-nowrap px-3 py-2 text-right font-medium ${a.isAsset ? 'text-positive' : 'text-negative'}`}>{money(s.value)}</td>
                                                <td className={`whitespace-nowrap px-3 py-2 text-right text-xs ${delta == null ? 'text-muted' : delta >= 0 ? 'text-positive' : 'text-negative'}`}>
                                                  {delta == null ? '—' : `${delta >= 0 ? '+' : ''}${money(delta)}`}
                                                </td>
                                                <td className="max-w-[180px] truncate px-3 py-2 text-xs text-muted">{s.note || '—'}</td>
                                              </tr>
                                            );
                                          })}
                                        </tbody>
                                      </table>
                                    </div>
                                    <p className="mt-2 text-xs text-muted">{snaps.length} {snaps.length === 1 ? 'entry' : 'entries'} — oldest {formatDate(snaps[snaps.length - 1].asOfDate)}</p>
                                  </>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              );
            })
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-surfaceAlt">Previous</button>
              <span className="text-sm text-muted">Page {page} of {totalPages}</span>
              <button disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))} className="rounded-md border border-border px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-surfaceAlt">Next</button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-6 rounded-xl border border-border bg-surface px-5 py-4 text-right shadow-sm">
            <div className="flex items-center gap-2.5">
              <Landmark size={16} className="text-positive" />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Total Assets</p>
                <p className="font-bold text-positive">{money(totals.assets)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <Scale size={16} className="text-negative" />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted">Total Liabilities</p>
                <p className="font-bold text-negative">{money(totals.liabilities)}</p>
              </div>
            </div>
            <div className="border-l border-border pl-6">
              <p className="text-xs uppercase tracking-wide text-muted">Net Worth</p>
              <p className={`text-lg font-bold ${totals.assets - totals.liabilities >= 0 ? 'text-positive' : 'text-negative'}`}>
                {money(totals.assets - totals.liabilities)}
              </p>
            </div>
          </div>
        </>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? `Edit ${editing.name}` : 'Add account'}>
        <AccountForm
          key={editing ? `edit-${editing.id}` : 'new'}
          categories={categories}
          initial={editing}
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
              className="flex w-full items-center justify-center gap-2 rounded-md border border-border py-2 text-sm font-medium text-muted transition-colors hover:bg-surfaceAlt"
            >
              <Archive size={14} />
              {editing.archived ? 'Restore account' : 'Archive account'}
            </button>
            <button
              onClick={() => setConfirmDelete(editing)}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-negative/40 py-2 text-sm font-medium text-negative transition-colors hover:bg-negative/10"
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
        <div className="flex gap-3">
          <button onClick={() => setConfirmDelete(null)} className="flex-1 rounded-md border border-border py-2 text-sm font-medium transition-colors hover:bg-surfaceAlt">
            Cancel
          </button>
          <button onClick={handleDelete} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-negative py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50">
            <Trash2 size={14} />
            Delete forever
          </button>
        </div>
      </Modal>
    </div>
  );
}
