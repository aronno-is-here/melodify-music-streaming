import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import RecommendationSnapshot, {
  RECOMMENDATION_SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_ITEM_BASES,
  MAX_SNAPSHOT_ITEMS,
  MAX_SNAPSHOT_COUNT,
  SNAPSHOT_SUMMARY_KEYS,
  SNAPSHOT_TOP_LEVEL_KEYS,
  SNAPSHOT_ITEM_INPUT_KEYS,
  snapshotSaveGuard,
  snapshotQueryGuard,
  snapshotDocumentDeleteGuard,
} from '../models/RecommendationSnapshot.js';
import {
  createRecommendationSnapshotService,
  normalizeRecommendationSnapshotPayload,
  computeRecommendationSnapshotPayloadSha256,
  normalizeSnapshotUserId,
  normalizeSnapshotVersion,
  RecommendationSnapshotError,
  RecommendationSnapshotValidationError,
  RecommendationSnapshotConflictError,
  RecommendationSnapshotPersistenceError,
  RecommendationSnapshotImmutableError,
} from './recommendationSnapshotService.js';

const MODEL_SOURCE = readFileSync(
  new URL('../models/RecommendationSnapshot.js', import.meta.url),
  'utf8',
);
const SERVICE_SOURCE = readFileSync(
  new URL('./recommendationSnapshotService.js', import.meta.url),
  'utf8',
);

const HEX = (n) => n.toString(16).padStart(24, '0');
const USER_A = HEX(0xa);
const USER_B = HEX(0xb);
const SONG_1 = HEX(1);
const SONG_2 = HEX(2);
const SONG_3 = HEX(3);
const VERSION = 'snap-2026-09-24-a';

const emptySummary = (overrides = {}) => ({
  input_candidate_count: 0,
  profile_source_excluded_count: 0,
  seen_excluded_count: 0,
  eligible_candidate_count: 0,
  collaborative_known_candidate_count: 0,
  cold_start_song_candidate_count: 0,
  profile_feature_count: 0,
  exploitation_selected_count: 0,
  exploration_selected_count: 0,
  returned_count: 0,
  requested_limit: 20,
  collaborative_known_user: false,
  profile_available: false,
  ...overrides,
});

const summaryForItems = (items, overrides = {}) => {
  const exploration = items.filter((i) => i.basis === 'exploration').length;
  const known = items.filter((i) => i.collaborative_known).length;
  const cold = items.length - known;
  const knownUser = items.some(
    (i) => i.basis === 'hybrid' || i.basis === 'hybrid-profile',
  );
  const profileFeatureCount =
    overrides.profile_feature_count !== undefined
      ? overrides.profile_feature_count
      : items.length > 0
        ? 4
        : 0;
  const base = {
    input_candidate_count: items.length,
    profile_source_excluded_count: 0,
    seen_excluded_count: 0,
    eligible_candidate_count: items.length,
    collaborative_known_candidate_count: known,
    cold_start_song_candidate_count: cold,
    profile_feature_count: profileFeatureCount,
    exploitation_selected_count: items.length - exploration,
    exploration_selected_count: exploration,
    returned_count: items.length,
    requested_limit: Math.max(items.length, 1),
    collaborative_known_user: knownUser,
    profile_available: profileFeatureCount > 0,
  };
  return { ...base, ...overrides };
};

const hybridItem = (rank, songId = SONG_1, overrides = {}) => ({
  rank,
  song_id: songId,
  basis: 'hybrid',
  policy_score: 0.7,
  hybrid_score: 0.7,
  profile_score: null,
  collaborative_known: true,
  ...overrides,
});

const hybridProfileItem = (rank, songId = SONG_1, overrides = {}) => ({
  rank,
  song_id: songId,
  basis: 'hybrid-profile',
  policy_score: 0.72,
  hybrid_score: 0.7,
  profile_score: 0.8,
  collaborative_known: true,
  ...overrides,
});

const profileItem = (rank, songId = SONG_1, overrides = {}) => ({
  rank,
  song_id: songId,
  basis: 'profile',
  policy_score: 0.5,
  hybrid_score: null,
  profile_score: 0.5,
  collaborative_known: false,
  ...overrides,
});

const explorationItem = (rank, songId = SONG_1, overrides = {}) => ({
  rank,
  song_id: songId,
  basis: 'exploration',
  policy_score: null,
  hybrid_score: null,
  profile_score: null,
  collaborative_known: false,
  ...overrides,
});

const payloadWithItems = (items, summaryOverrides = {}, topOverrides = {}) => ({
  user_id: USER_A,
  snapshot_version: VERSION,
  generated_at: '2026-09-24T10:00:00Z',
  items,
  summary: summaryForItems(items, summaryOverrides),
  ...topOverrides,
});

const validPayload = (overrides = {}) => ({
  user_id: USER_A,
  snapshot_version: VERSION,
  generated_at: '2026-09-24T10:00:00Z',
  items: [],
  summary: emptySummary(),
  ...overrides,
});

const normalizedDocument = (overrides = {}) => {
  const normalized = normalizeRecommendationSnapshotPayload(validPayload());
  return {
    schema_version: normalized.schema_version,
    user: normalized.user_id,
    snapshot_version: normalized.snapshot_version,
    artifact_version: normalized.artifact_version,
    generated_at: normalized.generated_at,
    items: normalized.items.map((item) => ({ ...item, song: item.song_id })),
    summary: normalized.summary,
    payload_sha256: computeRecommendationSnapshotPayloadSha256(normalized),
    ...overrides,
  };
};

const expectValidationError = (payload, match) => {
  try {
    normalizeRecommendationSnapshotPayload(payload);
    assert.fail('expected validation error');
  } catch (error) {
    assert.ok(
      error instanceof RecommendationSnapshotValidationError,
      error.message,
    );
    if (match) assert.match(error.message, match);
  }
};

const expectUserError = (value) => {
  try {
    normalizeSnapshotUserId(value);
    assert.fail('expected user id error');
  } catch (error) {
    assert.ok(error instanceof RecommendationSnapshotValidationError);
    assert.match(error.message, /invalid snapshot user id/);
  }
};

const expectVersionError = (value) => {
  try {
    normalizeSnapshotVersion(value);
    assert.fail('expected snapshot version error');
  } catch (error) {
    assert.ok(error instanceof RecommendationSnapshotValidationError);
    assert.match(error.message, /invalid snapshot version/);
  }
};

const createFakeModel = (behavior = {}) => {
  const state = {
    docs: (behavior.docs || []).map((doc) => ({ ...doc })),
    createCalls: [],
    findOneCalls: [],
    updateCalls: [],
    deleteCalls: [],
    createMode: behavior.createMode || 'ok',
    lookupError: behavior.lookupError || null,
  };

  const matchesFilter = (doc, filter) =>
    Object.entries(filter).every(
      ([key, value]) => String(doc[key]) === String(value),
    );

  const model = {
    async create(doc) {
      state.createCalls.push({
        ...doc,
        items: (doc.items || []).map((item) => ({ ...item })),
        summary: { ...doc.summary },
      });
      if (state.createMode === 'e11000') {
        const error = new Error('E11000 duplicate key error');
        error.code = 11000;
        throw error;
      }
      if (state.createMode === 'db-error') {
        throw new Error('connection pool exhausted mongodb://secret');
      }
      const persisted = { _id: `id-${state.createCalls.length}`, ...doc };
      state.docs.push(persisted);
      return persisted;
    },
    findOne(filter) {
      state.findOneCalls.push({ filter: { ...filter }, sort: null, leaned: false });
      const call = state.findOneCalls[state.findOneCalls.length - 1];
      const run = async () => {
        if (state.lookupError) throw state.lookupError;
        let rows = state.docs.filter((doc) => matchesFilter(doc, filter));
        if (call.sort) {
          rows = [...rows].sort((a, b) => {
            const generatedDiff = b.generated_at - a.generated_at;
            if (generatedDiff !== 0) return generatedDiff;
            return String(b._id).localeCompare(String(a._id));
          });
        }
        return rows.length > 0 ? { ...rows[0] } : null;
      };
      const api = {
        sort(spec) {
          call.sort = { ...spec };
          return api;
        },
        lean() {
          call.leaned = true;
          return run();
        },
        then(onFulfilled, onRejected) {
          return run().then(onFulfilled, onRejected);
        },
      };
      return api;
    },
    async updateOne() {
      state.updateCalls.push('updateOne');
      throw new Error('immutable');
    },
    async updateMany() {
      state.updateCalls.push('updateMany');
      throw new Error('immutable');
    },
    async findOneAndUpdate() {
      state.updateCalls.push('findOneAndUpdate');
      throw new Error('immutable');
    },
    async replaceOne() {
      state.updateCalls.push('replaceOne');
      throw new Error('immutable');
    },
    async deleteOne() {
      state.deleteCalls.push('deleteOne');
      throw new Error('immutable');
    },
    async deleteMany() {
      state.deleteCalls.push('deleteMany');
      throw new Error('immutable');
    },
    async findOneAndDelete() {
      state.deleteCalls.push('findOneAndDelete');
      throw new Error('immutable');
    },
  };

  return { model, state };
};

test('1: snapshot schema version = 1', () => {
  assert.equal(RECOMMENDATION_SNAPSHOT_SCHEMA_VERSION, 1);
});

test('2: max snapshot items = 100', () => {
  assert.equal(MAX_SNAPSHOT_ITEMS, 100);
});

test('3: max snapshot count = 1_000_000', () => {
  assert.equal(MAX_SNAPSHOT_COUNT, 1_000_000);
});

