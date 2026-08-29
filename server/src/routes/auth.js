import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { requireAuth } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { requireFields } from '../utils/validate.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  setRefreshCookie,
  clearRefreshCookie,
  revokeRefreshToken,
  REFRESH_COOKIE,
  MAIN_SCOPE,
  DEMO_SCOPE,
} from '../utils/tokens.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const loginAttempts = new Map();

function pruneAttempts() {
  const now = Date.now();
  for (const [k, rec] of loginAttempts) {
    if (now - rec.firstAt > WINDOW_MS) loginAttempts.delete(k);
  }
}

function rateLimit(req) {
  pruneAttempts();
  const key = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  rec.count += 1;
  if (rec.count > MAX_ATTEMPTS) {
    throw new HttpError(429, 'Too many attempts. Try again later.');
  }
}

export function sanitizeUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    themePref: u.theme_pref,
  };
}

export function issueSession(res, user, scope = MAIN_SCOPE, cookiePath = '/api/auth') {
  setRefreshCookie(res, signRefreshToken(user, scope), cookiePath);
  return { accessToken: signAccessToken(user, scope), user: sanitizeUser(user) };
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function assertNewUser(username, password) {
  if (!USERNAME_RE.test(String(username))) {
    throw new HttpError(400, 'Username must be 3-32 characters (letters, numbers, _ . -)');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'Password must be at least 8 characters');
  }
}

// opts.basePath: mount prefix (used for the refresh cookie path)
// opts.demo:     when true, this router serves the isolated demo environment
export default function authRoutes(db, opts = {}) {
  const { basePath = '/api', demo = false } = opts;
  const cookiePath = `${basePath}/auth`;
  const scope = demo ? DEMO_SCOPE : MAIN_SCOPE;

  const r = Router();

  r.get('/status', (_req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    res.json({ needsSetup: count === 0 });
  });

  r.post('/setup', (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    if (count > 0) throw new HttpError(409, 'Setup already completed');
    requireFields(req.body || {}, ['username', 'password']);
    const { username, password, displayName } = req.body;
    assertNewUser(username, password);
    const info = db
      .prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
      .run(String(username).toLowerCase(), bcrypt.hashSync(password, 10), displayName || username, 'admin');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(issueSession(res, user, scope, cookiePath));
  });

  r.post('/login', (req, res) => {
    rateLimit(req);
    requireFields(req.body || {}, ['username', 'password']);
    const user = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(String(req.body.username).toLowerCase());
    if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) {
      throw new HttpError(401, 'Invalid username or password');
    }
    res.json(issueSession(res, user, scope, cookiePath));
  });

  // One-click entry into the demo environment. Only exists on the demo
  // mount; issues a session for a well-known read-write "demo" admin whose
  // data lives in an isolated in-memory database.
  r.post('/demo-login', (req, res) => {
    if (!demo) throw new HttpError(404, 'Not found');
    rateLimit(req);
    let user = db.prepare('SELECT * FROM users WHERE username = ?').get('demo');
    if (!user) {
      const info = db
        .prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
        .run('demo', bcrypt.hashSync(crypto.randomUUID(), 10), 'Demo User', 'admin');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
    res.json(issueSession(res, user, scope, cookiePath));
  });

  r.post('/refresh', (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new HttpError(401, 'No refresh token');
    let payload;
    try {
      payload = verifyRefreshToken(token, scope);
    } catch {
      clearRefreshCookie(res, cookiePath);
      throw new HttpError(401, 'Refresh token expired or invalid');
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) {
      clearRefreshCookie(res, cookiePath);
      throw new HttpError(401, 'User no longer exists');
    }
    // Rotate: revoke old jti
    try { revokeRefreshToken(payload.jti, payload.exp * 1000); } catch {}
    res.json(issueSession(res, user, scope, cookiePath));
  });

  r.post('/logout', (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      try {
        const payload = verifyRefreshToken(token, scope);
        revokeRefreshToken(payload.jti, payload.exp * 1000);
      } catch {}
    }
    clearRefreshCookie(res, cookiePath);
    res.json({ ok: true });
  });

  r.get('/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
    if (!user) throw new HttpError(401, 'User no longer exists');
    res.json({ user: sanitizeUser(user), scope });
  });

  return r;
}
