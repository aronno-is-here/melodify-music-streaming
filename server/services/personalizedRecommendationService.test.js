import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createPersonalizedRecommendationService,
  DEFAULT_RECOMMENDATION_API_LIMIT,
  MAX_RECOMMENDATION_API_LIMIT,
  RECOMMENDATION_SOURCE,
  RECOMMENDATION_STATUS,
  PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES,
  PersonalizedRecommendationError,
  PersonalizedRecommendationValidationError,
  PersonalizedRecommendationReadError,
} from './personalizedRecommendationService.js';
import { MAX_SNAPSHOT_ITEMS } from '../models/RecommendationSnapshot.js';

const id = (n) => n.toString(16).padStart(24, '0');
const USER_A = id(0xa);
const USER_B = id(0xb);
const SONG_1 = id(1);
const SONG_2 = id(2);
const SONG_3 = id(3);
const SONG_4 = id(4);
const SONG_5 = id(5);
const GENERATED_AT = new Date('2026-09-15T12:00:00.000Z');

const songDoc = (fields = {}) => ({
  _id: SONG_1,
  title: 'Title One',
  artist: 'Artist One',
  genre: 'Pop',
  youtube_id: 'yt1',
  file_path: '',
  poster_url: 'https://img.example/1.jpg',
  duration: '3:00',
  duration_seconds: 180,
  release_date: new Date('2024-01-01T00:00:00.000Z'),
  language: 'English',
  category: 'music',
  recommendation_eligible: true,
  ...fields,
});

const snapshotItem = (rank, songId, fields = {}) => ({
  rank,
  song: songId,
  basis: 'hybrid',
  policy_score: 0.8,
  hybrid_score: 0.7,
  profile_score: null,
  collaborative_known: true,
  ...fields,
});

const snapshotDoc = (fields = {}) => ({
  _id: id(0x100),
  schema_version: 1,
  user: USER_A,
  snapshot_version: 'v1',
  artifact_version: null,
  generated_at: GENERATED_AT,
  items: [
    snapshotItem(1, SONG_1),
    snapshotItem(2, SONG_2),
    snapshotItem(3, SONG_3),
  ],
  summary: {},
  payload_sha256: 'a'.repeat(64),
  ...fields,
});

function createHarness({
  snapshot = null,
  snapshotError = null,
  songs = [],
  songError = null,
} = {}) {
  const calls = {
    snapshot: [],
    songFind: [],
  };

  const recommendationSnapshotService = {
    async getLatestRecommendationSnapshotForUser(userId) {
      calls.snapshot.push(userId);
      if (snapshotError) throw snapshotError;
      return snapshot;
    },
  };

  const chain = {
    select(spec) {
      chain.selectSpec = spec;
      return chain;
    },
    lean() {
      if (songError) return Promise.reject(songError);
      return Promise.resolve(songs);
    },
  };

  const SongModel = {
    find(filter) {
      calls.songFind.push(filter);
      return chain;
    },
  };

  const service = createPersonalizedRecommendationService({
    recommendationSnapshotService,
    SongModel,
  });

  return { service, calls, chain };
}

const run = (overrides = {}) =>
  createHarness(overrides).service.getPersonalizedRecommendations({
    userId: USER_A,
    limit: DEFAULT_RECOMMENDATION_API_LIMIT,
    ...overrides.options,
  });

test('1: DEFAULT_RECOMMENDATION_API_LIMIT = 10', () => {
  assert.equal(DEFAULT_RECOMMENDATION_API_LIMIT, 10);
});

test('2: MAX_RECOMMENDATION_API_LIMIT = 100', () => {
  assert.equal(MAX_RECOMMENDATION_API_LIMIT, 100);
});

test('3: MAX aligns with MAX_SNAPSHOT_ITEMS', () => {
  assert.equal(MAX_RECOMMENDATION_API_LIMIT, MAX_SNAPSHOT_ITEMS);
});

test('4: RECOMMENDATION_SOURCE = personalized-snapshot', () => {
  assert.equal(RECOMMENDATION_SOURCE, 'personalized-snapshot');
});

