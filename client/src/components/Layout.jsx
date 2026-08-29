import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Wallet,
  FileBarChart2,
  Settings as SettingsIcon,
  LogOut,
  Beaker,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useNavPosition } from '../context/NavContext.jsx';
import { isDemoSession } from '../api/client.js';
import ThemeSwitcher from './ThemeSwitcher.jsx';

const NAV_LINKS = [
  { to: '/', label: 'Dashboard', end: true, Icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', Icon: Wallet },
  { to: '/reports', label: 'Reports', Icon: FileBarChart2 },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-primary text-white' : 'text-muted hover:bg-surfaceAlt hover:text-text'
  }`;

const sidebarLinkClass = ({ isActive }) =>
  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-white shadow-sm'
      : 'text-muted hover:bg-surfaceAlt hover:text-text'
  }`;

function Brand({ large = false }) {
  const demo = isDemoSession();
  return (
    <NavLink to="/" className="group flex items-center gap-2.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-sm transition-transform group-hover:scale-105">
        <Wallet size={18} strokeWidth={2.25} />
      </span>
      <span className={`font-bold tracking-tight text-primary ${large ? 'text-xl' : 'text-lg'}`}>
        MyPortfolio
      </span>
      {demo && (
        <span
          title="You are viewing sample data"
          className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-wide text-accent"
        >
          <Beaker size={11} />
          Demo
        </span>
      )}
    </NavLink>
  );
}

function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="mx-auto mb-4 flex max-w-6xl items-start justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm text-text">
      <p className="flex items-start gap-2">
        <Beaker size={16} className="mt-0.5 shrink-0 text-accent" />
        <span>
          <strong>Demo mode.</strong> You are exploring MyPortfolio with sample data — feel free to
          click around and make changes. Nothing here affects real accounts, and the data resets
          when you log out.
        </span>
      </p>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss demo notice"
        className="rounded-md p-1 text-muted transition-colors hover:bg-surfaceAlt hover:text-text"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { navPosition } = useNavPosition();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const outlet = (
    <>
      {isDemoSession() && <DemoBanner />}
      <Outlet />
    </>
  );

  if (navPosition === 'left') {
    return (
      <div className="flex min-h-screen">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 shadow-sm md:flex">
          <div className="px-2">
            <Brand />
          </div>
          <nav className="mt-6 flex flex-col gap-1" aria-label="Main navigation">
            {NAV_LINKS.map(({ to, label, end, Icon }) => (
              <NavLink key={to} to={to} end={end} className={sidebarLinkClass}>
                <Icon size={16} strokeWidth={2.25} />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto space-y-3 pt-4">
            <span className="block truncate rounded-md bg-surfaceAlt px-3 py-1.5 text-xs text-muted">
              {user?.displayName || user?.username}
            </span>
            <ThemeSwitcher />
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm font-medium text-negative hover:bg-negative/10"
            >
              <LogOut size={15} strokeWidth={2.25} />
              Log out
            </button>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile bar */}
          <nav className="sticky top-0 z-10 border-b border-border bg-surface shadow-sm md:hidden">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <Brand />
              <div className="flex items-center gap-2">
                <ThemeSwitcher />
                <button
                  onClick={handleLogout}
                  aria-label="Log out"
                  className="rounded-md p-1.5 text-negative hover:bg-negative/10"
                >
                  <LogOut size={16} />
                </button>
              </div>
            </div>
            <div className="flex gap-1 overflow-x-auto border-t border-border px-4 py-2">
              {NAV_LINKS.map(({ to, label, end, Icon }) => (
                <NavLink key={to} to={to} end={end} className={linkClass}>
                  <Icon size={14} strokeWidth={2.25} />
                  {label}
                </NavLink>
              ))}
            </div>
          </nav>
          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            {outlet}
          </main>
          <footer className="py-4 text-center text-xs text-muted">
            MyPortfolio — local personal finance tracker
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <nav className="sticky top-0 z-10 border-b border-border bg-surface shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Brand />
            <div className="hidden gap-1 md:flex">
              {NAV_LINKS.map(({ to, label, end, Icon }) => (
                <NavLink key={to} to={to} end={end} className={linkClass}>
                  <Icon size={15} strokeWidth={2.25} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeSwitcher />
            <span className="hidden rounded-full bg-surfaceAlt px-3 py-1 text-sm text-muted lg:inline">
              {user?.displayName || user?.username}
            </span>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-negative transition-colors hover:bg-negative/10"
            >
              <LogOut size={15} strokeWidth={2.25} />
              Log out
            </button>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden">
          {NAV_LINKS.map(({ to, label, end, Icon }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon size={14} strokeWidth={2.25} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
            {outlet}
      </main>
      <footer className="py-4 text-center text-xs text-muted">
        MyPortfolio — local personal finance tracker
      </footer>
    </div>
  );
}
