import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ADMIN_RECOMMENDATION_PREFLIGHT_HTTP_MESSAGES,
  ADMIN_RECOMMENDATION_PREFLIGHT_SOURCE,
  MIN_COLLABORATIVE_INTERACTION_PAIRS,
  MIN_COLLABORATIVE_SONGS,
  MIN_COLLABORATIVE_USERS,
  AdminRecommendationPreflightReadError,
  AdminRecommendationPreflightValidationError,
  createAdminRecommendationPreflightService,
  evaluateRecommendationReadiness,
  normalizePreflightFeatureFlags,
  summarizeUsableEvents,
} from './adminRecommendationPreflightService.js';
import { RecommendationTrainingInputLimitError } from './recommendationTrainingInputService.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const USER_A = '64b64b64b64b64b64b64b64a';
const USER_B = '64b64b64b64b64b64b64b64b';
const USER_C = '64b64b64b64b64b64b64b64c';
const SONG_1 = '64b64b64b64b64b64b64b651';
const SONG_2 = '64b64b64b64b64b64b64b652';
const UNKNOWN_USER = '64b64b64b64b64b64b64b6ff';
const UNKNOWN_SONG = '64b64b64b64b64b64b64b6ee';

function buildInput({
  users = [USER_A, USER_B],
  songs = [{ _id: SONG_1 }, { _id: SONG_2 }],
  events = [],
} = {}) {
  return {
    schema_version: 1,
    songs,
    users,
    events,
    profiles: {},
    event_window_truncated: false,
    unique_song_count: songs.length,
    unique_user_count: users.length,
    input_event_count: events.length,
  };
}

function buildEvent(user, song, index) {
  return {
    _id: `evt-${index}`,
    user,
    song,
    session_id: `session-${index}`,
    sequence: index,
    event_type: 'play-started',
    listened_seconds_delta: 1,
    createdAt: new Date(2026, 0, 1).toISOString(),
  };
}

function createService({
  input = buildInput(),
  inputError = null,
  listeningEvents = 0,
  evaluationRuns = 0,
  snapshots = 0,
  featureFlags = { recommendation_ai_enabled: true, listening_events_enabled: true },
} = {}) {
  const calls = [];
  const model = (name) => ({
    async countDocuments() {
      calls.push(name);
      if (name === 'listeningevents') return listeningEvents;
      if (name === 'evaluationruns') return evaluationRuns;
      return snapshots;
    },
    async find() {
      throw new Error('unexpected find call');
    },
    async create() {
      throw new Error('unexpected write call');
    },
    async updateOne() {
      throw new Error('unexpected write call');
    },
    async deleteOne() {
      throw new Error('unexpected write call');
    },
  });

  const service = createAdminRecommendationPreflightService({
    trainingInputService: {
      async collectRetrainingInput() {
        calls.push('collectRetrainingInput');
        if (inputError) throw inputError;
        return input;
      },
    },
    ListeningEventModel: model('listeningevents'),
    EvaluationRunModel: model('evaluationruns'),
    SnapshotModel: model('snapshots'),
    readFeatureFlags: () => featureFlags,
  });

  return { service, calls };
}

test('source constant is the expected non-sensitive marker', () => {
  assert.equal(ADMIN_RECOMMENDATION_PREFLIGHT_SOURCE, 'recommendation-preflight');
});

test('http messages are fixed strings', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_PREFLIGHT_HTTP_MESSAGES.invalidQuery,
    'invalid recommendation preflight query',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_PREFLIGHT_HTTP_MESSAGES.failed,
    'failed to load recommendation preflight',
  );
});

test('threshold constants match the existing collaborative pipeline minimums', () => {
  assert.equal(MIN_COLLABORATIVE_USERS, 2);
  assert.equal(MIN_COLLABORATIVE_SONGS, 2);
  assert.equal(MIN_COLLABORATIVE_INTERACTION_PAIRS, 2);
});

test('feature flags normalize to strict booleans', () => {
  assert.deepEqual(normalizePreflightFeatureFlags({
    recommendation_ai_enabled: true,
    listening_events_enabled: false,
  }), { recommendation_ai_enabled: true, listening_events_enabled: false });

  assert.deepEqual(normalizePreflightFeatureFlags({
    recommendation_ai_enabled: 'true',
    listening_events_enabled: '1',
  }), { recommendation_ai_enabled: true, listening_events_enabled: true });

  assert.deepEqual(normalizePreflightFeatureFlags({
    recommendation_ai_enabled: 'false',
    listening_events_enabled: undefined,
  }), { recommendation_ai_enabled: false, listening_events_enabled: false });

  assert.deepEqual(normalizePreflightFeatureFlags(null), {
    recommendation_ai_enabled: false,
    listening_events_enabled: false,
  });

  assert.deepEqual(normalizePreflightFeatureFlags('leak'), {
    recommendation_ai_enabled: false,
    listening_events_enabled: false,
  });
});

