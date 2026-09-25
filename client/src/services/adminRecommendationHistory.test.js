import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_RECOMMENDATION_HISTORY_CONFIGURATION_KEYS,
  ADMIN_RECOMMENDATION_HISTORY_DATASET_KEYS,
  ADMIN_RECOMMENDATION_HISTORY_ERROR_CODES,
  ADMIN_RECOMMENDATION_HISTORY_METRIC_KEYS,
  ADMIN_RECOMMENDATION_HISTORY_PATH,
  ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID_MESSAGE,
  ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED_MESSAGE,
  ADMIN_RECOMMENDATION_HISTORY_SOURCE,
  ADMIN_RECOMMENDATION_HISTORY_STATES,
  ADMIN_RECOMMENDATION_HISTORY_SUMMARY_KEYS,
  DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
  MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  buildAdminRecommendationHistoryPath,
  fetchAdminRecommendationHistory,
  isValidAdminRecommendationHistoryLimit,
  isValidAdminRecommendationHistoryStage,
  normalizeAdminRecommendationHistoryResponse,
} from './adminRecommendationHistory.js';

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
  run_id: 'eval-2026-09-15-policy-1',
  pipeline_stage: 'policy',
  artifact_version: null,
  evaluated_at: '2026-09-15T12:00:00.000Z',
  metrics: metricsFixture(),
  summary: summaryFixture(),
  dataset: datasetFixture(),
  configuration: configurationFixture(),
  ...overrides,
});

const readyEnvelope = (runs, overrides = {}) => ({
  success: true,
  data: {
    state: 'ready',
    source: 'evaluation-history',
    pipeline_stage: 'policy',
    limit: 20,
    count: runs.length,
    runs,
    ...overrides,
  },
});

const noRunsEnvelope = (overrides = {}) => ({
  success: true,
  data: {
    state: 'no-runs',
    source: 'evaluation-history',
    pipeline_stage: 'policy',
    limit: 20,
    count: 0,
    runs: [],
    ...overrides,
  },
});

// --- constants ---

test('1: path, source, defaults, and max are exact', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_HISTORY_PATH,
    '/api/admin/recommendations/history',
  );
  assert.equal(ADMIN_RECOMMENDATION_HISTORY_SOURCE, 'evaluation-history');
  assert.equal(DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT, 20);
  assert.equal(MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT, 100);
  assert.equal(DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE, 'policy');
});

test('2: states and error codes are the exact vocabularies', () => {
  assert.deepEqual(
    Object.values(ADMIN_RECOMMENDATION_HISTORY_STATES).sort(),
    ['error', 'idle', 'loading', 'no-runs', 'ready'],
  );
  assert.equal(
    ADMIN_RECOMMENDATION_HISTORY_ERROR_CODES.REQUEST_FAILED,
    'ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_HISTORY_ERROR_CODES.PAYLOAD_INVALID,
    'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED_MESSAGE,
    'Failed to load evaluation history.',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID_MESSAGE,
    'Evaluation history response was invalid.',
  );
});

test('3: key lists have the required sizes and orders', () => {
  assert.equal(ADMIN_RECOMMENDATION_HISTORY_METRIC_KEYS.length, 10);
  assert.equal(ADMIN_RECOMMENDATION_HISTORY_SUMMARY_KEYS.length, 7);
  assert.equal(ADMIN_RECOMMENDATION_HISTORY_DATASET_KEYS.length, 9);
  assert.equal(ADMIN_RECOMMENDATION_HISTORY_CONFIGURATION_KEYS.length, 9);
  assert.equal(ADMIN_RECOMMENDATION_HISTORY_DATASET_KEYS[0], 'raw_event_count');
  assert.equal(
    ADMIN_RECOMMENDATION_HISTORY_CONFIGURATION_KEYS[0],
    'random_seed',
  );
});

// --- validators ---

test('4: stage validator accepts exact lowercase stages only', () => {
  for (const stage of ['policy', 'hybrid', 'collaborative']) {
    assert.equal(isValidAdminRecommendationHistoryStage(stage), true, stage);
  }
  for (const stage of [
    'Policy',
    'POLICY',
    ' policy',
    'policy ',
    'best',
    '',
    1,
    null,
    undefined,
    ['policy'],
    {},
  ]) {
    assert.equal(
      isValidAdminRecommendationHistoryStage(stage),
      false,
      JSON.stringify(stage),
    );
  }
});