test('5: RECOMMENDATION_STATUS.ready = ready', () => {
  assert.equal(RECOMMENDATION_STATUS.READY, 'ready');
});

test('6: RECOMMENDATION_STATUS.no-snapshot = no-snapshot', () => {
  assert.equal(RECOMMENDATION_STATUS.NO_SNAPSHOT, 'no-snapshot');
});

test('7: disabled HTTP message exact text', () => {
  assert.equal(
    PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.disabled,
    'Personalized recommendations are currently unavailable.',
  );
});

test('8: failed HTTP message exact text', () => {
  assert.equal(
    PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.failed,
    'failed to load personalized recommendations',
  );
});

test('9: invalid query HTTP message present', () => {
  assert.equal(
    PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.invalidQuery,
    'Invalid recommendation query',
  );
});

test('10: PersonalizedRecommendationError extends Error', () => {
  const error = new PersonalizedRecommendationError('x');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'PersonalizedRecommendationError');
  assert.equal(error.message, 'x');
});

test('11: ValidationError extends PersonalizedRecommendationError', () => {
  const error = new PersonalizedRecommendationValidationError('x');
  assert.ok(error instanceof PersonalizedRecommendationError);
  assert.equal(error.name, 'PersonalizedRecommendationValidationError');
});

test('12: ReadError extends PersonalizedRecommendationError', () => {
  const error = new PersonalizedRecommendationReadError('x');
  assert.ok(error instanceof PersonalizedRecommendationError);
  assert.equal(error.name, 'PersonalizedRecommendationReadError');
});

test('13: factory rejects missing snapshot service', () => {
  assert.throws(
    () => createPersonalizedRecommendationService({ recommendationSnapshotService: {} }),
    PersonalizedRecommendationValidationError,
  );
});

test('14: factory rejects missing SongModel find', () => {
  assert.throws(
    () => createPersonalizedRecommendationService({ SongModel: {} }),
    PersonalizedRecommendationValidationError,
  );
});

test('15: invalid user id rejects non-string', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: 42, limit: 10 }),
    PersonalizedRecommendationValidationError,
  );
});

test('16: invalid user id rejects short string', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: 'abc', limit: 10 }),
    PersonalizedRecommendationValidationError,
  );
});

test('17: invalid user id rejects non-hex', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: 'z'.repeat(24), limit: 10 }),
    PersonalizedRecommendationValidationError,
  );
});

test('18: invalid user id rejects undefined', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ limit: 10 }),
    PersonalizedRecommendationValidationError,
  );
});

test('19: uppercase user id is accepted and canonicalized', async () => {
  const { service, calls } = createHarness();
  await service.getPersonalizedRecommendations({ userId: USER_A.toUpperCase(), limit: 10 });
  assert.equal(calls.snapshot[0], USER_A);
});

test('20: invalid limit rejects 0', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: 0 }),
    PersonalizedRecommendationValidationError,
  );
});

test('21: invalid limit rejects 101', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: 101 }),
    PersonalizedRecommendationValidationError,
  );
});

test('22: invalid limit rejects negative', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: -1 }),
    PersonalizedRecommendationValidationError,
  );
});

test('23: invalid limit rejects float', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: 1.5 }),
    PersonalizedRecommendationValidationError,
  );
});

test('24: invalid limit rejects NaN', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: Number.NaN }),
    PersonalizedRecommendationValidationError,
  );
});

test('25: invalid limit rejects non-number', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: '10' }),
    PersonalizedRecommendationValidationError,
  );
});

test('26: invalid limit rejects missing limit', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A }),
    PersonalizedRecommendationValidationError,
  );
});

test('27: limit 100 is accepted', async () => {
  const { service } = createHarness({ snapshot: null });
  const result = await service.getPersonalizedRecommendations({ userId: USER_A, limit: 100 });
  assert.equal(result.status, 'no-snapshot');
});

