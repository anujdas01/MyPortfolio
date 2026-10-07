import { useEffect, useRef, useState } from 'react';
import { useMotion } from '../context/MotionContext.jsx';

/**
 * Keeps an element mounted for `duration` ms after `active` flips false so an
 * exit animation can play before unmount. Returns:
 *   present — render the element (true during both enter and exit)
 *   closing — true while the exit animation is playing
 * Re-activating before the timer expires cancels the pending unmount. When
 * motion is resolved off, closing unmounts immediately.
 */
export default function usePresence(active, duration = 180) {
  const motion = useMotion();
  const off = motion?.resolved === 'off';
  const [state, setState] = useState(() => ({ present: active, closing: false }));
  const timer = useRef(null);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (active) {
      setState((s) => (s.present && !s.closing ? s : { present: true, closing: false }));
      return () => clearTimeout(timer.current);
    }
    if (off || duration <= 0) {
      setState((s) => (s.present || s.closing ? { present: false, closing: false } : s));
      return undefined;
    }
    setState((s) => (s.present && !s.closing ? { present: true, closing: true } : s));
    timer.current = setTimeout(() => {
      timer.current = null;
      setState({ present: false, closing: false });
    }, duration);
    return () => clearTimeout(timer.current);
  }, [active, off, duration]);

  return { present: state.present, closing: state.closing && state.present };
}
