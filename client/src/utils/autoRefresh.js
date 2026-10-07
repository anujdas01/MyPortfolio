// Auto-refresh cadence for live market pricing. The usable range spans 30
// seconds to 5 minutes and applies to the Accounts-page auto-refresh loop plus
// the Auto-update tick on an account's holdings table.
export const AUTO_REFRESH_STORAGE_KEY = 'mp-auto-refresh-interval';
export const AUTO_REFRESH_ENABLED_KEY = 'mp-auto-refresh-enabled';
export const AUTO_REFRESH_DEFAULT_SECONDS = 30;

export const AUTO_REFRESH_OPTIONS = [
  { seconds: 30, label: '30 seconds' },
  { seconds: 45, label: '45 seconds' },
  { seconds: 60, label: '1 minute' },
  { seconds: 120, label: '2 minutes' },
  { seconds: 180, label: '3 minutes' },
  { seconds: 300, label: '5 minutes' },
];

export function resolveRefreshInterval(value) {
  const n = Number(value);
  const hit = AUTO_REFRESH_OPTIONS.find((o) => o.seconds === n);
  return hit ? hit.seconds : AUTO_REFRESH_DEFAULT_SECONDS;
}

// Legacy per-page toggles that predate the single Settings switch. They default
// to ON, so a stored '0' means the user explicitly turned that loop off.
const LEGACY_TOGGLE_KEYS = ['mp-auto-refresh-market', 'mp-holdings-auto-update'];

export function resolveAutoRefreshEnabled(value, legacyValues) {
  if (value === '1' || value === '0') return value === '1';
  const legacy = (legacyValues || []).filter((v) => v === '0' || v === '1');
  if (legacy.length) return legacy.every((v) => v === '1');
  return true;
}

export function loadLegacyToggleValues(getItem) {
  return LEGACY_TOGGLE_KEYS.map((k) => {
    try { return getItem(k); } catch { return null; }
  });
}

// Shared "next auto-refresh" timestamp. Persisted per device so navigating
// between pages (or reloading) continues the same countdown instead of
// restarting it — and so a freshly loaded page never reprices immediately.
const NEXT_AT_KEY = 'mp-auto-refresh-next-at';

export function readNextRefreshAt() {
  try { return Number(localStorage.getItem(NEXT_AT_KEY)) || 0; } catch { return 0; }
}

export function writeNextRefreshAt(timestamp) {
  try { localStorage.setItem(NEXT_AT_KEY, String(timestamp)); } catch {}
}

export function clearNextRefreshAt() {
  try { localStorage.removeItem(NEXT_AT_KEY); } catch {}
}