test('4: basis vocabulary exact', () => {
  assert.deepEqual([...SNAPSHOT_ITEM_BASES], [
    'hybrid',
    'hybrid-profile',
    'profile',
    'exploration',
  ]);
});

test('5: model exists', () => {
  assert.ok(RecommendationSnapshot);
  assert.equal(typeof RecommendationSnapshot, 'function');
});

test('6: timestamps enabled', () => {
  assert.equal(RecommendationSnapshot.schema.options.timestamps, true);
});

test('7: strict schema', () => {
  assert.equal(RecommendationSnapshot.schema.options.strict, true);
});

test('8: no TTL', () => {
  assert.equal(MODEL_SOURCE.includes('expireAfterSeconds'), false);
  assert.equal(MODEL_SOURCE.includes('ttl'), false);
  for (const [, options] of RecommendationSnapshot.schema.indexes()) {
    assert.equal(options.expireAfterSeconds, undefined);
  }
});

test('9: no Mixed schema', () => {
  assert.notEqual(RecommendationSnapshot.schema.path('items').instance, 'Mixed');
  assert.notEqual(
    RecommendationSnapshot.schema.path('summary').instance,
    'Mixed',
  );
  assert.equal(MODEL_SOURCE.includes('Schema.Types.Mixed'), false);
  assert.equal(MODEL_SOURCE.includes('mongoose.Schema.Types.Mixed'), false);
});

test('10: valid lowercase 24-hex accepted', () => {
  assert.equal(normalizeSnapshotUserId(USER_A), USER_A);
});

test('11: uppercase canonicalized lowercase', () => {
  assert.equal(normalizeSnapshotUserId(USER_A.toUpperCase()), USER_A);
});

test('12: short rejected', () => {
  expectUserError('abc');
});

test('13: non-hex rejected', () => {
  expectUserError('zzzzzzzzzzzzzzzzzzzzzzzz');
});

test('14: whitespace rejected', () => {
  expectUserError(` ${USER_A}`);
  expectUserError(`${USER_A} `);
});

test('15: non-string rejected', () => {
  expectUserError(123);
  expectUserError(null);
  expectUserError(undefined);
  expectUserError({});
});

test('16: bool rejected', () => {
  expectUserError(true);
  expectUserError(false);
});

test('17: valid lowercase accepted', () => {
  assert.equal(normalizeSnapshotVersion('run-2026-a'), 'run-2026-a');
});

test('18: digits accepted', () => {
  assert.equal(normalizeSnapshotVersion('0batch1'), '0batch1');
});

test('19: dot underscore hyphen accepted', () => {
  assert.equal(normalizeSnapshotVersion('a.b_c-d'), 'a.b_c-d');
});

test('20: uppercase rejected', () => {
  expectVersionError('Run-Alpha');
});

test('21: whitespace rejected', () => {
  expectVersionError(' run-alpha');
  expectVersionError('run-alpha ');
  expectVersionError('run alpha');
});

test('22: slash rejected', () => {
  expectVersionError('run/alpha');
});

test('23: backslash rejected', () => {
  expectVersionError('run\\alpha');
});

test('24: colon rejected', () => {
  expectVersionError('run:alpha');
});

test('25: "." rejected', () => {
  expectVersionError('.');
});

test('26: ".." rejected', () => {
  expectVersionError('..');
});

test('27: empty rejected', () => {
  expectVersionError('');
});

test('28: >64 rejected', () => {
  expectVersionError('a'.repeat(65));
});

test('29: non-string rejected', () => {
  expectVersionError(1);
  expectVersionError(null);
  expectVersionError(undefined);
  expectVersionError(true);
});

test('30: Z ISO accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ generated_at: '2026-09-24T10:00:00Z' }),
  );
  assert.ok(n.generated_at instanceof Date);
  assert.equal(n.generated_at.toISOString(), '2026-09-24T10:00:00.000Z');
});

test('31: explicit offset ISO accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ generated_at: '2026-09-24T12:00:00+02:00' }),
  );
  assert.equal(n.generated_at.toISOString(), '2026-09-24T10:00:00.000Z');
});

test('32: Date object accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ generated_at: new Date('2026-09-24T10:00:00Z') }),
  );
  assert.ok(n.generated_at instanceof Date);
});

test('33: same instant normalizes same', () => {
  const a = normalizeRecommendationSnapshotPayload(
    validPayload({ generated_at: '2026-09-24T10:00:00Z' }),
  );
  const b = normalizeRecommendationSnapshotPayload(
    validPayload({ generated_at: '2026-09-24T12:00:00+02:00' }),
  );
  assert.equal(a.generated_at.getTime(), b.generated_at.getTime());
});

test('34: timezone-less rejected', () => {
  expectValidationError(
    validPayload({ generated_at: '2026-09-24T10:00:00' }),
    /timestamp/,
  );
});

test('35: date-only rejected', () => {
  expectValidationError(validPayload({ generated_at: '2026-09-24' }), /timestamp/);
});

test('36: invalid Date rejected', () => {
  expectValidationError(
    validPayload({ generated_at: new Date('nope') }),
    /timestamp/,
  );
});

test('37: numeric timestamp rejected', () => {
  expectValidationError(validPayload({ generated_at: 1758708000000 }), /timestamp/);
});

test('38: missing rejected', () => {
  const payload = validPayload();
  delete payload.generated_at;
  expectValidationError(payload, /timestamp|snapshot/);
});

test('39: no Date.now fallback', () => {
  assert.equal(SERVICE_SOURCE.includes('Date.now'), false);
  assert.equal(MODEL_SOURCE.includes('Date.now'), false);
});

test('40: omitted artifact accepted', () => {
  const payload = validPayload();
  delete payload.artifact_version;
  const n = normalizeRecommendationSnapshotPayload(payload);
  assert.equal(n.artifact_version, null);
});

test('41: null artifact accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ artifact_version: null }),
  );
  assert.equal(n.artifact_version, null);
});

test('42: valid identifier accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ artifact_version: 'rel-1.0.0' }),
  );
  assert.equal(n.artifact_version, 'rel-1.0.0');
});

test('43: uppercase artifact rejected', () => {
  expectValidationError(
    validPayload({ artifact_version: 'Rel-1' }),
    /artifact/,
  );
});

test('44: traversal artifact rejected', () => {
  expectValidationError(validPayload({ artifact_version: '../etc' }), /artifact/);
  expectValidationError(validPayload({ artifact_version: '..' }), /artifact/);
});

test('45: oversized artifact rejected', () => {
  expectValidationError(
    validPayload({ artifact_version: 'a'.repeat(65) }),
    /artifact/,
  );
});

test('46: empty array accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.deepEqual(n.items, []);
});

test('47: one item accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridItem(1)]),
  );
  assert.equal(n.items.length, 1);
});

test('48: 100 accepted', () => {
  const items = Array.from({ length: 100 }, (_, i) =>
    hybridItem(i + 1, HEX(i + 1)),
  );
  const n = normalizeRecommendationSnapshotPayload(payloadWithItems(items));
  assert.equal(n.items.length, 100);
});

test('49: 101 rejected', () => {
  const items = Array.from({ length: 101 }, (_, i) =>
    hybridItem(Math.min(i + 1, 100), HEX((i % 200) + 1)),
  );
  expectValidationError(payloadWithItems(items, {}, {}), /items/);
});

test('50: non-array rejected', () => {
  expectValidationError(validPayload({ items: 'nope' }), /items/);
  expectValidationError(validPayload({ items: null }), /items/);
  expectValidationError(validPayload({ items: {} }), /items/);
});

test('51: tuple concept not applicable in JS', () => {
  const items = Object.freeze([hybridItem(1)]);
  const n = normalizeRecommendationSnapshotPayload(payloadWithItems(items));
  assert.equal(n.items.length, 1);
});

test('52: caller item array not mutated', () => {
  const items = [hybridItem(1)];
  const snapshot = JSON.stringify(items);
  normalizeRecommendationSnapshotPayload(payloadWithItems(items));
  assert.equal(JSON.stringify(items), snapshot);
});

test('53: exact item keys accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridItem(1)]),
  );
  assert.deepEqual(Object.keys(n.items[0]), [...SNAPSHOT_ITEM_INPUT_KEYS]);
});

test('54: missing rank rejected', () => {
  const item = hybridItem(1);
  delete item.rank;
  expectValidationError(payloadWithItems([item]), /items/);
});

test('55: missing song_id rejected', () => {
  const item = hybridItem(1);
  delete item.song_id;
  expectValidationError(payloadWithItems([item]), /items/);
});

test('56: missing basis rejected', () => {
  const item = hybridItem(1);
  delete item.basis;
  expectValidationError(payloadWithItems([item]), /items/);
});

test('57: missing collaborative_known rejected', () => {
  const item = hybridItem(1);
  delete item.collaborative_known;
  expectValidationError(payloadWithItems([item]), /items/);
});

test('58: unknown item key rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), extra: true }]),
    /items/,
  );
});

test('59: raw title field rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), title: 'Song' }]),
    /items/,
  );
});

test('60: artist field rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), artist: 'A' }]),
    /items/,
  );
});

test('61: thumbnail field rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), thumbnail: 'x' }]),
    /items/,
  );
});

test('62: one-item rank1 accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridItem(1)]),
  );
  assert.equal(n.items[0].rank, 1);
});

test('63: sequential ranks accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridItem(1, SONG_1), hybridItem(2, SONG_2)]),
  );
  assert.deepEqual(
    n.items.map((i) => i.rank),
    [1, 2],
  );
});

test('64: rank0 rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), rank: 0 }]),
    /items/,
  );
});

