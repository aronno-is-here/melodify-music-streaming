import assert from 'node:assert/strict';
import test from 'node:test';

import RecommendationRetrainingAttempt, {
  RETRAINING_ATTEMPT_ID_PATTERN,
  RETRAINING_ATTEMPT_SCHEMA_VERSION,
  RETRAINING_ATTEMPT_STATUSES,
  RETRAINING_FAILURE_CODES,
  retrainingAttemptSaveGuard,
} from '../models/RecommendationRetrainingAttempt.js';

const validate = (fields) => {
  const doc = new RecommendationRetrainingAttempt(fields);
  const error = doc.validateSync();
  return { doc, error };
};

const base = () => ({
  attempt_id: 'att-run-43-01',
  run_id: 'run-43-01',
  status: 'completed',
  started_at: new Date('2026-09-15T12:00:00.000Z'),
  finished_at: new Date('2026-09-15T12:01:00.000Z'),
});

test('attempt: schema version and statuses', () => {
  assert.equal(RETRAINING_ATTEMPT_SCHEMA_VERSION, 1);
  assert.deepEqual([...RETRAINING_ATTEMPT_STATUSES], ['completed', 'failed']);
  assert.equal(RETRAINING_ATTEMPT_ID_PATTERN.test('att-1'), true);
  assert.equal(RETRAINING_ATTEMPT_ID_PATTERN.test('ATT-1'), false);
});

test('attempt: failure code vocabulary is exactly the ten fixed codes', () => {
  assert.deepEqual(
    [...RETRAINING_FAILURE_CODES],
    [
      'RETRAIN_ALREADY_RUNNING',
      'TRAINING_INPUT_LIMIT_EXCEEDED',
      'INSUFFICIENT_TRAINING_DATA',
      'PYTHON_TIMEOUT',
      'PYTHON_FAILED',
      'PYTHON_OUTPUT_INVALID',
      'ARTIFACT_VERSION_CONFLICT',
      'EVALUATION_PERSIST_FAILED',
      'SNAPSHOT_PERSIST_FAILED',
      'RETRAIN_INTERNAL_ERROR',
    ],
  );
});

test('attempt: accepts a completed payload with aggregate counters', () => {
  const { doc, error } = validate({
    ...base(),
    duration_ms: 60000,
    artifact_version: 'run-43-01',
    evaluation_run_id: 'run-43-01',
    snapshot_version: 'run-43-01',
    pipeline_stage: 'policy',
    snapshot_limit: 20,
    evaluation_created: true,
    snapshot_persisted_count: 3,
    snapshot_reused_count: 0,
    usable_event_count: 27,
    train_event_count: 9,
  });
  assert.equal(error, undefined);
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.status, 'completed');
  assert.equal(doc.failure_code, null);
  assert.equal(doc.evaluation_created, true);
});

test('attempt: accepts a failed payload with a known failure code', () => {
  const { doc, error } = validate({
    ...base(),
    status: 'failed',
    failure_code: 'INSUFFICIENT_TRAINING_DATA',
    failure_message: 'insufficient training data',
    duration_ms: 12,
  });
  assert.equal(error, undefined);
  assert.equal(doc.status, 'failed');
  assert.equal(doc.failure_code, 'INSUFFICIENT_TRAINING_DATA');
});

test('attempt: rejects unknown status', () => {
  for (const status of ['running', 'pending', 'ok', '', null]) {
    const { error } = validate({ ...base(), status });
    assert.ok(error, String(status));
  }
});

test('attempt: rejects unknown failure code', () => {
  const { error } = validate({
    ...base(),
    status: 'failed',
    failure_code: 'WEIRD',
  });
  assert.ok(error);
});

test('attempt: rejects invalid attempt_id and run_id', () => {
  const { error: badAttempt } = validate({
    ...base(),
    attempt_id: 'UPPER',
  });
  assert.ok(badAttempt);
  const { error: badRun } = validate({ ...base(), run_id: '.x' });
  assert.ok(badRun);
});

test('attempt: rejects negative counters', () => {
  const { error } = validate({ ...base(), usable_event_count: -1 });
  assert.ok(error);
});

test('attempt: rejects status completed with non-null failure_code', async () => {
  const doc = new RecommendationRetrainingAttempt({
    ...base(),
    status: 'completed',
    failure_code: 'PYTHON_FAILED',
  });
  await assert.rejects(
    () => doc.validate(),
    /completed retraining attempt cannot carry/,
  );
});

test('attempt: rejects status failed without failure_code', async () => {
  const doc = new RecommendationRetrainingAttempt({
    ...base(),
    status: 'failed',
  });
  await assert.rejects(
    () => doc.validate(),
    /failed retraining attempt requires/,
  );
});

test('attempt: unique attempt_id index exists', () => {
  const indexes = RecommendationRetrainingAttempt.schema.indexes();
  const unique = indexes.find(([keys]) => keys.attempt_id === 1);
  assert.ok(unique);
  assert.equal(unique[1].unique, true);
});

test('attempt: finished_at and run_id compound index exists', () => {
  const indexes = RecommendationRetrainingAttempt.schema.indexes();
  const compound = indexes.find(
    ([keys]) => keys.run_id === 1 && keys.finished_at === -1,
  );
  assert.ok(compound);
});

test('attempt: immutable — save rejects non-new', () => {
  let captured = null;
  retrainingAttemptSaveGuard.call({ isNew: false }, (error) => {
    captured = error;
  });
  assert.ok(captured);
  assert.match(captured.message, /immutable after creation/);

  let allowed = null;
  retrainingAttemptSaveGuard.call({ isNew: true }, (error) => {
    allowed = error;
  });
  assert.equal(allowed, undefined);
});

test('attempt: immutable — update and delete middleware reject', async () => {
  await assert.rejects(
    () => RecommendationRetrainingAttempt.updateOne({}, {}).exec(),
    /immutable/,
  );
  await assert.rejects(
    () => RecommendationRetrainingAttempt.deleteMany({}).exec(),
    /immutable/,
  );
  await assert.rejects(
    () => RecommendationRetrainingAttempt.findOneAndDelete({}).exec(),
    /immutable/,
  );
});

test('attempt: no TTL, no Mixed type, strict schema', () => {
  const indexes = RecommendationRetrainingAttempt.schema.indexes();
  for (const [, options] of indexes) {
    assert.equal(options.expireAfterSeconds, undefined);
  }
  const statusType = RecommendationRetrainingAttempt.schema.path('status');
  assert.equal(statusType.instance, 'String');
  assert.equal(RecommendationRetrainingAttempt.schema.options.strict, true);
  assert.equal(RecommendationRetrainingAttempt.schema.options.versionKey, false);
  assert.equal(RecommendationRetrainingAttempt.schema.options.timestamps, true);
});

test('attempt: no user/song/event arrays or token fields in schema', () => {
  const paths = Object.keys(RecommendationRetrainingAttempt.schema.paths);
  for (const forbidden of [
    'token',
    'email',
    'password',
    'stack',
    'stderr',
    'items',
    'users',
    'songs',
    'events',
  ]) {
    assert.equal(paths.includes(forbidden), false, forbidden);
  }
});

test('attempt: failure_message is bounded', () => {
  const { error } = validate({
    ...base(),
    status: 'failed',
    failure_code: 'PYTHON_FAILED',
    failure_message: 'x'.repeat(501),
  });
  assert.ok(error);
});
