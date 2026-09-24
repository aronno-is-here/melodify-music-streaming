import mongoose from 'mongoose';

export const RECOMMENDATION_SNAPSHOT_SCHEMA_VERSION = 1;

export const SNAPSHOT_ITEM_BASES = Object.freeze([
  'hybrid',
  'hybrid-profile',
  'profile',
  'exploration',
]);

export const MAX_SNAPSHOT_ITEMS = 100;
export const MAX_SNAPSHOT_COUNT = 1_000_000;
export const MAX_SNAPSHOT_VERSION_LENGTH = 64;
export const MAX_IDENTIFIER_LENGTH = 64;

export const SNAPSHOT_VERSION_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const PAYLOAD_SHA256_PATTERN = /^[a-f0-9]{64}$/;
export const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/;

export const SNAPSHOT_TOP_LEVEL_KEYS = Object.freeze([
  'schema_version',
  'user_id',
  'snapshot_version',
  'artifact_version',
  'generated_at',
  'items',
  'summary',
]);

export const SNAPSHOT_ITEM_INPUT_KEYS = Object.freeze([
  'rank',
  'song_id',
  'basis',
  'policy_score',
  'hybrid_score',
  'profile_score',
  'collaborative_known',
]);

export const SNAPSHOT_SUMMARY_KEYS = Object.freeze([
  'input_candidate_count',
  'profile_source_excluded_count',
  'seen_excluded_count',
  'eligible_candidate_count',
  'collaborative_known_candidate_count',
  'cold_start_song_candidate_count',
  'profile_feature_count',
  'exploitation_selected_count',
  'exploration_selected_count',
  'returned_count',
  'requested_limit',
  'collaborative_known_user',
  'profile_available',
]);

export const SNAPSHOT_SUMMARY_COUNT_KEYS = Object.freeze([
  'input_candidate_count',
  'profile_source_excluded_count',
  'seen_excluded_count',
  'eligible_candidate_count',
  'collaborative_known_candidate_count',
  'cold_start_song_candidate_count',
  'profile_feature_count',
  'exploitation_selected_count',
  'exploration_selected_count',
  'returned_count',
]);

const isSnapshotCount = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_SNAPSHOT_COUNT;

const isRequestedLimit = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_SNAPSHOT_ITEMS;

const isSnapshotScore = (value) =>
  value === null ||
  (typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1);

const isSnapshotRank = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_SNAPSHOT_ITEMS;

const isSafeIdentifier = (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= MAX_IDENTIFIER_LENGTH &&
  IDENTIFIER_PATTERN.test(value);

const countField = (required) => ({
  type: Number,
  required,
  validate: {
    validator: isSnapshotCount,
    message: 'count must be an integer within the snapshot persistence bound',
  },
});

const scoreField = {
  type: Number,
  default: null,
  validate: {
    validator: isSnapshotScore,
    message: 'score must be null or a finite number between 0 and 1',
  },
};

const snapshotItemSubschema = new mongoose.Schema(
  {
    rank: {
      type: Number,
      required: true,
      immutable: true,
      validate: {
        validator: isSnapshotRank,
        message: 'rank must be an integer between 1 and 100',
      },
    },
    song: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Song',
      required: true,
      immutable: true,
    },
    basis: {
      type: String,
      required: true,
      enum: SNAPSHOT_ITEM_BASES,
      immutable: true,
    },
    policy_score: scoreField,
    hybrid_score: scoreField,
    profile_score: scoreField,
    collaborative_known: {
      type: Boolean,
      required: true,
      immutable: true,
    },
  },
  { _id: false, id: false },
);

const snapshotSummarySubschema = new mongoose.Schema(
  {
    input_candidate_count: countField(true),
    profile_source_excluded_count: countField(true),
    seen_excluded_count: countField(true),
    eligible_candidate_count: countField(true),
    collaborative_known_candidate_count: countField(true),
    cold_start_song_candidate_count: countField(true),
    profile_feature_count: countField(true),
    exploitation_selected_count: countField(true),
    exploration_selected_count: countField(true),
    returned_count: countField(true),
    requested_limit: {
      type: Number,
      required: true,
      validate: {
        validator: isRequestedLimit,
        message: 'requested_limit must be an integer between 1 and 100',
      },
    },
    collaborative_known_user: {
      type: Boolean,
      required: true,
    },
    profile_available: {
      type: Boolean,
      required: true,
    },
  },
  { _id: false, id: false },
);

snapshotSummarySubschema.pre('validate', function enforceSummaryConservation(next) {
  if (
    this.profile_source_excluded_count +
      this.seen_excluded_count +
      this.eligible_candidate_count !==
    this.input_candidate_count
  ) {
    return next(new Error('invalid recommendation snapshot'));
  }
  if (
    this.collaborative_known_candidate_count +
      this.cold_start_song_candidate_count !==
    this.eligible_candidate_count
  ) {
    return next(new Error('invalid recommendation snapshot'));
  }
  if (
    this.exploitation_selected_count + this.exploration_selected_count !==
    this.returned_count
  ) {
    return next(new Error('invalid recommendation snapshot'));
  }
  if (this.returned_count > this.requested_limit) {
    return next(new Error('invalid recommendation snapshot'));
  }
  if (this.profile_available !== this.profile_feature_count > 0) {
    return next(new Error('invalid recommendation snapshot'));
  }
  if (this.collaborative_known_user === false && this.seen_excluded_count !== 0) {
    return next(new Error('invalid recommendation snapshot'));
  }
  return next();
});

