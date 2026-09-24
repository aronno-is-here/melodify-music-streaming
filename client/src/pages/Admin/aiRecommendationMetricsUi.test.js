import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_AI_DASHBOARD_MESSAGES,
  ADMIN_AI_DASHBOARD_VIEWS,
  buildMetricCards,
  buildRunMetaCards,
  buildSummaryCards,
  formatArtifactVersion,
  formatEvaluationDate,
  formatRecommendationMetric,
  formatSummaryCount,
  getMetaDisplayLabel,
  getMetricDisplayLabel,
  getPipelineStageLabel,
  getPipelineStageOptions,
  getSummaryDisplayLabel,
  selectAdminRecommendationDashboardView,
} from './aiRecommendationMetricsUi.js';

// ============================================================
// VIEW SELECTION
// ============================================================

test('view: idle maps to loading', () => {
  assert.equal(selectAdminRecommendationDashboardView('idle'), ADMIN_AI_DASHBOARD_VIEWS.LOADING);
});

test('view: loading maps to loading', () => {
  assert.equal(selectAdminRecommendationDashboardView('loading'), ADMIN_AI_DASHBOARD_VIEWS.LOADING);
});

test('view: ready maps to ready', () => {
  assert.equal(selectAdminRecommendationDashboardView('ready'), ADMIN_AI_DASHBOARD_VIEWS.READY);
});

test('view: no-runs maps to no-runs', () => {
  assert.equal(selectAdminRecommendationDashboardView('no-runs'), ADMIN_AI_DASHBOARD_VIEWS.NO_RUNS);
});

test('view: error maps to error', () => {
  assert.equal(selectAdminRecommendationDashboardView('error'), ADMIN_AI_DASHBOARD_VIEWS.ERROR);
});

test('view: unknown state throws', () => {
  assert.throws(() => selectAdminRecommendationDashboardView('best'), /invalid recommendation metrics state/);
  assert.throws(() => selectAdminRecommendationDashboardView(undefined), /invalid recommendation metrics state/);
  assert.throws(() => selectAdminRecommendationDashboardView(''), /invalid recommendation metrics state/);
});

test('view: messages are exact strings', () => {
  assert.equal(ADMIN_AI_DASHBOARD_MESSAGES.LOADING, 'Loading recommendation metrics.');
  assert.equal(
    ADMIN_AI_DASHBOARD_MESSAGES.NO_RUNS,
    'No persisted evaluation run is available for this pipeline stage yet.',
  );
  assert.equal(ADMIN_AI_DASHBOARD_MESSAGES.ERROR, 'Unable to load recommendation metrics.');
  assert.equal(ADMIN_AI_DASHBOARD_MESSAGES.RETRY, 'Retry');
  assert.equal(ADMIN_AI_DASHBOARD_MESSAGES.ARTIFACT_VERSION_MISSING, 'Not recorded');
  assert.equal(ADMIN_AI_DASHBOARD_MESSAGES.EVALUATED_AT_MISSING, 'Not available');
});

test('view: no overall or winner language in messages', () => {
  const combined = JSON.stringify(ADMIN_AI_DASHBOARD_MESSAGES);
  for (const token of ['overall', 'quality', 'winner', 'best', 'grade', 'tier']) {
    assert.equal(combined.toLowerCase().includes(token), false, token);
  }
});

// ============================================================
// PIPELINE STAGE LABELS
// ============================================================

test('stage label: policy is Policy', () => {
  assert.equal(getPipelineStageLabel('policy'), 'Policy');
});

test('stage label: hybrid is Hybrid', () => {
  assert.equal(getPipelineStageLabel('hybrid'), 'Hybrid');
});

test('stage label: collaborative is Collaborative', () => {
  assert.equal(getPipelineStageLabel('collaborative'), 'Collaborative');
});

test('stage label: unknown returns empty string', () => {
  assert.equal(getPipelineStageLabel('best'), '');
  assert.equal(getPipelineStageLabel(undefined), '');
});

test('stage options: three options in policy/hybrid/collaborative order', () => {
  assert.deepEqual(getPipelineStageOptions(), [
    { value: 'policy', label: 'Policy' },
    { value: 'hybrid', label: 'Hybrid' },
    { value: 'collaborative', label: 'Collaborative' },
  ]);
});

// ============================================================
// METRIC FORMATTING
// ============================================================

test('metric format: 0 becomes 0.00%', () => {
  assert.equal(formatRecommendationMetric(0), '0.00%');
});

test('metric format: 1 becomes 100.00%', () => {
  assert.equal(formatRecommendationMetric(1), '100.00%');
});

test('metric format: 0.1234 becomes 12.34%', () => {
  assert.equal(formatRecommendationMetric(0.1234), '12.34%');
});

