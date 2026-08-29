import React, { createContext, useContext, useEffect, useState } from 'react';
import api from '../api/client.js';

const THEMES = [
  'light',
  'dark',
  'sepia',
  'github',
  'dracula',
  'catppuccin',
  'gruvbox',
  'rosepine',
  'nord',
  'solarized',
  'contrast',
];

export const THEME_META = {
  light: { label: 'Light', swatches: ['#f8fafc', '#2563eb', '#059669', '#dc2626'] },
  dark: { label: 'Midnight', swatches: ['#090f1c', '#60a5fa', '#34d399', '#fb7185'] },
  sepia: { label: 'Sepia', swatches: ['#fdf6e3', '#b45309', '#15803d', '#b91c1c'] },
  github: { label: 'GitHub', swatches: ['#0d1117', '#58a6ff', '#3fb950', '#f85149'] },
  dracula: { label: 'Dracula', swatches: ['#282a36', '#bd93f9', '#50fa7b', '#ff5555'] },
  catppuccin: { label: 'Catppuccin', swatches: ['#1e1e2e', '#89b4fa', '#a6e3a1', '#f38ba8'] },
  gruvbox: { label: 'Gruvbox', swatches: ['#282828', '#83a598', '#b8bb26', '#fb4934'] },
  rosepine: { label: 'Rosé Pine', swatches: ['#191724', '#c4a7e7', '#9ccfd8', '#eb6f92'] },
  nord: { label: 'Nord', swatches: ['#2e3440', '#88c0d0', '#a3be8c', '#bf616a'] },
  solarized: { label: 'Solarized', swatches: ['#002b36', '#268bd2', '#859900', '#dc322f'] },
  contrast: { label: 'High Contrast', swatches: ['#000000', '#38bdf8', '#4ade80', '#f87171'] },
};

export const CHART_PALETTES = {
  light: ['#2563eb', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#65a30d'],
  dark: ['#60a5fa', '#34d399', '#fbbf24', '#a78bfa', '#22d3ee', '#fb7185', '#a3e635'],
  sepia: ['#b45309', '#15803d', '#0e7490', '#92400e', '#7c3aed', '#b91c1c', '#4d7c0f'],
  github: ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#39c5cf', '#f85149', '#7ee787'],
  dracula: ['#bd93f9', '#50fa7b', '#ffb86c', '#8be9fd', '#ff79c6', '#f1fa8c', '#ff5555'],
  catppuccin: ['#89b4fa', '#a6e3a1', '#fab387', '#cba6f7', '#94e2d5', '#f38ba8', '#f9e2af'],
  gruvbox: ['#83a598', '#b8bb26', '#fabd2f', '#d3869b', '#8ec07c', '#fb4934', '#fe8019'],
  rosepine: ['#c4a7e7', '#9ccfd8', '#f6c177', '#ebbcba', '#31748f', '#eb6f92', '#908caa'],
  nord: ['#88c0d0', '#a3be8c', '#ebcb8b', '#b48ead', '#8fbcbb', '#bf616a', '#81a1c1'],
  solarized: ['#268bd2', '#859900', '#b58900', '#d33682', '#2aa198', '#dc322f', '#6c71c4'],
  contrast: ['#38bdf8', '#facc15', '#4ade80', '#f87171', '#a78bfa', '#ffffff', '#fb7185'],
};

const ThemeContext = createContext(null);

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

function resolveInitial(user) {
  const stored = safeGet('mp-theme');
  if (THEMES.includes(stored)) return stored;
  const pref = user?.themePref;
  if (THEMES.includes(pref)) return pref;
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch { return 'light'; }
}

export function ThemeProvider({ user, children }) {
  const [theme, setThemeState] = useState(() => resolveInitial(user));

  // Sync when user pref loads after boot (fix initial flash)
  useEffect(() => {
    if (!user?.themePref) return;
    if (safeGet('mp-theme')) return; // explicit user choice wins
    if (THEMES.includes(user.themePref) && theme !== user.themePref) {
      setThemeState(user.themePref);
    }
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
