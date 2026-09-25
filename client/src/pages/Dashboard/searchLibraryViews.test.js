import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const searchSrc = readFileSync(join(__dirname, 'SearchView.jsx'), 'utf8');
const librarySrc = readFileSync(join(__dirname, 'LibraryView.jsx'), 'utf8');

test('Search view is mobile-accessible and keyboard-friendly', () => {
  assert.match(searchSrc, /type="search"/);
  assert.match(searchSrc, /aria-label="Search songs and users"/);
  assert.match(searchSrc, /role="status"/);
  assert.match(searchSrc, /SongRow/);
});

test('Search view uses existing backend capabilities only', () => {
  assert.match(searchSrc, /\/api\/songs\?q=/);
  assert.match(searchSrc, /\/api\/users\/search\?q=/);
  assert.equal(searchSrc.includes('/api/recommendations'), false);
  assert.equal(searchSrc.includes('/api/trending'), false);
});

test('Library view exposes liked songs, playlists, and recently played tabs', () => {
  assert.match(librarySrc, /aria-label="Library views"/);
  assert.match(librarySrc, /Liked Songs/);
  assert.match(librarySrc, /Playlists/);
  assert.match(librarySrc, /Recently Played/);
});

test('Library view uses PlayerContext queue playback and favorite toggles', () => {
  assert.match(librarySrc, /player\.playSong\(queue, index\)/);
  assert.match(librarySrc, /player\.togglePlay\(\)/);
  assert.match(librarySrc, /toggleFavorite\(/);
});
