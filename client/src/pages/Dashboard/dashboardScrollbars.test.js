import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, 'Dashboard.css'), 'utf8');

test('dashboard uses scoped themed scrollbar selectors for section containers', () => {
  assert.match(css, /\.scroll-grid,\s*\n\.recent-grid,\s*\n\.playlist-list,/);
  assert.match(css, /scrollbar-width:\s*thin/);
  assert.match(css, /scrollbar-color:\s*rgba\(47, 182, 225, 0\.75\)/);
  assert.match(css, /\.scroll-grid::-webkit-scrollbar/);
  assert.match(css, /\.recent-grid::-webkit-scrollbar/);
  assert.match(css, /\.scroll-grid::-webkit-scrollbar-thumb:hover/);
});

test('dashboard scrollbar styling does not target global html or body', () => {
  assert.doesNotMatch(css, /html\s*::\-webkit-scrollbar/);
  assert.doesNotMatch(css, /body\s*::\-webkit-scrollbar/);
});

test('dashboard scroll containers preserve touch scrolling behavior', () => {
  assert.match(css, /-webkit-overflow-scrolling:\s*touch/);
  assert.match(css, /overflow-y:\s*auto/);
});
