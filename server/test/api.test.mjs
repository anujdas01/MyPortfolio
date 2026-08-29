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
let memberToken = '';

before(async () => {
  process.env.JWT_SECRET = 'test-secret-for-unit-tests-only';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-test-'));
  process.env.MP_DATA_DIR = dataDir;

  const { createApp } = await import('../src/app.js');
  const created = createApp();
  db = created.db;
  server = created.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
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

test('health check responds', async () => {
  const r = await req('GET', '/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
});

test('status reports needsSetup before any user exists', async () => {
  const r = await req('GET', '/api/auth/status');
  assert.equal(r.status, 200);
  assert.equal(r.data.needsSetup, true);
});

test('setup rejects weak password', async () => {
  const r = await req('POST', '/api/auth/setup', { body: { username: 'admin', password: 'short' } });
  assert.equal(r.status, 400);
});

test('setup creates first admin and returns tokens', async () => {
  const r = await req('POST', '/api/auth/setup', {
    body: { username: 'Admin', password: 'correct-horse-battery', displayName: 'Owner' },
  });
  assert.equal(r.status, 201);
  assert.ok(r.data.accessToken);
  assert.equal(r.data.user.role, 'admin');
  assert.equal(r.data.user.username, 'admin');
  adminToken = r.data.accessToken;
});

test('second setup attempt is rejected', async () => {
  const r = await req('POST', '/api/auth/setup', { body: { username: 'evil', password: 'password123' } });
  assert.equal(r.status, 409);
});

test('login works with correct credentials', async () => {
  const r = await req('POST', '/api/auth/login', {
    body: { username: 'admin', password: 'correct-horse-battery' },
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.accessToken);
});

test('login rejects wrong password', async () => {
  const r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'wrong-password' } });
  assert.equal(r.status, 401);
});

test('/me requires auth', async () => {
  const r = await req('GET', '/api/auth/me');
  assert.equal(r.status, 401);
});

test('/me returns current user with valid token', async () => {
  const r = await req('GET', '/api/auth/me', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.username, 'admin');
});

test('account validation rejects missing name', async () => {
  const r = await req('POST', '/api/accounts', { token: adminToken, body: {} });
  assert.equal(r.status, 400);
});

test('create checking account + snapshots and read net worth report', async () => {
  const created = await req('POST', '/api/accounts', {
    token: adminToken,
    body: { name: 'Everyday Checking', institution: 'US Bank', categoryId: 1, kind: 'checking' },
  });
  assert.equal(created.status, 201);
  const id = created.data.account.id;
  assert.equal(created.data.account.isAsset, true);

  const s1 = await req('POST', `/api/accounts/${id}/snapshots`, {
    token: adminToken,
    body: { value: 1000, asOfDate: '2026-01-31' },
  });
  assert.equal(s1.status, 201);

  const s2 = await req('POST', `/api/accounts/${id}/snapshots`, {
    token: adminToken,
    body: { value: 1500.5, asOfDate: '2026-02-28' },
  });
  assert.equal(s2.status, 201);

  const snaps = await req('GET', `/api/accounts/${id}/snapshots`, { token: adminToken });
  assert.equal(snaps.data.snapshots.length, 2);
  assert.equal(snaps.data.snapshots[0].value, 1500.5);

  const list = await req('GET', '/api/accounts', { token: adminToken });
  assert.equal(list.data.accounts.length, 1);
  assert.equal(list.data.accounts[0].latestValue, 1500.5);

  const report = await req('GET', '/api/reports/net-worth?range=all', { token: adminToken });
  assert.equal(report.status, 200);
  assert.equal(report.data.current.assets, 1500.5);
  assert.equal(report.data.current.netWorth, 1500.5);
  assert.equal(report.data.series.length, 2);

  const alloc = await req('GET', '/api/reports/allocation', { token: adminToken });
  assert.deepEqual(alloc.data.assets, [{ name: 'Cash', total: 1500.5 }]);
  assert.deepEqual(alloc.data.liabilities, []);
});

test('liability accounts count against net worth', async () => {
  const created = await req('POST', '/api/accounts', {
    token: adminToken,
    body: { name: 'Mortgage', kind: 'mortgage', isAsset: false, categoryId: 6 },
  });
  const id = created.data.account.id;
  await req('POST', `/api/accounts/${id}/snapshots`, {
    token: adminToken,
    body: { value: 200000, asOfDate: '2026-02-28' },
  });
  const report = await req('GET', '/api/reports/net-worth?range=all', { token: adminToken });
  assert.equal(report.data.current.liabilities, 200000);
  assert.equal(report.data.current.netWorth, -198499.5);
});

test('invalid snapshot date is rejected', async () => {
  const list = await req('GET', '/api/accounts', { token: adminToken });
  const id = list.data.accounts[0].id;
  const r = await req('POST', `/api/accounts/${id}/snapshots`, {
    token: adminToken,
    body: { value: 10, asOfDate: '02/28/2026' },
  });
  assert.equal(r.status, 400);
});

test('admin can create member; member cannot access users API', async () => {
  const created = await req('POST', '/api/users', {
    token: adminToken,
    body: { username: 'spouse', password: 'shared-household-1', role: 'member' },
  });
  assert.equal(created.status, 201);

  const login = await req('POST', '/api/auth/login', {
    body: { username: 'spouse', password: 'shared-household-1' },
  });
  memberToken = login.data.accessToken;

  const forbidden = await req('GET', '/api/users', { token: memberToken });
  assert.equal(forbidden.status, 403);

  const allowed = await req('GET', '/api/accounts', { token: memberToken });
  assert.equal(allowed.status, 200);
});

test('cannot delete own account or last admin', async () => {
  const me = await req('GET', '/api/auth/me', { token: adminToken });
  const myId = me.data.user.id;
  const r = await req('DELETE', `/api/users/${myId}`, { token: adminToken });
  assert.equal(r.status, 400);
});

test('theme endpoint validates values', async () => {
  const bad = await req('PUT', '/api/settings/theme', { token: adminToken, body: { theme: 'neon' } });
  assert.equal(bad.status, 400);
  const good = await req('PUT', '/api/settings/theme', { token: adminToken, body: { theme: 'nord' } });
  assert.equal(good.status, 200);
  const me = await req('GET', '/api/auth/me', { token: adminToken });
  assert.equal(me.data.user.themePref, 'nord');
});

test('export endpoints return data', async () => {
  const jsonRes = await fetch(`${base}/api/export?format=json`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(jsonRes.status, 200);
  const dump = JSON.parse(await jsonRes.text());
  assert.equal(dump.accounts.length, 2);
  assert.ok(dump.snapshots.length >= 3);
  assert.ok(!JSON.stringify(dump).includes('password_hash'));

  const csvRes = await fetch(`${base}/api/export?format=csv`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(csvRes.status, 200);
  const csv = await csvRes.text();
  assert.match(csv, /^date,account,institution,category,kind,type,value,note/);
});

test('import rejects bad payloads', async () => {
  const noFormat = await req('POST', '/api/accounts/import', {
    token: adminToken,
    body: { content: 'x' },
  });
  assert.equal(noFormat.status, 400);

  const empty = await req('POST', '/api/accounts/import', {
    token: adminToken,
    body: { format: 'json', content: '   ' },
  });
  assert.equal(empty.status, 400);

  const badJson = await req('POST', '/api/accounts/import', {
    token: adminToken,
    body: { format: 'json', content: '{not json' },
  });
  assert.equal(badJson.status, 400);

  const csvMissingCol = await req('POST', '/api/accounts/import', {
    token: adminToken,
    body: { format: 'csv', content: 'name,value\nFoo,1\n' },
  });
  assert.equal(csvMissingCol.status, 400);
});

test('import round-trips JSON export back into the database', async () => {
  // Grab a fresh JSON dump (contains accounts + snapshots from earlier tests).
  const before = await req('GET', '/api/accounts?includeArchived=1', { token: adminToken });
  const prevCount = before.data.accounts.length;

  const expRes = await fetch(`${base}/api/export?format=json`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const dump = JSON.parse(await expRes.text());

  const r = await req('POST', '/api/accounts/import', {
    token: adminToken,
    body: { format: 'json', content: JSON.stringify(dump) },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.equal(r.data.accountsCreated, dump.accounts.length);
  assert.ok(r.data.snapshotsAdded >= dump.snapshots.length);

  const after = await req('GET', '/api/accounts?includeArchived=1', { token: adminToken });
  assert.equal(after.data.accounts.length, prevCount + dump.accounts.length);

  // Spot-check that a re-imported account carries its balances.
  const sample = dump.accounts[0];
  const created = after.data.accounts.find((a) => a.name === sample.name && a.institution === sample.institution);
  assert.ok(created, 're-imported account should exist');
  const snaps = await req('GET', `/api/accounts/${created.id}/snapshots`, { token: adminToken });
  assert.ok(snaps.data.snapshots.length >= 1);
});

test('import round-trips CSV export and preserves values/types', async () => {
  const expRes = await fetch(`${base}/api/export?format=csv`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const csv = await expRes.text();
  const dataRows = csv.trim().split('\n').length - 1;
  assert.ok(dataRows > 0);

  const r = await req('POST', '/api/accounts/import', {
    token: adminToken,
    body: { format: 'csv', content: csv },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, true);
  assert.ok(r.data.accountsCreated >= 1);
  assert.equal(r.data.snapshotsAdded, dataRows - r.data.snapshotsSkipped);

  // A liability row must come back as a liability account.
  const liabilityLine = csv.split('\n').find((l) => l.toLowerCase().includes(',liability,'));
  if (liabilityLine) {
    const cells = liabilityLine.split(',');
    const name = cells[1].replace(/^"|"$/g, '');
    const list = await req('GET', '/api/accounts?includeArchived=1', { token: adminToken });
    const match = list.data.accounts.find((a) => a.name === name);
    assert.ok(match, 'imported liability account exists');
    assert.equal(match.isAsset, false);
  }
});

test('reset-data requires admin password and wipes portfolio data', async () => {
  // Member is forbidden outright.
  const forbidden = await req('POST', '/api/settings/reset-data', { token: memberToken, body: { password: 'x' } });
  assert.equal(forbidden.status, 403);

  // Admin without password / wrong password is rejected.
  const noPass = await req('POST', '/api/settings/reset-data', { token: adminToken, body: {} });
  assert.equal(noPass.status, 400);
  const badPass = await req('POST', '/api/settings/reset-data', { token: adminToken, body: { password: 'wrong-password' } });
  assert.equal(badPass.status, 401);

  const accountsBefore = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  const snapsBefore = db.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').get().n;
  assert.ok(accountsBefore > 0 && snapsBefore > 0);

  // Correct admin password performs the reset.
  const ok = await req('POST', '/api/settings/reset-data', {
    token: adminToken,
    body: { password: 'correct-horse-battery' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.ok, true);
  assert.equal(ok.data.deletedAccounts, accountsBefore);
  assert.equal(ok.data.deletedSnapshots, snapsBefore);

  const accountsAfter = db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n;
  const snapsAfter = db.prepare('SELECT COUNT(*) AS n FROM balance_snapshots').get().n;
  assert.equal(accountsAfter, 0);
  assert.equal(snapsAfter, 0);
});

test('unknown api route 404s', async () => {
  const r = await req('GET', '/api/nope', { token: adminToken });
  assert.equal(r.status, 404);
});
