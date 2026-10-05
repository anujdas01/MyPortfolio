const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdPrecise = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});

export function money(n) {
  const num = Number(n) || 0;
  if (Math.abs(num) >= 10000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(num);
  }
  return usd.format(num);
}

export function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function signedMoney(n) {
  return `${n > 0 ? '+' : ''}${money(n)}`;
}

/**
 * Unit/share prices (live quotes, average cost). Unlike money(), keeps up to
 * 8 decimals so sub-cent crypto prices (SHIB at $0.00000591) never show $0.
 * Totals and balances should keep using money().
 */
export function marketPrice(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (Math.abs(num) >= 10000) return money(num);
  return usdPrecise.format(num);
}

/**
 * Plain (non-exponent) decimal string for number inputs, e.g. 0.00000591.
 * String(1e-7) gives "1e-7", which number inputs reject.
 */
export function plainAmount(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '';
  return num
    .toFixed(10)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

export function pct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}
