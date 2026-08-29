import { useTheme } from '../context/ThemeContext.jsx';
import { CHART_PALETTES } from '../context/ThemeContext.jsx';

const FALLBACK_PALETTE = CHART_PALETTES.light;
export function useThemeColors() {
  const { theme } = useTheme();
  if (typeof document === 'undefined') {
    return { primary: '#2563eb', positive: '#059669', negative: '#dc2626', text: '#1a2333', muted: '#64748b', palette: CHART_PALETTES[theme] || FALLBACK_PALETTE };
  }
  const css = getComputedStyle(document.documentElement);
  const get = (v, fallback) => css.getPropertyValue(v).trim() || fallback;
  return {
    primary: get('--color-primary', '#2563eb'),
    positive: get('--color-positive', '#059669'),
    negative: get('--color-negative', '#dc2626'),
    text: get('--color-text', '#1a2333'),
    muted: get('--color-muted', '#64748b'),
    palette: CHART_PALETTES[theme] || FALLBACK_PALETTE,
  };
}
