import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LYRICS_SOURCE_CACHE_MAX_ENTRIES,
  LYRICS_SOURCE_CACHE_NEGATIVE_TTL_MS,
  LYRICS_SOURCE_CACHE_TTL_MS,
  LYRICS_SOURCE_MAX_CANDIDATES_PER_SONG,
  createLyricsSourceCache,
} from './lyricsSourceCache.js';

const candidate = (url) => ({
  provider: 'genius',
  providerLabel: 'Genius',
  url,
  title: 'Track',
  artist: 'Artist',
  confidence: 'EXACT',
  discoveredAt: '2026-09-26T00:00:00.000Z',
});

const record = (candidates) => ({
  category: 'ENGLISH',
  combinedBengali: false,
  candidates,
  attempted: ['azlyrics'],
  discoveredAt: '2026-09-26T00:00:00.000Z',
});

test('cache bounds are fixed', () => {
  assert.equal(LYRICS_SOURCE_CACHE_MAX_ENTRIES, 300);
  assert.equal(LYRICS_SOURCE_CACHE_TTL_MS, 24 * 60 * 60 * 1000);
  assert.equal(LYRICS_SOURCE_CACHE_NEGATIVE_TTL_MS, 30 * 60 * 1000);
  assert.equal(LYRICS_SOURCE_MAX_CANDIDATES_PER_SONG, 8);
});

test('set and get return the stored source record', () => {
  const cache = createLyricsSourceCache();
  const stored = record([candidate('https://genius.com/x-lyrics')]);
  cache.set('song-1', stored);
  assert.deepEqual(cache.get('song-1'), stored);
  assert.equal(cache.get('missing'), null);
});

test('expired entries are removed on read', () => {
  let clock = 0;
  const cache = createLyricsSourceCache({ now: () => clock });
  cache.set('song-1', record([]), { negative: true });
  clock = LYRICS_SOURCE_CACHE_NEGATIVE_TTL_MS;
  assert.equal(cache.get('song-1'), null);
});

test('negative entries expire sooner than positive entries', () => {
  let clock = 0;
  const cache = createLyricsSourceCache({ now: () => clock });
  cache.set('empty-song', record([]), { negative: true });
  cache.set('good-song', record([candidate('https://genius.com/y-lyrics')]));
  clock = LYRICS_SOURCE_CACHE_NEGATIVE_TTL_MS + 1;
  assert.equal(cache.get('empty-song'), null);
  assert.ok(cache.get('good-song'));
});

test('merge adds new candidates and deduplicates by url', () => {
  const cache = createLyricsSourceCache();
  cache.set('song-1', record([candidate('https://genius.com/a-lyrics')]));
  const merged = cache.merge('song-1', record([
    candidate('https://genius.com/a-lyrics'),
    candidate('https://www.azlyrics.com/lyrics/artist/track.html'),
  ]));

  assert.equal(merged.candidates.length, 2);
  assert.deepEqual(
    merged.candidates.map((entry) => entry.url),
    ['https://genius.com/a-lyrics', 'https://www.azlyrics.com/lyrics/artist/track.html'],
  );
  assert.equal(cache.get('song-1').candidates.length, 2);
});

test('merge seeds the cache when no previous record exists', () => {
  const cache = createLyricsSourceCache();
  const seeded = cache.merge('song-1', record([candidate('https://genius.com/seed-lyrics')]));
  assert.equal(seeded.candidates.length, 1);
  assert.equal(cache.get('song-1').candidates[0].url, 'https://genius.com/seed-lyrics');
});

test('merge caps candidates per song', () => {
  const cache = createLyricsSourceCache();
  const many = Array.from({ length: LYRICS_SOURCE_MAX_CANDIDATES_PER_SONG + 3 }, (_, index) => candidate(`https://genius.com/track-${index}-lyrics`));
  cache.set('song-1', record(many.slice(0, 4)));
  const merged = cache.merge('song-1', record(many.slice(4)));

  assert.equal(merged.candidates.length, LYRICS_SOURCE_MAX_CANDIDATES_PER_SONG);
  assert.equal(new Set(merged.candidates.map((entry) => entry.url)).size, LYRICS_SOURCE_MAX_CANDIDATES_PER_SONG);
});

test('cache evicts the oldest entry beyond the maximum size', () => {
  const cache = createLyricsSourceCache({ maxEntries: 2 });
  cache.set('first', record([]), { negative: true });
  cache.set('second', record([]), { negative: true });
  cache.set('third', record([]), { negative: true });

  assert.equal(cache.get('first'), null);
  assert.ok(cache.get('second'));
  assert.ok(cache.get('third'));
  assert.equal(cache.size(), 2);
});

test('cached records never contain page html or lyric bodies', () => {
  const cache = createLyricsSourceCache();
  cache.set('song-1', record([candidate('https://genius.com/plain-lyrics')]));
  const serialized = JSON.stringify(cache.get('song-1'));
  assert.equal(serialized.includes('<html'), false);
  assert.equal(serialized.includes('lyrics_body'), false);
});
