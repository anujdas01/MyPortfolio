import React from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { NavProvider } from './context/NavContext.jsx';
import Layout from './components/Layout.jsx';
import { FullPageSpinner } from './components/Spinner.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import LoginPage from './pages/LoginPage.jsx';
import SetupPage from './pages/SetupPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AccountsPage from './pages/AccountsPage.jsx';
import AccountDetailPage from './pages/AccountDetailPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';

function Protected() {
  const { user, booting } = useAuth();
  if (booting) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <ThemeProvider user={user}>
      <NavProvider>
        <Outlet />
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
      <ToastProvider>
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
    </ErrorBoundary>
  );
}