test('28: validation fails before any snapshot read', async () => {
  const { service, calls } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: 'bad', limit: 10 }),
    PersonalizedRecommendationValidationError,
  );
  assert.equal(calls.snapshot.length, 0);
  assert.equal(calls.songFind.length, 0);
});

test('29: invalid limit fails before any snapshot read', async () => {
  const { service, calls } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: 0 }),
    PersonalizedRecommendationValidationError,
  );
  assert.equal(calls.snapshot.length, 0);
});

test('30: missing snapshot returns no-snapshot', async () => {
  const result = await run({ snapshot: null });
  assert.equal(result.status, 'no-snapshot');
  assert.equal(result.source, 'personalized-snapshot');
  assert.deepEqual(result.items, []);
  assert.equal(result.snapshot, null);
});

test('31: no-snapshot performs zero Song reads', async () => {
  const { service, calls } = createHarness({ snapshot: null });
  await service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  assert.equal(calls.songFind.length, 0);
});

test('32: no-snapshot still calls snapshot service once', async () => {
  const { service, calls } = createHarness({ snapshot: null });
  await service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  assert.equal(calls.snapshot.length, 1);
  assert.equal(calls.snapshot[0], USER_A);
});

test('33: empty snapshot is ready with zero counts', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [] }),
    songs: [],
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.source, 'personalized-snapshot');
  assert.deepEqual(result.items, []);
  assert.equal(result.snapshot.item_count, 0);
  assert.equal(result.snapshot.available_count, 0);
  assert.equal(result.snapshot.unavailable_count, 0);
});

test('34: empty snapshot performs zero Song reads', async () => {
  const { service, calls } = createHarness({ snapshot: snapshotDoc({ items: [] }) });
  await service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  assert.equal(calls.songFind.length, 0);
});

test('35: empty snapshot returns exact metadata keys', async () => {
  const result = await run({ snapshot: snapshotDoc({ items: [] }), songs: [] });
  assert.deepEqual(
    Object.keys(result.snapshot).sort(),
    ['available_count', 'generated_at', 'item_count', 'snapshot_version', 'unavailable_count'],
  );
});

test('36: exactly one snapshot read per request', async () => {
  const { service, calls } = createHarness({
    snapshot: snapshotDoc(),
    songs: [songDoc({ _id: SONG_1 }), songDoc({ _id: SONG_2 }), songDoc({ _id: SONG_3 })],
  });
  await service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  assert.equal(calls.snapshot.length, 1);
});

test('37: single bulk Song $in lookup', async () => {
  const harness = createHarness({
    snapshot: snapshotDoc(),
    songs: [songDoc({ _id: SONG_1 }), songDoc({ _id: SONG_2 }), songDoc({ _id: SONG_3 })],
  });
  await harness.service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  assert.equal(harness.calls.songFind.length, 1);
  assert.deepEqual(harness.calls.songFind[0]._id.$in, [SONG_1, SONG_2, SONG_3]);
});

test('38: Song lookup bounded to snapshot unique IDs max 100', async () => {
  const manyItems = [];
  const manySongs = [];
  for (let i = 1; i <= MAX_SNAPSHOT_ITEMS; i += 1) {
    const songId = id(i);
    manyItems.push(snapshotItem(i, songId));
    manySongs.push(songDoc({ _id: songId }));
  }
  const harness = createHarness({
    snapshot: snapshotDoc({ items: manyItems }),
    songs: manySongs,
  });
  await harness.service.getPersonalizedRecommendations({ userId: USER_A, limit: 100 });
  assert.equal(harness.calls.songFind.length, 1);
  assert.equal(harness.calls.songFind[0]._id.$in.length, MAX_SNAPSHOT_ITEMS);
});

test('39: no per-item Song lookup (no N+1)', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  const findCount = (source.match(/SongModel\.find\s*\(/g) || []).length;
  assert.equal(findCount, 1);
});

test('40: snapshot order preserved before limit', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [
        snapshotItem(1, SONG_3),
        snapshotItem(2, SONG_1),
        snapshotItem(3, SONG_2),
      ],
    }),
    songs: [
      songDoc({ _id: SONG_1 }),
      songDoc({ _id: SONG_2 }),
      songDoc({ _id: SONG_3 }),
    ],
  });
  assert.equal(result.items[0].song._id, SONG_3);
  assert.equal(result.items[1].song._id, SONG_1);
  assert.equal(result.items[2].song._id, SONG_2);
});

