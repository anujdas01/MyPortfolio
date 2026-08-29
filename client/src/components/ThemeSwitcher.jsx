import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { THEME_META } from '../context/ThemeContext.jsx';
import { Check, ChevronDown, Palette } from 'lucide-react';

export default function ThemeSwitcher() {
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  const meta = THEME_META[theme];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Color theme"
        className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-surfaceAlt"
      >
        <Palette size={14} className="text-muted" />
        <span className="hidden sm:inline">{meta?.label ?? theme}</span>
        <span className="flex gap-0.5">
          {meta?.swatches?.slice(0, 3).map((c) => (
            <span key={c} className="h-3 w-3 rounded-full border border-border" style={{ background: c }} />
          ))}
        </span>
        <ChevronDown size={13} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-72 overflow-auto rounded-xl border border-border bg-surface p-2 shadow-xl">
          <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">Choose theme</p>
          <div className="grid grid-cols-1 gap-1">
            {themes.map((t) => {
              const m = THEME_META[t];
              const active = t === theme;
              return (
                <button
                  key={t}
                  role="option"
                  aria-selected={active}
                  onClick={() => { setTheme(t); setOpen(false); }}
                  data-theme={t}
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                    active ? 'border-primary bg-primary/10' : 'border-transparent hover:border-border hover:bg-surfaceAlt'
                  }`}
                >
                  <span className="flex gap-1">
                    {m.swatches.map((c) => (
                      <span key={c} className="h-5 w-5 rounded-full border border-border shadow-sm" style={{ background: c }} title={c} />
                    ))}
                  </span>
                  <span className="flex-1">
                    <span className={`block text-sm font-medium ${active ? 'text-primary' : 'text-text'}`}>{m.label}</span>
                    <span className="block text-xs text-muted">{t}</span>
                  </span>
                  {active && <Check size={14} className="text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
