import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

let server;
let db;
let base;
let dataDir;
let adminToken = '';
let realFetch;
let upstreamCalls = 0;

const CANNED_META = {
  longName: 'Vanguard Total Stock Market ETF',
  shortName: 'VTI',
  regularMarketPrice: 380.6,
  currency: 'USD',
  regularMarketTime: 1791230400,
};

function cannedYahooResponse() {
  return { chart: { result: [{ meta: { ...CANNED_META } }], error: null } };
}

const CANNED_SEARCH = {
  btc: {
    quotes: [
      { symbol: 'BTC-USD', shortname: 'Bitcoin USD', longname: 'Bitcoin USD', quoteType: 'CRYPTOCURRENCY', typeDisp: 'Cryptocurrency', exchDisp: 'CCC' },
      { symbol: 'BTC', shortname: 'Grayscale Bitcoin Mini Trust (B', longname: 'Grayscale Bitcoin Mini Trust ETF', quoteType: 'ETF', typeDisp: 'ETF', exchDisp: 'NYSEArca' },
      { symbol: 'BTC=F', shortname: 'Bitcoin Futures', quoteType: 'FUTURE', typeDisp: 'Futures', exchDisp: 'CME' },
    ],
  },
  vti: {
    quotes: [
      { symbol: 'VTI', shortname: 'Vanguard Total Stock', quoteType: 'ETF', typeDisp: 'ETF', exchDisp: 'NYSEArca' },
    ],
  },
};

