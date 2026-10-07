import React, { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Wallet,
  FileBarChart2,
  Settings as SettingsIcon,
  Beaker,
  X,
} from 'lucide-react';
import { useNavPosition } from '../context/NavContext.jsx';
import { useDensity } from '../context/DashboardPrefsContext.jsx';
import { isDemoSession } from '../api/client.js';
import ThemeSwitcher from './ThemeSwitcher.jsx';
import UserMenu from './UserMenu.jsx';

const NAV_LINKS = [
  { to: '/', label: 'Dashboard', end: true, Icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', Icon: Wallet },
  { to: '/reports', label: 'Reports', Icon: FileBarChart2 },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium lift ${
    isActive ? 'bg-primary text-onPrimary' : 'text-muted hover:bg-surfaceAlt hover:text-text'
  }`;

const sidebarLinkClass = ({ isActive }) =>
  `flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium lift ${
    isActive
      ? 'bg-primary text-onPrimary shadow-sm'
      : 'text-muted hover:bg-surfaceAlt hover:text-text'
  }`;

function SettingsGear() {
  return (
    <NavLink
      to="/settings"
      viewTransition
      title="Settings"
      aria-label="Settings"
      className={({ isActive }) =>
        `flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
          isActive
            ? 'border-primary bg-primary text-onPrimary shadow-sm'
            : 'border-border bg-surface text-muted hover:border-primary/40 hover:bg-surfaceAlt hover:text-text'
        }`
      }
    >
      <SettingsIcon size={15} strokeWidth={2.25} />
    </NavLink>
  );
}

function Brand({ large = false }) {
  const demo = isDemoSession();
  return (
    <NavLink to="/" className="group flex items-center gap-2.5" viewTransition>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-onPrimary shadow-sm transition-transform group-hover:scale-105">
        <Wallet size={18} strokeWidth={2.25} />
      </span>
      <span className={`font-bold tracking-tight text-primary ${large ? 'text-xl' : 'text-lg'}`}>
        MyPortfolio
      </span>
      {demo && (
        <span
          title="You are viewing sample data"
          className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-accent"
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
    <div className="mx-auto mb-4 flex max-w-[87.12rem] items-start justify-between gap-3 rounded-lg border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm text-text">
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
        title="Dismiss"
        className="rounded-md p-1 text-muted transition-colors hover:bg-surfaceAlt hover:text-text"
      >
        <X size={15} />
      </button>
    </div>
  );
}

export default function Layout() {
  const { navPosition } = useNavPosition();
  const location = useLocation();
  const { compact } = useDensity();
  const mainCls = compact
    ? 'mx-auto w-full max-w-[87.12rem] flex-1 px-4 py-3 sm:px-4 lg:px-5 lg:py-4'
    : 'mx-auto w-full max-w-[87.12rem] flex-1 px-4 py-5 sm:px-5 lg:px-6 lg:py-6';

  const outlet = (
    <>
      {isDemoSession() && <DemoBanner />}
      <div key={location.pathname} className="anim-page">
        <Outlet />
      </div>
    </>
  );

  if (navPosition === 'left') {
    return (
      <div className="flex min-h-screen">
        {/* Sidebar (desktop) */}
        <aside className="[view-transition-name:mp-chrome] sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 shadow-sm md:flex">
          <div className="px-2">
            <Brand />
          </div>
          <nav className="mt-6 flex flex-col gap-1" aria-label="Main navigation">
            {NAV_LINKS.map(({ to, label, end, Icon }) => (
              <NavLink key={to} to={to} end={end} className={sidebarLinkClass} viewTransition>
                <Icon size={16} strokeWidth={2.25} />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="mt-auto space-y-3 pt-4">
            <div className="flex items-center gap-2">
              <SettingsGear />
              <ThemeSwitcher />
            </div>
            <UserMenu />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile bar */}
          <nav className="[view-transition-name:mp-chrome] sticky top-0 z-10 border-b border-border bg-surface shadow-sm md:hidden">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <Brand />
              <div className="flex items-center gap-2">
                <SettingsGear />
                <ThemeSwitcher />
                <UserMenu />
              </div>
            </div>
            <div className="flex gap-1 overflow-x-auto border-t border-border px-4 py-2">
              {NAV_LINKS.map(({ to, label, end, Icon }) => (
                <NavLink key={to} to={to} end={end} className={linkClass} viewTransition>
                  <Icon size={14} strokeWidth={2.25} />
                  {label}
                </NavLink>
              ))}
            </div>
          </nav>
          <main className={mainCls}>
            {outlet}
          </main>
          <footer className="border-t border-border/60 py-5 text-center text-xs text-muted">
            MyPortfolio — local personal finance tracker
          </footer>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <nav className="[view-transition-name:mp-chrome] sticky top-0 z-10 border-b border-border bg-surface shadow-sm">
        <div className="mx-auto flex max-w-[87.12rem] items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <Brand />
            <div className="hidden gap-1 md:flex">
              {NAV_LINKS.map(({ to, label, end, Icon }) => (
                <NavLink key={to} to={to} end={end} className={linkClass} viewTransition>
                  <Icon size={15} strokeWidth={2.25} />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <SettingsGear />
            <ThemeSwitcher />
            <UserMenu />
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden">
          {NAV_LINKS.map(({ to, label, end, Icon }) => (
            <NavLink key={to} to={to} end={end} className={linkClass} viewTransition>
              <Icon size={14} strokeWidth={2.25} />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className={mainCls}>
            {outlet}
      </main>
      <footer className="py-4 text-center text-xs text-muted">
        MyPortfolio — local personal finance tracker
      </footer>
    </div>
  );
}
