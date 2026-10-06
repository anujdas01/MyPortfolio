import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client.js';

const THEMES = [
  'light',
  'sepia',
  'dark',
  'rosepine',
  'everforest',
  'gruvbox',
  'contrast',
];

const LEGACY_THEMES = {
  github: 'dark',
  latte: 'light',
  solarized: 'light',
  'solarized-light': 'light',
  dracula: 'rosepine',
  catppuccin: 'dark',
  tokyo: 'dark',
  nord: 'dark',
};

export const THEME_META = {
  light: { label: 'Light', type: 'Light', swatches: ['#f6f8fa', '#2563eb', '#047857', '#dc2626'] },
  sepia: { label: 'Sepia', type: 'Light', swatches: ['#f7efdd', '#9a4b0d', '#147338', '#b91c1c'] },
  dark: { label: 'Midnight', type: 'Dark', swatches: ['#0a0f1a', '#5b9dff', '#34d399', '#fb7185'] },
  rosepine: { label: 'Rosé Pine', type: 'Dark', swatches: ['#191724', '#c4a7e7', '#9ccfd8', '#eb6f92'] },
  everforest: { label: 'Everforest', type: 'Dark', swatches: ['#1e2326', '#7fbbb3', '#a7c080', '#e67e80'] },
  gruvbox: { label: 'Gruvbox', type: 'Dark', swatches: ['#282828', '#83a598', '#b8bb26', '#ff5d46'] },
  contrast: { label: 'High Contrast', type: 'High contrast', swatches: ['#000000', '#38bdf8', '#4ade80', '#f87171'] },
};

export const CHART_PALETTES = {
  light: ['#2563eb', '#047857', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d'],
  sepia: ['#9a4b0d', '#147338', '#0e7490', '#92400e', '#7c3aed', '#b91c1c', '#4d7c0f'],
  dark: ['#5b9dff', '#34d399', '#fbbf24', '#a78bfa', '#22d3ee', '#fb7185', '#a3e635'],
  rosepine: ['#c4a7e7', '#9ccfd8', '#f6c177', '#ebbcba', '#b4637a', '#eb6f92', '#908caa'],
  everforest: ['#7fbbb3', '#a7c080', '#dbbc7f', '#e69875', '#83c092', '#e67e80', '#d699b6'],
  gruvbox: ['#83a598', '#b8bb26', '#fabd2f', '#d3869b', '#8ec07c', '#ff5d46', '#fe8019'],
  contrast: ['#38bdf8', '#facc15', '#4ade80', '#f87171', '#a78bfa', '#ffffff', '#fb7185'],
};

const ThemeContext = createContext(null);

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

function resolveKey(value) {
  if (THEMES.includes(value)) return value;
  const mapped = LEGACY_THEMES[value];
  return THEMES.includes(mapped) ? mapped : null;
}

function resolveInitial(user) {
  const stored = resolveKey(safeGet('mp-theme'));
  if (stored) return stored;
  const pref = resolveKey(user?.themePref);
  if (pref) return pref;
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'light'; }
}

export function ThemeProvider({ user, children }) {
  const [theme, setThemeState] = useState(() => resolveInitial(user));

  useEffect(() => {
    if (!user?.themePref) return;
    if (safeGet('mp-theme')) return;
    const pref = resolveKey(user.themePref);
    if (pref && theme !== pref) setThemeState(pref);
  }, [user?.themePref]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    safeSet('mp-theme', theme);
  }, [theme]);

  const setTheme = (t) => {
    if (!THEMES.includes(t)) return;
    setThemeState(t);
    api.put('/settings/theme', { theme: t }).catch(() => {});
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}