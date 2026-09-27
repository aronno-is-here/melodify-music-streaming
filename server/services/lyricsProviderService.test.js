import test from 'node:test';
import assert from 'node:assert/strict';
import { createLyricsProviderService } from './lyricsProviderService.js';
import { createLyricsCache } from './lyricsCache.js';

const SONG = {
  _id: '64b64b64b64b64b64b64b640',
  youtube_id: 'yt1',
  title: 'Tum Hi Ho',
  artist: 'Arijit Singh',
  album: 'Hamari Adhuri Kahani',
  duration: '4:05',
};

const GOOD_BODY = {
  id: 12345,
  trackName: 'Tum Hi Ho',
  artistName: 'Arijit Singh',
  albumName: 'Hamari Adhuri Kahani',
  duration: 245,
  syncedLyrics: '[00:01.00]Line one\n[00:05.50]Line two',
  plainLyrics: 'Line one\nLine two',
};

function makeService({ song, getExact, search } = {}) {
  const calls = { exact: [], search: [] };
  const service = createLyricsProviderService({
    SongModel: { findById: async () => song },
    lrclibClient: {
      getExact: async (params) => {
        calls.exact.push(params);
        if (getExact) return getExact(params, calls.exact.length);
        return { status: 404, body: null };
      },
      search: async (params) => {
        calls.search.push(params);
        if (search) return search(params, calls.search.length);
        return { status: 404, body: [] };
      },
    },
    lyricsCache: createLyricsCache(),
  });
  return { service, calls };
}

test('verified database lyrics beat LRCLIB without any provider call', async () => {
  const { service, calls } = makeService({
    song: { ...SONG, lyrics: 'Verified line one\nVerified line two', lyrics_verified: true },
    getExact: () => {
      throw new Error('getExact must not be called');
    },
    search: () => {
      throw new Error('search must not be called');
    },
  });
  const result = await service.resolveSongLyrics(SONG._id);
  assert.equal(result.notFound, false);
  assert.equal(result.lyrics.source, 'verified-db');
  assert.equal(result.lyrics.status, 'verified');
  assert.equal(result.lyrics.lines.length, 2);
  assert.equal(calls.exact.length, 0);
  assert.equal(calls.search.length, 0);
});

test('accepts clean exact LRCLIB match from getExact', async () => {
  const { service, calls } = makeService({
    song: SONG,
    getExact: () => ({ status: 200, body: GOOD_BODY }),
    search: () => {
      throw new Error('search must not be called');
    },
  });
  const result = await service.resolveSongLyrics(SONG._id);
  assert.equal(result.lyrics.source, 'lrclib-exact');
  assert.equal(result.lyrics.status, 'provider');
  assert.equal(result.lyrics.match, 'EXACT');
  assert.equal(result.lyrics.synced, true);
  assert.equal(result.lyrics.lines.length, 2);
  assert.equal(result.lyrics.lines[0].time, 1);
  assert.equal(result.lyrics.lines[0].text, 'Line one');
  assert.equal(result.lyrics.provider.providerLyricsId, '12345');
  assert.equal(calls.exact.length, 1);
  assert.equal(calls.search.length, 0);
});

test('rejects weak provider match as ambiguous instead of serving lyrics', async () => {
  const { service, calls } = makeService({
    song: SONG,
    getExact: () => ({
      status: 200,
      body: {
        ...GOOD_BODY,
        artistName: 'Unknown Singers',
      },
    }),
  });
  const result = await service.resolveSongLyrics(SONG._id);
  assert.equal(result.lyrics.source, 'provider-ambiguous');
  assert.equal(result.lyrics.status, 'ambiguous');
  assert.equal(result.lyrics.match, 'AMBIGUOUS');
  assert.deepEqual(result.lyrics.lines, []);
  assert.equal(result.lyrics.plain, '');
  assert.equal(calls.exact.length, 1);
  assert.equal(calls.search.length, 0);
});

test('normalizes noisy title and artist into provider queries', async () => {
  const { service, calls } = makeService({
    song: {
      ...SONG,
      title: 'Arijit Singh - Tum Hi Ho (Official Video)',
      artist: 'Arijit Singh - Topic',
    },
  });
  await service.resolveSongLyrics(SONG._id);
  assert.equal(calls.exact[0].track_name, 'Tum Hi Ho');
  assert.equal(calls.exact[0].artist_name, 'Arijit Singh');
  assert.equal(calls.search[0].q, 'Tum Hi Ho Arijit Singh');
});

test('retries getExact without duration when duration attempt fails', async () => {
  const { service, calls } = makeService({
    song: SONG,
    getExact: (_params, attempt) => (attempt === 1
      ? { status: 404, body: null }
      : { status: 200, body: GOOD_BODY }),
    search: () => {
      throw new Error('search must not be called');
    },
  });
  const result = await service.resolveSongLyrics(SONG._id);
  assert.equal(result.lyrics.status, 'provider');
  assert.equal(result.lyrics.source, 'lrclib-exact');
  assert.equal(calls.exact.length, 2);
  assert.equal(calls.exact[0].duration, 245);
  assert.equal(calls.exact[1].duration, undefined);
  assert.equal(calls.search.length, 0);
});

test('falls back to normalized search query when getExact has no match', async () => {
  const { service, calls } = makeService({
    song: SONG,
    getExact: () => ({ status: 404, body: null }),
    search: () => ({ status: 200, body: [GOOD_BODY] }),
  });
  const result = await service.resolveSongLyrics(SONG._id);
  assert.equal(result.lyrics.status, 'provider');
  assert.equal(result.lyrics.source, 'lrclib-search');
  assert.equal(result.lyrics.match, 'EXACT');
  assert.equal(calls.exact.length, 2);
  assert.equal(calls.search.length, 1);
  assert.equal(calls.search[0].q, 'Tum Hi Ho Arijit Singh');
});

test('keeps legacy lyrics when provider has nothing', async () => {
  const { service } = makeService({
    song: { ...SONG, lyrics: 'Legacy line', lyrics_verified: false },
    getExact: () => ({ status: 404, body: null }),
    search: () => ({ status: 404, body: [] }),
  });
  const result = await service.resolveSongLyrics(SONG._id);
  assert.equal(result.lyrics.status, 'legacy-unverified');
  assert.equal(result.lyrics.source, 'legacy-unverified');
  assert.equal(result.lyrics.lines.length, 1);
  assert.equal(result.lyrics.lines[0].text, 'Legacy line');
});

test('reports unavailable when nothing matches and no legacy lyrics exist', async () => {
  const { service } = makeService({
    song: SONG,
    getExact: () => ({ status: 404, body: null }),
    search: () => ({ status: 404, body: [] }),
  });
  const result = await service.resolveSongLyrics(SONG._id);
  assert.equal(result.lyrics.status, 'unavailable');
  assert.equal(result.lyrics.source, 'unavailable');
  assert.deepEqual(result.lyrics.lines, []);
});
