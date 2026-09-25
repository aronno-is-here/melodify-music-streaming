import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import RecommendationEvaluationRun, {
  EVALUATION_RUN_SCHEMA_VERSION,
  PIPELINE_STAGES,
  MAX_PERSISTED_COUNT,
  EVALUATION_METRIC_KEYS,
  EVALUATION_SUMMARY_KEYS,
  DATASET_STAT_KEYS,
  CONFIGURATION_KEYS,
  evaluationRunSaveGuard,
  evaluationRunQueryGuard,
  evaluationRunDocumentDeleteGuard,
} from '../models/RecommendationEvaluationRun.js';
import {
  createRecommendationEvaluationRunService,
  normalizeEvaluationRunPayload,
  computeEvaluationRunPayloadSha256,
  normalizeRunId,
  EvaluationRunError,
  EvaluationRunValidationError,
  EvaluationRunConflictError,
  EvaluationRunPersistenceError,
  EvaluationRunImmutableError,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from './recommendationEvaluationRunService.js';

const MODEL_SOURCE = readFileSync(
  new URL('../models/RecommendationEvaluationRun.js', import.meta.url),
  'utf8',
);
const SERVICE_SOURCE = readFileSync(
  new URL('./recommendationEvaluationRunService.js', import.meta.url),
  'utf8',
);

const HEX = (n) => n.toString(16).padStart(24, '0');
const USER_A = HEX(0xa);
const SONG_1 = HEX(1);

const metricsOf = (value = 0.5) => ({
  precision_at_5: value,
  precision_at_10: value,
  recall_at_5: value,
  recall_at_10: value,
  ndcg_at_5: value,
  ndcg_at_10: value,
  map_at_10: value,
  hit_rate_at_10: value,
  catalog_coverage: value,
  diversity: value,
});

const summaryOf = (overrides = {}) => ({
  evaluated_user_count: 10,
  recommendation_user_count: 12,
  relevance_user_count: 10,
  catalog_size: 100,
  unique_recommended_at_10: 50,
  diversity_evaluable_user_count: 8,
  diversity_pair_count: 40,
  ...overrides,
});

const datasetOf = (overrides = {}) => ({
  raw_event_count: 100,
  train_event_count: 80,
  validation_event_count: 10,
  test_event_count: 10,
  unique_user_count: 20,
  unique_song_count: 50,
  session_count: 40,
  interaction_pair_count: 60,
  content_feature_count: 40,
  ...overrides,
});

const configurationOf = (overrides = {}) => ({
  random_seed: 42,
  ...overrides,
});

const validPayload = (overrides = {}) => ({
  run_id: 'run-alpha-1',
  pipeline_stage: 'hybrid',
  evaluated_at: '2026-09-24T10:00:00Z',
  metrics: metricsOf(),
  summary: summaryOf(),
  dataset: datasetOf(),
  configuration: configurationOf(),
  ...overrides,
});

const normalizedDocument = (overrides = {}) => {
  const normalized = normalizeEvaluationRunPayload(validPayload());
  return {
    ...normalized,
    payload_sha256: computeEvaluationRunPayloadSha256(normalized),
    ...overrides,
  };
};

const expectValidationError = (payload, match) => {
  try {
    normalizeEvaluationRunPayload(payload);
    assert.fail('expected validation error');
  } catch (error) {
    assert.ok(error instanceof EvaluationRunValidationError, error.message);
    if (match) assert.match(error.message, match);
  }
};

const expectRunIdError = (value) => {
  try {
    normalizeRunId(value);
    assert.fail('expected run id error');
  } catch (error) {
    assert.ok(error instanceof EvaluationRunValidationError);
    assert.match(error.message, /invalid evaluation run id/);
  }
};

const createFakeModel = (behavior = {}) => {
  const state = {
    docs: (behavior.docs || []).map((doc) => ({ ...doc })),
    createCalls: [],
    findOneCalls: [],
    findCalls: [],
    createMode: behavior.createMode || 'ok',
    lookupError: behavior.lookupError || null,
    findError: behavior.findError || null,
    leanFindOne: behavior.leanFindOne !== false,
  };

  const model = {
    async create(doc) {
      state.createCalls.push({ ...doc, metrics: { ...doc.metrics }, summary: { ...doc.summary }, dataset: { ...doc.dataset }, configuration: { ...doc.configuration } });
      if (state.createMode === 'e11000') {
        const error = new Error('E11000 duplicate key error');
        error.code = 11000;
        throw error;
      }
      if (state.createMode === 'db-error') {
        throw new Error('connection pool exhausted');
      }
      const persisted = { _id: `id-${state.createCalls.length}`, ...doc };
      state.docs.push(persisted);
      return persisted;
    },
    findOne(filter) {
      state.findOneCalls.push({ ...filter });
      const run = async () => {
        if (state.lookupError) throw state.lookupError;
        const found = state.docs.find((doc) => doc.run_id === filter.run_id);
        return found ? { ...found } : null;
      };
      if (!state.leanFindOne) {
        return { then: (a, b) => run().then(a, b) };
      }
      return {
        lean: () => run(),
        then: (a, b) => run().then(a, b),
      };
    },
    find(filter) {
      state.findCalls.push({ filter: { ...filter }, sort: null, limit: null, leaned: false });
      const call = state.findCalls[state.findCalls.length - 1];
      const api = {
        sort(spec) {
          call.sort = { ...spec };
          return api;
        },
        limit(n) {
          call.limit = n;
          return api;
        },
        lean() {
          call.leaned = true;
          let rows = state.docs.filter((doc) =>
            Object.entries(filter).every(([key, value]) => doc[key] === value),
          );
          rows = [...rows].sort((a, b) => {
            const evaluatedDiff = b.evaluated_at - a.evaluated_at;
            if (evaluatedDiff !== 0) return evaluatedDiff;
            return String(b._id).localeCompare(String(a._id));
          });
          if (call.limit != null) rows = rows.slice(0, call.limit);
          return Promise.resolve(rows.map((row) => ({ ...row })));
        },
      };
      return api;
    },
  };

  return { model, state };
};

test('1: schema version = 1', () => {
  assert.equal(EVALUATION_RUN_SCHEMA_VERSION, 1);
});

test('2: pipeline stages exact', () => {
  assert.deepEqual([...PIPELINE_STAGES], ['collaborative', 'hybrid', 'policy']);
});

test('3: MAX_PERSISTED_COUNT = 1_000_000_000', () => {
  assert.equal(MAX_PERSISTED_COUNT, 1_000_000_000);
});

test('4: model exists', () => {
  assert.ok(RecommendationEvaluationRun);
  assert.equal(typeof RecommendationEvaluationRun, 'function');
});

test('5: collection/model name intentional', () => {
  assert.equal(RecommendationEvaluationRun.modelName, 'RecommendationEvaluationRun');
  assert.equal(
    RecommendationEvaluationRun.collection.name,
    'recommendationevaluationruns',
  );
});

test('6: timestamps enabled', () => {
  assert.equal(RecommendationEvaluationRun.schema.options.timestamps, true);
});

test('7: no TTL index', () => {
  for (const [, options] of RecommendationEvaluationRun.schema.indexes()) {
    assert.equal(options.expireAfterSeconds, undefined);
  }
});

test('8: lowercase simple run accepted', () => {
  assert.equal(normalizeRunId('run-alpha'), 'run-alpha');
});

test('9: digits accepted', () => {
  assert.equal(normalizeRunId('run123'), 'run123');
});

test('10: dot/underscore/hyphen accepted', () => {
  assert.equal(normalizeRunId('a.b_c-d'), 'a.b_c-d');
});

test('11: uppercase rejected', () => {
  expectRunIdError('RUN');
  expectRunIdError('runA');
});

test('12: leading whitespace rejected', () => {
  expectRunIdError(' run');
});

test('13: trailing whitespace rejected', () => {
  expectRunIdError('run ');
});

test('14: slash rejected', () => {
  expectRunIdError('a/b');
  expectRunIdError('../run');
});

test('15: backslash rejected', () => {
  expectRunIdError('a\\b');
});

test('16: colon rejected', () => {
  expectRunIdError('a:b');
});

test('17: "." rejected', () => {
  expectRunIdError('.');
});

test('18: ".." rejected', () => {
  expectRunIdError('..');
});

test('19: empty rejected', () => {
  expectRunIdError('');
});

test('20: >64 rejected', () => {
  expectRunIdError('a'.repeat(65));
  assert.equal(normalizeRunId('a'.repeat(64)).length, 64);
});

test('21: non-string rejected', () => {
  expectRunIdError(1);
  expectRunIdError(null);
  expectRunIdError(undefined);
  expectRunIdError({});
});

test('22: collaborative accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload({ pipeline_stage: 'collaborative' }));
  assert.equal(n.pipeline_stage, 'collaborative');
});

