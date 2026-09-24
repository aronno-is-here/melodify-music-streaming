import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE,
  ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES,
  ADMIN_RECOMMENDATION_HISTORY_SOURCE,
  AdminRecommendationHistoryError,
  AdminRecommendationHistoryReadError,
  AdminRecommendationHistoryValidationError,
  DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  createAdminRecommendationHistoryService,
} from './adminRecommendationHistoryService.js';
import {
  CONFIGURATION_KEYS,
  DATASET_STAT_KEYS,
  EVALUATION_METRIC_KEYS,
  EVALUATION_SUMMARY_KEYS,
  PIPELINE_STAGES,
} from '../models/RecommendationEvaluationRun.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const METRIC_KEYS = [...EVALUATION_METRIC_KEYS];
const SUMMARY_KEYS = [...EVALUATION_SUMMARY_KEYS];
const DATASET_KEYS = [...DATASET_STAT_KEYS];
const CONFIGURATION_OUTPUT_KEYS = [...CONFIGURATION_KEYS];

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
  _id: '64b000000000000000000001',
  schema_version: 1,
  run_id: 'eval-2026-09-15-policy-1',
  pipeline_stage: 'policy',
  artifact_version: 'rel-1.0.0',
  evaluated_at: new Date('2026-09-15T12:00:00.000Z'),
  metrics: metricsFixture(),
  summary: summaryFixture(),
  dataset: datasetFixture(),
  configuration: configurationFixture(),
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
  const service = createAdminRecommendationHistoryService({
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

// --- constants and error hierarchy ---

test('1: defaults are policy stage, limit 20, max 100, source evaluation-history', () => {
  assert.equal(ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE, 'policy');
  assert.equal(DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT, 20);
  assert.equal(MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT, 100);
  assert.equal(ADMIN_RECOMMENDATION_HISTORY_SOURCE, 'evaluation-history');
});

test('2: HTTP messages are the exact fixed strings', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES.invalidQuery,
    'invalid recommendation history query',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES.failed,
    'failed to load recommendation history',
  );
});

test('3: error classes extend AdminRecommendationHistoryError', () => {
  const validation = new AdminRecommendationHistoryValidationError('v');
  const read = new AdminRecommendationHistoryReadError('r');
  assert.ok(validation instanceof AdminRecommendationHistoryError);
  assert.ok(read instanceof AdminRecommendationHistoryError);
  assert.equal(
    validation.name,
    'AdminRecommendationHistoryValidationError',
  );
  assert.equal(read.name, 'AdminRecommendationHistoryReadError');
  assert.equal(
    new AdminRecommendationHistoryError('x').name,
    'AdminRecommendationHistoryError',
  );
});

// --- stage and limit validation ---

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
      () => service.getRecommendationEvaluationHistory({ pipelineStage: stage }),
      (error) => {
        assert.ok(error instanceof AdminRecommendationHistoryValidationError);
        assert.equal(
          error.message,
          'invalid recommendation history query',
        );
        return true;
      },
    );
  }
  assert.equal(calls.length, 0);
});

test('5: invalid limit rejects before any list call', async () => {
  const { service, calls } = createService();
  for (const limit of [0, -1, 101, 1.5, NaN, Infinity, '20', null, [20], {}]) {
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory({ limit }),
      (error) => {
        assert.ok(error instanceof AdminRecommendationHistoryValidationError);
        assert.equal(
          error.message,
          'invalid recommendation history query',
        );
        return true;
      },
    );
  }
  assert.equal(calls.length, 0);
});

test('6: limit boundaries 1 and 100 are accepted', async () => {
  for (const limit of [1, 100]) {
    const { service, calls } = createService({ runs: [] });
    const result = await service.getRecommendationEvaluationHistory({
      pipelineStage: 'policy',
      limit,
    });
    assert.equal(result.limit, limit);
    assert.deepEqual(calls[0], { limit, pipeline_stage: 'policy' });
  }
});

test('7: every exact-lowercase stage is accepted', async () => {
  for (const stage of PIPELINE_STAGES) {
    const { service, calls } = createService({ runs: [] });
    const result = await service.getRecommendationEvaluationHistory({
      pipelineStage: stage,
    });
    assert.equal(result.pipeline_stage, stage);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      limit: DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
      pipeline_stage: stage,
    });
  }
});

