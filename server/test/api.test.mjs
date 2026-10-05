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
  assert.equal(snaps.data.hasMore, false);

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

test('any user can edit their own display name', async () => {
  // Members cannot reach /api/users (admin only), but must still manage their
  // own profile.
  const forbidden = await req('GET', '/api/users', { token: memberToken });
  assert.equal(forbidden.status, 403);

  const renamed = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { displayName: 'Casey Spouse' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.user.displayName, 'Casey Spouse');
  assert.equal(renamed.data.user.username, 'spouse', 'username must be unchanged');
  assert.equal(renamed.data.user.role, 'member', 'role must be unchanged');
  assert.equal(renamed.data.passwordChanged, false);

  const me = await req('GET', '/api/auth/me', { token: memberToken });
  assert.equal(me.data.user.displayName, 'Casey Spouse', 'change must persist');

  // Restore, so later tests see the original name.
  await req('PATCH', '/api/auth/me', { token: memberToken, body: { displayName: 'spouse' } });
});

test('profile edits cannot escalate a member to admin', async () => {
  const r = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { displayName: 'Sneaky', role: 'admin', username: 'admin2' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'member', 'role must not be self-editable');
  assert.equal(r.data.user.username, 'spouse', 'username must not be self-editable');
  assert.equal(r.data.user.displayName, 'Sneaky');
  await req('PATCH', '/api/auth/me', { token: memberToken, body: { displayName: 'spouse' } });
});

test('blank display name falls back to the username', async () => {
  const r = await req('PATCH', '/api/auth/me', { token: memberToken, body: { displayName: '   ' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.displayName, 'spouse');
});

test('display name length is validated', async () => {
  const r = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { displayName: 'x'.repeat(81) },
  });
  assert.equal(r.status, 400);
  const nonString = await req('PATCH', '/api/auth/me', { token: memberToken, body: { displayName: 42 } });
  assert.equal(nonString.status, 400);
});

test('changing your own password requires the current one', async () => {
  const noCurrent = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { newPassword: 'brand-new-secret' },
  });
  assert.equal(noCurrent.status, 401);

  const wrongCurrent = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { currentPassword: 'not-my-password', newPassword: 'brand-new-secret' },
  });
  assert.equal(wrongCurrent.status, 401);

  // The failed attempts must not have changed anything.
  const stillWorks = await req('POST', '/api/auth/login', {
    body: { username: 'spouse', password: 'shared-household-1' },
  });
  assert.equal(stillWorks.status, 200);
});

test('rejects a too-short new password', async () => {
  const r = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { currentPassword: 'shared-household-1', newPassword: 'short' },
  });
  assert.equal(r.status, 400);
});

test('changing your own password works and invalidates the old login', async () => {
  const changed = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { currentPassword: 'shared-household-1', newPassword: 'brand-new-secret' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.passwordChanged, true);
  assert.ok(changed.data.accessToken, 'a password change must re-issue the session');

  // The fresh access token works...
  const me = await req('GET', '/api/auth/me', { token: changed.data.accessToken });
  assert.equal(me.status, 200);

  // ...the old password no longer does...
  const oldLogin = await req('POST', '/api/auth/login', {
    body: { username: 'spouse', password: 'shared-household-1' },
  });
  assert.equal(oldLogin.status, 401);

  // ...and the new one does.
  const newLogin = await req('POST', '/api/auth/login', {
    body: { username: 'spouse', password: 'brand-new-secret' },
  });
  assert.equal(newLogin.status, 200);
  memberToken = newLogin.data.accessToken;
});

