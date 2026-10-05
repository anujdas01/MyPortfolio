import { HttpError } from './httpError.js';

export function requireFields(body, fields) {
  for (const f of fields) {
    const v = body?.[f];
    if (v === undefined || v === null || v === '') {
      throw new HttpError(400, `"${f}" is required`);
    }
  }
  return body;
}

export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

export function isFutureDate(s) {
  if (!isValidDate(s)) return false;
  const today = new Date().toISOString().slice(0,10);
  return s > today;
}

/**
 * Parse `?limit=&offset=` query params with sane bounds.
 * @param {Object} query
 * @param {{limit?: number, offset?: number, defaultLimit?: number, maxLimit?: number}} [opts]
 * @returns {{limit: number, offset: number}}
 */
export function parsePagination(query = {}, opts = {}) {
  const defaultLimit = opts.defaultLimit ?? 50;
  const maxLimit = opts.maxLimit ?? 500;
  const raw = (v) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) ? n : NaN;
  };
  let limit = raw(query.limit);
  let offset = raw(query.offset);
  if (Number.isNaN(limit) || Number.isNaN(offset)) {
    throw new HttpError(400, '"limit" and "offset" must be integers');
  }
  if (limit === null) limit = defaultLimit;
  if (offset === null) offset = 0;
  if (limit < 1 || limit > maxLimit) {
    throw new HttpError(400, `"limit" must be between 1 and ${maxLimit}`);
  }
  if (offset < 0) throw new HttpError(400, '"offset" must be >= 0');
  return { limit, offset };
}