before(async () => {
  process.env.JWT_SECRET = 'test-secret-for-market-tests-only';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-market-test-'));
  process.env.MP_DATA_DIR = dataDir;

  const { createApp } = await import('../src/app.js');
  const { setMarketFetch } = await import('../src/market.js');
  const created = createApp();
  db = created.db;
  server = created.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;

  // Stub the upstream provider: real network is never touched.
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, ...rest) => {
    const u = String(url);
    if (u.includes('query1.finance.yahoo.com')) {
      if (u.includes('/v1/finance/search')) {
        const q = new URL(u).searchParams.get('q') || '';
        const key = q.trim().toLowerCase();
        if (key.includes('nope')) return { ok: true, status: 200, json: async () => ({ quotes: [] }) };
        if (key.includes('btc')) return { ok: true, status: 200, json: async () => CANNED_SEARCH.btc };
        return { ok: true, status: 200, json: async () => CANNED_SEARCH.vti };
      }
      upstreamCalls++;
      if (u.includes('NOPEINVALID')) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (u.includes('SHIB-USD')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            chart: {
              result: [
                {
                  meta: {
                    longName: 'Shiba Inu USD',
                    shortName: 'Shiba Inu',
                    regularMarketPrice: 0.00000591,
                    currency: 'USD',
                    regularMarketTime: 1791230400,
                  },
                },
              ],
              error: null,
            },
          }),
        };
      }
      return { ok: true, status: 200, json: async () => cannedYahooResponse() };
    }
    return realFetch(url, ...rest);
  };
  // market.js resolves fetch lazily, so the global stub is picked up.
  setMarketFetch(null);

  const setup = await realFetch(`${base}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' }),
  });
  assert.equal(setup.status, 201);
  adminToken = (await setup.json()).accessToken;
});

after(() => {
  globalThis.fetch = realFetch;
  if (server) server.close();
  if (db) db.close();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

async function req(method, urlPath, { token, body } = {}) {
  const res = await realFetch(`${base}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function createBrokerage(name, ticker, shares) {
  const cats = await req('GET', '/api/accounts/categories', { token: adminToken });
  assert.equal(cats.status, 200);
  const inv = cats.data.categories.find((c) => c.name === 'Investment');
  assert.ok(inv, 'Investment category seeded');
  const a = await req('POST', '/api/accounts', {
    token: adminToken,
    body: { name, kind: 'brokerage', categoryId: inv.id, isAsset: true },
  });
  assert.equal(a.status, 201);
  const id = a.data.account.id;
  if (ticker) {
    const h = await req('POST', `/api/accounts/${id}/holdings`, {
      token: adminToken,
      body: { ticker, shares, costBasis: shares * 300 },
    });
    assert.equal(h.status, 201);
  }
  return id;
}

test('market quote requires auth', async () => {
  const r = await req('GET', '/api/market/quote?ticker=VTI');
  assert.equal(r.status, 401);
});

test('market quote requires a ticker', async () => {
  const r = await req('GET', '/api/market/quote', { token: adminToken });
  assert.equal(r.status, 400);
});

test('market quote rejects invalid ticker characters', async () => {
  const r = await req('GET', '/api/market/quote?ticker=%3Cscript%3E', { token: adminToken });
  assert.equal(r.status, 400);
});

test('market quote returns name and price', async () => {
  const r = await req('GET', '/api/market/quote?ticker=vti', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.ticker, 'VTI');
  assert.equal(r.data.name, 'Vanguard Total Stock Market ETF');
  assert.equal(r.data.price, 380.6);
  assert.equal(r.data.currency, 'USD');
  assert.ok(r.data.asOf);
});

test('market quotes are always fetched live, never cached', async () => {
  const before = upstreamCalls;
  const first = await req('GET', '/api/market/quote?ticker=VTI', { token: adminToken });
  assert.equal(first.status, 200);
  assert.equal(first.data.cached, false);
  const second = await req('GET', '/api/market/quote?ticker=VTI', { token: adminToken });
  assert.equal(second.status, 200);
  assert.equal(second.data.cached, false);
  assert.equal(upstreamCalls - before, 2, 'each request must hit the provider');
});

test('market quotes keep sub-cent precision', async () => {
  const r = await req('GET', '/api/market/quote?ticker=SHIB-USD', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.price, 0.00000591, 'must not round to $0.00');
});

test('market quote 404s for unknown ticker', async () => {
  const r = await req('GET', '/api/market/quote?ticker=NOPEINVALID', { token: adminToken });
  assert.equal(r.status, 404);
});

test('market batch quotes resolve per ticker', async () => {
  const r = await req('GET', '/api/market/quotes?tickers=VTI,NOPEINVALID', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.quotes.VTI.ok, true);
  assert.equal(r.data.quotes.VTI.price, 380.6);
  assert.equal(r.data.quotes.NOPEINVALID.ok, false);
  assert.ok(r.data.quotes.NOPEINVALID.error);
});

test('market batch requires tickers', async () => {
  const r = await req('GET', '/api/market/quotes', { token: adminToken });
  assert.equal(r.status, 400);
});

test('market search requires auth and a query', async () => {
  const anon = await req('GET', '/api/market/search?q=btc');
  assert.equal(anon.status, 401);

  const missing = await req('GET', '/api/market/search', { token: adminToken });
  assert.equal(missing.status, 400);

  const bad = await req('GET', '/api/market/search?q=%3Cscript%3E', { token: adminToken });
  assert.equal(bad.status, 400);
});

test('market search disambiguates crypto spot from similarly-named funds', async () => {
  const r = await req('GET', '/api/market/search?q=btc', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.query, 'btc');
  const symbols = r.data.results.map((x) => x.symbol);
  assert.ok(symbols.includes('BTC-USD'), 'spot bitcoin offered');
  assert.ok(symbols.includes('BTC'), 'bitcoin ETF offered');
  assert.ok(!symbols.includes('BTC=F'), 'futures filtered out');
  const spot = r.data.results.find((x) => x.symbol === 'BTC-USD');
  assert.equal(spot.name, 'Bitcoin USD');
  assert.equal(spot.type, 'CRYPTOCURRENCY');
});

test('market search returns empty results for nonsense', async () => {
  const r = await req('GET', '/api/market/search?q=nopezzzz', { token: adminToken });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.results, []);
});

test('market quote serves qualified crypto pairs directly', async () => {
  const r = await req('GET', '/api/market/quote?ticker=BTC-USD', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.ticker, 'BTC-USD');
  assert.equal(r.data.currency, 'USD');
  assert.ok(Number.isFinite(r.data.price));
});

test('refresh requires auth', async () => {
  const r = await req('POST', '/api/accounts/refresh-market-values');
  assert.equal(r.status, 401);
});

