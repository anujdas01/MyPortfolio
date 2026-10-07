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

const usdFixed2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Signed currency that always shows exactly two decimals. Gain/loss figures
 * keep their cents at every magnitude — money() rounds them away above $10k.
 */
export function signedMoney2(n) {
  const rounded = Math.round((Number(n) || 0) * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${usdFixed2.format(rounded || 0)}`;
}

/**
 * Unit/share prices (live quotes, average cost). Keeps up to 8 decimals so
 * sub-cent crypto prices (SHIB at $0.00000591) never show $0, and always
 * shows at least cents — even above $10k, where money() rounds them away.
 * Totals and balances should keep using money().
 */
export function marketPrice(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return usdPrecise.format(num);
}

/**
 * Currency value capped at exactly 2 decimals at every magnitude — average
 * cost, cost basis and market value keep their cents above $10k, where money()
 * rounds them away. Unlike marketPrice(), it does not preserve sub-cent
 * precision (an avg cost is a currency value, not a live quote).
 */
export function money2(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return usd.format(num);
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
