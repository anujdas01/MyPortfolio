import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import {
  parseRobinhoodCsv,
  parseRobinhoodMoney,
  parseRobinhoodDate,
  parseCsvRows,
} from '../src/robinhood.js';

// Realistic activity-report sample: quoted multiline description, $ amounts,
// (parenthesized) cash-out rows, fractional DRIP shares, a fully-sold ticker
// and a cash transfer row.
const SAMPLE_CSV = `"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
"1/10/2022","1/10/2022","1/11/2022","AAPL","Apple Inc.","Buy","10","$150.00","($1,500.00)"
"2/14/2022","2/14/2022","2/15/2022","AAPL","Apple Inc.","Buy","5","$160.00","($800.00)"
"3/21/2022","3/21/2022","3/22/2022","AAPL","Apple Inc.","Sell","3","$170.00","$510.00"
"4/04/2022","4/04/2022","4/04/2022","AAPL","Cash Div: R/D 2022-03-01 P/D 2022-04-04 - 15 shares at 0.23","CDIV","","","$3.45"
"5/02/2022","5/02/2022","5/03/2022","MSFT","Microsoft
CUSIP: 594918104
Dividend Reinvestment","Buy","0.060732","$333.76","($20.27)"
"5/02/2022","5/02/2022","5/02/2022","MSFT","Cash Div: R/D 2022-04-01 P/D 2022-05-02 - 10 shares at 0.68","CDIV","","","$6.80"
"6/01/2022","6/01/2022","6/01/2022","MSFT","Interest on uninvested cash balance","INT","","","$1.12"
"7/11/2022","7/11/2022","7/12/2022","HOOD","Robinhood Markets, Inc.","Buy","20","$10.00","($200.00)"
"8/15/2022","8/15/2022","8/16/2022","HOOD","Robinhood Markets, Inc.","Sell","20","$12.00","$240.00"
"9/01/2022","9/01/2022","9/01/2022","","ACH deposit from bank","ACH","","","$5,000.00"`;

