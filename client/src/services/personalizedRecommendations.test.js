import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PERSONALIZED_RECOMMENDATION_PATH,
  DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT,
  MAX_PERSONALIZED_RECOMMENDATION_LIMIT,
  PERSONALIZED_RECOMMENDATION_SOURCE,
  PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
  PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
  PERSONALIZED_RECOMMENDATION_STATES,
  PERSONALIZED_RECOMMENDATION_ERROR_CODES,
  PERSONALIZED_RECOMMENDATION_EMPTY_REASONS,
  isValidRecommendationLimit,
  buildPersonalizedRecommendationPath,
  classifyPersonalizedRecommendationPayload,
  fetchPersonalizedRecommendations,
  shouldUseLegacyRecommendationFallback,
  getPersonalizedRecommendationEmptyReason,
} from './personalizedRecommendations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceSrc = readFileSync(join(__dirname, 'personalizedRecommendations.js'), 'utf8');
const hookSrc = readFileSync(
  join(__dirname, '..', 'hooks', 'usePersonalizedRecommendations.js'),
  'utf8',
);

const song = (overrides = {}) => ({
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  title: 'Song',
  artist: 'Artist',
  genre: 'Bengali',
  youtube_id: 'yt1',
  file_path: '',
  poster_url: 'https://img.example/a.jpg',
  duration: '3:00',
  ...overrides,
});

const snapshotMeta = (overrides = {}) => ({
  snapshot_version: 'v1.0.0',
  generated_at: '2026-09-15T12:00:00.000Z',
  item_count: 2,
  available_count: 2,
  unavailable_count: 0,
  ...overrides,
});

const readyPayload = (items, snapshot = snapshotMeta()) => ({
  success: true,
  data: {
    status: 'ready',
    source: PERSONALIZED_RECOMMENDATION_SOURCE,
    items,
    snapshot,
  },
});

const ranked = (id, rank) => ({ rank, song: song({ _id: id }) });

const createApiClient = (payloads) => {
  const paths = [];
  let index = 0;
  return {
    paths,
    async get(path) {
      paths.push(path);
      const entry = payloads[Math.min(index, payloads.length - 1)];
      index += 1;
      if (entry instanceof Error) throw entry;
      return entry;
    },
  };
};

test('1: path constant is exactly /api/recommendations', () => {
  assert.equal(PERSONALIZED_RECOMMENDATION_PATH, '/api/recommendations');
});

test('2: default limit is 10 and max limit is 100', () => {
  assert.equal(DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT, 10);
  assert.equal(MAX_PERSONALIZED_RECOMMENDATION_LIMIT, 100);
});

test('3: source constant is personalized-snapshot', () => {
  assert.equal(PERSONALIZED_RECOMMENDATION_SOURCE, 'personalized-snapshot');
});

test('4: disabled message matches checkpoint 35 exactly', () => {
  assert.equal(
    PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
    'Personalized recommendations are currently unavailable.',
  );
});

test('5: failed message matches checkpoint 35 exactly', () => {
  assert.equal(
    PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
    'failed to load personalized recommendations',
  );
});

test('6: state vocabulary is exactly the seven allowed values', () => {
  assert.deepEqual(Object.values(PERSONALIZED_RECOMMENDATION_STATES).sort(), [
    'disabled',
    'empty',
    'error',
    'idle',
    'loading',
    'no-snapshot',
    'ready',
  ]);
});

test('7: error codes are request-failed and payload-invalid', () => {
  assert.deepEqual(Object.values(PERSONALIZED_RECOMMENDATION_ERROR_CODES).sort(), [
    'RECOMMENDATION_PAYLOAD_INVALID',
    'RECOMMENDATION_REQUEST_FAILED',
  ]);
});

test('8: empty reason vocabulary is the five identifier values', () => {
  assert.deepEqual(Object.values(PERSONALIZED_RECOMMENDATION_EMPTY_REASONS).sort(), [
    'empty-snapshot',
    'feature-disabled',
    'no-snapshot',
    'none',
    'request-error',
  ]);
});

test('9: isValidRecommendationLimit accepts integers 1..100', () => {
  for (const limit of [1, 10, 50, 100]) {
    assert.equal(isValidRecommendationLimit(limit), true);
  }
});