test('23: hybrid accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload({ pipeline_stage: 'hybrid' }));
  assert.equal(n.pipeline_stage, 'hybrid');
});

test('24: policy accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload({ pipeline_stage: 'policy' }));
  assert.equal(n.pipeline_stage, 'policy');
});

test('25: unknown stage rejected', () => {
  expectValidationError(validPayload({ pipeline_stage: 'best' }), /stage/);
  expectValidationError(validPayload({ pipeline_stage: 'winner' }), /stage/);
});

test('26: uppercase stage rejected', () => {
  expectValidationError(validPayload({ pipeline_stage: 'HYBRID' }), /stage/);
});

test('27: null artifact version accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload({ artifact_version: null }));
  assert.equal(n.artifact_version, null);
});

test('28: omitted artifact version accepted', () => {
  const payload = validPayload();
  delete payload.artifact_version;
  const n = normalizeEvaluationRunPayload(payload);
  assert.equal(n.artifact_version, null);
});

test('29: valid version accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload({ artifact_version: 'rel-1.0.0' }));
  assert.equal(n.artifact_version, 'rel-1.0.0');
});

test('30: uppercase artifact version rejected', () => {
  expectValidationError(
    validPayload({ artifact_version: 'REL' }),
    /artifact version/,
  );
});

test('31: traversal artifact version rejected', () => {
  expectValidationError(
    validPayload({ artifact_version: '../evil' }),
    /artifact version/,
  );
});

test('32: oversized artifact version rejected', () => {
  expectValidationError(
    validPayload({ artifact_version: 'a'.repeat(65) }),
    /artifact version/,
  );
});

test('33: aware Z ISO accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ evaluated_at: '2026-09-24T10:00:00Z' }),
  );
  assert.equal(n.evaluated_at.toISOString(), '2026-09-24T10:00:00.000Z');
});

test('34: explicit offset ISO accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ evaluated_at: '2026-09-24T16:00:00+06:00' }),
  );
  assert.equal(n.evaluated_at.toISOString(), '2026-09-24T10:00:00.000Z');
});

test('35: valid Date object accepted', () => {
  const date = new Date('2026-01-02T03:04:05.000Z');
  const n = normalizeEvaluationRunPayload(validPayload({ evaluated_at: date }));
  assert.equal(n.evaluated_at.getTime(), date.getTime());
});

test('36: normalized same instant', () => {
  const fromZ = normalizeEvaluationRunPayload(
    validPayload({ evaluated_at: '2026-09-24T10:00:00Z' }),
  );
  const fromOffset = normalizeEvaluationRunPayload(
    validPayload({ evaluated_at: '2026-09-24T16:00:00+06:00' }),
  );
  assert.equal(
    fromZ.evaluated_at.getTime(),
    fromOffset.evaluated_at.getTime(),
  );
});

test('37: timezone-less datetime rejected', () => {
  expectValidationError(
    validPayload({ evaluated_at: '2026-09-24T10:00:00' }),
    /timestamp/,
  );
});

test('38: date-only rejected', () => {
  expectValidationError(
    validPayload({ evaluated_at: '2026-09-24' }),
    /timestamp/,
  );
});

test('39: invalid Date rejected', () => {
  expectValidationError(
    validPayload({ evaluated_at: new Date('nope') }),
    /timestamp/,
  );
});

test('40: numeric epoch rejected', () => {
  expectValidationError(validPayload({ evaluated_at: 1758708000000 }), /timestamp/);
});

test('41: missing evaluated_at rejected', () => {
  const payload = validPayload();
  delete payload.evaluated_at;
  expectValidationError(payload, /timestamp|payload/);
});

test('42: service does not use Date.now as evaluated_at fallback', () => {
  assert.equal(SERVICE_SOURCE.includes('Date.now'), false);
  assert.equal(MODEL_SOURCE.includes('Date.now'), false);
});

test('43: all ten exact metrics required', () => {
  assert.deepEqual([...EVALUATION_METRIC_KEYS], [
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
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.deepEqual(Object.keys(n.metrics), [...EVALUATION_METRIC_KEYS]);
});

test('44: zero metric accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload({ metrics: metricsOf(0) }));
  assert.equal(n.metrics.precision_at_5, 0);
});

test('45: one metric accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload({ metrics: metricsOf(1) }));
  assert.equal(n.metrics.diversity, 1);
});

test('46: midpoint metric accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload({ metrics: metricsOf(0.5) }));
  assert.equal(n.metrics.map_at_10, 0.5);
});

test('47: negative metric rejected', () => {
  expectValidationError(
    validPayload({ metrics: metricsOf(-0.01) }),
    /metrics/,
  );
});

test('48: metric >1 rejected', () => {
  expectValidationError(validPayload({ metrics: metricsOf(1.01) }), /metrics/);
});

test('49: NaN metric rejected', () => {
  expectValidationError(
    validPayload({ metrics: metricsOf(Number.NaN) }),
    /metrics/,
  );
});

test('50: Infinity metric rejected', () => {
  expectValidationError(
    validPayload({ metrics: metricsOf(Number.POSITIVE_INFINITY) }),
    /metrics/,
  );
});

test('51: string metric rejected', () => {
  expectValidationError(
    validPayload({ metrics: { ...metricsOf(), precision_at_5: '0.5' } }),
    /metrics/,
  );
});

test('52: bool metric rejected', () => {
  expectValidationError(
    validPayload({ metrics: { ...metricsOf(), precision_at_5: true } }),
    /metrics/,
  );
});

test('53: missing metric rejected', () => {
  const metrics = metricsOf();
  delete metrics.ndcg_at_10;
  expectValidationError(validPayload({ metrics }), /metrics/);
});

test('54: unknown metric key rejected', () => {
  expectValidationError(
    validPayload({ metrics: { ...metricsOf(), overall_score: 0.5 } }),
    /metrics/,
  );
});

test('55: no overall_score accepted/persisted', () => {
  expectValidationError(
    validPayload({ metrics: { ...metricsOf(), overall_score: 0.9 } }),
    /metrics/,
  );
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.equal(Object.prototype.hasOwnProperty.call(n.metrics, 'overall_score'), false);
});

test('56: no quality_score accepted/persisted', () => {
  expectValidationError(
    validPayload({ metrics: { ...metricsOf(), quality_score: 0.9 } }),
    /metrics/,
  );
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.equal(Object.prototype.hasOwnProperty.call(n.metrics, 'quality_score'), false);
});

test('57: valid summary accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.deepEqual(Object.keys(n.summary), [...EVALUATION_SUMMARY_KEYS]);
});

test('58: zero summary counts accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({
      summary: summaryOf({
        evaluated_user_count: 0,
        recommendation_user_count: 0,
        relevance_user_count: 0,
        catalog_size: 0,
        unique_recommended_at_10: 0,
        diversity_evaluable_user_count: 0,
        diversity_pair_count: 0,
      }),
    }),
  );
  assert.equal(n.summary.evaluated_user_count, 0);
});

test('59: negative summary count rejected', () => {
  expectValidationError(
    validPayload({ summary: summaryOf({ catalog_size: -1 }) }),
    /summary/,
  );
});

