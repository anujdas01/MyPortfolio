import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL_DAYS } from '../config.js';
import { HttpError } from './httpError.js';

export const MAIN_SCOPE = 'main';
export const DEMO_SCOPE = 'demo';

// scope keeps demo sessions from ever touching the real database:
// the real API rejects demo-scoped tokens (see app.js) and vice versa.
export function signAccessToken(user, scope = MAIN_SCOPE) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, scope },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

const refreshSecret = () => `${process.env.JWT_SECRET}:refresh`;

export function signRefreshToken(user, scope = MAIN_SCOPE) {
  return jwt.sign(
    { sub: user.id, jti: crypto.randomUUID(), scope },
    refreshSecret(),
    { expiresIn: `${REFRESH_TOKEN_TTL_DAYS}d` }
  );
}

export function verifyRefreshToken(db, token, expectedScope = MAIN_SCOPE) {
  const payload = jwt.verify(token, refreshSecret());
  if ((payload.scope || MAIN_SCOPE) !== expectedScope) {
    throw new jwt.JsonWebTokenError('wrong scope');
  }
  if (isRefreshRevoked(db, payload.jti)) throw new jwt.JsonWebTokenError('revoked');
  return payload;
}

export const REFRESH_COOKIE = 'mp_rt';
export const CSRF_HEADER = 'x-mp-csrf';

/**
 * Cookie name for the CSRF nonce, namespaced per mount.
 *
 * The nonce cookie must be readable from the SPA at "/" (that is where
 * `document.cookie` runs), so it cannot be path-scoped to the auth prefix the
 * way the httpOnly refresh cookie is. Without a per-mount suffix the three
 * mounts would overwrite each other's nonce at path "/", and logging into the
 * demo would silently break the main session's ability to refresh.
 * @param {string} basePath - e.g. `/api`, `/api/v1`, `/api/demo`
 */
export function csrfCookieName(basePath = '/api') {
  const suffix = basePath.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
  return `mp_csrf_${suffix || 'api'}`;
}

// Refresh-token revocation, persisted to the revoked_tokens table so a server
// restart cannot resurrect already-logged-out sessions. Rows are keyed by jti
// and carry the token's own expiry, so pruning can never un-revoke a token that
// is still valid elsewhere.
let lastPruneAt = 0;
function pruneRevoked(db, now = Date.now()) {
  // Cheap enough to run on a timer rather than on every write.
  if (now - lastPruneAt < 60_000) return;
  lastPruneAt = now;
  try {
    db.prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(now);
  } catch {
    // Table missing (e.g. a caller passed an unprepared handle) — revocation
    // still works for this request via the insert below.
  }
}

export function revokeRefreshToken(db, jti, expMs) {
  if (!jti) return;
  const exp = expMs || Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400000;
  pruneRevoked(db);
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(jti, exp);
}

export function isRefreshRevoked(db, jti) {
  if (!jti) return false;
  pruneRevoked(db);
  return !!db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(jti);
}

export function setRefreshCookie(res, token, path = '/api/auth', csrfName = 'mp_csrf_api') {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path,
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
  // Readable by JS on purpose: the client echoes it back in a header so a
  // cross-site request cannot drive the cookie-authenticated surface. Scoped to
  // "/" because the SPA lives at the root and has to be able to read it.
  res.cookie(csrfName, crypto.randomBytes(32).toString('hex'), {
    httpOnly: false,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res, path = '/api/auth', csrfName = 'mp_csrf_api') {
  const base = { secure: process.env.NODE_ENV === 'production', sameSite: 'lax' };
  res.clearCookie(REFRESH_COOKIE, { ...base, path, httpOnly: true });
  res.clearCookie(csrfName, { ...base, path: '/', httpOnly: false });
}

/**
 * Double-submit CSRF check for requests that authenticate via the refresh cookie.
 * Requests carrying a Bearer token are not cookie-authenticated, so they are
 * exempt and remain protected by the token not being readable cross-origin.
 */
export function requireCsrf(req, _res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return next();
  const cookie = req.cookies?.[req.csrfCookieName];
  const sent = req.headers[CSRF_HEADER];
  if (!cookie || !sent || cookie !== sent) {
    return next(new HttpError(403, 'CSRF token missing or invalid'));
  }
  return next();
}