import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES,
  ADMIN_RECOMMENDATION_PREFLIGHT_PATH,
  ADMIN_RECOMMENDATION_PREFLIGHT_PAYLOAD_INVALID_MESSAGE,
  ADMIN_RECOMMENDATION_PREFLIGHT_REASONS,
  ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED_MESSAGE,
  ADMIN_RECOMMENDATION_PREFLIGHT_SOURCE,
  ADMIN_RECOMMENDATION_PREFLIGHT_STATES,
  ADMIN_RECOMMENDATION_PREFLIGHT_SUFFICIENCY_STATES,
  fetchAdminRecommendationPreflight,
  normalizeAdminRecommendationPreflightResponse,
} from './adminRecommendationPreflight.js';

const VALID_PAYLOAD = () => ({
  success: true,
  data: {
    source: 'recommendation-preflight',
    feature_flags: {
      recommendation_ai_enabled: true,
      listening_events_enabled: false,
    },
    catalog: { songs: 26 },
    telemetry: {
      listening_events: 1024,
      usable_events: 900,
      distinct_users: 40,
      distinct_songs: 20,
    },
    persisted: { evaluation_runs: 3, snapshots: 5 },
    sufficiency: { state: 'ready', reason: null },
  },
});

test('service: preflight path and source constants', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_PREFLIGHT_PATH,
    '/api/admin/recommendations/preflight',
  );
  assert.equal(ADMIN_RECOMMENDATION_PREFLIGHT_SOURCE, 'recommendation-preflight');
});

test('service: state, sufficiency, and reason vocabularies are frozen', () => {
  assert.deepEqual(Object.values(ADMIN_RECOMMENDATION_PREFLIGHT_STATES), [
    'idle',
    'loading',
    'ready',
    'error',
  ]);
  assert.deepEqual(
    [...ADMIN_RECOMMENDATION_PREFLIGHT_SUFFICIENCY_STATES],
    ['ready', 'insufficient'],
  );
  assert.deepEqual([...ADMIN_RECOMMENDATION_PREFLIGHT_REASONS], [
    'NO_LISTENING_EVENTS',
    'INSUFFICIENT_SONGS',
    'INSUFFICIENT_TRAINING_DATA',
    'INSUFFICIENT_USERS',
    'INSUFFICIENT_INTERACTIONS',
  ]);
  assert.equal(Object.isFrozen(ADMIN_RECOMMENDATION_PREFLIGHT_STATES), true);
  assert.equal(
    Object.isFrozen(ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES),
    true,
  );
});

test('service: error codes and fixed messages are exact', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES.REQUEST_FAILED,
    'ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES.PAYLOAD_INVALID,
    'ADMIN_RECOMMENDATION_PREFLIGHT_PAYLOAD_INVALID',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED_MESSAGE,
    'Failed to load training readiness.',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_PREFLIGHT_PAYLOAD_INVALID_MESSAGE,
    'Training readiness response was invalid.',
  );
});

test('service: valid payload normalizes to ready with whitelisted data', () => {
  const result = normalizeAdminRecommendationPreflightResponse(VALID_PAYLOAD());
  assert.equal(result.state, ADMIN_RECOMMENDATION_PREFLIGHT_STATES.READY);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, VALID_PAYLOAD().data);
});

test('service: extra keys inside data are stripped', () => {
  const payload = VALID_PAYLOAD();
  payload.data.connection_string = 'mongodb://leak';
  payload.data.sufficiency.debug = true;
  payload.data.telemetry.password = 'hunter2';

  const result = normalizeAdminRecommendationPreflightResponse(payload);
  assert.equal(result.state, ADMIN_RECOMMENDATION_PREFLIGHT_STATES.READY);
  assert.equal(result.data.connection_string, undefined);
  assert.equal('debug' in result.data.sufficiency, false);
  assert.equal('password' in result.data.telemetry, false);
});

test('service: success false classifies as request failed', () => {
  const result = normalizeAdminRecommendationPreflightResponse({
    success: false,
    error: 'nope',
  });
  assert.equal(result.state, ADMIN_RECOMMENDATION_PREFLIGHT_STATES.ERROR);
  assert.equal(result.data, null);
  assert.equal(
    result.error.code,
    ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES.REQUEST_FAILED,
  );
  assert.equal(
    result.error.message,
    ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED_MESSAGE,
  );
});