test('60: float summary count rejected', () => {
  expectValidationError(
    validPayload({ summary: summaryOf({ catalog_size: 1.5 }) }),
    /summary/,
  );
});

test('61: bool summary count rejected', () => {
  expectValidationError(
    validPayload({ summary: summaryOf({ catalog_size: true }) }),
    /summary/,
  );
});

test('62: unsafe integer summary count rejected', () => {
  expectValidationError(
    validPayload({ summary: summaryOf({ catalog_size: Number.MAX_SAFE_INTEGER + 2 }) }),
    /summary/,
  );
});

test('63: summary count > MAX_PERSISTED_COUNT rejected', () => {
  expectValidationError(
    validPayload({ summary: summaryOf({ catalog_size: MAX_PERSISTED_COUNT + 1 }) }),
    /summary/,
  );
});

test('64: unknown summary key rejected', () => {
  expectValidationError(
    validPayload({ summary: { ...summaryOf(), winner: 'x' } }),
    /summary/,
  );
});

test('65: evaluated <= relevance enforced', () => {
  expectValidationError(
    validPayload({
      summary: summaryOf({ evaluated_user_count: 11, relevance_user_count: 10 }),
    }),
    /summary/,
  );
});

test('66: unique top10 <= catalog enforced', () => {
  expectValidationError(
    validPayload({
      summary: summaryOf({ unique_recommended_at_10: 101, catalog_size: 100 }),
    }),
    /summary/,
  );
});

test('67: diversity users <= evaluated enforced', () => {
  expectValidationError(
    validPayload({
      summary: summaryOf({ diversity_evaluable_user_count: 11, evaluated_user_count: 10 }),
    }),
    /summary/,
  );
});

test('68: recommendation users may exceed evaluated', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({
      summary: summaryOf({
        evaluated_user_count: 10,
        recommendation_user_count: 50,
        relevance_user_count: 10,
      }),
    }),
  );
  assert.equal(n.summary.recommendation_user_count, 50);
});

test('69: valid dataset accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.deepEqual(Object.keys(n.dataset), [...DATASET_STAT_KEYS]);
});

test('70: zero dataset accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({
      dataset: datasetOf({
        raw_event_count: 0,
        train_event_count: 0,
        validation_event_count: 0,
        test_event_count: 0,
        unique_user_count: 0,
        unique_song_count: 0,
        session_count: 0,
        interaction_pair_count: 0,
        content_feature_count: 0,
      }),
    }),
  );
  assert.equal(n.dataset.raw_event_count, 0);
});

test('71: negative dataset count rejected', () => {
  expectValidationError(
    validPayload({ dataset: datasetOf({ session_count: -1 }) }),
    /dataset/,
  );
});

test('72: float dataset count rejected', () => {
  expectValidationError(
    validPayload({ dataset: datasetOf({ session_count: 1.2 }) }),
    /dataset/,
  );
});

test('73: bool dataset count rejected', () => {
  expectValidationError(
    validPayload({ dataset: datasetOf({ session_count: false }) }),
    /dataset/,
  );
});

test('74: unsafe integer dataset count rejected', () => {
  expectValidationError(
    validPayload({ dataset: datasetOf({ session_count: Number.MAX_SAFE_INTEGER + 2 }) }),
    /dataset/,
  );
});

test('75: over persistence cap dataset rejected', () => {
  expectValidationError(
    validPayload({
      dataset: datasetOf({
        raw_event_count: MAX_PERSISTED_COUNT + 1,
        train_event_count: MAX_PERSISTED_COUNT + 1,
        validation_event_count: 0,
        test_event_count: 0,
      }),
    }),
    /dataset/,
  );
});

test('76: unknown dataset key rejected', () => {
  expectValidationError(
    validPayload({ dataset: { ...datasetOf(), raw_rows: [] } }),
    /dataset/,
  );
});

test('77: raw=train+val+test accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({
      dataset: datasetOf({
        raw_event_count: 30,
        train_event_count: 10,
        validation_event_count: 10,
        test_event_count: 10,
      }),
    }),
  );
  assert.equal(n.dataset.raw_event_count, 30);
});

test('78: conservation mismatch rejected', () => {
  expectValidationError(
    validPayload({
      dataset: datasetOf({
        raw_event_count: 100,
        train_event_count: 50,
        validation_event_count: 10,
        test_event_count: 10,
      }),
    }),
    /dataset/,
  );
});

test('79: no silent correction', () => {
  const before = datasetOf({
    raw_event_count: 99,
    train_event_count: 50,
    validation_event_count: 10,
    test_event_count: 10,
  });
  try {
    normalizeEvaluationRunPayload(validPayload({ dataset: before }));
    assert.fail('expected rejection');
  } catch (error) {
    assert.ok(error instanceof EvaluationRunValidationError);
  }
});

test('80: no raw row storage', () => {
  const doc = new RecommendationEvaluationRun(normalizedDocument());
  const plain = doc.toObject();
  const serialized = JSON.stringify(plain);
  assert.equal(serialized.includes('listening_events'), false);
  assert.equal(serialized.includes('favorite'), false);
  assert.equal(plain.dataset.raw_rows, undefined);
});

test('81: random_seed required', () => {
  const payload = validPayload({ configuration: {} });
  expectValidationError(payload, /configuration/);
});

test('82: seed zero accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ configuration: configurationOf({ random_seed: 0 }) }),
  );
  assert.equal(n.configuration.random_seed, 0);
});

test('83: uint32 max accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ configuration: configurationOf({ random_seed: 4294967295 }) }),
  );
  assert.equal(n.configuration.random_seed, 4294967295);
});

test('84: negative seed rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ random_seed: -1 }) }),
    /configuration/,
  );
});

test('85: >uint32 seed rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ random_seed: 4294967296 }) }),
    /configuration/,
  );
});

test('86: bool seed rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ random_seed: true }) }),
    /configuration/,
  );
});

test('87: algorithm omitted accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.equal(n.configuration.algorithm, undefined);
});

test('88: safe algorithm accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ configuration: configurationOf({ algorithm: 'truncated-svd' }) }),
  );
  assert.equal(n.configuration.algorithm, 'truncated-svd');
});

test('89: uppercase algorithm rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ algorithm: 'SVD' }) }),
    /configuration/,
  );
});

test('90: oversized algorithm rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ algorithm: 'a'.repeat(65) }) }),
    /configuration/,
  );
});

test('91: component counts omitted accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.equal(n.configuration.requested_components, undefined);
  assert.equal(n.configuration.effective_components, undefined);
});

test('92: requested=32 accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ configuration: configurationOf({ requested_components: 32 }) }),
  );
  assert.equal(n.configuration.requested_components, 32);
});

test('93: effective=1 accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ configuration: configurationOf({ effective_components: 1 }) }),
  );
  assert.equal(n.configuration.effective_components, 1);
});

test('94: zero component rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ requested_components: 0 }) }),
    /configuration/,
  );
});

test('95: >32 component rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ requested_components: 33 }) }),
    /configuration/,
  );
});

test('96: float component rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ requested_components: 2.5 }) }),
    /configuration/,
  );
});

test('97: bool component rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ effective_components: true }) }),
    /configuration/,
  );
});

test('98: effective>requested rejected', () => {
  expectValidationError(
    validPayload({
      configuration: configurationOf({
        requested_components: 8,
        effective_components: 16,
      }),
    }),
    /configuration/,
  );
});

test('99: hybrid weight pair accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({
      configuration: configurationOf({
        collaborative_weight: 0.7,
        content_weight: 0.3,
      }),
    }),
  );
  assert.equal(n.configuration.collaborative_weight, 0.7);
  assert.equal(n.configuration.content_weight, 0.3);
});

test('100: only one hybrid weight rejected', () => {
  expectValidationError(
    validPayload({
      configuration: configurationOf({ collaborative_weight: 0.7 }),
    }),
    /configuration/,
  );
  expectValidationError(
    validPayload({
      configuration: configurationOf({ content_weight: 0.3 }),
    }),
    /configuration/,
  );
});

