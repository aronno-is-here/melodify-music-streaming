import test from 'node:test';
import assert from 'node:assert/strict';
import chordRouter, {
  CHORD_BULK_MAX_BATCH,
  parseChordBulkPayload,
  parseChordBulkQuery,
} from './chordRoutes.js';
import Song from '../models/Song.js';

const SONG_A = '64b64b64b64b64b64b64b642';
const SONG_B = '64b64b64b64b64b64b64b643';

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

function findBulkRoute() {
  const layer = chordRouter.stack.find(
    (entry) => entry.route && entry.route.path === '/bulk' && entry.route.methods.post
  );
  assert.ok(layer, 'route post /bulk must exist');
  return layer.route;
}

function bulkHandler() {
  const route = findBulkRoute();
  return route.stack[route.stack.length - 1].handle;
}

function bulkEntry(overrides = {}) {
  return { songId: SONG_A, chords: '[C]Example line', ...overrides };
}

test('bulk import route is admin protected and read routes stay untouched', () => {
  const route = findBulkRoute();
  const names = route.stack.map((entry) => entry.handle.name);
  assert.equal(route.stack.length, 3);
  assert.equal(names[0], 'protect');
  assert.equal(names[1], 'adminOnly');

  const readRoute = chordRouter.stack.find(
    (entry) => entry.route && entry.route.path === '/:songId' && entry.route.methods.get
  );
  assert.ok(readRoute);
  const importRoute = chordRouter.stack.find(
    (entry) => entry.route && entry.route.path === '/import' && entry.route.methods.post
  );
  assert.ok(importRoute);
});

test('CHORD_BULK_MAX_BATCH is exactly 200', () => {
  assert.equal(CHORD_BULK_MAX_BATCH, 200);
});

test('parseChordBulkQuery accepts only the documented replaceVerified flag', () => {
  assert.deepEqual(parseChordBulkQuery(undefined), { ok: true, error: null, replaceVerified: false });
  assert.deepEqual(parseChordBulkQuery({}), { ok: true, error: null, replaceVerified: false });
  assert.deepEqual(parseChordBulkQuery({ replaceVerified: 'false' }), { ok: true, error: null, replaceVerified: false });
  assert.deepEqual(parseChordBulkQuery({ replaceVerified: 'true' }), { ok: true, error: null, replaceVerified: true });
  assert.equal(parseChordBulkQuery({ debug: 'true' }).error, 'Invalid chord bulk query');
  assert.equal(parseChordBulkQuery({ replaceVerified: 'yes' }).error, 'Invalid chord bulk query');
  assert.equal(parseChordBulkQuery({ replaceVerified: ['true'] }).error, 'Invalid chord bulk query');
  assert.equal(parseChordBulkQuery({ replaceVerified: true }).error, 'Invalid chord bulk query');
});

test('parseChordBulkPayload rejects malformed batches before any validation work', () => {
  assert.equal(parseChordBulkPayload(null).error, 'Invalid chord bulk batch');
  assert.equal(parseChordBulkPayload({ songs: [] }).error, 'Invalid chord bulk batch');
  assert.equal(parseChordBulkPayload('x').error, 'Invalid chord bulk batch');
  assert.equal(parseChordBulkPayload([]).error, 'Invalid chord bulk batch');
  const oversized = Array.from({ length: CHORD_BULK_MAX_BATCH + 1 }, () => bulkEntry());
  assert.equal(parseChordBulkPayload(oversized).error, 'Invalid chord bulk batch');
  const exact = Array.from({ length: CHORD_BULK_MAX_BATCH }, (_, index) => bulkEntry({ songId: SONG_A }));
  assert.equal(parseChordBulkPayload(exact).ok, true);
});

test('parseChordBulkPayload accepts the documented chords alias and full metadata', () => {
  const result = parseChordBulkPayload([
    {
      songId: SONG_A,
      chords: '[C]Example line',
      format: 'chordpro',
      key: 'C',
      capo: 0,
      tuning: 'Standard',
      verified: true,
    },
  ]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.counts, { imported: 0, rejected: 0, duplicate: 0, invalid: 0 });
  assert.equal(result.requested, 1);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].text, '[C]Example line');
  assert.equal(result.entries[0].format, 'chordpro');
  assert.equal(result.entries[0].key, 'C');
  assert.equal(result.entries[0].capo, 0);
  assert.equal(result.entries[0].tuning, 'Standard');
  assert.equal(result.entries[0].verified, true);
  assert.equal(result.entries[0].verifiedProvided, true);
});

