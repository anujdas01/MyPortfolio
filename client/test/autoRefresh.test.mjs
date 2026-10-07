import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_REFRESH_OPTIONS,
  AUTO_REFRESH_DEFAULT_SECONDS,
  resolveRefreshInterval,
  resolveAutoRefreshEnabled,
  loadLegacyToggleValues,
} from '../src/utils/autoRefresh.js';

test('auto-refresh options span 30 seconds to 5 minutes', () => {
  const seconds = AUTO_REFRESH_OPTIONS.map((o) => o.seconds);
  assert.ok(seconds.length >= 5);
  assert.equal(Math.min(...seconds), 30);
  assert.equal(Math.max(...seconds), 300);
  assert.ok(seconds.includes(30));
  assert.ok(seconds.includes(300));
});

test('auto-refresh options are strictly increasing with labels', () => {
  for (let i = 1; i < AUTO_REFRESH_OPTIONS.length; i++) {
    assert.ok(AUTO_REFRESH_OPTIONS[i].seconds > AUTO_REFRESH_OPTIONS[i - 1].seconds);
    assert.ok(AUTO_REFRESH_OPTIONS[i].label);
  }
});

test('resolveRefreshInterval accepts only valid options', () => {
  assert.equal(resolveRefreshInterval(30), 30);
  assert.equal(resolveRefreshInterval(300), 300);
  assert.equal(resolveRefreshInterval(120), 120);
});

test('resolveRefreshInterval falls back to the default for unknown values', () => {
  assert.equal(resolveRefreshInterval(45), 45);
  assert.equal(resolveRefreshInterval(7), AUTO_REFRESH_DEFAULT_SECONDS);
  assert.equal(resolveRefreshInterval(0), AUTO_REFRESH_DEFAULT_SECONDS);
  assert.equal(resolveRefreshInterval(null), AUTO_REFRESH_DEFAULT_SECONDS);
  assert.equal(resolveRefreshInterval('abc'), AUTO_REFRESH_DEFAULT_SECONDS);
  assert.equal(resolveRefreshInterval(undefined), AUTO_REFRESH_DEFAULT_SECONDS);
});

test('resolveRefreshInterval coerces numeric strings', () => {
  assert.equal(resolveRefreshInterval('60'), 60);
});

test('resolveAutoRefreshEnabled honors the stored master switch', () => {
  assert.equal(resolveAutoRefreshEnabled('1', []), true);
  assert.equal(resolveAutoRefreshEnabled('0', []), false);
});

test('resolveAutoRefreshEnabled migrates from legacy per-page toggles', () => {
  // All legacy toggles ON → enabled.
  assert.equal(resolveAutoRefreshEnabled(null, ['1', '1']), true);
  // Any legacy toggle OFF wins → disabled.
  assert.equal(resolveAutoRefreshEnabled(null, ['1', '0']), false);
  assert.equal(resolveAutoRefreshEnabled(null, ['0', '0']), false);
  // No stored preference → default ON (matches historical behavior).
  assert.equal(resolveAutoRefreshEnabled(null, [null, null]), true);
  assert.equal(resolveAutoRefreshEnabled(undefined, []), true);
});

test('loadLegacyToggleValues reads the legacy keys in order', () => {
  const store = { 'mp-auto-refresh-market': '0', 'mp-holdings-auto-update': '1' };
  const got = loadLegacyToggleValues((k) => (k in store ? store[k] : null));
  assert.deepEqual(got, ['0', '1']);
});