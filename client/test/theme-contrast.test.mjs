import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, '..', 'src', 'index.css'), 'utf8');
const themeCtx = readFileSync(path.join(here, '..', 'src', 'context', 'ThemeContext.jsx'), 'utf8');
const serverCfg = readFileSync(path.join(here, '..', '..', 'server', 'src', 'config.js'), 'utf8');

function parseCssThemes(source) {
  const themes = {};
  const blockRe = /\[data-theme='([^']+)'\]\s*\{([^}]*)\}/g;
  let m;
  while ((m = blockRe.exec(source))) {
    const vars = {};
    const varRe = /--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g;
    let v;
    while ((v = varRe.exec(m[2]))) vars[v[1]] = v[2];
    themes[m[1]] = vars;
  }
  return themes;
}

function parseQuotedList(source, pattern) {
  const m = source.match(pattern);
  assert.ok(m, `could not find ${pattern}`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function ratio(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const REQUIRED_VARS = [
  'bg', 'surface', 'surface-alt', 'border', 'text', 'muted',
  'primary', 'on-primary', 'accent', 'positive', 'negative', 'on-negative',
];

const CHECKS = [
  ['text on bg', 'text', 'bg', 7],
  ['text on surface', 'text', 'surface', 7],
  ['text on surface-alt', 'text', 'surface-alt', 7],
  ['muted on bg', 'muted', 'bg', 4.5],
  ['muted on surface', 'muted', 'surface', 4.5],
  ['muted on surface-alt', 'muted', 'surface-alt', 4.5],
  ['primary on bg', 'primary', 'bg', 3],
  ['on-primary on primary', 'on-primary', 'primary', 4.5],
  ['positive on bg', 'positive', 'bg', 4.5],
  ['negative on bg', 'negative', 'bg', 4.5],
  ['on-negative on negative', 'on-negative', 'negative', 4.5],
  ['border on bg', 'border', 'bg', 1.35],
  ['border on surface', 'border', 'surface', 1.3],
];

const cssThemes = parseCssThemes(css);

test('theme lineup is identical in CSS, ThemeContext and server config', () => {
  const clientThemes = parseQuotedList(themeCtx, /const THEMES = \[([\s\S]*?)\];/);
  const serverThemes = parseQuotedList(serverCfg, /ALLOWED_THEMES = \[([^\]]*)\]/);
  assert.deepEqual(Object.keys(cssThemes).sort(), [...clientThemes].sort());
  assert.deepEqual(serverThemes.sort(), [...clientThemes].sort());
  assert.ok(clientThemes.includes('light') && clientThemes.includes('dark'));
});

test('every theme defines the full token set', () => {
  for (const [name, vars] of Object.entries(cssThemes)) {
    for (const key of REQUIRED_VARS) {
      assert.match(vars[key] || '', /^#[0-9a-fA-F]{6}$/, `${name}: missing --color-${key}`);
    }
  }
});

test('every theme meets contrast thresholds', () => {
  for (const [name, vars] of Object.entries(cssThemes)) {
    for (const [label, a, b, min] of CHECKS) {
      const r = ratio(vars[a], vars[b]);
      assert.ok(r >= min, `${name}: ${label} = ${r.toFixed(2)} < ${min}`);
    }
  }
});