test('65: negative rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), rank: -1 }]),
    /items/,
  );
});

test('66: float rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), rank: 1.5 }]),
    /items/,
  );
});

test('67: bool rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), rank: true }]),
    /items/,
  );
});

test('68: rank >100 rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), rank: 101 }]),
    /items/,
  );
});

test('69: duplicate rank rejected', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, SONG_1), hybridItem(1, SONG_2)]),
    /items/,
  );
});

test('70: gap rejected', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, SONG_1), hybridItem(3, SONG_2)]),
    /items/,
  );
});

test('71: out-of-order item array rejected', () => {
  expectValidationError(
    payloadWithItems([hybridItem(2, SONG_2), hybridItem(1, SONG_1)]),
    /items/,
  );
});

test('72: valid Song ID accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridItem(1, SONG_1)]),
  );
  assert.equal(n.items[0].song_id, SONG_1);
});

test('73: uppercase Song canonicalized', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridItem(1, SONG_1.toUpperCase())]),
  );
  assert.equal(n.items[0].song_id, SONG_1);
});

test('74: malformed rejected', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, 'not-an-id')]),
    /song id/,
  );
});

test('75: duplicate canonical Song rejected', () => {
  expectValidationError(
    payloadWithItems([
      hybridItem(1, SONG_1),
      hybridItem(2, SONG_1.toUpperCase()),
    ]),
    /duplicate snapshot item/,
  );
});

test('76: no silent deduplication', () => {
  try {
    normalizeRecommendationSnapshotPayload(
      payloadWithItems([hybridItem(1, SONG_1), hybridItem(2, SONG_1)]),
    );
    assert.fail('expected duplicate rejection');
  } catch (error) {
    assert.ok(error instanceof RecommendationSnapshotValidationError);
    assert.match(error.message, /duplicate snapshot item/);
  }
});

test('77: hybrid accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridItem(1)]),
  );
  assert.equal(n.items[0].basis, 'hybrid');
});

test('78: hybrid-profile accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridProfileItem(1)]),
  );
  assert.equal(n.items[0].basis, 'hybrid-profile');
});

test('79: profile accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([profileItem(1)]),
  );
  assert.equal(n.items[0].basis, 'profile');
});

test('80: exploration accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([explorationItem(1)]),
  );
  assert.equal(n.items[0].basis, 'exploration');
});

test('81: unknown basis rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), basis: 'trending' }]),
    /items/,
  );
});

test('82: uppercase basis rejected', () => {
  expectValidationError(
    payloadWithItems([{ ...hybridItem(1), basis: 'HYBRID' }]),
    /items/,
  );
});

test('83: null accepted where allowed', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([explorationItem(1)]),
  );
  assert.equal(n.items[0].policy_score, null);
  assert.equal(n.items[0].hybrid_score, null);
  assert.equal(n.items[0].profile_score, null);
});

test('84: zero numeric accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([
      hybridItem(1, SONG_1, { policy_score: 0, hybrid_score: 0 }),
    ]),
  );
  assert.equal(n.items[0].policy_score, 0);
});

test('85: one numeric accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([
      hybridItem(1, SONG_1, { policy_score: 1, hybrid_score: 1 }),
    ]),
  );
  assert.equal(n.items[0].policy_score, 1);
});

test('86: midpoint accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([
      hybridItem(1, SONG_1, { policy_score: 0.5, hybrid_score: 0.5 }),
    ]),
  );
  assert.equal(n.items[0].hybrid_score, 0.5);
});

test('87: negative rejected', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, SONG_1, { policy_score: -0.01 })]),
    /items/,
  );
});

test('88: >1 rejected', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, SONG_1, { hybrid_score: 1.01 })]),
    /items/,
  );
});

test('89: NaN rejected', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, SONG_1, { policy_score: Number.NaN })]),
    /items/,
  );
});

test('90: Infinity rejected', () => {
  expectValidationError(
    payloadWithItems([
      hybridItem(1, SONG_1, { hybrid_score: Number.POSITIVE_INFINITY }),
    ]),
    /items/,
  );
});

test('91: string rejected', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, SONG_1, { policy_score: '0.5' })]),
    /items/,
  );
});

test('92: bool rejected', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, SONG_1, { policy_score: true })]),
    /items/,
  );
});

test('93: hybrid requires policy score', () => {
  expectValidationError(
    payloadWithItems([
      hybridItem(1, SONG_1, { policy_score: null }),
    ]),
    /items/,
  );
});

test('94: hybrid requires hybrid score', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, SONG_1, { hybrid_score: null })]),
    /items/,
  );
});

test('95: hybrid requires profile null', () => {
  expectValidationError(
    payloadWithItems([hybridItem(1, SONG_1, { profile_score: 0.4 })]),
    /items/,
  );
});

test('96: hybrid requires collaborative_known true', () => {
  expectValidationError(
    payloadWithItems([
      hybridItem(1, SONG_1, { collaborative_known: false }),
    ]),
    /items/,
  );
});

test('97: hybrid-profile all three numeric accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridProfileItem(1)]),
  );
  assert.equal(typeof n.items[0].policy_score, 'number');
  assert.equal(typeof n.items[0].hybrid_score, 'number');
  assert.equal(typeof n.items[0].profile_score, 'number');
});

test('98: hybrid-profile missing profile score rejected', () => {
  expectValidationError(
    payloadWithItems([
      hybridProfileItem(1, SONG_1, { profile_score: null }),
    ]),
    /items/,
  );
});

test('99: hybrid-profile collaborative_known false rejected', () => {
  expectValidationError(
    payloadWithItems([
      hybridProfileItem(1, SONG_1, { collaborative_known: false }),
    ]),
    /items/,
  );
});

test('100: profile requires policy score', () => {
  expectValidationError(
    payloadWithItems([profileItem(1, SONG_1, { policy_score: null })]),
    /items/,
  );
});

test('101: profile requires profile score', () => {
  expectValidationError(
    payloadWithItems([profileItem(1, SONG_1, { profile_score: null })]),
    /items/,
  );
});

test('102: profile hybrid score must be null', () => {
  expectValidationError(
    payloadWithItems([profileItem(1, SONG_1, { hybrid_score: 0.4 })]),
    /items/,
  );
});

test('103: profile collaborative_known true accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([profileItem(1, SONG_1, { collaborative_known: true })]),
  );
  assert.equal(n.items[0].collaborative_known, true);
});

test('104: profile collaborative_known false accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([profileItem(1)]),
  );
  assert.equal(n.items[0].collaborative_known, false);
});

test('105: exploration policy score null required', () => {
  expectValidationError(
    payloadWithItems([
      explorationItem(1, SONG_1, { policy_score: 0.3 }),
    ]),
    /items/,
  );
});

test('106: exploration null hybrid/profile diagnostics accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([explorationItem(1)]),
  );
  assert.equal(n.items[0].hybrid_score, null);
  assert.equal(n.items[0].profile_score, null);
});

test('107: exploration numeric hybrid diagnostic accepted when collaborative_known true', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([
      explorationItem(1, SONG_1, {
        hybrid_score: 0.4,
        collaborative_known: true,
      }),
    ]),
  );
  assert.equal(n.items[0].hybrid_score, 0.4);
});

test('108: exploration numeric profile diagnostic accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([
      explorationItem(1, SONG_1, { profile_score: 0.6 }),
    ]),
  );
  assert.equal(n.items[0].profile_score, 0.6);
});

test('109: exploration non-null policy rejected', () => {
  expectValidationError(
    payloadWithItems([
      explorationItem(1, SONG_1, { policy_score: 0.9, hybrid_score: null }),
    ]),
    /items/,
  );
});

test('110: exploration hybrid diagnostic with collaborative_known false rejected', () => {
  expectValidationError(
    payloadWithItems([
      explorationItem(1, SONG_1, {
        hybrid_score: 0.4,
        collaborative_known: false,
      }),
    ]),
    /items/,
  );
});

test('111: collaborative_known true accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridItem(1)]),
  );
  assert.equal(n.items[0].collaborative_known, true);
});

test('112: collaborative_known false accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([profileItem(1)]),
  );
  assert.equal(n.items[0].collaborative_known, false);
});

test('113: collaborative_known numeric rejected', () => {
  expectValidationError(
    payloadWithItems([profileItem(1, SONG_1, { collaborative_known: 1 })]),
    /items/,
  );
});

test('114: collaborative_known string rejected', () => {
  expectValidationError(
    payloadWithItems([profileItem(1, SONG_1, { collaborative_known: 'true' })]),
    /items/,
  );
});

test('115: exact summary accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.deepEqual(Object.keys(n.summary), [...SNAPSHOT_SUMMARY_KEYS]);
});

test('116: missing summary field rejected', () => {
  const summary = emptySummary();
  delete summary.returned_count;
  expectValidationError(validPayload({ summary }), /summary/);
});

test('117: unknown summary field rejected', () => {
  expectValidationError(
    validPayload({ summary: { ...emptySummary(), typo: 1 } }),
    /summary/,
  );
});

test('118: boolean count rejected', () => {
  expectValidationError(
    validPayload({
      summary: emptySummary({ input_candidate_count: true }),
    }),
    /summary/,
  );
});

test('119: negative count rejected', () => {
  expectValidationError(
    validPayload({
      summary: emptySummary({ eligible_candidate_count: -1 }),
    }),
    /summary/,
  );
});

test('120: float count rejected', () => {
  expectValidationError(
    validPayload({
      summary: emptySummary({ input_candidate_count: 1.5 }),
    }),
    /summary/,
  );
});