test('41: no re-rank by score — snapshot order wins', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [
        snapshotItem(1, SONG_1, { policy_score: 0.1, hybrid_score: 0.1 }),
        snapshotItem(2, SONG_2, { policy_score: 0.9, hybrid_score: 0.9 }),
      ],
    }),
    songs: [songDoc({ _id: SONG_1 }), songDoc({ _id: SONG_2 })],
  });
  assert.equal(result.items[0].song._id, SONG_1);
  assert.equal(result.items[1].song._id, SONG_2);
});

test('42: availability filter before limit', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [
        snapshotItem(1, SONG_1),
        snapshotItem(2, SONG_2),
        snapshotItem(3, SONG_3),
        snapshotItem(4, SONG_4),
      ],
    }),
    songs: [
      songDoc({ _id: SONG_1, recommendation_eligible: false }),
      songDoc({ _id: SONG_2 }),
      songDoc({ _id: SONG_3 }),
      songDoc({ _id: SONG_4 }),
    ],
    options: { limit: 2 },
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].song._id, SONG_2);
  assert.equal(result.items[1].song._id, SONG_3);
  assert.equal(result.snapshot.available_count, 3);
  assert.equal(result.snapshot.unavailable_count, 1);
  assert.equal(result.snapshot.item_count, 4);
});

test('43: ranks are contiguous 1..N after filtering', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [
        snapshotItem(1, SONG_1),
        snapshotItem(2, SONG_2),
        snapshotItem(3, SONG_3),
      ],
    }),
    songs: [
      songDoc({ _id: SONG_1 }),
      songDoc({ _id: SONG_2, recommendation_eligible: false }),
      songDoc({ _id: SONG_3 }),
    ],
  });
  assert.deepEqual(result.items.map((item) => item.rank), [1, 2]);
});

test('44: limit slices available list after filter', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [
        snapshotItem(1, SONG_1),
        snapshotItem(2, SONG_2),
        snapshotItem(3, SONG_3),
      ],
    }),
    songs: [songDoc({ _id: SONG_1 }), songDoc({ _id: SONG_2 }), songDoc({ _id: SONG_3 })],
    options: { limit: 2 },
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.snapshot.available_count, 3);
  assert.equal(result.snapshot.item_count, 3);
});

test('45: recommendation_eligible false is unavailable', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, recommendation_eligible: false })],
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.snapshot.unavailable_count, 1);
  assert.equal(result.snapshot.available_count, 0);
});

test('46: missing recommendation_eligible is eligible (legacy)', async () => {
  const doc = songDoc({ _id: SONG_1 });
  delete doc.recommendation_eligible;
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [doc],
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.snapshot.available_count, 1);
});

test('47: recommendation_eligible true is available', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, recommendation_eligible: true })],
  });
  assert.equal(result.items.length, 1);
});

test('48: playable via youtube_id only', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, youtube_id: 'abc', file_path: '' })],
  });
  assert.equal(result.items.length, 1);
});

test('49: playable via file_path only', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, youtube_id: '', file_path: 'assets/songs/x.mp3' })],
  });
  assert.equal(result.items.length, 1);
});

test('50: unplayable without youtube_id and file_path is unavailable', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, youtube_id: '', file_path: '' })],
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.snapshot.unavailable_count, 1);
});

test('51: whitespace-only playability fields are unplayable', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, youtube_id: '   ', file_path: '\t' })],
  });
  assert.equal(result.items.length, 0);
});

test('52: missing title is unavailable', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, title: '' })],
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.snapshot.unavailable_count, 1);
});

test('53: whitespace title is unavailable', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, title: '   ' })],
  });
  assert.equal(result.items.length, 0);
});

