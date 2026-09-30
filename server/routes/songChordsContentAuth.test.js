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

function findContentRoute(method) {
  const layer = songRouter.stack.find(
    (entry) => entry.route && entry.route.path === '/:id/content' && entry.route.methods[method],
  );
  assert.ok(layer, `route ${method} /:id/content must exist`);
  return layer.route;
}

function getContentHandler(method) {
  const route = findContentRoute(method);
  return route.stack[route.stack.length - 1].handle;
}

async function run(method, body, id = 'song-1') {
  const handler = getContentHandler(method);
  const res = createRes();
  await handler({ params: { id }, body }, res);
  return res;
}

async function runWithUpdate(method, body, impl) {
  const handler = getContentHandler(method);
  const original = Song.findByIdAndUpdate;
  let captured = null;
  Song.findByIdAndUpdate = async (_id, update) => {
    captured = update;
    return impl === undefined ? { _id, ...update } : impl(_id, update);
  };
  try {
    const res = createRes();
    await handler({ params: { id: 'song-1' }, body }, res);
    return { res, captured };
  } finally {
    Song.findByIdAndUpdate = original;
  }
}

test('song content routes keep protect and adminOnly ahead of the handler', () => {
  for (const method of ['put', 'patch']) {
    const route = findContentRoute(method);
    const names = route.stack.map((entry) => entry.handle.name);
    assert.equal(names[0], 'protect', `${method} must be protected`);
    assert.equal(names[1], 'adminOnly', `${method} must require admin`);
    assert.equal(route.stack.length, 3);
  }
});

test('song content route rejects an invalid song id without leaking internals', async () => {
  const handler = getContentHandler('put');
  const original = Song.findByIdAndUpdate;
  Song.findByIdAndUpdate = async () => {
    const error = new Error('Cast to ObjectId failed for value "nope" at path "_id" for model "Song"');
    error.name = 'CastError';
    error.path = '_id';
    throw error;
  };
  try {
    const res = createRes();
    await handler({ params: { id: 'nope' }, body: { chords: 'C G Am' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid song id');
  } finally {
    Song.findByIdAndUpdate = original;
  }
});

test('song content route sanitizes unexpected failures to a fixed message', async () => {
  const handler = getContentHandler('put');
  const original = Song.findByIdAndUpdate;
  Song.findByIdAndUpdate = async () => {
    throw new Error('mongo://admin:secret@db.internal melodies');
  };
  try {
    const res = createRes();
    await handler({ params: { id: 'song-1' }, body: { chords: 'C G Am' } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'failed to update song content');
    assert.equal(JSON.stringify(res.body).includes('secret'), false);
    assert.equal(JSON.stringify(res.body).includes('stack'), false);
  } finally {
    Song.findByIdAndUpdate = original;
  }
});

test('song content route returns 404 when the song does not exist', async () => {
  const { res } = await runWithUpdate('put', { chords: 'C G Am', chords_format: 'plain' }, () => null);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'Song not found');
});

test('chord upload payload cannot mass assign unrelated song fields', async () => {
  const res = await run('put', {
    chords: '[C]Hello [G]world',
    chords_format: 'chordpro',
    price: 999,
    user: 'attacker',
    role: 'admin',
    recommendations: ['x'],
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Unknown content field');
});

test('a structured chord file payload persists only chord content fields', async () => {
  const { res, captured } = await runWithUpdate('put', {
    chords: '[Am]তোমার চোখে [Dm]চেয়ে দেখি',
    chords_format: 'chordpro',
    chords_key: 'Am',
    chords_capo: 2,
    chords_tuning: 'Standard',
    chords_notes: 'from json import',
    chords_verified: false,
    chord_timeline: [{ time: 8, chord: 'Dm' }, { time: 0, chord: 'Am' }],
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['song', 'success']);
  assert.equal(captured.chords, '[Am]তোমার চোখে [Dm]চেয়ে দেখি');
  assert.equal(captured.chords_format, 'chordpro');
  assert.equal(captured.chords_key, 'Am');
  assert.equal(captured.chords_capo, 2);
  assert.deepEqual(captured.chord_timeline, [
    { time: 0, chord: 'Am' },
    { time: 8, chord: 'Dm' },
  ]);
  assert.equal('price' in captured, false);
  assert.equal('user' in captured, false);
  assert.equal('role' in captured, false);
  assert.equal('recommendations' in captured, false);
  assert.equal('title' in captured, false);
});

test('plain text chord sheets with unicode lyrics are accepted', async () => {
  const { res, captured } = await runWithUpdate('put', {
    chords: 'Am              Dm\nতোমার চোখে চেয়ে দেখি আমি জীবনটাকে',
    chords_format: 'plain',
  });
  assert.equal(res.statusCode, 200);
  assert.equal(captured.chords.includes('তোমার চোখে'), true);
});

test('replacing and clearing chords both work through the same endpoint', async () => {
  const replaced = await runWithUpdate('put', {
    chords: '[C]Old [G]sheet',
    chords_format: 'chordpro',
  });
  assert.equal(replaced.res.statusCode, 200);
  assert.equal(replaced.captured.chords, '[C]Old [G]sheet');

  const cleared = await runWithUpdate('put', { chords: '' });
  assert.equal(cleared.res.statusCode, 200);
  assert.equal(cleared.captured.chords, '');
});
