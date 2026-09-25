import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE,
  ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES,
  ADMIN_RECOMMENDATION_METRICS_SOURCE,
  AdminRecommendationMetricsError,
  AdminRecommendationMetricsReadError,
  AdminRecommendationMetricsValidationError,
  createAdminRecommendationMetricsService,
} from './adminRecommendationMetricsService.js';
import {
  EVALUATION_METRIC_KEYS,
  EVALUATION_SUMMARY_KEYS,
  PIPELINE_STAGES,
} from '../models/RecommendationEvaluationRun.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const METRIC_KEYS = [...EVALUATION_METRIC_KEYS];
const SUMMARY_KEYS = [...EVALUATION_SUMMARY_KEYS];

const metricsFixture = () => ({
  precision_at_5: 0.4,
  precision_at_10: 0.35,
  recall_at_5: 0.5,
  recall_at_10: 0.6,
  ndcg_at_5: 0.45,
  ndcg_at_10: 0.55,
  map_at_10: 0.5,
  hit_rate_at_10: 0.7,
  catalog_coverage: 0.25,
  diversity: 0.8,
});

const summaryFixture = () => ({
  evaluated_user_count: 10,
  recommendation_user_count: 12,
  relevance_user_count: 10,
  catalog_size: 50,
  unique_recommended_at_10: 40,
  diversity_evaluable_user_count: 8,
  diversity_pair_count: 28,
});

const runFixture = (overrides = {}) => ({
  _id: '64b000000000000000000001',
  schema_version: 1,
  run_id: 'eval-2026-09-15-policy-1',
  pipeline_stage: 'policy',
  artifact_version: 'rel-1.0.0',
  evaluated_at: new Date('2026-09-15T12:00:00.000Z'),
  metrics: metricsFixture(),
  summary: summaryFixture(),
  dataset: {
    raw_event_count: 100,
    train_event_count: 70,
    validation_event_count: 15,
    test_event_count: 15,
    unique_user_count: 5,
    unique_song_count: 8,
    session_count: 20,
    interaction_pair_count: 90,
    content_feature_count: 12,
  },
  configuration: { random_seed: 42 },
  payload_sha256: 'a'.repeat(64),
  createdAt: '2026-09-15T12:00:01.000Z',
  updatedAt: '2026-09-15T12:00:01.000Z',
  ...overrides,
});

function createService({
  runs = [runFixture()],
  listError = null,
  listCalls = null,
} = {}) {
  const calls = listCalls ?? [];
  const service = createAdminRecommendationMetricsService({
    evaluationRunService: {
      async listEvaluationRuns(options) {
        calls.push(options);
        if (listError) throw listError;
        return typeof runs === 'function' ? runs(options) : runs;
      },
    },
  });
  return { service, calls };
}

// --- service constants and error hierarchy ---

test('1: default stage is policy and source is evaluation-history', () => {
  assert.equal(ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE, 'policy');
  assert.equal(ADMIN_RECOMMENDATION_METRICS_SOURCE, 'evaluation-history');
});

test('2: HTTP messages are the exact fixed strings', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES.invalidQuery,
    'invalid recommendation metrics query',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES.failed,
    'failed to load recommendation metrics',
  );
});

test('3: error classes extend AdminRecommendationMetricsError', () => {
  const validation = new AdminRecommendationMetricsValidationError('v');
  const read = new AdminRecommendationMetricsReadError('r');
  assert.ok(validation instanceof AdminRecommendationMetricsError);
  assert.ok(read instanceof AdminRecommendationMetricsError);
  assert.equal(validation.name, 'AdminRecommendationMetricsValidationError');
  assert.equal(read.name, 'AdminRecommendationMetricsReadError');
  assert.equal(
    new AdminRecommendationMetricsError('x').name,
    'AdminRecommendationMetricsError',
  );
});

// --- stage validation (defense-in-depth; route also validates) ---

