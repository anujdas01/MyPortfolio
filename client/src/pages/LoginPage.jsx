import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Lock, ArrowRight, Wallet, PlayCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import axios from 'axios';

const inputCls =
  'w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

export default function LoginPage() {
  const { login, loginDemo, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    if (user) navigate('/', { replace: true });
    axios
      .get('/api/auth/status')
      .then((r) => setNeedsSetup(r.data.needsSetup))
      .catch(() => {});
  }, [user, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  const enterDemo = async () => {
    setError('');
    setDemoBusy(true);
    try {
      await loginDemo();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not start the demo');
    } finally {
      setDemoBusy(false);
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
          <p className="text-sm text-muted">Household finance tracker</p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1 block text-sm font-medium">
              Username
            </label>
            <div className="relative">
              <User size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className={inputCls}
              />
            </div>
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <Lock size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={inputCls}
              />
            </div>
          </div>

          {error && <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

          <button
            type="submit"
            disabled={busy || demoBusy}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs uppercase tracking-wide text-muted">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          onClick={enterDemo}
          disabled={busy || demoBusy}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-primary/50 py-2.5 font-semibold text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
        >
          <PlayCircle size={17} />
          {demoBusy ? 'Preparing demo…' : 'Explore the demo'}
        </button>
        <p className="mt-2 text-center text-xs text-muted">
          Sample data only — nothing you change affects real accounts.
        </p>

        {needsSetup && (
          <p className="mt-4 text-center text-sm text-muted">
            First time here?{' '}
            <Link to="/setup" className="font-medium text-primary hover:underline">
              Create the admin account
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
