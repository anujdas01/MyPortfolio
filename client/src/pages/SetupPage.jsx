import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, KeyRound, Wallet, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';

const inputCls =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

export default function SetupPage() {
  const { setup } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '', confirm: '', displayName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) {
      setError('Passwords do not match');
      return;
    }
    setBusy(true);
    try {
      await setup(form.username, form.password, form.displayName);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Setup failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-surface p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-white shadow-md">
            <Wallet size={26} strokeWidth={2} />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-primary">MyPortfolio</h1>
          <p className="text-sm text-muted">Create the household admin account</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
              Display name
            </label>
            <div className="relative">
              <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="displayName"
                value={form.displayName}
                onChange={set('displayName')}
                placeholder="e.g. Anuj"
                className={`${inputCls} pl-9`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium">
              Username
            </label>
            <div className="relative">
              <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="username"
                autoComplete="username"
                required
                value={form.username}
                onChange={set('username')}
                className={`${inputCls} pl-9`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Password <span className="font-normal text-muted">(min 8 characters)</span>
            </label>
            <div className="relative">
              <ShieldCheck size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={form.password}
                onChange={set('password')}
                className={`${inputCls} pl-9`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="confirm" className="mb-1 block text-sm font-medium">
              Confirm password
            </label>
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              required
              value={form.confirm}
              onChange={set('confirm')}
              className={inputCls}
            />
          </div>

          {error && <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create admin account'}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted">
          Already set up?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
