import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  UserPlus,
  AtSign,
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
  Sparkles,
  RefreshCw,
  Rows3,
  Type,
  Squircle,
  MousePointer2,
  Gauge,
} from 'lucide-react';
import api from '../api/client.js';
import { isDemoSession } from '../api/client.js';
import Card from '../components/Card.jsx';
import Modal from '../components/Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme, THEME_META } from '../context/ThemeContext.jsx';
import { useNavPosition } from '../context/NavContext.jsx';
import { useMotion } from '../context/MotionContext.jsx';
import { useAutoRefresh } from '../context/AutoRefreshContext.jsx';
import { useDashboardPrefs, useDensity } from '../context/DashboardPrefsContext.jsx';
import { useUIPrefs } from '../context/UIPrefsContext.jsx';
import { inputCls, labelCls, errorCls, btnPrimary, btnOutline, btnCancel, btnDanger } from '../styles.js';

function UsersAdmin() {
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ username: '', displayName: '', password: '', role: 'member' });
  const [error, setError] = useState('');
  const { user: me, refreshUser } = useAuth();

  // Modal states replacing native prompt()/confirm()
  const [pwTarget, setPwTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [renameTarget, setRenameTarget] = useState(null);
  const [newUsername, setNewUsername] = useState('');
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

  const submitRename = async (e) => {
    e.preventDefault();
    try {
      const { data } = await api.patch(`/users/${renameTarget.id}`, { username: newUsername.trim() });
      setNotice({ type: 'success', text: `Login name changed to @${data.user.username}.` });
      setRenameTarget(null);
      loadUsers();
      // Renaming yourself changes the session identity shown in the header.
      if (renameTarget.id === me.id) {
        try { await refreshUser(); } catch {}
      }
    } catch (err) {
      flashError(err, 'Failed to rename user');
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
              <button onClick={() => { setRenameTarget(u); setNewUsername(u.username); }} className="rounded-md px-2 py-1 text-muted transition-colors hover:bg-surfaceAlt hover:text-text">Rename login</button>
              <button onClick={() => { setPwTarget(u); setNewPassword(''); }} className="rounded-md px-2 py-1 text-muted transition-colors hover:bg-surfaceAlt hover:text-text">Reset password</button>
              <button onClick={() => toggleRole(u)} disabled={u.id === me.id} className="rounded-md px-2 py-1 text-muted transition-colors hover:bg-surfaceAlt hover:text-text disabled:opacity-50">
                Make {u.role === 'admin' ? 'member' : 'admin'}
              </button>
              <button onClick={() => setDeleteTarget(u)} disabled={u.id === me.id} aria-label={`Delete ${u.username}`} title="Delete user" className="rounded-md px-2 py-1 text-negative transition-colors hover:bg-negative/10 disabled:opacity-50">
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={addUser} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4">
        <div>
          <label className={labelCls} htmlFor="nu-user">Username</label>
          <input id="nu-user" required value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="nu-name">Display name</label>
          <input id="nu-name" value={form.displayName} onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))} className={inputCls} />
        </div>
        <div>
          <label className={labelCls} htmlFor="nu-pass">Password</label>
          <input id="nu-pass" type="password" required minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className={inputCls} />
        </div>
        <div className="flex items-center gap-2">
          <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className={inputCls}>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" className={`${btnPrimary} whitespace-nowrap`}>
            <UserPlus size={14} />
            Add
          </button>
        </div>
      </form>
      {error && <p className={`${errorCls} mt-3`}>{error}</p>}

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
            <label htmlFor="rp-pass" className={labelCls}>New password</label>
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
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setPwTarget(null)} className={btnCancel}>
              Cancel
            </button>
            <button type="submit" className={btnPrimary}>
              <KeyRound size={14} />
              Update password
            </button>
          </div>
        </form>
      </Modal>

      {/* Rename login modal */}
      <Modal open={!!renameTarget} onClose={() => setRenameTarget(null)} title={`Rename login — @${renameTarget?.username ?? ''}`}>
        <form onSubmit={submitRename} className="space-y-4">
          <p className="text-sm text-muted">
            The new name takes effect on the next sign-in (3-32 characters: letters, numbers,
            _ . -). The user stays signed in on this device.
          </p>
          <div>
            <label htmlFor="rn-user" className={labelCls}>New login name</label>
            <input
              id="rn-user"
              required
              minLength={3}
              maxLength={32}
              autoFocus
              autoComplete="username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setRenameTarget(null)} className={btnCancel}>
              Cancel
            </button>
            <button type="submit" className={btnPrimary}>
              <AtSign size={14} />
              Rename login
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
        <div className="flex justify-end gap-2">
          <button onClick={() => setDeleteTarget(null)} className={btnCancel}>
            Cancel
          </button>
          <button onClick={removeUser} className={btnDanger}>
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
  return (
    <Card title="Appearance" icon={Palette}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {Object.entries(THEME_META).map(([key, meta]) => {
          const active = theme === key;
          return (
            <button
              key={key}
              onClick={() => setTheme(key)}
              data-theme={key}
              aria-pressed={active}
              title={`${meta.label} — ${meta.type}`}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors ${
                active
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-muted hover:bg-surfaceAlt'
              }`}
            >
              <span className="flex shrink-0 gap-0.5">
                {meta.swatches.map((c) => (
                  <span key={c} className="h-3 w-3 rounded-full border border-border" style={{ background: c }} title={c} />
                ))}
              </span>
              <span className={`flex-1 truncate text-xs font-semibold ${active ? 'text-primary' : 'text-text'}`}>
                {meta.label}
              </span>
              {active && <CheckCircle2 size={13} className="shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted">Each chip previews its theme live. Your choice syncs to your profile and persists across devices.</p>
    </Card>
  );
}

function DensitySettings() {
  const { compactView, setCompactView } = useDashboardPrefs();

  return (
    <Card title="Interface density" icon={Rows3}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
        {[
          { value: false, label: 'Comfortable', hint: 'Roomy cards and larger numbers everywhere in the app' },
          { value: true, label: 'Compact', hint: 'Dense layout showing more information per screen' },
        ].map((opt) => (
          <button
            key={String(opt.value)}
            onClick={() => setCompactView(opt.value)}
            aria-pressed={compactView === opt.value}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              compactView === opt.value ? 'border-primary bg-surfaceAlt' : 'border-border hover:border-muted'
            }`}
          >
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="mt-0.5 text-xs text-muted">{opt.hint}</p>
            {compactView === opt.value && <p className="mt-1 text-xs font-medium text-primary">Active</p>}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">Controls spacing and sizing across the whole app. Saved on this device and applied immediately.</p>
    </Card>
  );
}

function TextScaleSettings() {
  const { textScale, setTextScale } = useUIPrefs();

  return (
    <Card title="Text and UI scale" icon={Type}>
      <div className="flex items-center gap-4 lg:max-w-xl">
        <span aria-hidden className="select-none text-lg leading-none text-muted">A</span>
        <input
          id="ui-scale"
          type="range"
          min={0.9}
          max={1.15}
          step={0.05}
          value={textScale}
          onChange={(e) => setTextScale(Number(e.target.value))}
          aria-label="Text and UI scale"
          aria-valuetext={`${Math.round(textScale * 100)} percent`}
          className="flex-1 accent-[var(--color-primary)]"
        />
        <span aria-hidden className="select-none text-3xl leading-none">A</span>
        <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums">
          {Math.round(textScale * 100)}%
        </span>
      </div>
      <p className="mt-1 flex justify-between text-xs text-muted lg:max-w-xl">
        <span>Tighter</span>
        <span>Larger</span>
      </p>
      <button onClick={() => setTextScale(1)} className={`${btnOutline} mt-3`}>
        Reset to 100%
      </button>
      <p className="mt-3 text-xs text-muted">
        Scales every text size, card padding and input across the app. Applies immediately, on top
        of your interface-density choice and OS text size. Saved on this device.
      </p>
    </Card>
  );
}

function CornerRadiusSettings() {
  const { radius, setRadius } = useUIPrefs();

  const options = [
    { value: 'sharp', label: 'Sharp', hint: 'Compact, angular cards and corners', preview: 4 },
    { value: 'standard', label: 'Standard', hint: 'The default corner rounding', preview: 8 },
    { value: 'rounded', label: 'Rounded', hint: 'Softer, more organic shapes', preview: 16 },
  ];

  return (
    <Card title="Corner radius" icon={Squircle}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:max-w-xl">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setRadius(opt.value)}
            aria-pressed={radius === opt.value}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              radius === opt.value ? 'border-primary bg-surfaceAlt' : 'border-border hover:border-muted'
            }`}
          >
            <span
              aria-hidden
              className="mb-3 block h-8 w-16 border border-border bg-primary/10"
              style={{ borderRadius: opt.preview }}
            />
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="mt-0.5 text-xs text-muted">{opt.hint}</p>
            {radius === opt.value && <p className="mt-1 text-xs font-medium text-primary">Active</p>}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Rounds cards, buttons, inputs and menus across the app. Applied instantly and saved on this
        device.
      </p>
    </Card>
  );
}

function HoverEffectsSettings() {
  const { hover, setHover } = useUIPrefs();

  const options = [
    { value: true, label: 'Animated hovers', hint: 'Cards lift, icons grow and colors glide as you hover' },
    { value: false, label: 'Calm UI', hint: 'Hover and press effects are static — fewer moving details' },
  ];

  return (
    <Card title="Hover effects" icon={MousePointer2}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
        {options.map((opt) => (
          <button
            key={String(opt.value)}
            onClick={() => setHover(opt.value)}
            aria-pressed={hover === opt.value}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              hover === opt.value ? 'border-primary bg-surfaceAlt' : 'border-border hover:border-muted'
            }`}
          >
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="mt-0.5 text-xs text-muted">{opt.hint}</p>
            {hover === opt.value && <p className="mt-1 text-xs font-medium text-primary">Active</p>}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        A master switch for hover micro-interactions (lift, grow, press and color glides). Color
        feedback still snaps so links and buttons stay discoverable. Saved on this device.
      </p>
    </Card>
  );
}

