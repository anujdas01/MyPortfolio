import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

// Holdings asset-type coverage (stocks vs crypto grouping): explicit types,
// ticker-suffix auto-detection, re-derivation on ticker change, and the
// legacy-DB migration.
let server;
let db;
let base;
let dataDir;
let adminToken = '';
let accountId = 0;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-for-holdings-tests-only';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-holdings-test-'));
  process.env.MP_DATA_DIR = dataDir;

  const { createApp } = await import('../src/app.js');
  const created = createApp();
  db = created.db;
  server = created.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;

  const setup = await req('POST', '/api/auth/setup', {
    body: { username: 'owner', password: 'correct-horse-battery' },
  });
  assert.equal(setup.status, 201);
  adminToken = setup.data.accessToken;

  const cats = await req('GET', '/api/accounts/categories', { token: adminToken });
  const inv = cats.data.categories.find((c) => c.name === 'Investment');
  const a = await req('POST', '/api/accounts', {
    token: adminToken,
    body: { name: 'Holdings Brokerage', kind: 'brokerage', categoryId: inv.id, isAsset: true },
  });
  assert.equal(a.status, 201);
  accountId = a.data.account.id;
});

after(() => {
  if (server) server.close();
  if (db) db.close();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {}
});

async function req(method, urlPath, { body, token } = {}) {
  const res = await fetch(`${base}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function addHolding(body) {
  return req('POST', `/api/accounts/${accountId}/holdings`, { token: adminToken, body });
}

test('explicit asset types are stored and returned', async () => {
  const r = await addHolding({ ticker: 'VTI', shares: 10, costBasis: 2000, assetType: 'ETF' });
  assert.equal(r.status, 201);
  assert.equal(r.data.holding.assetType, 'ETF');

  const list = await req('GET', `/api/accounts/${accountId}/holdings`, { token: adminToken });
  assert.ok(list.data.holdings.some((h) => h.ticker === 'VTI' && h.assetType === 'ETF'));
});

test('crypto pairs auto-detect without an explicit type', async () => {
  const r = await addHolding({ ticker: 'BTC-USD', shares: 0.5, costBasis: 30000 });
  assert.equal(r.status, 201);
  assert.equal(r.data.holding.assetType, 'CRYPTOCURRENCY');
});

test('plain stock tickers stay untyped', async () => {
  const r = await addHolding({ ticker: 'AAPL', shares: 5, costBasis: 800 });
  assert.equal(r.status, 201);
  assert.equal(r.data.holding.assetType, null);

  // Dashed stock tickers (BRK-B) must not be mistaken for crypto pairs.
  const brk = await addHolding({ ticker: 'BRK-B', shares: 2, costBasis: 700 });
  assert.equal(brk.status, 201);
  assert.equal(brk.data.holding.assetType, null);
});

test('invalid asset types are rejected', async () => {
  const r = await addHolding({ ticker: 'MSFT', shares: 1, costBasis: 100, assetType: 'YACHT' });
  assert.equal(r.status, 400);
});

test('ticker changes re-derive the type', async () => {
  const created = await addHolding({ ticker: 'VTI', shares: 1, costBasis: 200, assetType: 'ETF' });
  const id = created.data.holding.id;

  // Same ticker, untouched type stays.
  const kept = await req('PATCH', `/api/accounts/${accountId}/holdings/${id}`, {
    token: adminToken,
    body: { shares: 2 },
  });
  assert.equal(kept.status, 200);
  assert.equal(kept.data.holding.assetType, 'ETF');

  // Ticker swap without an explicit type re-derives (stock -> crypto).
  const swapped = await req('PATCH', `/api/accounts/${accountId}/holdings/${id}`, {
    token: adminToken,
    body: { ticker: 'ETH-USD' },
  });
  assert.equal(swapped.status, 200);
  assert.equal(swapped.data.holding.ticker, 'ETH-USD');
  assert.equal(swapped.data.holding.assetType, 'CRYPTOCURRENCY');

  // Explicit "auto" resets a manual type back to detection.
  const reset = await req('PATCH', `/api/accounts/${accountId}/holdings/${id}`, {
    token: adminToken,
    body: { ticker: 'VTI', assetType: '' },
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.holding.assetType, null);

  const bad = await req('PATCH', `/api/accounts/${accountId}/holdings/${id}`, {
    token: adminToken,
    body: { assetType: 'YACHT' },
  });
  assert.equal(bad.status, 400);
});

test('migration adds asset_type to legacy holdings tables', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { ensureHoldingsAssetType } = await import('../src/db/database.js');
  const legacy = new DatabaseSync(':memory:');
  legacy.exec(
    'CREATE TABLE holdings (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL, ticker TEXT NOT NULL)'
  );
  ensureHoldingsAssetType(legacy);
  const cols = legacy.prepare('PRAGMA table_info(holdings)').all().map((c) => c.name);
  assert.ok(cols.includes('asset_type'));
  ensureHoldingsAssetType(legacy); // idempotent
  legacy.close();
});

test('export/import round-trips holdings and income with remapped ids', async () => {
  const a = await req('POST', '/api/accounts', {
    token: adminToken,
    body: { name: 'Backup Brokerage', kind: 'brokerage', isAsset: true, cashBalance: 250 },
  });
  assert.equal(a.status, 201);
  const srcId = a.data.account.id;
  assert.equal(a.data.account.cashBalance, 250);

  const h = await req('POST', `/api/accounts/${srcId}/holdings`, {
    token: adminToken,
    body: { ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', shares: 10, costBasis: 2000, assetType: 'ETF' },
  });
  assert.equal(h.status, 201);
  const holdingId = h.data.holding.id;

  const inc = await req('POST', `/api/accounts/${srcId}/income`, {
    token: adminToken,
    body: { type: 'dividend', amount: 42.5, asOfDate: '2024-05-01', holdingId, note: 'May payout' },
  });
  assert.equal(inc.status, 201);

  const exp = await req('GET', '/api/export?format=json', { token: adminToken });
  assert.equal(exp.status, 200);
  assert.ok(exp.data.summary.totalHoldings >= 1);
  assert.ok(exp.data.summary.totalIncomeEvents >= 1);
  assert.ok(exp.data.holdings.some((x) => x.ticker === 'VTI' && x.account_id === srcId));
  assert.ok(exp.data.incomeEvents.some((x) => x.amount === 42.5 && x.account_id === srcId));

  // Import the dump back: everything is recreated under fresh ids.
  const imp = await req('POST', '/api/accounts/import', {
    token: adminToken,
    body: { format: 'json', content: JSON.stringify(exp.data) },
  });
  assert.equal(imp.status, 200);
  assert.ok(imp.data.holdingsCreated >= 1, 'holdings restored');
  assert.ok(imp.data.incomeAdded >= 1, 'income restored');

  const list = await req('GET', '/api/accounts', { token: adminToken });
  const copies = list.data.accounts.filter((x) => x.name === 'Backup Brokerage' && x.id !== srcId);
  assert.equal(copies.length, 1, 'exactly one restored copy');
  assert.equal(copies[0].cashBalance, 250, 'cash sleeve restored');

  const restoredHoldings = await req('GET', `/api/accounts/${copies[0].id}/holdings`, { token: adminToken });
  const vti = restoredHoldings.data.holdings.find((x) => x.ticker === 'VTI');
  assert.ok(vti, 'holding restored');
  assert.equal(vti.shares, 10);
  assert.equal(vti.costBasis, 2000);
  assert.equal(vti.assetType, 'ETF');

  const restoredIncome = await req('GET', `/api/accounts/${copies[0].id}/income`, { token: adminToken });
  assert.equal(restoredIncome.data.income.length, 1);
  assert.equal(restoredIncome.data.income[0].amount, 42.5);
  assert.equal(restoredIncome.data.income[0].holdingId, vti.id, 'income re-linked to the new holding');
});
