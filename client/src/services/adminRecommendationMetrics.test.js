import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ADMIN_RECOMMENDATION_METRICS_PATH,
  ADMIN_RECOMMENDATION_METRICS_SOURCE,
  ADMIN_RECOMMENDATION_METRICS_STATES,
  ADMIN_RECOMMENDATION_METRICS_ERROR_CODES,
  ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED_MESSAGE,
  ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID_MESSAGE,
  ADMIN_RECOMMENDATION_PIPELINE_STAGES,
  ADMIN_RECOMMENDATION_METRIC_KEYS,
  ADMIN_RECOMMENDATION_SUMMARY_KEYS,
  DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
  buildAdminRecommendationMetricsPath,
  fetchAdminRecommendationMetrics,
  isValidAdminRecommendationPipelineStage,
  normalizeAdminRecommendationMetricsResponse,
} from './adminRecommendationMetrics.js';

const VALID_METRICS = Object.freeze({
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
});

const VALID_SUMMARY = Object.freeze({
  evaluated_user_count: 10,
  recommendation_user_count: 15,
  relevance_user_count: 12,
  catalog_size: 100,
  unique_recommended_at_10: 80,
  diversity_evaluable_user_count: 8,
  diversity_pair_count: 36,
});

const readyLatest = (overrides = {}) => ({
  run_id: 'run-2026-09-15',
  pipeline_stage: 'policy',
  artifact_version: 'v1.0.0',
  evaluated_at: '2026-09-15T12:00:00.000Z',
  metrics: { ...VALID_METRICS },
  summary: { ...VALID_SUMMARY },
  ...overrides,
});

const readyPayload = (stage = 'policy', latest = readyLatest()) => ({
  success: true,
  data: {
    state: 'ready',
    source: ADMIN_RECOMMENDATION_METRICS_SOURCE,
    pipeline_stage: stage,
    latest,
  },
});

const noRunsPayload = (stage = 'policy') => ({
  success: true,
  data: {
    state: 'no-runs',
    source: ADMIN_RECOMMENDATION_METRICS_SOURCE,
    pipeline_stage: stage,
    latest: null,
  },
});

// ============================================================
// CONSTANTS
// ============================================================

test('constants: metrics path is exact', () => {
  assert.equal(ADMIN_RECOMMENDATION_METRICS_PATH, '/api/admin/recommendations/metrics');
});

test('constants: source is evaluation-history', () => {
  assert.equal(ADMIN_RECOMMENDATION_METRICS_SOURCE, 'evaluation-history');
});

test('constants: default stage is policy', () => {
  assert.equal(DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE, 'policy');
});

test('constants: stages are policy, hybrid, collaborative in order', () => {
  assert.deepEqual([...ADMIN_RECOMMENDATION_PIPELINE_STAGES], ['policy', 'hybrid', 'collaborative']);
});

test('constants: stages are frozen', () => {
  assert.equal(Object.isFrozen(ADMIN_RECOMMENDATION_PIPELINE_STAGES), true);
});

test('constants: five states', () => {
  assert.deepEqual(Object.values(ADMIN_RECOMMENDATION_METRICS_STATES).sort(), [
    'error',
    'idle',
    'loading',
    'no-runs',
    'ready',
  ]);
});

test('constants: error codes exact', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_METRICS_ERROR_CODES.REQUEST_FAILED,
    'ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED',
  );
  assert.equal(
    ADMIN_RECOMMENDATION_METRICS_ERROR_CODES.PAYLOAD_INVALID,
    'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID',
  );
});

test('constants: request failed message exact', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED_MESSAGE,
    'Failed to load recommendation metrics.',
  );
});

test('constants: payload invalid message exact', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID_MESSAGE,
    'Recommendation metrics response was invalid.',
  );
});

