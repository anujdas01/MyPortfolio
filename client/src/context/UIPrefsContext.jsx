import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const SCALE_KEY = 'mp-ui-scale';
const RADIUS_KEY = 'mp-ui-radius';
const HOVER_KEY = 'mp-ui-hover';

const RADII = ['sharp', 'standard', 'rounded'];

const UIPrefsContext = createContext(null);

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}

export function UIPrefsProvider({ children }) {
  const [textScale, setTextScale] = useState(() => {
    const n = Number(safeGet(SCALE_KEY));
    return Number.isFinite(n) && n >= 0.85 && n <= 1.2 ? n : 1;
  });
  const [radius, setRadiusState] = useState(() => {
    const r = safeGet(RADIUS_KEY);
    return RADII.includes(r) ? r : 'standard';
  });
  const [hover, setHoverState] = useState(() => {
    const h = safeGet(HOVER_KEY);
    return h == null ? true : h === 'on';
  });

  useEffect(() => {
    safeSet(SCALE_KEY, String(textScale));
    document.documentElement.style.setProperty('--mp-scale', String(textScale));
  }, [textScale]);

  useEffect(() => {
    safeSet(RADIUS_KEY, radius);
    document.documentElement.dataset.radius = radius;
  }, [radius]);

  useEffect(() => {
    const v = hover ? 'on' : 'off';
    safeSet(HOVER_KEY, v);
    document.documentElement.dataset.hover = v;
  }, [hover]);

  const setRadius = (r) => {
    if (!RADII.includes(r)) return;
    setRadiusState(r);
  };

  const setHover = (h) => setHoverState(!!h);

  const value = useMemo(
    () => ({ textScale, setTextScale, radius, setRadius, hover, setHover }),
    [textScale, radius, hover]
  );

  return <UIPrefsContext.Provider value={value}>{children}</UIPrefsContext.Provider>;
}

export function useUIPrefs() {
  return useContext(UIPrefsContext);
}