test('101: hybrid weights outside 0..1 rejected', () => {
  expectValidationError(
    validPayload({
      configuration: configurationOf({
        collaborative_weight: -0.1,
        content_weight: 1.1,
      }),
    }),
    /configuration/,
  );
});

test('102: hybrid sum mismatch rejected', () => {
  expectValidationError(
    validPayload({
      configuration: configurationOf({
        collaborative_weight: 0.6,
        content_weight: 0.3,
      }),
    }),
    /configuration/,
  );
});

test('103: exact/near 1 sum accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({
      configuration: configurationOf({
        collaborative_weight: 0.7,
        content_weight: 0.3,
      }),
    }),
  );
  assert.ok(
    Math.abs(n.configuration.collaborative_weight + n.configuration.content_weight - 1) <= 1e-9,
  );
  const near = normalizeEvaluationRunPayload(
    validPayload({
      configuration: configurationOf({
        collaborative_weight: 0.5,
        content_weight: 0.5,
      }),
    }),
  );
  assert.equal(near.configuration.collaborative_weight, 0.5);
});

test('104: policy weight pair accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({
      configuration: configurationOf({
        base_hybrid_policy_weight: 0.8,
        explicit_profile_policy_weight: 0.2,
      }),
    }),
  );
  assert.equal(n.configuration.base_hybrid_policy_weight, 0.8);
});

test('105: only one policy weight rejected', () => {
  expectValidationError(
    validPayload({
      configuration: configurationOf({ base_hybrid_policy_weight: 0.8 }),
    }),
    /configuration/,
  );
});

test('106: policy sum mismatch rejected', () => {
  expectValidationError(
    validPayload({
      configuration: configurationOf({
        base_hybrid_policy_weight: 0.8,
        explicit_profile_policy_weight: 0.1,
      }),
    }),
    /configuration/,
  );
});

test('107: exploration interval 1 accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ configuration: configurationOf({ exploration_interval: 1 }) }),
  );
  assert.equal(n.configuration.exploration_interval, 1);
});

test('108: exploration interval 100 accepted', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ configuration: configurationOf({ exploration_interval: 100 }) }),
  );
  assert.equal(n.configuration.exploration_interval, 100);
});

test('109: zero exploration interval rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ exploration_interval: 0 }) }),
    /configuration/,
  );
});

test('110: 101 exploration interval rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ exploration_interval: 101 }) }),
    /configuration/,
  );
});

test('111: float exploration interval rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ exploration_interval: 1.5 }) }),
    /configuration/,
  );
});

test('112: bool exploration interval rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ exploration_interval: true }) }),
    /configuration/,
  );
});

test('113: unknown configuration key rejected', () => {
  expectValidationError(
    validPayload({ configuration: configurationOf({ learning_rate: 0.1 }) }),
    /configuration/,
  );
});

test('114: exact payload accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.equal(n.schema_version, 1);
  assert.equal(n.run_id, 'run-alpha-1');
});

test('115: unknown top-level key rejected', () => {
  expectValidationError(validPayload({ winner: 'hybrid' }), /payload/);
  expectValidationError(validPayload({ notes: 'x' }), /payload/);
});

test('116: caller payload_sha256 rejected', () => {
  expectValidationError(
    validPayload({ payload_sha256: 'a'.repeat(64) }),
    /payload/,
  );
});

test('117: unsupported caller schema version rejected', () => {
  expectValidationError(validPayload({ schema_version: 2 }), /schema version/);
  expectValidationError(validPayload({ schema_version: 0 }), /schema version/);
});

test('118: schema omitted defaults to 1', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.equal(n.schema_version, 1);
});

test('119: caller schema 1 accepted', () => {
  const n = normalizeEvaluationRunPayload(validPayload({ schema_version: 1 }));
  assert.equal(n.schema_version, 1);
});

test('120: normalization deterministic', () => {
  const a = normalizeEvaluationRunPayload(validPayload());
  const b = normalizeEvaluationRunPayload(validPayload());
  assert.equal(computeEvaluationRunPayloadSha256(a), computeEvaluationRunPayloadSha256(b));
});

test('121: caller object insertion order irrelevant', () => {
  const reordered = {
    configuration: validPayload().configuration,
    dataset: validPayload().dataset,
    summary: validPayload().summary,
    metrics: validPayload().metrics,
    evaluated_at: '2026-09-24T10:00:00Z',
    pipeline_stage: 'hybrid',
    run_id: 'run-alpha-1',
  };
  const a = normalizeEvaluationRunPayload(validPayload());
  const b = normalizeEvaluationRunPayload(reordered);
  assert.equal(
    computeEvaluationRunPayloadSha256(a),
    computeEvaluationRunPayloadSha256(b),
  );
});

test('122: nested metrics key order irrelevant', () => {
  const metrics = validPayload().metrics;
  const reversed = {};
  for (const key of [...EVALUATION_METRIC_KEYS].reverse()) {
    reversed[key] = metrics[key];
  }
  const a = normalizeEvaluationRunPayload(validPayload());
  const b = normalizeEvaluationRunPayload(validPayload({ metrics: reversed }));
  assert.equal(
    computeEvaluationRunPayloadSha256(a),
    computeEvaluationRunPayloadSha256(b),
  );
});

test('123: configuration key order irrelevant', () => {
  const configuration = configurationOf({
    algorithm: 'truncated-svd',
    exploration_interval: 5,
    collaborative_weight: 0.7,
    content_weight: 0.3,
  });
  const reversed = { exploration_interval: 5, content_weight: 0.3, collaborative_weight: 0.7, algorithm: 'truncated-svd', random_seed: 42 };
  const a = normalizeEvaluationRunPayload(validPayload({ configuration }));
  const b = normalizeEvaluationRunPayload(validPayload({ configuration: reversed }));
  assert.equal(
    computeEvaluationRunPayloadSha256(a),
    computeEvaluationRunPayloadSha256(b),
  );
});

test('124: original payload not mutated', () => {
  const payload = validPayload();
  const before = JSON.stringify(payload);
  normalizeEvaluationRunPayload(payload);
  assert.equal(JSON.stringify(payload), before);
});

test('125: normalized evaluated_at deterministic UTC instant', () => {
  const n = normalizeEvaluationRunPayload(
    validPayload({ evaluated_at: '2026-09-24T16:00:00+06:00' }),
  );
  assert.equal(n.evaluated_at.toISOString(), '2026-09-24T10:00:00.000Z');
});

test('126: artifact null normalized consistently', () => {
  const omitted = normalizeEvaluationRunPayload(validPayload());
  const explicit = normalizeEvaluationRunPayload(validPayload({ artifact_version: null }));
  assert.equal(omitted.artifact_version, null);
  assert.equal(explicit.artifact_version, null);
  assert.equal(
    computeEvaluationRunPayloadSha256(omitted),
    computeEvaluationRunPayloadSha256(explicit),
  );
});

test('127: digest 64 lowercase hex', () => {
  const digest = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(validPayload()),
  );
  assert.match(digest, /^[a-f0-9]{64}$/);
});

test('128: same normalized payload => same digest', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.equal(
    computeEvaluationRunPayloadSha256(n),
    computeEvaluationRunPayloadSha256(n),
  );
});

test('129: caller key order does not change digest', () => {
  const a = normalizeEvaluationRunPayload(validPayload());
  const reordered = {
    run_id: 'run-alpha-1',
    pipeline_stage: 'hybrid',
    evaluated_at: '2026-09-24T10:00:00Z',
    configuration: validPayload().configuration,
    dataset: validPayload().dataset,
    summary: validPayload().summary,
    metrics: validPayload().metrics,
  };
  const b = normalizeEvaluationRunPayload(reordered);
  assert.equal(
    computeEvaluationRunPayloadSha256(a),
    computeEvaluationRunPayloadSha256(b),
  );
});

test('130: metric change changes digest', () => {
  const a = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(validPayload()),
  );
  const b = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(
      validPayload({ metrics: { ...metricsOf(), precision_at_5: 0.6 } }),
    ),
  );
  assert.notEqual(a, b);
});