test('54: missing Song document is unavailable', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [snapshotItem(1, SONG_1), snapshotItem(2, SONG_2)],
    }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.snapshot.unavailable_count, 1);
  assert.equal(result.snapshot.available_count, 1);
  assert.equal(result.snapshot.item_count, 2);
});

test('55: deleted Song never fabricates a placeholder', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [],
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.snapshot.unavailable_count, 1);
});

test('56: response item has only rank and song', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['rank', 'song']);
});

test('57: response top-level keys are exact', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  assert.deepEqual(
    Object.keys(result).sort(),
    ['items', 'snapshot', 'source', 'status'],
  );
});

test('58: no basis/score fields leak into response items', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  const item = result.items[0];
  for (const key of ['basis', 'policy_score', 'hybrid_score', 'profile_score', 'collaborative_known']) {
    assert.equal(key in item, false);
  }
  assert.equal('basis' in item.song, false);
});

test('59: no artifact_version / payload_sha256 / _id of snapshot exposed', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [snapshotItem(1, SONG_1)],
      artifact_version: 'art1',
      payload_sha256: 'b'.repeat(64),
    }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  assert.equal('artifact_version' in result.snapshot, false);
  assert.equal('payload_sha256' in result.snapshot, false);
  assert.equal('_id' in result.snapshot, false);
  assert.equal('user' in result.snapshot, false);
  assert.equal('summary' in result.snapshot, false);
  assert.equal('items' in result.snapshot, false);
});

test('60: recommendation_eligible never exposed in song output', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, recommendation_eligible: true })],
  });
  assert.equal('recommendation_eligible' in result.items[0].song, false);
});

test('61: public song fields include player essentials', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  const song = result.items[0].song;
  for (const field of ['_id', 'title', 'artist', 'genre', 'youtube_id', 'file_path', 'poster_url', 'duration']) {
    assert.equal(field in song, true, field);
  }
});

test('62: public song fields include optional metadata when present', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  const song = result.items[0].song;
  for (const field of ['duration_seconds', 'release_date', 'language', 'category']) {
    assert.equal(field in song, true, field);
  }
});

test('63: unknown Song fields are not copied', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1, lyrics: 'secret', password: 'x', email: 'a@b.c' })],
  });
  assert.equal('lyrics' in result.items[0].song, false);
  assert.equal('password' in result.items[0].song, false);
  assert.equal('email' in result.items[0].song, false);
});

test('64: snapshot metadata snapshot_version preserved', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [], snapshot_version: 'v2' }),
    songs: [],
  });
  assert.equal(result.snapshot.snapshot_version, 'v2');
});

test('65: snapshot metadata generated_at preserved', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [] }),
    songs: [],
  });
  assert.equal(result.snapshot.generated_at, GENERATED_AT);
});

test('66: unavailable + available = item_count', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [
        snapshotItem(1, SONG_1),
        snapshotItem(2, SONG_2),
        snapshotItem(3, SONG_3),
      ],
    }),
    songs: [
      songDoc({ _id: SONG_1 }),
      songDoc({ _id: SONG_2, recommendation_eligible: false }),
      songDoc({ _id: SONG_3 }),
    ],
  });
  assert.equal(
    result.snapshot.available_count + result.snapshot.unavailable_count,
    result.snapshot.item_count,
  );
});

test('67: all-unavailable snapshot is ready with empty items', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [snapshotItem(1, SONG_1), snapshotItem(2, SONG_2)],
    }),
    songs: [
      songDoc({ _id: SONG_1, youtube_id: '', file_path: '' }),
      songDoc({ _id: SONG_2, recommendation_eligible: false }),
    ],
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.items, []);
  assert.equal(result.snapshot.available_count, 0);
  assert.equal(result.snapshot.unavailable_count, 2);
});

test('68: no fallback to older snapshot — only latest is read', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  assert.equal(source.includes('getRecommendationSnapshotByVersion'), false);
  assert.equal((source.match(/getLatestRecommendationSnapshotForUser\s*\(/g) || []).length, 1);
});

