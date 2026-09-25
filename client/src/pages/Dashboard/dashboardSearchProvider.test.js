import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(join(__dirname, 'Dashboard.jsx'), 'utf8');
const dashboardCss = readFileSync(join(__dirname, 'Dashboard.css'), 'utf8');

test('dashboard search uses provider-backed catalog endpoints', () => {
  assert.match(dashboardSrc, /\/api\/catalog\/search\?q=/);
  assert.match(dashboardSrc, /\/api\/catalog\/import/);
});

test('dashboard search includes regional filter chips', () => {
  assert.match(dashboardSrc, /bn-bd/);
  assert.match(dashboardSrc, /bn-in/);
  assert.match(dashboardSrc, /hi-in/);
  assert.match(dashboardSrc, /search-region-chip/);
});

test('dashboard search shows source badges for local and external results', () => {
  assert.match(dashboardSrc, /song-source-badge/);
  assert.match(dashboardCss, /\.song-source-badge/);
  assert.match(dashboardCss, /\.song-source-badge\.external/);
});