test('constants: ten metric keys in fixed order', () => {
  assert.deepEqual([...ADMIN_RECOMMENDATION_METRIC_KEYS], [
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

test('constants: seven summary keys in fixed order', () => {
  assert.deepEqual([...ADMIN_RECOMMENDATION_SUMMARY_KEYS], [
    'evaluated_user_count',
    'recommendation_user_count',
    'relevance_user_count',
    'catalog_size',
    'unique_recommended_at_10',
    'diversity_evaluable_user_count',
    'diversity_pair_count',
  ]);
});

test('constants: no history or dataset path constants', () => {
  assert.equal(ADMIN_RECOMMENDATION_METRICS_PATH.includes('/history'), false);
  assert.equal(ADMIN_RECOMMENDATION_METRICS_PATH.includes('/dataset'), false);
});

// ============================================================
// STAGE VALIDATION
// ============================================================

test('stage: accepts exact lowercase stages', () => {
  for (const stage of ADMIN_RECOMMENDATION_PIPELINE_STAGES) {
    assert.equal(isValidAdminRecommendationPipelineStage(stage), true);
  }
});

test('stage: rejects case variants without trim/coerce', () => {
  for (const stage of ['Policy', 'POLICY', 'Hybrid', 'Collaborative', ' policy', 'policy ']) {
    assert.equal(isValidAdminRecommendationPipelineStage(stage), false, stage);
  }
});

test('stage: rejects non-strings and empty', () => {
  for (const stage of [undefined, null, 0, 1, true, false, {}, [], '', 'unknown', 'best']) {
    assert.equal(isValidAdminRecommendationPipelineStage(stage), false, String(stage));
  }
});

// ============================================================
// PATH BUILDING
// ============================================================

test('path: default policy path exact', () => {
  assert.equal(
    buildAdminRecommendationMetricsPath('policy'),
    '/api/admin/recommendations/metrics?pipeline_stage=policy',
  );
});

test('path: hybrid path exact', () => {
  assert.equal(
    buildAdminRecommendationMetricsPath('hybrid'),
    '/api/admin/recommendations/metrics?pipeline_stage=hybrid',
  );
});

test('path: collaborative path exact', () => {
  assert.equal(
    buildAdminRecommendationMetricsPath('collaborative'),
    '/api/admin/recommendations/metrics?pipeline_stage=collaborative',
  );
});

test('path: invalid stage throws without silent fallback', () => {
  assert.throws(() => buildAdminRecommendationMetricsPath('Policy'), /invalid pipeline stage/);
  assert.throws(() => buildAdminRecommendationMetricsPath(''), /invalid pipeline stage/);
  assert.throws(() => buildAdminRecommendationMetricsPath(undefined), /invalid pipeline stage/);
});

test('path: never emits history, dataset, or extra query keys', () => {
  const path = buildAdminRecommendationMetricsPath('policy');
  assert.equal(path.includes('history'), false);
  assert.equal(path.includes('dataset'), false);
  assert.equal(path.includes('limit='), false);
  assert.equal(path.includes('user'), false);
  assert.equal(path.includes('&'), false);
});

// ============================================================
// NORMALIZE — envelope
// ============================================================

test('normalize: non-object raw is payload invalid', () => {
  for (const raw of [null, undefined, 'ok', 42, true, []]) {
    const result = normalizeAdminRecommendationMetricsResponse(raw, { pipelineStage: 'policy' });
    assert.equal(result.state, 'error');
    assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
    assert.equal(result.latest, null);
  }
});

test('normalize: success false is request failed with fixed message', () => {
  const result = normalizeAdminRecommendationMetricsResponse(
    { success: false, error: 'failed to load recommendation metrics' },
    { pipelineStage: 'policy' },
  );
  assert.equal(result.state, 'error');
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED');
  assert.equal(result.error.message, 'Failed to load recommendation metrics.');
});

test('normalize: success false does not leak server error text', () => {
  const result = normalizeAdminRecommendationMetricsResponse(
    { success: false, error: 'Mongo connect ECONNREFUSED 127.0.0.1:27017' },
    { pipelineStage: 'policy' },
  );
  assert.equal(result.error.message, 'Failed to load recommendation metrics.');
  assert.equal(JSON.stringify(result).includes('ECONNREFUSED'), false);
});

test('normalize: missing success is payload invalid', () => {
  const result = normalizeAdminRecommendationMetricsResponse({}, { pipelineStage: 'policy' });
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: missing data is payload invalid', () => {
  const result = normalizeAdminRecommendationMetricsResponse(
    { success: true },
    { pipelineStage: 'policy' },
  );
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: wrong source is payload invalid', () => {
  const result = normalizeAdminRecommendationMetricsResponse(
    {
      success: true,
      data: {
        state: 'no-runs',
        source: 'personalized-snapshot',
        pipeline_stage: 'policy',
        latest: null,
      },
    },
    { pipelineStage: 'policy' },
  );
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: stage mismatch is payload invalid', () => {
  const result = normalizeAdminRecommendationMetricsResponse(
    noRunsPayload('hybrid'),
    { pipelineStage: 'policy' },
  );
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: unknown data.state is payload invalid', () => {
  const result = normalizeAdminRecommendationMetricsResponse(
    {
      success: true,
      data: {
        state: 'best',
        source: ADMIN_RECOMMENDATION_METRICS_SOURCE,
        pipeline_stage: 'policy',
        latest: null,
      },
    },
    { pipelineStage: 'policy' },
  );
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: invalid requested stage is request failed', () => {
  const result = normalizeAdminRecommendationMetricsResponse(
    readyPayload(),
    { pipelineStage: 'Policy' },
  );
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED');
});

// ============================================================
// NORMALIZE — no-runs
// ============================================================

test('normalize: valid no-runs returns no-runs with null latest', () => {
  const result = normalizeAdminRecommendationMetricsResponse(noRunsPayload('policy'), {
    pipelineStage: 'policy',
  });
  assert.equal(result.state, 'no-runs');
  assert.equal(result.latest, null);
  assert.equal(result.pipelineStage, 'policy');
  assert.equal(result.error, null);
});

test('normalize: no-runs with non-null latest is payload invalid', () => {
  const payload = noRunsPayload('policy');
  payload.data.latest = readyLatest();
  const result = normalizeAdminRecommendationMetricsResponse(payload, { pipelineStage: 'policy' });
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

// ============================================================
// NORMALIZE — ready
// ============================================================

test('normalize: valid ready returns ready with whitelist latest only', () => {
  const latest = readyLatest({ extra_field: 'drop-me' });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.pipelineStage, 'policy');
  assert.equal(result.error, null);
  assert.deepEqual(Object.keys(result.latest).sort(), [
    'artifact_version',
    'evaluated_at',
    'metrics',
    'pipeline_stage',
    'run_id',
    'summary',
  ]);
  assert.equal(Object.hasOwn(result.latest, 'extra_field'), false);
  assert.equal(Object.hasOwn(result.latest, 'payload_sha256'), false);
  assert.equal(Object.hasOwn(result.latest, 'dataset'), false);
  assert.equal(Object.hasOwn(result.latest, 'configuration'), false);
});

test('normalize: ready metrics values preserved as finite numbers in [0,1]', () => {
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload(), {
    pipelineStage: 'policy',
  });
  for (const key of ADMIN_RECOMMENDATION_METRIC_KEYS) {
    const value = result.latest.metrics[key];
    assert.equal(typeof value, 'number');
    assert.equal(Number.isFinite(value), true);
    assert.ok(value >= 0 && value <= 1);
  }
});

test('normalize: metric out of range is payload invalid', () => {
  for (const bad of [-0.01, 1.01, NaN, Infinity, '0.5', null]) {
    const latest = readyLatest({
      metrics: { ...VALID_METRICS, precision_at_5: bad },
    });
    const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
      pipelineStage: 'policy',
    });
    assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID', String(bad));
  }
});

test('normalize: missing metric key is payload invalid', () => {
  const metrics = { ...VALID_METRICS };
  delete metrics.diversity;
  const result = normalizeAdminRecommendationMetricsResponse(
    readyPayload('policy', readyLatest({ metrics })),
    { pipelineStage: 'policy' },
  );
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: non-integer summary count is payload invalid', () => {
  const latest = readyLatest({
    summary: { ...VALID_SUMMARY, catalog_size: 100.5 },
  });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: negative summary count is payload invalid', () => {
  const latest = readyLatest({
    summary: { ...VALID_SUMMARY, evaluated_user_count: -1 },
  });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: evaluated_user_count greater than relevance_user_count is invalid', () => {
  const latest = readyLatest({
    summary: { ...VALID_SUMMARY, evaluated_user_count: 20, relevance_user_count: 10 },
  });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: unique_recommended_at_10 greater than catalog_size is invalid', () => {
  const latest = readyLatest({
    summary: { ...VALID_SUMMARY, unique_recommended_at_10: 101, catalog_size: 100 },
  });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: diversity_evaluable greater than evaluated is invalid', () => {
  const latest = readyLatest({
    summary: { ...VALID_SUMMARY, diversity_evaluable_user_count: 11, evaluated_user_count: 10 },
  });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: recommendation_user_count may exceed evaluated_user_count', () => {
  const latest = readyLatest({
    summary: { ...VALID_SUMMARY, recommendation_user_count: 50, evaluated_user_count: 10 },
  });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  assert.equal(result.state, 'ready');
});

test('normalize: unsafe run_id is payload invalid', () => {
  for (const run_id of ['', '../etc', 'RUN-1', 'run id', 'a'.repeat(65), 42, null]) {
    const latest = readyLatest({ run_id });
    const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
      pipelineStage: 'policy',
    });
    assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID', String(run_id));
  }
});