test('profile edit requires authentication', async () => {
  const r = await req('PATCH', '/api/auth/me', { body: { displayName: 'Anon' } });
  assert.equal(r.status, 401);
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

test('versioned API path works (alias of /api)', async () => {
  const r = await req('GET', '/api/v1/auth/me', { token: adminToken });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.username, 'admin');
});

test('versioned API sets refresh cookie scope correctly', async () => {
  const r = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' }),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get('set-cookie') || '';
  assert.ok(cookie.includes('Path=/api/v1/auth'), `unexpected cookie path: ${cookie}`);
  const me = await req('GET', '/api/v1/auth/me', {
    token: (await r.json()).accessToken,
  });
  assert.equal(me.status, 200);
});

test('snapshot history paginates instead of silently truncating', async () => {
  const created = await req('POST', '/api/accounts', {
    token: adminToken,
    body: { name: 'Pagination Test Account', categoryId: 1, kind: 'savings' },
  });
  assert.equal(created.status, 201);
  const id = created.data.account.id;

  // Five monthly balances, oldest first.
  for (const [i, date] of ['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30', '2025-05-31'].entries()) {
    const r = await req('POST', `/api/accounts/${id}/snapshots`, {
      token: adminToken,
      body: { value: 100 * (i + 1), asOfDate: date },
    });
    assert.equal(r.status, 201);
  }

  const firstPage = await req('GET', `/api/accounts/${id}/snapshots?limit=2`, { token: adminToken });
  assert.equal(firstPage.status, 200);
  assert.equal(firstPage.data.snapshots.length, 2);
  assert.equal(firstPage.data.hasMore, true, 'hasMore must flag the remaining history');
  assert.equal(firstPage.data.limit, 2);
  assert.equal(firstPage.data.offset, 0);
  // Newest first.
  assert.equal(firstPage.data.snapshots[0].value, 500);
  assert.equal(firstPage.data.snapshots[1].value, 400);

  const secondPage = await req('GET', `/api/accounts/${id}/snapshots?limit=2&offset=2`, {
    token: adminToken,
  });
  assert.equal(secondPage.data.snapshots.length, 2);
  assert.equal(secondPage.data.hasMore, true);
  assert.equal(secondPage.data.snapshots[0].value, 300);

  const lastPage = await req('GET', `/api/accounts/${id}/snapshots?limit=2&offset=4`, {
    token: adminToken,
  });
  assert.equal(lastPage.data.snapshots.length, 1);
  assert.equal(lastPage.data.hasMore, false, 'hasMore must be false on the final page');

  // Paging must not lose or duplicate rows: 2 + 2 + 1 = 5 distinct dates.
  const dates = [...firstPage.data.snapshots, ...secondPage.data.snapshots, ...lastPage.data.snapshots].map(
    (s) => s.asOfDate
  );
  assert.equal(dates.length, 5);
  assert.equal(new Set(dates).size, 5);

  // Out-of-range params are rejected rather than silently coerced.
  const badLimit = await req('GET', `/api/accounts/${id}/snapshots?limit=0`, { token: adminToken });
  assert.equal(badLimit.status, 400);
  const hugeLimit = await req('GET', `/api/accounts/${id}/snapshots?limit=5000`, { token: adminToken });
  assert.equal(hugeLimit.status, 400);
  const badOffset = await req('GET', `/api/accounts/${id}/snapshots?offset=-1`, { token: adminToken });
  assert.equal(badOffset.status, 400);
  const nonNumeric = await req('GET', `/api/accounts/${id}/snapshots?limit=abc`, { token: adminToken });
  assert.equal(nonNumeric.status, 400);

  await req('DELETE', `/api/accounts/${id}?permanent=1`, { token: adminToken });
});

test('logout revokes the refresh token so it cannot be replayed', async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' }),
  });
  assert.equal(login.status, 200);
  const setCookies = login.headers.getSetCookie?.() || [];
  const rt = setCookies.find((c) => c.startsWith('mp_rt='));
  const csrf = setCookies.find((c) => c.startsWith('mp_csrf_api='));
  assert.ok(rt, 'expected a refresh cookie');
  assert.ok(csrf, 'expected a CSRF cookie');
  const nonce = csrf.split(';')[0].split('=')[1];

  const cookieHeader = `${rt.split(';')[0]}; ${csrf.split(';')[0]}`;

  // The refresh works while the token is live...
  const refreshed = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookieHeader, 'X-MP-CSRF': nonce },
  });
  assert.equal(refreshed.status, 200);

  // ...but logging out revokes it, so replaying the same cookie fails.
  const out = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookieHeader, 'X-MP-CSRF': nonce },
  });
  assert.equal(out.status, 200);

  const replay = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookieHeader, 'X-MP-CSRF': nonce },
  });
  assert.equal(replay.status, 401, 'a logged-out refresh token must not be reusable');
});

test('refresh token rotation rejects the previous token', async () => {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'correct-horse-battery' }),
  });
  const setCookies = login.headers.getSetCookie?.() || [];
  const rt = setCookies.find((c) => c.startsWith('mp_rt=')).split(';')[0];
  const csrf = setCookies.find((c) => c.startsWith('mp_csrf_api=')).split(';')[0];
  const nonce = csrf.split('=')[1];
  const cookieHeader = `${rt}; ${csrf}`;

  const first = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookieHeader, 'X-MP-CSRF': nonce },
  });
  assert.equal(first.status, 200);

  // Replaying the original cookie after rotation must fail: its jti was revoked.
  const replay = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: cookieHeader, 'X-MP-CSRF': nonce },
  });
  assert.equal(replay.status, 401, 'rotated-out refresh tokens must be revoked');
});

test('bearer-authenticated writes do not need a CSRF token', async () => {
  // requireCsrf exempts Bearer requests: the access token is not readable
  // cross-origin, so those requests cannot be forged by another site.
  const created = await req('POST', '/api/accounts', {
    token: adminToken,
    body: { name: 'No Csrf Needed', categoryId: 1, kind: 'cash' },
  });
  assert.equal(created.status, 201, 'bearer POST without a CSRF header must still succeed');
  const removed = await req('DELETE', `/api/accounts/${created.data.account.id}?permanent=1`, {
    token: adminToken,
  });
  assert.equal(removed.status, 200);
});

test('cookie-authenticated writes without a CSRF token are refused', async () => {
  // No Authorization header, only cookies: exactly what a cross-site form post
  // would look like.
  const res = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: 'mp_rt=whatever' },
  });
  assert.equal(res.status, 403);
});

test('swagger docs.json serves the OpenAPI spec', async () => {
  const r = await fetch(`${base}/api/v1/docs.json`);
  assert.equal(r.status, 200);
  const spec = await r.json();
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(spec.info.title, 'MyPortfolio API');
  // Spot-check a few documented paths exist.
  assert.ok(spec.paths['/auth/login'], 'missing /auth/login path');
  assert.ok(spec.paths['/accounts'], 'missing /accounts path');
  assert.ok(spec.paths['/reports/net-worth'], 'missing /reports/net-worth path');
  assert.ok(spec.components.schemas.Account, 'missing Account schema');
  assert.ok(spec.components.schemas.AuthResponse, 'missing AuthResponse schema');

  // The documented cookie name must match the one the server actually sets.
  const cookieScheme = spec.components.securitySchemes.cookieAuth;
  assert.equal(cookieScheme.name, 'mp_rt', 'cookieAuth must document the real cookie name');
});

test('swagger UI loads at the versioned docs route', async () => {
  const r = await fetch(`${base}/api/v1/docs/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(/swagger-ui/i.test(html), 'expected swagger-ui markup');
});

