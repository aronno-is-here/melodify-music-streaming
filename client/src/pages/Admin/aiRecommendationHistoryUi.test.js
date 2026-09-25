import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { ADMIN_RECOMMENDATION_HISTORY_STATES } from '../../services/adminRecommendationHistory.js';
import {
  ADMIN_AI_HISTORY_MESSAGES,
  ADMIN_AI_HISTORY_VIEWS,
  buildConfigurationCards,
  buildDatasetCards,
  formatConfigurationWeight,
  formatHistoryCount,
  formatOptionalConfigurationValue,
  selectAdminRecommendationHistoryView,
  selectHistoryRun,
} from './aiRecommendationHistoryUi.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const UI_SOURCE = readSource('./aiRecommendationHistoryUi.js');

const datasetFixture = () => ({
  raw_event_count: 100,
  train_event_count: 70,
  validation_event_count: 15,
  test_event_count: 15,
  unique_user_count: 5,
  unique_song_count: 8,
  session_count: 20,
  interaction_pair_count: 90,
  content_feature_count: 12,
});

const configurationFixture = () => ({
  random_seed: 42,
  algorithm: 'truncated-svd',
  requested_components: 32,
  effective_components: 16,
  collaborative_weight: 0.7,
  content_weight: 0.3,
  base_hybrid_policy_weight: 0.8,
  explicit_profile_policy_weight: 0.2,
  exploration_interval: 5,
});

const runFixture = (overrides = {}) => ({
  run_id: 'eval-1',
  pipeline_stage: 'policy',
  artifact_version: null,
  evaluated_at: '2026-09-15T12:00:00.000Z',
  metrics: {},
  summary: {},
  dataset: datasetFixture(),
  configuration: configurationFixture(),
  ...overrides,
});

// --- views and messages ---

test('1: history views cover idle/loading as loading and the three terminal states', () => {
  assert.equal(
    selectAdminRecommendationHistoryView(
      ADMIN_RECOMMENDATION_HISTORY_STATES.IDLE,
    ),
    'loading',
  );
  assert.equal(
    selectAdminRecommendationHistoryView(
      ADMIN_RECOMMENDATION_HISTORY_STATES.LOADING,
    ),
    'loading',
  );
  assert.equal(
    selectAdminRecommendationHistoryView(
      ADMIN_RECOMMENDATION_HISTORY_STATES.READY,
    ),
    'ready',
  );
  assert.equal(
    selectAdminRecommendationHistoryView(
      ADMIN_RECOMMENDATION_HISTORY_STATES.NO_RUNS,
    ),
    'no-runs',
  );
  assert.equal(
    selectAdminRecommendationHistoryView(
      ADMIN_RECOMMENDATION_HISTORY_STATES.ERROR,
    ),
    'error',
  );
});

test('2: unknown history state throws', () => {
  assert.throws(() => selectAdminRecommendationHistoryView('bogus'));
  assert.throws(() => selectAdminRecommendationHistoryView(undefined));
  assert.throws(() => selectAdminRecommendationHistoryView(null));
});

test('3: history messages are the exact required strings', () => {
  assert.equal(
    ADMIN_AI_HISTORY_MESSAGES.NO_RUNS,
    'No persisted evaluation history is available for this pipeline stage yet.',
  );
  assert.equal(
    ADMIN_AI_HISTORY_MESSAGES.ERROR,
    'Unable to load evaluation history.',
  );
  assert.equal(ADMIN_AI_HISTORY_MESSAGES.RETRY, 'Retry');
  assert.equal(ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING, 'Not recorded');
  assert.equal(
    ADMIN_AI_HISTORY_MESSAGES.ARTIFACT_VERSION_MISSING,
    'Not recorded',
  );
  assert.equal(ADMIN_AI_HISTORY_MESSAGES.EVALUATED_AT_MISSING, 'Not available');
  assert.deepEqual(Object.keys(ADMIN_AI_HISTORY_VIEWS).sort(), [
    'ERROR',
    'LOADING',
    'NO_RUNS',
    'READY',
  ]);
});

