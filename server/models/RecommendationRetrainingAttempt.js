import mongoose from 'mongoose';

export const RETRAINING_ATTEMPT_SCHEMA_VERSION = 1;
export const RETRAINING_ATTEMPT_STATUSES = Object.freeze([
  'completed',
  'failed',
]);
export const RETRAINING_FAILURE_CODES = Object.freeze([
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
]);
export const RETRAINING_ATTEMPT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const RETRAINING_RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const MAX_RETRAINING_COUNT = 1_000_000_000;
export const MAX_RETRAINING_MESSAGE_LENGTH = 500;

const isSafeIdentifier = (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 64 &&
  RETRAINING_ATTEMPT_ID_PATTERN.test(value);

const isSafeRunId = (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 64 &&
  RETRAINING_RUN_ID_PATTERN.test(value);

const isStatus = (value) =>
  typeof value === 'string' && RETRAINING_ATTEMPT_STATUSES.includes(value);

const isFailureCode = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && RETRAINING_FAILURE_CODES.includes(value));

const isAwareDate = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime());

const isNonNegativeSafeCount = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_RETRAINING_COUNT);

const isOptionalDuration = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER);

const optionalCount = {
  type: Number,
  default: null,
  validate: {
    validator: isNonNegativeSafeCount,
    message: 'count must be a non-negative safe integer',
  },
};

const recommendationRetrainingAttemptSchema = new mongoose.Schema(
  {
    schema_version: {
      type: Number,
      required: true,
      enum: [RETRAINING_ATTEMPT_SCHEMA_VERSION],
      default: RETRAINING_ATTEMPT_SCHEMA_VERSION,
    },
    attempt_id: {
      type: String,
      required: true,
      validate: {
        validator: isSafeIdentifier,
        message: 'attempt_id must be a safe identifier',
      },
    },
    run_id: {
      type: String,
      required: true,
      validate: {
        validator: isSafeRunId,
        message: 'run_id must be a safe identifier',
      },
    },
    status: {
      type: String,
      required: true,
      validate: {
        validator: isStatus,
        message: 'status must be completed or failed',
      },
    },
    started_at: {
      type: Date,
      required: true,
      validate: {
        validator: isAwareDate,
        message: 'started_at must be a valid date',
      },
    },
    finished_at: {
      type: Date,
      required: true,
      validate: {
        validator: isAwareDate,
        message: 'finished_at must be a valid date',
      },
    },
    duration_ms: {
      type: Number,
      default: null,
      validate: {
        validator: isOptionalDuration,
        message: 'duration_ms must be a non-negative integer',
      },
    },
    artifact_version: {
      type: String,
      default: null,
      validate: {
        validator: (value) => value === null || isSafeIdentifier(value),
        message: 'artifact_version must be null or a safe identifier',
      },
    },
    evaluation_run_id: {
      type: String,
      default: null,
      validate: {
        validator: (value) => value === null || isSafeRunId(value),
        message: 'evaluation_run_id must be null or a safe run id',
      },
    },
    snapshot_version: {
      type: String,
      default: null,
      validate: {
        validator: (value) => value === null || isSafeIdentifier(value),
        message: 'snapshot_version must be null or a safe identifier',
      },
    },
    pipeline_stage: {
      type: String,
      default: 'policy',
      enum: ['policy'],
    },
    snapshot_limit: {
      type: Number,
      default: null,
      validate: {
        validator: (value) =>
          value === null ||
          (Number.isInteger(value) && value >= 1 && value <= 100),
        message: 'snapshot_limit must be an integer between 1 and 100',
      },
    },
    event_window_truncated: {
      type: Boolean,
      default: false,
    },
    input_event_count: optionalCount,
    usable_event_count: optionalCount,
    dropped_event_count: optionalCount,
    train_event_count: optionalCount,
    validation_event_count: optionalCount,
    test_event_count: optionalCount,
    unique_user_count: optionalCount,
    unique_song_count: optionalCount,
    session_count: optionalCount,
    interaction_pair_count: optionalCount,
    content_feature_count: optionalCount,
    snapshot_persisted_count: optionalCount,
    snapshot_reused_count: optionalCount,
    evaluation_created: {
      type: Boolean,
      default: false,
    },
    failure_code: {
      type: String,
      default: null,
      validate: {
        validator: isFailureCode,
        message: 'failure_code must be a known retraining failure code',
      },
    },
    failure_message: {
      type: String,
      default: null,
      maxlength: MAX_RETRAINING_MESSAGE_LENGTH,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: true,
  },
);

recommendationRetrainingAttemptSchema.index({ attempt_id: 1 }, { unique: true });
recommendationRetrainingAttemptSchema.index({ finished_at: -1, _id: -1 });
recommendationRetrainingAttemptSchema.index({
  run_id: 1,
  finished_at: -1,
});

recommendationRetrainingAttemptSchema.pre('validate', function enforceStatusFailureInvariants(next) {
  if (this.status === 'completed' && this.failure_code != null) {
    next(new Error('completed retraining attempt cannot carry a failure_code'));
    return;
  }
  if (this.status === 'failed' && this.failure_code == null) {
    next(new Error('failed retraining attempt requires a failure_code'));
    return;
  }
  next();
});

export const retrainingAttemptSaveGuard = function retrainingAttemptSaveGuard(next) {
  if (!this.isNew) {
    next(new Error('retraining attempt is immutable after creation'));
    return;
  }
  next();
};

recommendationRetrainingAttemptSchema.pre('save', retrainingAttemptSaveGuard);

const forbid = (next) => {
  next(new Error('retraining attempt is immutable'));
};

recommendationRetrainingAttemptSchema.pre('updateOne', forbid);
recommendationRetrainingAttemptSchema.pre('updateMany', forbid);
recommendationRetrainingAttemptSchema.pre('findOneAndUpdate', forbid);
recommendationRetrainingAttemptSchema.pre('update', forbid);
recommendationRetrainingAttemptSchema.pre('replaceOne', forbid);
recommendationRetrainingAttemptSchema.pre('findOneAndReplace', forbid);
recommendationRetrainingAttemptSchema.pre('deleteOne', forbid);
recommendationRetrainingAttemptSchema.pre('deleteMany', forbid);
recommendationRetrainingAttemptSchema.pre('findOneAndDelete', forbid);

recommendationRetrainingAttemptSchema.methods.deleteOne = async function forbidDelete() {
  throw new Error('retraining attempt is immutable');
};

export default mongoose.model(
  'RecommendationRetrainingAttempt',
  recommendationRetrainingAttemptSchema,
);