test('4: invalid pipelineStage rejects before any list call', async () => {
  const { service, calls } = createService();
  for (const stage of [
    'Collaborative',
    'POLICY',
    ' policy',
    'policy ',
    'best',
    '',
    1,
    null,
    ['policy'],
    {},
  ]) {
    await assert.rejects(
      () => service.getLatestRecommendationMetrics({ pipelineStage: stage }),
      (error) => {
        assert.ok(error instanceof AdminRecommendationMetricsValidationError);
        assert.equal(
          error.message,
          'invalid recommendation metrics query',
        );
        return true;
      },
    );
  }
  assert.equal(calls.length, 0);
});

test('4b: explicit undefined pipelineStage falls back to the default policy stage', async () => {
  const { service, calls } = createService({ runs: [] });
  const result = await service.getLatestRecommendationMetrics({
    pipelineStage: undefined,
  });
  assert.equal(result.pipeline_stage, 'policy');
  assert.deepEqual(calls[0], { limit: 1, pipeline_stage: 'policy' });
});

test('5: every exact-lowercase stage is accepted', async () => {
  for (const stage of PIPELINE_STAGES) {
    const { service, calls } = createService({ runs: [] });
    const result = await service.getLatestRecommendationMetrics({
      pipelineStage: stage,
    });
    assert.equal(result.state, 'no-runs');
    assert.equal(result.pipeline_stage, stage);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { limit: 1, pipeline_stage: stage });
  }
});

test('6: missing options defaults to policy stage', async () => {
  const { service, calls } = createService({ runs: [] });
  const result = await service.getLatestRecommendationMetrics();
  assert.equal(result.pipeline_stage, 'policy');
  assert.deepEqual(calls[0], { limit: 1, pipeline_stage: 'policy' });
});

test('7: factory rejects a missing listEvaluationRuns dependency', () => {
  assert.throws(
    () =>
      createAdminRecommendationMetricsService({
        evaluationRunService: {},
      }),
    AdminRecommendationMetricsValidationError,
  );
  assert.throws(
    () => createAdminRecommendationMetricsService({ evaluationRunService: null }),
    AdminRecommendationMetricsValidationError,
  );
});

// --- exactly one listEvaluationRuns call ---

test('8: ready path calls listEvaluationRuns exactly once with limit 1', async () => {
  const { service, calls } = createService({ runs: [runFixture()] });
  await service.getLatestRecommendationMetrics({ pipelineStage: 'policy' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { limit: 1, pipeline_stage: 'policy' });
});

test('9: no-runs path calls listEvaluationRuns exactly once', async () => {
  const { service, calls } = createService({ runs: [] });
  await service.getLatestRecommendationMetrics({ pipelineStage: 'hybrid' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { limit: 1, pipeline_stage: 'hybrid' });
});

test('10: multiple sequential calls each perform one list (no caching/second query)', async () => {
  const { service, calls } = createService({ runs: [] });
  await service.getLatestRecommendationMetrics();
  await service.getLatestRecommendationMetrics({ pipelineStage: 'collaborative' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, [
    { limit: 1, pipeline_stage: 'policy' },
    { limit: 1, pipeline_stage: 'collaborative' },
  ]);
});

// --- no-runs state ---

test('11: empty list returns no-runs with latest null and source evaluation-history', async () => {
  const { service } = createService({ runs: [] });
  const result = await service.getLatestRecommendationMetrics();
  assert.deepEqual(result, {
    state: 'no-runs',
    source: 'evaluation-history',
    pipeline_stage: 'policy',
    latest: null,
  });
});

test('12: non-array list result is treated as no-runs', async () => {
  const { service } = createService({ runs: null });
  const result = await service.getLatestRecommendationMetrics();
  assert.equal(result.state, 'no-runs');
  assert.equal(result.latest, null);
});

// --- ready projection whitelist ---

test('13: ready result has exactly state/source/pipeline_stage/latest keys', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getLatestRecommendationMetrics();
  assert.equal(result.state, 'ready');
  assert.equal(result.source, 'evaluation-history');
  assert.equal(result.pipeline_stage, 'policy');
  assert.deepEqual(Object.keys(result).sort(), [
    'latest',
    'pipeline_stage',
    'source',
    'state',
  ]);
});

test('14: latest top-level keys are exactly the six allowed fields', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.deepEqual(Object.keys(latest).sort(), [
    'artifact_version',
    'evaluated_at',
    'metrics',
    'pipeline_stage',
    'run_id',
    'summary',
  ]);
});

test('15: latest strips dataset, configuration, payload, ids, timestamps, schema_version', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const { latest } = await service.getLatestRecommendationMetrics();
  for (const forbidden of [
    'dataset',
    'configuration',
    'payload_sha256',
    '_id',
    'createdAt',
    'updatedAt',
    'schema_version',
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(latest, forbidden), false);
  }
  assert.equal(JSON.stringify(latest).includes('payload_sha256'), false);
  assert.equal(JSON.stringify(latest).includes('random_seed'), false);
});

