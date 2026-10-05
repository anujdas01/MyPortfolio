// Live market data via Yahoo Finance (no API key required): quotes from the
// chart API, symbol search from the search API (stocks, ETFs, mutual funds
// and crypto — e.g. BTC-USD for spot Bitcoin vs BTC for the ETF).
//
// Server-side only: browsers are blocked by Yahoo's CORS policy, so the
// client asks us and we ask Yahoo. Results are cached in memory to stay well
// under Yahoo's rate limits. Everything here degrades gracefully — a failed
// lookup never breaks portfolio data.

const YAHOO_URL = (sym) =>
  `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5d`;
const YAHOO_SEARCH_URL = (q) =>
  `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;

const SEARCH_TTL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

// Note: quotes are intentionally NOT cached — every request fetches live
// prices (cheap enough at this scale, and staleness here costs real money).
// Only symbol search results are cached (they barely change).
const searchCache = new Map(); // UPPER_QUERY -> { results, expiresAt }

// Overridable for tests (node:test stubs this instead of hitting Yahoo).
let fetchImpl = null;
export function setMarketFetch(fn) {
  fetchImpl = fn;
}
function httpFetch(...args) {
  const fn = fetchImpl ?? globalThis.fetch;
  if (!fn) throw new Error('fetch is not available');
  return fn(...args);
}

const TICKER_RE = /^[A-Z0-9.\-=^]{1,16}$/;

export function normalizeTicker(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

function upstreamError(message) {
  const err = new Error(message);
  err.code = 'UPSTREAM';
  return err;
}

async function yahooFetch(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await httpFetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'application/json',
      },
    });
  } catch (e) {
    throw upstreamError(e?.name === 'AbortError' ? 'Quote provider timed out' : 'Quote provider unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the latest quote for a ticker — always live, never cached.
 * Prices keep full provider precision (sub-cent crypto prices must survive).
 * @returns {Promise<{ticker,name,price,currency,asOf,source,cached}>}
 * @throws {Error} with `.code` of 'INVALID' | 'NOT_FOUND' | 'UPSTREAM'
 */
export async function getQuote(rawTicker) {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) {
    const err = new Error('Invalid ticker (letters, numbers, . - = ^, max 16 chars)');
    err.code = 'INVALID';
    throw err;
  }

  const res = await yahooFetch(YAHOO_URL(ticker));

  if (res.status === 404) {
    const err = new Error(`No market data found for "${ticker}" — check the ticker symbol`);
    err.code = 'NOT_FOUND';
    throw err;
  }
  if (res.status === 429) {
    throw upstreamError('Quote provider rate limit reached — try again in a few minutes');
  }
  if (!res.ok) {
    throw upstreamError(`Quote provider error (HTTP ${res.status})`);
  }

  let json;
  try {
    json = await res.json();
  } catch {
    throw upstreamError('Quote provider returned invalid data');
  }

  const meta = json?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  if (!meta || !Number.isFinite(price)) {
    const err = new Error(`No market data found for "${ticker}" — check the ticker symbol`);
    err.code = 'NOT_FOUND';
    throw err;
  }

  const marketTime = Number(meta.regularMarketTime);
  return {
    ticker,
    name: meta.longName || meta.shortName || null,
    price,
    currency: meta.currency || 'USD',
    asOf: Number.isFinite(marketTime) ? new Date(marketTime * 1000).toISOString().slice(0, 10) : null,
    source: 'yahoo',
    cached: false,
  };
}

/**
 * Batch lookup. Never throws — each ticker resolves to
 * `{ ok: true, ...quote }` or `{ ok: false, error }`.
 */
export async function getQuotes(tickers) {
  const out = {};
  await Promise.all(
    tickers.map(async (raw) => {
      const key = normalizeTicker(raw) || String(raw ?? '').trim().toUpperCase();
      try {
        out[key] = { ok: true, ...(await getQuote(raw)) };
      } catch (e) {
        out[key] = { ok: false, error: e.code === 'NOT_FOUND' ? e.message : 'Quote unavailable right now' };
      }
    })
  );
  return out;
}

export function clearMarketCache() {
  searchCache.clear();
}

// Symbol search accepts free text (company names too), so the pattern is
// looser than the strict ticker format used for quotes.
const SEARCH_RE = /^[A-Za-z0-9.\- ]{1,32}$/;
const SEARCHABLE_TYPES = new Set(['EQUITY', 'ETF', 'CRYPTOCURRENCY', 'MUTUALFUND']);

export function normalizeSearchQuery(raw) {
  if (typeof raw !== 'string') return null;
  const q = raw.trim();
  return SEARCH_RE.test(q) ? q : null;
}

/**
 * Search Yahoo for matching symbols (stocks, ETFs, funds, crypto).
 * Used by the holding form picker so "BTC" can resolve to BTC-USD (spot)
 * vs BTC (ETF) explicitly instead of guessing.
 * @returns {Promise<{query, results: {symbol,name,type,typeLabel,exchange}[], cached}>}
 * @throws {Error} with `.code` of 'INVALID' | 'UPSTREAM'
 */
export async function searchSymbols(rawQuery) {
  const q = normalizeSearchQuery(rawQuery);
  if (!q) {
    const err = new Error('Search text must be 1-32 characters (letters, numbers, spaces, . -)');
    err.code = 'INVALID';
    throw err;
  }

  const key = q.toUpperCase();
  const now = Date.now();
  const hit = searchCache.get(key);
  if (hit && hit.expiresAt > now) return { query: q, results: hit.results, cached: true };

  const res = await yahooFetch(YAHOO_SEARCH_URL(q));
  if (res.status === 429) {
    throw upstreamError('Quote provider rate limit reached — try again in a few minutes');
  }
  if (!res.ok) {
    throw upstreamError(`Search provider error (HTTP ${res.status})`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw upstreamError('Search provider returned invalid data');
  }

  const results = ((json && json.quotes) || [])
    .filter((qt) => qt && SEARCHABLE_TYPES.has(qt.quoteType) && typeof qt.symbol === 'string')
    .slice(0, 8)
    .map((qt) => ({
      symbol: qt.symbol.toUpperCase(),
      name: qt.longname || qt.shortname || null,
      type: qt.quoteType,
      typeLabel: qt.typeDisp || qt.quoteType,
      exchange: qt.exchDisp || qt.exchange || null,
    }))
    .filter((r) => r.symbol && TICKER_RE.test(r.symbol));

  searchCache.set(key, { results, expiresAt: now + SEARCH_TTL_MS });
  return { query: q, results, cached: false };
}