export const snapshotSaveGuard = function snapshotSaveGuard(next) {
  if (!this.isNew) {
    next(new Error('recommendation snapshot history is immutable'));
    return;
  }
  next();
};

export const snapshotQueryGuard = function snapshotQueryGuard(next) {
  next(new Error('recommendation snapshot history is immutable'));
};

export const snapshotDocumentDeleteGuard =
  function snapshotDocumentDeleteGuard(next) {
    next(new Error('recommendation snapshot history is immutable'));
  };

const recommendationSnapshotSchema = new mongoose.Schema(
  {
    schema_version: {
      type: Number,
      required: true,
      enum: [RECOMMENDATION_SNAPSHOT_SCHEMA_VERSION],
      default: RECOMMENDATION_SNAPSHOT_SCHEMA_VERSION,
      immutable: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      immutable: true,
    },
    snapshot_version: {
      type: String,
      required: true,
      trim: false,
      maxlength: MAX_SNAPSHOT_VERSION_LENGTH,
      match: [SNAPSHOT_VERSION_PATTERN, 'invalid snapshot version'],
      immutable: true,
    },
    artifact_version: {
      type: String,
      default: null,
      maxlength: MAX_IDENTIFIER_LENGTH,
      validate: {
        validator: (value) => value == null || IDENTIFIER_PATTERN.test(value),
        message: 'invalid snapshot artifact version',
      },
      immutable: true,
    },
    generated_at: {
      type: Date,
      required: true,
      immutable: true,
    },
    items: {
      type: [snapshotItemSubschema],
      required: true,
      immutable: true,
      validate: {
        validator: (value) => Array.isArray(value) && value.length <= MAX_SNAPSHOT_ITEMS,
        message: 'items must contain at most 100 ranked snapshot entries',
      },
    },
    summary: {
      type: snapshotSummarySubschema,
      required: true,
      immutable: true,
    },
    payload_sha256: {
      type: String,
      required: true,
      match: [PAYLOAD_SHA256_PATTERN, 'invalid snapshot payload fingerprint'],
      immutable: true,
    },
  },
  {
    timestamps: true,
    strict: true,
    versionKey: false,
  },
);

recommendationSnapshotSchema.pre('validate', function enforceSnapshotItemInvariants(next) {
  const items = this.items ?? [];
  let explorationCount = 0;
  const seenSongs = new Set();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.rank !== index + 1) {
      return next(new Error('invalid recommendation snapshot'));
    }
    const songKey = item.song == null ? '' : String(item.song);
    if (seenSongs.has(songKey)) {
      return next(new Error('duplicate snapshot item'));
    }
    seenSongs.add(songKey);

    const hybridNumeric = item.hybrid_score != null;
    if (hybridNumeric && item.collaborative_known !== true) {
      return next(new Error('invalid recommendation snapshot'));
    }

    if (item.basis === 'hybrid') {
      if (
        item.policy_score == null ||
        item.hybrid_score == null ||
        item.profile_score != null ||
        item.collaborative_known !== true
      ) {
        return next(new Error('invalid recommendation snapshot'));
      }
    } else if (item.basis === 'hybrid-profile') {
      if (
        item.policy_score == null ||
        item.hybrid_score == null ||
        item.profile_score == null ||
        item.collaborative_known !== true
      ) {
        return next(new Error('invalid recommendation snapshot'));
      }
    } else if (item.basis === 'profile') {
      if (
        item.policy_score == null ||
        item.hybrid_score != null ||
        item.profile_score == null
      ) {
        return next(new Error('invalid recommendation snapshot'));
      }
    } else if (item.basis === 'exploration') {
      explorationCount += 1;
      if (item.policy_score != null) {
        return next(new Error('invalid recommendation snapshot'));
      }
    } else {
      return next(new Error('invalid recommendation snapshot'));
    }
  }

  const summary = this.summary;
  if (summary) {
    if (summary.returned_count !== items.length) {
      return next(new Error('invalid recommendation snapshot'));
    }
    if (summary.exploration_selected_count !== explorationCount) {
      return next(new Error('invalid recommendation snapshot'));
    }
    if (
      summary.exploitation_selected_count !==
      items.length - explorationCount
    ) {
      return next(new Error('invalid recommendation snapshot'));
    }
  }
  return next();
});

recommendationSnapshotSchema.pre('save', snapshotSaveGuard);

const BLOCKED_QUERY_OPERATIONS = Object.freeze([
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndRemove',
]);

for (const operation of BLOCKED_QUERY_OPERATIONS) {
  recommendationSnapshotSchema.pre(operation, snapshotQueryGuard);
}

recommendationSnapshotSchema.pre(
  'deleteOne',
  { document: true, query: true },
  snapshotDocumentDeleteGuard,
);

recommendationSnapshotSchema.index(
  { user: 1, snapshot_version: 1 },
  { unique: true },
);
recommendationSnapshotSchema.index({ user: 1, generated_at: -1, _id: -1 });
recommendationSnapshotSchema.index({ snapshot_version: 1, generated_at: -1 });
recommendationSnapshotSchema.index(
  { artifact_version: 1, generated_at: -1 },
  { partialFilterExpression: { artifact_version: { $type: 'string' } } },
);

const RecommendationSnapshot = mongoose.model(
  'RecommendationSnapshot',
  recommendationSnapshotSchema,
);

export default RecommendationSnapshot;