test('normalize: valid run_id patterns accepted', () => {
  for (const run_id of ['a', 'run-1', 'run_1', 'run.1', '0', 'z'.repeat(64)]) {
    const latest = readyLatest({ run_id });
    const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
      pipelineStage: 'policy',
    });
    assert.equal(result.state, 'ready', run_id);
  }
});

test('normalize: null artifact_version accepted', () => {
  const latest = readyLatest({ artifact_version: null });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.latest.artifact_version, null);
});

test('normalize: invalid artifact_version is payload invalid', () => {
  for (const artifact_version of ['UPPER', 'x/y', 1, '']) {
    const latest = readyLatest({ artifact_version });
    const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
      pipelineStage: 'policy',
    });
    assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID', String(artifact_version));
  }
});

test('normalize: invalid evaluated_at is payload invalid', () => {
  for (const evaluated_at of ['', 'not-a-date', 42, null, undefined]) {
    const latest = readyLatest({ evaluated_at });
    const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
      pipelineStage: 'policy',
    });
    assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID', String(evaluated_at));
  }
});

test('normalize: latest stage mismatch is payload invalid', () => {
  const latest = readyLatest({ pipeline_stage: 'hybrid' });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: missing latest on ready is payload invalid', () => {
  const result = normalizeAdminRecommendationMetricsResponse(
    {
      success: true,
      data: {
        state: 'ready',
        source: ADMIN_RECOMMENDATION_METRICS_SOURCE,
        pipeline_stage: 'policy',
        latest: null,
      },
    },
    { pipelineStage: 'policy' },
  );
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID');
});

