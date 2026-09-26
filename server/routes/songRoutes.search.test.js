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

function getIndexHandler() {
  const layer = songRouter.stack.find((entry) => entry.route && entry.route.path === '/' && entry.route.methods.get);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function runSearch(queryParams, { songs = [] } = {}) {
  const handler = getIndexHandler();
  const originalFind = Song.find;
  const originalCount = Song.countDocuments;
  let capturedQuery = null;
  Song.find = (query) => {
    capturedQuery = query;
    return {
      sort: () => ({ skip: () => ({ limit: async () => songs }) }),
    };
  };
  Song.countDocuments = async () => songs.length;
  try {
    const res = createRes();
    await handler({ query: queryParams }, res);
    return { res, capturedQuery };
  } finally {
    Song.find = originalFind;
    Song.countDocuments = originalCount;
  }
}

test('song search matches title, artist, and album case-insensitively', async () => {
  const { res, capturedQuery } = await runSearch({ q: 'night' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.deepEqual(capturedQuery.$or, [
    { title: { $regex: 'night', $options: 'i' } },
    { artist: { $regex: 'night', $options: 'i' } },
    { album: { $regex: 'night', $options: 'i' } },
  ]);
});

test('song search escapes regex metacharacters before matching', async () => {
  const { capturedQuery } = await runSearch({ q: 'a.b(c)' });
  assert.deepEqual(capturedQuery.$or, [
    { title: { $regex: 'a\\.b\\(c\\)', $options: 'i' } },
    { artist: { $regex: 'a\\.b\\(c\\)', $options: 'i' } },
    { album: { $regex: 'a\\.b\\(c\\)', $options: 'i' } },
  ]);
});

test('song search ignores whitespace-only queries', async () => {
  const { res, capturedQuery } = await runSearch({ q: '   ' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(capturedQuery.$or, undefined);
});

test('song search keeps the existing pagination and response shape', async () => {
  const { res, capturedQuery } = await runSearch({ q: 'x', page: '2', limit: '10' });
  assert.equal(res.body.page, 2);
  assert.equal(res.body.limit, 10);
  assert.equal(res.body.total, 0);
  assert.equal(res.body.pages, 0);
  assert.deepEqual(Object.keys(res.body).sort(), ['limit', 'page', 'pages', 'songs', 'success', 'total']);
  assert.ok(capturedQuery.$or.length === 3);
});

test('song search returns matched songs with the success envelope', async () => {
  const doc = {
    _id: 's1',
    title: 'Song',
    artist: 'Artist',
    album: 'album-name',
    poster_url: '',
    toObject() {
      return { _id: this._id, title: this.title, artist: this.artist, album: this.album, poster_url: this.poster_url };
    },
  };
  const { res } = await runSearch({ q: 'album-name' }, { songs: [doc] });
  assert.equal(res.body.success, true);
  assert.equal(res.body.songs.length, 1);
  assert.equal(res.body.songs[0].album, 'album-name');
});