test('16: metrics object contains exactly the ten metric keys in model order', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.deepEqual(Object.keys(latest.metrics), METRIC_KEYS);
  assert.equal(latest.metrics.precision_at_5, 0.4);
  assert.equal(latest.metrics.diversity, 0.8);
});

test('17: summary object contains exactly the seven summary keys in model order', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.deepEqual(Object.keys(latest.summary), SUMMARY_KEYS);
  assert.equal(latest.summary.evaluated_user_count, 10);
  assert.equal(latest.summary.recommendation_user_count, 12);
});

test('18: factual identity fields are preserved without inference', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.equal(latest.run_id, 'eval-2026-09-15-policy-1');
  assert.equal(latest.pipeline_stage, 'policy');
  assert.equal(latest.artifact_version, 'rel-1.0.0');
});

test('19: artifact_version null is allowed and stays null', async () => {
  const { service } = createService({
    runs: [runFixture({ artifact_version: null })],
  });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.equal(latest.artifact_version, null);
});

test('20: evaluated_at Date is exposed as ISO-8601 string', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.equal(latest.evaluated_at, '2026-09-15T12:00:00.000Z');
  assert.equal(typeof latest.evaluated_at, 'string');
});

test('21: evaluated_at ISO string passthrough stays a string', async () => {
  const { service } = createService({
    runs: [
      runFixture({ evaluated_at: '2026-09-15T15:30:00.000Z' }),
    ],
  });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.equal(latest.evaluated_at, '2026-09-15T15:30:00.000Z');
});

test('22: unknown extra fields on the run are ignored, not rejected', async () => {
  const { service } = createService({
    runs: [
      runFixture({
        winner: 'policy',
        overall_score: 0.99,
        quality_score: 0.9,
        extra_notes: 'should be dropped',
        metrics: { ...metricsFixture(), rogue_metric: 0.1 },
        summary: { ...summaryFixture(), rogue_count: 3 },
      }),
    ],
  });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.equal('winner' in latest, false);
  assert.equal('overall_score' in latest, false);
  assert.equal('rogue_metric' in latest.metrics, false);
  assert.equal('rogue_count' in latest.summary, false);
  assert.deepEqual(Object.keys(latest.metrics), METRIC_KEYS);
  assert.deepEqual(Object.keys(latest.summary), SUMMARY_KEYS);
});

test('23: metric values pass through unchanged (no percent/round/average)', async () => {
  const metrics = metricsFixture();
  metrics.precision_at_5 = 0;
  metrics.diversity = 1;
  metrics.ndcg_at_10 = 0.123456789;
  const { service } = createService({ runs: [runFixture({ metrics })] });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.equal(latest.metrics.precision_at_5, 0);
  assert.equal(latest.metrics.diversity, 1);
  assert.equal(latest.metrics.ndcg_at_10, 0.123456789);
});