test('summarizeUsableEvents counts usable rows, distinct users, songs, and pairs', () => {
  const input = buildInput({
    events: [
      buildEvent(USER_A, SONG_1, 1),
      buildEvent(USER_A, SONG_1, 2),
      buildEvent(USER_B, SONG_2, 3),
      buildEvent(UNKNOWN_USER, SONG_1, 4),
      buildEvent(USER_A, UNKNOWN_SONG, 5),
      buildEvent(USER_C, SONG_1, 6),
    ],
  });
  assert.deepEqual(summarizeUsableEvents(input), {
    usable_events: 3,
    distinct_users: 2,
    distinct_songs: 2,
    interaction_pairs: 2,
  });
});

test('summarizeUsableEvents is safe for empty and invalid input', () => {
  const empty = { usable_events: 0, distinct_users: 0, distinct_songs: 0, interaction_pairs: 0 };
  assert.deepEqual(summarizeUsableEvents(buildInput()), empty);
  assert.deepEqual(summarizeUsableEvents(null), empty);
  assert.deepEqual(summarizeUsableEvents({ songs: null, users: null, events: null }), empty);
});

test('readiness: zero listening events is insufficient with NO_LISTENING_EVENTS', () => {
  assert.deepEqual(
    evaluateRecommendationReadiness({
      listeningEvents: 0,
      catalogSongs: 26,
      usableEvents: 0,
      distinctUsers: 0,
      distinctSongs: 0,
      interactionPairs: 0,
    }),
    { state: 'insufficient', reason: 'NO_LISTENING_EVENTS' },
  );
});

test('readiness: empty catalog is insufficient with INSUFFICIENT_SONGS', () => {
  assert.deepEqual(
    evaluateRecommendationReadiness({
      listeningEvents: 10,
      catalogSongs: 0,
      usableEvents: 0,
      distinctUsers: 0,
      distinctSongs: 0,
      interactionPairs: 0,
    }),
    { state: 'insufficient', reason: 'INSUFFICIENT_SONGS' },
  );
});

test('readiness: no usable events is insufficient with INSUFFICIENT_TRAINING_DATA', () => {
  assert.deepEqual(
    evaluateRecommendationReadiness({
      listeningEvents: 10,
      catalogSongs: 5,
      usableEvents: 0,
      distinctUsers: 0,
      distinctSongs: 0,
      interactionPairs: 0,
    }),
    { state: 'insufficient', reason: 'INSUFFICIENT_TRAINING_DATA' },
  );
});

test('readiness: user, song, and interaction minimums reuse existing pipeline rules', () => {
  assert.deepEqual(
    evaluateRecommendationReadiness({
      listeningEvents: 5,
      catalogSongs: 5,
      usableEvents: 3,
      distinctUsers: 1,
      distinctSongs: 5,
      interactionPairs: 3,
    }),
    { state: 'insufficient', reason: 'INSUFFICIENT_USERS' },
  );

  assert.deepEqual(
    evaluateRecommendationReadiness({
      listeningEvents: 5,
      catalogSongs: 5,
      usableEvents: 3,
      distinctUsers: 3,
      distinctSongs: 1,
      interactionPairs: 3,
    }),
    { state: 'insufficient', reason: 'INSUFFICIENT_SONGS' },
  );

  assert.deepEqual(
    evaluateRecommendationReadiness({
      listeningEvents: 5,
      catalogSongs: 5,
      usableEvents: 1,
      distinctUsers: 3,
      distinctSongs: 3,
      interactionPairs: 1,
    }),
    { state: 'insufficient', reason: 'INSUFFICIENT_INTERACTIONS' },
  );
});

test('readiness: ready when every existing sufficiency rule passes', () => {
  assert.deepEqual(
    evaluateRecommendationReadiness({
      listeningEvents: 6,
      catalogSongs: 26,
      usableEvents: 6,
      distinctUsers: 3,
      distinctSongs: 4,
      interactionPairs: 5,
    }),
    { state: 'ready', reason: null },
  );
});

test('readiness: missing arguments never throw and stay insufficient', () => {
  assert.deepEqual(evaluateRecommendationReadiness(), {
    state: 'insufficient',
    reason: 'NO_LISTENING_EVENTS',
  });
});

