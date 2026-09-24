import crypto from 'node:crypto';
import RecommendationRetrainingLease, {
  RETRAINING_LEASE_SCOPE,
} from '../models/RecommendationRetrainingLease.js';
import RecommendationRetrainingAttempt, {
  RETRAINING_ATTEMPT_STATUSES,
} from '../models/RecommendationRetrainingAttempt.js';
import { createRecommendationTrainingInputService } from './recommendationTrainingInputService.js';
import {
  createRecommendationPythonRunner,
  RETRAIN_PYTHON_TIMEOUT_MS,
} from './recommendationPythonRunner.js';
import { createRecommendationEvaluationRunService } from './recommendationEvaluationRunService.js';
import { createRecommendationSnapshotService } from './recommendationSnapshotService.js';

export const DEFAULT_RETRAIN_SNAPSHOT_LIMIT = 20;
export const MAX_RETRAIN_SNAPSHOT_LIMIT = 100;
export const SNAPSHOT_PERSIST_CONCURRENCY = 4;
export const RETRAIN_LEASE_GRACE_MS = 60000;
export const RETRAINING_HEALTH_SOURCE = 'retraining-health';
export const RETRAINING_HEALTH_STATES = Object.freeze({
  RUNNING: 'running',
  NEVER_RUN: 'never-run',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

export const RETRAINING_HEALTH_HTTP_MESSAGES = Object.freeze({
  invalidQuery: 'invalid recommendation health query',
  failed: 'failed to load retraining health',
});

export class RecommendationRetrainingError extends Error {
  constructor(message, { failureCode = 'RETRAIN_INTERNAL_ERROR' } = {}) {
    super(message);
    this.name = 'RecommendationRetrainingError';
    this.failureCode = failureCode;
  }
}

export class RecommendationRetrainingValidationError extends RecommendationRetrainingError {
  constructor(message) {
    super(message, { failureCode: 'RETRAIN_INTERNAL_ERROR' });
    this.name = 'RecommendationRetrainingValidationError';
  }
}

export class RecommendationRetrainingConflictError extends RecommendationRetrainingError {
  constructor(message) {
    super(message, { failureCode: 'RETRAIN_ALREADY_RUNNING' });
    this.name = 'RecommendationRetrainingConflictError';
  }
}

export class RecommendationRetrainingReadError extends RecommendationRetrainingError {
  constructor(message) {
    super(message, { failureCode: 'RETRAIN_INTERNAL_ERROR' });
    this.name = 'RecommendationRetrainingReadError';
  }
}

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const ISO_WITH_EXPLICIT_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const normalizeRetrainRunId = (value) => {
  if (typeof value !== 'string') {
    throw new RecommendationRetrainingValidationError('invalid retrain run id');
  }
  if (value.length < 1 || value.length > 64) {
    throw new RecommendationRetrainingValidationError('invalid retrain run id');
  }
  if (value !== value.trim()) {
    throw new RecommendationRetrainingValidationError('invalid retrain run id');
  }
  if (value === '.' || value === '..') {
    throw new RecommendationRetrainingValidationError('invalid retrain run id');
  }
  if (!RUN_ID_PATTERN.test(value)) {
    throw new RecommendationRetrainingValidationError('invalid retrain run id');
  }
  return value;
};

export const normalizeRetrainRunAt = (value) => {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) {
      throw new RecommendationRetrainingValidationError('invalid retrain timestamp');
    }
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!ISO_WITH_EXPLICIT_ZONE.test(text)) {
      throw new RecommendationRetrainingValidationError('invalid retrain timestamp');
    }
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      throw new RecommendationRetrainingValidationError('invalid retrain timestamp');
    }
    return parsed.toISOString();
  }
  throw new RecommendationRetrainingValidationError('invalid retrain timestamp');
};

export const normalizeRetrainSnapshotLimit = (value) => {
  if (value === undefined) {
    return DEFAULT_RETRAIN_SNAPSHOT_LIMIT;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new RecommendationRetrainingValidationError('invalid snapshot limit');
  }
  if (value < 1 || value > MAX_RETRAIN_SNAPSHOT_LIMIT) {
    throw new RecommendationRetrainingValidationError('invalid snapshot limit');
  }
  return value;
};