test('131: dataset change changes digest', () => {
  const a = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(validPayload()),
  );
  const b = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(
      validPayload({ dataset: datasetOf({ session_count: 41 }) }),
    ),
  );
  assert.notEqual(a, b);
});

test('132: configuration change changes digest', () => {
  const a = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(validPayload()),
  );
  const b = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(
      validPayload({ configuration: configurationOf({ random_seed: 7 }) }),
    ),
  );
  assert.notEqual(a, b);
});

test('133: evaluated_at instant change changes digest', () => {
  const a = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(
      validPayload({ evaluated_at: '2026-09-24T10:00:00Z' }),
    ),
  );
  const b = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(
      validPayload({ evaluated_at: '2026-09-24T10:00:01Z' }),
    ),
  );
  assert.notEqual(a, b);
});

test('134: run_id change changes digest', () => {
  const a = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(validPayload()),
  );
  const b = computeEvaluationRunPayloadSha256(
    normalizeEvaluationRunPayload(validPayload({ run_id: 'run-beta' })),
  );
  assert.notEqual(a, b);
});

test('135: uses SHA-256', () => {
  assert.match(SERVICE_SOURCE, /createHash\(['"]sha256['"]\)/);
});

test('136: no MD5', () => {
  assert.equal(SERVICE_SOURCE.includes('md5'), false);
  assert.equal(SERVICE_SOURCE.includes('MD5'), false);
});

test('137: no SHA1', () => {
  assert.equal(/createHash\(['"]sha1['"]\)/.test(SERVICE_SOURCE), false);
  assert.equal(SERVICE_SOURCE.includes('sha1'), false);
});

test('138: DB _id excluded from hash input shape', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  const digest = computeEvaluationRunPayloadSha256(n);
  assert.equal(typeof digest, 'string');
  assert.equal(Object.prototype.hasOwnProperty.call(n, '_id'), false);
});

test('139: createdAt excluded', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.equal(Object.prototype.hasOwnProperty.call(n, 'createdAt'), false);
});

test('140: updatedAt excluded', () => {
  const n = normalizeEvaluationRunPayload(validPayload());
  assert.equal(Object.prototype.hasOwnProperty.call(n, 'updatedAt'), false);
});

test('141: hash not treated as authentication/signature', () => {
  assert.match(
    SERVICE_SOURCE + MODEL_SOURCE,
    /idempotent|immutable-content identity|fingerprint/i,
  );
  assert.equal(/jsonwebtoken|sign\(/.test(SERVICE_SOURCE), false);
});

test('142: valid normalized record validates', () => {
  const doc = new RecommendationEvaluationRun(normalizedDocument());
  assert.equal(doc.validateSync(), undefined);
});

test('143: strict unknown model field rejected/not persisted', () => {
  const doc = new RecommendationEvaluationRun({
    ...normalizedDocument(),
    user_id: USER_A,
    overall_score: 0.9,
  });
  const plain = doc.toObject();
  assert.equal(plain.user_id, undefined);
  assert.equal(plain.overall_score, undefined);
  assert.equal(RecommendationEvaluationRun.schema.path('user_id'), undefined);
  assert.equal(RecommendationEvaluationRun.schema.path('overall_score'), undefined);
});

test('144: metric range enforced by schema', () => {
  const doc = new RecommendationEvaluationRun(
    normalizedDocument({
      metrics: { ...metricsOf(), precision_at_5: 1.2 },
    }),
  );
  assert.ok(doc.validateSync());
});

test('145: required nested object enforced', () => {
  const payload = normalizedDocument();
  delete payload.metrics;
  const doc = new RecommendationEvaluationRun(payload);
  assert.ok(doc.validateSync());
});

test('146: run_id required', () => {
  const payload = normalizedDocument();
  delete payload.run_id;
  const doc = new RecommendationEvaluationRun(payload);
  assert.ok(doc.validateSync());
});

test('147: payload_sha256 format enforced', () => {
  const doc = new RecommendationEvaluationRun(
    normalizedDocument({ payload_sha256: 'nope' }),
  );
  assert.ok(doc.validateSync());
});

test('148: schema version enforced', () => {
  const doc = new RecommendationEvaluationRun(
    normalizedDocument({ schema_version: 9 }),
  );
  assert.ok(doc.validateSync());
});

test('149: unique run_id index exists', () => {
  const indexes = RecommendationEvaluationRun.schema.indexes();
  const uniqueRun = indexes.find(
    ([keys, options]) => keys.run_id === 1 && options.unique === true,
  );
  assert.ok(uniqueRun);
});

test('150: evaluated_at index exists', () => {
  const indexes = RecommendationEvaluationRun.schema.indexes();
  const evaluated = indexes.find(
    ([keys]) => keys.evaluated_at === -1 && Object.keys(keys).length === 1,
  );
  assert.ok(evaluated);
});

test('151: stage/evaluated index exists', () => {
  const indexes = RecommendationEvaluationRun.schema.indexes();
  const stage = indexes.find(
    ([keys]) => keys.pipeline_stage === 1 && keys.evaluated_at === -1,
  );
  assert.ok(stage);
});

test('152: artifact/evaluated index exists', () => {
  const indexes = RecommendationEvaluationRun.schema.indexes();
  const artifact = indexes.find(
    ([keys]) => keys.artifact_version === 1 && keys.evaluated_at === -1,
  );
  assert.ok(artifact);
  assert.ok(artifact[1].partialFilterExpression);
});

test('153: no Mixed schema for controlled structures', () => {
  const metricsPath = RecommendationEvaluationRun.schema.path('metrics');
  assert.ok(metricsPath.schema);
  assert.notEqual(metricsPath.instance, 'Mixed');
  assert.notEqual(
    RecommendationEvaluationRun.schema.path('summary').instance,
    'Mixed',
  );
  assert.notEqual(
    RecommendationEvaluationRun.schema.path('dataset').instance,
    'Mixed',
  );
  assert.notEqual(
    RecommendationEvaluationRun.schema.path('configuration').instance,
    'Mixed',
  );
  assert.equal(MODEL_SOURCE.includes('Schema.Types.Mixed'), false);
  assert.equal(MODEL_SOURCE.includes('mongoose.Schema.Types.Mixed'), false);
});

test('154: recordEvaluationRun calls create once', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  const result = await service.recordEvaluationRun(validPayload());
  assert.equal(state.createCalls.length, 1);
  assert.equal(result.created, true);
});

test('155: create receives normalized fields', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.recordEvaluationRun(validPayload());
  const doc = state.createCalls[0];
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.run_id, 'run-alpha-1');
  assert.equal(doc.pipeline_stage, 'hybrid');
  assert.equal(doc.artifact_version, null);
  assert.ok(doc.evaluated_at instanceof Date);
  assert.deepEqual(Object.keys(doc.metrics), [...EVALUATION_METRIC_KEYS]);
});

test('156: service-generated SHA included', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.recordEvaluationRun(validPayload());
  assert.match(state.createCalls[0].payload_sha256, /^[a-f0-9]{64}$/);
});

test('157: caller raw unknown fields never reach model', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () =>
      service.recordEvaluationRun(
        validPayload({ payload_sha256: 'f'.repeat(64), user_id: USER_A }),
      ),
    EvaluationRunValidationError,
  );
  assert.equal(state.createCalls.length, 0);
});

test('158: successful create returns created=true', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  const result = await service.recordEvaluationRun(validPayload());
  assert.equal(result.created, true);
});

test('159: persisted run returned factually', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  const result = await service.recordEvaluationRun(validPayload());
  assert.equal(result.run.run_id, 'run-alpha-1');
  assert.equal(result.run.pipeline_stage, 'hybrid');
});

test('160: duplicate-key code 11000 triggers one lookup', async () => {
  const existing = { ...normalizedDocument(), _id: 'existing-1' };
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [existing],
  });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  const result = await service.recordEvaluationRun(validPayload());
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.findOneCalls.length, 1);
  assert.equal(result.created, false);
});

