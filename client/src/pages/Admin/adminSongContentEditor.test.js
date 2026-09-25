import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const adminCss = readFileSync(join(__dirname, 'Admin.css'), 'utf8');

test('admin song editor saves metadata and content via dedicated content endpoint', () => {
  assert.match(adminSource, /saveSongEdits/);
  assert.match(adminSource, /\/api\/songs\/\$\{id\}\/content/);
  assert.match(adminSource, /lyrics_source/);
  assert.match(adminSource, /chords_source/);
});

test('admin song editor includes verification controls for lyrics and chords', () => {
  assert.match(adminSource, /Lyrics Verification/);
  assert.match(adminSource, /Chords Verification/);
  assert.match(adminSource, /lyrics_verified/);
  assert.match(adminSource, /chords_verified/);
  assert.match(adminSource, /lyrics_match_status/);
});

test('admin verification editor styles are present', () => {
  assert.match(adminCss, /\.admin-verify-grid/);
  assert.match(adminCss, /\.admin-multiline-input/);
  assert.match(adminCss, /\.admin-checkbox-row/);
});