const isDuplicateKeyError = (error) =>
  Boolean(error) && (error.code === 11000 || error.code === 'E11000');

const generateToken = () => crypto.randomBytes(32).toString('hex');

const optionalCountValue = (value) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;

const optionalText = (value) =>
  typeof value === 'string' && value.length > 0 ? value : null;

const optionalIso = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : value;
  }
  return null;
};

const projectHealthAttempt = (attempt) => {
  if (!attempt || typeof attempt !== 'object') return null;
  const status = RETRAINING_ATTEMPT_STATUSES.includes(attempt.status)
    ? attempt.status
    : null;
  if (!status) return null;
  if (typeof attempt.attempt_id !== 'string' || !RUN_ID_PATTERN.test(attempt.attempt_id)) {
    return null;
  }
  if (typeof attempt.run_id !== 'string' || !RUN_ID_PATTERN.test(attempt.run_id)) {
    return null;
  }
  const startedAt = optionalIso(attempt.started_at);
  const finishedAt = optionalIso(attempt.finished_at);
  if (!startedAt || !finishedAt) return null;

  let failureCode = null;
  if (
    typeof attempt.failure_code === 'string'
    && attempt.failure_code.length > 0
  ) {
    failureCode = attempt.failure_code;
  }
  if (status === 'completed' && failureCode !== null) return null;
  if (status === 'failed' && failureCode === null) return null;

  return {
    attempt_id: attempt.attempt_id,
    run_id: attempt.run_id,
    status,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: optionalCountValue(attempt.duration_ms),
    pipeline_stage:
      attempt.pipeline_stage === 'policy' ? attempt.pipeline_stage : null,
    snapshot_limit: optionalCountValue(attempt.snapshot_limit),
    artifact_version: optionalText(attempt.artifact_version),
    evaluation_run_id: optionalText(attempt.evaluation_run_id),
    snapshot_version: optionalText(attempt.snapshot_version),
    event_window_truncated: attempt.event_window_truncated === true,
    evaluation_created: attempt.evaluation_created === true,
    input_event_count: optionalCountValue(attempt.input_event_count),
    usable_event_count: optionalCountValue(attempt.usable_event_count),
    dropped_event_count: optionalCountValue(attempt.dropped_event_count),
    train_event_count: optionalCountValue(attempt.train_event_count),
    validation_event_count: optionalCountValue(attempt.validation_event_count),
    test_event_count: optionalCountValue(attempt.test_event_count),
    unique_user_count: optionalCountValue(attempt.unique_user_count),
    unique_song_count: optionalCountValue(attempt.unique_song_count),
    session_count: optionalCountValue(attempt.session_count),
    interaction_pair_count: optionalCountValue(attempt.interaction_pair_count),
    content_feature_count: optionalCountValue(attempt.content_feature_count),
    snapshot_persisted_count: optionalCountValue(attempt.snapshot_persisted_count),
    snapshot_reused_count: optionalCountValue(attempt.snapshot_reused_count),
    failure_code: failureCode,
    failure_message: optionalText(attempt.failure_message),
  };
};

const mapRunnerFailureCode = (error) => {
  if (!error) return 'RETRAIN_INTERNAL_ERROR';
  if (typeof error.failureCode === 'string' && error.failureCode.length > 0) {
    return error.failureCode;
  }
  if (error.name === 'RecommendationPythonTimeoutError') {
    return 'PYTHON_TIMEOUT';
  }
  if (error.name === 'RecommendationPythonOutputError') {
    return 'PYTHON_OUTPUT_INVALID';
  }
  if (error.name === 'RecommendationPythonExitError') {
    return 'PYTHON_FAILED';
  }
  if (error.name === 'RecommendationTrainingInputLimitError') {
    return 'TRAINING_INPUT_LIMIT_EXCEEDED';
  }
  return 'RETRAIN_INTERNAL_ERROR';
};