test('24: no overall/quality/winner/best keys are ever produced', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getLatestRecommendationMetrics();
  const serialized = JSON.stringify(result);
  for (const token of [
    'overall',
    'quality',
    'winner',
    'best',
    'composite',
    'percent',
  ]) {
    assert.equal(serialized.includes(token), false);
  }
});

test('25: persisted input run is not mutated by projection', async () => {
  const run = runFixture();
  const before = JSON.stringify({
    run_id: run.run_id,
    metrics: run.metrics,
    summary: run.summary,
    dataset: run.dataset,
  });
  const { service } = createService({ runs: [run] });
  await service.getLatestRecommendationMetrics();
  const after = JSON.stringify({
    run_id: run.run_id,
    metrics: run.metrics,
    summary: run.summary,
    dataset: run.dataset,
  });
  assert.equal(after, before);
  assert.ok(run.dataset);
  assert.ok(run.payload_sha256);
});

// --- defensive fail-closed validation ---

test('26: stage mismatch is rejected as a corrupt read', async () => {
  const { service } = createService({
    runs: [runFixture({ pipeline_stage: 'collaborative' })],
  });
  await assert.rejects(
    () => service.getLatestRecommendationMetrics({ pipelineStage: 'policy' }),
    AdminRecommendationMetricsValidationError,
  );
});

test('27: missing or unsafe run_id is rejected', async () => {
  for (const runId of [
    undefined,
    null,
    '',
    ' ',
    'UPPER',
    '../etc',
    'has space',
    42,
    {},
  ]) {
    const { service } = createService({
      runs: [runFixture({ run_id: runId })],
    });
    await assert.rejects(
      () => service.getLatestRecommendationMetrics(),
      AdminRecommendationMetricsValidationError,
    );
  }
});

test('28: invalid evaluated_at is rejected (never createdAt or now)', async () => {
  for (const value of [
    undefined,
    null,
    '',
    'not-a-date',
    new Date('invalid'),
    123,
    {},
  ]) {
    const { service } = createService({
      runs: [runFixture({ evaluated_at: value })],
    });
    await assert.rejects(
      () => service.getLatestRecommendationMetrics(),
      AdminRecommendationMetricsValidationError,
    );
  }
});

test('29: unsafe artifact_version string is rejected', async () => {
  for (const value of ['UPPER', 'has space', '../x', '', 42, {}]) {
    const { service } = createService({
      runs: [runFixture({ artifact_version: value })],
    });
    await assert.rejects(
      () => service.getLatestRecommendationMetrics(),
      AdminRecommendationMetricsValidationError,
    );
  }
});

test('30: missing or malformed metrics object is rejected', async () => {
  for (const metrics of [
    undefined,
    null,
    'x',
    [],
    {},
    { ...metricsFixture(), precision_at_5: undefined },
    { ...metricsFixture(), precision_at_5: null },
    { ...metricsFixture(), precision_at_5: '0.4' },
    { ...metricsFixture(), precision_at_5: -0.1 },
    { ...metricsFixture(), precision_at_5: 1.1 },
    { ...metricsFixture(), precision_at_5: NaN },
    { ...metricsFixture(), precision_at_5: Infinity },
  ]) {
    const { service } = createService({ runs: [runFixture({ metrics })] });
    await assert.rejects(
      () => service.getLatestRecommendationMetrics(),
      AdminRecommendationMetricsValidationError,
    );
  }
});

test('31: a single missing metric key among the ten is rejected', async () => {
  for (const key of METRIC_KEYS) {
    const metrics = metricsFixture();
    delete metrics[key];
    const { service } = createService({ runs: [runFixture({ metrics })] });
    await assert.rejects(
      () => service.getLatestRecommendationMetrics(),
      AdminRecommendationMetricsValidationError,
    );
  }
});

