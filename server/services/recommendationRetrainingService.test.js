import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_RETRAIN_SNAPSHOT_LIMIT,
  MAX_RETRAIN_SNAPSHOT_LIMIT,
  RETRAINING_HEALTH_SOURCE,
  RETRAINING_HEALTH_STATES,
  SNAPSHOT_PERSIST_CONCURRENCY,
  createRecommendationRetrainingService,
  normalizeRetrainRunAt,
  normalizeRetrainRunId,
  normalizeRetrainSnapshotLimit,
} from './recommendationRetrainingService.js';

const RUN_ID = 'run-43-01';
const RUN_AT = '2026-09-15T12:00:00.000Z';

const makeLeaseModel = ({ existing = null, createError = null } = {}) => {
  const state = {
    created: [],
    deleted: [],
    existing,
    createError,
  };
  return {
    state,
    async create(doc) {
      if (state.createError) throw state.createError;
      if (state.existing) {
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        throw err;
      }
      state.created.push(doc);
      state.existing = doc;
      return doc;
    },
    findOne(filter) {
      state.findFilter = filter;
      const result = state.existing;
      return {
        lean: async () => result,
        // allow await LeaseModel.findOne(...) as well
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
    },
    async deleteOne(filter) {
      state.deleted.push(filter);
      const deleted = state.existing ? 1 : 0;
      state.existing = null;
      return { acknowledged: true, deletedCount: deleted };
    },
  };
};

const makeAttemptModel = () => {
  const state = { attempts: [], createError: null };
  return {
    state,
    async create(doc) {
      if (state.createError) throw state.createError;
      state.attempts.push(doc);
      return doc;
    },
    find() {
      const chain = {
        sort() {
          return chain;
        },
        limit() {
          return chain;
        },
        async lean() {
          return [...state.attempts].sort((a, b) =>
            new Date(b.finished_at) - new Date(a.finished_at),
          ).slice(0, 1);
        },
      };
      return chain;
    },
  };
};

const validOutput = (runId = RUN_ID, runAt = RUN_AT) => ({
  schema_version: 1,
  run_id: runId,
  run_at: runAt,
  artifact_version: runId,
  pipeline_stage: 'policy',
  filtering: {
    input_event_count: 27,
    usable_event_count: 27,
    dropped_event_count: 0,
    event_window_truncated: false,
  },
  evaluation: {
    schema_version: 1,
    run_id: runId,
    pipeline_stage: 'policy',
    artifact_version: runId,
    evaluated_at: runAt,
    metrics: {
      precision_at_5: 0.1,
      precision_at_10: 0.1,
      recall_at_5: 0.1,
      recall_at_10: 0.1,
      ndcg_at_5: 0.1,
      ndcg_at_10: 0.1,
      map_at_10: 0.1,
      hit_rate_at_10: 0.1,
      catalog_coverage: 0.1,
      diversity: 0.1,
    },
    summary: {
      evaluated_user_count: 3,
      recommendation_user_count: 3,
      relevance_user_count: 3,
      catalog_size: 6,
      unique_recommended_at_10: 6,
      diversity_evaluable_user_count: 3,
      diversity_pair_count: 3,
    },
    dataset: {
      raw_event_count: 27,
      train_event_count: 21,
      validation_event_count: 3,
      test_event_count: 3,
      unique_user_count: 3,
      unique_song_count: 6,
      session_count: 9,
      interaction_pair_count: 27,
      content_feature_count: 8,
    },
    configuration: {
      random_seed: 42,
      algorithm: 'randomized',
      requested_components: 32,
      effective_components: 2,
      collaborative_weight: 0.7,
      content_weight: 0.3,
      base_hybrid_policy_weight: 0.8,
      explicit_profile_policy_weight: 0.2,
      exploration_interval: 5,
    },
  },
  snapshots: [
    {
      user_id: '1'.repeat(24),
      snapshot_version: runId,
      artifact_version: runId,
      generated_at: runAt,
      items: [
        {
          rank: 1,
          song_id: 'a'.repeat(24),
          basis: 'hybrid',
          policy_score: 0.9,
          hybrid_score: 0.9,
          profile_score: null,
          collaborative_known: true,
        },
      ],
      summary: {
        input_candidate_count: 6,
        profile_source_excluded_count: 0,
        seen_excluded_count: 0,
        eligible_candidate_count: 6,
        collaborative_known_candidate_count: 6,
        cold_start_song_candidate_count: 0,
        profile_feature_count: 0,
        exploitation_selected_count: 1,
        exploration_selected_count: 0,
        returned_count: 1,
        requested_limit: 20,
        collaborative_known_user: true,
        profile_available: false,
      },
    },
  ],
  artifact: { created: true, artifact_version: runId },
});

const createDeps = ({
  leaseModel = makeLeaseModel(),
  attemptModel = makeAttemptModel(),
  input = {
    songs: [{ _id: 'a'.repeat(24), artist: 'A', genre: 'G', language: null, category: null }],
    users: ['1'.repeat(24)],
    events: [],
    profiles: {},
    event_window_truncated: false,
    input_event_count: 27,
  },
  runnerResult = { output: validOutput(), stderr: '', exitCode: 0 },
  runnerError = null,
  evalResult = { created: true, run: {} },
  snapResult = { created: true, snapshot: {} },
} = {}) => {
  const calls = { input: 0, runner: 0, eval: 0, snap: 0 };
  return {
    leaseModel,
    attemptModel,
    calls,
    deps: {
      LeaseModel: leaseModel,
      AttemptModel: attemptModel,
      trainingInputService: {
        async collectRetrainingInput() {
          calls.input += 1;
          return input;
        },
      },
      pythonRunner: {
        async runRetrainingPython() {
          calls.runner += 1;
          if (runnerError) throw runnerError;
          return runnerResult;
        },
      },
      evaluationRunService: {
        async recordEvaluationRun() {
          calls.eval += 1;
          return evalResult;
        },
      },
      snapshotService: {
        async recordRecommendationSnapshot() {
          calls.snap += 1;
          return snapResult;
        },
      },
      artifactRoot: '/tmp/artifacts',
      now: () => new Date('2026-09-15T12:00:00.000Z'),
    },
  };
};

test('retraining: exports defaults', () => {
  assert.equal(DEFAULT_RETRAIN_SNAPSHOT_LIMIT, 20);
  assert.equal(MAX_RETRAIN_SNAPSHOT_LIMIT, 100);
  assert.equal(SNAPSHOT_PERSIST_CONCURRENCY, 4);
  assert.equal(RETRAINING_HEALTH_SOURCE, 'retraining-health');
  assert.deepEqual(
    Object.values(RETRAINING_HEALTH_STATES).sort(),
    ['completed', 'failed', 'never-run', 'running'],
  );
});

test('normalizeRetrainRunId accepts safe ids and rejects others', () => {
  assert.equal(normalizeRetrainRunId('run-43-01'), 'run-43-01');
  for (const bad of ['', 'UPPER', '.hidden', 'a'.repeat(65), 1, null, 'a b']) {
    assert.throws(() => normalizeRetrainRunId(bad), /invalid retrain run id/);
  }
});

test('normalizeRetrainRunAt requires timezone-aware ISO', () => {
  assert.equal(
    normalizeRetrainRunAt('2026-09-15T12:00:00.000Z'),
    '2026-09-15T12:00:00.000Z',
  );
  assert.equal(
    normalizeRetrainRunAt(new Date('2026-09-15T12:00:00.000Z')),
    '2026-09-15T12:00:00.000Z',
  );
  for (const bad of ['2026-09-15T12:00:00', 'not-a-date', 1, null]) {
    assert.throws(() => normalizeRetrainRunAt(bad), /invalid retrain timestamp/);
  }
});

test('normalizeRetrainSnapshotLimit enforces 1..100', () => {
  assert.equal(normalizeRetrainSnapshotLimit(undefined), 20);
  assert.equal(normalizeRetrainSnapshotLimit(1), 1);
  assert.equal(normalizeRetrainSnapshotLimit(100), 100);
  for (const bad of [0, 101, 1.5, '10', null]) {
    assert.throws(() => normalizeRetrainSnapshotLimit(bad), /invalid snapshot limit/);
  }
});

test('runRecommendationRetraining happy path persists evaluation and snapshots', async () => {
  const { deps, calls, attemptModel } = createDeps();
  const service = createRecommendationRetrainingService(deps);
  const result = await service.runRecommendationRetraining({
    runId: RUN_ID,
    runAt: RUN_AT,
    snapshotLimit: 20,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.failure_code, null);
  assert.equal(calls.input, 1);
  assert.equal(calls.runner, 1);
  assert.equal(calls.eval, 1);
  assert.equal(calls.snap, 1);
  assert.equal(attemptModel.state.attempts.length, 1);
  assert.equal(attemptModel.state.attempts[0].status, 'completed');
  assert.equal(deps.LeaseModel.state.created.length, 1);
  assert.equal(deps.LeaseModel.state.deleted.length, 1);
});

test('runRecommendationRetraining maps runner failure codes to failed attempt', async () => {
  const runnerError = Object.assign(new Error('python failed'), {
    name: 'RecommendationPythonExitError',
    failureCode: 'INSUFFICIENT_TRAINING_DATA',
  });
  const { deps, attemptModel, calls } = createDeps({ runnerError });
  const service = createRecommendationRetrainingService(deps);
  await assert.rejects(() =>
    service.runRecommendationRetraining({ runId: RUN_ID, runAt: RUN_AT }),
  );
  assert.equal(calls.eval, 0);
  assert.equal(calls.snap, 0);
  assert.equal(attemptModel.state.attempts.length, 1);
  assert.equal(attemptModel.state.attempts[0].status, 'failed');
  assert.equal(
    attemptModel.state.attempts[0].failure_code,
    'INSUFFICIENT_TRAINING_DATA',
  );
  assert.equal(deps.LeaseModel.state.deleted.length, 1);
});

test('runRecommendationRetraining maps evaluation persist failure', async () => {
  const { deps, attemptModel } = createDeps({
    evalResult: null,
    // force throw by making recordEvaluationRun throw
  });
  deps.evaluationRunService = {
    async recordEvaluationRun() {
      throw new Error('persist failed');
    },
  };
  const service = createRecommendationRetrainingService(deps);
  await assert.rejects(() =>
    service.runRecommendationRetraining({ runId: RUN_ID, runAt: RUN_AT }),
  );
  assert.equal(
    attemptModel.state.attempts[0].failure_code,
    'EVALUATION_PERSIST_FAILED',
  );
  assert.equal(deps.LeaseModel.state.deleted.length, 1);
});

test('runRecommendationRetraining maps snapshot persist failure', async () => {
  const { deps, attemptModel } = createDeps();
  deps.snapshotService = {
    async recordRecommendationSnapshot() {
      throw new Error('snapshot failed');
    },
  };
  const service = createRecommendationRetrainingService(deps);
  await assert.rejects(() =>
    service.runRecommendationRetraining({ runId: RUN_ID, runAt: RUN_AT }),
  );
  assert.equal(
    attemptModel.state.attempts[0].failure_code,
    'SNAPSHOT_PERSIST_FAILED',
  );
});

test('runRecommendationRetraining rejects concurrent lease', async () => {
  const leaseModel = makeLeaseModel({
    existing: {
      scope: 'global',
      run_id: 'other-run',
      expires_at: new Date('2026-09-15T12:30:00.000Z'),
    },
    createError: Object.assign(new Error('E11000'), { code: 11000 }),
  });
  const { deps, attemptModel, calls } = createDeps({ leaseModel });
  const service = createRecommendationRetrainingService(deps);
  await assert.rejects(
    () => service.runRecommendationRetraining({ runId: RUN_ID, runAt: RUN_AT }),
    (error) => {
      assert.equal(error.failureCode, 'RETRAIN_ALREADY_RUNNING');
      return true;
    },
  );
  assert.equal(calls.input, 0);
  assert.equal(attemptModel.state.attempts[0].failure_code, 'RETRAIN_ALREADY_RUNNING');
});

test('runRecommendationRetraining validates output document before persist', async () => {
  const { deps, attemptModel, calls } = createDeps({
    runnerResult: { output: { schema_version: 99 }, stderr: '', exitCode: 0 },
  });
  const service = createRecommendationRetrainingService(deps);
  await assert.rejects(() =>
    service.runRecommendationRetraining({ runId: RUN_ID, runAt: RUN_AT }),
  );
  assert.equal(calls.eval, 0);
  assert.equal(calls.snap, 0);
  assert.equal(attemptModel.state.attempts[0].status, 'failed');
});

test('getRecommendationRetrainingHealth returns never-run when empty', async () => {
  const { deps } = createDeps();
  const service = createRecommendationRetrainingService(deps);
  const health = await service.getRecommendationRetrainingHealth();
  assert.equal(health.state, 'never-run');
  assert.equal(health.source, 'retraining-health');
  assert.equal(health.lease.active, false);
  assert.equal(health.latest, null);
  assert.equal(JSON.stringify(health).includes('token'), false);
});

test('getRecommendationRetrainingHealth returns running for active lease', async () => {
  const leaseModel = makeLeaseModel({
    existing: {
      scope: 'global',
      token: 'a'.repeat(64),
      run_id: RUN_ID,
      expires_at: new Date('2026-09-15T12:30:00.000Z'),
    },
  });
  const { deps } = createDeps({ leaseModel });
  const service = createRecommendationRetrainingService(deps);
  const health = await service.getRecommendationRetrainingHealth();
  assert.equal(health.state, 'running');
  assert.equal(health.lease.active, true);
  assert.equal(health.lease.run_id, RUN_ID);
  assert.equal(JSON.stringify(health).includes('token'), false);
});

test('getRecommendationRetrainingHealth treats expired lease as inactive', async () => {
  const leaseModel = makeLeaseModel({
    existing: {
      scope: 'global',
      token: 'a'.repeat(64),
      run_id: RUN_ID,
      expires_at: new Date('2020-01-01T00:00:00.000Z'),
    },
  });
  const { deps, attemptModel } = createDeps({ leaseModel });
  attemptModel.state.attempts.push({
    attempt_id: 'att-1',
    run_id: RUN_ID,
    status: 'completed',
    started_at: new Date('2026-09-15T12:00:00.000Z'),
    finished_at: new Date('2026-09-15T12:01:00.000Z'),
    failure_code: null,
  });
  const service = createRecommendationRetrainingService(deps);
  const health = await service.getRecommendationRetrainingHealth();
  assert.equal(health.state, 'completed');
  assert.equal(health.lease.active, false);
});

test('getRecommendationRetrainingHealth reports failed latest attempt', async () => {
  const { deps, attemptModel } = createDeps();
  attemptModel.state.attempts.push({
    attempt_id: 'att-2',
    run_id: RUN_ID,
    status: 'failed',
    started_at: new Date('2026-09-15T12:00:00.000Z'),
    finished_at: new Date('2026-09-15T12:01:00.000Z'),
    failure_code: 'PYTHON_TIMEOUT',
    failure_message: 'retraining python exceeded the time limit',
  });
  const service = createRecommendationRetrainingService(deps);
  const health = await service.getRecommendationRetrainingHealth();
  assert.equal(health.state, 'failed');
  assert.equal(health.latest.failure_code, 'PYTHON_TIMEOUT');
  assert.equal(health.latest.status, 'failed');
  assert.equal(JSON.stringify(health).includes('token'), false);
});

test('service source never imports child_process or Express', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const source = readFileSync(
    fileURLToPath(
      new URL('./recommendationRetrainingService.js', import.meta.url),
    ),
    'utf8',
  );
  assert.equal(source.includes('child_process'), false);
  assert.equal(source.includes('spawn'), false);
  assert.equal(source.includes('express'), false);
  assert.equal(source.includes('exec('), false);
});