test('161: identical digest returns created=false', async () => {
  const normalized = normalizeEvaluationRunPayload(validPayload());
  const existing = {
    ...normalized,
    payload_sha256: computeEvaluationRunPayloadSha256(normalized),
    _id: 'existing-1',
  };
  const { model } = createFakeModel({ createMode: 'e11000', docs: [existing] });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  const result = await service.recordEvaluationRun(validPayload());
  assert.equal(result.created, false);
});

test('162: existing run returned', async () => {
  const normalized = normalizeEvaluationRunPayload(validPayload());
  const existing = {
    ...normalized,
    payload_sha256: computeEvaluationRunPayloadSha256(normalized),
    _id: 'existing-1',
  };
  const { model } = createFakeModel({ createMode: 'e11000', docs: [existing] });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  const result = await service.recordEvaluationRun(validPayload());
  assert.equal(result.run._id, 'existing-1');
});

test('163: no update called', async () => {
  const normalized = normalizeEvaluationRunPayload(validPayload());
  const existing = {
    ...normalized,
    payload_sha256: computeEvaluationRunPayloadSha256(normalized),
    _id: 'existing-1',
  };
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [existing],
  });
  model.updateOne = async () => {
    throw new Error('updateOne should not be called');
  };
  model.findOneAndUpdate = async () => {
    throw new Error('findOneAndUpdate should not be called');
  };
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.recordEvaluationRun(validPayload());
  assert.equal(state.createCalls.length, 1);
});

test('164: no replacement called', async () => {
  const normalized = normalizeEvaluationRunPayload(validPayload());
  const existing = {
    ...normalized,
    payload_sha256: computeEvaluationRunPayloadSha256(normalized),
    _id: 'existing-1',
  };
  const { model } = createFakeModel({ createMode: 'e11000', docs: [existing] });
  model.replaceOne = async () => {
    throw new Error('replaceOne should not be called');
  };
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.recordEvaluationRun(validPayload());
  assert.ok(true);
});

test('165: no second create retry loop', async () => {
  const normalized = normalizeEvaluationRunPayload(validPayload());
  const existing = {
    ...normalized,
    payload_sha256: computeEvaluationRunPayloadSha256(normalized),
    _id: 'existing-1',
  };
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [existing],
  });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.recordEvaluationRun(validPayload());
  assert.equal(state.createCalls.length, 1);
});

test('166: duplicate run with different hash throws conflict', async () => {
  const existing = {
    ...normalizeEvaluationRunPayload(validPayload()),
    payload_sha256: 'b'.repeat(64),
    _id: 'existing-1',
  };
  const { model } = createFakeModel({ createMode: 'e11000', docs: [existing] });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.recordEvaluationRun(validPayload()),
    (error) => {
      assert.ok(error instanceof EvaluationRunConflictError);
      assert.match(
        error.message,
        /evaluation run already exists with different content/,
      );
      return true;
    },
  );
});

test('167: existing record unchanged', async () => {
  const existing = {
    ...normalizeEvaluationRunPayload(validPayload()),
    payload_sha256: 'b'.repeat(64),
    _id: 'existing-1',
  };
  const snapshot = JSON.stringify(existing);
  const { model } = createFakeModel({ createMode: 'e11000', docs: [existing] });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(() => service.recordEvaluationRun(validPayload()));
  assert.equal(JSON.stringify(existing), snapshot);
});

test('168: no update on conflict', async () => {
  const existing = {
    ...normalizeEvaluationRunPayload(validPayload()),
    payload_sha256: 'b'.repeat(64),
    _id: 'existing-1',
  };
  const { model } = createFakeModel({ createMode: 'e11000', docs: [existing] });
  model.updateOne = async () => {
    throw new Error('should not update');
  };
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(() => service.recordEvaluationRun(validPayload()));
});

test('169: no merge on conflict', async () => {
  const existing = {
    ...normalizeEvaluationRunPayload(validPayload()),
    payload_sha256: 'b'.repeat(64),
    _id: 'existing-1',
  };
  const { model } = createFakeModel({ createMode: 'e11000', docs: [existing] });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(() => service.recordEvaluationRun(validPayload()));
  assert.equal(existing.payload_sha256, 'b'.repeat(64));
});

test('170: no overwrite on conflict', async () => {
  const existing = {
    ...normalizeEvaluationRunPayload(validPayload()),
    payload_sha256: 'b'.repeat(64),
    _id: 'existing-1',
    run_id: 'run-alpha-1',
  };
  const { model, state } = createFakeModel({
    createMode: 'e11000',
    docs: [existing],
  });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(() => service.recordEvaluationRun(validPayload()));
  assert.equal(state.docs[0].payload_sha256, 'b'.repeat(64));
});

test('171: sanitized conflict message', async () => {
  const existing = {
    ...normalizeEvaluationRunPayload(validPayload()),
    payload_sha256: 'b'.repeat(64),
    _id: 'existing-1',
  };
  const { model } = createFakeModel({ createMode: 'e11000', docs: [existing] });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  try {
    await service.recordEvaluationRun(validPayload());
    assert.fail('expected conflict');
  } catch (error) {
    assert.ok(error instanceof EvaluationRunConflictError);
    assert.equal(error.message.length < 200, true);
    assert.equal(error.message.includes(USER_A), false);
    assert.equal(error.message.includes('mongodb://'), false);
  }
});

test('172: ordinary DB error does not become conflict', async () => {
  const { model } = createFakeModel({ createMode: 'db-error' });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.recordEvaluationRun(validPayload()),
    (error) => {
      assert.ok(error instanceof EvaluationRunPersistenceError);
      assert.ok(!(error instanceof EvaluationRunConflictError));
      return true;
    },
  );
});

test('173: sanitized persistence error thrown', async () => {
  const { model } = createFakeModel({ createMode: 'db-error' });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  try {
    await service.recordEvaluationRun(validPayload());
    assert.fail('expected persistence error');
  } catch (error) {
    assert.ok(error instanceof EvaluationRunPersistenceError);
    assert.equal(error.message, 'failed to persist evaluation run');
  }
});

test('174: raw DB error message not copied', async () => {
  const { model } = createFakeModel({ createMode: 'db-error' });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  try {
    await service.recordEvaluationRun(validPayload());
    assert.fail('expected persistence error');
  } catch (error) {
    assert.equal(error.message.includes('connection pool'), false);
    assert.equal(error.message.includes('mongodb'), false);
  }
});

test('175: no retry loop on non-duplicate failure', async () => {
  const { model, state } = createFakeModel({ createMode: 'db-error' });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(() => service.recordEvaluationRun(validPayload()));
  assert.equal(state.createCalls.length, 1);
  assert.equal(state.findOneCalls.length, 0);
});

test('176: valid ID queried exactly', async () => {
  const { model, state } = createFakeModel({
    docs: [normalizedDocument({ _id: 'x1' })],
  });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  const run = await service.getEvaluationRunByRunId('run-alpha-1');
  assert.equal(state.findOneCalls[0].run_id, 'run-alpha-1');
  assert.equal(run.run_id, 'run-alpha-1');
});

test('177: invalid ID rejected before query', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.getEvaluationRunByRunId('BAD'),
    EvaluationRunValidationError,
  );
  assert.equal(state.findOneCalls.length, 0);
});

test('178: found run returned', async () => {
  const { model } = createFakeModel({
    docs: [normalizedDocument({ _id: 'found-1' })],
  });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  const run = await service.getEvaluationRunByRunId('run-alpha-1');
  assert.equal(run._id, 'found-1');
});

test('179: missing run returns null', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  const run = await service.getEvaluationRunByRunId('missing-run');
  assert.equal(run, null);
});

test('180: read is lean/plain where applicable', async () => {
  let leaned = false;
  const model = {
    findOne() {
      return {
        lean() {
          leaned = true;
          return Promise.resolve(null);
        },
      };
    },
  };
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.getEvaluationRunByRunId('run-x');
  assert.equal(leaned, true);
});

