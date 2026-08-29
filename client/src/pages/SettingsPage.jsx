import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  KeyRound,
  ShieldCheck,
  Trash2,
  Palette,
  PanelsTopLeft,
  Download,
  FileJson,
  FileSpreadsheet,
  Upload,
  TriangleAlert,
  AlertCircle,
  CheckCircle2,
  Beaker,
} from 'lucide-react';
import api from '../api/client.js';
import { isDemoSession } from '../api/client.js';
import Card from '../components/Card.jsx';
import Modal from '../components/Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme, THEME_META } from '../context/ThemeContext.jsx';
import { useNavPosition } from '../context/NavContext.jsx';

const inputCls =
  'w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none';

function UsersAdmin() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'member' });
  const [error, setError] = useState('');
  const { user: me } = useAuth();

  // Modal states replacing native prompt()/confirm()
  const [pwTarget, setPwTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [notice, setNotice] = useState(null); // { type: 'success'|'error', text }

  const loadUsers = useCallback(() => {
    api.get('/users').then((r) => setUsers(r.data.users)).catch(() => {});
  }, []);

  useEffect(loadUsers, [loadUsers]);

  const flashError = (err, fallback) => setNotice({ type: 'error', text: err.response?.data?.error || fallback });

  const addUser = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/users', form);
      setForm({ username: '', displayName: '', password: '', role: 'member' });
      loadUsers();
      setNotice({ type: 'success', text: `User @${form.username} created.` });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create user');
    }
  };

  const submitPasswordReset = async (e) => {
    e.preventDefault();
    try {
      await api.patch(`/users/${pwTarget.id}`, { password: newPassword });
      setNotice({ type: 'success', text: `Password updated for @${pwTarget.username}.` });
      setPwTarget(null);
    } catch (err) {
      flashError(err, 'Failed to reset password');
    }
  };

  const toggleRole = async (u) => {
    try {
      await api.patch(`/users/${u.id}`, { role: u.role === 'admin' ? 'member' : 'admin' });
      loadUsers();
    } catch (err) {
      flashError(err, 'Failed');
    }
  };

  const removeUser = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/users/${deleteTarget.id}`);
      loadUsers();
      setNotice({ type: 'success', text: `User @${deleteTarget.username} deleted.` });
    } catch (err) {
      flashError(err, 'Failed');
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <Card title="Household members" icon={Users}>
      <ul className="mb-5 divide-y divide-border">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
            <div>
              <p className="font-medium">
                {u.displayName || u.username}
                {u.id === me.id && <span className="ml-2 text-xs text-muted">(you)</span>}
              </p>
              <p className="flex items-center gap-1 text-xs text-muted">
                @{u.username} ·{' '}
                <span className={`inline-flex items-center gap-1 ${u.role === 'admin' ? 'text-accent' : ''}`}>
                  {u.role === 'admin' && <ShieldCheck size={12} />}
                  {u.role}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1 text-sm">
              <button onClick={() => { setPwTarget(u); setNewPassword(''); }} className="rounded-md px-2 py-1 text-muted transition-colors hover:bg-surfaceAlt hover:text-text">Reset password</button>
              <button onClick={() => toggleRole(u)} disabled={u.id === me.id} className="rounded-md px-2 py-1 text-muted transition-colors hover:bg-surfaceAlt hover:text-text disabled:opacity-40">
                Make {u.role === 'admin' ? 'member' : 'admin'}
              </button>
              <button onClick={() => setDeleteTarget(u)} disabled={u.id === me.id} aria-label={`Delete ${u.username}`} className="rounded-md px-2 py-1 text-negative transition-colors hover:bg-negative/10 disabled:opacity-40">
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={addUser} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="nu-user">Username</label>
          <input id="nu-user" required value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="nu-name">Display name</label>
          <input id="nu-name" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium" htmlFor="nu-pass">Password</label>
          <input id="nu-pass" type="password" required minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className={inputCls} />
        </div>
        <div className="flex items-center gap-2">
          <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className={inputCls}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" className="flex items-center gap-1.5 whitespace-nowrap rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
            <UserPlus size={14} />
            Add
          </button>
        </div>
      </form>
      {error && <p className="mt-3 rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

      {notice && (
        <p className={`mt-3 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'}`}>
          {notice.type === 'success' ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {notice.text}
        </p>
      )}

      {/* Reset password modal */}
      <Modal open={!!pwTarget} onClose={() => setPwTarget(null)} title={`Reset password — @${pwTarget?.username ?? ''}`}>
        <form onSubmit={submitPasswordReset} className="space-y-4">
          <p className="text-sm text-muted">
            Choose a new password of at least 8 characters. The user will stay signed in on this
            device until their session refreshes.
          </p>
          <div>
            <label htmlFor="rp-pass" className="mb-1 block text-sm font-medium">New password</label>
            <input
              id="rp-pass"
              type="password"
              required
              minLength={8}
              autoFocus
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={() => setPwTarget(null)} className="flex-1 rounded-md border border-border py-2 text-sm font-medium transition-colors hover:bg-surfaceAlt">
              Cancel
            </button>
            <button type="submit" className="flex flex-1 items-center justify-center gap-2 rounded-md bg-primary py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
              <KeyRound size={14} />
              Update password
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete user confirmation */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete user?">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-negative/10 text-negative">
            <AlertCircle size={20} />
          </span>
          <p className="text-sm text-muted">
            This removes <strong>@{deleteTarget?.username}</strong>'s access to the household
            dashboard. Portfolio data itself is not deleted.
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => setDeleteTarget(null)} className="flex-1 rounded-md border border-border py-2 text-sm font-medium transition-colors hover:bg-surfaceAlt">
            Cancel
          </button>
          <button onClick={removeUser} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-negative py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
            <Trash2 size={14} />
            Delete user
          </button>
        </div>
      </Modal>
    </Card>
  );
}