test('8: missing options default to policy stage and limit 20', async () => {
  const { service, calls } = createService({ runs: [] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.equal(result.pipeline_stage, 'policy');
  assert.equal(result.limit, 20);
  assert.deepEqual(calls[0], { limit: 20, pipeline_stage: 'policy' });
});

test('9: factory rejects a missing listEvaluationRuns dependency', () => {
  assert.throws(
    () =>
      createAdminRecommendationHistoryService({
        evaluationRunService: {},
      }),
    AdminRecommendationHistoryValidationError,
  );
  assert.throws(
    () =>
      createAdminRecommendationHistoryService({ evaluationRunService: null }),
    AdminRecommendationHistoryValidationError,
  );
});

// --- exactly one listEvaluationRuns call ---

test('10: ready path calls listEvaluationRuns exactly once with requested limit', async () => {
  const { service, calls } = createService({ runs: [runFixture()] });
  await service.getRecommendationEvaluationHistory({
    pipelineStage: 'policy',
    limit: 20,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { limit: 20, pipeline_stage: 'policy' });
});

test('11: no-runs path calls listEvaluationRuns exactly once', async () => {
  const { service, calls } = createService({ runs: [] });
  await service.getRecommendationEvaluationHistory({
    pipelineStage: 'hybrid',
    limit: 5,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { limit: 5, pipeline_stage: 'hybrid' });
});

test('12: sequential calls each perform one list (no caching/second query)', async () => {
  const { service, calls } = createService({ runs: [] });
  await service.getRecommendationEvaluationHistory();
  await service.getRecommendationEvaluationHistory({
    pipelineStage: 'collaborative',
  });
  await service.getRecommendationEvaluationHistory({ limit: 10 });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls, [
    { limit: 20, pipeline_stage: 'policy' },
    { limit: 20, pipeline_stage: 'collaborative' },
    { limit: 10, pipeline_stage: 'policy' },
  ]);
});

// --- no-runs state ---

test('13: empty list returns no-runs with count 0 and empty runs array', async () => {
  const { service } = createService({ runs: [] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(result, {
    state: 'no-runs',
    source: 'evaluation-history',
    pipeline_stage: 'policy',
    limit: 20,
    count: 0,
    runs: [],
  });
});

test('14: non-array list result is treated as no-runs', async () => {
  const { service } = createService({ runs: null });
  const result = await service.getRecommendationEvaluationHistory();
  assert.equal(result.state, 'no-runs');
  assert.equal(result.count, 0);
  assert.deepEqual(result.runs, []);
});

test('15: no-runs result has exactly the six envelope keys', async () => {
  const { service } = createService({ runs: [] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(Object.keys(result).sort(), [
    'count',
    'limit',
    'pipeline_stage',
    'runs',
    'source',
    'state',
  ]);
});

// --- ready envelope and order ---

test('16: ready result has exactly state/source/pipeline_stage/limit/count/runs keys', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.equal(result.state, 'ready');
  assert.equal(result.source, 'evaluation-history');
  assert.equal(result.pipeline_stage, 'policy');
  assert.equal(result.limit, 20);
  assert.equal(result.count, 1);
  assert.deepEqual(Object.keys(result).sort(), [
    'count',
    'limit',
    'pipeline_stage',
    'runs',
    'source',
    'state',
  ]);
});

test('17: count equals runs length and does not exceed limit', async () => {
  const runs = [
    runFixture({ run_id: 'run-a' }),
    runFixture({ run_id: 'run-b' }),
  ];
  const { service } = createService({ runs });
  const result = await service.getRecommendationEvaluationHistory({ limit: 20 });
  assert.equal(result.count, 2);
  assert.equal(result.runs.length, 2);
  assert.equal(result.count <= result.limit, true);
});

test('18: server order is preserved without re-sorting or re-ranking', async () => {
  const runs = [
    runFixture({ run_id: 'zzz-newest' }),
    runFixture({ run_id: 'mmm-middle' }),
    runFixture({ run_id: 'aaa-oldest' }),
  ];
  const { service } = createService({ runs });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(
    result.runs.map((r) => r.run_id),
    ['zzz-newest', 'mmm-middle', 'aaa-oldest'],
  );
});

test('19: runs more than the requested limit fail closed', async () => {
  const runs = [
    runFixture({ run_id: 'run-1' }),
    runFixture({ run_id: 'run-2' }),
  ];
  const { service } = createService({ runs });
  await assert.rejects(
    () => service.getRecommendationEvaluationHistory({ limit: 1 }),
    AdminRecommendationHistoryValidationError,
  );
});

// --- run projection whitelist ---

test('20: projected run has exactly the eight allowed top-level fields', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(Object.keys(result.runs[0]).sort(), [
    'artifact_version',
    'configuration',
    'dataset',
    'evaluated_at',
    'metrics',
    'pipeline_stage',
    'run_id',
    'summary',
  ]);
});

test('21: projection strips payload_sha256, schema_version, _id, createdAt, updatedAt', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getRecommendationEvaluationHistory();
  const run = result.runs[0];
  for (const forbidden of [
    'payload_sha256',
    'schema_version',
    '_id',
    'createdAt',
    'updatedAt',
  ]) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(run, forbidden),
      false,
      forbidden,
    );
  }
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('payload_sha256'), false);
  assert.equal(serialized.includes('schema_version'), false);
});

test('22: metrics object contains exactly the ten keys in model order', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(Object.keys(result.runs[0].metrics), METRIC_KEYS);
});

