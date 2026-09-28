import test from 'node:test';
import assert from 'node:assert/strict';
import chordRouter, { buildChordPayload, parseChordImportPayload } from './chordRoutes.js';
import { CHORD_API_STATUS } from '../utils/chordProvider.js';
import Song from '../models/Song.js';

const PAYLOAD_KEYS = [
  'success',
  'status',
  'text',
  'format',
  'key',
  'capo',
  'tuning',
  'timeline',
  'source',
  'sourceUrl',
  'verified',
];

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

function findRoute(path, method) {
  const layer = chordRouter.stack.find(
    (entry) => entry.route && entry.route.path === path && entry.route.methods[method]
  );
  assert.ok(layer, `route ${method} ${path} must exist`);
  return layer.route;
}

test('chord routes expose a protected admin import endpoint and a public read endpoint', () => {
  const importRoute = findRoute('/import', 'post');
  const names = importRoute.stack.map((entry) => entry.handle.name);
  assert.equal(importRoute.stack.length, 3);
  assert.equal(names[0], 'protect');
  assert.equal(names[1], 'adminOnly');

  const readRoute = findRoute('/:songId', 'get');
  assert.equal(readRoute.stack.length, 1);
});

test('buildChordPayload returns only the documented response keys', () => {
  const payload = buildChordPayload({
    chords: 'C G Am F',
    chords_verified: true,
    chords_source: 'db_verified',
    chords_format: 'plain',
    chords_key: 'C',
    chords_capo: 0,
    chords_tuning: 'Standard',
    chord_timeline: [{ time: 4, chord: 'G' }],
    chords_reference_url: 'https://example.com/chords',
    email: 'admin@example.com',
    password: 'hunter2',
  });
  assert.deepEqual(Object.keys(payload), PAYLOAD_KEYS);
  assert.equal(payload.success, true);
  assert.equal(payload.status, CHORD_API_STATUS.VERIFIED);
  assert.equal(payload.verified, true);
  assert.equal(payload.text, 'C G Am F');
  assert.equal(payload.format, 'plain');
  assert.equal(payload.key, 'C');
  assert.equal(payload.capo, 0);
  assert.equal(payload.tuning, 'Standard');
  assert.equal(payload.timeline.length, 1);
  assert.equal(payload.source, 'db_verified');
  assert.equal(payload.sourceUrl, 'https://example.com/chords');
});

test('buildChordPayload reports available status for unverified chord text', () => {
  const payload = buildChordPayload({ chords: '[C]Hello [G]world', chords_verified: false });
  assert.equal(payload.status, CHORD_API_STATUS.AVAILABLE);
  assert.equal(payload.verified, false);
  assert.equal(payload.format, 'chordpro');
  assert.equal(payload.timeline, null);
  assert.equal(payload.key, null);
  assert.equal(payload.capo, null);
});

test('buildChordPayload reports source-found when only a source page exists', () => {
  const payload = buildChordPayload({
    chords: '',
    chordify_url: 'https://chordify.net/chords/example-song',
  });
  assert.equal(payload.status, CHORD_API_STATUS.SOURCE_FOUND);
  assert.equal(payload.text, '');
  assert.equal(payload.sourceUrl, 'https://chordify.net/chords/example-song');
});

test('buildChordPayload reports unavailable without text or source', () => {
  const payload = buildChordPayload({ chords: '' });
  assert.equal(payload.status, CHORD_API_STATUS.UNAVAILABLE);
  assert.equal(payload.sourceUrl, null);
  assert.equal(payload.timeline, null);
});

test('buildChordPayload normalizes and sorts the chord timeline', () => {
  const payload = buildChordPayload({
    chords: 'C',
    chords_verified: true,
    chord_timeline: [{ time: 9, chord: 'F' }, { time: 2, chord: 'G' }],
  });
  assert.deepEqual(payload.timeline, [
    { time: 2, chord: 'G' },
    { time: 9, chord: 'F' },
  ]);
});

test('buildChordPayload ignores malformed stored chord metadata', () => {
  const payload = buildChordPayload({
    chords: '',
    chords_key: 'NotAKey',
    chords_capo: 42,
    chord_timeline: [{ time: -1, chord: 'C' }],
    chords_tuning: '',
  });
  assert.equal(payload.key, null);
  assert.equal(payload.capo, null);
  assert.equal(payload.timeline, null);
  assert.equal(payload.tuning, null);
});