const mapFailureMessage = (failureCode, error) => {
  const fallback = (() => {
    if (failureCode === 'RETRAIN_ALREADY_RUNNING') {
      return 'a retraining run is already in progress';
    }
    if (failureCode === 'TRAINING_INPUT_LIMIT_EXCEEDED') {
      return 'training input exceeded a runtime bound';
    }
    if (failureCode === 'INSUFFICIENT_TRAINING_DATA') {
      return 'insufficient training data';
    }
    if (failureCode === 'PYTHON_TIMEOUT') {
      return 'retraining python exceeded the time limit';
    }
    if (failureCode === 'PYTHON_OUTPUT_INVALID') {
      return 'retraining python produced an invalid output document';
    }
    if (failureCode === 'ARTIFACT_VERSION_CONFLICT') {
      return 'artifact version already exists with different content';
    }
    if (failureCode === 'EVALUATION_PERSIST_FAILED') {
      return 'failed to persist the evaluation run';
    }
    if (failureCode === 'SNAPSHOT_PERSIST_FAILED') {
      return 'failed to persist recommendation snapshots';
    }
    if (failureCode === 'PYTHON_FAILED') {
      return 'retraining python exited with a failure';
    }
    return 'retraining failed';
  })();
  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.slice(0, 500);
  }
  return fallback;
};

const mapRunnerErrorToFailureCode = (error) => {
  if (!error) return 'RETRAIN_INTERNAL_ERROR';
  if (error.name === 'RecommendationRetrainingConflictError') {
    return 'RETRAIN_ALREADY_RUNNING';
  }
  if (error.name === 'RecommendationTrainingInputLimitError') {
    return 'TRAINING_INPUT_LIMIT_EXCEEDED';
  }
  if (error.name === 'RecommendationPythonTimeoutError') {
    return 'PYTHON_TIMEOUT';
  }
  if (error.name === 'RecommendationPythonOutputError') {
    return 'PYTHON_OUTPUT_INVALID';
  }
  if (error.name === 'RecommendationPythonExitError') {
    const mapped = mapRunnerFailureCode(error);
    if (
      mapped === 'INSUFFICIENT_TRAINING_DATA'
      || mapped === 'ARTIFACT_VERSION_CONFLICT'
      || mapped === 'TRAINING_INPUT_LIMIT_EXCEEDED'
      || mapped === 'PYTHON_FAILED'
    ) {
      return mapped;
    }
    return 'PYTHON_FAILED';
  }
  return mapRunnerFailureCode(error);
};