test('121: >MAX_SNAPSHOT_COUNT rejected', () => {
  expectValidationError(
    validPayload({
      summary: emptySummary({ input_candidate_count: MAX_SNAPSHOT_COUNT + 1 }),
    }),
    /summary/,
  );
});

test('122: requested limit1 accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ summary: emptySummary({ requested_limit: 1 }) }),
  );
  assert.equal(n.summary.requested_limit, 1);
});

test('123: requested limit100 accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ summary: emptySummary({ requested_limit: 100 }) }),
  );
  assert.equal(n.summary.requested_limit, 100);
});

test('124: requested limit0 rejected', () => {
  expectValidationError(
    validPayload({ summary: emptySummary({ requested_limit: 0 }) }),
    /summary/,
  );
});

test('125: requested limit101 rejected', () => {
  expectValidationError(
    validPayload({ summary: emptySummary({ requested_limit: 101 }) }),
    /summary/,
  );
});

test('126: source+seen+eligible=input accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({
      summary: emptySummary({
        input_candidate_count: 10,
        profile_source_excluded_count: 2,
        seen_excluded_count: 3,
        eligible_candidate_count: 5,
        collaborative_known_candidate_count: 5,
        cold_start_song_candidate_count: 0,
        requested_limit: 20,
        collaborative_known_user: true,
      }),
    }),
  );
  assert.equal(n.summary.input_candidate_count, 10);
});

test('127: filter conservation mismatch rejected', () => {
  expectValidationError(
    validPayload({
      summary: emptySummary({
        input_candidate_count: 10,
        profile_source_excluded_count: 1,
        seen_excluded_count: 1,
        eligible_candidate_count: 5,
        collaborative_known_candidate_count: 5,
        cold_start_song_candidate_count: 0,
      }),
    }),
    /summary/,
  );
});

test('128: known+cold-start=eligible accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({
      summary: emptySummary({
        input_candidate_count: 6,
        eligible_candidate_count: 6,
        collaborative_known_candidate_count: 4,
        cold_start_song_candidate_count: 2,
      }),
    }),
  );
  assert.equal(n.summary.eligible_candidate_count, 6);
});

test('129: candidate-category mismatch rejected', () => {
  expectValidationError(
    validPayload({
      summary: emptySummary({
        input_candidate_count: 6,
        eligible_candidate_count: 6,
        collaborative_known_candidate_count: 4,
        cold_start_song_candidate_count: 1,
      }),
    }),
    /summary/,
  );
});

test('130: exploit+exploration=returned accepted', () => {
  const items = [hybridItem(1, SONG_1), explorationItem(2, SONG_2)];
  const n = normalizeRecommendationSnapshotPayload(payloadWithItems(items));
  assert.equal(
    n.summary.exploitation_selected_count + n.summary.exploration_selected_count,
    n.summary.returned_count,
  );
});

test('131: selection-count mismatch rejected', () => {
  expectValidationError(
    validPayload({
      summary: emptySummary({
        returned_count: 0,
        exploitation_selected_count: 1,
        exploration_selected_count: 0,
      }),
    }),
    /summary/,
  );
});

test('132: returned_count must equal items length', () => {
  expectValidationError(
    validPayload({
      items: [hybridItem(1)],
      summary: emptySummary({
        input_candidate_count: 1,
        eligible_candidate_count: 1,
        collaborative_known_candidate_count: 1,
        returned_count: 0,
        exploitation_selected_count: 0,
        exploration_selected_count: 0,
        collaborative_known_user: true,
        profile_feature_count: 4,
        profile_available: true,
      }),
    }),
    /summary/,
  );
});

test('133: returned <= requested limit', () => {
  const items = Array.from({ length: 5 }, (_, i) =>
    hybridItem(i + 1, HEX(i + 1)),
  );
  expectValidationError(
    payloadWithItems(items, { requested_limit: 4 }),
    /summary/,
  );
});

test('134: profile_available true iff feature_count >0', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({
      summary: emptySummary({
        profile_feature_count: 3,
        profile_available: true,
      }),
    }),
  );
  assert.equal(n.summary.profile_available, true);
  expectValidationError(
    validPayload({
      summary: emptySummary({
        profile_feature_count: 3,
        profile_available: false,
      }),
    }),
    /summary/,
  );
  expectValidationError(
    validPayload({
      summary: emptySummary({
        profile_feature_count: 0,
        profile_available: true,
      }),
    }),
    /summary/,
  );
});

test('135: unknown collaborative user requires seen_excluded=0', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({
      summary: emptySummary({
        collaborative_known_user: false,
        seen_excluded_count: 0,
      }),
    }),
  );
  assert.equal(n.summary.seen_excluded_count, 0);
  expectValidationError(
    validPayload({
      summary: emptySummary({
        collaborative_known_user: false,
        input_candidate_count: 1,
        eligible_candidate_count: 1,
        seen_excluded_count: 1,
        collaborative_known_candidate_count: 1,
        requested_limit: 20,
      }),
    }),
    /summary/,
  );
});

test('136: exploration item count matches summary', () => {
  const items = [hybridItem(1, SONG_1), explorationItem(2, SONG_2)];
  const n = normalizeRecommendationSnapshotPayload(payloadWithItems(items));
  assert.equal(n.summary.exploration_selected_count, 1);
});

test('137: non-exploration count matches exploitation summary', () => {
  const items = [
    hybridItem(1, SONG_1),
    hybridProfileItem(2, SONG_2),
    explorationItem(3, SONG_3),
  ];
  const n = normalizeRecommendationSnapshotPayload(payloadWithItems(items));
  assert.equal(n.summary.exploitation_selected_count, 2);
});

test('138: basis-count mismatch rejected', () => {
  const items = [hybridItem(1, SONG_1), explorationItem(2, SONG_2)];
  expectValidationError(
    payloadWithItems(items, {
      exploration_selected_count: 0,
      exploitation_selected_count: 2,
    }),
    /summary/,
  );
});

test('139: empty items requires zero selected counts', () => {
  expectValidationError(
    validPayload({
      summary: emptySummary({
        exploitation_selected_count: 1,
        returned_count: 1,
      }),
    }),
    /summary/,
  );
});

test('140: empty items valid', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.deepEqual(n.items, []);
});

test('141: returned_count 0', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.equal(n.summary.returned_count, 0);
});

test('142: exploitation count0', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.equal(n.summary.exploitation_selected_count, 0);
});

test('143: exploration count0', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.equal(n.summary.exploration_selected_count, 0);
});

test('144: requested_limit remains >=1', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.ok(n.summary.requested_limit >= 1);
});

test('145: empty snapshot hash deterministic', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload()),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload()),
  );
  assert.equal(a, b);
});

test('146: exact payload accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.deepEqual(Object.keys(n), [...SNAPSHOT_TOP_LEVEL_KEYS]);
});

test('147: unknown top-level field rejected', () => {
  expectValidationError(validPayload({ nope: 1 }), /snapshot/);
});

test('148: payload_sha256 caller field rejected', () => {
  expectValidationError(
    validPayload({ payload_sha256: 'a'.repeat(64) }),
    /snapshot/,
  );
});

test('149: caller schema omitted defaults1', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.equal(n.schema_version, 1);
});

test('150: explicit schema1 accepted', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ schema_version: 1 }),
  );
  assert.equal(n.schema_version, 1);
});

test('151: unsupported schema rejected', () => {
  expectValidationError(
    validPayload({ schema_version: 2 }),
    /schema version/,
  );
  expectValidationError(
    validPayload({ schema_version: 0 }),
    /schema version/,
  );
});

test('152: user uppercase canonicalized', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ user_id: USER_A.toUpperCase() }),
  );
  assert.equal(n.user_id, USER_A);
});

test('153: Song uppercase canonicalized', () => {
  const n = normalizeRecommendationSnapshotPayload(
    payloadWithItems([hybridItem(1, SONG_1.toUpperCase())]),
  );
  assert.equal(n.items[0].song_id, SONG_1);
});

test('154: generated_at normalized UTC', () => {
  const n = normalizeRecommendationSnapshotPayload(
    validPayload({ generated_at: '2026-09-24T12:00:00+02:00' }),
  );
  assert.ok(n.generated_at instanceof Date);
  assert.equal(n.generated_at.toISOString(), '2026-09-24T10:00:00.000Z');
});

test('155: artifact null normalized consistently', () => {
  const omitted = normalizeRecommendationSnapshotPayload(validPayload());
  const explicit = normalizeRecommendationSnapshotPayload(
    validPayload({ artifact_version: null }),
  );
  assert.equal(omitted.artifact_version, explicit.artifact_version);
});

test('156: input key order does not affect result', () => {
  const a = normalizeRecommendationSnapshotPayload({
    user_id: USER_A,
    snapshot_version: VERSION,
    generated_at: '2026-09-24T10:00:00Z',
    items: [],
    summary: emptySummary(),
  });
  const b = normalizeRecommendationSnapshotPayload({
    summary: emptySummary(),
    items: [],
    generated_at: '2026-09-24T10:00:00Z',
    snapshot_version: VERSION,
    user_id: USER_A,
  });
  assert.deepEqual(a, b);
});

test('157: item object key order does not affect result', () => {
  const itemA = hybridItem(1);
  const itemB = {
    collaborative_known: itemA.collaborative_known,
    profile_score: itemA.profile_score,
    hybrid_score: itemA.hybrid_score,
    policy_score: itemA.policy_score,
    basis: itemA.basis,
    song_id: itemA.song_id,
    rank: itemA.rank,
  };
  const a = normalizeRecommendationSnapshotPayload(payloadWithItems([itemA]));
  const b = normalizeRecommendationSnapshotPayload(payloadWithItems([itemB]));
  assert.deepEqual(a.items, b.items);
});

