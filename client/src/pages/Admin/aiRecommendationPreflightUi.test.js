import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMIN_RECOMMENDATION_PREFLIGHT_STATES } from '../../services/adminRecommendationPreflight.js';
import {
  ADMIN_AI_PREFLIGHT_MESSAGES,
  ADMIN_AI_PREFLIGHT_REASON_MESSAGES,
  ADMIN_AI_PREFLIGHT_VIEWS,
  buildPreflightCards,
  formatPreflightCount,
  formatPreflightFlag,
  getPreflightSufficiencyMessage,
  selectAdminRecommendationPreflightView,
} from './aiRecommendationPreflightUi.js';

const READY_DATA = () => ({
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
});

test('ui: view vocabulary is exact', () => {
  assert.deepEqual(Object.values(ADMIN_AI_PREFLIGHT_VIEWS), [
    'loading',
    'ready',
    'error',
  ]);
});

test('ui: view selector maps every client state', () => {
  assert.equal(
    selectAdminRecommendationPreflightView(
      ADMIN_RECOMMENDATION_PREFLIGHT_STATES.IDLE,
    ),
    ADMIN_AI_PREFLIGHT_VIEWS.LOADING,
  );
  assert.equal(
    selectAdminRecommendationPreflightView(
      ADMIN_RECOMMENDATION_PREFLIGHT_STATES.LOADING,
    ),
    ADMIN_AI_PREFLIGHT_VIEWS.LOADING,
  );
  assert.equal(
    selectAdminRecommendationPreflightView(
      ADMIN_RECOMMENDATION_PREFLIGHT_STATES.READY,
    ),
    ADMIN_AI_PREFLIGHT_VIEWS.READY,
  );
  assert.equal(
    selectAdminRecommendationPreflightView(
      ADMIN_RECOMMENDATION_PREFLIGHT_STATES.ERROR,
    ),
    ADMIN_AI_PREFLIGHT_VIEWS.ERROR,
  );
});

test('ui: view selector throws on unknown states', () => {
  for (const state of ['unknown', null, undefined, 0, 'READY', {}]) {
    assert.throws(
      () => selectAdminRecommendationPreflightView(state),
      /invalid training readiness state/,
    );
  }
});

test('ui: required messages are exact', () => {
  assert.equal(ADMIN_AI_PREFLIGHT_MESSAGES.LOADING, 'Loading training readiness.');
  assert.equal(ADMIN_AI_PREFLIGHT_MESSAGES.ERROR, 'Unable to load training readiness.');
  assert.equal(ADMIN_AI_PREFLIGHT_MESSAGES.RETRY, 'Refresh Status');
  assert.equal(
    ADMIN_AI_PREFLIGHT_MESSAGES.READY,
    'Training data meets the minimum readiness thresholds.',
  );
  assert.equal(ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED, 'Not recorded');
  assert.equal(ADMIN_AI_PREFLIGHT_MESSAGES.ENABLED, 'Enabled');
  assert.equal(ADMIN_AI_PREFLIGHT_MESSAGES.DISABLED, 'Disabled');
});

test('ui: readiness reason messages cover every server reason', () => {
  assert.deepEqual(Object.keys(ADMIN_AI_PREFLIGHT_REASON_MESSAGES), [
    'NO_LISTENING_EVENTS',
    'INSUFFICIENT_SONGS',
    'INSUFFICIENT_TRAINING_DATA',
    'INSUFFICIENT_USERS',
    'INSUFFICIENT_INTERACTIONS',
  ]);
  for (const message of Object.values(ADMIN_AI_PREFLIGHT_REASON_MESSAGES)) {
    assert.equal(typeof message, 'string');
    assert.equal(message.length > 0, true);
    assert.equal(/retrain/i.test(message), false);
  }
});

test('ui: sufficiency message for a ready payload', () => {
  assert.equal(
    getPreflightSufficiencyMessage(READY_DATA()),
    ADMIN_AI_PREFLIGHT_MESSAGES.READY,
  );
});

