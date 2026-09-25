import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'SongDetails.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'SongDetails.css'), 'utf8');

test('SongDetails uses shared player and avoids local footer player duplication', () => {
  assert.match(src, /const player = usePlayer\(\)/);
  assert.match(src, /player\.playSong\(queue, 0\)/);
  assert.match(src, /player\.playSong\(queue, index\)/);
  assert.match(src, /player\.togglePlay\(\)/);
  assert.equal(src.includes('footer-player'), false);
  assert.equal(src.includes('seekFromEvent'), false);
  assert.equal(src.includes('Math.random'), false);
});

test('SongDetails keeps favorite and lyrics/chords controls with accessible actions', () => {
  assert.match(src, /toggleFavorite\(song\._id\)/);
  assert.match(src, /Lyrics & Chords/);
  assert.match(src, /<LyricsChordsPanel/);
  assert.match(src, /<AppDialog/);
});

test('SongDetails responsive structure remains shell-safe', () => {
  assert.match(css, /\.song-details-page/);
  assert.match(css, /@media \(max-width: 768px\)/);
  assert.match(css, /@media \(max-width: 480px\)/);
  assert.equal(/(^|\n)\s*body\s*\{/.test(css), false);
  assert.equal(/(^|\n)\s*footer\s*\{/.test(css), false);
});