test('5: limit validator accepts integers 1..100 only', () => {
  for (const limit of [1, 20, 100]) {
    assert.equal(isValidAdminRecommendationHistoryLimit(limit), true, limit);
  }
  for (const limit of [
    0,
    -1,
    101,
    1.5,
    NaN,
    Infinity,
    '20',
    null,
    undefined,
    [20],
    {},
    true,
  ]) {
    assert.equal(
      isValidAdminRecommendationHistoryLimit(limit),
      false,
      JSON.stringify(limit),
    );
  }
});

// --- path builder ---

test('6: path builder emits only pipeline_stage and limit', () => {
  assert.equal(
    buildAdminRecommendationHistoryPath('policy', 20),
    '/api/admin/recommendations/history?pipeline_stage=policy&limit=20',
  );
  assert.equal(
    buildAdminRecommendationHistoryPath('collaborative', 1),
    '/api/admin/recommendations/history?pipeline_stage=collaborative&limit=1',
  );
});

test('7: path builder rejects invalid stage or limit', () => {
  assert.throws(() => buildAdminRecommendationHistoryPath('Policy', 20));
  assert.throws(() => buildAdminRecommendationHistoryPath('policy', 0));
  assert.throws(() => buildAdminRecommendationHistoryPath('policy', 101));
  assert.throws(() => buildAdminRecommendationHistoryPath('policy', '20'));
});

// --- normalize: envelope ---

test('8: invalid stage/limit options yield request-failed result', () => {
  const badStage = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([runFixture()]),
    { pipelineStage: 'Policy', limit: 20 },
  );
  assert.equal(badStage.state, 'error');
  assert.equal(
    badStage.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED',
  );

  const badLimit = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([runFixture()]),
    { pipelineStage: 'policy', limit: 0 },
  );
  assert.equal(badLimit.state, 'error');
});