test('10: isValidRecommendationLimit rejects bool, string, float, 0, 101, negative, NaN', () => {
  for (const limit of [true, false, '10', 10.5, 0, 101, -1, NaN, null, undefined, {}, []]) {
    assert.equal(isValidRecommendationLimit(limit), false, `expected reject for ${String(limit)}`);
  }
});

test('11: build path sends only limit query key', () => {
  assert.equal(
    buildPersonalizedRecommendationPath(10),
    '/api/recommendations?limit=10',
  );
  assert.equal(
    buildPersonalizedRecommendationPath(1),
    '/api/recommendations?limit=1',
  );
  assert.equal(
    buildPersonalizedRecommendationPath(100),
    '/api/recommendations?limit=100',
  );
});

test('12: build path never includes identity or snapshot parameters', () => {
  const path = buildPersonalizedRecommendationPath(20);
  assert.equal(path.includes('user'), false);
  assert.equal(path.includes('userId'), false);
  assert.equal(path.includes('user_id'), false);
  assert.equal(path.includes('email'), false);
  assert.equal(path.includes('snapshot'), false);
  assert.equal(path.includes('artifact'), false);
  assert.equal(path.split('?')[0], '/api/recommendations');
});

test('13: build path rejects invalid limits without clamping', () => {
  assert.throws(() => buildPersonalizedRecommendationPath(0));
  assert.throws(() => buildPersonalizedRecommendationPath(101));
  assert.throws(() => buildPersonalizedRecommendationPath(10.5));
  assert.throws(() => buildPersonalizedRecommendationPath('10'));
});

test('14: classify ready with songs returns ready state and preserves order', () => {
  const s1 = song({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' });
  const s2 = song({ _id: 'cccccccccccccccccccccccc' });
  const result = classifyPersonalizedRecommendationPayload(
    readyPayload([
      { rank: 1, song: s1 },
      { rank: 2, song: s2 },
    ]),
  );
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.READY);
  assert.deepEqual(result.songs, [s1, s2]);
  assert.equal(result.songs[0]._id, 'bbbbbbbbbbbbbbbbbbbbbbbb');
  assert.equal(result.songs[1]._id, 'cccccccccccccccccccccccc');
  assert.equal(result.error, null);
});

test('15: classify no-snapshot returns no-snapshot with empty songs and null snapshot', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: true,
    data: {
      status: 'no-snapshot',
      source: PERSONALIZED_RECOMMENDATION_SOURCE,
      items: [],
      snapshot: null,
    },
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.NO_SNAPSHOT);
  assert.deepEqual(result.songs, []);
  assert.equal(result.snapshot, null);
  assert.equal(result.error, null);
});

test('16: classify ready with zero items is empty, not no-snapshot', () => {
  const emptySnap = snapshotMeta({
    item_count: 0,
    available_count: 0,
    unavailable_count: 0,
  });
  const result = classifyPersonalizedRecommendationPayload(readyPayload([], emptySnap));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.EMPTY);
  assert.deepEqual(result.songs, []);
  assert.equal(result.snapshot.item_count, 0);
  assert.equal(result.error, null);
});

test('17: classify exact disabled message is disabled', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: false,
    error: PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.DISABLED);
  assert.deepEqual(result.songs, []);
  assert.equal(result.snapshot, null);
  assert.equal(result.error, null);
});

test('18: classify different 503-style message stays error, not disabled', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: false,
    error: 'Service Unavailable',
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.REQUEST_FAILED);
  assert.equal(result.error.message, PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE);
});

test('19: classify server 500 failed message stays error', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: false,
    error: PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.message, PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE);
});

test('20: classify session-expired body stays error with sanitized safe message', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: false,
    error: 'Session expired',
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.message, 'Session expired');
});

test('21: classify unknown network error text is replaced with fixed failed message', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: false,
    error: 'TypeError: Failed to fetch at line 1',
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.message, PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE);
  assert.equal(result.error.message.includes('TypeError'), false);
  assert.equal(result.error.message.includes('line 1'), false);
});

test('22: classify invalid query message stays error', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: false,
    error: 'Invalid recommendation query',
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.message, 'Invalid recommendation query');
});