test('69: source never switches away from personalized-snapshot', async () => {
  const ready = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  const empty = await run({ snapshot: snapshotDoc({ items: [] }), songs: [] });
  assert.equal(ready.source, 'personalized-snapshot');
  assert.equal(empty.source, 'personalized-snapshot');
});

test('70: no Trending/catalog-fallback/popularity/random words in service', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  for (const forbidden of ['trending', 'catalog-fallback', 'popularity', 'random', 'shuffle']) {
    assert.equal(source.toLowerCase().includes(forbidden), false, forbidden);
  }
});

test('71: no ListeningEvent / Favorite / Playlist / User model imports', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  for (const forbidden of ['ListeningEvent', 'Favorite', 'Playlist', "from '../models/User.js'"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('72: no Python / SVD / ml imports', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  for (const forbidden of ['child_process', 'python', 'svd', "from 'ml", 'train', 'rank_hybrid']) {
    assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, forbidden);
  }
});

test('73: service is read-only — no write methods invoked', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  for (const forbidden of ['create(', 'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'insertOne', 'replaceOne', 'save(']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('74: no recommendation score formulas recomputed', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  for (const forbidden of ['0.80', '0.70', '0.30', '0.20*', 'collaborative_weight', 'policy_weight']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('75: snapshot service error maps to ReadError with fixed message', async () => {
  const { service } = createHarness({ snapshotError: new Error('db down secret') });
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 }),
    (error) => {
      assert.ok(error instanceof PersonalizedRecommendationReadError);
      assert.equal(error.message, 'failed to load personalized recommendations');
      assert.equal(error.message.includes('secret'), false);
      return true;
    },
  );
});

test('76: Song find rejection maps to ReadError with fixed message', async () => {
  const { service } = createHarness({
    snapshot: snapshotDoc(),
    songError: new Error('mongo boom'),
  });
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 }),
    (error) => {
      assert.ok(error instanceof PersonalizedRecommendationReadError);
      assert.equal(error.message, 'failed to load personalized recommendations');
      return true;
    },
  );
});

test('77: non-array Song result maps to ReadError', async () => {
  const recommendationSnapshotService = {
    async getLatestRecommendationSnapshotForUser() {
      return snapshotDoc();
    },
  };
  const SongModel = {
    find() {
      return {
        select() { return this; },
        lean() { return Promise.resolve(null); },
      };
    },
  };
  const service = createPersonalizedRecommendationService({
    recommendationSnapshotService,
    SongModel,
  });
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 }),
    PersonalizedRecommendationReadError,
  );
});

test('78: ValidationError messages are fixed and bounded', async () => {
  const { service } = createHarness();
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: 'nope', limit: 10 }),
    (error) => {
      assert.equal(error.message, 'invalid recommendation user id');
      return true;
    },
  );
  await assert.rejects(
    () => service.getPersonalizedRecommendations({ userId: USER_A, limit: 0 }),
    (error) => {
      assert.equal(error.message, 'invalid recommendation limit');
      return true;
    },
  );
});