test('9: non-object raw and wrong success flags classify correctly', () => {
  for (const raw of [null, undefined, 'x', 42, []]) {
    const result = normalizeAdminRecommendationHistoryResponse(raw, {
      pipelineStage: 'policy',
      limit: 20,
    });
    assert.equal(result.state, 'error');
    assert.equal(
      result.error.code,
      'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
    );
  }

  const failed = normalizeAdminRecommendationHistoryResponse(
    { success: false, error: 'nope' },
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(
    failed.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED',
  );

  const missingSuccess = normalizeAdminRecommendationHistoryResponse(
    { data: {} },
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(
    missingSuccess.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
  );
});

test('10: wrong source, stage, or limit in data yields payload-invalid', () => {
  const base = readyEnvelope([runFixture()]);
  const wrongSource = normalizeAdminRecommendationHistoryResponse(
    {
      ...base,
      data: { ...base.data, source: 'personalized-snapshot' },
    },
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(
    wrongSource.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
  );

  const wrongStage = normalizeAdminRecommendationHistoryResponse(
    {
      ...base,
      data: { ...base.data, pipeline_stage: 'hybrid' },
    },
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(
    wrongStage.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
  );

  const wrongLimit = normalizeAdminRecommendationHistoryResponse(
    {
      ...base,
      data: { ...base.data, limit: 10 },
    },
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(
    wrongLimit.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
  );
});

test('11: count/runs mismatches yield payload-invalid', () => {
  const cases = [
    { count: 2, runs: [runFixture()] },
    { count: 0, runs: [runFixture()] },
    { count: -1, runs: [] },
    { count: 1.5, runs: [] },
    { count: 21, runs: [] },
    { count: 0, runs: null },
    { count: 0, runs: 'x' },
  ];
  for (const patch of cases) {
    const envelope = readyEnvelope([runFixture()], patch);
    if (patch.runs !== null && patch.runs !== 'x' && patch.count !== 0) {
      envelope.data.state = 'ready';
    }
    const result = normalizeAdminRecommendationHistoryResponse(envelope, {
      pipelineStage: 'policy',
      limit: 20,
    });
    assert.equal(result.state, 'error', JSON.stringify(patch));
    assert.equal(
      result.error.code,
      'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
    );
  }
});

test('12: no-runs envelope normalizes to empty runs with count 0', () => {
  const result = normalizeAdminRecommendationHistoryResponse(
    noRunsEnvelope(),
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(result.state, 'no-runs');
  assert.deepEqual(result.runs, []);
  assert.equal(result.count, 0);
  assert.equal(result.pipelineStage, 'policy');
  assert.equal(result.limit, 20);
  assert.equal(result.error, null);
});

test('13: no-runs with non-empty runs or non-zero count is payload-invalid', () => {
  for (const patch of [
    { runs: [runFixture()] },
    { count: 1 },
    { count: 1, runs: [runFixture()] },
  ]) {
    const result = normalizeAdminRecommendationHistoryResponse(
      noRunsEnvelope(patch),
      { pipelineStage: 'policy', limit: 20 },
    );
    assert.equal(
      result.error.code,
      'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
      JSON.stringify(patch),
    );
  }
});

test('14: ready envelope with zero count is payload-invalid', () => {
  const result = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([], { state: 'ready', count: 0, runs: [] }),
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(
    result.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
  );
});

test('15: ready normalizes runs preserving server order', () => {
  const runs = [
    runFixture({ run_id: 'zzz-newest' }),
    runFixture({ run_id: 'mmm-middle' }),
    runFixture({ run_id: 'aaa-oldest' }),
  ];
  const result = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope(runs),
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(result.state, 'ready');
  assert.equal(result.count, 3);
  assert.deepEqual(
    result.runs.map((r) => r.run_id),
    ['zzz-newest', 'mmm-middle', 'aaa-oldest'],
  );
});

test('16: projected run strips unknown fields and keeps the eight keys', () => {
  const run = runFixture({
    payload_sha256: 'a'.repeat(64),
    schema_version: 1,
    _id: 'x',
    createdAt: 'y',
    updatedAt: 'z',
    winner: 'policy',
  });
  const result = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([run]),
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(result.state, 'ready');
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
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('payload_sha256'), false);
  assert.equal(serialized.includes('winner'), false);
});

test('17: metrics, summary, dataset, configuration key sets are exact', () => {
  const result = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([runFixture()]),
    { pipelineStage: 'policy', limit: 20 },
  );
  const run = result.runs[0];
  assert.deepEqual(Object.keys(run.metrics), [
    ...ADMIN_RECOMMENDATION_HISTORY_METRIC_KEYS,
  ]);
  assert.deepEqual(Object.keys(run.summary), [
    ...ADMIN_RECOMMENDATION_HISTORY_SUMMARY_KEYS,
  ]);
  assert.deepEqual(Object.keys(run.dataset), [
    ...ADMIN_RECOMMENDATION_HISTORY_DATASET_KEYS,
  ]);
  assert.deepEqual(Object.keys(run.configuration), [
    ...ADMIN_RECOMMENDATION_HISTORY_CONFIGURATION_KEYS,
  ]);
});

test('18: corrupt runs fail closed without partial results', () => {
  const corruptRuns = [
    runFixture({ run_id: 'UPPER' }),
    runFixture({ run_id: 'ok', pipeline_stage: 'hybrid' }),
    runFixture({ run_id: 'ok', evaluated_at: 'not-a-date' }),
    runFixture({
      run_id: 'ok',
      metrics: { ...metricsFixture(), precision_at_5: 2 },
    }),
    runFixture({
      run_id: 'ok',
      summary: { ...summaryFixture(), evaluated_user_count: 11 },
    }),
    runFixture({
      run_id: 'ok',
      dataset: { ...datasetFixture(), raw_event_count: 99 },
    }),
    runFixture({ run_id: 'ok', configuration: { random_seed: -1 } }),
    runFixture({ run_id: 'ok', configuration: {} }),
    null,
    'x',
    [],
  ];
  for (const run of corruptRuns) {
    const result = normalizeAdminRecommendationHistoryResponse(
      readyEnvelope([run]),
      { pipelineStage: 'policy', limit: 20 },
    );
    assert.equal(
      result.error.code,
      'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
      JSON.stringify(run && run.run_id),
    );
  }
});

test('19: dataset conservation is enforced client-side', () => {
  const run = runFixture({
    dataset: {
      ...datasetFixture(),
      raw_event_count: 50,
      train_event_count: 10,
      validation_event_count: 10,
      test_event_count: 10,
    },
  });
  const result = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([run]),
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(
    result.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
  );
});

test('20: weight pair invariants are enforced client-side', () => {
  const badConfigurations = [
    { random_seed: 42, collaborative_weight: 0.7 },
    {
      random_seed: 42,
      collaborative_weight: 0.9,
      content_weight: 0.3,
    },
    { random_seed: 42, base_hybrid_policy_weight: 0.8 },
    {
      random_seed: 42,
      base_hybrid_policy_weight: 0.5,
      explicit_profile_policy_weight: 0.4,
    },
    { random_seed: 42, requested_components: 8, effective_components: 16 },
  ];
  for (const configuration of badConfigurations) {
    const result = normalizeAdminRecommendationHistoryResponse(
      readyEnvelope([runFixture({ configuration })]),
      { pipelineStage: 'policy', limit: 20 },
    );
    assert.equal(
      result.error.code,
      'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
      JSON.stringify(configuration),
    );
  }
});

test('21: missing optional configuration keys normalize to null', () => {
  const result = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([runFixture({ configuration: { random_seed: 7 } })]),
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(result.state, 'ready');
  const configuration = result.runs[0].configuration;
  assert.equal(configuration.random_seed, 7);
  assert.equal(configuration.algorithm, null);
  assert.equal(configuration.collaborative_weight, null);
  assert.equal(configuration.exploration_interval, null);
  assert.deepEqual(Object.keys(configuration), [
    ...ADMIN_RECOMMENDATION_HISTORY_CONFIGURATION_KEYS,
  ]);
});

test('22: artifact_version null and safe identifiers are preserved', () => {
  const withNull = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([runFixture({ artifact_version: null })]),
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(withNull.runs[0].artifact_version, null);

  const withVersion = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([runFixture({ artifact_version: 'rel-1.0.0' })]),
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(withVersion.runs[0].artifact_version, 'rel-1.0.0');

  const unsafe = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([runFixture({ artifact_version: 'UPPER' })]),
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(
    unsafe.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
  );
});

// --- fetch ---

test('23: fetch with invalid inputs performs zero requests', async () => {
  let calls = 0;
  const client = {
    get: async () => {
      calls += 1;
      return {};
    },
  };
  const badStage = await fetchAdminRecommendationHistory({
    pipelineStage: 'Policy',
    limit: 20,
    apiClient: client,
  });
  assert.equal(calls, 0);
  assert.equal(badStage.state, 'error');

  const badLimit = await fetchAdminRecommendationHistory({
    pipelineStage: 'policy',
    limit: 0,
    apiClient: client,
  });
  assert.equal(calls, 0);
  assert.equal(badLimit.state, 'error');

  const noClient = await fetchAdminRecommendationHistory({
    pipelineStage: 'policy',
    limit: 20,
  });
  assert.equal(calls, 0);
  assert.equal(noClient.state, 'error');
});

test('24: fetch performs exactly one GET with the built path', async () => {
  const seen = [];
  const client = {
    get: async (path) => {
      seen.push(path);
      return noRunsEnvelope({ pipeline_stage: 'hybrid', limit: 5 });
    },
  };
  const result = await fetchAdminRecommendationHistory({
    pipelineStage: 'hybrid',
    limit: 5,
    apiClient: client,
  });
  assert.equal(seen.length, 1);
  assert.equal(
    seen[0],
    '/api/admin/recommendations/history?pipeline_stage=hybrid&limit=5',
  );
  assert.equal(result.state, 'no-runs');
});

test('25: fetch forwards signal only when provided', async () => {
  const seenArgs = [];
  const controller = new AbortController();
  const client = {
    get: async (...args) => {
      seenArgs.push(args);
      return noRunsEnvelope();
    },
  };
  await fetchAdminRecommendationHistory({
    pipelineStage: 'policy',
    limit: 20,
    apiClient: client,
  });
  assert.equal(seenArgs[0].length, 1);

  await fetchAdminRecommendationHistory({
    pipelineStage: 'policy',
    limit: 20,
    apiClient: client,
    signal: controller.signal,
  });
  assert.equal(seenArgs[1].length, 2);
  assert.equal(seenArgs[1][1].signal, controller.signal);
});

test('26: fetch maps thrown errors to request-failed without retry', async () => {
  let calls = 0;
  const client = {
    get: async () => {
      calls += 1;
      throw new Error('network down mongodb://secret');
    },
  };
  const result = await fetchAdminRecommendationHistory({
    pipelineStage: 'policy',
    limit: 20,
    apiClient: client,
  });
  assert.equal(calls, 1);
  assert.equal(result.state, 'error');
  assert.equal(
    result.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED',
  );
  assert.equal(JSON.stringify(result).includes('mongodb://'), false);
});

test('27: fetch success:false maps to request-failed not payload-invalid', async () => {
  const client = {
    get: async () => ({ success: false, error: 'nope' }),
  };
  const result = await fetchAdminRecommendationHistory({
    pipelineStage: 'policy',
    limit: 20,
    apiClient: client,
  });
  assert.equal(
    result.error.code,
    'ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED',
  );
});

test('28: no overall/winner/best labels appear in normalized results', () => {
  const result = normalizeAdminRecommendationHistoryResponse(
    readyEnvelope([runFixture()]),
    { pipelineStage: 'policy', limit: 20 },
  );
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

test('29: default fetch options use policy stage and limit 20', async () => {
  const seen = [];
  const client = {
    get: async (path) => {
      seen.push(path);
      return noRunsEnvelope();
    },
  };
  await fetchAdminRecommendationHistory({ apiClient: client });
  assert.equal(
    seen[0],
    '/api/admin/recommendations/history?pipeline_stage=policy&limit=20',
  );
});