test('metric format: 0.8241 becomes 82.41%', () => {
  assert.equal(formatRecommendationMetric(0.8241), '82.41%');
});

test('metric format: 0.5 becomes 50.00%', () => {
  assert.equal(formatRecommendationMetric(0.5), '50.00%');
});

test('metric format: clamps out-of-range presentation inputs', () => {
  assert.equal(formatRecommendationMetric(-1), '0.00%');
  assert.equal(formatRecommendationMetric(2), '100.00%');
});

test('metric format: non-finite returns empty string', () => {
  assert.equal(formatRecommendationMetric(NaN), '');
  assert.equal(formatRecommendationMetric(Infinity), '');
  assert.equal(formatRecommendationMetric('0.5'), '');
  assert.equal(formatRecommendationMetric(null), '');
  assert.equal(formatRecommendationMetric(undefined), '');
});

// ============================================================
// SUMMARY FORMATTING
// ============================================================

test('summary format: integer stays integer string', () => {
  assert.equal(formatSummaryCount(0), '0');
  assert.equal(formatSummaryCount(42), '42');
  assert.equal(formatSummaryCount(1000), '1000');
});

test('summary format: truncates non-integers for display only', () => {
  assert.equal(formatSummaryCount(10.7), '10');
});

test('summary format: non-finite returns empty string', () => {
  assert.equal(formatSummaryCount(NaN), '');
  assert.equal(formatSummaryCount('10'), '');
  assert.equal(formatSummaryCount(null), '');
});

// ============================================================
// DATE / ARTIFACT
// ============================================================

test('date: valid ISO string formats via Intl.DateTimeFormat', () => {
  const formatted = formatEvaluationDate('2026-09-15T12:00:00.000Z');
  assert.equal(typeof formatted, 'string');
  assert.ok(formatted.length > 0);
  assert.notEqual(formatted, ADMIN_AI_DASHBOARD_MESSAGES.EVALUATED_AT_MISSING);
  assert.ok(formatted.includes('2026'));
});

test('date: invalid or missing returns Not available', () => {
  for (const value of ['', 'nope', null, undefined, 42]) {
    assert.equal(
      formatEvaluationDate(value),
      ADMIN_AI_DASHBOARD_MESSAGES.EVALUATED_AT_MISSING,
      String(value),
    );
  }
});

test('artifact: null or missing returns Not recorded', () => {
  assert.equal(formatArtifactVersion(null), ADMIN_AI_DASHBOARD_MESSAGES.ARTIFACT_VERSION_MISSING);
  assert.equal(formatArtifactVersion(undefined), ADMIN_AI_DASHBOARD_MESSAGES.ARTIFACT_VERSION_MISSING);
  assert.equal(formatArtifactVersion(''), ADMIN_AI_DASHBOARD_MESSAGES.ARTIFACT_VERSION_MISSING);
  assert.equal(formatArtifactVersion(42), ADMIN_AI_DASHBOARD_MESSAGES.ARTIFACT_VERSION_MISSING);
});

test('artifact: string value preserved', () => {
  assert.equal(formatArtifactVersion('v1.2.3'), 'v1.2.3');
});

// ============================================================
// DISPLAY LABELS
// ============================================================

test('metric labels: exact ten labels', () => {
  assert.equal(getMetricDisplayLabel('precision_at_5'), 'Precision@5');
  assert.equal(getMetricDisplayLabel('precision_at_10'), 'Precision@10');
  assert.equal(getMetricDisplayLabel('recall_at_5'), 'Recall@5');
  assert.equal(getMetricDisplayLabel('recall_at_10'), 'Recall@10');
  assert.equal(getMetricDisplayLabel('ndcg_at_5'), 'NDCG@5');
  assert.equal(getMetricDisplayLabel('ndcg_at_10'), 'NDCG@10');
  assert.equal(getMetricDisplayLabel('map_at_10'), 'MAP@10');
  assert.equal(getMetricDisplayLabel('hit_rate_at_10'), 'Hit Rate@10');
  assert.equal(getMetricDisplayLabel('catalog_coverage'), 'Catalog Coverage');
  assert.equal(getMetricDisplayLabel('diversity'), 'Diversity');
});

test('metric labels: unknown key returns empty string', () => {
  assert.equal(getMetricDisplayLabel('overall_score'), '');
  assert.equal(getMetricDisplayLabel('winner'), '');
  assert.equal(getMetricDisplayLabel('quality'), '');
});