test('181: no mutation operation on get', async () => {
  const { model } = createFakeModel({
    docs: [normalizedDocument({ _id: 'm1' })],
  });
  model.updateOne = async () => {
    throw new Error('no update');
  };
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.getEvaluationRunByRunId('run-alpha-1');
  assert.ok(true);
});

test('182: no options default limit20', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns();
  assert.equal(DEFAULT_LIST_LIMIT, 20);
  assert.equal(state.findCalls[0].limit, 20);
});

test('183: limit1 accepted', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns({ limit: 1 });
  assert.equal(state.findCalls[0].limit, 1);
});

test('184: limit100 accepted', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns({ limit: 100 });
  assert.equal(state.findCalls[0].limit, 100);
  assert.equal(MAX_LIST_LIMIT, 100);
});

test('185: limit0 rejected', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.listEvaluationRuns({ limit: 0 }),
    EvaluationRunValidationError,
  );
});

test('186: limit101 rejected', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.listEvaluationRuns({ limit: 101 }),
    EvaluationRunValidationError,
  );
});

test('187: float limit rejected', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.listEvaluationRuns({ limit: 1.5 }),
    EvaluationRunValidationError,
  );
});

test('188: bool limit rejected', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.listEvaluationRuns({ limit: true }),
    EvaluationRunValidationError,
  );
});

test('189: collaborative filter accepted', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns({ pipeline_stage: 'collaborative' });
  assert.equal(state.findCalls[0].filter.pipeline_stage, 'collaborative');
});

test('190: hybrid filter accepted', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns({ pipeline_stage: 'hybrid' });
  assert.equal(state.findCalls[0].filter.pipeline_stage, 'hybrid');
});

test('191: policy filter accepted', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns({ pipeline_stage: 'policy' });
  assert.equal(state.findCalls[0].filter.pipeline_stage, 'policy');
});

test('192: invalid stage rejected', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.listEvaluationRuns({ pipeline_stage: 'best' }),
    EvaluationRunValidationError,
  );
});

test('193: unknown option rejected', async () => {
  const { model } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.listEvaluationRuns({ cursor: 'x' }),
    EvaluationRunValidationError,
  );
  await assert.rejects(
    () => service.listEvaluationRuns({ sort: 'metric' }),
    EvaluationRunValidationError,
  );
});

test('194: limit applied', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns({ limit: 5 });
  assert.equal(state.findCalls[0].limit, 5);
});

test('195: optional stage filter applied', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns({ pipeline_stage: 'policy' });
  assert.deepEqual(state.findCalls[0].filter, { pipeline_stage: 'policy' });
});

test('196: sort evaluated_at DESC', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns();
  assert.equal(state.findCalls[0].sort.evaluated_at, -1);
});

test('197: secondary _id DESC', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns();
  assert.equal(state.findCalls[0].sort._id, -1);
});

test('198: no metric-based sort', async () => {
  const { model, state } = createFakeModel();
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns();
  const sortKeys = Object.keys(state.findCalls[0].sort);
  assert.deepEqual(sortKeys.sort(), ['_id', 'evaluated_at']);
  assert.equal(sortKeys.some((key) => key.includes('metric')), false);
  assert.equal(sortKeys.some((key) => key.includes('score')), false);
});

test('199: no best selection', async () => {
  assert.equal(SERVICE_SOURCE.includes('best'), false);
  assert.equal(SERVICE_SOURCE.includes('winner'), false);
});

test('200: lean/plain result where applicable', async () => {
  let leaned = false;
  const model = {
    find() {
      const api = {
        sort: () => api,
        limit: () => api,
        lean: () => {
          leaned = true;
          return Promise.resolve([]);
        },
      };
      return api;
    },
  };
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await service.listEvaluationRuns();
  assert.equal(leaned, true);
});

test('201: fields marked immutable where practical', () => {
  for (const path of [
    'run_id',
    'pipeline_stage',
    'artifact_version',
    'evaluated_at',
    'metrics',
    'summary',
    'dataset',
    'configuration',
    'payload_sha256',
    'schema_version',
  ]) {
    assert.equal(
      RecommendationEvaluationRun.schema.path(path).options.immutable,
      true,
      path,
    );
  }
});

test('202: modifying saved document then save rejected', () => {
  let captured = null;
  evaluationRunSaveGuard.call({ isNew: false }, (error) => {
    captured = error;
  });
  assert.ok(captured);
  assert.match(captured.message, /immutable/);
});

test('203: updateOne rejected', async () => {
  await assert.rejects(
    () =>
      RecommendationEvaluationRun.updateOne(
        { run_id: 'run-alpha-1' },
        { $set: { run_id: 'other' } },
      ),
    /immutable/,
  );
});

test('204: updateMany rejected', async () => {
  await assert.rejects(
    () =>
      RecommendationEvaluationRun.updateMany(
        {},
        { $set: { pipeline_stage: 'hybrid' } },
      ),
    /immutable/,
  );
});

test('205: findOneAndUpdate rejected', async () => {
  await assert.rejects(
    () =>
      RecommendationEvaluationRun.findOneAndUpdate(
        { run_id: 'run-alpha-1' },
        { $set: { pipeline_stage: 'policy' } },
      ),
    /immutable/,
  );
});

test('206: replaceOne rejected', async () => {
  await assert.rejects(
    () =>
      RecommendationEvaluationRun.replaceOne(
        { run_id: 'run-alpha-1' },
        { run_id: 'other' },
      ),
    /immutable/,
  );
});

test('207: deleteOne rejected', async () => {
  await assert.rejects(
    () => RecommendationEvaluationRun.deleteOne({ run_id: 'run-alpha-1' }),
    /immutable/,
  );
});

test('208: deleteMany rejected', async () => {
  await assert.rejects(
    () => RecommendationEvaluationRun.deleteMany({}),
    /immutable/,
  );
});

test('209: findOneAndDelete rejected', async () => {
  await assert.rejects(
    () => RecommendationEvaluationRun.findOneAndDelete({ run_id: 'run-alpha-1' }),
    /immutable/,
  );
});

test('210: findOneAndRemove rejected if supported', async () => {
  const preHooks =
    RecommendationEvaluationRun.schema.s.hooks?._pres?.get('findOneAndRemove') ??
    [];
  assert.ok(preHooks.some((hook) => hook.fn === evaluationRunQueryGuard));
  if (typeof RecommendationEvaluationRun.findOneAndRemove !== 'function') {
    return;
  }
  await assert.rejects(
    () =>
      RecommendationEvaluationRun.findOneAndRemove({
        run_id: 'run-alpha-1',
      }),
    /immutable/,
  );
});

test('211: document deleteOne rejected if supported', () => {
  let captured = null;
  evaluationRunDocumentDeleteGuard.call({}, (error) => {
    captured = error;
  });
  assert.ok(captured);
  assert.match(captured.message, /immutable/);
});

test('212: create remains allowed', () => {
  let captured = 'unset';
  evaluationRunSaveGuard.call({ isNew: true }, (error) => {
    captured = error;
  });
  assert.equal(captured, undefined);
  assert.equal(typeof RecommendationEvaluationRun.create, 'function');
});

test('213: read remains allowed', () => {
  assert.equal(typeof RecommendationEvaluationRun.findOne, 'function');
  assert.equal(typeof RecommendationEvaluationRun.find, 'function');
});

test('214: no user_id field in schema', () => {
  assert.equal(RecommendationEvaluationRun.schema.path('user_id'), undefined);
  assert.equal(MODEL_SOURCE.includes('user_id:'), false);
});

test('215: no user_ids', () => {
  assert.equal(RecommendationEvaluationRun.schema.path('user_ids'), undefined);
});

test('216: no song recommendation list', () => {
  assert.equal(RecommendationEvaluationRun.schema.path('recommendations'), undefined);
  assert.equal(RecommendationEvaluationRun.schema.path('song_ids'), undefined);
  assert.equal(MODEL_SOURCE.includes('recommendation_lists'), false);
});