test('refresh rejects a bad accountIds filter', async () => {
  const r = await req('POST', '/api/accounts/refresh-market-values', {
    token: adminToken,
    body: { accountIds: [] },
  });
  assert.equal(r.status, 400);
});

test('refresh prices a brokerage from live quotes', async () => {
  const id = await createBrokerage('Refresh Brokerage', 'VTI', 10);
  const r = await req('POST', '/api/accounts/refresh-market-values', { token: adminToken });
  assert.equal(r.status, 200);
  assert.ok(r.data.asOfDate);
  const item = r.data.created.find((c) => c.accountId === id);
  assert.ok(item, 'brokerage was created');
  assert.equal(item.newValue, 3806); // 10 x 380.60, rounded to cents server-side

  const snaps = await req('GET', `/api/accounts/${id}/snapshots`, { token: adminToken });
  assert.equal(snaps.status, 200);
  assert.equal(snaps.data.snapshots[0].value, 3806);
  assert.equal(snaps.data.snapshots[0].note, 'auto: market refresh');
});

test('refresh is idempotent within the same day', async () => {
  const before = await req('POST', '/api/accounts/refresh-market-values', { token: adminToken });
  assert.equal(before.status, 200);
  assert.equal(before.data.created.length, 0, 'no duplicate snapshot created');
});

test('refresh overrides a manual entry from today with the market total', async () => {
  const id = await createBrokerage('Manual Brokerage', 'VTI', 5);
  const today = new Date().toISOString().slice(0, 10);
  const manual = await req('POST', `/api/accounts/${id}/snapshots`, {
    token: adminToken,
    body: { value: 1234.56, asOfDate: today, note: 'statement' },
  });
  assert.equal(manual.status, 201);

  const r = await req('POST', '/api/accounts/refresh-market-values', {
    token: adminToken,
    body: { accountIds: [id] },
  });
  assert.equal(r.status, 200);
  // 5 x 380.60 live price
  const item = r.data.updated.find((u) => u.accountId === id);
  assert.ok(item, 'manual entry overridden');
  assert.equal(item.oldValue, 1234.56);
  assert.equal(item.newValue, 1903);
  assert.equal(item.overrodeManual, true);

  const snaps = await req('GET', `/api/accounts/${id}/snapshots`, { token: adminToken });
  assert.equal(snaps.data.snapshots.length, 1, 'still a single row for today');
  assert.equal(snaps.data.snapshots[0].value, 1903);
  assert.equal(snaps.data.snapshots[0].note, 'auto: market refresh');

  // A second run with no price movement writes nothing.
  const again = await req('POST', '/api/accounts/refresh-market-values', {
    token: adminToken,
    body: { accountIds: [id] },
  });
  assert.ok(again.data.unchanged.some((u) => u.accountId === id));
});

test('cash sleeve validates input', async () => {
  const id = await createBrokerage('Cash Validation Brokerage', null, 0);
  const neg = await req('PATCH', `/api/accounts/${id}`, {
    token: adminToken,
    body: { cashBalance: -5 },
  });
  assert.equal(neg.status, 400);

  const badDate = await req('PATCH', `/api/accounts/${id}`, {
    token: adminToken,
    body: { cashBalance: 100, cashUpdatedAt: 'not-a-date' },
  });
  assert.equal(badDate.status, 400);

  const future = await req('PATCH', `/api/accounts/${id}`, {
    token: adminToken,
    body: { cashBalance: 100, cashUpdatedAt: '2999-01-01' },
  });
  assert.equal(future.status, 400);
});