test('79: duplicate snapshot song IDs are bulk-loaded once', async () => {
  const harness = createHarness({
    snapshot: snapshotDoc({
      items: [snapshotItem(1, SONG_1), snapshotItem(2, SONG_1)],
    }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  await harness.service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  assert.deepEqual(harness.calls.songFind[0]._id.$in, [SONG_1]);
});

test('80: both users can receive independent latest snapshots', async () => {
  const seen = [];
  const recommendationSnapshotService = {
    async getLatestRecommendationSnapshotForUser(userId) {
      seen.push(userId);
      if (userId === USER_A) return snapshotDoc({ items: [snapshotItem(1, SONG_1)] });
      return snapshotDoc({ items: [snapshotItem(1, SONG_2)], user: USER_B });
    },
  };
  const SongModel = {
    find() {
      return {
        select() { return this; },
        lean() {
          return Promise.resolve([
            songDoc({ _id: SONG_1 }),
            songDoc({ _id: SONG_2 }),
          ]);
        },
      };
    },
  };
  const service = createPersonalizedRecommendationService({
    recommendationSnapshotService,
    SongModel,
  });
  const a = await service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  const b = await service.getPersonalizedRecommendations({ userId: USER_B, limit: 10 });
  assert.deepEqual(seen, [USER_A, USER_B]);
  assert.equal(a.items[0].song._id, SONG_1);
  assert.equal(b.items[0].song._id, SONG_2);
});

test('81: status ready only when a snapshot exists', async () => {
  const withSnap = await run({
    snapshot: snapshotDoc({ items: [] }),
    songs: [],
  });
  const without = await run({ snapshot: null });
  assert.equal(withSnap.status, 'ready');
  assert.equal(without.status, 'no-snapshot');
});

test('82: ready response for empty snapshot never becomes no-snapshot', async () => {
  const result = await run({ snapshot: snapshotDoc({ items: [] }), songs: [] });
  assert.notEqual(result.status, 'no-snapshot');
  assert.ok(result.snapshot);
});

test('83: does not read req.query or body (service API is explicit)', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  assert.equal(source.includes('req.'), false);
  assert.equal(source.includes('req.query'), false);
  assert.equal(source.includes('req.body'), false);
});

test('84: does not import express or auth middleware', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  assert.equal(source.includes('express'), false);
  assert.equal(source.includes('middleware/auth'), false);
  assert.equal(source.includes('jsonwebtoken'), false);
});

test('85: does not log or echo internal errors', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  assert.equal(source.includes('console.'), false);
  assert.equal(source.includes('error.message'), false);
});

test('86: Song select projection includes eligibility for filtering', async () => {
  let selectSpec = null;
  const recommendationSnapshotService = {
    async getLatestRecommendationSnapshotForUser() { return snapshotDoc(); },
  };
  const SongModel = {
    find() {
      return {
        select(spec) { selectSpec = spec; return this; },
        lean() { return Promise.resolve([songDoc()]); },
      };
    },
  };
  const svc = createPersonalizedRecommendationService({
    recommendationSnapshotService,
    SongModel,
  });
  await svc.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  assert.match(selectSpec, /recommendation_eligible/);
  assert.match(selectSpec, /youtube_id/);
  assert.match(selectSpec, /file_path/);
  assert.match(selectSpec, /title/);
});

test('87: Song query uses .lean()', async () => {
  let leaned = false;
  const recommendationSnapshotService = {
    async getLatestRecommendationSnapshotForUser() { return snapshotDoc(); },
  };
  const SongModel = {
    find() {
      return {
        select() { return this; },
        lean() { leaned = true; return Promise.resolve([]); },
      };
    },
  };
  const svc = createPersonalizedRecommendationService({
    recommendationSnapshotService,
    SongModel,
  });
  await svc.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  assert.equal(leaned, true);
});

test('88: snapshot read result treated as lean object', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  assert.equal(result.snapshot.snapshot_version, 'v1');
});

test('89: limit 1 returns at most one item', async () => {
  const result = await run({
    snapshot: snapshotDoc(),
    songs: [songDoc({ _id: SONG_1 }), songDoc({ _id: SONG_2 }), songDoc({ _id: SONG_3 })],
    options: { limit: 1 },
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].rank, 1);
});

test('90: limit larger than available returns all available', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1), snapshotItem(2, SONG_2)] }),
    songs: [songDoc({ _id: SONG_1 }), songDoc({ _id: SONG_2 })],
    options: { limit: 50 },
  });
  assert.equal(result.items.length, 2);
  assert.equal(result.snapshot.available_count, 2);
});

test('91: items never exceed limit', async () => {
  const items = [];
  const songs = [];
  for (let i = 1; i <= 20; i += 1) {
    const songId = id(i);
    items.push(snapshotItem(i, songId));
    songs.push(songDoc({ _id: songId }));
  }
  const result = await run({
    snapshot: snapshotDoc({ items }),
    songs,
    options: { limit: 5 },
  });
  assert.equal(result.items.length, 5);
  assert.equal(result.snapshot.available_count, 20);
  assert.equal(result.snapshot.item_count, 20);
});