test('158: summary object key order does not affect result', () => {
  const summary = emptySummary();
  const reversed = Object.fromEntries(Object.entries(summary).reverse());
  const a = normalizeRecommendationSnapshotPayload(validPayload({ summary }));
  const b = normalizeRecommendationSnapshotPayload(
    validPayload({ summary: reversed }),
  );
  assert.deepEqual(a.summary, b.summary);
});

test('159: original payload not mutated', () => {
  const payload = validPayload();
  const before = JSON.stringify(payload);
  normalizeRecommendationSnapshotPayload(payload);
  assert.equal(JSON.stringify(payload), before);
});

test('160: SHA-256 digest lowercase 64 hex', () => {
  const hash = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload()),
  );
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('161: identical normalized payload same hash', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload()),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload()),
  );
  assert.equal(a, b);
});

test('162: caller key order does not change hash', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload()),
  );
  const reordered = {
    summary: emptySummary(),
    items: [],
    generated_at: '2026-09-24T10:00:00Z',
    snapshot_version: VERSION,
    user_id: USER_A,
  };
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(reordered),
  );
  assert.equal(a, b);
});

test('163: item property order does not change hash', () => {
  const itemA = hybridItem(1);
  const itemB = {
    collaborative_known: true,
    profile_score: null,
    hybrid_score: 0.7,
    policy_score: 0.7,
    basis: 'hybrid',
    song_id: SONG_1,
    rank: 1,
  };
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(payloadWithItems([itemA])),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(payloadWithItems([itemB])),
  );
  assert.equal(a, b);
});

test('164: summary key order does not change hash', () => {
  const summary = emptySummary();
  const reversed = Object.fromEntries(Object.entries(summary).reverse());
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload({ summary })),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload({ summary: reversed })),
  );
  assert.equal(a, b);
});

test('165: score change changes hash', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      payloadWithItems([
        hybridItem(1, SONG_1, { policy_score: 0.7, hybrid_score: 0.7 }),
      ]),
    ),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      payloadWithItems([
        hybridItem(1, SONG_1, { policy_score: 0.71, hybrid_score: 0.7 }),
      ]),
    ),
  );
  assert.notEqual(a, b);
});

test('166: basis change changes hash', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      payloadWithItems([hybridItem(1, SONG_1)]),
    ),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      payloadWithItems([hybridProfileItem(1, SONG_1)]),
    ),
  );
  assert.notEqual(a, b);
});

test('167: rank change changes hash', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      payloadWithItems([hybridItem(1, SONG_1)]),
    ),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      payloadWithItems([
        hybridItem(1, SONG_1),
        hybridItem(2, SONG_2),
      ], { requested_limit: 20 }),
    ),
  );
  assert.notEqual(a, b);
});

test('168: generated_at instant change changes hash', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      validPayload({ generated_at: '2026-09-24T10:00:00Z' }),
    ),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      validPayload({ generated_at: '2026-09-24T11:00:00Z' }),
    ),
  );
  assert.notEqual(a, b);
});

test('169: user change changes hash', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload()),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload({ user_id: USER_B })),
  );
  assert.notEqual(a, b);
});

test('170: snapshot version change changes hash', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload()),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      validPayload({ snapshot_version: 'snap-b' }),
    ),
  );
  assert.notEqual(a, b);
});

test('171: artifact version change changes hash', () => {
  const a = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(validPayload()),
  );
  const b = computeRecommendationSnapshotPayloadSha256(
    normalizeRecommendationSnapshotPayload(
      validPayload({ artifact_version: 'rel-2' }),
    ),
  );
  assert.notEqual(a, b);
});

test('172: uses SHA-256', () => {
  assert.match(SERVICE_SOURCE, /createHash\(['"]sha256['"]\)/);
});

test('173: no MD5', () => {
  assert.equal(SERVICE_SOURCE.includes('md5'), false);
  assert.equal(SERVICE_SOURCE.includes('MD5'), false);
});

test('174: no SHA1', () => {
  assert.equal(/createHash\(['"]sha1['"]\)/.test(SERVICE_SOURCE), false);
  assert.equal(SERVICE_SOURCE.includes('sha1'), false);
});

test('175: _id excluded', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.equal(Object.prototype.hasOwnProperty.call(n, '_id'), false);
  const hash = computeRecommendationSnapshotPayloadSha256(n);
  assert.match(hash, /^[a-f0-9]{64}$/);
});

test('176: createdAt excluded', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.equal(Object.prototype.hasOwnProperty.call(n, 'createdAt'), false);
});

test('177: updatedAt excluded', () => {
  const n = normalizeRecommendationSnapshotPayload(validPayload());
  assert.equal(Object.prototype.hasOwnProperty.call(n, 'updatedAt'), false);
});

test('178: payload hash excluded from its own input', () => {
  const withCallerHash = validPayload({ payload_sha256: 'c'.repeat(64) });
  delete withCallerHash.payload_sha256;
  const n = normalizeRecommendationSnapshotPayload(withCallerHash);
  assert.equal(Object.prototype.hasOwnProperty.call(n, 'payload_sha256'), false);
  assert.match(computeRecommendationSnapshotPayloadSha256(n), /^[a-f0-9]{64}$/);
});

test('179: valid normalized DB record validates', () => {
  const doc = new RecommendationSnapshot(normalizedDocument());
  assert.equal(doc.validateSync(), undefined);
});

test('180: user field is ObjectId ref User', () => {
  const path = RecommendationSnapshot.schema.path('user');
  assert.equal(path.instance, 'ObjectId');
  assert.equal(path.options.ref, 'User');
});

test('181: item song field ObjectId ref Song', () => {
  const path = RecommendationSnapshot.schema.path('items').schema.path('song');
  assert.equal(path.instance, 'ObjectId');
  assert.equal(path.options.ref, 'Song');
});

test('182: score schema bounds present', () => {
  const itemSchema = RecommendationSnapshot.schema.path('items').schema;
  for (const key of ['policy_score', 'hybrid_score', 'profile_score']) {
    const path = itemSchema.path(key);
    assert.ok(path);
    assert.ok(path.options.validate);
  }
});

test('183: basis enum present', () => {
  const path = RecommendationSnapshot.schema.path('items').schema.path('basis');
  assert.deepEqual([...path.enumValues], [...SNAPSHOT_ITEM_BASES]);
});

test('184: payload hash format enforced', () => {
  const doc = new RecommendationSnapshot(
    normalizedDocument({ payload_sha256: 'nope' }),
  );
  assert.ok(doc.validateSync());
});

test('185: schema version enforced', () => {
  const doc = new RecommendationSnapshot(
    normalizedDocument({ schema_version: 9 }),
  );
  assert.ok(doc.validateSync());
});

test('186: strict unknown model field rejected', () => {
  const doc = new RecommendationSnapshot({
    ...normalizedDocument(),
    email: 'leak@example.com',
    overall_score: 0.9,
  });
  const plain = doc.toObject();
  assert.equal(plain.email, undefined);
  assert.equal(plain.overall_score, undefined);
  assert.equal(RecommendationSnapshot.schema.path('email'), undefined);
  assert.equal(RecommendationSnapshot.schema.path('overall_score'), undefined);
});

test('187: no title/artist metadata fields in snapshot item', () => {
  const itemSchema = RecommendationSnapshot.schema.path('items').schema;
  assert.equal(itemSchema.path('title'), undefined);
  assert.equal(itemSchema.path('artist'), undefined);
  assert.equal(itemSchema.path('thumbnail'), undefined);
  assert.equal(itemSchema.path('youtube_id'), undefined);
});

test('188: unique user+snapshot_version index exists', () => {
  const indexes = RecommendationSnapshot.schema.indexes();
  const unique = indexes.find(
    ([keys, options]) =>
      keys.user === 1 &&
      keys.snapshot_version === 1 &&
      options.unique === true,
  );
  assert.ok(unique);
});

test('189: latest user+generated_at+_id index exists', () => {
  const indexes = RecommendationSnapshot.schema.indexes();
  const latest = indexes.find(
    ([keys]) =>
      keys.user === 1 && keys.generated_at === -1 && keys._id === -1,
  );
  assert.ok(latest);
});

test('190: version history index exists', () => {
  const indexes = RecommendationSnapshot.schema.indexes();
  const versionHistory = indexes.find(
    ([keys]) =>
      keys.snapshot_version === 1 && keys.generated_at === -1,
  );
  assert.ok(versionHistory);
});

test('191: artifact index valid if implemented', () => {
  const indexes = RecommendationSnapshot.schema.indexes();
  const artifact = indexes.find(
    ([keys]) => keys.artifact_version === 1 && keys.generated_at === -1,
  );
  assert.ok(artifact);
  assert.ok(artifact[1].partialFilterExpression);
});

test('192: no TTL index', () => {
  for (const [, options] of RecommendationSnapshot.schema.indexes()) {
    assert.equal(options.expireAfterSeconds, undefined);
  }
});

test('193: record performs one create', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.recordRecommendationSnapshot(validPayload());
  assert.equal(state.createCalls.length, 1);
});

test('194: create receives normalized user ref', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.recordRecommendationSnapshot(
    validPayload({ user_id: USER_A.toUpperCase() }),
  );
  assert.equal(String(state.createCalls[0].user), USER_A);
});

test('195: create receives normalized Song refs', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.recordRecommendationSnapshot(
    payloadWithItems([hybridItem(1, SONG_1.toUpperCase())]),
  );
  assert.equal(String(state.createCalls[0].items[0].song), SONG_1);
});

test('196: generated hash included', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.recordRecommendationSnapshot(validPayload());
  assert.match(state.createCalls[0].payload_sha256, /^[a-f0-9]{64}$/);
});