test('23: summary object contains exactly the seven keys in model order', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(Object.keys(result.runs[0].summary), SUMMARY_KEYS);
});

test('24: dataset object contains exactly the nine keys in model order', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(Object.keys(result.runs[0].dataset), DATASET_KEYS);
  assert.equal(result.runs[0].dataset.raw_event_count, 100);
  assert.equal(result.runs[0].dataset.train_event_count, 70);
});

test('25: configuration object always contains all nine keys', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(
    Object.keys(result.runs[0].configuration),
    CONFIGURATION_OUTPUT_KEYS,
  );
  assert.equal(result.runs[0].configuration.random_seed, 42);
  assert.equal(result.runs[0].configuration.algorithm, 'truncated-svd');
});

test('26: missing optional configuration fields normalize to null', async () => {
  const { service } = createService({
    runs: [runFixture({ configuration: { random_seed: 7 } })],
  });
  const result = await service.getRecommendationEvaluationHistory();
  const configuration = result.runs[0].configuration;
  assert.equal(configuration.random_seed, 7);
  assert.equal(configuration.algorithm, null);
  assert.equal(configuration.requested_components, null);
  assert.equal(configuration.effective_components, null);
  assert.equal(configuration.collaborative_weight, null);
  assert.equal(configuration.content_weight, null);
  assert.equal(configuration.base_hybrid_policy_weight, null);
  assert.equal(configuration.explicit_profile_policy_weight, null);
  assert.equal(configuration.exploration_interval, null);
  assert.deepEqual(Object.keys(configuration), CONFIGURATION_OUTPUT_KEYS);
});

test('27: extra fields on run/metrics/summary/dataset/configuration are stripped', async () => {
  const { service } = createService({
    runs: [
      runFixture({
        winner: 'policy',
        overall_score: 0.99,
        metrics: { ...metricsFixture(), rogue_metric: 0.1 },
        summary: { ...summaryFixture(), rogue_count: 3 },
        dataset: { ...datasetFixture(), rogue_dataset: 1 },
        configuration: { ...configurationFixture(), rogue_config: 2 },
      }),
    ],
  });
  const result = await service.getRecommendationEvaluationHistory();
  const run = result.runs[0];
  assert.equal('winner' in run, false);
  assert.equal('overall_score' in run, false);
  assert.equal('rogue_metric' in run.metrics, false);
  assert.equal('rogue_count' in run.summary, false);
  assert.equal('rogue_dataset' in run.dataset, false);
  assert.equal('rogue_config' in run.configuration, false);
  assert.deepEqual(Object.keys(run.metrics), METRIC_KEYS);
  assert.deepEqual(Object.keys(run.summary), SUMMARY_KEYS);
  assert.deepEqual(Object.keys(run.dataset), DATASET_KEYS);
  assert.deepEqual(Object.keys(run.configuration), CONFIGURATION_OUTPUT_KEYS);
});

test('28: artifact_version null stays null and unsafe artifact is rejected', async () => {
  const { service } = createService({
    runs: [runFixture({ artifact_version: null })],
  });
  const result = await service.getRecommendationEvaluationHistory();
  assert.equal(result.runs[0].artifact_version, null);

  for (const value of ['UPPER', 'has space', '../x', '', 42, {}]) {
    const bad = createService({
      runs: [runFixture({ artifact_version: value })],
    });
    await assert.rejects(
      () => bad.service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }
});

test('29: evaluated_at Date becomes ISO string and string passthrough stays', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.equal(result.runs[0].evaluated_at, '2026-09-15T12:00:00.000Z');

  const stringService = createService({
    runs: [runFixture({ evaluated_at: '2026-09-15T15:30:00.000Z' })],
  });
  const stringResult = await stringService.service.getRecommendationEvaluationHistory();
  assert.equal(stringResult.runs[0].evaluated_at, '2026-09-15T15:30:00.000Z');
});

