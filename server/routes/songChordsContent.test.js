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
  const layer = songRouter.stack.find(
    (entry) => entry.route && entry.route.path === '/:id/content' && entry.route.methods[method]
  );
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function run(body) {
  const handler = getContentHandler('put');
  const res = createRes();
  await handler({ params: { id: 'song-1' }, body }, res);
  return res;
}

async function runWithUpdate(body) {
  const handler = getContentHandler('put');
  const original = Song.findByIdAndUpdate;
  let captured = null;
  Song.findByIdAndUpdate = async (_id, update) => {
    captured = update;
    return { _id: 'song-1', ...update };
  };
  try {
    const res = createRes();
    await handler({ params: { id: 'song-1' }, body }, res);
    return { res, captured };
  } finally {
    Song.findByIdAndUpdate = original;
  }
}

test('song content route persists bounded chord metadata', async () => {
  const { res, captured } = await runWithUpdate({
    chords_format: 'chordpro',
    chords_key: 'Am',
    chords_capo: 5,
    chords_tuning: 'Standard',
    chords_notes: '  verified by ear  ',
    chords_verified_by: 'admin-1',
    chord_timeline: [{ time: 3, chord: 'Am' }, { time: 1, chord: 'C' }],
  });

  assert.equal(res.statusCode, 200);
  assert.equal(captured.chords_format, 'chordpro');
  assert.equal(captured.chords_key, 'Am');
  assert.equal(captured.chords_capo, 5);
  assert.equal(captured.chords_tuning, 'Standard');
  assert.equal(captured.chords_notes, 'verified by ear');
  assert.equal(captured.chords_verified_by, 'admin-1');
  assert.deepEqual(captured.chord_timeline, [
    { time: 1, chord: 'C' },
    { time: 3, chord: 'Am' },
  ]);
});

test('song content route clears the chord timeline with an empty array', async () => {
  const { res, captured } = await runWithUpdate({ chord_timeline: [] });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(captured.chord_timeline, []);
});

test('song content route accepts an unset chord timeline', async () => {
  const { res, captured } = await runWithUpdate({ chord_timeline: null });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(captured.chord_timeline, []);
});

test('song content route rejects an unknown chord format', async () => {
  const res = await run({ chords_format: 'guitarpro' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid chords format');
});

test('song content route rejects a non-string chord format', async () => {
  const res = await run({ chords_format: 7 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid chords format');
});

test('song content route rejects an out-of-range capo', async () => {
  assert.equal((await run({ chords_capo: 13 })).statusCode, 400);
  assert.equal((await run({ chords_capo: -1 })).body.error, 'Invalid chords capo');
  assert.equal((await run({ chords_capo: 2.5 })).body.error, 'Invalid chords capo');
  assert.equal((await run({ chords_capo: 'three' })).body.error, 'Invalid chords capo');
});

test('song content route accepts an empty capo and stores null', async () => {
  const { res, captured } = await runWithUpdate({ chords_capo: '' });
  assert.equal(res.statusCode, 200);
  assert.equal(captured.chords_capo, null);
});

test('song content route rejects an invalid chord key', async () => {
  const res = await run({ chords_key: 'H' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid chords key');
});

test('song content route rejects overlong chord tuning notes and verifier values', async () => {
  assert.equal((await run({ chords_tuning: 'x'.repeat(33) })).body.error, 'Invalid chords tuning');
  assert.equal((await run({ chords_notes: 'a'.repeat(1001) })).body.error, 'Invalid chords notes');
  assert.equal((await run({ chords_verified_by: 'b'.repeat(129) })).body.error, 'Invalid chords verifier');
});

test('song content route rejects an overlong chord sheet', async () => {
  const res = await run({ chords: 'C '.repeat(50001) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid chords value');
});

test('song content route rejects a malformed chord sheet for the declared format', async () => {
  const res = await run({ chords: 'just some words', chords_format: 'plain' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid chords sheet');
});

test('song content route rejects a malformed chord timeline', async () => {
  assert.equal((await run({ chord_timeline: [{ time: -5, chord: 'C' }] })).body.error, 'Invalid chord timeline');
  assert.equal((await run({ chord_timeline: [{ time: 1, chord: '' }] })).body.error, 'Invalid chord timeline');
  assert.equal((await run({ chord_timeline: 'not-an-array' })).body.error, 'Invalid chord timeline');
  assert.equal((await run({ chord_timeline: 'nope' })).body.error, 'Invalid chord timeline');
});

test('song content route rejects a chord timeline over the entry ceiling', async () => {
  const oversized = Array.from({ length: 2001 }, (_value, index) => ({ time: index, chord: 'C' }));
  const res = await run({ chord_timeline: oversized });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid chord timeline');
});

test('song content route persists a valid chord sheet', async () => {
  const { res, captured } = await runWithUpdate({
    chords: '[C]Hello [G]world',
    chords_format: 'chordpro',
    chords_verified: true,
  });
  assert.equal(res.statusCode, 200);
  assert.equal(captured.chords, '[C]Hello [G]world');
  assert.equal(captured.chords_verified, true);
});