test('cash sleeve is stored and stamped', async () => {
  const id = await createBrokerage('Cash Stamped Brokerage', null, 0);
  const today = new Date().toISOString().slice(0, 10);
  const r = await req('PATCH', `/api/accounts/${id}`, {
    token: adminToken,
    body: { cashBalance: 1500.5 },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.account.cashBalance, 1500.5);
  assert.equal(r.data.account.cashUpdatedAt, today);

  // Date-only patch preserves the balance.
  const r2 = await req('PATCH', `/api/accounts/${id}`, {
    token: adminToken,
    body: { cashUpdatedAt: '2026-01-15' },
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.data.account.cashBalance, 1500.5);
  assert.equal(r2.data.account.cashUpdatedAt, '2026-01-15');
});

test('refresh adds the cash sleeve to the market total', async () => {
  const id = await createBrokerage('Cash Plus Brokerage', 'VTI', 10);
  await req('PATCH', `/api/accounts/${id}`, {
    token: adminToken,
    body: { cashBalance: 500 },
  });
  const r = await req('POST', '/api/accounts/refresh-market-values', {
    token: adminToken,
    body: { accountIds: [id] },
  });
  assert.equal(r.status, 200);
  const item = r.data.created.find((c) => c.accountId === id);
  assert.ok(item, 'account refreshed');
  assert.equal(item.cash, 500);
  assert.equal(item.newValue, 3806 + 500);
});

test('migration adds cash columns to legacy databases', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { ensureCashColumns } = await import('../src/db/database.js');
  const legacy = new DatabaseSync(':memory:');
  legacy.exec('CREATE TABLE accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)');
  ensureCashColumns(legacy);
  const cols = legacy.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  assert.ok(cols.includes('cash_balance'));
  assert.ok(cols.includes('cash_updated_at'));
  ensureCashColumns(legacy); // idempotent
  legacy.close();
});

test('refresh skips holdings without a quote', async () => {
  const id = await createBrokerage('Unknown Ticker Brokerage', 'NOPEINVALID', 7);
  const r = await req('POST', '/api/accounts/refresh-market-values', {
    token: adminToken,
    body: { accountIds: [id] },
  });
  assert.equal(r.status, 200);
  const skip = r.data.skipped.find((s) => s.accountId === id);
  assert.ok(skip, 'unpriceable account skipped');
  assert.match(skip.reason, /NOPEINVALID/);

  const snaps = await req('GET', `/api/accounts/${id}/snapshots`, { token: adminToken });
  assert.equal(snaps.data.snapshots.length, 0, 'no misleading snapshot recorded');
});

test('refresh reports a brokerage with no holdings instead of ignoring it', async () => {
  const id = await createBrokerage('Empty Brokerage', null, 0);

  const full = await req('POST', '/api/accounts/refresh-market-values', { token: adminToken });
  assert.equal(full.status, 200);
  const skip = full.data.skipped.find((s) => s.accountId === id);
  assert.ok(skip, 'holding-less brokerage must be reported, not silent');
  assert.match(skip.reason, /no holdings to price/);

  const explicit = await req('POST', '/api/accounts/refresh-market-values', {
    token: adminToken,
    body: { accountIds: [id] },
  });
  assert.equal(explicit.status, 200);
  assert.ok(explicit.data.skipped.some((s) => s.accountId === id));

  const snaps = await req('GET', `/api/accounts/${id}/snapshots`, { token: adminToken });
  assert.equal(snaps.data.snapshots.length, 0, 'nothing to record without holdings');
});

test('explicit refresh explains unknown, archived and liability accounts', async () => {
  const loan = await req('POST', '/api/accounts', {
    token: adminToken,
    body: { name: 'Car Loan', kind: 'car_loan', isAsset: false },
  });
  assert.equal(loan.status, 201);
  const loanId = loan.data.account.id;

  const arch = await req('POST', '/api/accounts', {
    token: adminToken,
    body: { name: 'Old Brokerage', kind: 'brokerage', isAsset: true },
  });
  const archId = arch.data.account.id;
  await req('PATCH', `/api/accounts/${archId}`, { token: adminToken, body: { archived: true } });

  const r = await req('POST', '/api/accounts/refresh-market-values', {
    token: adminToken,
    body: { accountIds: [999999, loanId, archId] },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.created.length, 0);
  assert.equal(r.data.updated.length, 0);
  const byId = Object.fromEntries(r.data.skipped.map((s) => [s.accountId, s.reason]));
  assert.match(byId[999999] || '', /account not found/);
  assert.match(byId[loanId] || '', /liabilities are not repriced/);
  assert.match(byId[archId] || '', /account is archived/);
});
