import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLyricsSourceCacheKey,
  createLyricsSourceDiscoveryService,
} from './lyricsSourceDiscoveryService.js';
import { createLyricsSourceCache } from './lyricsSourceCache.js';
import { LYRICS_DISCOVERY_PROVIDER_LISTS, MAX_DISCOVERY_SOURCES } from './lyricsSourceProviders.js';

const EMPTY_PAGE = '<html><body><p>No results found.</p></body></html>';

const LYRIC_BODY_PAGE = [
  '<html><body>',
  '<div class="lyric-content">SUPER SECRET FULL LYRICS BODY THAT MUST NEVER BE PERSISTED</div>',
  '<a href="https://genius.com/Tahsan-Khamoshiyan-lyrics">Khamoshiyan Lyrics - Tahsan | Genius</a>',
  '</body></html>',
].join('');

const AMBIGUOUS_PAGE = '<html><body><a href="https://genius.com/Tahsan-Khamoshiyan-2-lyrics">Khamoshiyan 2 Lyrics - Tahsan</a></body></html>';

const makeResponse = (url, html) => ({
  ok: true,
  status: 200,
  url,
  headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
  text: async () => html,
});

function createFakeFetch(routeFor) {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const fetchImpl = async (url) => {
    calls.push(url);
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      const html = routeFor(url);
      if (html === undefined) return { ok: false, status: 404, url, headers: { get: () => null }, text: async () => '' };
      await Promise.resolve();
      return makeResponse(url, html);
    } finally {
      active -= 1;
    }
  };
  return { calls, fetchImpl, maxActive: () => maxActive };
}

const hindiSong = () => ({
  _id: '64b64b64b64b64b64b64b640',
  title: 'Khamoshiyan',
  artist: 'Tahsan',
  duration: '3:00',
  language: 'hi',
});

const noisyHindiSong = () => ({
  _id: '64b64b64b64b64b64b64b641',
  title: 'Khamoshiyan (Official Video)',
  artist: 'Tahsan',
  duration: '3:00',
  language: 'hi',
});

const providerHostFor = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

test('hindi lookup tries sources one at a time in shuffled order', async () => {
  const { calls, fetchImpl, maxActive } = createFakeFetch((url) => {
    if (url.startsWith('https://search.azlyrics.com/')) return EMPTY_PAGE;
    if (url.startsWith('https://genius.com/search')) {
      return '<html><body><a href="https://genius.com/Tahsan-Khamoshiyan-lyrics">Khamoshiyan Lyrics - Tahsan | Genius</a></body></html>';
    }
    return undefined;
  });

  const shuffleLog = [];
  const service = createLyricsSourceDiscoveryService({
    fetchImpl,
    shuffle: (items) => {
      shuffleLog.push(items.map((item) => item.id));
      return items;
    },
  });

  const result = await service.discover(noisyHindiSong());

  assert.equal(shuffleLog.length, 1, 'provider list must be shuffled exactly once per lookup');
  assert.equal(maxActive(), 1, 'providers must be requested sequentially, never in parallel');
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].provider, 'genius');
  assert.equal(result.candidates[0].confidence, 'EXACT');
  assert.deepEqual(result.attempted, ['azlyrics', 'genius']);
  assert.ok(calls.every((url) => url.startsWith('https://search.azlyrics.com/') || url.startsWith('https://genius.com/search')));
  assert.ok(calls.slice(0, 2).every((url) => url.startsWith('https://search.azlyrics.com/')), 'first provider must exhaust its query variants first');
  assert.ok(calls[2].startsWith('https://genius.com/search'));
});

test('lookup stops after the first HIGH source page', async () => {
  const { calls, fetchImpl } = createFakeFetch((url) => {
    if (url.startsWith('https://search.azlyrics.com/')) {
      return '<html><body><a href="https://www.azlyrics.com/lyrics/tahsan/khamoshiyan.html">Tahsan - Khamoshiyan Lyrics</a></body></html>';
    }
    return EMPTY_PAGE;
  });

  const service = createLyricsSourceDiscoveryService({ fetchImpl, shuffle: (items) => items });
  const result = await service.discover(hindiSong());

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].provider, 'azlyrics');
  assert.ok(['EXACT', 'HIGH'].includes(result.candidates[0].confidence));
  assert.deepEqual(result.attempted, ['azlyrics']);
  assert.ok(calls.every((url) => url.startsWith('https://search.azlyrics.com/')), 'later providers must not be contacted');
});