test('23: classify non-object raw payload is payload error', () => {
  for (const raw of [null, undefined, 'ok', 42, [], true]) {
    const result = classifyPersonalizedRecommendationPayload(raw);
    assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
    assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
  }
});

test('24: classify success without data object is payload error', () => {
  for (const raw of [
    { success: true },
    { success: true, data: null },
    { success: true, data: [] },
    { success: true, data: 'ready' },
  ]) {
    const result = classifyPersonalizedRecommendationPayload(raw);
    assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
    assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
  }
});

test('25: classify success missing success flag is payload error', () => {
  const result = classifyPersonalizedRecommendationPayload({
    data: {
      status: 'ready',
      source: PERSONALIZED_RECOMMENDATION_SOURCE,
      items: [],
      snapshot: snapshotMeta({ item_count: 0, available_count: 0, unavailable_count: 0 }),
    },
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
});

test('26: classify wrong source is payload error', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: true,
    data: {
      status: 'ready',
      source: 'popularity',
      items: [],
      snapshot: snapshotMeta({ item_count: 0, available_count: 0, unavailable_count: 0 }),
    },
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
});

test('27: classify unknown status is payload error', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: true,
    data: {
      status: 'stale',
      source: PERSONALIZED_RECOMMENDATION_SOURCE,
      items: [],
      snapshot: null,
    },
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
});

test('28: classify ready with non-array items is payload error', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: true,
    data: {
      status: 'ready',
      source: PERSONALIZED_RECOMMENDATION_SOURCE,
      items: { rank: 1 },
      snapshot: snapshotMeta(),
    },
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
});

test('29: classify no-snapshot with non-empty items is payload error', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: true,
    data: {
      status: 'no-snapshot',
      source: PERSONALIZED_RECOMMENDATION_SOURCE,
      items: [ranked('aaaaaaaaaaaaaaaaaaaaaaaa', 1)],
      snapshot: null,
    },
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
});

test('30: classify no-snapshot with non-null snapshot is payload error', () => {
  const result = classifyPersonalizedRecommendationPayload({
    success: true,
    data: {
      status: 'no-snapshot',
      source: PERSONALIZED_RECOMMENDATION_SOURCE,
      items: [],
      snapshot: snapshotMeta(),
    },
  });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
});

test('31: classify rejects non-contiguous ranks without repairing', () => {
  const result = classifyPersonalizedRecommendationPayload(readyPayload([
    { rank: 2, song: song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }) },
    { rank: 1, song: song({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }) },
  ]));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
});

test('32: classify rejects gap in ranks', () => {
  const result = classifyPersonalizedRecommendationPayload(readyPayload([
    { rank: 1, song: song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }) },
    { rank: 3, song: song({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }) },
  ]));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('33: classify rejects duplicate ranks', () => {
  const result = classifyPersonalizedRecommendationPayload(readyPayload([
    { rank: 1, song: song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }) },
    { rank: 1, song: song({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }) },
  ]));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('34: classify rejects non-integer rank', () => {
  const result = classifyPersonalizedRecommendationPayload(readyPayload([
    { rank: 1.5, song: song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }) },
  ]));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('35: classify rejects zero and negative ranks', () => {
  for (const rank of [0, -1]) {
    const result = classifyPersonalizedRecommendationPayload(readyPayload([
      { rank, song: song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }) },
    ]));
    assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  }
});

test('36: classify rejects duplicate song ids', () => {
  const result = classifyPersonalizedRecommendationPayload(readyPayload([
    { rank: 1, song: song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }) },
    { rank: 2, song: song({ _id: 'AAAAAAAAAAAAAAAAAAAAAAAA' }) },
  ]));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('37: classify rejects missing or null song object', () => {
  for (const item of [{ rank: 1 }, { rank: 1, song: null }, { rank: 1, song: 'x' }]) {
    const result = classifyPersonalizedRecommendationPayload(readyPayload([item]));
    assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  }
});

test('38: classify rejects song without non-empty _id', () => {
  for (const bad of [{}, { _id: '' }, { _id: '   ' }, { _id: 42 }, { _id: null }]) {
    const result = classifyPersonalizedRecommendationPayload(readyPayload([
      { rank: 1, song: bad },
    ]));
    assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  }
});

