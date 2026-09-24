import mongoose from 'mongoose';

export const RETRAINING_LEASE_SCHEMA_VERSION = 1;
export const RETRAINING_LEASE_SCOPE = 'global';
export const RETRAINING_LEASE_TOKEN_PATTERN = /^[a-f0-9]{64}$/;
export const RETRAINING_LEASE_RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const RETRAINING_LEASE_GRACE_MS = 60000;

const isSafeRunId = (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 64 &&
  RETRAINING_LEASE_RUN_ID_PATTERN.test(value);

const isToken = (value) =>
  typeof value === 'string' && RETRAINING_LEASE_TOKEN_PATTERN.test(value);

const isAwareDate = (value) =>
  value instanceof Date && !Number.isNaN(value.getTime());

const recommendationRetrainingLeaseSchema = new mongoose.Schema(
  {
    schema_version: {
      type: Number,
      required: true,
      enum: [RETRAINING_LEASE_SCHEMA_VERSION],
      default: RETRAINING_LEASE_SCHEMA_VERSION,
    },
    scope: {
      type: String,
      required: true,
      enum: [RETRAINING_LEASE_SCOPE],
      default: RETRAINING_LEASE_SCOPE,
    },
    token: {
      type: String,
      required: true,
      validate: {
        validator: isToken,
        message: 'lease token must be a 64-hex string',
      },
    },
    run_id: {
      type: String,
      required: true,
      validate: {
        validator: isSafeRunId,
        message: 'lease run_id must be a safe identifier',
      },
    },
    acquired_at: {
      type: Date,
      required: true,
      validate: {
        validator: isAwareDate,
        message: 'acquired_at must be a valid date',
      },
    },
    expires_at: {
      type: Date,
      required: true,
      validate: {
        validator: isAwareDate,
        message: 'expires_at must be a valid date',
      },
    },
  },
  {
    timestamps: true,
    versionKey: false,
    strict: true,
  },
);

recommendationRetrainingLeaseSchema.index({ scope: 1 }, { unique: true });
recommendationRetrainingLeaseSchema.index(
  { expires_at: 1 },
  { expireAfterSeconds: 0 },
);

export const retrainingLeaseSaveGuard = function retrainingLeaseSaveGuard(next) {
  if (!this.isNew) {
    next(new Error('retraining lease is immutable after creation'));
    return;
  }
  next();
};

recommendationRetrainingLeaseSchema.pre('save', retrainingLeaseSaveGuard);

const rejectUpdate = function rejectUpdate(next, result) {
  if (result && result.modifiedCount > 0) {
    next(new Error('retraining lease is immutable'));
    return;
  }
  next();
};

recommendationRetrainingLeaseSchema.pre(
  'updateOne',
  function forbidUpdate(next) {
    next(new Error('retraining lease is immutable'));
  },
);
recommendationRetrainingLeaseSchema.pre(
  'updateMany',
  function forbidUpdate(next) {
    next(new Error('retraining lease is immutable'));
  },
);
recommendationRetrainingLeaseSchema.pre(
  'findOneAndUpdate',
  function forbidUpdate(next) {
    next(new Error('retraining lease is immutable'));
  },
);
recommendationRetrainingLeaseSchema.pre(
  'update',
  function forbidUpdate(next) {
    next(new Error('retraining lease is immutable'));
  },
);
recommendationRetrainingLeaseSchema.pre(
  'replaceOne',
  function forbidReplace(next) {
    next(new Error('retraining lease is immutable'));
  },
);
recommendationRetrainingLeaseSchema.pre(
  'findOneAndReplace',
  function forbidReplace(next) {
    next(new Error('retraining lease is immutable'));
  },
);

recommendationRetrainingLeaseSchema.methods.deleteOne = async function deleteLeaseOnly(
  options,
) {
  const deleted = await mongoose
    .model('RecommendationRetrainingLease')
    .deleteOne({ _id: this._id }, options);
  if (deleted.deletedCount !== 1) {
    throw new Error('failed to release retraining lease');
  }
  return deleted;
};

recommendationRetrainingLeaseSchema.statics.deleteMany = async function forbidBulkDelete(
  filter,
  options,
) {
  const matched = await this.find(filter).select({ _id: 1 }).lean();
  if (matched.length > 1) {
    throw new Error('retraining lease bulk delete is forbidden');
  }
  if (matched.length === 0) {
    return { acknowledged: true, deletedCount: 0 };
  }
  const result = await mongoose
    .model('RecommendationRetrainingLease')
    .deleteOne({ _id: matched[0]._id });
  return result;
};

export default mongoose.model(
  'RecommendationRetrainingLease',
  recommendationRetrainingLeaseSchema,
);
