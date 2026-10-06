import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PREFS = ['auto', 'on', 'off'];
const STORAGE_KEY = 'mp-motion';

const MotionContext = createContext(null);

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, val) {
  try { localStorage.setItem(key, val); } catch {}
}
function systemReduced() {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false; } catch { return false; }
}

export function MotionProvider({ children }) {
  const [motionPref, setPrefState] = useState(() => {
    const stored = safeGet(STORAGE_KEY);
    return PREFS.includes(stored) ? stored : 'auto';
  });
  const [systemOff, setSystemOff] = useState(systemReduced);

  useEffect(() => {
    let mq;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return; }
    const onChange = () => setSystemOff(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const resolved = motionPref === 'auto' ? (systemOff ? 'off' : 'on') : motionPref;

  document.documentElement.dataset.motion = resolved;

  useEffect(() => {
    safeSet(STORAGE_KEY, motionPref);
  }, [motionPref]);

  const setMotionPref = (p) => {
    if (!PREFS.includes(p)) return;
    setPrefState(p);
  };

  const value = useMemo(
    () => ({ motionPref, setMotionPref, resolved, prefs: PREFS }),
    [motionPref, resolved]
  );

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion() {
  return useContext(MotionContext);
}