test('197: caller unknown fields never reach model', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () =>
      service.recordRecommendationSnapshot(
        validPayload({ payload_sha256: 'f'.repeat(64), extra: 1 }),
      ),
    RecommendationSnapshotValidationError,
  );
  assert.equal(state.createCalls.length, 0);
});

test('198: success returns created=true', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const result = await service.recordRecommendationSnapshot(validPayload());
  assert.equal(result.created, true);
});

test('199: persisted snapshot returned', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const result = await service.recordRecommendationSnapshot(validPayload());
  assert.equal(result.snapshot.snapshot_version, VERSION);
  assert.equal(String(result.snapshot.user), USER_A);
  assert.ok(result.snapshot.payload_sha256);
});

test('200: E11000 triggers one lookup', async () => {
  const normalized = normalizeRecommendationSnapshotPayload(validPayload());
  const hash = computeRecommendationSnapshotPayloadSha256(normalized);
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: hash,
        generated_at: normalized.generated_at,
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const result = await service.recordRecommendationSnapshot(validPayload());
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.findOneCalls.length, 1);
  assert.equal(result.created, false);
});

test('201: lookup uses user+snapshot_version', async () => {
  const normalized = normalizeRecommendationSnapshotPayload(validPayload());
  const hash = computeRecommendationSnapshotPayloadSha256(normalized);
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: hash,
        generated_at: normalized.generated_at,
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.recordRecommendationSnapshot(validPayload());
  const filter = state.findOneCalls[0].filter;
  assert.equal(String(filter.user), USER_A);
  assert.equal(filter.snapshot_version, VERSION);
});

test('202: identical hash returns created=false', async () => {
  const normalized = normalizeRecommendationSnapshotPayload(validPayload());
  const hash = computeRecommendationSnapshotPayloadSha256(normalized);
  const { model } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: hash,
        generated_at: normalized.generated_at,
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const result = await service.recordRecommendationSnapshot(validPayload());
  assert.equal(result.created, false);
});

test('203: existing snapshot returned', async () => {
  const normalized = normalizeRecommendationSnapshotPayload(validPayload());
  const hash = computeRecommendationSnapshotPayloadSha256(normalized);
  const { model } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: hash,
        generated_at: normalized.generated_at,
        marker: 'existing',
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const result = await service.recordRecommendationSnapshot(validPayload());
  assert.equal(result.snapshot.marker, 'existing');
});

test('204: no update called', async () => {
  const normalized = normalizeRecommendationSnapshotPayload(validPayload());
  const hash = computeRecommendationSnapshotPayloadSha256(normalized);
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: hash,
        generated_at: normalized.generated_at,
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.recordRecommendationSnapshot(validPayload());
  assert.equal(state.updateCalls.length, 0);
});

test('205: no second create loop', async () => {
  const normalized = normalizeRecommendationSnapshotPayload(validPayload());
  const hash = computeRecommendationSnapshotPayloadSha256(normalized);
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: hash,
        generated_at: normalized.generated_at,
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.recordRecommendationSnapshot(validPayload());
  assert.equal(state.createCalls.length, 1);
});

test('206: same user/version different hash => conflict', async () => {
  const { model } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: 'a'.repeat(64),
        generated_at: new Date('2026-09-24T10:00:00Z'),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.recordRecommendationSnapshot(validPayload()),
    RecommendationSnapshotConflictError,
  );
});

test('207: no overwrite', async () => {
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: 'a'.repeat(64),
        generated_at: new Date('2026-09-24T10:00:00Z'),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.recordRecommendationSnapshot(validPayload()),
    RecommendationSnapshotConflictError,
  );
  assert.equal(state.updateCalls.length, 0);
});

test('208: no merge', async () => {
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: 'a'.repeat(64),
        generated_at: new Date('2026-09-24T10:00:00Z'),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.recordRecommendationSnapshot(validPayload()),
    RecommendationSnapshotConflictError,
  );
  assert.equal(state.updateCalls.includes('updateOne'), false);
  assert.equal(state.updateCalls.includes('replaceOne'), false);
  assert.equal(state.updateCalls.includes('findOneAndUpdate'), false);
});

test('209: no update', async () => {
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: 'a'.repeat(64),
        generated_at: new Date('2026-09-24T10:00:00Z'),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.recordRecommendationSnapshot(validPayload()),
    RecommendationSnapshotConflictError,
  );
  assert.equal(state.updateCalls.length, 0);
});

test('210: sanitized conflict message', async () => {
  const { model } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: 'a'.repeat(64),
        generated_at: new Date('2026-09-24T10:00:00Z'),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  try {
    await service.recordRecommendationSnapshot(validPayload());
    assert.fail('expected conflict');
  } catch (error) {
    assert.ok(error instanceof RecommendationSnapshotConflictError);
    assert.equal(
      error.message,
      'recommendation snapshot already exists with different content',
    );
    assert.equal(error.message.includes(USER_A), false);
    assert.equal(error.message.includes(SONG_1), false);
  }
});

test('211: uniqueness contract allows same version for different user', async () => {
  const indexes = RecommendationSnapshot.schema.indexes();
  const globalVersionUnique = indexes.find(
    ([keys, options]) =>
      keys.snapshot_version === 1 &&
      Object.keys(keys).length === 1 &&
      options.unique === true,
  );
  assert.equal(globalVersionUnique, undefined);
  const compound = indexes.find(
    ([keys, options]) =>
      keys.user === 1 && keys.snapshot_version === 1 && options.unique === true,
  );
  assert.ok(compound);
});

test('212: service lookup includes user', async () => {
  const normalized = normalizeRecommendationSnapshotPayload(validPayload());
  const hash = computeRecommendationSnapshotPayloadSha256(normalized);
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_A,
        snapshot_version: VERSION,
        payload_sha256: hash,
        generated_at: normalized.generated_at,
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.recordRecommendationSnapshot(validPayload());
  assert.ok(Object.prototype.hasOwnProperty.call(state.findOneCalls[0].filter, 'user'));
  assert.ok(
    Object.prototype.hasOwnProperty.call(
      state.findOneCalls[0].filter,
      'snapshot_version',
    ),
  );
});

test('213: no global version conflict logic', async () => {
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [
      {
        user: USER_B,
        snapshot_version: VERSION,
        payload_sha256: 'a'.repeat(64),
        generated_at: new Date('2026-09-24T10:00:00Z'),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.recordRecommendationSnapshot(validPayload()),
    RecommendationSnapshotPersistenceError,
  );
  assert.equal(String(state.findOneCalls[0].filter.user), USER_A);
});

test('214: ordinary DB error => persistence error', async () => {
  const { model } = createFakeModel({ createMode: 'db-error' });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.recordRecommendationSnapshot(validPayload()),
    RecommendationSnapshotPersistenceError,
  );
});

test('215: raw DB error message not exposed', async () => {
  const { model } = createFakeModel({ createMode: 'db-error' });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  try {
    await service.recordRecommendationSnapshot(validPayload());
    assert.fail('expected persistence error');
  } catch (error) {
    assert.ok(error instanceof RecommendationSnapshotPersistenceError);
    assert.equal(error.message, 'failed to persist recommendation snapshot');
    assert.equal(error.message.includes('mongodb://'), false);
    assert.equal(error.message.includes('secret'), false);
    assert.equal(error.message.includes(USER_A), false);
  }
});

test('216: no retry loop', async () => {
  const { model, state } = createFakeModel({ createMode: 'db-error' });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.recordRecommendationSnapshot(validPayload()),
    RecommendationSnapshotPersistenceError,
  );
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.findOneCalls.length, 0);
});

test('217: valid user queried exactly', async () => {
  const { model, state } = createFakeModel({
    docs: [
      {
        _id: 'id-1',
        user: USER_A,
        snapshot_version: VERSION,
        generated_at: new Date('2026-09-24T10:00:00Z'),
        payload_sha256: 'a'.repeat(64),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const snapshot = await service.getLatestRecommendationSnapshotForUser(USER_A);
  assert.equal(String(state.findOneCalls[0].filter.user), USER_A);
  assert.equal(snapshot.snapshot_version, VERSION);
});

test('218: invalid user rejected before query', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.getLatestRecommendationSnapshotForUser('bad'),
    RecommendationSnapshotValidationError,
  );
  assert.equal(state.findOneCalls.length, 0);
});

test('219: sort generated_at DESC', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.getLatestRecommendationSnapshotForUser(USER_A);
  assert.equal(state.findOneCalls[0].sort.generated_at, -1);
});

test('220: secondary _id DESC', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.getLatestRecommendationSnapshotForUser(USER_A);
  assert.equal(state.findOneCalls[0].sort._id, -1);
});

test('221: lean/plain query', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.getLatestRecommendationSnapshotForUser(USER_A);
  assert.equal(state.findOneCalls[0].leaned, true);
});

