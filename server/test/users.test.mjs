import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

// Login-name (username) change coverage: self-service via PATCH /auth/me and
// admin renames via PATCH /users/:id. Lives in its own file so the login
// rate-limit budget (10 attempts / 15 min per server) is never shared with
// the broader API suite.
let server;
let db;
let base;
let dataDir;
let adminToken = '';
let memberToken = '';
let memberId = 0;
const MEMBER_PASSWORD = 'shared-household-1';

before(async () => {
  process.env.JWT_SECRET = 'test-secret-for-user-tests-only';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-users-test-'));
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

  const created2 = await req('POST', '/api/users', {
    token: adminToken,
    body: { username: 'spouse', password: MEMBER_PASSWORD, role: 'member' },
  });
  assert.equal(created2.status, 201);
  memberId = created2.data.user.id;

  const login = await req('POST', '/api/auth/login', {
    body: { username: 'spouse', password: MEMBER_PASSWORD },
  });
  assert.equal(login.status, 200);
  memberToken = login.data.accessToken;
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

test('changing your own login name requires the current password', async () => {
  const noCurrent = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { username: 'casey' },
  });
  assert.equal(noCurrent.status, 401);

  const wrongCurrent = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { username: 'casey', currentPassword: 'not-my-password' },
  });
  assert.equal(wrongCurrent.status, 401);

  // The failed attempts must not have changed anything.
  const me = await req('GET', '/api/auth/me', { token: memberToken });
  assert.equal(me.data.user.username, 'spouse');
});

test('login name format and uniqueness are validated', async () => {
  const badFormat = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { username: 'x', currentPassword: MEMBER_PASSWORD },
  });
  assert.equal(badFormat.status, 400);

  const taken = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { username: 'owner', currentPassword: MEMBER_PASSWORD },
  });
  assert.equal(taken.status, 409);
});

test('changing your own login name works and re-issues the session', async () => {
  const changed = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { username: 'Casey', currentPassword: MEMBER_PASSWORD },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.usernameChanged, true);
  assert.equal(changed.data.user.username, 'casey', 'usernames are stored lowercase');
  assert.ok(changed.data.accessToken, 'a login-name change must re-issue the session');

  // The fresh access token works...
  const me = await req('GET', '/api/auth/me', { token: changed.data.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, 'casey');

  // ...the old login name no longer does...
  const oldLogin = await req('POST', '/api/auth/login', {
    body: { username: 'spouse', password: MEMBER_PASSWORD },
  });
  assert.equal(oldLogin.status, 401);

  // ...and the new one does.
  const newLogin = await req('POST', '/api/auth/login', {
    body: { username: 'casey', password: MEMBER_PASSWORD },
  });
  assert.equal(newLogin.status, 200);
  memberToken = newLogin.data.accessToken;

  // Restore, so later tests see the original login name.
  const restored = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { username: 'spouse', currentPassword: MEMBER_PASSWORD },
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.user.username, 'spouse');
  memberToken = restored.data.accessToken;
});

test('a same-name change is a harmless no-op', async () => {
  const r = await req('PATCH', '/api/auth/me', {
    token: memberToken,
    body: { username: 'SPOUSE' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.usernameChanged || false, false);
  assert.equal(r.data.user.username, 'spouse');
});

test('members cannot rename anyone via the admin endpoint', async () => {
  const r = await req('PATCH', `/api/users/${memberId}`, {
    token: memberToken,
    body: { username: 'sneaky' },
  });
  assert.equal(r.status, 403);
});

test('admin can rename a household member', async () => {
  const badFormat = await req('PATCH', `/api/users/${memberId}`, {
    token: adminToken,
    body: { username: '!!' },
  });
  assert.equal(badFormat.status, 400);

  const taken = await req('PATCH', `/api/users/${memberId}`, {
    token: adminToken,
    body: { username: 'owner' },
  });
  assert.equal(taken.status, 409);

  const renamed = await req('PATCH', `/api/users/${memberId}`, {
    token: adminToken,
    body: { username: 'Partner' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.user.username, 'partner');

  // The renamed login works immediately.
  const login = await req('POST', '/api/auth/login', {
    body: { username: 'partner', password: MEMBER_PASSWORD },
  });
  assert.equal(login.status, 200);

  // Restore, so later tests see the original login name.
  const restored = await req('PATCH', `/api/users/${memberId}`, {
    token: adminToken,
    body: { username: 'spouse' },
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.data.user.username, 'spouse');
});