const invalidCases = [
  ['non-object payload', null],
  ['missing success flag', { data: VALID_PAYLOAD().data }],
  ['non-object data', { success: true, data: 'x' }],
  ['missing data', { success: true }],
  [
    'wrong source',
    { success: true, data: { ...VALID_PAYLOAD().data, source: 'other' } },
  ],
  [
    'missing source',
    { success: true, data: { ...VALID_PAYLOAD().data, source: undefined } },
  ],
  [
    'non-boolean ai flag',
    {
      success: true,
      data: {
        ...VALID_PAYLOAD().data,
        feature_flags: { recommendation_ai_enabled: 'true', listening_events_enabled: true },
      },
    },
  ],
  [
    'missing feature flags',
    { success: true, data: { ...VALID_PAYLOAD().data, feature_flags: undefined } },
  ],
  [
    'negative catalog count',
    {
      success: true,
      data: { ...VALID_PAYLOAD().data, catalog: { songs: -1 } },
    },
  ],
  [
    'fractional telemetry count',
    {
      success: true,
      data: {
        ...VALID_PAYLOAD().data,
        telemetry: { ...VALID_PAYLOAD().data.telemetry, usable_events: 1.5 },
      },
    },
  ],
  [
    'string persisted count',
    {
      success: true,
      data: {
        ...VALID_PAYLOAD().data,
        persisted: { evaluation_runs: '3', snapshots: 5 },
      },
    },
  ],
  [
    'unknown sufficiency state',
    {
      success: true,
      data: {
        ...VALID_PAYLOAD().data,
        sufficiency: { state: 'unknown', reason: null },
      },
    },
  ],
  [
    'ready payload with a reason',
    {
      success: true,
      data: {
        ...VALID_PAYLOAD().data,
        sufficiency: { state: 'ready', reason: 'INSUFFICIENT_USERS' },
      },
    },
  ],
  [
    'insufficient payload with unknown reason',
    {
      success: true,
      data: {
        ...VALID_PAYLOAD().data,
        sufficiency: { state: 'insufficient', reason: 'SOMETHING_ELSE' },
      },
    },
  ],
  [
    'insufficient payload with null reason',
    {
      success: true,
      data: {
        ...VALID_PAYLOAD().data,
        sufficiency: { state: 'insufficient', reason: null },
      },
    },
  ],
  [
    'non-object sufficiency',
    {
      success: true,
      data: { ...VALID_PAYLOAD().data, sufficiency: 'ready' },
    },
  ],
];

for (const [name, payload] of invalidCases) {
  test(`service: invalid payload classified as payload invalid — ${name}`, () => {
    const result = normalizeAdminRecommendationPreflightResponse(payload);
    assert.equal(result.state, ADMIN_RECOMMENDATION_PREFLIGHT_STATES.ERROR);
    assert.equal(result.data, null);
    assert.equal(
      result.error.code,
      ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES.PAYLOAD_INVALID,
    );
    assert.equal(
      result.error.message,
      ADMIN_RECOMMENDATION_PREFLIGHT_PAYLOAD_INVALID_MESSAGE,
    );
  });
}

test('service: insufficient payload with a known reason normalizes to ready', () => {
  const payload = VALID_PAYLOAD();
  payload.data.sufficiency = {
    state: 'insufficient',
    reason: 'NO_LISTENING_EVENTS',
  };
  const result = normalizeAdminRecommendationPreflightResponse(payload);
  assert.equal(result.state, ADMIN_RECOMMENDATION_PREFLIGHT_STATES.READY);
  assert.deepEqual(result.data.sufficiency, {
    state: 'insufficient',
    reason: 'NO_LISTENING_EVENTS',
  });
});

test('service: fetch without a client returns request failed', async () => {
  const result = await fetchAdminRecommendationPreflight();
  assert.equal(result.state, ADMIN_RECOMMENDATION_PREFLIGHT_STATES.ERROR);
  assert.equal(
    result.error.code,
    ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES.REQUEST_FAILED,
  );
});

test('service: fetch treats a thrown request as request failed', async () => {
  const result = await fetchAdminRecommendationPreflight({
    apiClient: {
      get: async () => {
        throw new Error('network down');
      },
    },
  });
  assert.equal(result.state, ADMIN_RECOMMENDATION_PREFLIGHT_STATES.ERROR);
  assert.equal(
    result.error.message,
    ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED_MESSAGE,
  );
});

test('service: fetch without get returns request failed', async () => {
  const result = await fetchAdminRecommendationPreflight({ apiClient: {} });
  assert.equal(result.state, ADMIN_RECOMMENDATION_PREFLIGHT_STATES.ERROR);
});

test('service: fetch performs one GET on the preflight path', async () => {
  const calls = [];
  const result = await fetchAdminRecommendationPreflight({
    apiClient: {
      get: async (path) => {
        calls.push(path);
        return VALID_PAYLOAD();
      },
    },
  });
  assert.deepEqual(calls, ['/api/admin/recommendations/preflight']);
  assert.equal(result.state, ADMIN_RECOMMENDATION_PREFLIGHT_STATES.READY);
});

test('service: fetch forwards the abort signal only when provided', async () => {
  const seen = [];
  const apiClient = {
    get: async (path, options) => {
      seen.push(options);
      return VALID_PAYLOAD();
    },
  };

  await fetchAdminRecommendationPreflight({ apiClient });
  assert.deepEqual(seen, [undefined]);

  const signal = { aborted: false };
  await fetchAdminRecommendationPreflight({ apiClient, signal });
  assert.equal(seen[1].signal, signal);
});

test('service: fetch does not retry after a failed request', async () => {
  let calls = 0;
  await fetchAdminRecommendationPreflight({
    apiClient: {
      get: async () => {
        calls += 1;
        throw new Error('boom');
      },
    },
  });
  assert.equal(calls, 1);
});
