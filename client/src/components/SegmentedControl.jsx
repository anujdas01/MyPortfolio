import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * One segmented control for the whole app (range pickers, chart toggles,
 * assets/liabilities tabs). The active option is a raised surface pill that
 * physically slides between options; the pill is measured from the live DOM
 * (offsetLeft/offsetWidth — layout metrics, unaffected by any entrance
 * animation transforms on the parent) and animated with transform/width.
 */
export default function SegmentedControl({ options, value, onChange, ariaLabel, className = '' }) {
  const listRef = useRef(null);
  const btnRefs = useRef({});
  const [indicator, setIndicator] = useState(null);

  const measure = () => {
    const el = btnRefs.current[value];
    const list = listRef.current;
    if (!el || !list) return;
    // offsetLeft is measured from the border box; the indicator is placed in
    // the padding box, so subtract the border width.
    const x = el.offsetLeft - list.clientLeft;
    const w = el.offsetWidth;
    setIndicator((prev) => (prev && prev.x === x && prev.w === w ? prev : { x, w }));
  };

  useLayoutEffect(measure, [value, options]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options]);

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      className={`relative flex rounded-lg border border-border/70 bg-surfaceAlt/60 p-0.5 ${className}`}
    >
      {indicator && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0.5 left-0 z-0 rounded-md bg-surface shadow-sm transition-all duration-200 ease-out"
          style={{ width: `${indicator.w}px`, transform: `translateX(${indicator.x}px)` }}
        />
      )}
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            ref={(el) => {
              if (el) btnRefs.current[opt.value] = el;
              else delete btnRefs.current[opt.value];
            }}
            aria-selected={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={`relative z-10 flex items-center gap-1 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
              active ? 'text-text' : 'text-muted hover:text-text'
            }`}
          >
            {opt.icon && <opt.icon size={13} strokeWidth={2.25} className={active ? 'text-primary' : ''} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
