import test from 'node:test';
import assert from 'node:assert/strict';
import lyricsRouter, { lyricsSourceDiscovery } from './lyricsRoutes.js';
import Song from '../models/Song.js';
import { protect } from '../middleware/auth.js';
import { buildLyricsSourceCacheKey } from '../services/lyricsSourceDiscoveryService.js';

function createRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function findRoute(path) {
  return lyricsRouter.stack.find((entry) => entry.route && entry.route.path === path);
}

async function invokeSourcesRoute({
  query = {},
  user = { role: 'user' },
  song = null,
  findError = null,
  fetchImpl = null,
} = {}) {
  const layer = findRoute('/:songId/sources');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const originalFindById = Song.findById;
  const originalFetch = globalThis.fetch;

  Song.findById = () => {
    if (findError) throw findError;
    const value = song;
    return { select: async () => value };
  };
  if (fetchImpl) {
    globalThis.fetch = fetchImpl;
  }

  try {
    const res = createRes();
    await handler(
      { params: { songId: song?._id ?? '64b64b64b64b64b64b64b640' }, query, user },
      res,
    );
    return res;
  } finally {
    Song.findById = originalFindById;
    globalThis.fetch = originalFetch;
  }
}

async function invokeLyricsRoute({ song, findError = null, fetchImpl = null } = {}) {
  const layer = lyricsRouter.stack.find((entry) => entry.route && entry.route.path === '/:songId');
  const handler = layer.route.stack[0].handle;
  const originalFindById = Song.findById;
  const originalFetch = globalThis.fetch;

  Song.findById = async () => {
    if (findError) throw findError;
    return song;
  };

  if (fetchImpl) {
    globalThis.fetch = fetchImpl;
  }

  try {
    const res = createRes();
    await handler({ params: { songId: '64b64b64b64b64b64b64b640' } }, res);
    return res;
  } finally {
    Song.findById = originalFindById;
    globalThis.fetch = originalFetch;
  }
}

