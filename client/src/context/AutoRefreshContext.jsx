import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import {
  AUTO_REFRESH_OPTIONS,
  AUTO_REFRESH_STORAGE_KEY,
  AUTO_REFRESH_ENABLED_KEY,
  AUTO_REFRESH_DEFAULT_SECONDS,
  resolveRefreshInterval,
  resolveAutoRefreshEnabled,
  loadLegacyToggleValues,
  clearNextRefreshAt,
} from '../utils/autoRefresh.js';

const AutoRefreshContext = createContext(null);

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

export function AutoRefreshProvider({ children }) {
  const [intervalSeconds, setIntervalSeconds] = useState(() =>
    resolveRefreshInterval(safeGet(AUTO_REFRESH_STORAGE_KEY))
  );
  const [enabled, setEnabled] = useState(() =>
    resolveAutoRefreshEnabled(safeGet(AUTO_REFRESH_ENABLED_KEY), loadLegacyToggleValues(safeGet))
  );

  useEffect(() => {
    safeSet(AUTO_REFRESH_STORAGE_KEY, String(intervalSeconds));
  }, [intervalSeconds]);

  useEffect(() => {
    safeSet(AUTO_REFRESH_ENABLED_KEY, enabled ? '1' : '0');
  }, [enabled]);

  const setAutoRefreshInterval = (seconds) => {
    setIntervalSeconds(resolveRefreshInterval(seconds));
  };

  const setAutoRefreshEnabled = (on) => {
    setEnabled(!!on);
    if (!on) clearNextRefreshAt();
  };

  const resetAutoRefreshInterval = () => {
    setIntervalSeconds(AUTO_REFRESH_DEFAULT_SECONDS);
  };

  const value = useMemo(
    () => ({
      enabled,
      setAutoRefreshEnabled,
      intervalMs: intervalSeconds * 1000,
      intervalSeconds,
      setAutoRefreshInterval,
      resetAutoRefreshInterval,
      options: AUTO_REFRESH_OPTIONS,
    }),
    [enabled, intervalSeconds]
  );

  return <AutoRefreshContext.Provider value={value}>{children}</AutoRefreshContext.Provider>;
}

export function useAutoRefresh() {
  return useContext(AutoRefreshContext);
}