test('39: classify rejects malformed item that is not an object', () => {
  const result = classifyPersonalizedRecommendationPayload(readyPayload(['nope']));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('40: classify rejects items longer than requested limit without truncating silently', () => {
  const items = [
    { rank: 1, song: song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }) },
    { rank: 2, song: song({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }) },
  ];
  const result = classifyPersonalizedRecommendationPayload(readyPayload(items), { limit: 1 });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID);
});

test('41: classify rejects ready with invalid limit option', () => {
  const result = classifyPersonalizedRecommendationPayload(
    readyPayload([]),
    { limit: 0 },
  );
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.REQUEST_FAILED);
});

test('42: classify preserves snapshot public fields only', () => {
  const rawSnap = {
    ...snapshotMeta(),
    artifact_version: 'art-1',
    payload_sha256: 'abc',
    _id: 'ffffffffffffffffffffffff',
    basis: 'hybrid',
    summary: {},
    user_email: 'a@b.c',
  };
  const result = classifyPersonalizedRecommendationPayload(
    readyPayload([ranked('aaaaaaaaaaaaaaaaaaaaaaaa', 1)], rawSnap),
  );
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.READY);
  assert.deepEqual(Object.keys(result.snapshot).sort(), [
    'available_count',
    'generated_at',
    'item_count',
    'snapshot_version',
    'unavailable_count',
  ]);
  assert.equal(result.snapshot.artifact_version, undefined);
  assert.equal(result.snapshot.payload_sha256, undefined);
  assert.equal(result.snapshot._id, undefined);
  assert.equal(result.snapshot.basis, undefined);
  assert.equal(result.snapshot.user_email, undefined);
});