test('normalize: strips forbidden projection fields if present on latest', () => {
  const latest = readyLatest({
    payload_sha256: 'deadbeef',
    dataset: { raw_event_count: 1 },
    configuration: { random_seed: 42 },
    _id: 'abc',
    user_id: 'u1',
  });
  const result = normalizeAdminRecommendationMetricsResponse(readyPayload('policy', latest), {
    pipelineStage: 'policy',
  });
  const serialized = JSON.stringify(result.latest);
  for (const token of ['payload_sha256', 'dataset', 'configuration', 'user_id', 'deadbeef']) {
    assert.equal(serialized.includes(token), false, token);
  }
});

// ============================================================
// FETCH
// ============================================================

test('fetch: invalid stage returns request failed with zero calls', async () => {
  let calls = 0;
  const result = await fetchAdminRecommendationMetrics({
    pipelineStage: 'Policy',
    apiClient: {
      get: async () => {
        calls += 1;
        return noRunsPayload();
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.state, 'error');
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED');
});

test('fetch: missing api client returns request failed with zero calls', async () => {
  const result = await fetchAdminRecommendationMetrics({ pipelineStage: 'policy' });
  assert.equal(result.state, 'error');
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED');
});

test('fetch: api client without get returns request failed', async () => {
  const result = await fetchAdminRecommendationMetrics({
    pipelineStage: 'policy',
    apiClient: {},
  });
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED');
});

test('fetch: default stage is policy when omitted', async () => {
  const paths = [];
  const result = await fetchAdminRecommendationMetrics({
    apiClient: {
      get: async (path) => {
        paths.push(path);
        return noRunsPayload('policy');
      },
    },
  });
  assert.deepEqual(paths, ['/api/admin/recommendations/metrics?pipeline_stage=policy']);
  assert.equal(result.state, 'no-runs');
  assert.equal(result.pipelineStage, 'policy');
});

test('fetch: exactly one GET per call', async () => {
  let calls = 0;
  await fetchAdminRecommendationMetrics({
    pipelineStage: 'hybrid',
    apiClient: {
      get: async () => {
        calls += 1;
        return noRunsPayload('hybrid');
      },
    },
  });
  assert.equal(calls, 1);
});

test('fetch: thrown client error becomes request failed', async () => {
  const result = await fetchAdminRecommendationMetrics({
    pipelineStage: 'policy',
    apiClient: {
      get: async () => {
        throw new Error('boom secret-token');
      },
    },
  });
  assert.equal(result.state, 'error');
  assert.equal(result.error.code, 'ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED');
  assert.equal(result.error.message, 'Failed to load recommendation metrics.');
  assert.equal(JSON.stringify(result).includes('secret-token'), false);
});

test('fetch: successful ready payload classifies ready', async () => {
  const result = await fetchAdminRecommendationMetrics({
    pipelineStage: 'policy',
    apiClient: { get: async () => readyPayload('policy') },
  });
  assert.equal(result.state, 'ready');
  assert.equal(result.latest.run_id, 'run-2026-09-15');
});

test('fetch: forwards signal when provided without requiring it', async () => {
  const controller = new AbortController();
  let seenOptions;
  await fetchAdminRecommendationMetrics({
    pipelineStage: 'policy',
    signal: controller.signal,
    apiClient: {
      get: async (path, options) => {
        seenOptions = options;
        return noRunsPayload();
      },
    },
  });
  assert.ok(seenOptions);
  assert.equal(seenOptions.signal, controller.signal);
});

test('fetch: omits options argument when signal absent', async () => {
  let seenArgCount = 0;
  await fetchAdminRecommendationMetrics({
    pipelineStage: 'policy',
    apiClient: {
      get: (...args) => {
        seenArgCount = args.length;
        return Promise.resolve(noRunsPayload());
      },
    },
  });
  assert.equal(seenArgCount, 1);
});

test('fetch: concurrent stage calls keep independent results', async () => {
  const [policy, hybrid] = await Promise.all([
    fetchAdminRecommendationMetrics({
      pipelineStage: 'policy',
      apiClient: { get: async () => noRunsPayload('policy') },
    }),
    fetchAdminRecommendationMetrics({
      pipelineStage: 'hybrid',
      apiClient: {
        get: async () => readyPayload('hybrid', readyLatest({ pipeline_stage: 'hybrid' })),
      },
    }),
  ]);
  assert.equal(policy.state, 'no-runs');
  assert.equal(policy.pipelineStage, 'policy');
  assert.equal(hybrid.state, 'ready');
  assert.equal(hybrid.pipelineStage, 'hybrid');
  assert.equal(hybrid.latest.pipeline_stage, 'hybrid');
});