const validateOutputDocument = (output, runId, runAt, snapshotLimit) => {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (output.schema_version !== 1) {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (output.run_id !== runId) {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (output.artifact_version !== runId) {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (output.pipeline_stage !== 'policy') {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (!output.evaluation || typeof output.evaluation !== 'object') {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (!Array.isArray(output.snapshots)) {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (output.snapshots.length > snapshotLimit) {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (!output.filtering || typeof output.filtering !== 'object') {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (!output.artifact || typeof output.artifact !== 'object') {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  const runAtIso = optionalIso(runAt);
  if (!runAtIso) {
    throw new RecommendationRetrainingValidationError('invalid retrain timestamp');
  }
  if (output.run_at !== runAt && output.run_at !== runAtIso) {
    // accept either the exact submitted string or its normalized ISO form
    const normalized = normalizeRetrainRunAt(output.run_at);
    if (normalized !== runAtIso) {
      throw new RecommendationRetrainingValidationError(
        'retrain output document was invalid',
      );
    }
  }
  return true;
};

const toSnapshotPayload = (snapshot, runId, runAt) => {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  const userId = snapshot.user_id;
  if (typeof userId !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  if (!Array.isArray(snapshot.items) || !snapshot.summary) {
    throw new RecommendationRetrainingValidationError(
      'retrain output document was invalid',
    );
  }
  return {
    user_id: userId.toLowerCase(),
    snapshot_version: runId,
    artifact_version: runId,
    generated_at: runAt,
    items: snapshot.items.map((item) => ({
      rank: item.rank,
      song_id: item.song_id,
      basis: item.basis,
      policy_score: item.policy_score,
      hybrid_score: item.hybrid_score,
      profile_score: item.profile_score,
      collaborative_known: item.collaborative_known,
    })),
    summary: snapshot.summary,
  };
};

const runWithConcurrency = async (items, limit, worker) => {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = [];
  const size = Math.max(1, Math.min(limit, items.length || 1));
  for (let i = 0; i < size; i += 1) {
    runners.push(
      (async () => {
        while (nextIndex < items.length) {
          const index = nextIndex;
          nextIndex += 1;
          results[index] = await worker(items[index], index);
        }
      })(),
    );
  }
  await Promise.all(runners);
  return results;
};

export function createRecommendationRetrainingService({
  LeaseModel = RecommendationRetrainingLease,
  AttemptModel = RecommendationRetrainingAttempt,
  trainingInputService = createRecommendationTrainingInputService(),
  pythonRunner = createRecommendationPythonRunner(),
  evaluationRunService = createRecommendationEvaluationRunService(),
  snapshotService = createRecommendationSnapshotService(),
  artifactRoot = null,
  now = () => new Date(),
  leaseGraceMs = RETRAIN_LEASE_GRACE_MS,
} = {}) {
  if (!trainingInputService
    || typeof trainingInputService.collectRetrainingInput !== 'function') {
    throw new RecommendationRetrainingValidationError(
      'invalid training input service',
    );
  }
  if (!pythonRunner || typeof pythonRunner.runRetrainingPython !== 'function') {
    throw new RecommendationRetrainingValidationError('invalid python runner');
  }
  if (!evaluationRunService
    || typeof evaluationRunService.recordEvaluationRun !== 'function') {
    throw new RecommendationRetrainingValidationError(
      'invalid evaluation run service',
    );
  }
  if (!snapshotService
    || typeof snapshotService.recordRecommendationSnapshot !== 'function') {
    throw new RecommendationRetrainingValidationError('invalid snapshot service');
  }

  const acquireLease = async (runId) => {
    const token = generateToken();
    const acquiredAt = now();
    const expiresAt = new Date(
      acquiredAt.getTime() + RETRAIN_PYTHON_TIMEOUT_MS + leaseGraceMs,
    );
    const document = {
      schema_version: 1,
      scope: RETRAINING_LEASE_SCOPE,
      token,
      run_id: runId,
      acquired_at: acquiredAt,
      expires_at: expiresAt,
    };
    try {
      await LeaseModel.create(document);
      return { token, expires_at: expiresAt };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw new RecommendationRetrainingReadError(
          'failed to persist retraining lease',
        );
      }
      let existing = null;
      try {
        existing = await LeaseModel.findOne({ scope: RETRAINING_LEASE_SCOPE });
      } catch {
        throw new RecommendationRetrainingReadError(
          'failed to persist retraining lease',
        );
      }
      if (existing) {
        const existingExpires = existing.expires_at instanceof Date
          ? existing.expires_at
          : new Date(existing.expires_at);
        if (
          Number.isFinite(existingExpires?.getTime?.())
          && existingExpires.getTime() > now().getTime()
        ) {
          throw new RecommendationRetrainingConflictError(
            'a retraining run is already in progress',
          );
        }
        try {
          await LeaseModel.deleteOne({ _id: existing._id });
        } catch {
          throw new RecommendationRetrainingConflictError(
            'a retraining run is already in progress',
          );
        }
        try {
          await LeaseModel.create(document);
          return { token, expires_at: expiresAt };
        } catch (retryError) {
          if (isDuplicateKeyError(retryError)) {
            throw new RecommendationRetrainingConflictError(
              'a retraining run is already in progress',
            );
          }
          throw new RecommendationRetrainingReadError(
            'failed to persist retraining lease',
          );
        }
      }
      throw new RecommendationRetrainingConflictError(
        'a retraining run is already in progress',
      );
    }
  };

  const releaseLease = async (token) => {
    if (typeof token !== 'string' || token.length === 0) return;
    try {
      await LeaseModel.deleteOne({
        scope: RETRAINING_LEASE_SCOPE,
        token,
      });
    } catch {
      // release is best-effort; TTL reclaim covers abandoned leases
    }
  };

  const persistAttempt = async (document) => {
    try {
      await AttemptModel.create(document);
      return true;
    } catch {
      return false;
    }
  };

  const runRecommendationRetraining = async ({
    runId,
    runAt,
    snapshotLimit = DEFAULT_RETRAIN_SNAPSHOT_LIMIT,
    artifactRootPath = artifactRoot,
  } = {}) => {
    const normalizedRunId = normalizeRetrainRunId(runId);
    const normalizedRunAt = normalizeRetrainRunAt(runAt);
    const normalizedLimit = normalizeRetrainSnapshotLimit(snapshotLimit);

    if (typeof artifactRootPath !== 'string' || !artifactRootPath.trim()) {
      throw new RecommendationRetrainingValidationError('invalid artifact root');
    }

    const startedAt = now();
    const attemptSuffix = `-${crypto.randomBytes(4).toString('hex')}`;
    const attemptId = `${normalizedRunId.slice(
      0,
      64 - attemptSuffix.length,
    )}${attemptSuffix}`;

    let lease = null;
    try {
      lease = await acquireLease(normalizedRunId);
    } catch (error) {
      const failureCode = mapRunnerErrorToFailureCode(error);
      await persistAttempt({
        schema_version: 1,
        attempt_id: attemptId,
        run_id: normalizedRunId,
        status: 'failed',
        started_at: startedAt,
        finished_at: now(),
        duration_ms: Math.max(0, now().getTime() - startedAt.getTime()),
        pipeline_stage: 'policy',
        snapshot_limit: normalizedLimit,
        event_window_truncated: false,
        evaluation_created: false,
        failure_code: failureCode,
        failure_message: mapFailureMessage(failureCode, error),
      });
      throw error;
    }

    let failureCode = null;
    let failureError = null;
    let successSummary = null;

    try {
      const input = await trainingInputService.collectRetrainingInput();

      const payload = {
        schema_version: 1,
        run_id: normalizedRunId,
        run_at: normalizedRunAt,
        snapshot_limit: normalizedLimit,
        random_seed: 42,
        artifact_root: artifactRootPath,
        songs: input.songs,
        users: input.users,
        events: input.events,
        profiles: input.profiles,
      };

      const result = await pythonRunner.runRetrainingPython(payload);
      validateOutputDocument(
        result.output,
        normalizedRunId,
        normalizedRunAt,
        normalizedLimit,
      );

      const output = result.output;

      let evaluationCreated = false;
      try {
        const evaluationResult = await evaluationRunService.recordEvaluationRun(
          output.evaluation,
        );
        evaluationCreated = evaluationResult?.created === true;
      } catch (error) {
        failureCode = 'EVALUATION_PERSIST_FAILED';
        failureError = error;
        throw error;
      }

      let snapshotPersisted = 0;
      let snapshotReused = 0;
      try {
        const snapshotResults = await runWithConcurrency(
          output.snapshots,
          SNAPSHOT_PERSIST_CONCURRENCY,
          async (snapshot) => {
            const payloadDoc = toSnapshotPayload(
              snapshot,
              normalizedRunId,
              normalizedRunAt,
            );
            const persisted = await snapshotService.recordRecommendationSnapshot(
              payloadDoc,
            );
            return persisted;
          },
        );
        for (const persisted of snapshotResults) {
          if (persisted?.created === true) snapshotPersisted += 1;
          else snapshotReused += 1;
        }
      } catch (error) {
        failureCode = failureCode ?? 'SNAPSHOT_PERSIST_FAILED';
        failureError = failureError ?? error;
        throw error;
      }

      const finishedAt = now();
      successSummary = {
        attempt_id: attemptId,
        run_id: normalizedRunId,
        status: 'completed',
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        pipeline_stage: 'policy',
        snapshot_limit: normalizedLimit,
        artifact_version: normalizedRunId,
        evaluation_run_id: normalizedRunId,
        snapshot_version: normalizedRunId,
        event_window_truncated: input.event_window_truncated === true,
        evaluation_created: evaluationCreated,
        input_event_count: optionalCountValue(input.input_event_count),
        usable_event_count: optionalCountValue(
          output.filtering?.usable_event_count,
        ),
        dropped_event_count: optionalCountValue(
          output.filtering?.dropped_event_count,
        ),
        train_event_count: optionalCountValue(
          output.evaluation?.dataset?.train_event_count,
        ),
        validation_event_count: optionalCountValue(
          output.evaluation?.dataset?.validation_event_count,
        ),
        test_event_count: optionalCountValue(
          output.evaluation?.dataset?.test_event_count,
        ),
        unique_user_count: optionalCountValue(
          output.evaluation?.dataset?.unique_user_count,
        ),
        unique_song_count: optionalCountValue(
          output.evaluation?.dataset?.unique_song_count,
        ),
        session_count: optionalCountValue(
          output.evaluation?.dataset?.session_count,
        ),
        interaction_pair_count: optionalCountValue(
          output.evaluation?.dataset?.interaction_pair_count,
        ),
        content_feature_count: optionalCountValue(
          output.evaluation?.dataset?.content_feature_count,
        ),
        snapshot_persisted_count: snapshotPersisted,
        snapshot_reused_count: snapshotReused,
        failure_code: null,
        failure_message: null,
      };
      await persistAttempt({
        schema_version: 1,
        ...successSummary,
        started_at: startedAt,
        finished_at: successSummary.finished_at,
      });
      return successSummary;
    } catch (error) {
      failureCode = failureCode ?? mapRunnerErrorToFailureCode(error);
      failureError = failureError ?? error;
      const finishedAt = now();
      await persistAttempt({
        schema_version: 1,
        attempt_id: attemptId,
        run_id: normalizedRunId,
        status: 'failed',
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        pipeline_stage: 'policy',
        snapshot_limit: normalizedLimit,
        event_window_truncated: false,
        evaluation_created: false,
        failure_code: failureCode,
        failure_message: mapFailureMessage(failureCode, failureError),
      });
      if (error instanceof RecommendationRetrainingError) throw error;
      throw new RecommendationRetrainingError(
        mapFailureMessage(failureCode, failureError),
        { failureCode },
      );
    } finally {
      await releaseLease(lease?.token);
    }
  };

  const getRecommendationRetrainingHealth = async () => {
    try {
      let leaseDoc = null;
      try {
        leaseDoc = await LeaseModel.findOne({
          scope: RETRAINING_LEASE_SCOPE,
        }).lean();
      } catch {
        throw new RecommendationRetrainingReadError(
          RETRAINING_HEALTH_HTTP_MESSAGES.failed,
        );
      }

      const nowMs = now().getTime();
      let running = false;
      let leaseRunId = null;
      let leaseExpiresAt = null;
      if (leaseDoc) {
        const expires = leaseDoc.expires_at instanceof Date
          ? leaseDoc.expires_at
          : new Date(leaseDoc.expires_at);
        const expiresMs = expires?.getTime?.();
        if (Number.isFinite(expiresMs) && expiresMs > nowMs) {
          running = true;
          leaseRunId =
            typeof leaseDoc.run_id === 'string' ? leaseDoc.run_id : null;
          leaseExpiresAt = Number.isFinite(expiresMs)
            ? new Date(expiresMs).toISOString()
            : null;
        }
      }

      let attempts = [];
      try {
        attempts = await AttemptModel.find({})
          .sort({ finished_at: -1, _id: -1 })
          .limit(1)
          .lean();
      } catch {
        throw new RecommendationRetrainingReadError(
          RETRAINING_HEALTH_HTTP_MESSAGES.failed,
        );
      }

      const latestRaw = Array.isArray(attempts) && attempts.length > 0
        ? attempts[0]
        : null;
      const latest = projectHealthAttempt(latestRaw);

      let state = RETRAINING_HEALTH_STATES.NEVER_RUN;
      if (running) {
        state = RETRAINING_HEALTH_STATES.RUNNING;
      } else if (latest) {
        state =
          latest.status === 'completed'
            ? RETRAINING_HEALTH_STATES.COMPLETED
            : RETRAINING_HEALTH_STATES.FAILED;
      }

      return {
        state,
        source: RETRAINING_HEALTH_SOURCE,
        lease: running
          ? { active: true, run_id: leaseRunId, expires_at: leaseExpiresAt }
          : { active: false, run_id: null, expires_at: null },
        latest,
      };
    } catch (error) {
      if (error instanceof RecommendationRetrainingError) throw error;
      throw new RecommendationRetrainingReadError(
        RETRAINING_HEALTH_HTTP_MESSAGES.failed,
      );
    }
  };

  return {
    runRecommendationRetraining,
    getRecommendationRetrainingHealth,
  };
}

export default createRecommendationRetrainingService;