// --- formatters ---

test('4: formatHistoryCount renders non-negative integers as plain strings', () => {
  assert.equal(formatHistoryCount(0), '0');
  assert.equal(formatHistoryCount(100), '100');
  assert.equal(formatHistoryCount(1.9), '1');
});

test('5: formatHistoryCount rejects non-numbers', () => {
  for (const value of [NaN, Infinity, -Infinity, '5', null, undefined, {}]) {
    assert.equal(formatHistoryCount(value), '');
  }
});

test('6: formatOptionalConfigurationValue maps null/undefined to Not recorded', () => {
  assert.equal(
    formatOptionalConfigurationValue(null),
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
  assert.equal(
    formatOptionalConfigurationValue(undefined),
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
  assert.equal(formatOptionalConfigurationValue(42), '42');
  assert.equal(formatOptionalConfigurationValue('truncated-svd'), 'truncated-svd');
  assert.equal(
    formatOptionalConfigurationValue(NaN),
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
  assert.equal(
    formatOptionalConfigurationValue(''),
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
  assert.equal(
    formatOptionalConfigurationValue({}),
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
});

test('7: formatConfigurationWeight renders fixed two-decimal weights', () => {
  assert.equal(formatConfigurationWeight(0.7), '0.70');
  assert.equal(formatConfigurationWeight(0.3), '0.30');
  assert.equal(formatConfigurationWeight(1), '1.00');
  assert.equal(formatConfigurationWeight(0), '0.00');
  assert.equal(formatConfigurationWeight(0.123), '0.12');
});

test('8: formatConfigurationWeight maps null to Not recorded (never 0)', () => {
  assert.equal(
    formatConfigurationWeight(null),
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
  assert.equal(
    formatConfigurationWeight(undefined),
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
  assert.equal(
    formatConfigurationWeight(NaN),
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
});

// --- dataset cards ---

test('9: buildDatasetCards emits nine cards with the exact labels in order', () => {
  const cards = buildDatasetCards(runFixture());
  assert.equal(cards.length, 9);
  assert.deepEqual(
    cards.map((c) => c.label),
    [
      'Raw Events',
      'Train Events',
      'Validation Events',
      'Test Events',
      'Unique Users',
      'Unique Songs',
      'Sessions',
      'Interaction Pairs',
      'Content Features',
    ],
  );
  assert.equal(cards[0].key, 'raw_event_count');
  assert.equal(cards[0].formatted, '100');
  assert.equal(cards[2].formatted, '15');
});

test('10: buildDatasetCards renders integers without percent signs', () => {
  const cards = buildDatasetCards(runFixture());
  for (const card of cards) {
    assert.equal(card.formatted.includes('%'), false);
    assert.match(card.formatted, /^\d+$/);
  }
});

test('11: buildDatasetCards returns [] for invalid input', () => {
  for (const value of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(buildDatasetCards(value), []);
  }
  assert.deepEqual(buildDatasetCards(runFixture({ dataset: null })), []);
  assert.deepEqual(buildDatasetCards(runFixture({ dataset: undefined })), []);
});

test('12: buildDatasetCards does not mutate the input run', () => {
  const run = runFixture();
  const before = JSON.stringify(run.dataset);
  buildDatasetCards(run);
  assert.equal(JSON.stringify(run.dataset), before);
});

// --- configuration cards ---

test('13: buildConfigurationCards emits nine cards with the exact labels in order', () => {
  const cards = buildConfigurationCards(runFixture());
  assert.equal(cards.length, 9);
  assert.deepEqual(
    cards.map((c) => c.label),
    [
      'Random Seed',
      'Algorithm',
      'Requested Components',
      'Effective Components',
      'Collaborative Weight',
      'Content Weight',
      'Base Hybrid Policy Weight',
      'Explicit Profile Policy Weight',
      'Exploration Interval',
    ],
  );
});

test('14: weight configuration cards use fixed decimal formatting', () => {
  const cards = buildConfigurationCards(runFixture());
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));
  assert.equal(byKey.collaborative_weight.formatted, '0.70');
  assert.equal(byKey.content_weight.formatted, '0.30');
  assert.equal(byKey.base_hybrid_policy_weight.formatted, '0.80');
  assert.equal(byKey.explicit_profile_policy_weight.formatted, '0.20');
  for (const key of [
    'collaborative_weight',
    'content_weight',
    'base_hybrid_policy_weight',
    'explicit_profile_policy_weight',
  ]) {
    assert.equal(byKey[key].formatted.includes('%'), false);
  }
});

test('15: null optional configuration values render as Not recorded', () => {
  const cards = buildConfigurationCards(
    runFixture({ configuration: { random_seed: 7 } }),
  );
  const byKey = Object.fromEntries(cards.map((c) => [c.key, c]));
  assert.equal(byKey.random_seed.formatted, '7');
  assert.equal(
    byKey.algorithm.formatted,
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
  assert.equal(
    byKey.requested_components.formatted,
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
  assert.equal(
    byKey.collaborative_weight.formatted,
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
  assert.equal(
    byKey.exploration_interval.formatted,
    ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING,
  );
});

test('16: buildConfigurationCards returns [] for invalid input', () => {
  for (const value of [null, undefined, 'x', 42, []]) {
    assert.deepEqual(buildConfigurationCards(value), []);
  }
  assert.deepEqual(
    buildConfigurationCards(runFixture({ configuration: null })),
    [],
  );
});

test('17: buildConfigurationCards does not mutate the input run', () => {
  const run = runFixture();
  const before = JSON.stringify(run.configuration);
  buildConfigurationCards(run);
  assert.equal(JSON.stringify(run.configuration), before);
});

// --- selectHistoryRun ---

test('18: selectHistoryRun defaults to the first run when selection is null', () => {
  const runs = [runFixture({ run_id: 'a' }), runFixture({ run_id: 'b' })];
  assert.equal(selectHistoryRun(runs, null).run_id, 'a');
  assert.equal(selectHistoryRun(runs, undefined).run_id, 'a');
  assert.equal(selectHistoryRun(runs, '').run_id, 'a');
});

test('19: selectHistoryRun prefers a matching selected run_id', () => {
  const runs = [runFixture({ run_id: 'a' }), runFixture({ run_id: 'b' })];
  assert.equal(selectHistoryRun(runs, 'b').run_id, 'b');
});

test('20: selectHistoryRun falls back to first when selected id is missing', () => {
  const runs = [runFixture({ run_id: 'a' }), runFixture({ run_id: 'b' })];
  assert.equal(selectHistoryRun(runs, 'gone').run_id, 'a');
});

test('21: selectHistoryRun returns null for empty or invalid runs', () => {
  assert.equal(selectHistoryRun([], 'a'), null);
  assert.equal(selectHistoryRun(null, 'a'), null);
  assert.equal(selectHistoryRun(undefined, null), null);
  assert.equal(selectHistoryRun('x', null), null);
});

// --- source static safety ---

test('22: history UI helper has no network, polling, or write logic', () => {
  for (const token of [
    'fetch(',
    'api.get',
    'api.post',
    'axios',
    'XMLHttpRequest',
    'setInterval',
    'setTimeout',
    'Math.random',
    'retrain',
    'child_process',
    'payload_sha256',
    'overall_score',
    'quality_score',
    'winner',
    'best_model',
    'RECOMMENDATION_AI_ENABLED',
  ]) {
    assert.equal(UI_SOURCE.includes(token), false, token);
  }
});

test('23: history UI helper has no model judgment or percent weight labels', () => {
  for (const token of [
    'Overall Score',
    'Best ',
    'Winner',
    'importance',
    'optimal',
    '% importance',
  ]) {
    assert.equal(UI_SOURCE.includes(token), false, token);
  }
});