test('ui: sufficiency message for every insufficient reason', () => {
  for (const reason of Object.keys(ADMIN_AI_PREFLIGHT_REASON_MESSAGES)) {
    const data = READY_DATA();
    data.sufficiency = { state: 'insufficient', reason };
    assert.equal(
      getPreflightSufficiencyMessage(data),
      ADMIN_AI_PREFLIGHT_REASON_MESSAGES[reason],
    );
  }
});

test('ui: sufficiency message falls back to not recorded', () => {
  assert.equal(
    getPreflightSufficiencyMessage(null),
    ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED,
  );
  assert.equal(
    getPreflightSufficiencyMessage(undefined),
    ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED,
  );
  assert.equal(
    getPreflightSufficiencyMessage({}),
    ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED,
  );
  assert.equal(
    getPreflightSufficiencyMessage({ sufficiency: null }),
    ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED,
  );
  const unknown = READY_DATA();
  unknown.sufficiency = { state: 'insufficient', reason: 'SOMETHING_ELSE' };
  assert.equal(
    getPreflightSufficiencyMessage(unknown),
    ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED,
  );
});

test('ui: count formatting', () => {
  assert.equal(formatPreflightCount(0), '0');
  assert.equal(formatPreflightCount(26), '26');
  assert.equal(formatPreflightCount(1.9), '1');
  assert.equal(formatPreflightCount(null), ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED);
  assert.equal(
    formatPreflightCount(undefined),
    ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED,
  );
  assert.equal(formatPreflightCount('7'), ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED);
  assert.equal(
    formatPreflightCount(Number.POSITIVE_INFINITY),
    ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED,
  );
});

test('ui: flag formatting', () => {
  assert.equal(formatPreflightFlag(true), ADMIN_AI_PREFLIGHT_MESSAGES.ENABLED);
  assert.equal(formatPreflightFlag(false), ADMIN_AI_PREFLIGHT_MESSAGES.DISABLED);
  assert.equal(formatPreflightFlag(undefined), ADMIN_AI_PREFLIGHT_MESSAGES.DISABLED);
  assert.equal(formatPreflightFlag('true'), ADMIN_AI_PREFLIGHT_MESSAGES.DISABLED);
});

test('ui: cards cover flags, counts, and persisted totals in order', () => {
  const cards = buildPreflightCards(READY_DATA());
  assert.deepEqual(
    cards.map((card) => card.key),
    [
      'ai_mode',
      'listening_events_capture',
      'catalog_songs',
      'listening_events',
      'usable_events',
      'distinct_users',
      'distinct_songs',
      'evaluation_runs',
      'snapshots',
    ],
  );
  assert.deepEqual(
    cards.map((card) => card.label),
    [
      'AI Recommendation',
      'Listening Events Capture',
      'Catalog Songs',
      'Listening Events',
      'Usable Events',
      'Distinct Listeners',
      'Distinct Songs Played',
      'Evaluation Runs',
      'Recommendation Snapshots',
    ],
  );
  assert.deepEqual(
    cards.map((card) => card.formatted),
    [
      'Enabled',
      'Disabled',
      '26',
      '1024',
      '900',
      '40',
      '20',
      '3',
      '5',
    ],
  );
  assert.equal(
    cards.some((card) => /retrain/i.test(card.label + card.formatted)),
    false,
  );
});

test('ui: cards are empty without a complete payload', () => {
  assert.deepEqual(buildPreflightCards(null), []);
  assert.deepEqual(buildPreflightCards(undefined), []);
  assert.deepEqual(buildPreflightCards({}), []);
  assert.deepEqual(
    buildPreflightCards({
      feature_flags: { recommendation_ai_enabled: true, listening_events_enabled: true },
    }),
    [],
  );
  const partial = READY_DATA();
  delete partial.persisted;
  assert.deepEqual(buildPreflightCards(partial), []);
});
