import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'MelodifyStudio.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'MelodifyStudio.css'), 'utf8');

test('studio discovery uses provider-backed discovery endpoint with bounded pagination', () => {
  assert.match(source, /\/api\/karaoke\/discovery\?limit=\$\{DISCOVERY_PAGE_SIZE\}&page=/);
  assert.match(source, /setDiscoveryPage\(1\)/);
  assert.match(source, /studio-pagination/);
});

test('studio discovery provides regional filters for bangla, kolkata, hindi and english', () => {
  assert.match(source, /bn-bd/);
  assert.match(source, /bn-in/);
  assert.match(source, /hi-in/);
  assert.match(source, /en/);
  assert.match(source, /studio-region-chip/);
});

test('studio discovery renders karaoke classification badges', () => {
  assert.match(source, /KARAOKE_READY/);
  assert.match(source, /SING_ALONG/);
  assert.match(css, /\.studio-track-badge\.ready/);
  assert.match(css, /\.studio-track-badge\.singalong/);
});
