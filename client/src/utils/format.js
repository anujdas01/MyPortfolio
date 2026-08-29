const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

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

export function pct(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;
}