describe('robinhood csv primitives', () => {
  test('money parses $, commas and parentheses', () => {
    assert.equal(parseRobinhoodMoney('$1,500.00'), 1500);
    assert.equal(parseRobinhoodMoney('($1,500.00)'), -1500);
    assert.equal(parseRobinhoodMoney('$510.00'), 510);
    assert.equal(parseRobinhoodMoney(''), null);
    assert.equal(parseRobinhoodMoney('n/a'), null);
  });

  test('dates parse M/D/YYYY and ISO', () => {
    assert.equal(parseRobinhoodDate('9/18/2023'), '2023-09-18');
    assert.equal(parseRobinhoodDate('1/5/2022'), '2022-01-05');
    assert.equal(parseRobinhoodDate('2022-04-04'), '2022-04-04');
    assert.equal(parseRobinhoodDate('2/30/2022'), null);
    assert.equal(parseRobinhoodDate('garbage'), null);
  });

  test('csv rows survive multiline quoted fields', () => {
    const rows = parseCsvRows('"a","x\ny","b"\n"1","2","3"\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0][1], 'x\ny');
  });
});

describe('robinhood activity parser', () => {
  test('builds positions with average-cost accounting', () => {
    const p = parseRobinhoodCsv(SAMPLE_CSV);
    const aapl = p.positions.find((x) => x.ticker === 'AAPL');
    assert.ok(aapl);
    assert.equal(aapl.shares, 12);
    assert.equal(aapl.costBasis, 1840); // (1500+800) * 12/15
    assert.ok(Math.abs(aapl.avgCost - 1840 / 12) < 1e-9, 'full-precision average, not cents');
    assert.equal(aapl.buys, 2);
    assert.equal(aapl.sells, 1);
    assert.equal(aapl.name, 'Apple Inc.');

    const msft = p.positions.find((x) => x.ticker === 'MSFT');
    assert.ok(msft);
    assert.equal(msft.shares, 0.060732);
    assert.equal(msft.costBasis, 20.27);
    assert.ok(Math.abs(msft.avgCost - 20.27 / 0.060732) < 1e-9);
    assert.equal(msft.dripBuys, 1);
    assert.equal(msft.name, 'Microsoft', 'first description line becomes the name');
  });

  test('collects dividends, interest and closed positions', () => {
    const p = parseRobinhoodCsv(SAMPLE_CSV);
    assert.equal(p.income.length, 3);
    assert.deepEqual(
      p.income.map((e) => [e.type, e.amount, e.asOfDate, e.ticker]),
      [
        ['dividend', 3.45, '2022-04-04', 'AAPL'],
        ['dividend', 6.8, '2022-05-02', 'MSFT'],
        ['interest', 1.12, '2022-06-01', 'MSFT'],
      ]
    );
    assert.equal(p.closedPositions.length, 1);
    assert.equal(p.closedPositions[0].ticker, 'HOOD');
    assert.deepEqual(p.ignored, [{ code: 'ACH', count: 1 }]);
    assert.equal(p.stats.rows, 10);
    assert.equal(p.stats.dividends, 2);
    assert.equal(p.stats.interest, 1);
  });

  test('sub-cent crypto averages survive (SHIB case)', () => {
    const csv =
      `"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"\n` +
      `"1/10/2024","1/10/2024","1/11/2024","SHIB-USD","Shiba Inu","Buy","203086472","$0.00000591","($1,200.24)"\n`;
    const p = parseRobinhoodCsv(csv);
    assert.equal(p.positions.length, 1);
    assert.equal(p.positions[0].shares, 203086472);
    assert.ok(p.positions[0].avgCost > 0, 'must not round to $0.00');
    assert.ok(Math.abs(p.positions[0].avgCost - 0.00000591) < 1e-12);
  });

  test('rejects non-robinhood files with a helpful error', () => {
    assert.throws(() => parseRobinhoodCsv('name,price\nAAPL,100\n'), /missing columns/);
    assert.throws(() => parseRobinhoodCsv('   '), /empty/);
    assert.throws(() => parseRobinhoodCsv('"Activity Date","Instrument"\n"1/1/2022","AAPL"\n'), /missing columns/);
  });

  test('flags sells beyond recorded buys instead of going negative', () => {
    const csv =
      `"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"\n` +
      `"1/10/2022","1/10/2022","1/11/2022","TSLA","Tesla","Sell","5","$100.00","$500.00"\n`;
    const p = parseRobinhoodCsv(csv);
    assert.equal(p.positions.length, 0);
    assert.equal(p.closedPositions.length, 1);
    assert.equal(p.closedPositions[0].shares, 0);
    assert.ok(p.warnings.some((w) => /full history/.test(w)));
  });
});

// ---- HTTP layer: dry-run, apply, idempotent re-import ------------------------

let server;
let db;
let base;
let dataDir;
let adminToken = '';
let accountId = 0;

before(async () => {
  process.env.JWT_SECRET = 'test-secret-for-robinhood-tests-only';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-rh-test-'));
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
    body: { name: 'Robinhood Brokerage', kind: 'brokerage', categoryId: inv.id, isAsset: true },
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

test('robinhood import requires auth and a real account', async () => {
  const anon = await req('POST', `/api/accounts/${accountId}/import/robinhood`, {
    body: { content: SAMPLE_CSV, dryRun: true },
  });
  assert.equal(anon.status, 401);

  const missing = await req('POST', '/api/accounts/99999/import/robinhood', {
    token: adminToken,
    body: { content: SAMPLE_CSV, dryRun: true },
  });
  assert.equal(missing.status, 404);
});

test('robinhood import rejects non-csv content', async () => {
  const empty = await req('POST', `/api/accounts/${accountId}/import/robinhood`, {
    token: adminToken,
    body: { content: '   ', dryRun: true },
  });
  assert.equal(empty.status, 400);

  const wrong = await req('POST', `/api/accounts/${accountId}/import/robinhood`, {
    token: adminToken,
    body: { content: 'ticker,shares\nAAPL,10\n', dryRun: true },
  });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /Robinhood/);
});

test('dry run previews without saving anything', async () => {
  const r = await req('POST', `/api/accounts/${accountId}/import/robinhood`, {
    token: adminToken,
    body: { content: SAMPLE_CSV, dryRun: true },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.dryRun, true);
  assert.equal(r.data.positions.length, 2);
  assert.equal(r.data.income.length, 3);

  const holdings = await req('GET', `/api/accounts/${accountId}/holdings`, { token: adminToken });
  assert.equal(holdings.data.holdings.length, 0, 'dry run must not persist');
  const income = await req('GET', `/api/accounts/${accountId}/income`, { token: adminToken });
  assert.equal(income.data.income.length, 0, 'dry run must not persist');
});

test('apply creates holdings and linked income', async () => {
  const r = await req('POST', `/api/accounts/${accountId}/import/robinhood`, {
    token: adminToken,
    body: { content: SAMPLE_CSV },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.dryRun, false);
  assert.equal(r.data.holdingsCreated, 2);
  assert.equal(r.data.holdingsUpdated, 0);
  assert.equal(r.data.incomeAdded, 3);
  assert.equal(r.data.incomeSkipped, 0);
  assert.deepEqual(
    r.data.closedPositions.map((c) => c.ticker),
    ['HOOD']
  );

  const holdings = await req('GET', `/api/accounts/${accountId}/holdings`, { token: adminToken });
  const byTicker = Object.fromEntries(holdings.data.holdings.map((h) => [h.ticker, h]));
  assert.equal(byTicker.AAPL.shares, 12);
  assert.equal(byTicker.AAPL.costBasis, 1840);
  assert.equal(byTicker.MSFT.name, 'Microsoft');

  const income = await req('GET', `/api/accounts/${accountId}/income`, { token: adminToken });
  assert.equal(income.data.income.length, 3);
  const div = income.data.income.find((e) => e.type === 'dividend' && e.amount === 3.45);
  assert.ok(div);
  assert.equal(div.holdingId, byTicker.AAPL.id, 'income links to the holding');
});

const XYZ_SOLD_OUT_CSV = `"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
"1/05/2023","1/05/2023","1/06/2023","XYZ","Xyz Corp","Buy","10","$100.00","($1,000.00)"
"6/05/2023","6/05/2023","6/06/2023","XYZ","Xyz Corp","Sell","10","$110.00","$1,100.00"`;

const ABC_SELL_ONLY_CSV = `"Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
"6/05/2023","6/05/2023","6/06/2023","ABC","Abc Corp","Sell","5","$50.00","$250.00"`;

async function addHolding(ticker, shares, costBasis) {
  const r = await req('POST', `/api/accounts/${accountId}/holdings`, {
    token: adminToken,
    body: { ticker, shares, costBasis },
  });
  assert.equal(r.status, 201);
}

async function tickers() {
  const r = await req('GET', `/api/accounts/${accountId}/holdings`, { token: adminToken });
  return r.data.holdings.map((h) => h.ticker).sort();
}

test('re-importing the same file is safe', async () => {
  const r = await req('POST', `/api/accounts/${accountId}/import/robinhood`, {
    token: adminToken,
    body: { content: SAMPLE_CSV },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.holdingsCreated, 0);
  assert.equal(r.data.holdingsUpdated, 2);
  assert.equal(r.data.incomeAdded, 0, 'no duplicate income');
  assert.equal(r.data.incomeSkipped, 3);

  const holdings = await req('GET', `/api/accounts/${accountId}/holdings`, { token: adminToken });
  assert.equal(holdings.data.holdings.length, 2, 'no duplicate holdings');
  const income = await req('GET', `/api/accounts/${accountId}/income`, { token: adminToken });
  assert.equal(income.data.income.length, 3, 'no duplicate income');
});

test('apply removes fully-sold positions with buy history', async () => {
  await addHolding('XYZ', 10, 1000);
  assert.ok((await tickers()).includes('XYZ'));

  const r = await req('POST', `/api/accounts/${accountId}/import/robinhood`, {
    token: adminToken,
    body: { content: XYZ_SOLD_OUT_CSV },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.data.holdingsRemoved.map((h) => h.ticker),
    ['XYZ']
  );
  assert.ok(!(await tickers()).includes('XYZ'), 'sold-out holding deleted');
});

test('apply keeps holdings when the file shows sells without buys', async () => {
  await addHolding('ABC', 50, 2500);

  const r = await req('POST', `/api/accounts/${accountId}/import/robinhood`, {
    token: adminToken,
    body: { content: ABC_SELL_ONLY_CSV },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.holdingsRemoved.length, 0, 'partial history must not delete');
  assert.ok((await tickers()).includes('ABC'), 'live holding preserved');
  assert.ok(r.data.warnings.some((w) => /no recorded buys/.test(w)));
});

test('dry run lists exactly what would be removed', async () => {
  await addHolding('HOOD', 5, 50);
  const r = await req('POST', `/api/accounts/${accountId}/import/robinhood`, {
    token: adminToken,
    body: { content: SAMPLE_CSV, dryRun: true },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.pendingRemovals, ['HOOD']);
  assert.ok((await tickers()).includes('HOOD'), 'dry run removes nothing');
});