test('category lookup attempts at most five sources before LyricFind', async () => {
  const { fetchImpl } = createFakeFetch(() => EMPTY_PAGE);
  const service = createLyricsSourceDiscoveryService({ fetchImpl, shuffle: (items) => items });

  const result = await service.discover(hindiSong());

  const categoryAttempted = result.attempted.filter((id) => id !== 'lyricfind');
  assert.ok(categoryAttempted.length <= MAX_DISCOVERY_SOURCES, `attempted ${categoryAttempted.length} category sources`);
  assert.deepEqual(categoryAttempted, [...LYRICS_DISCOVERY_PROVIDER_LISTS.HINDI].slice(0, MAX_DISCOVERY_SOURCES));
  assert.equal(result.attempted[result.attempted.length - 1], 'lyricfind');
  assert.equal(result.candidates.length, 0);
});

test('LyricFind is the final fallback when the category list finds nothing', async () => {
  const { calls, fetchImpl } = createFakeFetch((url) => (url.startsWith('https://lyrics.lyricfind.com/') ? EMPTY_PAGE : undefined));
  const service = createLyricsSourceDiscoveryService({ fetchImpl, shuffle: (items) => items });

  const result = await service.discover({ _id: 'b'.repeat(24), title: 'Unlisted Language', artist: 'Artist', duration: '1:00', language: 'ta' });

  assert.equal(result.category, 'OTHER');
  assert.deepEqual(result.attempted, ['lyricfind']);
  assert.ok(calls.length <= 3, `lyricfind received ${calls.length} requests`);
  assert.ok(calls.every((url) => url.startsWith('https://lyrics.lyricfind.com/')));
});

test('ambiguous source pages never become suggested sources', async () => {
  const { fetchImpl } = createFakeFetch(() => AMBIGUOUS_PAGE);
  const service = createLyricsSourceDiscoveryService({ fetchImpl, shuffle: (items) => items });

  const result = await service.discover(hindiSong());

  assert.equal(result.candidates.length, 0, 'AMBIGUOUS candidates must be rejected');
  assert.ok(result.attempted.length > 0);
});

test('discovery never fetches lyric pages and never persists page bodies', async () => {
  const { calls, fetchImpl } = createFakeFetch((url) => (url.startsWith('https://genius.com/search') ? LYRIC_BODY_PAGE : EMPTY_PAGE));
  const cache = createLyricsSourceCache();
  const service = createLyricsSourceDiscoveryService({ fetchImpl, cache, shuffle: (items) => items });

  const song = hindiSong();
  const result = await service.discover(song);

  assert.equal(result.candidates.length, 1);
  assert.equal(calls.every((url) => /search|\?q=|\?s=/.test(url)), true, `only discovery search pages may be fetched: ${calls.join(', ')}`);
  assert.equal(calls.some((url) => url.includes('/Tahsan-Khamoshiyan-lyrics')), false, 'lyric page URL must never be fetched');

  const serialized = JSON.stringify(result) + JSON.stringify(cache.get(buildLyricsSourceCacheKey(song)));
  assert.equal(serialized.includes('SUPER SECRET FULL LYRICS BODY'), false, 'lyric bodies must never be persisted');
  assert.equal(serialized.includes('lyric-content'), false, 'page HTML must never be persisted');
});

test('provider failures resolve to an empty result without throwing', async () => {
  const fetchImpl = async () => {
    throw new Error('network down');
  };
  const service = createLyricsSourceDiscoveryService({ fetchImpl, shuffle: (items) => items });

  const result = await service.discover(hindiSong());
  assert.equal(result.candidates.length, 0);
  assert.ok(result.attempted.length > 0);
});

test('discovered candidates are cached for subsequent lookups', async () => {
  const { calls, fetchImpl } = createFakeFetch((url) => (url.startsWith('https://search.azlyrics.com/')
    ? '<html><body><a href="https://www.azlyrics.com/lyrics/tahsan/khamoshiyan.html">Tahsan - Khamoshiyan Lyrics</a></body></html>'
    : EMPTY_PAGE));
  const cache = createLyricsSourceCache();
  const service = createLyricsSourceDiscoveryService({ fetchImpl, cache, shuffle: (items) => items });

  const song = hindiSong();
  const first = await service.discover(song);
  const callsAfterFirst = calls.length;
  const second = await service.discover(song);

  assert.equal(calls.length, callsAfterFirst, 'cached lookups must not contact providers again');
  assert.deepEqual(second, first);
  assert.equal(service.peek(song).candidates[0].url, first.candidates[0].url);
});