test('parseChordImportPayload rejects non-object payloads and unknown top-level fields', () => {
  assert.deepEqual(parseChordImportPayload(null).error, 'Invalid chord import payload');
  assert.deepEqual(parseChordImportPayload([]).error, 'Invalid chord import payload');
  assert.equal(parseChordImportPayload({ songs: [], debug: true }).error, 'Unknown chord import field');
});

test('parseChordImportPayload bounds the batch size', () => {
  assert.equal(parseChordImportPayload({ songs: [] }).error, 'Invalid chord import batch');
  const oversized = Array.from({ length: 26 }, () => ({
    songId: '64b64b64b64b64b64b64b642',
    text: 'C G Am F',
  }));
  assert.equal(parseChordImportPayload({ songs: oversized }).error, 'Invalid chord import batch');
});

test('parseChordImportPayload rejects unknown entry fields', () => {
  const result = parseChordImportPayload({
    songs: [{ songId: '64b64b64b64b64b64b64b642', text: 'C', email: 'a@b.c' }],
  });
  assert.equal(result.error, 'Unknown chord import field');
});

test('parseChordImportPayload rejects invalid song identifiers', () => {
  assert.equal(parseChordImportPayload({ songs: [{ songId: 'nope', text: 'C' }] }).error, 'Invalid chord song id');
  assert.equal(parseChordImportPayload({ songs: [{ text: 'C' }] }).error, 'Invalid chord song id');
});

test('parseChordImportPayload rejects malformed chord sheets and formats', () => {
  const badSheet = parseChordImportPayload({ songs: [{ songId: '64b64b64b64b64b64b64b642', text: 'just words', format: 'plain' }] });
  assert.equal(badSheet.error, 'Invalid chords sheet');
  const badFormat = parseChordImportPayload({ songs: [{ songId: '64b64b64b64b64b64b64b642', text: 'C', format: 'guitarpro' }] });
  assert.equal(badFormat.error, 'Invalid chords format');
  const badMarker = parseChordImportPayload({ songs: [{ songId: '64b64b64b64b64b64b64b642', text: '[Hello]lyrics', format: 'chordpro' }] });
  assert.equal(badMarker.error, 'Invalid chords sheet');
});

test('parseChordImportPayload rejects invalid capo key tuning and timeline values', () => {
  const entry = (extra) => ({ songId: '64b64b64b64b64b64b64b642', text: 'C', ...extra });
  assert.equal(parseChordImportPayload({ songs: [entry({ capo: 13 })] }).error, 'Invalid chords capo');
  assert.equal(parseChordImportPayload({ songs: [entry({ capo: -1 })] }).error, 'Invalid chords capo');
  assert.equal(parseChordImportPayload({ songs: [entry({ key: 'Nope' })] }).error, 'Invalid chords key');
  assert.equal(parseChordImportPayload({ songs: [entry({ tuning: 'x'.repeat(33) })] }).error, 'Invalid chords tuning');
  assert.equal(parseChordImportPayload({ songs: [entry({ timeline: [{ time: 1 }] })] }).error, 'Invalid chord timeline');
  assert.equal(parseChordImportPayload({ songs: [entry({ timeline: 'nope' })] }).error, 'Invalid chord timeline');
  assert.equal(parseChordImportPayload({ songs: [entry({ source: 'random' })] }).error, 'Invalid chords source');
  assert.equal(parseChordImportPayload({ songs: [entry({ sourceUrl: 'http://evil.test/x' })] }).error, 'Invalid chord source URL');
  assert.equal(parseChordImportPayload({ songs: [entry({ verified: 'yes' })] }).error, 'Invalid chords verification flag');
});

test('parseChordImportPayload accepts a bounded valid batch', () => {
  const result = parseChordImportPayload({
    songs: [
      {
        songId: '64b64b64b64b64b64b64b642',
        text: 'C G Am F',
        format: 'plain',
        key: 'C',
        capo: 3,
        tuning: 'Standard',
        notes: 'verified by ear',
        verified: true,
        source: 'db_verified',
        sourceUrl: 'https://example.com/chords',
      },
      {
        songId: '64b64b64b64b64b64b64b643',
        text: '[C]Hello',
        timeline: [{ time: 1, chord: 'C' }],
      },
    ],
  });
  assert.equal(result.ok, true);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].capo, 3);
  assert.equal(result.entries[0].verified, true);
  assert.equal(result.entries[0].source, 'db_verified');
  assert.equal(result.entries[1].format, 'chordpro');
  assert.equal(result.entries[1].verified, false);
  assert.equal(result.entries[1].source, null);
});

