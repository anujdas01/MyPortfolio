import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PREFS = ['auto', 'on', 'off'];
const STORAGE_KEY = 'mp-motion';

const SPEEDS = ['slow', 'normal', 'fast'];
const SPEED_STORAGE_KEY = 'mp-motion-speed';
const SPEED_MULTIPLIER = { slow: 1.5, normal: 1, fast: 0.6 };

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
  const [speedPref, setSpeedState] = useState(() => {
    const stored = safeGet(SPEED_STORAGE_KEY);
    return SPEEDS.includes(stored) ? stored : 'normal';
  });

  useEffect(() => {
    let mq;
    try { mq = window.matchMedia('(prefers-reduced-motion: reduce)'); } catch { return; }
    const onChange = () => setSystemOff(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const resolved = motionPref === 'auto' ? (systemOff ? 'off' : 'on') : motionPref;

  document.documentElement.dataset.motion = resolved;
  document.documentElement.dataset.motionSpeed = speedPref;

  useEffect(() => {
    safeSet(STORAGE_KEY, motionPref);
  }, [motionPref]);

  useEffect(() => {
    safeSet(SPEED_STORAGE_KEY, speedPref);
  }, [speedPref]);

  const setMotionPref = (p) => {
    if (!PREFS.includes(p)) return;
    setPrefState(p);
  };

  const setSpeed = (s) => {
    if (!SPEEDS.includes(s)) return;
    setSpeedState(s);
  };

  const value = useMemo(
    () => ({
      motionPref,
      setMotionPref,
      resolved,
      prefs: PREFS,
      speed: speedPref,
      setSpeed,
      speedMultiplier: SPEED_MULTIPLIER[speedPref],
    }),
    [motionPref, resolved, speedPref]
  );

  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion() {
  return useContext(MotionContext);
}