function Appearance() {
  const { theme, setTheme } = useTheme();
  const themeType = (key) => {
    if (['light', 'sepia'].includes(key)) return 'Light';
    if (key === 'contrast') return 'High contrast';
    return 'Dark';
  };
  return (
    <Card title="Appearance" icon={Palette}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {Object.entries(THEME_META).map(([key, meta]) => {
          const active = theme === key;
          // Each preview is isolated with its own data-theme so you see the actual palette live
          return (
            <button
              key={key}
              onClick={() => setTheme(key)}
              data-theme={key}
              className={`group overflow-hidden rounded-xl border-2 bg-bg text-left transition-all ${
                active ? 'border-primary shadow-md ring-1 ring-primary/20' : 'border-border hover:border-primary/40 hover:shadow-sm'
              }`}
            >
              <div className="bg-bg p-2.5">
                <div className="mb-2 flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                  <span className="h-1.5 w-8 rounded-full bg-border" />
                  <span className="ml-auto flex gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                    <span className="h-1.5 w-1.5 rounded-full bg-negative" />
                  </span>
                </div>
                <div className="flex gap-2">
                  <div className="flex h-12 w-12 shrink-0 flex-col gap-1 rounded-md border border-border bg-surface p-1.5">
                    <span className="h-1.5 w-6 rounded-full bg-primary" />
                    <span className="h-1 w-8 rounded-full bg-border" />
                    <span className="h-1 w-6 rounded-full bg-border" />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <div className="h-6 rounded-md border border-border bg-surface p-1.5">
                      <div className="h-1 w-10 rounded-full bg-muted/60" />
                    </div>
                    <div className="h-6 rounded-md border border-border bg-surfaceAlt p-1.5">
                      <div className="h-1 w-12 rounded-full bg-primary/60" />
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex h-6 border-y border-border">
                {meta.swatches.map((c) => (
                  <span key={c} style={{ backgroundColor: c }} className="flex-1" title={c} />
                ))}
              </div>
              <div className="bg-surface px-3 py-2.5">
                <p className="flex items-center justify-between text-sm font-semibold text-text">
                  {meta.label}
                  {active && <CheckCircle2 size={14} className="text-primary" />}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                  <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${active ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-surfaceAlt text-muted'}`}>
                    {themeType(key)}
                  </span>
                  {active ? 'Active' : 'Click to apply'}
                </p>
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">Preview is live — each tile shows that theme’s actual colors. Your choice syncs to your profile and persists across devices.</p>
    </Card>
  );
}

function NavigationLayout() {
  const { navPosition, setNavPosition } = useNavPosition();

  const options = [
    {
      value: 'top',
      label: 'Top bar',
      hint: 'Horizontal menu across the top of the page',
    },
    {
      value: 'left',
      label: 'Left sidebar',
      hint: 'Vertical menu fixed to the left side',
    },
  ];

  return (
    <Card title="Main menu" icon={PanelsTopLeft}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setNavPosition(opt.value)}
            aria-pressed={navPosition === opt.value}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              navPosition === opt.value ? 'border-primary bg-surfaceAlt' : 'border-border hover:border-muted'
            }`}
          >
            {opt.value === 'top' ? (
              <div className="mb-3 rounded-md border border-border bg-surface p-1.5">
                <div className="mb-1 h-2 w-10 rounded-full bg-primary" />
                <div className="flex gap-1">
                  <span className="h-1.5 w-6 rounded-full bg-primary/60" />
                  <span className="h-1.5 w-6 rounded-full bg-primary/40" />
                  <span className="h-1.5 w-6 rounded-full bg-primary/25" />
                </div>
              </div>
            ) : (
              <div className="mb-3 flex h-[38px] gap-1.5">
                <div className="w-8 shrink-0 rounded-md border border-border bg-surface p-1">
                  <div className="h-1 w-4 rounded-full bg-primary" />
                  <div className="mt-1 h-1 w-4 rounded-full bg-primary/40" />
                  <div className="mt-1 h-1 w-4 rounded-full bg-primary/25" />
                </div>
                <div className="flex-1 rounded-md border border-border bg-surfaceAlt" />
              </div>
            )}
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="mt-0.5 text-xs text-muted">{opt.hint}</p>
            {navPosition === opt.value && <p className="mt-1 text-xs font-medium text-primary">Active</p>}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Saved automatically on this device and applied instantly.</p>
    </Card>
  );
}

function DataManagement() {
  const [downloading, setDownloading] = useState('');
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/export', { params: { format: 'json' } }).then((r) => {
      if (cancelled) return;
      const d = r.data;
      const s = d.summary || { totalAccounts: d.accounts?.length ?? 0, totalSnapshots: d.snapshots?.length ?? 0, dateRange: d.history?.perAccount ? null : null };
      const range = s.dateRange || (d.history ? { from: d.history.perAccount?.[0]?.firstDate ?? null, to: null } : null);
      // Derive range from perAccount if summary missing
      const allDates = d.snapshots?.map((x) => x.as_of_date || x.asOfDate).filter(Boolean).sort() || [];
      const from = s.dateRange?.from ?? allDates[0] ?? null;
      const to = s.dateRange?.to ?? allDates[allDates.length - 1] ?? null;
      setStats({ totalAccounts: s.totalAccounts ?? d.accounts?.length ?? 0, totalSnapshots: s.totalSnapshots ?? d.snapshots?.length ?? 0, from, to, perAccount: d.history?.perAccount || [] });
    }).catch((e) => { if (!cancelled) setStatsError(e.response?.data?.error || 'Could not load stats'); });
    return () => { cancelled = true; };
  }, []);

  const download = async (format) => {
    setDownloading(format);
    try {
      const res = await api.get('/export', { params: { format }, responseType: 'blob' });
      const stamp = new Date().toISOString().slice(0, 10);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `myportfolio-export-${stamp}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading('');
    }
  };

  return (
    <Card title="Data backup" icon={FileJson}>
      <p className="mb-3 text-sm text-muted">
        All data lives in a single SQLite file on this PC (<code>server/data/portfolio.db</code>). Exports now <strong>always include full history</strong> — every historic balance per account.
      </p>
      {stats ? (
        <div className="mb-4 rounded-lg border border-border bg-surfaceAlt/40 px-4 py-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              <FileJson size={12} /> {stats.totalAccounts} accounts
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-positive/10 px-2.5 py-1 text-xs font-semibold text-positive">
              <Upload size={12} /> {stats.totalSnapshots} historic entries
            </span>
            {stats.from && (
              <span className="text-xs text-muted">
                from {stats.from} → {stats.to || 'today'} — one row per historic amount
              </span>
            )}
          </p>
          {stats.perAccount?.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              Per-account history: {stats.perAccount.slice(0,3).map((a)=> `${a.name} (${a.snapshotsCount})`).join(' · ')}{stats.perAccount.length > 3 ? ` + ${stats.perAccount.length - 3} more` : ''}
            </p>
          )}
        </div>
      ) : statsError ? (
        <p className="mb-4 rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{statsError}</p>
      ) : (
        <p className="mb-4 text-xs text-muted">Loading export preview…</p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => download('json')}
          disabled={!!downloading}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          title="JSON includes accounts + nested historic snapshots per account + flat snapshots — full restore"
        >
          <Download size={15} />
          {downloading === 'json' ? 'Preparing…' : 'Download JSON (with history)'}
        </button>
        <button
          onClick={() => download('csv')}
          disabled={!!downloading}
          className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-surfaceAlt disabled:opacity-50"
          title="CSV — one row per historic amount: date, account, value + institution/category/kind"
        >
          <FileSpreadsheet size={15} />
          {downloading === 'csv' ? 'Preparing…' : 'Download CSV (historic rows)'}
        </button>
      </div>
      <p className="mt-3 text-xs text-muted">
        JSON: <code>accountsWithHistory[].snapshots[]</code> + <code>snapshots[]</code> + <code>history.perAccount[]</code> — every historic amount per account is preserved and re-importable. CSV: <code>date,account,institution,category,kind,type,value,note,snapshotId,createdAt,accountId,archived</code> — one row per historic entry, readable in Sheets/Excel (original 8 columns unchanged, historic extras appended).
      </p>
    </Card>
  );
}

function ImportData() {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      if (f.size > 10 * 1024 * 1024) {
        setUploadResult({ success:false, error: 'File is too large (max 10 MB)' });
        setFile(null);
        e.target.value='';
        return;
      }
      setFile(f);
      setUploadResult(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setUploadResult(null);

    try {
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      const content = await file.text();
      if (!content.trim()) throw new Error('File is empty');
      if (content.length > 10*1024*1024) throw new Error('File is too large');
      // quick JSON pre-check
      if (!isCsv) { try { const j=JSON.parse(content); if (!Array.isArray(j.accounts)) throw new Error('JSON must contain an "accounts" array'); } catch(err){ throw new Error(err.message.includes('accounts')? err.message : 'File is not valid JSON'); } }
      const response = await api.post('/accounts/import', { format: isCsv ? 'csv' : 'json', content });

      setUploadResult({
        success: true,
        data: response.data,
      });
    } catch (error) {
      setUploadResult({
        success: false,
        error: error.response?.data?.error || 'Failed to import file',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card title="Import data" icon={Upload}>
      <p className="mb-4 text-sm text-muted">
        Import previously exported CSV or JSON files. This will add new accounts and balances.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="import-file" className="block text-sm font-medium mb-1">
            Select file to import
          </label>
          <input
            id="import-file"
            type="file"
            accept=".json,.csv"
            onChange={handleFileChange}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 focus:border-primary focus:outline-none"
          />
        </div>

        {uploadResult && (
          <div className={`rounded-lg p-4 ${uploadResult.success ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative'}`}>
            {uploadResult.success ? (
              <>
                <p className="flex items-center gap-2 font-medium">
                  <CheckCircle2 size={16} /> Import successful!
                </p>
                <p>
                  {uploadResult.data.accountsCreated} accounts created · {uploadResult.data.snapshotsAdded} balance
                  entries added
                  {uploadResult.data.snapshotsSkipped > 0 &&
                    ` · ${uploadResult.data.snapshotsSkipped} invalid rows skipped`}
                </p>
              </>
            ) : (
              <p className="flex items-center gap-2">
                <AlertCircle size={16} /> Failed to import: {uploadResult.error}
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={!file || isUploading}
          className={`flex w-full items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold ${
            !file || isUploading
              ? 'border border-border bg-surface text-muted'
              : 'bg-primary text-white transition-opacity hover:opacity-90'
          }`}
        >
          <Upload size={15} />
          {isUploading ? 'Importing...' : 'Import file'}
        </button>
      </form>
    </Card>
  );
}

function ResetData() {
  const demo = isDemoSession();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  const openModal = () => {
    setPassword('');
    setError('');
    setConfirmOpen(true);
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/settings/reset-data', demo ? {} : { password });
      setResult(r.data);
      setConfirmOpen(false);
      setPassword('');
    } catch (err) {
      setError(err.response?.data?.error || 'Reset failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={demo ? 'Reset demo data' : 'Danger zone'} icon={demo ? Beaker : TriangleAlert}>
      {demo ? (
        <p className="mb-4 text-sm text-muted">
          Restore the sample showcase data. Any changes you made while exploring — new accounts,
          balance updates, imports — will be discarded.
        </p>
      ) : (
        <p className="mb-4 text-sm text-muted">
          Resetting removes <strong>all accounts and balance history</strong> and restores the default
          categories. Household users are kept. This cannot be undone — export a backup first if you
          might need the data later.
        </p>
      )}

      {result && (
        <div className="mb-4 rounded-lg bg-positive/10 p-4 text-positive">
          <p className="font-medium">{result.reseeded ? 'Sample data restored.' : 'Database reset complete.'}</p>
          <p className="text-sm">
            Removed {result.deletedAccounts} accounts and {result.deletedSnapshots} balance entries.
          </p>
        </div>
      )}

      <button
        onClick={openModal}
        className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors ${
          demo
            ? 'border border-border text-text hover:bg-surfaceAlt'
            : 'border border-negative/40 text-negative hover:bg-negative/10'
        }`}
      >
        <Trash2 size={15} />
        {demo ? 'Restore sample data…' : 'Reset database…'}
      </button>

      <Modal open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} title={demo ? 'Restore sample data' : 'Confirm reset'}>
        <form onSubmit={handleReset} className="space-y-4">
          <p className="text-sm text-muted">
            {demo ? (
              <>
                This discards your changes and brings back the original demo accounts and balances.
              </>
            ) : (
              <>
                This permanently deletes every account and balance entry. To confirm, enter your admin
                password.
              </>
            )}
          </p>
          {!demo && (
            <div>
              <label htmlFor="reset-password" className="mb-1 block text-sm font-medium">
                Admin password
              </label>
              <input
                id="reset-password"
                type="password"
                required
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputCls}
              />
            </div>
          )}
          {error && <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
              className="flex-1 rounded-md border border-border py-2 text-sm font-medium transition-colors disabled:opacity-50 hover:bg-surfaceAlt"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || (!demo && !password)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-50 ${
                demo ? 'bg-primary hover:opacity-90' : 'bg-negative hover:opacity-90'
              }`}
            >
              <Trash2 size={14} />
              {busy ? 'Working…' : demo ? 'Restore' : 'Delete everything'}
            </button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const demo = isDemoSession();
  return (
    <div className="space-y-6">
      <header className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <PanelsTopLeft size={17} />
        </span>
        <h2 className="text-xl font-bold">Settings</h2>
        <span className="text-sm text-muted">— signed in as {user?.displayName || user?.username} ({user?.role})</span>
      </header>
      <Appearance />
      <NavigationLayout />
      {user?.role === 'admin' && !demo && <UsersAdmin />}
      <DataManagement />
      <ImportData />
      {user?.role === 'admin' && <ResetData />}
    </div>
  );
}
