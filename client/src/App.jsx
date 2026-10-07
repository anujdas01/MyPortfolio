import React, { useLayoutEffect, useRef } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { NavProvider } from './context/NavContext.jsx';
import Layout from './components/Layout.jsx';
import { FullPageSpinner } from './components/Spinner.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { MotionProvider } from './context/MotionContext.jsx';
import { AutoRefreshProvider } from './context/AutoRefreshContext.jsx';
import { DashboardPrefsProvider } from './context/DashboardPrefsContext.jsx';
import { UIPrefsProvider } from './context/UIPrefsContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SetupPage from './pages/SetupPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import AccountDetailPage from './pages/AccountDetailPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

// Jump to the top on route change (skipped on first mount so a browser
// scroll restoration on reload survives). Runs as a layout effect so the
// scroll reset lands before a view transition snapshots the new page.
function ScrollToTop() {
  const { pathname } = useLocation();
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Protected() {
  const { user, booting } = useAuth();
  if (booting) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <ThemeProvider user={user}>
      <NavProvider>
        <AutoRefreshProvider>
          <DashboardPrefsProvider>
            <UIPrefsProvider>
              <Outlet />
            </UIPrefsProvider>
          </DashboardPrefsProvider>
        </AutoRefreshProvider>
      </NavProvider>
    </ThemeProvider>
  );
}

function PublicOnly() {
  const { user, booting } = useAuth();
  if (booting) return <FullPageSpinner />;
  return user ? <Navigate to="/" replace /> : <Outlet />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <MotionProvider>
        <ToastProvider>
          <ScrollToTop />
          <Routes>
            <Route element={<PublicOnly />}>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/setup" element={<SetupPage />} />
            </Route>
            <Route element={<Protected />}>
              <Route element={<Layout />} path="/">
                <Route index element={<DashboardPage />} />
                <Route path="accounts" element={<AccountsPage />} />
                <Route path="accounts/:id" element={<AccountDetailPage />} />
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </MotionProvider>
    </ErrorBoundary>
  );
}