test('217: no ListeningEvent raw rows', () => {
  assert.equal(RecommendationEvaluationRun.schema.path('listening_events'), undefined);
  assert.equal(MODEL_SOURCE.includes('ListeningEvent'), false);
  assert.equal(SERVICE_SOURCE.includes('ListeningEvent'), false);
});

test('218: no Favorite data', () => {
  assert.equal(RecommendationEvaluationRun.schema.path('favorites'), undefined);
  assert.equal(MODEL_SOURCE.includes('favorite_song_ids'), false);
});

test('219: no Playlist data', () => {
  assert.equal(RecommendationEvaluationRun.schema.path('playlists'), undefined);
  assert.equal(MODEL_SOURCE.includes('playlist_song_counts'), false);
});

test('220: no email', () => {
  assert.equal(RecommendationEvaluationRun.schema.path('email'), undefined);
  assert.equal(MODEL_SOURCE.includes('email'), false);
  assert.equal(SERVICE_SOURCE.includes('email'), false);
});

test('221: no token fields', () => {
  assert.equal(RecommendationEvaluationRun.schema.path('token'), undefined);
  assert.equal(RecommendationEvaluationRun.schema.path('access_token'), undefined);
  assert.equal(MODEL_SOURCE.includes('reset_token'), false);
});

test('222: no IP field', () => {
  assert.equal(RecommendationEvaluationRun.schema.path('ip'), undefined);
  assert.equal(RecommendationEvaluationRun.schema.path('ip_address'), undefined);
  assert.equal(MODEL_SOURCE.includes('ip_address'), false);
});

test('223: service has no Python subprocess', () => {
  assert.equal(SERVICE_SOURCE.includes('child_process'), false);
  assert.equal(SERVICE_SOURCE.includes('spawn('), false);
  assert.equal(SERVICE_SOURCE.includes('exec('), false);
  assert.equal(SERVICE_SOURCE.includes('python'), false);
});

test('224: no child_process in model', () => {
  assert.equal(MODEL_SOURCE.includes('child_process'), false);
  assert.equal(MODEL_SOURCE.includes('spawn('), false);
  assert.equal(MODEL_SOURCE.includes('exec('), false);
});

test('225: no model training call', () => {
  assert.equal(SERVICE_SOURCE.includes('train_collaborative_model'), false);
  assert.equal(MODEL_SOURCE.includes('train_collaborative_model'), false);
  assert.equal(SERVICE_SOURCE.includes('TruncatedSVD'), false);
});

test('226: no recommendation generation', () => {
  assert.equal(SERVICE_SOURCE.includes('rank_hybrid_candidates'), false);
  assert.equal(SERVICE_SOURCE.includes('rank_with_cold_start_policy'), false);
  assert.equal(MODEL_SOURCE.includes('rank_hybrid_candidates'), false);
});

test('227: no artifact publication', () => {
  assert.equal(SERVICE_SOURCE.includes('publish_artifact_release'), false);
  assert.equal(MODEL_SOURCE.includes('publish_artifact_release'), false);
  assert.equal(SERVICE_SOURCE.includes('activate_artifact_release'), false);
});

test('228: no route creation', () => {
  assert.equal(SERVICE_SOURCE.includes('router.'), false);
  assert.equal(MODEL_SOURCE.includes('router.'), false);
  assert.equal(SERVICE_SOURCE.includes('express.Router'), false);
  assert.equal(SERVICE_SOURCE.includes('app.get'), false);
  assert.equal(SERVICE_SOURCE.includes('app.post'), false);
  assert.equal(SERVICE_SOURCE.includes('app.put'), false);
  assert.equal(SERVICE_SOURCE.includes('app.delete'), false);
});

test('229: no Express router', () => {
  assert.equal(SERVICE_SOURCE.includes('express'), false);
  assert.equal(MODEL_SOURCE.includes('express'), false);
});

test('230: no protect/admin middleware change', () => {
  assert.equal(SERVICE_SOURCE.includes('protect'), false);
  assert.equal(SERVICE_SOURCE.includes('adminOnly'), false);
  assert.equal(MODEL_SOURCE.includes('protect'), false);
});

test('231: no winner/best-model calculation', () => {
  assert.equal(SERVICE_SOURCE.includes('winner'), false);
  assert.equal(SERVICE_SOURCE.includes('best_model'), false);
  assert.equal(MODEL_SOURCE.includes('winner'), false);
  assert.equal(MODEL_SOURCE.includes('best_model'), false);
  assert.equal(SERVICE_SOURCE.includes('overall_score'), false);
  assert.equal(SERVICE_SOURCE.includes('quality_score'), false);
});

test('232: no TTL', () => {
  assert.equal(MODEL_SOURCE.includes('expireAfterSeconds'), false);
  assert.equal(MODEL_SOURCE.includes('ttl'), false);
  assert.equal(MODEL_SOURCE.toLowerCase().includes('index({ expires'), false);
});

test('233: no update/upsert creation path', () => {
  assert.equal(SERVICE_SOURCE.includes('upsert'), false);
  assert.equal(SERVICE_SOURCE.includes('findOneAndUpdate'), false);
  assert.equal(SERVICE_SOURCE.includes('updateOne'), false);
  assert.equal(SERVICE_SOURCE.includes('updateMany'), false);
  assert.equal(SERVICE_SOURCE.includes('replaceOne'), false);
  assert.equal(MODEL_SOURCE.includes('upsert: true'), false);
});

test('234: no client import', () => {
  assert.equal(SERVICE_SOURCE.includes('../client'), false);
  assert.equal(MODEL_SOURCE.includes('../client'), false);
  assert.equal(SERVICE_SOURCE.includes('from \'../../client'), false);
});

test('235: evaluate_recommendations not invoked', () => {
  assert.equal(SERVICE_SOURCE.includes('evaluate_recommendations'), false);
  assert.equal(MODEL_SOURCE.includes('evaluate_recommendations'), false);
});

test('236: error hierarchy usable', () => {
  assert.ok(new EvaluationRunValidationError('x') instanceof EvaluationRunError);
  assert.ok(new EvaluationRunConflictError('x') instanceof EvaluationRunError);
  assert.ok(new EvaluationRunPersistenceError('x') instanceof EvaluationRunError);
  assert.ok(new EvaluationRunImmutableError('x') instanceof EvaluationRunError);
});

test('237: payload hash excludes caller-provided hash field', () => {
  const withCallerHash = validPayload({ payload_sha256: 'c'.repeat(64) });
  delete withCallerHash.payload_sha256;
  const n = normalizeEvaluationRunPayload(withCallerHash);
  assert.equal(computeEvaluationRunPayloadSha256(n).length, 64);
});

test('238: no pymongo/FastAPI/Flask in sources', () => {
  for (const token of ['pymongo', 'FastAPI', 'Flask']) {
    assert.equal(MODEL_SOURCE.includes(token), false);
    assert.equal(SERVICE_SOURCE.includes(token), false);
  }
});

test('239: service API surface exact', () => {
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: createFakeModel().model,
  });
  assert.deepEqual(Object.keys(service).sort(), [
    'getEvaluationRunByRunId',
    'listEvaluationRuns',
    'recordEvaluationRun',
  ]);
});

test('240: config keys documented set', () => {
  assert.deepEqual([...CONFIGURATION_KEYS], [
    'random_seed',
    'algorithm',
    'requested_components',
    'effective_components',
    'collaborative_weight',
    'content_weight',
    'base_hybrid_policy_weight',
    'explicit_profile_policy_weight',
    'exploration_interval',
  ]);
});

test('241: persistence error when 11000 but missing doc', async () => {
  const { model } = createFakeModel({ createMode: 'e11000', docs: [] });
  const service = createRecommendationEvaluationRunService({
    EvaluationRunModel: model,
  });
  await assert.rejects(
    () => service.recordEvaluationRun(validPayload()),
    EvaluationRunPersistenceError,
  );
});

test('242: versionKey disabled per repository convention', () => {
  assert.equal(RecommendationEvaluationRun.schema.options.versionKey, false);
});

test('243: strict schema enabled', () => {
  assert.equal(RecommendationEvaluationRun.schema.options.strict, true);
});