function AutoRefreshSettings() {
  const { enabled, setAutoRefreshEnabled, intervalSeconds, setAutoRefreshInterval, options } = useAutoRefresh();

  return (
    <Card title="Auto-refresh" icon={RefreshCw}>
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          id="ar-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
          className="h-4 w-4 accent-[var(--color-primary)]"
        />
        <span>
          <span className="block text-sm font-medium">Enable auto-refresh</span>
          <span className="block text-xs text-muted">
            Turns the auto-refresh loop on the Accounts page and the Auto-update on each
            account&rsquo;s holdings table on or off.
          </span>
        </span>
      </label>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:max-w-[240px]">
          <label className={labelCls} htmlFor="ar-interval">
            Refresh live prices every
          </label>
          <select
            id="ar-interval"
            value={intervalSeconds}
            disabled={!enabled}
            onChange={(e) => setAutoRefreshInterval(Number(e.target.value))}
            className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {options.map((o) => (
              <option key={o.seconds} value={o.seconds}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        Cadence range is 30 seconds to 5 minutes. Saved on this device; this toggle is the same
        switch shown on the Accounts page and account holdings header.
      </p>
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

function MotionSettings() {
  const { motionPref, setMotionPref, resolved, speed, setSpeed } = useMotion();
  const [previewKey, setPreviewKey] = useState(0);

  const options = [
    { value: 'auto', label: 'Auto', hint: 'Follows your device’s reduce-motion setting' },
    { value: 'on', label: 'Always on', hint: 'Page transitions, pops and slides everywhere' },
    { value: 'off', label: 'Always off', hint: 'Content appears instantly, no animation' },
  ];

  const speedOptions = [
    { value: 'slow', label: 'Relaxed', hint: 'Long, gentle transitions' },
    { value: 'normal', label: 'Standard', hint: 'The default timing' },
    { value: 'fast', label: 'Faster', hint: 'Snappy and business-like' },
  ];

  return (
    <Card title="Motion" icon={Sparkles}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:max-w-2xl">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setMotionPref(opt.value)}
            aria-pressed={motionPref === opt.value}
            className={`rounded-lg border-2 p-4 text-left transition-colors ${
              motionPref === opt.value ? 'border-primary bg-surfaceAlt' : 'border-border hover:border-muted'
            }`}
          >
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="mt-0.5 text-xs text-muted">{opt.hint}</p>
            {motionPref === opt.value && <p className="mt-1 text-xs font-medium text-primary">Active</p>}
          </button>
        ))}
      </div>
      <div className={`mt-5 border-t border-border pt-4 ${resolved === 'off' ? 'opacity-60' : ''}`}>
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Gauge size={14} />
          Animation speed
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:max-w-2xl">
          {speedOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSpeed(opt.value)}
              disabled={resolved === 'off'}
              aria-pressed={speed === opt.value}
              title={resolved === 'off' ? 'Enable animations to change speed' : undefined}
              className={`rounded-lg border-2 p-4 text-left transition-colors disabled:cursor-not-allowed ${
                speed === opt.value ? 'border-primary bg-surfaceAlt' : 'border-border hover:border-muted'
              }`}
            >
              <p className="text-sm font-medium">{opt.label}</p>
              <p className="mt-0.5 text-xs text-muted">{opt.hint}</p>
              {speed === opt.value && <p className="mt-1 text-xs font-medium text-primary">Active</p>}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          {resolved === 'off'
            ? 'Speed applies once animations are enabled.'
            : 'Adjusts transitions, entrances and the animation speed of charts and count-ups on every page.'}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => setPreviewKey((k) => k + 1)} className={btnOutline}>
          <Sparkles size={14} /> Replay preview
        </button>
        <div
          key={previewKey}
          className="anim-pop flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-medium text-primary"
        >
          <Sparkles size={13} />
          Sample element animates in
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">
        {resolved === 'on'
          ? 'Animations are currently enabled.'
          : 'Animations are currently disabled.'}{' '}
        Controls page transitions, modal and menu entrances, and toast slides. Saved on this device.
      </p>
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
        <p className={`${errorCls} mb-4`}>{statsError}</p>
      ) : (
        <p className="mb-4 text-xs text-muted">Loading export preview…</p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => download('json')}
          disabled={!!downloading}
          className={btnPrimary}
          title="JSON includes accounts + nested historic snapshots per account + flat snapshots — full restore"
        >
          <Download size={15} />
          {downloading === 'json' ? 'Preparing…' : 'Download JSON (with history)'}
        </button>
        <button
          onClick={() => download('csv')}
          disabled={!!downloading}
          className={btnOutline}
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
          <label htmlFor="import-file" className={labelCls}>
            Select file to import
          </label>
          <input
            id="import-file"
            type="file"
            accept=".json,.csv"
            onChange={handleFileChange}
            className={`${inputCls}`}
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
                  {(uploadResult.data.holdingsCreated > 0 || uploadResult.data.incomeAdded > 0) &&
                    ` · ${uploadResult.data.holdingsCreated || 0} holdings, ${uploadResult.data.incomeAdded || 0} income entries restored`}
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
          className={btnPrimary}
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
              <label htmlFor="reset-password" className={labelCls}>
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
          {error && <p className={errorCls}>{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              disabled={busy}
              className={btnCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || (!demo && !password)}
              className={`${demo ? btnPrimary : btnDanger} whitespace-nowrap`}
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
  const isAdmin = user?.role === 'admin';
  const { page, heading, headerIcon, headerIconSize } = useDensity();

  const tabs = [
    { id: 'appearance', label: 'Appearance', icon: <Palette size={14} />, subtitle: 'Theme, text size, corners and how the interface moves and feels' },
    { id: 'automation', label: 'Automation', icon: <RefreshCw size={14} />, subtitle: 'Live pricing cadence for brokerage and retirement accounts' },
    { id: 'data', label: 'Data', icon: <FileJson size={14} />, subtitle: 'Back up, restore and move your portfolio data' },
    ...(isAdmin
      ? [{ id: 'admin', label: 'Administration', icon: <ShieldCheck size={14} />, subtitle: demo ? 'Demo environment controls' : 'Users and database-wide actions (admins only)' }]
      : []),
  ];

  const [activeTab, setActiveTab] = useState(tabs[0].id);

  return (
    <div className={page}>
      <header className="flex items-center gap-2.5">
        <span className={`flex ${headerIcon} items-center justify-center rounded-lg bg-primary/10 text-primary`}>
          <PanelsTopLeft size={headerIconSize} />
        </span>
        <h2 className={`${heading} font-bold`}>Settings</h2>
        <span className="text-sm text-muted">— signed in as {user?.displayName || user?.username} ({user?.role})</span>
      </header>

      <div role="tablist" className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surfaceAlt/60 p-1 shadow-sm">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={activeTab === t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
              activeTab === t.id
                ? 'bg-primary text-onPrimary shadow-sm'
                : 'text-muted hover:bg-surface hover:text-text'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {tabs.find((t) => t.id === activeTab)?.subtitle && (
        <p className="-mt-3 text-xs text-muted">{tabs.find((t) => t.id === activeTab).subtitle}</p>
      )}

      <div role="tabpanel" className={page}>
        {activeTab === 'appearance' && (
          <>
            <Appearance />
            <TextScaleSettings />
            <CornerRadiusSettings />
            <HoverEffectsSettings />
            <DensitySettings />
            <NavigationLayout />
            <MotionSettings />
          </>
        )}
        {activeTab === 'automation' && <AutoRefreshSettings />}
        {activeTab === 'data' && (
          <>
            <DataManagement />
            <ImportData />
          </>
        )}
        {activeTab === 'admin' && (
          <>
            {!demo && <UsersAdmin />}
            <ResetData />
          </>
        )}
      </div>
    </div>
  );
}
