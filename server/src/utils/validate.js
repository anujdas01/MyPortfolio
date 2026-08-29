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
