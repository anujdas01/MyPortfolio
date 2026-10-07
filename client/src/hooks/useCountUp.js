import { useEffect, useRef, useState } from 'react';
import { useMotion } from '../context/MotionContext.jsx';

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Tweens a numeric value toward `target` with a rAF ease-out so displayed
 * figures glide instead of jumping. Snaps instantly when motion is off.
 *
 *   mountFromZero — start the very first render at 0 and count up to the
 *                   initial value (a load-in flourish for headline figures).
 */
export default function useCountUp(value, { duration = 600, mountFromZero = false } = {}) {
  const motion = useMotion();
  const off = motion?.resolved === 'off';
  const total = Math.max(100, Math.round(duration * (motion?.speedMultiplier ?? 1)));
  const target = Number.isFinite(value) ? value : 0;
  const [display, setDisplay] = useState(() => (mountFromZero && !off ? 0 : target));
  const displayRef = useRef(display);
  const rafRef = useRef(0);

  useEffect(() => {
    if (off) {
      displayRef.current = target;
      setDisplay(target);
      return undefined;
    }
    const from = displayRef.current;
    if (from === target) return undefined;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / total);
      const next = from + (target - from) * easeOutCubic(t);
      displayRef.current = next;
      setDisplay(next);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, off, total]);

  return display;
}