test('peek never triggers network discovery', async () => {
  const { calls, fetchImpl } = createFakeFetch(() => EMPTY_PAGE);
  const service = createLyricsSourceDiscoveryService({ fetchImpl, shuffle: (items) => items });

  const record = service.peek(hindiSong());
  assert.equal(record.candidates.length, 0);
  assert.equal(record.category, null);
  assert.equal(calls.length, 0);
});

test('verified local lyrics bypass discovery entirely', async () => {
  const { calls, fetchImpl } = createFakeFetch(() => LYRIC_BODY_PAGE);
  const service = createLyricsSourceDiscoveryService({ fetchImpl, shuffle: (items) => items });

  const result = await service.discover({
    ...hindiSong(),
    lyrics: 'तुम ही हो\nलाख दुख भी',
    lyrics_verified: true,
  });

  assert.equal(result.candidates.length, 0);
  assert.equal(calls.length, 0, 'verified songs must not trigger provider requests');
  assert.equal(result.discoveredAt, null);
});

test('candidate records expose only lightweight source metadata', async () => {
  const { fetchImpl } = createFakeFetch((url) => (url.startsWith('https://search.azlyrics.com/')
    ? '<html><body><a href="https://www.azlyrics.com/lyrics/tahsan/khamoshiyan.html">Tahsan - Khamoshiyan Lyrics</a></body></html>'
    : EMPTY_PAGE));
  const service = createLyricsSourceDiscoveryService({ fetchImpl, shuffle: (items) => items });

  const result = await service.discover(hindiSong());
  const candidate = result.candidates[0];
  assert.deepEqual(Object.keys(candidate).sort(), [
    'artist',
    'confidence',
    'discoveredAt',
    'provider',
    'providerLabel',
    'title',
    'url',
  ]);
  assert.equal(typeof candidate.url, 'string');
  assert.ok(candidate.url.startsWith('https://'));
});

test('concurrent lookups for the same song share one discovery round', async () => {
  let fetchCount = 0;
  const fetchImpl = async (url) => {
    fetchCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return makeResponse(url, EMPTY_PAGE);
  };
  const service = createLyricsSourceDiscoveryService({ fetchImpl, shuffle: (items) => items });

  const song = hindiSong();
  const [first, second] = await Promise.all([service.discover(song), service.discover(song)]);
  assert.deepEqual(first, second);
  const maxPerRound = (MAX_DISCOVERY_SOURCES + 1) * 3;
  assert.ok(fetchCount <= maxPerRound, `expected one shared round (≤${maxPerRound}), got ${fetchCount} fetches`);
});

test('refresh merges additional source candidates into the cache', async () => {
  const geniusPage = '<html><body><a href="https://genius.com/Tahsan-Khamoshiyan-lyrics">Khamoshiyan Lyrics - Tahsan | Genius</a></body></html>';
  const azlyricsPage = '<html><body><a href="https://www.azlyrics.com/lyrics/tahsan/khamoshiyan.html">Tahsan - Khamoshiyan Lyrics</a></body></html>';
  let round = 1;
  const fetchImpl = async (url) => {
    if (url.startsWith('https://search.azlyrics.com/')) {
      return makeResponse(url, round === 1 ? EMPTY_PAGE : azlyricsPage);
    }
    if (url.startsWith('https://genius.com/search')) return makeResponse(url, geniusPage);
    return { ok: false, status: 404, url, headers: { get: () => null }, text: async () => '' };
  };
  const cache = createLyricsSourceCache();
  const service = createLyricsSourceDiscoveryService({ fetchImpl, cache, shuffle: (items) => items });

  const song = hindiSong();
  const first = await service.discover(song);
  assert.equal(first.candidates.length, 1);
  assert.equal(first.candidates[0].provider, 'genius');

  round = 2;
  const refreshed = await service.discover(song, { forceRefresh: true });
  assert.equal(refreshed.candidates.length, 2, 'refresh must merge newly discovered candidates');
  const urls = refreshed.candidates.map((candidate) => candidate.url);
  assert.equal(new Set(urls).size, urls.length, 'refresh must not duplicate candidates');
  assert.ok(urls.some((url) => url.includes('azlyrics')));
  assert.ok(urls.some((url) => url.includes('genius')));
});