test('222: snapshot returned', async () => {
  const { model } = createFakeModel({
    docs: [
      {
        _id: 'id-1',
        user: USER_A,
        snapshot_version: VERSION,
        generated_at: new Date('2026-09-24T10:00:00Z'),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const snapshot = await service.getLatestRecommendationSnapshotForUser(USER_A);
  assert.ok(snapshot);
});

test('223: none returns null', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const snapshot = await service.getLatestRecommendationSnapshotForUser(USER_A);
  assert.equal(snapshot, null);
});

test('224: no fallback to older non-empty logic', async () => {
  const { model } = createFakeModel({
    docs: [
      {
        _id: 'id-old',
        user: USER_A,
        snapshot_version: 'snap-old',
        generated_at: new Date('2026-09-23T10:00:00Z'),
        items: [hybridItem(1, SONG_1)],
      },
      {
        _id: 'id-new',
        user: USER_A,
        snapshot_version: 'snap-new',
        generated_at: new Date('2026-09-24T10:00:00Z'),
        items: [],
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const snapshot = await service.getLatestRecommendationSnapshotForUser(USER_A);
  assert.equal(snapshot.snapshot_version, 'snap-new');
  assert.deepEqual(snapshot.items, []);
});

test('225: validates user', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.getRecommendationSnapshotByVersion('bad', VERSION),
    RecommendationSnapshotValidationError,
  );
  assert.equal(state.findOneCalls.length, 0);
});

test('226: validates snapshot version', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.getRecommendationSnapshotByVersion(USER_A, 'BAD VERSION'),
    RecommendationSnapshotValidationError,
  );
  assert.equal(state.findOneCalls.length, 0);
});

test('227: exact user+version query', async () => {
  const { model, state } = createFakeModel({
    docs: [
      {
        _id: 'id-1',
        user: USER_A,
        snapshot_version: VERSION,
        generated_at: new Date('2026-09-24T10:00:00Z'),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const snapshot = await service.getRecommendationSnapshotByVersion(
    USER_A,
    VERSION,
  );
  assert.equal(String(state.findOneCalls[0].filter.user), USER_A);
  assert.equal(state.findOneCalls[0].filter.snapshot_version, VERSION);
  assert.equal(snapshot.snapshot_version, VERSION);
});

test('228: lean/plain query', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.getRecommendationSnapshotByVersion(USER_A, VERSION);
  assert.equal(state.findOneCalls[0].leaned, true);
});

test('229: missing returns null', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  const snapshot = await service.getRecommendationSnapshotByVersion(
    USER_A,
    VERSION,
  );
  assert.equal(snapshot, null);
});

test('230: read-only behavior', async () => {
  const { model, state } = createFakeModel({
    docs: [
      {
        _id: 'id-1',
        user: USER_A,
        snapshot_version: VERSION,
        generated_at: new Date('2026-09-24T10:00:00Z'),
      },
    ],
  });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await service.getLatestRecommendationSnapshotForUser(USER_A);
  await service.getRecommendationSnapshotByVersion(USER_A, VERSION);
  assert.equal(state.updateCalls.length, 0);
  assert.equal(state.deleteCalls.length, 0);
  assert.equal(state.createCalls.length, 0);
});

test('231: immutable fields marked appropriately', () => {
  for (const field of [
    'schema_version',
    'user',
    'snapshot_version',
    'artifact_version',
    'generated_at',
    'items',
    'summary',
    'payload_sha256',
  ]) {
    assert.equal(RecommendationSnapshot.schema.path(field).options.immutable, true);
  }
});

test('232: existing modified doc save rejected', () => {
  let captured = 'unset';
  snapshotSaveGuard.call({ isNew: false }, (error) => {
    captured = error;
  });
  assert.ok(captured);
  assert.match(captured.message, /immutable/);
});

test('233: updateOne rejected', () => {
  let captured = 'unset';
  snapshotQueryGuard.call({}, (error) => {
    captured = error;
  });
  assert.ok(captured);
  assert.match(captured.message, /immutable/);
  const hooks =
    RecommendationSnapshot.schema.s.hooks?._pres?.get('updateOne') ?? [];
  assert.ok(hooks.some((hook) => hook.fn === snapshotQueryGuard));
});

test('234: updateMany rejected', () => {
  const hooks =
    RecommendationSnapshot.schema.s.hooks?._pres?.get('updateMany') ?? [];
  assert.ok(hooks.some((hook) => hook.fn === snapshotQueryGuard));
});

test('235: findOneAndUpdate rejected', () => {
  const hooks =
    RecommendationSnapshot.schema.s.hooks?._pres?.get('findOneAndUpdate') ?? [];
  assert.ok(hooks.some((hook) => hook.fn === snapshotQueryGuard));
});

test('236: replaceOne rejected', () => {
  const hooks =
    RecommendationSnapshot.schema.s.hooks?._pres?.get('replaceOne') ?? [];
  assert.ok(hooks.some((hook) => hook.fn === snapshotQueryGuard));
});

test('237: deleteOne rejected', () => {
  const hooks =
    RecommendationSnapshot.schema.s.hooks?._pres?.get('deleteOne') ?? [];
  assert.ok(hooks.some((hook) => hook.fn === snapshotQueryGuard));
});

test('238: deleteMany rejected', () => {
  const hooks =
    RecommendationSnapshot.schema.s.hooks?._pres?.get('deleteMany') ?? [];
  assert.ok(hooks.some((hook) => hook.fn === snapshotQueryGuard));
});

test('239: findOneAndDelete rejected', () => {
  const hooks =
    RecommendationSnapshot.schema.s.hooks?._pres?.get('findOneAndDelete') ?? [];
  assert.ok(hooks.some((hook) => hook.fn === snapshotQueryGuard));
});

test('240: findOneAndRemove guard registered if supported', () => {
  const hooks =
    RecommendationSnapshot.schema.s.hooks?._pres?.get('findOneAndRemove') ?? [];
  assert.ok(hooks.some((hook) => hook.fn === snapshotQueryGuard));
  if (typeof RecommendationSnapshot.findOneAndRemove !== 'function') {
    return;
  }
});

test('241: document deleteOne rejected if supported', () => {
  let captured = null;
  snapshotDocumentDeleteGuard.call({}, (error) => {
    captured = error;
  });
  assert.ok(captured);
  assert.match(captured.message, /immutable/);
});

test('242: create remains allowed', () => {
  let captured = 'unset';
  snapshotSaveGuard.call({ isNew: true }, (error) => {
    captured = error;
  });
  assert.equal(captured, undefined);
  assert.equal(typeof RecommendationSnapshot.create, 'function');
});

test('243: read remains allowed', () => {
  assert.equal(typeof RecommendationSnapshot.findOne, 'function');
  assert.equal(typeof RecommendationSnapshot.find, 'function');
});

test('244: user ref exists', () => {
  assert.equal(RecommendationSnapshot.schema.path('user').instance, 'ObjectId');
});

test('245: Song refs exist', () => {
  const path = RecommendationSnapshot.schema.path('items').schema.path('song');
  assert.equal(path.instance, 'ObjectId');
  assert.equal(path.options.ref, 'Song');
});

test('246: no email field', () => {
  assert.equal(RecommendationSnapshot.schema.path('email'), undefined);
  assert.equal(MODEL_SOURCE.includes('email'), false);
  assert.equal(SERVICE_SOURCE.includes('email'), false);
});

test('247: no username field', () => {
  assert.equal(RecommendationSnapshot.schema.path('username'), undefined);
  assert.equal(MODEL_SOURCE.includes('username'), false);
});

test('248: no password', () => {
  assert.equal(RecommendationSnapshot.schema.path('password'), undefined);
  assert.equal(MODEL_SOURCE.includes('password'), false);
  assert.equal(SERVICE_SOURCE.includes('password'), false);
});

test('249: no JWT/token', () => {
  assert.equal(RecommendationSnapshot.schema.path('token'), undefined);
  assert.equal(RecommendationSnapshot.schema.path('jwt'), undefined);
  assert.equal(MODEL_SOURCE.includes('jsonwebtoken'), false);
  assert.equal(SERVICE_SOURCE.includes('jsonwebtoken'), false);
});

test('250: no IP', () => {
  assert.equal(RecommendationSnapshot.schema.path('ip'), undefined);
  assert.equal(RecommendationSnapshot.schema.path('ip_address'), undefined);
  assert.equal(MODEL_SOURCE.includes('ip_address'), false);
});

test('251: no raw ListeningEvent', () => {
  assert.equal(RecommendationSnapshot.schema.path('listening_events'), undefined);
  assert.equal(MODEL_SOURCE.includes('ListeningEvent'), false);
  assert.equal(SERVICE_SOURCE.includes('ListeningEvent'), false);
});

test('252: no Favorite document content', () => {
  assert.equal(RecommendationSnapshot.schema.path('favorites'), undefined);
  assert.equal(MODEL_SOURCE.includes('favorite_song_ids'), false);
});

test('253: no Playlist document content', () => {
  assert.equal(RecommendationSnapshot.schema.path('playlists'), undefined);
  assert.equal(MODEL_SOURCE.includes('playlist_song_counts'), false);
});

test('254: no artist_counts', () => {
  assert.equal(RecommendationSnapshot.schema.path('artist_counts'), undefined);
  assert.equal(MODEL_SOURCE.includes('artist_counts'), false);
  assert.equal(SERVICE_SOURCE.includes('artist_counts'), false);
});

test('255: no genre_counts', () => {
  assert.equal(RecommendationSnapshot.schema.path('genre_counts'), undefined);
  assert.equal(MODEL_SOURCE.includes('genre_counts'), false);
  assert.equal(SERVICE_SOURCE.includes('genre_counts'), false);
});

test('256: no search-history data', () => {
  assert.equal(RecommendationSnapshot.schema.path('search_history'), undefined);
  assert.equal(MODEL_SOURCE.includes('search_history'), false);
  assert.equal(MODEL_SOURCE.includes('searchHistory'), false);
});

test('257: no child_process', () => {
  assert.equal(SERVICE_SOURCE.includes('child_process'), false);
  assert.equal(MODEL_SOURCE.includes('child_process'), false);
});

test('258: no spawn', () => {
  assert.equal(SERVICE_SOURCE.includes('spawn('), false);
  assert.equal(MODEL_SOURCE.includes('spawn('), false);
});

test('259: no Python command', () => {
  assert.equal(SERVICE_SOURCE.includes('python'), false);
  assert.equal(MODEL_SOURCE.includes('python'), false);
  assert.equal(SERVICE_SOURCE.includes('exec('), false);
  assert.equal(MODEL_SOURCE.includes('exec('), false);
});

test('260: no SVD/model training', () => {
  assert.equal(SERVICE_SOURCE.includes('TruncatedSVD'), false);
  assert.equal(MODEL_SOURCE.includes('TruncatedSVD'), false);
  assert.equal(SERVICE_SOURCE.includes('train_collaborative_model'), false);
  assert.equal(MODEL_SOURCE.includes('train_collaborative_model'), false);
});

test('261: no hybrid calculation', () => {
  assert.equal(SERVICE_SOURCE.includes('rank_hybrid_candidates'), false);
  assert.equal(MODEL_SOURCE.includes('rank_hybrid_candidates'), false);
  assert.equal(SERVICE_SOURCE.includes('0.70'), false);
  assert.equal(SERVICE_SOURCE.includes('0.30'), false);
});

test('262: no cosine calculation', () => {
  assert.equal(SERVICE_SOURCE.includes('cosine'), false);
  assert.equal(MODEL_SOURCE.includes('cosine'), false);
});

test('263: no exploration hash ranking', () => {
  assert.equal(SERVICE_SOURCE.includes('melodify-exploration'), false);
  assert.equal(MODEL_SOURCE.includes('melodify-exploration'), false);
  assert.equal(SERVICE_SOURCE.includes('EXPLORATION_HASH'), false);
  assert.equal(MODEL_SOURCE.includes('rank_with_cold_start_policy'), false);
  assert.equal(SERVICE_SOURCE.includes('rank_with_cold_start_policy'), false);
});

test('264: no evaluation calculation', () => {
  assert.equal(SERVICE_SOURCE.includes('evaluate_recommendations'), false);
  assert.equal(MODEL_SOURCE.includes('evaluate_recommendations'), false);
});

test('265: no artifact publication', () => {
  assert.equal(SERVICE_SOURCE.includes('publish_artifact_release'), false);
  assert.equal(MODEL_SOURCE.includes('publish_artifact_release'), false);
  assert.equal(SERVICE_SOURCE.includes('activate_artifact_release'), false);
  assert.equal(MODEL_SOURCE.includes('activate_artifact_release'), false);
});

test('266: no route creation', () => {
  assert.equal(SERVICE_SOURCE.includes('router.'), false);
  assert.equal(MODEL_SOURCE.includes('router.'), false);
  assert.equal(SERVICE_SOURCE.includes('express.Router'), false);
  assert.equal(SERVICE_SOURCE.includes('app.get'), false);
  assert.equal(SERVICE_SOURCE.includes('app.post'), false);
  assert.equal(SERVICE_SOURCE.includes('app.put'), false);
  assert.equal(SERVICE_SOURCE.includes('app.delete'), false);
});

test('267: no Express router', () => {
  assert.equal(SERVICE_SOURCE.includes('express'), false);
  assert.equal(MODEL_SOURCE.includes('express'), false);
});

test('268: no auth middleware changes', () => {
  assert.equal(SERVICE_SOURCE.includes('protect'), false);
  assert.equal(SERVICE_SOURCE.includes('adminOnly'), false);
  assert.equal(MODEL_SOURCE.includes('protect'), false);
  assert.equal(MODEL_SOURCE.includes('adminOnly'), false);
});

test('269: no Song existence query', () => {
  assert.equal(SERVICE_SOURCE.includes('Song.find'), false);
  assert.equal(SERVICE_SOURCE.includes("models/Song"), false);
  assert.equal(SERVICE_SOURCE.includes('songIds'), false);
});

test('270: no User existence query', () => {
  assert.equal(SERVICE_SOURCE.includes('User.find'), false);
  assert.equal(SERVICE_SOURCE.includes("models/User"), false);
});

test('271: no active/current snapshot pointer', () => {
  assert.equal(MODEL_SOURCE.includes('current_snapshot'), false);
  assert.equal(MODEL_SOURCE.includes('active_snapshot'), false);
  assert.equal(MODEL_SOURCE.includes('is_active'), false);
  assert.equal(SERVICE_SOURCE.includes('current_snapshot'), false);
  assert.equal(SERVICE_SOURCE.includes('active_snapshot'), false);
  assert.equal(SERVICE_SOURCE.includes('is_active'), false);
  assert.equal(RecommendationSnapshot.schema.path('active'), undefined);
  assert.equal(RecommendationSnapshot.schema.path('is_active'), undefined);
});

test('272: no update/upsert write path', () => {
  assert.equal(SERVICE_SOURCE.includes('upsert'), false);
  assert.equal(SERVICE_SOURCE.includes('findOneAndUpdate'), false);
  assert.equal(SERVICE_SOURCE.includes('updateOne'), false);
  assert.equal(SERVICE_SOURCE.includes('updateMany'), false);
  assert.equal(SERVICE_SOURCE.includes('replaceOne'), false);
  assert.equal(MODEL_SOURCE.includes('upsert: true'), false);
});

test('273: no TTL', () => {
  assert.equal(MODEL_SOURCE.includes('expireAfterSeconds'), false);
  assert.equal(MODEL_SOURCE.includes('ttl'), false);
  assert.equal(SERVICE_SOURCE.includes('expireAfterSeconds'), false);
});

test('274: no client import', () => {
  assert.equal(SERVICE_SOURCE.includes('../client'), false);
  assert.equal(MODEL_SOURCE.includes('../client'), false);
});

test('275: error hierarchy usable', () => {
  assert.ok(
    new RecommendationSnapshotValidationError('x') instanceof
      RecommendationSnapshotError,
  );
  assert.ok(
    new RecommendationSnapshotConflictError('x') instanceof
      RecommendationSnapshotError,
  );
  assert.ok(
    new RecommendationSnapshotPersistenceError('x') instanceof
      RecommendationSnapshotError,
  );
  assert.ok(
    new RecommendationSnapshotImmutableError('x') instanceof
      RecommendationSnapshotError,
  );
});

test('276: service API surface exact', () => {
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: createFakeModel().model,
  });
  assert.deepEqual(Object.keys(service).sort(), [
    'getLatestRecommendationSnapshotForUser',
    'getRecommendationSnapshotByVersion',
    'recordRecommendationSnapshot',
  ]);
});

test('277: versionKey disabled per repository convention', () => {
  assert.equal(RecommendationSnapshot.schema.options.versionKey, false);
});

test('278: no policy formula coefficients in service', () => {
  assert.equal(SERVICE_SOURCE.includes('0.80'), false);
  assert.equal(SERVICE_SOURCE.includes('0.20'), false);
  assert.equal(SERVICE_SOURCE.includes('0.70'), false);
  assert.equal(SERVICE_SOURCE.includes('0.30'), false);
});

test('279: persistence error when 11000 but missing doc', async () => {
  const { model } = createFakeModel({ createMode: 'e11000', docs: [] });
  const service = createRecommendationSnapshotService({
    RecommendationSnapshotModel: model,
  });
  await assert.rejects(
    () => service.recordRecommendationSnapshot(validPayload()),
    RecommendationSnapshotPersistenceError,
  );
});

test('280: model validates multi-item snapshot', () => {
  const items = [hybridItem(1, SONG_1), explorationItem(2, SONG_2)];
  const normalized = normalizeRecommendationSnapshotPayload(
    payloadWithItems(items),
  );
  const doc = new RecommendationSnapshot({
    schema_version: normalized.schema_version,
    user: normalized.user_id,
    snapshot_version: normalized.snapshot_version,
    artifact_version: normalized.artifact_version,
    generated_at: normalized.generated_at,
    items: normalized.items.map((item) => ({ ...item, song: item.song_id })),
    summary: normalized.summary,
    payload_sha256: computeRecommendationSnapshotPayloadSha256(normalized),
  });
  assert.equal(doc.validateSync(), undefined);
});

test('281: model rejects non-contiguous ranks', async () => {
  const payload = payloadWithItems([hybridItem(1, SONG_1)]);
  const normalized = normalizeRecommendationSnapshotPayload(payload);
  const doc = new RecommendationSnapshot({
    schema_version: normalized.schema_version,
    user: normalized.user_id,
    snapshot_version: normalized.snapshot_version,
    artifact_version: normalized.artifact_version,
    generated_at: normalized.generated_at,
    items: [
      {
        rank: 3,
        song: SONG_1,
        basis: 'hybrid',
        policy_score: 0.5,
        hybrid_score: 0.5,
        profile_score: null,
        collaborative_known: true,
      },
    ],
    summary: normalized.summary,
    payload_sha256: computeRecommendationSnapshotPayloadSha256(normalized),
  });
  await assert.rejects(() => doc.validate(), /invalid recommendation snapshot/);
});

test('282: no winner/best-model/quality calculation', () => {
  for (const token of ['winner', 'best_model', 'overall_score', 'quality_score']) {
    assert.equal(SERVICE_SOURCE.includes(token), false);
    assert.equal(MODEL_SOURCE.includes(token), false);
  }
});

test('283: no pymongo/FastAPI/Flask', () => {
  for (const token of ['pymongo', 'FastAPI', 'Flask']) {
    assert.equal(MODEL_SOURCE.includes(token), false);
    assert.equal(SERVICE_SOURCE.includes(token), false);
  }
});
