import test from 'node:test';
import assert from 'node:assert/strict';
import lyricsRouter from './lyricsRoutes.js';
import Song from '../models/Song.js';

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
