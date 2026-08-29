import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL_DAYS } from '../config.js';

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

export function verifyRefreshToken(token, expectedScope = MAIN_SCOPE) {
  const payload = jwt.verify(token, refreshSecret());
  if ((payload.scope || MAIN_SCOPE) !== expectedScope) {
    throw new jwt.JsonWebTokenError('wrong scope');
  }
  if (isRefreshRevoked(payload.jti)) throw new jwt.JsonWebTokenError('revoked');
  return payload;
}

export const REFRESH_COOKIE = 'mp_rt';

// In-memory revocation for refresh tokens (jti -> exp ms)
const revokedJtis = new Map();
function pruneRevoked() {
  const now = Date.now();
  for (const [jti, exp] of revokedJtis) if (exp < now) revokedJtis.delete(jti);
}
export function revokeRefreshToken(jti, expMs) {
  pruneRevoked();
  if (jti) revokedJtis.set(jti, expMs || Date.now() + REFRESH_TOKEN_TTL_DAYS * 86400000);
}
export function isRefreshRevoked(jti) {
  pruneRevoked();
  return jti ? revokedJtis.has(jti) : false;
}

export function setRefreshCookie(res, token, path = '/api/auth') {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path,
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res, path = '/api/auth') {
  res.clearCookie(REFRESH_COOKIE, { path, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', httpOnly: true });
}
