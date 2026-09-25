import test from 'node:test';
import assert from 'node:assert/strict';
import songRouter from './songRoutes.js';
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

function getContentHandler(method) {
  const layer = songRouter.stack.find((entry) => entry.route && entry.route.path === '/:id/content' && entry.route.methods[method]);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

test('song content route rejects unknown fields', async () => {
  const handler = getContentHandler('patch');
  const res = createRes();
  await handler({ params: { id: 'x' }, body: { nope: true } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Unknown content field');
});

test('song content route validates bounded URLs', async () => {
  const handler = getContentHandler('patch');
  const res = createRes();
  await handler({ params: { id: 'x' }, body: { chordify_url: 'http://unsafe.test/value' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid chordify URL');
});

test('song content route validates source enums', async () => {
  const handler = getContentHandler('patch');
  const res = createRes();
  await handler({ params: { id: 'x' }, body: { lyrics_source: 'other' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid lyrics source');
});

test('song content route updates valid metadata payload', async () => {
  const handler = getContentHandler('put');
  const original = Song.findByIdAndUpdate;
  Song.findByIdAndUpdate = async (_id, update) => ({ _id: 'song-1', ...update });
  try {
    const res = createRes();
    await handler({
      params: { id: 'song-1' },
      body: {
        lyrics_verified: true,
        lyrics_source: 'db_verified',
        lyrics_last_checked_at: '2026-09-15T00:00:00.000Z',
        chords_verified: false,
        chords_source: 'none',
      },
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.song.lyrics_verified, true);
    assert.equal(res.body.song.lyrics_source, 'db_verified');
  } finally {
    Song.findByIdAndUpdate = original;
  }
});
