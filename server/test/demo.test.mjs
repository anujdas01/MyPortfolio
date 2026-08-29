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
let demoToken = '';
let adminToken = '';
let demoCookie = '';

before(async () => {
  process.env.JWT_SECRET = 'test-secret-for-demo-tests-only';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-demo-test-'));
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
  return { status: res.status, data, setCookie: res.headers.getSetCookie?.() || [] };
}

test('demo-login issues a session without credentials', async () => {
  const r = await req('POST', '/api/demo/auth/demo-login', { body: {} });
  assert.equal(r.status, 200);
  assert.ok(r.data.accessToken);
  assert.equal(r.data.user.username, 'demo');
  assert.equal(r.data.user.role, 'admin');
  demoToken = r.data.accessToken;
});

test('demo refresh cookie is scoped to the demo mount', async () => {
  const r = await req('POST', '/api/demo/auth/demo-login', { body: {} });
  const cookie = r.setCookie.find((c) => c.startsWith('mp_rt='));
  assert.ok(cookie, 'expected a refresh cookie');
  assert.ok(cookie.includes('Path=/api/demo/auth'), `cookie path wrong: ${cookie}`);
  demoCookie = cookie.split(';')[0];
});

test('demo environment is seeded with 8 years of sample data', async () => {
  const r = await req('GET', '/api/demo/accounts', { token: demoToken });
  assert.equal(r.status, 200);
  assert.ok(r.data.accounts.length >= 7, 'expected the sample accounts to be seeded');
  assert.ok(r.data.accounts.some((a) => a.name === 'Everyday Checking'));

  const report = await req('GET', '/api/demo/reports/net-worth?range=all', { token: demoToken });
  assert.equal(report.status, 200);
  const { series, current } = report.data;
  assert.ok(series.length >= 90, `expected ~96 monthly points, got ${series.length}`);
  assert.ok(current.netWorth > 0);

  // Oldest point should be roughly 8 years back.
  const oldest = new Date(`${series[0].date}T00:00:00Z`);
  const yearsBack = (Date.now() - oldest.getTime()) / (365.25 * 24 * 3600 * 1000);
  assert.ok(yearsBack > 7.5 && yearsBack < 8.5, `oldest snapshot ${series[0].date} not ~8 years old`);
});

test('demo login endpoint does not exist on the real API', async () => {
  const r = await req('POST', '/api/auth/demo-login', { body: {} });
  assert.equal(r.status, 404);
});

test('real database stays empty while demo has data', async () => {
  const realStatus = await req('GET', '/api/auth/status');
  assert.equal(realStatus.data.needsSetup, true);

  // Create the real admin and confirm no demo accounts leaked over.
  const setup = await req('POST', '/api/auth/setup', {
    body: { username: 'owner', password: 'correct-horse-battery' },
  });
  adminToken = setup.data.accessToken;

  const realAccounts = await req('GET', '/api/accounts', { token: adminToken });
  assert.equal(realAccounts.status, 200);
  assert.equal(realAccounts.data.accounts.length, 0);
});

test('demo tokens are rejected on the real API', async () => {
  const r = await req('GET', '/api/accounts', { token: demoToken });
  assert.equal(r.status, 401);

  const me = await req('GET', '/api/auth/me', { token: demoToken });
  assert.equal(me.status, 401);
});

test('demo refresh flow works on the demo mount', async () => {
  const res = await fetch(`${base}/api/demo/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: demoCookie },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.accessToken);
  assert.equal(data.user.username, 'demo');

  // The refreshed access token keeps working against the demo API...
  const accounts = await req('GET', '/api/demo/accounts', { token: data.accessToken });
  assert.equal(accounts.status, 200);
});

test('main-mount refresh rejects a demo-scoped refresh cookie', async () => {
  const res = await fetch(`${base}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: demoCookie },
  });
  assert.equal(res.status, 401);
});

test('demo reset-data restores the sample data without a password', async () => {
  // Add an account so there is something to wipe.
  const created = await req('POST', '/api/demo/accounts', {
    token: demoToken,
    body: { name: 'Customer Scratch Account', categoryId: 1, isAsset: true },
  });
  assert.equal(created.status, 201);

  const before = await req('GET', '/api/demo/accounts', { token: demoToken });
  const countBefore = before.data.accounts.length;

  const reset = await req('POST', '/api/demo/settings/reset-data', { token: demoToken, body: {} });
  assert.equal(reset.status, 200);
  assert.equal(reset.data.reseeded, true);

  const after = await req('GET', '/api/demo/accounts', { token: demoToken });
  assert.equal(after.status, 200);
  assert.ok(!after.data.accounts.some((a) => a.name === 'Customer Scratch Account'));
  assert.equal(after.data.accounts.length + 1, countBefore); // back to the seeded set
});
