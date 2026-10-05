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
  requireCsrf,
  csrfCookieName,
  REFRESH_COOKIE,
  MAIN_SCOPE,
  DEMO_SCOPE,
} from '../utils/tokens.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
// The demo login takes no credentials, so it gets its own bucket. Otherwise a
// visitor clicking around the showcase would burn the real household's budget.
const MAX_DEMO_ATTEMPTS = 60;

// Per-router so the three mounts (/api, /api/v1, /api/demo) do not share one
// allowance for what is really a per-IP credential-stuffing control.
let loginAttempts = new Map();

function pruneAttempts() {
  const now = Date.now();
  for (const [k, rec] of loginAttempts) {
    if (now - rec.firstAt > WINDOW_MS) loginAttempts.delete(k);
  }
}

function rateLimit(req, maxAttempts = MAX_ATTEMPTS) {
  pruneAttempts();
  const key = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAt: now });
    return;
  }
  rec.count += 1;
  if (rec.count > maxAttempts) {
    throw new HttpError(429, 'Too many attempts. Try again later.');
  }
}

/**
 * @typedef {Object} User
 * @property {number} id
 * @property {string} username
 * @property {string} displayName
 * @property {'admin'|'member'} role
 * @property {string} themePref
 */

/**
 * @typedef {Object} AuthResponse
 * @property {string} accessToken - JWT access token (15 min TTL)
 * @property {User} user
 */

/**
 * @typedef {Object} SetupStatus
 * @property {boolean} needsSetup
 */

/**
 * @typedef {Object} ErrorResponse
 * @property {string} error
 */

/**
 * Sanitize user object for API responses
 * @param {Object} u - Raw user row from DB
 * @returns {User}
 */
export function sanitizeUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    role: u.role,
    themePref: u.theme_pref,
  };
}

/**
 * Issue access token + set refresh cookie
 * @param {import('express').Response} res
 * @param {Object} user
 * @param {string} [scope]
 * @param {string} [cookiePath]
 * @param {string} [csrfName]
 * @returns {AuthResponse}
 */