test('92: snapshot read receives the validated user key', async () => {
  const harness = createHarness({ snapshot: null });
  await harness.service.getPersonalizedRecommendations({ userId: USER_A, limit: 10 });
  assert.equal(harness.calls.snapshot.length, 1);
  assert.equal(harness.calls.snapshot[0], USER_A);
});

test('93: does not call recordRecommendationSnapshot', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  assert.equal(source.includes('recordRecommendationSnapshot'), false);
});

test('94: does not write PlayHistory or ListeningEvent', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  assert.equal(source.includes('PlayHistory'), false);
  assert.equal(source.includes('ListeningEvent'), false);
});

test('95: status/source/items/snapshot shape stable for ready', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [songDoc({ _id: SONG_1 })],
  });
  assert.equal(typeof result.status, 'string');
  assert.equal(typeof result.source, 'string');
  assert.ok(Array.isArray(result.items));
  assert.equal(typeof result.snapshot, 'object');
  assert.notEqual(result.snapshot, null);
});

test('96: unavailable missing song does not invent title/artist', async () => {
  const result = await run({
    snapshot: snapshotDoc({ items: [snapshotItem(1, SONG_1)] }),
    songs: [],
  });
  assert.equal(result.items.length, 0);
  assert.equal(result.snapshot.unavailable_count, 1);
});

test('97: projectSong copies only whitelisted fields', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  assert.match(source, /SONG_OUTPUT_FIELDS/);
  assert.equal(source.includes('recommendation_eligible:'), false);
});

test('98: no email/token/IP fields in service constants', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  for (const forbidden of ['email', 'token', 'ip_address', 'password']) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test('99: empty items array snapshot still returns snapshot metadata', async () => {
  const result = await run({ snapshot: snapshotDoc({ items: [] }), songs: [] });
  assert.ok(result.snapshot);
  assert.equal(result.snapshot.item_count, 0);
});

test('100: no-snapshot snapshot field is null not empty object', async () => {
  const result = await run({ snapshot: null });
  assert.equal(result.snapshot, null);
});

test('101: service default export is factory', async () => {
  const mod = await import('./personalizedRecommendationService.js');
  assert.equal(typeof mod.default, 'function');
  assert.equal(mod.default, createPersonalizedRecommendationService);
});

test('102: factory returns getPersonalizedRecommendations only public method surface', async () => {
  const { service } = createHarness();
  assert.deepEqual(Object.keys(service).sort(), ['getPersonalizedRecommendations']);
});

test('103: mixed availability across full snapshot conserves counts', async () => {
  const items = [];
  const songs = [];
  for (let i = 1; i <= 10; i += 1) {
    const songId = id(i);
    items.push(snapshotItem(i, songId));
    if (i % 2 === 0) {
      songs.push(songDoc({ _id: songId, recommendation_eligible: false }));
    } else {
      songs.push(songDoc({ _id: songId }));
    }
  }
  const result = await run({
    snapshot: snapshotDoc({ items }),
    songs,
    options: { limit: 100 },
  });
  assert.equal(result.snapshot.item_count, 10);
  assert.equal(result.snapshot.available_count, 5);
  assert.equal(result.snapshot.unavailable_count, 5);
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.items.map((i) => i.rank), [1, 2, 3, 4, 5]);
});

test('104: no wall-clock / Date.now used for ranking decisions', async () => {
  const source = readFileSync(
    fileURLToPath(new URL('./personalizedRecommendationService.js', import.meta.url)),
    'utf8',
  );
  assert.equal(source.includes('Date.now'), false);
  assert.equal(source.includes('new Date'), false);
});

test('105: does not expose snapshot summary conservation fields', async () => {
  const result = await run({
    snapshot: snapshotDoc({
      items: [],
      summary: {
        input_candidate_count: 10,
        returned_count: 0,
        profile_available: true,
      },
    }),
    songs: [],
  });
  for (const key of ['summary', 'input_candidate_count', 'returned_count', 'profile_available']) {
    assert.equal(key in result.snapshot, false);
    assert.equal(key in result, false);
  }
});