test('factory rejects invalid collaborators', () => {
  assert.throws(
    () => createAdminRecommendationPreflightService({ trainingInputService: {} }),
    AdminRecommendationPreflightValidationError,
  );
  assert.throws(
    () => createAdminRecommendationPreflightService({ ListeningEventModel: {} }),
    AdminRecommendationPreflightValidationError,
  );
  assert.throws(
    () => createAdminRecommendationPreflightService({ EvaluationRunModel: {} }),
    AdminRecommendationPreflightValidationError,
  );
  assert.throws(
    () => createAdminRecommendationPreflightService({ SnapshotModel: {} }),
    AdminRecommendationPreflightValidationError,
  );
  assert.throws(
    () => createAdminRecommendationPreflightService({ readFeatureFlags: null }),
    AdminRecommendationPreflightValidationError,
  );
});

test('service returns only aggregate non-sensitive fields', async () => {
  const { service } = createService({
    listeningEvents: 6,
    evaluationRuns: 2,
    snapshots: 4,
    input: buildInput({
      events: [
        buildEvent(USER_A, SONG_1, 1),
        buildEvent(USER_A, SONG_1, 2),
        buildEvent(USER_B, SONG_2, 3),
        buildEvent(UNKNOWN_USER, SONG_1, 4),
      ],
    }),
  });

  const data = await service.getRecommendationPreflight();

  assert.deepEqual(Object.keys(data).sort(), [
    'catalog',
    'feature_flags',
    'persisted',
    'source',
    'sufficiency',
    'telemetry',
  ]);
  assert.deepEqual(Object.keys(data.feature_flags).sort(), [
    'listening_events_enabled',
    'recommendation_ai_enabled',
  ]);
  assert.deepEqual(Object.keys(data.catalog), ['songs']);
  assert.deepEqual(Object.keys(data.telemetry).sort(), [
    'distinct_songs',
    'distinct_users',
    'listening_events',
    'usable_events',
  ]);
  assert.deepEqual(Object.keys(data.persisted).sort(), [
    'evaluation_runs',
    'snapshots',
  ]);
  assert.deepEqual(Object.keys(data.sufficiency).sort(), ['reason', 'state']);
  assert.equal(data.source, 'recommendation-preflight');
});

test('service response contains no secrets, ids, emails, or raw rows', async () => {
  const { service } = createService({
    listeningEvents: 4,
    evaluationRuns: 1,
    snapshots: 1,
    input: buildInput({
      events: [buildEvent(USER_A, SONG_1, 1), buildEvent(USER_B, SONG_2, 2)],
    }),
  });

  const data = await service.getRecommendationPreflight();
  const serialized = JSON.stringify(data);

  for (const token of [
    'mongodb://',
    'MONGO_URI',
    'JWT',
    'password',
    'secret',
    'token',
    'email',
    '@',
    USER_A,
    USER_B,
    SONG_1,
    SONG_2,
    'evt-',
    'session-',
  ]) {
    assert.equal(serialized.includes(token), false, `response leaked: ${token}`);
  }
  assert.equal(/[a-f0-9]{24}/i.test(serialized), false, 'response leaked a raw id');
});

test('service counts telemetry with usable events and distinct users/songs', async () => {
  const { service } = createService({
    listeningEvents: 6,
    input: buildInput({
      events: [
        buildEvent(USER_A, SONG_1, 1),
        buildEvent(USER_A, SONG_1, 2),
        buildEvent(USER_B, SONG_2, 3),
        buildEvent(UNKNOWN_USER, SONG_1, 4),
        buildEvent(USER_A, UNKNOWN_SONG, 5),
      ],
    }),
  });

  const data = await service.getRecommendationPreflight();

  assert.equal(data.telemetry.listening_events, 6);
  assert.equal(data.telemetry.usable_events, 3);
  assert.equal(data.telemetry.distinct_users, 2);
  assert.equal(data.telemetry.distinct_songs, 2);
  assert.equal(data.catalog.songs, 2);
  assert.equal(data.persisted.evaluation_runs, 0);
  assert.equal(data.persisted.snapshots, 0);
  assert.equal(data.sufficiency.state, 'ready');
  assert.equal(data.sufficiency.reason, null);
});

test('service reports zero telemetry and NO_LISTENING_EVENTS for an empty event store', async () => {
  const { service } = createService({ listeningEvents: 0 });

  const data = await service.getRecommendationPreflight();

  assert.deepEqual(data.telemetry, {
    listening_events: 0,
    usable_events: 0,
    distinct_users: 0,
    distinct_songs: 0,
  });
  assert.deepEqual(data.sufficiency, {
    state: 'insufficient',
    reason: 'NO_LISTENING_EVENTS',
  });
});