test('parseChordBulkPayload validates song id format capo key format and timeline per entry', () => {
  const badId = parseChordBulkPayload([bulkEntry({ songId: 'nope' })]);
  assert.equal(badId.counts.invalid, 1);
  const badCapo = parseChordBulkPayload([bulkEntry({ capo: 13 })]);
  assert.equal(badCapo.counts.invalid, 1);
  const badKey = parseChordBulkPayload([bulkEntry({ key: 'Nope' })]);
  assert.equal(badKey.counts.invalid, 1);
  const badFormat = parseChordBulkPayload([bulkEntry({ format: 'tablature' })]);
  assert.equal(badFormat.counts.invalid, 1);
  const badTimeline = parseChordBulkPayload([bulkEntry({ timeline: [{ time: 1 }] })]);
  assert.equal(badTimeline.counts.invalid, 1);
  const badVerified = parseChordBulkPayload([bulkEntry({ verified: 'yes' })]);
  assert.equal(badVerified.counts.invalid, 1);
  const badSource = parseChordBulkPayload([bulkEntry({ source: 'random' })]);
  assert.equal(badSource.counts.invalid, 1);
  const badUrl = parseChordBulkPayload([bulkEntry({ sourceUrl: 'http://evil.test/x' })]);
  assert.equal(badUrl.counts.invalid, 1);
});

test('parseChordBulkPayload rejects empty text missing text and conflicting text keys', () => {
  assert.equal(parseChordBulkPayload([bulkEntry({ chords: '' })]).counts.invalid, 1);
  assert.equal(parseChordBulkPayload([{ songId: SONG_A }]).counts.invalid, 1);
  const both = parseChordBulkPayload([{ songId: SONG_A, chords: '[C]x', text: 'C G' }]);
  assert.equal(both.counts.invalid, 1);
  const plainText = parseChordBulkPayload([{ songId: SONG_A, text: 'C G Am F' }]);
  assert.equal(plainText.ok, true);
  assert.equal(plainText.entries[0].text, 'C G Am F');
});

test('parseChordBulkPayload rejects HTML in chord text and notes', () => {
  const htmlText = parseChordBulkPayload([bulkEntry({ chords: '<script>alert(1)</script>' })]);
  assert.equal(htmlText.counts.invalid, 1);
  const htmlNotes = parseChordBulkPayload([bulkEntry({ notes: '<b>bold</b>' })]);
  assert.equal(htmlNotes.counts.invalid, 1);
  const plain = parseChordBulkPayload([bulkEntry({ chords: '[C]a < b' })]);
  assert.equal(plain.counts.invalid, 0);
});

test('parseChordBulkPayload counts repeated song ids as duplicates and keeps mixed batches', () => {
  const result = parseChordBulkPayload([
    bulkEntry(),
    bulkEntry(),
    bulkEntry({ songId: SONG_B, chords: '[G]Second' }),
    bulkEntry({ songId: 'bad' }),
    bulkEntry({ songId: SONG_B, capo: 99 }),
  ]);
  assert.deepEqual(result.counts, { imported: 0, rejected: 0, duplicate: 1, invalid: 2 });
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries.map((entry) => entry.songId), [SONG_A, SONG_B]);
});