test('43: classify rejects snapshot count conservation failure', () => {
  const result = classifyPersonalizedRecommendationPayload(
    readyPayload([], snapshotMeta({
      item_count: 5,
      available_count: 4,
      unavailable_count: 0,
    })),
  );
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('44: classify rejects negative snapshot counts', () => {
  const result = classifyPersonalizedRecommendationPayload(
    readyPayload([], snapshotMeta({
      item_count: 0,
      available_count: -1,
      unavailable_count: 1,
    })),
  );
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('45: classify rejects non-integer snapshot counts', () => {
  const result = classifyPersonalizedRecommendationPayload(
    readyPayload([], snapshotMeta({
      item_count: 1.5,
      available_count: 1,
      unavailable_count: 0,
    })),
  );
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('46: classify rejects missing snapshot_version', () => {
  const snap = snapshotMeta();
  delete snap.snapshot_version;
  const result = classifyPersonalizedRecommendationPayload(readyPayload([], snap));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('47: classify rejects null snapshot on ready', () => {
  const result = classifyPersonalizedRecommendationPayload(readyPayload([], null));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('48: classify rejects items.length greater than available_count', () => {
  const items = [
    { rank: 1, song: song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }) },
    { rank: 2, song: song({ _id: 'bbbbbbbbbbbbbbbbbbbbbbbb' }) },
  ];
  const snap = snapshotMeta({
    item_count: 2,
    available_count: 1,
    unavailable_count: 1,
  });
  const result = classifyPersonalizedRecommendationPayload(readyPayload(items, snap));
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('49: classify does not sort or re-rank received items', () => {
  const idB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const idA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const result = classifyPersonalizedRecommendationPayload(
    readyPayload([
      { rank: 1, song: song({ _id: idB }) },
      { rank: 2, song: song({ _id: idA }) },
    ]),
  );
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.READY);
  assert.equal(result.songs[0]._id, idB);
  assert.equal(result.songs[1]._id, idA);
});

test('50: classify exposes song objects without attaching rank or fallback markers', () => {
  const original = song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', extra: 'keep' });
  const result = classifyPersonalizedRecommendationPayload(
    readyPayload([{ rank: 1, song: original }]),
  );
  assert.equal(result.songs.length, 1);
  assert.equal(result.songs[0].rank, undefined);
  assert.equal(result.songs[0].score, undefined);
  assert.equal(result.songs[0].basis, undefined);
  assert.equal(result.songs[0].fallback, undefined);
  assert.equal(result.songs[0].extra, 'keep');
});

test('51: classify keeps songs un-mutated relative to input', () => {
  const original = song({ _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', title: 'Keep Me' });
  const frozenResult = classifyPersonalizedRecommendationPayload(
    readyPayload([{ rank: 1, song: original }]),
  );
  assert.equal(frozenResult.songs[0], original);
});

test('52: fallback helper is false for idle, loading, ready', () => {
  for (const state of ['idle', 'loading', 'ready']) {
    assert.equal(shouldUseLegacyRecommendationFallback(state), false, state);
  }
});

test('53: fallback helper is true for no-snapshot, empty, disabled, error', () => {
  for (const state of ['no-snapshot', 'empty', 'disabled', 'error']) {
    assert.equal(shouldUseLegacyRecommendationFallback(state), true, state);
  }
});

test('54: loading never requests legacy fallback', () => {
  assert.equal(
    shouldUseLegacyRecommendationFallback(PERSONALIZED_RECOMMENDATION_STATES.LOADING),
    false,
  );
});

test('55: ready never requests legacy fallback', () => {
  assert.equal(
    shouldUseLegacyRecommendationFallback(PERSONALIZED_RECOMMENDATION_STATES.READY),
    false,
  );
});

test('56: empty reason identifiers map for each non-ready state', () => {
  assert.equal(getPersonalizedRecommendationEmptyReason('no-snapshot'), 'no-snapshot');
  assert.equal(getPersonalizedRecommendationEmptyReason('empty'), 'empty-snapshot');
  assert.equal(getPersonalizedRecommendationEmptyReason('disabled'), 'feature-disabled');
  assert.equal(getPersonalizedRecommendationEmptyReason('error'), 'request-error');
});

test('57: empty reason is none for idle, loading, ready', () => {
  for (const state of ['idle', 'loading', 'ready']) {
    assert.equal(getPersonalizedRecommendationEmptyReason(state), 'none', state);
  }
});

test('58: fetch issues exactly one GET with validated path', async () => {
  const client = createApiClient([readyPayload([])]);
  const result = await fetchPersonalizedRecommendations({
    limit: 10,
    apiClient: client,
  });
  assert.equal(client.paths.length, 1);
  assert.equal(client.paths[0], '/api/recommendations?limit=10');
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.EMPTY);
});

test('59: fetch does not retry after a network failure', async () => {
  const client = createApiClient([new Error('boom')]);
  const result = await fetchPersonalizedRecommendations({
    limit: 5,
    apiClient: client,
  });
  assert.equal(client.paths.length, 1);
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.REQUEST_FAILED);
  assert.equal(result.error.message, PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE);
});

test('60: fetch with invalid limit makes zero requests', async () => {
  const client = createApiClient([readyPayload([])]);
  const result = await fetchPersonalizedRecommendations({
    limit: 0,
    apiClient: client,
  });
  assert.equal(client.paths.length, 0);
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
});

test('61: fetch with missing api client fails closed without request', async () => {
  const result = await fetchPersonalizedRecommendations({ limit: 10 });
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.ERROR);
  assert.equal(result.error.code, PERSONALIZED_RECOMMENDATION_ERROR_CODES.REQUEST_FAILED);
});

test('62: fetch classifies disabled payload without a second request', async () => {
  const client = createApiClient([{
    success: false,
    error: PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE,
  }]);
  const result = await fetchPersonalizedRecommendations({
    limit: 10,
    apiClient: client,
  });
  assert.equal(client.paths.length, 1);
  assert.equal(result.state, PERSONALIZED_RECOMMENDATION_STATES.DISABLED);
});

test('63: fetch default limit is 10 when omitted', async () => {
  const client = createApiClient([readyPayload([])]);
  await fetchPersonalizedRecommendations({ apiClient: client });
  assert.equal(client.paths[0], '/api/recommendations?limit=10');
});

test('64: service module has no client-side ranking or randomness', () => {
  assert.equal(serviceSrc.includes('Math.random'), false);
  assert.equal(serviceSrc.includes('shuffle'), false);
  assert.equal(serviceSrc.includes('setInterval'), false);
  assert.equal(serviceSrc.includes('.sort('), false);
  assert.equal(serviceSrc.toLowerCase().includes('trending'), false);
  assert.equal(serviceSrc.includes('cosine'), false);
  assert.equal(serviceSrc.includes('svd'), false);
  assert.equal(serviceSrc.includes('popularity'), false);
});

test('65: service module has no player or telemetry side effects', () => {
  assert.equal(serviceSrc.includes('PlayerContext'), false);
  assert.equal(serviceSrc.includes('playSong'), false);
  assert.equal(serviceSrc.includes('PlayHistory'), false);
  assert.equal(serviceSrc.includes('ListeningEvent'), false);
  assert.equal(serviceSrc.includes('listeningTelemetry'), false);
});

test('66: service module has no server, python, or dependency changes', () => {
  assert.equal(serviceSrc.includes("from 'express'"), false);
  assert.equal(serviceSrc.includes('mongoose'), false);
  assert.equal(serviceSrc.includes('child_process'), false);
  assert.equal(serviceSrc.includes('require('), false);
});

test('67: hook source uses generation counter for supersede safety', () => {
  assert.equal(hookSrc.includes('generationRef'), true);
  assert.equal(hookSrc.includes('cancelled'), true);
});

test('68: hook source has no polling, auto-retry, or timers', () => {
  assert.equal(hookSrc.includes('setInterval'), false);
  assert.equal(hookSrc.includes('setTimeout'), false);
  assert.equal(hookSrc.includes('setImmediate'), false);
  assert.equal(hookSrc.includes('requestAnimationFrame'), false);
});

test('69: hook source has no randomness or trending coupling', () => {
  assert.equal(hookSrc.includes('Math.random'), false);
  assert.equal(hookSrc.includes('shuffle'), false);
  assert.equal(hookSrc.includes('trending'), false);
  assert.equal(hookSrc.includes('Trending'), false);
});

test('70: hook source has no player, telemetry, or Dashboard imports', () => {
  assert.equal(hookSrc.includes('PlayerContext'), false);
  assert.equal(hookSrc.includes('playSong'), false);
  assert.equal(hookSrc.includes('PlayHistory'), false);
  assert.equal(hookSrc.includes('ListeningEvent'), false);
  assert.equal(hookSrc.includes('Dashboard.jsx'), false);
  assert.equal(hookSrc.includes('pages/Dashboard'), false);
  assert.equal(hookSrc.includes('trendingUi'), false);
});

test('71: hook source reuses authenticated API client and recommendation service', () => {
  assert.equal(hookSrc.includes("from '../api/client.js'"), true);
  assert.equal(
    hookSrc.includes("from '../services/personalizedRecommendations.js'"),
    true,
  );
  assert.equal(hookSrc.includes('fetchPersonalizedRecommendations'), true);
  assert.equal(hookSrc.includes('shouldUseLegacyRecommendationFallback'), true);
});

test('72: hook source builds only limit query via service path helper', () => {
  assert.equal(hookSrc.includes('userId'), false);
  assert.equal(hookSrc.includes('user_id'), false);
  assert.equal(hookSrc.includes('email='), false);
  assert.equal(hookSrc.includes('/api/recommendations'), false);
  assert.equal(hookSrc.includes('buildPersonalizedRecommendationPath')
    || hookSrc.includes('fetchPersonalizedRecommendations'), true);
});

test('73: hook source exposes required return keys', () => {
  for (const key of [
    'state',
    'songs',
    'snapshot',
    'error',
    'isLoading',
    'isReady',
    'shouldUseFallback',
    'refresh',
  ]) {
    assert.equal(hookSrc.includes(key), true, key);
  }
});

test('74: hook source has explicit refresh without recursive auto-fetch', () => {
  assert.equal(hookSrc.includes('refresh'), true);
  assert.equal(hookSrc.includes('refresh()'), false);
  const refreshCount = (hookSrc.match(/refresh/g) || []).length;
  assert.ok(refreshCount >= 2);
});

test('75: hook source does not import React testing or extra libraries', () => {
  assert.equal(hookSrc.includes('@testing-library'), false);
  assert.equal(hookSrc.includes('react-query'), false);
  assert.equal(hookSrc.includes('swr'), false);
  assert.equal(hookSrc.includes('axios'), false);
});