test('service reports persisted evaluation run and snapshot counts', async () => {
  const { service } = createService({
    listeningEvents: 8,
    evaluationRuns: 3,
    snapshots: 12,
    input: buildInput({
      events: [
        buildEvent(USER_A, SONG_1, 1),
        buildEvent(USER_B, SONG_2, 2),
        buildEvent(USER_A, SONG_2, 3),
      ],
    }),
  });

  const data = await service.getRecommendationPreflight();

  assert.equal(data.persisted.evaluation_runs, 3);
  assert.equal(data.persisted.snapshots, 12);
});

test('service normalizes injected feature flags to booleans', async () => {
  const { service } = createService({
    featureFlags: { recommendation_ai_enabled: 'true', listening_events_enabled: 'false' },
  });

  const data = await service.getRecommendationPreflight();

  assert.equal(data.feature_flags.recommendation_ai_enabled, true);
  assert.equal(data.feature_flags.listening_events_enabled, false);
  assert.equal(typeof data.feature_flags.recommendation_ai_enabled, 'boolean');
  assert.equal(typeof data.feature_flags.listening_events_enabled, 'boolean');
});

test('service treats an empty catalog limit error as zero songs without failing', async () => {
  const { service } = createService({
    listeningEvents: 4,
    inputError: new RecommendationTrainingInputLimitError('songs must be non-empty'),
  });

  const data = await service.getRecommendationPreflight();

  assert.equal(data.catalog.songs, 0);
  assert.equal(data.telemetry.usable_events, 0);
  assert.equal(data.sufficiency.state, 'insufficient');
});

test('service maps unexpected input failures to a fixed read error', async () => {
  const { service } = createService({
    inputError: new Error('mongodb://user:pass@host'),
  });

  await assert.rejects(
    () => service.getRecommendationPreflight(),
    (error) => {
      assert.equal(error instanceof AdminRecommendationPreflightReadError, true);
      assert.equal(
        error.message,
        ADMIN_RECOMMENDATION_PREFLIGHT_HTTP_MESSAGES.failed,
      );
      assert.equal(error.message.includes('mongodb'), false);
      return true;
    },
  );
});

test('service maps model read failures to a fixed read error', async () => {
  const failing = createAdminRecommendationPreflightService({
    trainingInputService: { async collectRetrainingInput() { return buildInput(); } },
    ListeningEventModel: {
      async countDocuments() {
        throw new Error('mongodb://leak');
      },
    },
    EvaluationRunModel: { async countDocuments() { return 0; } },
    SnapshotModel: { async countDocuments() { return 0; } },
    readFeatureFlags: () => ({}),
  });

  await assert.rejects(
    () => failing.getRecommendationPreflight(),
    (error) =>
      error instanceof AdminRecommendationPreflightReadError &&
      error.message === ADMIN_RECOMMENDATION_PREFLIGHT_HTTP_MESSAGES.failed,
  );
});

test('service performs only read calls (countDocuments + collectRetrainingInput)', async () => {
  const { service, calls } = createService({
    listeningEvents: 2,
    evaluationRuns: 1,
    snapshots: 1,
  });

  await service.getRecommendationPreflight();

  assert.deepEqual(calls.sort(), [
    'collectRetrainingInput',
    'evaluationruns',
    'listeningevents',
    'snapshots',
  ]);
});

test('service issues one read per source and never repeats counts', async () => {
  const { service, calls } = createService({ listeningEvents: 1 });
  await service.getRecommendationPreflight();
  assert.equal(calls.filter((name) => name === 'listeningevents').length, 1);
  assert.equal(calls.filter((name) => name === 'evaluationruns').length, 1);
  assert.equal(calls.filter((name) => name === 'snapshots').length, 1);
  assert.equal(
    calls.filter((name) => name === 'collectRetrainingInput').length,
    1,
  );
});

test('service source contains no write, retraining, or secret operations', () => {
  const source = readSource('./adminRecommendationPreflightService.js');
  for (const token of [
    'child_process',
    'spawn',
    'python',
    'runRecommendationRetraining',
    'recommendationPythonRunner',
    'upsert',
    '.updateOne',
    '.updateMany',
    '.deleteOne',
    '.deleteMany',
    '.findOneAndUpdate',
    '.insert',
    'save(',
    'console.log',
    'MONGO_URI',
    'process.env',
    'jsonwebtoken',
    'Bearer',
  ]) {
    assert.equal(source.includes(token), false, `service source has: ${token}`);
  }
});