test('lyrics route returns verified database lyrics and chord metadata', async () => {
  const response = await invokeLyricsRoute({
    song: {
      _id: '64b64b64b64b64b64b64b640',
      title: 'Stored Song',
      artist: 'Artist',
      duration: '3:00',
      lyrics: 'Line one\nLine two',
      lyrics_verified: true,
      chords: 'C G Am F',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.source, 'verified-db');
  assert.equal(response.body.status, 'verified');
  assert.equal(response.body.chords, 'C G Am F');
  assert.equal(response.body.chordsState, 'legacy-unverified');
  assert.equal(response.body.lines.length, 2);
});

test('lyrics route falls back to no-lyrics state while still returning stored chords', async () => {
  const response = await invokeLyricsRoute({
    song: {
      title: 'No Lyrics',
      artist: 'Artist',
      duration: '3:00',
      lyrics: '',
      chords: 'Dm Bb F C',
    },
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({}),
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.source, 'unavailable');
  assert.equal(response.body.status, 'unavailable');
  assert.deepEqual(response.body.lines, []);
  assert.equal(response.body.chords, 'Dm Bb F C');
});

test('lyrics route returns 404 when song does not exist', async () => {
  const response = await invokeLyricsRoute({ song: null });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { success: false, error: 'Song not found' });
});

test('lyrics route hides internal errors behind a fixed message', async () => {
  const response = await invokeLyricsRoute({ findError: new Error('mongodb://secret-uri') });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { success: false, error: 'failed to load lyrics' });
});

test('lyrics route exposes romanized presentation fields for verified hindi lyrics', async () => {
  const response = await invokeLyricsRoute({
    song: {
      _id: '64b64b64b64b64b64b64b640',
      title: 'Tum Hi Ho',
      artist: 'Arijit Singh',
      duration: '4:05',
      lyrics: 'तुम ही हो',
      lyrics_verified: true,
      lyrics_language: 'hi',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.source, 'verified-db');
  assert.equal(response.body.lyricsVerified, true);
  assert.equal(response.body.script, 'devanagari');
  assert.equal(response.body.lines[0].text, 'तुम ही हो');
  assert.equal(response.body.romanizedLines[0].text, 'tum hi ho');
  assert.equal(response.body.displayLines[0].text, 'tum hi ho');
});

test('lyrics route keeps original lines and null romanization for english lyrics', async () => {
  const response = await invokeLyricsRoute({
    song: {
      _id: '64b64b64b64b64b64b64b640',
      title: 'Comfortably Numb',
      artist: 'Pink Floyd',
      duration: '6:22',
      lyrics: 'Hello? (Hello? Hello? Hello?)',
      lyrics_verified: true,
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.script, 'latin');
  assert.equal(response.body.romanizedLines, null);
  assert.deepEqual(response.body.displayLines, response.body.lines);
});

test('lyrics route attaches a cached source candidate for unavailable lyrics', async () => {
  const song = {
    _id: 'd1d1d1d1d1d1d1d1d1d1d1d1',
    title: 'No Lyric Track',
    artist: 'Artist',
    duration: '3:00',
    lyrics: '',
  };
  const candidate = {
    provider: 'genius',
    providerLabel: 'Genius',
    url: 'https://genius.com/Artist-No-Lyric-Track-lyrics',
    title: 'No Lyric Track',
    artist: 'Artist',
    confidence: 'EXACT',
    discoveredAt: '2026-09-26T00:00:00.000Z',
  };
  lyricsSourceDiscovery.cache.set(buildLyricsSourceCacheKey(song), {
    category: 'ENGLISH',
    combinedBengali: false,
    candidates: [candidate],
    attempted: ['azlyrics'],
    discoveredAt: '2026-09-26T00:00:00.000Z',
  });

  const providerSearchCalls = [];
  const response = await invokeLyricsRoute({
    song,
    fetchImpl: async (url) => {
      providerSearchCalls.push(String(url));
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'unavailable');
  assert.deepEqual(response.body.sourceCandidate, {
    provider: candidate.provider,
    providerLabel: candidate.providerLabel,
    url: candidate.url,
    title: candidate.title,
    artist: candidate.artist,
    confidence: candidate.confidence,
  });
  assert.equal(
    providerSearchCalls.some((url) => /azlyrics|genius|lyricfind|smule/.test(url)),
    false,
    'lyrics route must never trigger network discovery',
  );
});

test('lyrics route omits the source candidate for verified lyrics', async () => {
  const song = {
    _id: 'd2d2d2d2d2d2d2d2d2d2d2d2',
    title: 'Verified Track',
    artist: 'Artist',
    duration: '3:00',
    lyrics: 'Line one\nLine two',
    lyrics_verified: true,
  };
  lyricsSourceDiscovery.cache.set(buildLyricsSourceCacheKey(song), {
    category: 'ENGLISH',
    combinedBengali: false,
    candidates: [{
      provider: 'genius',
      providerLabel: 'Genius',
      url: 'https://genius.com/Artist-Verified-Track-lyrics',
      title: 'Verified Track',
      artist: 'Artist',
      confidence: 'EXACT',
      discoveredAt: '2026-09-26T00:00:00.000Z',
    }],
    attempted: ['genius'],
    discoveredAt: '2026-09-26T00:00:00.000Z',
  });

  const response = await invokeLyricsRoute({ song });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.status, 'verified');
  assert.equal(response.body.sourceCandidate, null);
});

test('lyrics sources route sits behind the protect middleware', () => {
  const layer = findRoute('/:songId/sources');
  assert.ok(layer, 'sources route must exist');
  assert.equal(layer.route.stack[0].handle, protect);
  assert.equal(layer.route.stack.length, 2, 'only protect + handler expected');
});

test('lyrics sources route rejects unsupported query keys', async () => {
  const response = await invokeSourcesRoute({ query: { debug: '1' } });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { success: false, error: 'invalid lyrics sources query' });
});

test('lyrics sources route rejects malformed refresh values', async () => {
  const response = await invokeSourcesRoute({ query: { refresh: '2' } });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { success: false, error: 'invalid lyrics sources query' });
});

test('lyrics sources route requires admin for refresh', async () => {
  const response = await invokeSourcesRoute({
    query: { refresh: '1' },
    user: { role: 'user' },
    song: { _id: 'e1e1e1e1e1e1e1e1e1e1e1e1', title: 'Track', artist: 'Artist', duration: '3:00' },
  });
  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { success: false, error: 'Admin access required' });
});

test('lyrics sources route returns 404 when song is missing', async () => {
  const response = await invokeSourcesRoute({ query: {}, song: null });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { success: false, error: 'Song not found' });
});

test('lyrics sources route hides internal errors behind a fixed message', async () => {
  const response = await invokeSourcesRoute({
    query: {},
    findError: new Error('mongodb://secret-uri'),
  });
  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, { success: false, error: 'failed to load lyrics sources' });
});

test('lyrics sources route discovers bounded source candidates', async () => {
  const song = {
    _id: 'f1f1f1f1f1f1f1f1f1f1f1f1',
    title: 'Khamoshiyan',
    artist: 'Tahsan',
    duration: '3:00',
    language: 'hi',
  };
  const fetchImpl = async (url) => ({
    ok: true,
    status: 200,
    url,
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => (String(url).startsWith('https://search.azlyrics.com/')
      ? '<html><body><a href="https://www.azlyrics.com/lyrics/tahsan/khamoshiyan.html">Tahsan - Khamoshiyan Lyrics</a></body></html>'
      : '<html><body><p>No results.</p></body></html>'),
  });

  const response = await invokeSourcesRoute({ query: {}, song, fetchImpl });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(Object.keys(response.body).sort(), ['candidates', 'category', 'discoveredAt', 'success']);
  assert.equal(response.body.success, true);
  assert.equal(response.body.category, 'HINDI');
  assert.equal(response.body.candidates.length, 1);
  assert.equal(response.body.candidates[0].provider, 'azlyrics');
  assert.deepEqual(
    Object.keys(response.body.candidates[0]).sort(),
    ['artist', 'confidence', 'discoveredAt', 'provider', 'providerLabel', 'title', 'url'],
  );
  assert.equal(typeof response.body.discoveredAt, 'string');
});

test('lyrics sources route accepts Vercel path metadata without refresh', async () => {
  const song = {
    _id: 'f1f1f1f1f1f1f1f1f1f1f1f2',
    title: 'Track',
    artist: 'Artist',
    duration: '3:00',
  };
  const response = await invokeSourcesRoute({
    query: { path: 'lyrics/f1f1f1f1f1f1f1f1f1f1f1f2/sources' },
    song,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
});

test('lyrics sources route accepts Vercel path metadata with refresh=1', async () => {
  const song = {
    _id: 'f1f1f1f1f1f1f1f1f1f1f1f3',
    title: 'Track',
    artist: 'Artist',
    duration: '3:00',
  };
  const response = await invokeSourcesRoute({
    query: { path: 'lyrics/f1f1f1f1f1f1f1f1f1f1f1f3/sources', refresh: '1' },
    song,
    user: { role: 'admin', _id: '64b64b64b64b64b64b64b6ff' },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
});

test('lyrics sources route still rejects unknown keys alongside path metadata', async () => {
  const response = await invokeSourcesRoute({
    query: { path: 'lyrics/e1e1e1e1e1e1e1e1e1e1e1e1/sources', debug: '1' },
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { success: false, error: 'invalid lyrics sources query' });
});
