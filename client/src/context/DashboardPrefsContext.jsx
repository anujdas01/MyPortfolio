import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'mp-dashboard-compact';

const DashboardPrefsContext = createContext(null);

export function DashboardPrefsProvider({ children }) {
  const [compactView, setCompactView] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(compactView)); } catch {}
  }, [compactView]);

  const value = useMemo(
    () => ({ compactView, setCompactView }),
    [compactView]
  );

  return <DashboardPrefsContext.Provider value={value}>{children}</DashboardPrefsContext.Provider>;
}

export function useDashboardPrefs() {
  return useContext(DashboardPrefsContext);
}

// Shared density class fragments so every page applies the same compact vs.
// comfortable rhythm instead of re-encoding the values page by page.
export function useDensity() {
  const { compactView } = useDashboardPrefs();
  return {
    compact: compactView,
    // page wrapper vertical rhythm
    page: compactView ? 'space-y-3.5' : 'space-y-5',
    // card body padding + header gap
    card: compactView ? 'p-3.5' : 'p-5',
    cardHeader: compactView ? 'mb-3' : 'mb-4',
    // page heading size
    heading: compactView ? 'text-2xl' : 'text-3xl',
    // header icon badge next to the heading
    headerIcon: compactView ? 'h-8 w-8' : 'h-10 w-10',
    headerIconSize: compactView ? 18 : 20,
  };
}