test('32: missing or malformed summary object is rejected', async () => {
  for (const summary of [
    undefined,
    null,
    'x',
    [],
    {},
    { ...summaryFixture(), evaluated_user_count: -1 },
    { ...summaryFixture(), evaluated_user_count: 1.5 },
    { ...summaryFixture(), evaluated_user_count: '10' },
    { ...summaryFixture(), catalog_size: NaN },
  ]) {
    const { service } = createService({ runs: [runFixture({ summary })] });
    await assert.rejects(
      () => service.getLatestRecommendationMetrics(),
      AdminRecommendationMetricsValidationError,
    );
  }
});

test('33: a single missing summary key among the seven is rejected', async () => {
  for (const key of SUMMARY_KEYS) {
    const summary = summaryFixture();
    delete summary[key];
    const { service } = createService({ runs: [runFixture({ summary })] });
    await assert.rejects(
      () => service.getLatestRecommendationMetrics(),
      AdminRecommendationMetricsValidationError,
    );
  }
});

test('34: summary invariants are enforced fail-closed', async () => {
  const cases = [
    {
      evaluated_user_count: 11,
      relevance_user_count: 10,
    },
    {
      unique_recommended_at_10: 51,
      catalog_size: 50,
    },
    {
      diversity_evaluable_user_count: 11,
      evaluated_user_count: 10,
    },
  ];
  for (const patch of cases) {
    const { service } = createService({
      runs: [runFixture({ summary: { ...summaryFixture(), ...patch } })],
    });
    await assert.rejects(
      () => service.getLatestRecommendationMetrics(),
      AdminRecommendationMetricsValidationError,
    );
  }
});

test('35: recommendation_user_count may exceed evaluated_user_count', async () => {
  const summary = summaryFixture();
  summary.recommendation_user_count = summary.evaluated_user_count + 50;
  const { service } = createService({ runs: [runFixture({ summary })] });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.ok(
    latest.summary.recommendation_user_count > latest.summary.evaluated_user_count,
  );
});

test('36: non-object run is rejected', async () => {
  for (const run of [undefined, null, 'x', 42, []]) {
    const { service } = createService({ runs: [run] });
    await assert.rejects(
      () => service.getLatestRecommendationMetrics(),
      AdminRecommendationMetricsValidationError,
    );
  }
});

test('37: only the first returned run is projected (limit 1 already applied upstream)', async () => {
  const { service } = createService({
    runs: [runFixture(), runFixture({ run_id: 'second-run' })],
  });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.equal(latest.run_id, 'eval-2026-09-15-policy-1');
});

// --- underlying read failures ---

test('38: listEvaluationRuns failure becomes ReadError with the fixed failed message', async () => {
  const { service } = createService({
    listError: new Error('mongo uri leaked? mongodb://user:pass@host'),
  });
  await assert.rejects(
    () => service.getLatestRecommendationMetrics(),
    (error) => {
      assert.ok(error instanceof AdminRecommendationMetricsReadError);
      assert.equal(
        error.message,
        'failed to load recommendation metrics',
      );
      assert.equal(error.message.includes('mongodb://'), false);
      return true;
    },
  );
});

test('39: AdminRecommendationMetricsError subclasses are not double-wrapped', async () => {
  const original = new AdminRecommendationMetricsValidationError('boom');
  const { service } = createService({ listError: original });
  await assert.rejects(
    () => service.getLatestRecommendationMetrics(),
    (error) => error === original,
  );
});

// --- source-level guarantees ---

test('40: service source does not query RecommendationEvaluationRun directly', () => {
  const source = readSource('./adminRecommendationMetricsService.js');
  assert.equal(source.includes('RecommendationEvaluationRun.find'), false);
  assert.equal(source.includes('RecommendationEvaluationRun.aggregate'), false);
  assert.equal(source.includes('RecommendationEvaluationRun.create'), false);
  assert.equal(source.includes("from '../models/RecommendationEvaluationRun.js'"), true);
  assert.equal(source.includes('import RecommendationEvaluationRun'), false);
});

