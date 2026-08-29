import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  Save,
  AlertCircle,
  LineChart,
  Wallet,
} from 'lucide-react';
import api from '../api/client.js';
import Card from '../components/Card.jsx';
import Spinner from '../components/Spinner.jsx';
import Modal, { EmptyState } from '../components/Modal.jsx';
import AccountForm, { kindLabel } from '../components/AccountForm.jsx';
import ValueAreaChart from '../components/charts/ValueAreaChart.jsx';
import { money, formatDate, todayISO } from '../utils/format.js';
import { useThemeColors } from '../components/useThemeColors.js';

export default function AccountDetailPage() {
  const { id } = useParams();
  const { primary } = useThemeColors();
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
  const [editingSnap, setEditingSnap] = useState(null);
  const [editSnapForm, setEditSnapForm] = useState({ value: '', asOfDate: '', note: '' });
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(() => {
    api
      .get(`/accounts/${id}`)
      .then((r) => {
        setAccount(r.data.account);
        setBalanceForm((f) => ({
          ...f,
          value: r.data.account.latestValue !== null && r.data.account.latestValue !== undefined ? String(r.data.account.latestValue) : '',
        }));
      })
      .catch((e) => setError(e.response?.data?.error || 'Account not found'));
    api.get(`/accounts/${id}/snapshots`).then((r) => { setSnapshots(r.data.snapshots); setSnapError(''); }).catch((e) => setSnapError(e.response?.data?.error || 'Failed to load snapshots'));
  }, [id]);

  useEffect(() => {
    load();
    api.get('/accounts/categories').then((r) => setCategories(r.data.categories)).catch(() => {});
  }, [load]);

  const submitBalance = async (e) => {
    e.preventDefault();
    setBalanceError('');
    setBusy(true);
    try {
      await api.post(`/accounts/${id}/snapshots`, {
        value: Number(balanceForm.value),
        asOfDate: balanceForm.asOfDate,
        note: balanceForm.note || undefined,
      });
      setBalanceForm((f) => ({ ...f, note: '' }));
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
  const delta =
    latest && prior ? latest.value - prior.value : null;

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
            {money(latest?.value ?? account.latestValue ?? 0)}
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
        </Card>

        <Card title="Update balance" className="lg:col-span-2">
          <form onSubmit={submitBalance} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_150px_1fr_auto]">
            <div>
              <label htmlFor="bal-value" className="mb-1 block text-sm font-medium">New value ($)</label>
              <input
                id="bal-value"
                type="number"
                step="any"
                required
                value={balanceForm.value}
                onChange={(e) => setBalanceForm((f) => ({ ...f, value: e.target.value }))}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="bal-date" className="mb-1 block text-sm font-medium">Date</label>
              <input
                id="bal-date"
                type="date"
                required
                max={todayISO()}
                value={balanceForm.asOfDate}
                onChange={(e) => setBalanceForm((f) => ({ ...f, asOfDate: e.target.value }))}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none"
              />
            </div>
            <div>
              <label htmlFor="bal-note" className="mb-1 block text-sm font-medium">Note (optional)</label>
              <input
                id="bal-note"
                value={balanceForm.note}
                onChange={(e) => setBalanceForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="e.g. quarterly statement"
                className="w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="flex h-[42px] items-center justify-center gap-2 whitespace-nowrap rounded-md bg-primary px-5 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Save size={15} />
              {busy ? 'Saving…' : 'Save'}
            </button>
          </form>
          {balanceError && <p className="mt-3 rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{balanceError}</p>}
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
            <ValueAreaChart snapshots={snapshots} color={primary} />
            {snapError && <p className="mt-3 rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{snapError}</p>}
            <div className="mt-4 max-h-72 overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surfaceAlt text-left text-xs uppercase tracking-wide text-muted">
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
                    <tr key={s.id}>
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
                          <button onClick={() => startEditSnap(s)} className="rounded p-1 text-muted hover:bg-surfaceAlt hover:text-text" aria-label={`Edit ${formatDate(s.asOfDate)}`} title="Edit"><Pencil size={13} /></button>
                          <button onClick={() => setDeleteTarget(s)} className="rounded p-1 text-muted hover:bg-negative/10 hover:text-negative" aria-label={`Delete ${formatDate(s.asOfDate)}`} title="Delete"><Trash2 size={13} /></button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {balanceError && <p className="mt-3 rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{balanceError}</p>}
          </>
        )}
      </Card>

      <Modal open={!!editingSnap} onClose={() => setEditingSnap(null)} title="Edit balance">
        <form onSubmit={submitEditSnap} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Value ($)</label>
            <input type="number" step="any" required value={editSnapForm.value} onChange={(e) => setEditSnapForm((f) => ({ ...f, value: e.target.value }))} className="w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Date</label>
            <input type="date" required value={editSnapForm.asOfDate} onChange={(e) => setEditSnapForm((f) => ({ ...f, asOfDate: e.target.value }))} className="w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Note</label>
            <input value={editSnapForm.note} onChange={(e) => setEditSnapForm((f) => ({ ...f, note: e.target.value }))} placeholder="optional" className="w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none" />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditingSnap(null)} className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surfaceAlt">Cancel</button>
            <button type="submit" disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete balance">
        <p className="text-sm text-muted">Delete balance of {deleteTarget ? money(deleteTarget.value) : ''} on {deleteTarget ? formatDate(deleteTarget.asOfDate) : ''}? This cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => setDeleteTarget(null)} className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-surfaceAlt">Cancel</button>
          <button onClick={confirmDeleteSnap} disabled={busy} className="rounded-md bg-negative px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">{busy ? 'Deleting…' : 'Delete'}</button>
        </div>
      </Modal>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit ${account.name}`}>
        <AccountForm
          key={`detail-${account.id}-${JSON.stringify(account)}`}
          categories={categories}
          initial={account}
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