test('summary labels: exact seven labels', () => {
  assert.equal(getSummaryDisplayLabel('evaluated_user_count'), 'Evaluated Users');
  assert.equal(getSummaryDisplayLabel('recommendation_user_count'), 'Recommendation Users');
  assert.equal(getSummaryDisplayLabel('relevance_user_count'), 'Relevance Users');
  assert.equal(getSummaryDisplayLabel('catalog_size'), 'Catalog Size');
  assert.equal(getSummaryDisplayLabel('unique_recommended_at_10'), 'Unique Recommended @10');
  assert.equal(getSummaryDisplayLabel('diversity_evaluable_user_count'), 'Diversity-Evaluable Users');
  assert.equal(getSummaryDisplayLabel('diversity_pair_count'), 'Diversity Pair Count');
});

test('summary labels: unknown key returns empty string', () => {
  assert.equal(getSummaryDisplayLabel('overall_score'), '');
});

test('meta labels: four keys', () => {
  assert.equal(getMetaDisplayLabel('pipeline_stage'), 'Pipeline Stage');
  assert.equal(getMetaDisplayLabel('run_id'), 'Run ID');
  assert.equal(getMetaDisplayLabel('artifact_version'), 'Artifact Version');
  assert.equal(getMetaDisplayLabel('evaluated_at'), 'Evaluated At');
  assert.equal(getMetaDisplayLabel('dataset'), '');
});

// ============================================================
// CARD BUILDERS
// ============================================================

const VALID_METRICS = {
  precision_at_5: 0.8,
  precision_at_10: 0.7,
  recall_at_5: 0.6,
  recall_at_10: 0.5,
  ndcg_at_5: 0.75,
  ndcg_at_10: 0.65,
  map_at_10: 0.55,
  hit_rate_at_10: 0.9,
  catalog_coverage: 0.4,
  diversity: 0.3,
};

const VALID_SUMMARY = {
  evaluated_user_count: 10,
  recommendation_user_count: 15,
  relevance_user_count: 12,
  catalog_size: 100,
  unique_recommended_at_10: 80,
  diversity_evaluable_user_count: 8,
  diversity_pair_count: 36,
};

test('metric cards: ten cards in fixed key order', () => {
  const cards = buildMetricCards(VALID_METRICS);
  assert.equal(cards.length, 10);
  assert.deepEqual(cards.map((c) => c.key), [
    'precision_at_5',
    'precision_at_10',
    'recall_at_5',
    'recall_at_10',
    'ndcg_at_5',
    'ndcg_at_10',
    'map_at_10',
    'hit_rate_at_10',
    'catalog_coverage',
    'diversity',
  ]);
});

test('metric cards: formatted percent and raw value present', () => {
  const cards = buildMetricCards(VALID_METRICS);
  const first = cards[0];
  assert.equal(first.label, 'Precision@5');
  assert.equal(first.formatted, '80.00%');
  assert.equal(first.value, 0.8);
});

test('metric cards: null metrics returns empty array', () => {
  assert.deepEqual(buildMetricCards(null), []);
  assert.deepEqual(buildMetricCards(undefined), []);
  assert.deepEqual(buildMetricCards('x'), []);
});

test('metric cards: no derived ratio fields', () => {
  const cards = buildMetricCards(VALID_METRICS);
  for (const card of cards) {
    assert.deepEqual(Object.keys(card).sort(), ['formatted', 'key', 'label', 'value']);
    assert.equal(Object.hasOwn(card, 'ratio'), false);
    assert.equal(Object.hasOwn(card, 'overall'), false);
    assert.equal(typeof card.value, 'number');
  }
});

test('summary cards: seven cards in fixed key order', () => {
  const cards = buildSummaryCards(VALID_SUMMARY);
  assert.equal(cards.length, 7);
  assert.deepEqual(cards.map((c) => c.key), [
    'evaluated_user_count',
    'recommendation_user_count',
    'relevance_user_count',
    'catalog_size',
    'unique_recommended_at_10',
    'diversity_evaluable_user_count',
    'diversity_pair_count',
  ]);
  assert.deepEqual(cards.map((c) => c.formatted), [
    '10',
    '15',
    '12',
    '100',
    '80',
    '8',
    '36',
  ]);
});

test('summary cards: null summary returns empty array', () => {
  assert.deepEqual(buildSummaryCards(null), []);
  assert.deepEqual(buildSummaryCards(undefined), []);
});

test('meta cards: four cards with stage label and formatted date', () => {
  const cards = buildRunMetaCards({
    run_id: 'run-1',
    pipeline_stage: 'policy',
    artifact_version: null,
    evaluated_at: '2026-09-15T12:00:00.000Z',
  });
  assert.equal(cards.length, 4);
  assert.equal(cards[0].value, 'Policy');
  assert.equal(cards[1].value, 'run-1');
  assert.equal(cards[2].value, 'Not recorded');
  assert.notEqual(cards[3].value, 'Not available');
});

test('meta cards: null latest returns empty array', () => {
  assert.deepEqual(buildRunMetaCards(null), []);
  assert.deepEqual(buildRunMetaCards(undefined), []);
});