export function issueSession(res, user, scope = MAIN_SCOPE, cookiePath = '/api/auth', csrfName) {
  setRefreshCookie(res, signRefreshToken(user, scope), cookiePath, csrfName);
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

/**
 * Authentication routes
 * @param {import('better-sqlite3').Database} db
 * @param {{basePath?: string, demo?: boolean}} [opts]
 * @returns {import('express').Router}
 */
export default function authRoutes(db, opts = {}) {
  const { basePath = '/api', demo = false } = opts;
  const cookiePath = `${basePath}/auth`;
  const scope = demo ? DEMO_SCOPE : MAIN_SCOPE;
  const csrfName = csrfCookieName(basePath);

  const r = Router();
  // Tags every request with the nonce name this mount issues, so requireCsrf
  // reads the right cookie regardless of which mount the request hit.
  r.use((req, _res, next) => {
    req.csrfCookieName = csrfName;
    next();
  });

  /**
   * @openapi
   * /auth/status:
   *   get:
   *     tags: [Authentication]
   *     summary: Check if initial setup is needed
   *     description: Returns whether the database has any users yet (first-run detection)
   *     responses:
   *       200:
   *         description: Setup status
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SetupStatus'
   */
  r.get('/status', (_req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    res.json({ needsSetup: count === 0 });
  });

  /**
   * @openapi
   * /auth/setup:
   *   post:
   *     tags: [Authentication]
   *     summary: Create the initial household admin account
   *     description: Only works when no users exist yet. Creates first admin user and returns a session.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password]
   *             properties:
   *               username:
   *                 type: string
   *                 pattern: '^[a-zA-Z0-9_.-]{3,32}$'
   *                 example: 'jane'
   *               password:
   *                 type: string
   *                 format: password
   *                 minLength: 8
   *                 example: 'secret123'
   *               displayName:
   *                 type: string
   *                 example: 'Jane Doe'
   *     responses:
   *       201:
   *         description: Admin created and session issued
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AuthResponse'
   *       400:
   *         description: Invalid username or password
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: Setup already completed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
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
    res.status(201).json(issueSession(res, user, scope, cookiePath, csrfName));
  });

  /**
   * @openapi
   * /auth/login:
   *   post:
   *     tags: [Authentication]
   *     summary: Authenticate user and create session
   *     description: Returns access token and sets httpOnly refresh cookie. Rate limited to 10 attempts per 15 minutes per IP.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [username, password]
   *             properties:
   *               username:
   *                 type: string
   *                 example: 'jane'
   *               password:
   *                 type: string
   *                 format: password
   *                 example: 'secret123'
   *     responses:
   *       200:
   *         description: Session created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AuthResponse'
   *       400:
   *         description: Missing credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Invalid credentials
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       429:
   *         description: Too many attempts
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  r.post('/login', (req, res) => {
    rateLimit(req);
    requireFields(req.body || {}, ['username', 'password']);
    const user = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(String(req.body.username).toLowerCase());
    if (!user || !bcrypt.compareSync(req.body.password, user.password_hash)) {
      throw new HttpError(401, 'Invalid username or password');
    }
    res.json(issueSession(res, user, scope, cookiePath, csrfName));
  });

  /**
   * @openapi
   * /auth/demo-login:
   *   post:
   *     tags: [Authentication]
   *     summary: One-click demo environment login
   *     description: Only available on the demo mount (/api/demo/auth/demo-login). Creates or reuses an isolated demo user.
   *     responses:
   *       200:
   *         description: Demo session created
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AuthResponse'
   *       404:
   *         description: Not available on production mount
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       429:
   *         description: Too many attempts
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  r.post('/demo-login', (req, res) => {
    if (!demo) throw new HttpError(404, 'Not found');
    rateLimit(req, MAX_DEMO_ATTEMPTS);
    let user = db.prepare('SELECT * FROM users WHERE username = ?').get('demo');
    if (!user) {
      const info = db
        .prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)')
        .run('demo', bcrypt.hashSync(crypto.randomUUID(), 10), 'Demo User', 'admin');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    }
    res.json(issueSession(res, user, scope, cookiePath, csrfName));
  });

  /**
   * @openapi
   * /auth/refresh:
   *   post:
   *     tags: [Authentication]
   *     summary: Rotate access token using refresh cookie
   *     description: >
   *       Requires a valid httpOnly refresh token cookie plus the matching
   *       double-submit CSRF token (`mp_csrf` cookie echoed in the `X-MP-CSRF`
   *       header). Issues a new access token and rotates the refresh token.
   *     responses:
   *       200:
   *         description: New session issued
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AuthResponse'
   *       401:
   *         description: No refresh token, expired, or invalid
   *       403:
   *         description: CSRF token missing or invalid
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  r.post('/refresh', requireCsrf, (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new HttpError(401, 'No refresh token');
    let payload;
    try {
      payload = verifyRefreshToken(db, token, scope);
    } catch {
      clearRefreshCookie(res, cookiePath, csrfName);
      throw new HttpError(401, 'Refresh token expired or invalid');
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.sub);
    if (!user) {
      clearRefreshCookie(res, cookiePath, csrfName);
      throw new HttpError(401, 'User no longer exists');
    }
    // Rotate: revoke old jti
    try { revokeRefreshToken(db, payload.jti, payload.exp * 1000); } catch {}
    res.json(issueSession(res, user, scope, cookiePath, csrfName));
  });

  /**
   * @openapi
   * /auth/logout:
   *   post:
   *     tags: [Authentication]
*     summary: End current session
    *     description: Revokes refresh token and clears cookie
    *     responses:
    *       200:
    *         description: Logged out
    *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ok:
   *                   type: boolean
   *                   example: true
   */
  r.post('/logout', requireCsrf, (req, res) => {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (token) {
      try {
        const payload = verifyRefreshToken(db, token, scope);
        revokeRefreshToken(db, payload.jti, payload.exp * 1000);
      } catch {}
    }
    clearRefreshCookie(res, cookiePath, csrfName);
    res.json({ ok: true });
  });

  /**
   * @openapi
   * /auth/me:
   *   get:
   *     tags: [Authentication]
   *     summary: Get current authenticated user
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     responses:
   *       200:
   *         description: Current user info
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 user:
   *                   $ref: '#/components/schemas/User'
   *                 scope:
   *                   type: string
   *                   enum: [main, demo]
   *                   example: 'main'
   *       401:
   *         description: Not authenticated or user deleted
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  r.get('/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
    if (!user) throw new HttpError(401, 'User no longer exists');
    res.json({ user: sanitizeUser(user), scope });
  });

  /**
   * @openapi
   * /auth/me:
   *   patch:
   *     tags: [Authentication]
   *     summary: Update your own profile
   *     description: >
   *       Self-service profile edits. Any authenticated user may change their own
   *       display name, login name, and password. Changing the login name or the
   *       password requires re-entering the current one, and re-issues the
   *       session so the new credential is proven before the old one stops
   *       working. Role changes stay admin-only via /users/{id}.
   *     security:
   *       - bearerAuth: []
   *       - cookieAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               displayName:
   *                 type: string
   *                 maxLength: 80
   *                 example: 'Jane Doe'
   *               username:
   *                 type: string
   *                 pattern: '^[a-zA-Z0-9_.-]{3,32}$'
   *                 example: 'jane'
   *                 description: New login name; requires currentPassword
   *               currentPassword:
   *                 type: string
   *                 format: password
   *                 description: Required when changing the login name or password
   *               newPassword:
   *                 type: string
   *                 format: password
   *                 minLength: 8
   *                 description: New password, at least 8 characters
   *     responses:
   *       200:
   *         description: Profile updated
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 user:
   *                   $ref: '#/components/schemas/User'
   *                 passwordChanged:
   *                   type: boolean
   *                   example: true
   *                 usernameChanged:
   *                   type: boolean
   *                   example: true
   *       400:
   *         description: Invalid input, or new password does not match its confirmation
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Not authenticated, or currentPassword is wrong
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: User no longer exists
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       409:
   *         description: Username already taken
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  r.patch('/me', requireAuth, (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.sub);
    if (!user) throw new HttpError(404, 'User no longer exists');

    const { displayName, currentPassword, newPassword, username } = req.body || {};

    if (displayName !== undefined) {
      if (typeof displayName !== 'string') throw new HttpError(400, '"displayName" must be a string');
      if (displayName.length > 80) throw new HttpError(400, '"displayName" must be 80 characters or fewer');
    }

    // A login-name change rotates a login credential, so it re-authenticates
    // exactly like a password change. An unchanged (or differently-cased)
    // name is a no-op that needs no password.
    let usernameChanged = false;
    let nextUsername = user.username;
    if (username !== undefined && String(username).toLowerCase() !== user.username) {
      if (!USERNAME_RE.test(String(username))) {
        throw new HttpError(400, 'Username must be 3-32 characters (letters, numbers, _ . -)');
      }
      const uname = String(username).toLowerCase();
      if (db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(uname, user.id)) {
        throw new HttpError(409, 'Username already taken');
      }
      if (!currentPassword || !bcrypt.compareSync(String(currentPassword), user.password_hash)) {
        throw new HttpError(401, 'Current password is incorrect');
      }
      nextUsername = uname;
      usernameChanged = true;
    }

    let passwordChanged = false;
    if (newPassword !== undefined && newPassword !== '') {
      if (typeof newPassword !== 'string' || newPassword.length < 8) {
        throw new HttpError(400, 'New password must be at least 8 characters');
      }
      // Re-authenticate before rotating, so a stolen token cannot lock the
      // real owner out of their own account.
      if (!currentPassword || !bcrypt.compareSync(String(currentPassword), user.password_hash)) {
        throw new HttpError(401, 'Current password is incorrect');
      }
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(
        bcrypt.hashSync(newPassword, 10),
        user.id
      );
      passwordChanged = true;
    }

    if (usernameChanged) {
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(nextUsername, user.id);
    }

    if (displayName !== undefined) {
      // An empty name falls back to the (possibly just-changed) username
      // rather than rendering blank.
      const next = displayName.trim() || nextUsername;
      db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(next, user.id);
    }

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    // Re-issue on a credential change so the caller's cookie/access token is
    // rotated, invalidating anything captured before the change.
    if (passwordChanged || usernameChanged) {
      return res.json({ ...issueSession(res, updated, scope, cookiePath, csrfName), passwordChanged, usernameChanged });
    }
    res.json({ user: sanitizeUser(updated), passwordChanged, usernameChanged });
  });

  return r;
}
