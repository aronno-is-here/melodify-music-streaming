import mongoose from 'mongoose';

export const EVALUATION_RUN_SCHEMA_VERSION = 1;

export const PIPELINE_STAGES = Object.freeze([
  'collaborative',
  'hybrid',
  'policy',
]);

export const MAX_PERSISTED_COUNT = 1_000_000_000;
export const MAX_RUN_ID_LENGTH = 64;
export const MAX_IDENTIFIER_LENGTH = 64;
export const MAX_SEED = 4294967295;
export const MAX_LATENT_COMPONENTS = 32;
export const MAX_EXPLORATION_INTERVAL = 100;
export const WEIGHT_SUM_TOLERANCE = 1e-9;

export const EVALUATION_METRIC_KEYS = Object.freeze([
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

export const EVALUATION_SUMMARY_KEYS = Object.freeze([
  'evaluated_user_count',
  'recommendation_user_count',
  'relevance_user_count',
  'catalog_size',
  'unique_recommended_at_10',
  'diversity_evaluable_user_count',
  'diversity_pair_count',
]);

export const DATASET_STAT_KEYS = Object.freeze([
  'raw_event_count',
  'train_event_count',
  'validation_event_count',
  'test_event_count',
  'unique_user_count',
  'unique_song_count',
  'session_count',
  'interaction_pair_count',
  'content_feature_count',
]);

export const CONFIGURATION_KEYS = Object.freeze([
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

export const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
export const PAYLOAD_SHA256_PATTERN = /^[a-f0-9]{64}$/;

const isNonNegativeSafeCount = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_PERSISTED_COUNT;

const isMetricValue = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isSeedValue = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= MAX_SEED;

const isComponentCount = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_LATENT_COMPONENTS;

const isUnitWeight = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isExplorationInterval = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_EXPLORATION_INTERVAL;

const isSafeIdentifier = (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= MAX_IDENTIFIER_LENGTH &&
  IDENTIFIER_PATTERN.test(value);

const countField = (required) => ({
  type: Number,
  required,
  validate: {
    validator: isNonNegativeSafeCount,
    message: 'count must be a non-negative safe integer within the persistence bound',
  },
});

const metricField = {
  type: Number,
  required: true,
  validate: {
    validator: isMetricValue,
    message: 'metric must be a finite number between 0 and 1',
  },
};

const metricsSubschema = new mongoose.Schema(
  {
    precision_at_5: metricField,
    precision_at_10: metricField,
    recall_at_5: metricField,
    recall_at_10: metricField,
    ndcg_at_5: metricField,
    ndcg_at_10: metricField,
    map_at_10: metricField,
    hit_rate_at_10: metricField,
    catalog_coverage: metricField,
    diversity: metricField,
  },
  { _id: false, id: false },
);

const summarySubschema = new mongoose.Schema(
  {
    evaluated_user_count: countField(true),
    recommendation_user_count: countField(true),
    relevance_user_count: countField(true),
    catalog_size: countField(true),
    unique_recommended_at_10: countField(true),
    diversity_evaluable_user_count: countField(true),
    diversity_pair_count: countField(true),
  },
  { _id: false, id: false },
);

summarySubschema.pre('validate', function enforceSummaryInvariants(next) {
  if (this.evaluated_user_count > this.relevance_user_count) {
    return next(new Error('invalid evaluation summary'));
  }
  if (this.unique_recommended_at_10 > this.catalog_size) {
    return next(new Error('invalid evaluation summary'));
  }
  if (this.diversity_evaluable_user_count > this.evaluated_user_count) {
    return next(new Error('invalid evaluation summary'));
  }
  return next();
});

const datasetSubschema = new mongoose.Schema(
  {
    raw_event_count: countField(true),
    train_event_count: countField(true),
    validation_event_count: countField(true),
    test_event_count: countField(true),
    unique_user_count: countField(true),
    unique_song_count: countField(true),
    session_count: countField(true),
    interaction_pair_count: countField(true),
    content_feature_count: countField(true),
  },
  { _id: false, id: false },
);

datasetSubschema.pre('validate', function enforceDatasetConservation(next) {
  const partitionSum =
    this.train_event_count + this.validation_event_count + this.test_event_count;
  if (this.raw_event_count !== partitionSum) {
    return next(new Error('invalid evaluation dataset'));
  }
  if (
    this.raw_event_count === 0 &&
    (this.train_event_count !== 0 ||
      this.validation_event_count !== 0 ||
      this.test_event_count !== 0)
  ) {
    return next(new Error('invalid evaluation dataset'));
  }
  return next();
});

const configurationSubschema = new mongoose.Schema(
  {
    random_seed: {
      type: Number,
      required: true,
      validate: {
        validator: isSeedValue,
        message: 'random_seed must be an integer between 0 and 4294967295',
      },
    },
    algorithm: {
      type: String,
      default: undefined,
      validate: {
        validator: (value) => value == null || isSafeIdentifier(value),
        message: 'algorithm must be a safe lowercase identifier',
      },
    },
    requested_components: {
      type: Number,
      default: undefined,
      validate: {
        validator: (value) => value == null || isComponentCount(value),
        message: 'requested_components must be an integer between 1 and 32',
      },
    },
    effective_components: {
      type: Number,
      default: undefined,
      validate: {
        validator: (value) => value == null || isComponentCount(value),
        message: 'effective_components must be an integer between 1 and 32',
      },
    },
    collaborative_weight: {
      type: Number,
      default: undefined,
      validate: {
        validator: (value) => value == null || isUnitWeight(value),
        message: 'collaborative_weight must be between 0 and 1',
      },
    },
    content_weight: {
      type: Number,
      default: undefined,
      validate: {
        validator: (value) => value == null || isUnitWeight(value),
        message: 'content_weight must be between 0 and 1',
      },
    },
    base_hybrid_policy_weight: {
      type: Number,
      default: undefined,
      validate: {
        validator: (value) => value == null || isUnitWeight(value),
        message: 'base_hybrid_policy_weight must be between 0 and 1',
      },
    },
    explicit_profile_policy_weight: {
      type: Number,
      default: undefined,
      validate: {
        validator: (value) => value == null || isUnitWeight(value),
        message: 'explicit_profile_policy_weight must be between 0 and 1',
      },
    },
    exploration_interval: {
      type: Number,
      default: undefined,
      validate: {
        validator: (value) => value == null || isExplorationInterval(value),
        message: 'exploration_interval must be an integer between 1 and 100',
      },
    },
  },
  { _id: false, id: false },
);

configurationSubschema.pre('validate', function enforceConfigurationPairs(next) {
  const hasRequested = this.requested_components != null;
  const hasEffective = this.effective_components != null;
  if (hasRequested && hasEffective && this.effective_components > this.requested_components) {
    return next(new Error('invalid evaluation configuration'));
  }

  const hasCollaborative = this.collaborative_weight != null;
  const hasContent = this.content_weight != null;
  if (hasCollaborative !== hasContent) {
    return next(new Error('invalid evaluation configuration'));
  }
  if (
    hasCollaborative &&
    Math.abs(this.collaborative_weight + this.content_weight - 1) > WEIGHT_SUM_TOLERANCE
  ) {
    return next(new Error('invalid evaluation configuration'));
  }

  const hasBase = this.base_hybrid_policy_weight != null;
  const hasProfile = this.explicit_profile_policy_weight != null;
  if (hasBase !== hasProfile) {
    return next(new Error('invalid evaluation configuration'));
  }
  if (
    hasBase &&
    Math.abs(
      this.base_hybrid_policy_weight + this.explicit_profile_policy_weight - 1,
    ) > WEIGHT_SUM_TOLERANCE
  ) {
    return next(new Error('invalid evaluation configuration'));
  }
  return next();
});

export const evaluationRunSaveGuard = function evaluationRunSaveGuard(next) {
  if (!this.isNew) {
    next(new Error('evaluation run history is immutable'));
    return;
  }
  next();
};

export const evaluationRunQueryGuard = function evaluationRunQueryGuard(next) {
  next(new Error('evaluation run history is immutable'));
};

export const evaluationRunDocumentDeleteGuard =
  function evaluationRunDocumentDeleteGuard(next) {
    next(new Error('evaluation run history is immutable'));
  };

const recommendationEvaluationRunSchema = new mongoose.Schema(
  {
    schema_version: {
      type: Number,
      required: true,
      enum: [EVALUATION_RUN_SCHEMA_VERSION],
      default: EVALUATION_RUN_SCHEMA_VERSION,
      immutable: true,
    },
    run_id: {
      type: String,
      required: true,
      trim: false,
      maxlength: MAX_RUN_ID_LENGTH,
      match: [RUN_ID_PATTERN, 'invalid evaluation run id'],
      immutable: true,
    },
    pipeline_stage: {
      type: String,
      required: true,
      enum: PIPELINE_STAGES,
      immutable: true,
    },
    artifact_version: {
      type: String,
      default: null,
      maxlength: MAX_IDENTIFIER_LENGTH,
      validate: {
        validator: (value) => value == null || IDENTIFIER_PATTERN.test(value),
        message: 'invalid evaluation artifact version',
      },
      immutable: true,
    },
    evaluated_at: {
      type: Date,
      required: true,
      immutable: true,
    },
    metrics: {
      type: metricsSubschema,
      required: true,
      immutable: true,
    },
    summary: {
      type: summarySubschema,
      required: true,
      immutable: true,
    },
    dataset: {
      type: datasetSubschema,
      required: true,
      immutable: true,
    },
    configuration: {
      type: configurationSubschema,
      required: true,
      immutable: true,
    },
    payload_sha256: {
      type: String,
      required: true,
      match: [PAYLOAD_SHA256_PATTERN, 'invalid evaluation payload fingerprint'],
      immutable: true,
    },
  },
  {
    timestamps: true,
    strict: true,
    versionKey: false,
  },
);

recommendationEvaluationRunSchema.pre('save', evaluationRunSaveGuard);

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
  recommendationEvaluationRunSchema.pre(operation, evaluationRunQueryGuard);
}

recommendationEvaluationRunSchema.pre(
  'deleteOne',
  { document: true, query: true },
  evaluationRunDocumentDeleteGuard,
);

recommendationEvaluationRunSchema.index({ run_id: 1 }, { unique: true });
recommendationEvaluationRunSchema.index({ evaluated_at: -1 });
recommendationEvaluationRunSchema.index({ pipeline_stage: 1, evaluated_at: -1 });
recommendationEvaluationRunSchema.index(
  { artifact_version: 1, evaluated_at: -1 },
  { partialFilterExpression: { artifact_version: { $type: 'string' } } },
);

const RecommendationEvaluationRun = mongoose.model(
  'RecommendationEvaluationRun',
  recommendationEvaluationRunSchema,
);

export default RecommendationEvaluationRun;