// --- fail-closed validation ---

test('30: stage mismatch on any run rejects the whole read', async () => {
  const { service } = createService({
    runs: [runFixture({ pipeline_stage: 'collaborative' })],
  });
  await assert.rejects(
    () =>
      service.getRecommendationEvaluationHistory({ pipelineStage: 'policy' }),
    AdminRecommendationHistoryValidationError,
  );
});

test('31: unsafe run_id is rejected', async () => {
  for (const runId of [
    undefined,
    null,
    '',
    'UPPER',
    '../etc',
    'has space',
    42,
  ]) {
    const { service } = createService({
      runs: [runFixture({ run_id: runId })],
    });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }
});

test('32: invalid evaluated_at is rejected', async () => {
  for (const value of [
    undefined,
    null,
    '',
    'not-a-date',
    new Date('invalid'),
    123,
  ]) {
    const { service } = createService({
      runs: [runFixture({ evaluated_at: value })],
    });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }
});

test('33: malformed metrics or a single missing metric key is rejected', async () => {
  for (const metrics of [
    undefined,
    null,
    'x',
    [],
    {},
    { ...metricsFixture(), precision_at_5: -0.1 },
    { ...metricsFixture(), precision_at_5: 1.1 },
    { ...metricsFixture(), precision_at_5: NaN },
  ]) {
    const { service } = createService({ runs: [runFixture({ metrics })] });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }

  for (const key of METRIC_KEYS) {
    const metrics = metricsFixture();
    delete metrics[key];
    const { service } = createService({ runs: [runFixture({ metrics })] });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }
});

test('34: malformed summary, missing summary key, or broken invariant is rejected', async () => {
  for (const summary of [
    undefined,
    null,
    {},
    { ...summaryFixture(), evaluated_user_count: -1 },
    { ...summaryFixture(), evaluated_user_count: 1.5 },
  ]) {
    const { service } = createService({ runs: [runFixture({ summary })] });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }

  for (const key of SUMMARY_KEYS) {
    const summary = summaryFixture();
    delete summary[key];
    const { service } = createService({ runs: [runFixture({ summary })] });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }

  const cases = [
    { evaluated_user_count: 11, relevance_user_count: 10 },
    { unique_recommended_at_10: 51, catalog_size: 50 },
    { diversity_evaluable_user_count: 11, evaluated_user_count: 10 },
  ];
  for (const patch of cases) {
    const { service } = createService({
      runs: [runFixture({ summary: { ...summaryFixture(), ...patch } })],
    });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }
});

