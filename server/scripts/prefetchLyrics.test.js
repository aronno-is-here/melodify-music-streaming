import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrefetchLyricsArgs, runLyricsPrefetch } from './prefetchLyrics.js';

test('parsePrefetchLyricsArgs defaults', () => {
  assert.deepEqual(parsePrefetchLyricsArgs([]), {
    limit: 25,
    offset: 0,
    dryRun: false,
    includeLegacy: false,
  });
});

test('parsePrefetchLyricsArgs accepts bounded options', () => {
  assert.deepEqual(parsePrefetchLyricsArgs(['--limit', '40', '--offset', '10', '--dry-run', '--include-legacy']), {
    limit: 40,
    offset: 10,
    dryRun: true,
    includeLegacy: true,
  });
});

test('parsePrefetchLyricsArgs rejects invalid tokens', () => {
  assert.throws(() => parsePrefetchLyricsArgs(['--limit', '0']), /Invalid --limit value/);
  assert.throws(() => parsePrefetchLyricsArgs(['--offset', '10001']), /Invalid --offset value/);
  assert.throws(() => parsePrefetchLyricsArgs(['--nope']), /Unknown argument/);
});

test('runLyricsPrefetch persists provider matches when not dry run', async () => {
  const updates = [];
  const summary = await runLyricsPrefetch({
    findSongs: async () => [{ _id: 's1', title: 'One', artist: 'A' }],
    resolveSongLyrics: async () => ({
      notFound: false,
      lyrics: {
        status: 'provider',
        plain: 'line one',
        match: 'HIGH',
        provider: { providerLyricsId: 'lr-1' },
      },
    }),
    updateSong: async (songId, payload) => {
      updates.push({ songId, payload });
      return null;
    },
    options: { dryRun: false },
    now: () => new Date('2026-09-15T00:00:00.000Z'),
  });

  assert.equal(summary.totalCandidates, 1);
  assert.equal(summary.updatedCount, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].payload.lyrics_source, 'lrclib');
  assert.equal(updates[0].payload.lyrics_match_status, 'HIGH');
  assert.equal(updates[0].payload.lyrics_provider_id, 'lr-1');
  assert.equal(updates[0].payload.lyrics, 'line one');
});

test('runLyricsPrefetch dry run skips persistence', async () => {
  let updateCalls = 0;
  const summary = await runLyricsPrefetch({
    findSongs: async () => [{ _id: 's2', title: 'Two', artist: 'B' }],
    resolveSongLyrics: async () => ({
      notFound: false,
      lyrics: {
        status: 'unavailable',
        plain: '',
        match: 'NONE',
        provider: null,
      },
    }),
    updateSong: async () => {
      updateCalls += 1;
      return null;
    },
    options: { dryRun: true },
  });

  assert.equal(updateCalls, 0);
  assert.equal(summary.unavailableCount, 1);
  assert.equal(summary.results[0].status, 'unavailable');
});