test('bulk endpoint rejects an invalid query before parsing the body', async () => {
  const handler = bulkHandler();
  const originalFind = Song.find;
  Song.find = () => {
    throw new Error('must not query');
  };
  try {
    const res = createRes();
    await handler({ body: [bulkEntry()], query: { debug: 'true' } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid chord bulk query');
  } finally {
    Song.find = originalFind;
  }
});

test('bulk endpoint rejects a malformed batch without touching the database', async () => {
  const handler = bulkHandler();
  const originalFind = Song.find;
  let findCalls = 0;
  Song.find = () => {
    findCalls += 1;
    return { select: async () => [] };
  };
  try {
    const res = createRes();
    await handler({ body: [], query: {} }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid chord bulk batch');
    assert.equal(findCalls, 0);
  } finally {
    Song.find = originalFind;
  }
});

test('bulk endpoint imports valid entries and returns the four counts', async () => {
  const handler = bulkHandler();
  const originalFind = Song.find;
  const originalUpdate = Song.findByIdAndUpdate;
  const updates = [];
  let findCalls = 0;
  Song.find = (filter) => {
    findCalls += 1;
    assert.deepEqual(Object.keys(filter), ['_id']);
    assert.deepEqual(Object.keys(filter._id), ['$in']);
    return { select: async () => [{ _id: SONG_A, chords_verified: false }] };
  };
  Song.findByIdAndUpdate = async (id, update) => {
    updates.push({ id, update });
    return { _id: id };
  };
  try {
    const res = createRes();
    await handler({
      body: [
        bulkEntry({ format: 'chordpro', key: 'C', capo: 0, tuning: 'Standard', verified: true }),
        bulkEntry(),
        bulkEntry({ songId: 'bad' }),
      ],
      query: {},
    }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      success: true,
      requested: 3,
      imported: 1,
      rejected: 0,
      duplicate: 1,
      invalid: 1,
    });
    assert.equal(findCalls, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, SONG_A);
    assert.equal(updates[0].update.chords, '[C]Example line');
    assert.equal(updates[0].update.chords_format, 'chordpro');
    assert.equal(updates[0].update.chords_key, 'C');
    assert.equal(updates[0].update.chords_capo, 0);
    assert.equal(updates[0].update.chords_tuning, 'Standard');
    assert.equal(updates[0].update.chords_verified, true);
    assert.deepEqual(updates[0].update.chord_timeline, []);
    assert.ok(updates[0].update.chords_last_checked_at instanceof Date);
  } finally {
    Song.find = originalFind;
    Song.findByIdAndUpdate = originalUpdate;
  }
});

test('bulk endpoint never overwrites verified chords without replaceVerified', async () => {
  const handler = bulkHandler();
  const originalFind = Song.find;
  const originalUpdate = Song.findByIdAndUpdate;
  const updates = [];
  Song.find = () => ({ select: async () => [{ _id: SONG_A, chords_verified: true }] });
  Song.findByIdAndUpdate = async (id, update) => {
    updates.push({ id, update });
    return { _id: id };
  };
  try {
    const guarded = createRes();
    await handler({ body: [bulkEntry()], query: {} }, guarded);
    assert.equal(guarded.statusCode, 200);
    assert.equal(guarded.body.rejected, 1);
    assert.equal(guarded.body.imported, 0);
    assert.equal(updates.length, 0);

    const allowed = createRes();
    await handler({ body: [bulkEntry()], query: { replaceVerified: 'true' } }, allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body.imported, 1);
    assert.equal(updates.length, 1);
    assert.equal('chords_verified' in updates[0].update, false);
  } finally {
    Song.find = originalFind;
    Song.findByIdAndUpdate = originalUpdate;
  }
});

test('bulk endpoint rejects entries whose song is missing or vanishes mid-run', async () => {
  const handler = bulkHandler();
  const originalFind = Song.find;
  const originalUpdate = Song.findByIdAndUpdate;
  try {
    Song.find = () => ({ select: async () => [] });
    const missing = createRes();
    await handler({ body: [bulkEntry()], query: {} }, missing);
    assert.equal(missing.statusCode, 200);
    assert.equal(missing.body.rejected, 1);
    assert.equal(missing.body.imported, 0);

    Song.find = () => ({ select: async () => [{ _id: SONG_A, chords_verified: false }] });
    Song.findByIdAndUpdate = async () => null;
    const vanished = createRes();
    await handler({ body: [bulkEntry()], query: {} }, vanished);
    assert.equal(vanished.statusCode, 200);
    assert.equal(vanished.body.rejected, 1);
    assert.equal(vanished.body.imported, 0);
  } finally {
    Song.find = originalFind;
    Song.findByIdAndUpdate = originalUpdate;
  }
});

test('bulk endpoint sanitizes failures to a fixed error', async () => {
  const handler = bulkHandler();
  const originalFind = Song.find;
  Song.find = () => {
    throw new Error('mongodb://user:secret@host/db');
  };
  try {
    const res = createRes();
    await handler({ body: [bulkEntry()], query: {} }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'failed to import chords');
    assert.equal(JSON.stringify(res.body).includes('secret'), false);
  } finally {
    Song.find = originalFind;
  }
});