test('41: service source performs exactly one listEvaluationRuns invocation site', () => {
  const source = readSource('./adminRecommendationMetricsService.js');
  const matches = source.match(/listEvaluationRuns\s*\(/g) || [];
  assert.equal(matches.length, 1);
});

test('42: service source has no writes, Python, or child process usage', () => {
  const source = readSource('./adminRecommendationMetricsService.js');
  for (const token of [
    'recordEvaluationRun',
    'create(',
    'save(',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'replaceOne',
    'upsert',
    'child_process',
    'spawn',
    'exec(',
    'python',
    'TruncatedSVD',
    'train_collaborative_model',
    'evaluate_recommendations',
    'rank_hybrid_candidates',
    'rank_with_cold_start_policy',
    'publish_artifact_release',
    'activate_artifact_release',
    'console.log',
    'Date.now()',
  ]) {
    assert.equal(source.includes(token), false, `unexpected token: ${token}`);
  }
});

test('43: service source contains no winner/best/overall scoring labels', () => {
  const source = readSource('./adminRecommendationMetricsService.js');
  for (const token of [
    'overall_score',
    'quality_score',
    'winner',
    'best_model',
    'percent',
    'round(',
  ]) {
    assert.equal(source.includes(token), false, `unexpected token: ${token}`);
  }
});

test('44: ready/no-runs state vocabulary is exactly the two allowed values', async () => {
  const ready = await createService({ runs: [runFixture()] }).service.getLatestRecommendationMetrics();
  const empty = await createService({ runs: [] }).service.getLatestRecommendationMetrics();
  assert.equal(ready.state, 'ready');
  assert.equal(empty.state, 'no-runs');
  assert.equal(['ready', 'no-runs'].includes(ready.state), true);
  assert.equal(['ready', 'no-runs'].includes(empty.state), true);
});

test('45: no user/song/snapshot fields ever appear in the projected payload', async () => {
  const { service } = createService({
    runs: [
      runFixture({
        user_id: 'u1',
        user: 'u1',
        email: 'a@b.c',
        items: [{ rank: 1, song: 's' }],
        songs: ['s'],
        recommendations: [],
      }),
    ],
  });
  const result = await service.getLatestRecommendationMetrics();
  const serialized = JSON.stringify(result);
  for (const token of ['user_id', 'email', 'recommendations', 'items']) {
    assert.equal(serialized.includes(token), false, `leaked: ${token}`);
  }
});

test('46: collaborative stage ready projection keeps its own stage label', async () => {
  const { service } = createService({
    runs: [runFixture({ pipeline_stage: 'collaborative' })],
  });
  const result = await service.getLatestRecommendationMetrics({
    pipelineStage: 'collaborative',
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.latest.pipeline_stage, 'collaborative');
  assert.equal(result.pipeline_stage, 'collaborative');
});

test('47: hybrid stage ready projection keeps its own stage label', async () => {
  const { service } = createService({
    runs: [runFixture({ pipeline_stage: 'hybrid' })],
  });
  const result = await service.getLatestRecommendationMetrics({
    pipelineStage: 'hybrid',
  });
  assert.equal(result.latest.pipeline_stage, 'hybrid');
});

test('48: zero-valued metrics and zero summary counts are valid', async () => {
  const metrics = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0]));
  const summary = Object.fromEntries(SUMMARY_KEYS.map((k) => [k, 0]));
  const { service } = createService({
    runs: [runFixture({ metrics, summary })],
  });
  const { latest } = await service.getLatestRecommendationMetrics();
  assert.deepEqual(latest.metrics, metrics);
  assert.deepEqual(latest.summary, summary);
});

test('49: metric boundary values 0 and 1 inclusive are accepted', async () => {
  for (const value of [0, 1]) {
    const metrics = Object.fromEntries(METRIC_KEYS.map((k) => [k, value]));
    const { service } = createService({ runs: [runFixture({ metrics })] });
    const { latest } = await service.getLatestRecommendationMetrics();
    assert.equal(latest.metrics.precision_at_5, value);
  }
});