test('chord import endpoint validates before touching the database', async () => {
  const importRoute = findRoute('/import', 'post');
  const handler = importRoute.stack[importRoute.stack.length - 1].handle;
  const originalFind = Song.find;
  const originalUpdate = Song.findByIdAndUpdate;
  let findCalls = 0;
  Song.find = () => {
    findCalls += 1;
    return { select: async () => [{ _id: '64b64b64b64b64b64b64b642' }] };
  };
  Song.findByIdAndUpdate = async () => {
    throw new Error('must not write');
  };
  try {
    const res = createRes();
    await handler({ body: { songs: [{ songId: '64b64b64b64b64b64b64b642', text: 'nope', format: 'plain' }] } }, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'Invalid chords sheet');
    assert.equal(findCalls, 0);
  } finally {
    Song.find = originalFind;
    Song.findByIdAndUpdate = originalUpdate;
  }
});

test('chord import endpoint writes validated entries', async () => {
  const importRoute = findRoute('/import', 'post');
  const handler = importRoute.stack[importRoute.stack.length - 1].handle;
  const originalFind = Song.find;
  const originalUpdate = Song.findByIdAndUpdate;
  const updates = [];
  Song.find = () => ({ select: async () => [{ _id: '64b64b64b64b64b64b64b642' }] });
  Song.findByIdAndUpdate = async (id, update) => {
    updates.push({ id, update });
    return { _id: id };
  };
  try {
    const res = createRes();
    await handler({
      body: {
        songs: [{
          songId: '64b64b64b64b64b64b64b642',
          text: 'C G Am F',
          format: 'plain',
          key: 'C',
          capo: 2,
          verified: true,
          source: 'db_verified',
        }],
      },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.requested, 1);
    assert.equal(res.body.updated, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].update.chords, 'C G Am F');
    assert.equal(updates[0].update.chords_capo, 2);
    assert.equal(updates[0].update.chords_verified, true);
    assert.deepEqual(updates[0].update.chord_timeline, []);
  } finally {
    Song.find = originalFind;
    Song.findByIdAndUpdate = originalUpdate;
  }
});

test('chord import endpoint returns 404 when a song is missing', async () => {
  const importRoute = findRoute('/import', 'post');
  const handler = importRoute.stack[importRoute.stack.length - 1].handle;
  const originalFind = Song.find;
  Song.find = () => ({ select: async () => [] });
  try {
    const res = createRes();
    await handler({ body: { songs: [{ songId: '64b64b64b64b64b64b64b642', text: 'C' }] } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Song not found');
  } finally {
    Song.find = originalFind;
  }
});

test('chord read endpoint rejects malformed song ids without querying', async () => {
  const readRoute = findRoute('/:songId', 'get');
  const handler = readRoute.stack[0].handle;
  const originalFind = Song.findById;
  let calls = 0;
  Song.findById = async () => {
    calls += 1;
    return null;
  };
  try {
    const res = createRes();
    await handler({ params: { songId: 'not-an-id' } }, res);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.error, 'Song not found');
    assert.equal(calls, 0);
  } finally {
    Song.findById = originalFind;
  }
});

test('chord read endpoint sanitizes failures to a fixed error', async () => {
  const readRoute = findRoute('/:songId', 'get');
  const handler = readRoute.stack[0].handle;
  const originalFind = Song.findById;
  Song.findById = async () => {
    throw new Error('mongodb://user:secret@host/db');
  };
  try {
    const res = createRes();
    await handler({ params: { songId: '64b64b64b64b64b64b64b642' } }, res);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, 'failed to load chords');
    assert.equal(JSON.stringify(res.body).includes('secret'), false);
  } finally {
    Song.findById = originalFind;
  }
});

test('chord read endpoint serves the song payload', async () => {
  const readRoute = findRoute('/:songId', 'get');
  const handler = readRoute.stack[0].handle;
  const originalFind = Song.findById;
  Song.findById = async () => ({
    chords: 'C G Am F',
    chords_verified: true,
    chords_source: 'db_verified',
    chords_format: 'plain',
  });
  try {
    const res = createRes();
    await handler({ params: { songId: '64b64b64b64b64b64b64b642' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, CHORD_API_STATUS.VERIFIED);
    assert.equal(res.body.text, 'C G Am F');
  } finally {
    Song.findById = originalFind;
  }
});