test('35: recommendation_user_count may exceed evaluated_user_count', async () => {
  const summary = summaryFixture();
  summary.recommendation_user_count = summary.evaluated_user_count + 50;
  const { service } = createService({ runs: [runFixture({ summary })] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.ok(
    result.runs[0].summary.recommendation_user_count >
      result.runs[0].summary.evaluated_user_count,
  );
});

test('36: malformed dataset, missing dataset key, or broken conservation is rejected', async () => {
  for (const dataset of [
    undefined,
    null,
    {},
    { ...datasetFixture(), raw_event_count: -1 },
  ]) {
    const { service } = createService({ runs: [runFixture({ dataset })] });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }

  for (const key of DATASET_KEYS) {
    const dataset = datasetFixture();
    delete dataset[key];
    const { service } = createService({ runs: [runFixture({ dataset })] });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }

  for (const patch of [
    { raw_event_count: 99, train_event_count: 70, validation_event_count: 15, test_event_count: 15 },
    { raw_event_count: 0, train_event_count: 1, validation_event_count: 0, test_event_count: 0 },
  ]) {
    const { service } = createService({
      runs: [runFixture({ dataset: { ...datasetFixture(), ...patch } })],
    });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }
});

test('37: all-zero dataset conserves raw == train + validation + test', async () => {
  const dataset = Object.fromEntries(DATASET_KEYS.map((k) => [k, 0]));
  const { service } = createService({ runs: [runFixture({ dataset })] });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(result.runs[0].dataset, dataset);
});

test('38: configuration invariants fail closed', async () => {
  const badConfigurations = [
    {},
    { random_seed: -1 },
    { random_seed: 4294967296 },
    { random_seed: 1.5 },
    { random_seed: '42' },
    { random_seed: 42, algorithm: 'UPPER' },
    { random_seed: 42, requested_components: 0 },
    { random_seed: 42, requested_components: 33 },
    { random_seed: 42, requested_components: 8, effective_components: 16 },
    { random_seed: 42, collaborative_weight: 0.7 },
    { random_seed: 42, content_weight: 0.3 },
    {
      random_seed: 42,
      collaborative_weight: 0.9,
      content_weight: 0.3,
    },
    { random_seed: 42, base_hybrid_policy_weight: 0.8 },
    { random_seed: 42, explicit_profile_policy_weight: 0.2 },
    {
      random_seed: 42,
      base_hybrid_policy_weight: 0.5,
      explicit_profile_policy_weight: 0.4,
    },
    { random_seed: 42, exploration_interval: 0 },
    { random_seed: 42, exploration_interval: 101 },
  ];
  for (const configuration of badConfigurations) {
    const { service } = createService({
      runs: [runFixture({ configuration })],
    });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
      JSON.stringify(configuration),
    );
  }
});

test('39: weight pairs within tolerance and valid component pairs are accepted', async () => {
  const configuration = {
    random_seed: 0,
    algorithm: null,
    requested_components: 32,
    effective_components: 32,
    collaborative_weight: 0.7000000001,
    content_weight: 0.2999999999,
    base_hybrid_policy_weight: 1,
    explicit_profile_policy_weight: 0,
    exploration_interval: 100,
  };
  const { service } = createService({
    runs: [runFixture({ configuration })],
  });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(
    result.runs[0].configuration,
    configuration,
  );
});

test('40: non-object run is rejected', async () => {
  for (const run of [undefined, null, 'x', 42, []]) {
    const { service } = createService({ runs: [run] });
    await assert.rejects(
      () => service.getRecommendationEvaluationHistory(),
      AdminRecommendationHistoryValidationError,
    );
  }
});

test('41: a single corrupt run among many rejects the whole response', async () => {
  const { service } = createService({
    runs: [
      runFixture({ run_id: 'good-run' }),
      runFixture({ run_id: 'bad-run', metrics: { precision_at_5: 2 } }),
    ],
  });
  await assert.rejects(
    () => service.getRecommendationEvaluationHistory(),
    AdminRecommendationHistoryValidationError,
  );
});

// --- underlying read failures ---

test('42: listEvaluationRuns failure becomes ReadError with the fixed failed message', async () => {
  const { service } = createService({
    listError: new Error('mongo uri leaked? mongodb://user:pass@host'),
  });
  await assert.rejects(
    () => service.getRecommendationEvaluationHistory(),
    (error) => {
      assert.ok(error instanceof AdminRecommendationHistoryReadError);
      assert.equal(
        error.message,
        'failed to load recommendation history',
      );
      assert.equal(error.message.includes('mongodb://'), false);
      return true;
    },
  );
});

test('43: AdminRecommendationHistoryError subclasses are not double-wrapped', async () => {
  const original = new AdminRecommendationHistoryValidationError('boom');
  const { service } = createService({ listError: original });
  await assert.rejects(
    () => service.getRecommendationEvaluationHistory(),
    (error) => error === original,
  );
});

// --- state vocabulary and privacy ---

test('44: state vocabulary is exactly ready or no-runs', async () => {
  const ready = await createService({
    runs: [runFixture()],
  }).service.getRecommendationEvaluationHistory();
  const empty = await createService({
    runs: [],
  }).service.getRecommendationEvaluationHistory();
  assert.equal(ready.state, 'ready');
  assert.equal(empty.state, 'no-runs');
});

test('45: no user/song/snapshot/session fields appear in any projected payload', async () => {
  const { service } = createService({
    runs: [
      runFixture({
        user_id: 'u1',
        user: 'u1',
        email: 'a@b.c',
        items: [{ rank: 1, song: 's' }],
        songs: ['s'],
        recommendations: [],
        session_id: 'sess-1',
      }),
    ],
  });
  const result = await service.getRecommendationEvaluationHistory();
  const serialized = JSON.stringify(result);
  for (const token of [
    'user_id',
    'email',
    'recommendations',
    'items',
    'session_id',
    'youtube_id',
  ]) {
    assert.equal(serialized.includes(token), false, `leaked: ${token}`);
  }
});

test('46: no overall/quality/winner/best/composite labels are produced', async () => {
  const { service } = createService({ runs: [runFixture()] });
  const result = await service.getRecommendationEvaluationHistory();
  const serialized = JSON.stringify(result);
  for (const token of [
    'overall',
    'quality',
    'winner',
    'best',
    'composite',
    'percent',
  ]) {
    assert.equal(serialized.includes(token), false, token);
  }
});

test('47: zero metrics, zero summary, and zero dataset counts are valid', async () => {
  const metrics = Object.fromEntries(METRIC_KEYS.map((k) => [k, 0]));
  const summary = Object.fromEntries(SUMMARY_KEYS.map((k) => [k, 0]));
  const dataset = Object.fromEntries(DATASET_KEYS.map((k) => [k, 0]));
  const { service } = createService({
    runs: [runFixture({ metrics, summary, dataset })],
  });
  const result = await service.getRecommendationEvaluationHistory();
  assert.deepEqual(result.runs[0].metrics, metrics);
  assert.deepEqual(result.runs[0].summary, summary);
  assert.deepEqual(result.runs[0].dataset, dataset);
});

test('48: metric boundary values 0 and 1 inclusive are accepted', async () => {
  for (const value of [0, 1]) {
    const metrics = Object.fromEntries(METRIC_KEYS.map((k) => [k, value]));
    const { service } = createService({ runs: [runFixture({ metrics })] });
    const result = await service.getRecommendationEvaluationHistory();
    assert.equal(result.runs[0].metrics.precision_at_5, value);
  }
});

test('49: multiple stages keep their own stage label on every run', async () => {
  for (const stage of ['collaborative', 'hybrid', 'policy']) {
    const { service } = createService({
      runs: [runFixture({ pipeline_stage: stage })],
    });
    const result = await service.getRecommendationEvaluationHistory({
      pipelineStage: stage,
    });
    assert.equal(result.runs[0].pipeline_stage, stage);
    assert.equal(result.pipeline_stage, stage);
  }
});

test('50: input runs are not mutated by projection', async () => {
  const run = runFixture();
  const before = JSON.stringify({
    run_id: run.run_id,
    metrics: run.metrics,
    dataset: run.dataset,
    configuration: run.configuration,
    payload_sha256: run.payload_sha256,
  });
  const { service } = createService({ runs: [run] });
  await service.getRecommendationEvaluationHistory();
  const after = JSON.stringify({
    run_id: run.run_id,
    metrics: run.metrics,
    dataset: run.dataset,
    configuration: run.configuration,
    payload_sha256: run.payload_sha256,
  });
  assert.equal(after, before);
  assert.ok(run.payload_sha256);
});

// --- source-level guarantees ---

test('51: service source does not query RecommendationEvaluationRun directly', () => {
  const source = readSource('./adminRecommendationHistoryService.js');
  assert.equal(source.includes('RecommendationEvaluationRun.find'), false);
  assert.equal(source.includes('RecommendationEvaluationRun.aggregate'), false);
  assert.equal(source.includes('RecommendationEvaluationRun.create'), false);
  assert.equal(
    source.includes("from '../models/RecommendationEvaluationRun.js'"),
    true,
  );
  assert.equal(source.includes('import RecommendationEvaluationRun'), false);
});

test('52: service source performs exactly one listEvaluationRuns invocation site', () => {
  const source = readSource('./adminRecommendationHistoryService.js');
  const matches = source.match(/listEvaluationRuns\s*\(/g) || [];
  assert.equal(matches.length, 1);
});

test('53: service source has no writes, Python, or child process usage', () => {
  const source = readSource('./adminRecommendationHistoryService.js');
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
    '.find(',
    '.aggregate(',
    'countDocuments',
    'estimatedDocumentCount',
    'distinct(',
  ]) {
    assert.equal(source.includes(token), false, `unexpected token: ${token}`);
  }
});

test('54: service source contains no winner/best/overall scoring labels', () => {
  const source = readSource('./adminRecommendationHistoryService.js');
  for (const token of [
    'overall_score',
    'quality_score',
    'composite_score',
    'winner',
    'best_model',
    'percent',
    'round(',
  ]) {
    assert.equal(source.includes(token), false, `unexpected token: ${token}`);
  }
});

test('55: service source does not import the model default or call ML training', () => {
  const source = readSource('./adminRecommendationHistoryService.js');
  assert.equal(source.includes('TruncatedSVD'), false);
  assert.equal(source.includes('child_process'), false);
  assert.equal(source.includes('train_collaborative_model'), false);
  assert.equal(source.includes('Date.now()'), false);
  assert.match(
    source,
    /from '\.\/recommendationEvaluationRunService\.js'/,
  );
});
