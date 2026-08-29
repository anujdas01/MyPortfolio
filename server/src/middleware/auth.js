import jwt from 'jsonwebtoken';
import { HttpError } from '../utils/httpError.js';

export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    req.authScope = req.user.scope || 'main';
  } catch {
    throw new HttpError(401, 'Invalid or expired session');
  }
  next();
}

export function requireAdmin(req, _res, next) {
  if (req.user?.role !== 'admin') throw new HttpError(403, 'Admin access required');
  next();
}
