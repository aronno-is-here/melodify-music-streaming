import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchSrc = readFileSync(join(__dirname, 'SearchView.jsx'), 'utf8');
const searchCss = readFileSync(join(__dirname, 'SearchView.css'), 'utf8');

test('dashboard search uses provider-backed catalog endpoints', () => {
  assert.match(searchSrc, /\/api\/catalog\/search\?q=/);
  assert.match(searchSrc, /\/api\/catalog\/import/);
});

test('dashboard search includes regional filter chips', () => {
  assert.match(searchSrc, /bn-bd/);
  assert.match(searchSrc, /bn-in/);
  assert.match(searchSrc, /hi-in/);
  assert.match(searchSrc, /search-region-chip/);
});

test('dashboard search shows source badges for local and external results', () => {
  assert.match(searchSrc, /song-source-badge/);
  assert.match(searchCss, /\.song-source-badge/);
  assert.match(searchCss, /\.song-source-badge\.external/);
});
