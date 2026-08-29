import { test } from 'node:test';
import assert from 'node:assert/strict';
import { money, formatDate, signedMoney, pct, todayISO } from '../src/utils/format.js';

test('money formats small values with cents', () => {
  assert.equal(money(1500.5), '$1,500.50');
});

test('money drops cents for large values', () => {
  assert.equal(money(1234567.89), '$1,234,568');
});

test('money handles null/undefined as zero', () => {
  assert.equal(money(null), '$0.00');
});

test('formatDate renders human-readable date', () => {
  assert.equal(formatDate('2026-02-28'), 'Feb 28, 2026');
});

test('formatDate handles missing values', () => {
  assert.equal(formatDate(null), '—');
});

test('signedMoney prefixes positive numbers', () => {
  assert.equal(signedMoney(250), '+$250.00');
});

test('pct guards against invalid input', () => {
  assert.equal(pct(null), '');
  assert.equal(pct(4.32), '+4.3%');
});

test('todayISO returns YYYY-MM-DD', () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});
