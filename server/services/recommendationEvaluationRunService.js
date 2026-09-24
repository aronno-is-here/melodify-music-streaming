import crypto from 'node:crypto';
import RecommendationEvaluationRun, {
  CONFIGURATION_KEYS,
  DATASET_STAT_KEYS,
  EVALUATION_METRIC_KEYS,
  EVALUATION_RUN_SCHEMA_VERSION,
  EVALUATION_SUMMARY_KEYS,
  IDENTIFIER_PATTERN,
  MAX_EXPLORATION_INTERVAL,
  MAX_IDENTIFIER_LENGTH,
  MAX_LATENT_COMPONENTS,
  MAX_PERSISTED_COUNT,
  MAX_RUN_ID_LENGTH,
  MAX_SEED,
  PAYLOAD_SHA256_PATTERN,
  PIPELINE_STAGES,
  RUN_ID_PATTERN,
  WEIGHT_SUM_TOLERANCE,
} from '../models/RecommendationEvaluationRun.js';

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

export const EVALUATION_RUN_LIST_OPTION_KEYS = Object.freeze([
  'limit',
  'pipeline_stage',
]);

export class EvaluationRunError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvaluationRunError';
  }
}

export class EvaluationRunValidationError extends EvaluationRunError {
  constructor(message) {
    super(message);
    this.name = 'EvaluationRunValidationError';
  }
}

export class EvaluationRunConflictError extends EvaluationRunError {
  constructor(message) {
    super(message);
    this.name = 'EvaluationRunConflictError';
  }
}

export class EvaluationRunPersistenceError extends EvaluationRunError {
  constructor(message) {
    super(message);
    this.name = 'EvaluationRunPersistenceError';
  }
}

export class EvaluationRunImmutableError extends EvaluationRunError {
  constructor(message) {
    super(message);
    this.name = 'EvaluationRunImmutableError';
  }
}

const isPlainObjectLike = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

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

const rejectUnknownKeys = (value, allowedKeys, fallbackMessage) => {
  if (!isPlainObjectLike(value)) {
    throw new EvaluationRunValidationError(fallbackMessage);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      throw new EvaluationRunValidationError(fallbackMessage);
    }
  }
};

export const normalizeRunId = (value) => {
  if (typeof value !== 'string') {
    throw new EvaluationRunValidationError('invalid evaluation run id');
  }
  if (value.length < 1 || value.length > MAX_RUN_ID_LENGTH) {
    throw new EvaluationRunValidationError('invalid evaluation run id');
  }
  if (value !== value.trim()) {
    throw new EvaluationRunValidationError('invalid evaluation run id');
  }
  if (value === '.' || value === '..') {
    throw new EvaluationRunValidationError('invalid evaluation run id');
  }
  if (!RUN_ID_PATTERN.test(value)) {
    throw new EvaluationRunValidationError('invalid evaluation run id');
  }
  return value;
};

const normalizePipelineStage = (value) => {
  if (typeof value !== 'string' || !PIPELINE_STAGES.includes(value)) {
    throw new EvaluationRunValidationError('invalid evaluation run stage');
  }
  return value;
};

const normalizeArtifactVersion = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isSafeIdentifier(value)) {
    throw new EvaluationRunValidationError('invalid evaluation artifact version');
  }
  return value;
};

const ISO_WITH_EXPLICIT_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const normalizeEvaluatedAt = (value) => {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) {
      throw new EvaluationRunValidationError('invalid evaluation timestamp');
    }
    return new Date(time);
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!ISO_WITH_EXPLICIT_ZONE.test(text)) {
      throw new EvaluationRunValidationError('invalid evaluation timestamp');
    }
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) {
      throw new EvaluationRunValidationError('invalid evaluation timestamp');
    }
    return parsed;
  }
  throw new EvaluationRunValidationError('invalid evaluation timestamp');
};

const normalizeMetrics = (value) => {
  rejectUnknownKeys(
    value,
    EVALUATION_METRIC_KEYS,
    'invalid evaluation metrics',
  );
  const normalized = {};
  for (const key of EVALUATION_METRIC_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new EvaluationRunValidationError('invalid evaluation metrics');
    }
    const metric = value[key];
    if (!isMetricValue(metric)) {
      throw new EvaluationRunValidationError('invalid evaluation metrics');
    }
    normalized[key] = metric;
  }
  return normalized;
};

const normalizeSummary = (value) => {
  rejectUnknownKeys(
    value,
    EVALUATION_SUMMARY_KEYS,
    'invalid evaluation summary',
  );
  const normalized = {};
  for (const key of EVALUATION_SUMMARY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new EvaluationRunValidationError('invalid evaluation summary');
    }
    const count = value[key];
    if (!isNonNegativeSafeCount(count)) {
      throw new EvaluationRunValidationError('invalid evaluation summary');
    }
    normalized[key] = count;
  }
  if (normalized.evaluated_user_count > normalized.relevance_user_count) {
    throw new EvaluationRunValidationError('invalid evaluation summary');
  }
  if (normalized.unique_recommended_at_10 > normalized.catalog_size) {
    throw new EvaluationRunValidationError('invalid evaluation summary');
  }
  if (
    normalized.diversity_evaluable_user_count > normalized.evaluated_user_count
  ) {
    throw new EvaluationRunValidationError('invalid evaluation summary');
  }
  return normalized;
};

const normalizeDataset = (value) => {
  rejectUnknownKeys(value, DATASET_STAT_KEYS, 'invalid evaluation dataset');
  const normalized = {};
  for (const key of DATASET_STAT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new EvaluationRunValidationError('invalid evaluation dataset');
    }
    const count = value[key];
    if (!isNonNegativeSafeCount(count)) {
      throw new EvaluationRunValidationError('invalid evaluation dataset');
    }
    normalized[key] = count;
  }
  const partitionSum =
    normalized.train_event_count +
    normalized.validation_event_count +
    normalized.test_event_count;
  if (normalized.raw_event_count !== partitionSum) {
    throw new EvaluationRunValidationError('invalid evaluation dataset');
  }
  if (
    normalized.raw_event_count === 0 &&
    (normalized.train_event_count !== 0 ||
      normalized.validation_event_count !== 0 ||
      normalized.test_event_count !== 0)
  ) {
    throw new EvaluationRunValidationError('invalid evaluation dataset');
  }
  return normalized;
};

const normalizeConfiguration = (value) => {
  rejectUnknownKeys(
    value,
    CONFIGURATION_KEYS,
    'invalid evaluation configuration',
  );
  if (!Object.prototype.hasOwnProperty.call(value, 'random_seed')) {
    throw new EvaluationRunValidationError('invalid evaluation configuration');
  }
  if (!isSeedValue(value.random_seed)) {
    throw new EvaluationRunValidationError('invalid evaluation configuration');
  }

  const normalized = { random_seed: value.random_seed };

  if (value.algorithm !== undefined) {
    if (value.algorithm === null) {
      normalized.algorithm = null;
    } else if (!isSafeIdentifier(value.algorithm)) {
      throw new EvaluationRunValidationError('invalid evaluation configuration');
    } else {
      normalized.algorithm = value.algorithm;
    }
  }

  const hasRequested = value.requested_components !== undefined;
  const hasEffective = value.effective_components !== undefined;
  if (hasRequested) {
    if (value.requested_components === null) {
      normalized.requested_components = null;
    } else if (!isComponentCount(value.requested_components)) {
      throw new EvaluationRunValidationError('invalid evaluation configuration');
    } else {
      normalized.requested_components = value.requested_components;
    }
  }
  if (hasEffective) {
    if (value.effective_components === null) {
      normalized.effective_components = null;
    } else if (!isComponentCount(value.effective_components)) {
      throw new EvaluationRunValidationError('invalid evaluation configuration');
    } else {
      normalized.effective_components = value.effective_components;
    }
  }
  const requested = normalized.requested_components;
  const effective = normalized.effective_components;
  if (
    requested !== undefined &&
    requested !== null &&
    effective !== undefined &&
    effective !== null &&
    effective > requested
  ) {
    throw new EvaluationRunValidationError('invalid evaluation configuration');
  }

  const hasCollaborative = value.collaborative_weight !== undefined;
  const hasContent = value.content_weight !== undefined;
  if (hasCollaborative !== hasContent) {
    throw new EvaluationRunValidationError('invalid evaluation configuration');
  }
  if (hasCollaborative) {
    const collaborative = value.collaborative_weight;
    const content = value.content_weight;
    if (!isUnitWeight(collaborative) || !isUnitWeight(content)) {
      throw new EvaluationRunValidationError('invalid evaluation configuration');
    }
    if (Math.abs(collaborative + content - 1) > WEIGHT_SUM_TOLERANCE) {
      throw new EvaluationRunValidationError('invalid evaluation configuration');
    }
    normalized.collaborative_weight = collaborative;
    normalized.content_weight = content;
  }

  const hasBase = value.base_hybrid_policy_weight !== undefined;
  const hasProfile = value.explicit_profile_policy_weight !== undefined;
  if (hasBase !== hasProfile) {
    throw new EvaluationRunValidationError('invalid evaluation configuration');
  }
  if (hasBase) {
    const base = value.base_hybrid_policy_weight;
    const profile = value.explicit_profile_policy_weight;
    if (!isUnitWeight(base) || !isUnitWeight(profile)) {
      throw new EvaluationRunValidationError('invalid evaluation configuration');
    }
    if (Math.abs(base + profile - 1) > WEIGHT_SUM_TOLERANCE) {
      throw new EvaluationRunValidationError('invalid evaluation configuration');
    }
    normalized.base_hybrid_policy_weight = base;
    normalized.explicit_profile_policy_weight = profile;
  }

  if (value.exploration_interval !== undefined) {
    if (value.exploration_interval === null) {
      normalized.exploration_interval = null;
    } else if (!isExplorationInterval(value.exploration_interval)) {
      throw new EvaluationRunValidationError('invalid evaluation configuration');
    } else {
      normalized.exploration_interval = value.exploration_interval;
    }
  }

  return normalized;
};

const TOP_LEVEL_KEYS = Object.freeze([
  'schema_version',
  'run_id',
  'pipeline_stage',
  'artifact_version',
  'evaluated_at',
  'metrics',
  'summary',
  'dataset',
  'configuration',
]);

export const normalizeEvaluationRunPayload = (payload) => {
  if (!isPlainObjectLike(payload)) {
    throw new EvaluationRunValidationError('invalid evaluation run payload');
  }
  rejectUnknownKeys(
    payload,
    TOP_LEVEL_KEYS,
    'invalid evaluation run payload',
  );

  if (payload.schema_version !== undefined) {
    if (payload.schema_version !== EVALUATION_RUN_SCHEMA_VERSION) {
      throw new EvaluationRunValidationError(
        'unsupported evaluation run schema version',
      );
    }
  }

  if (
    payload.metrics === undefined ||
    payload.summary === undefined ||
    payload.dataset === undefined ||
    payload.configuration === undefined
  ) {
    throw new EvaluationRunValidationError('invalid evaluation run payload');
  }

  return {
    schema_version: EVALUATION_RUN_SCHEMA_VERSION,
    run_id: normalizeRunId(payload.run_id),
    pipeline_stage: normalizePipelineStage(payload.pipeline_stage),
    artifact_version: normalizeArtifactVersion(payload.artifact_version),
    evaluated_at: normalizeEvaluatedAt(payload.evaluated_at),
    metrics: normalizeMetrics(payload.metrics),
    summary: normalizeSummary(payload.summary),
    dataset: normalizeDataset(payload.dataset),
    configuration: normalizeConfiguration(payload.configuration),
  };
};

const orderedMetrics = (metrics) => {
  const ordered = {};
  for (const key of EVALUATION_METRIC_KEYS) {
    ordered[key] = metrics[key];
  }
  return ordered;
};

const orderedSummary = (summary) => {
  const ordered = {};
  for (const key of EVALUATION_SUMMARY_KEYS) {
    ordered[key] = summary[key];
  }
  return ordered;
};

const orderedDataset = (dataset) => {
  const ordered = {};
  for (const key of DATASET_STAT_KEYS) {
    ordered[key] = dataset[key];
  }
  return ordered;
};

const orderedConfiguration = (configuration) => {
  const ordered = { random_seed: configuration.random_seed };
  for (const key of CONFIGURATION_KEYS) {
    if (key === 'random_seed') continue;
    if (Object.prototype.hasOwnProperty.call(configuration, key)) {
      ordered[key] = configuration[key];
    }
  }
  return ordered;
};

const evaluatedAtIso = (value) => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new EvaluationRunValidationError('invalid evaluation timestamp');
  }
  return parsed.toISOString();
};

export const computeEvaluationRunPayloadSha256 = (normalized) => {
  if (!isPlainObjectLike(normalized)) {
    throw new EvaluationRunValidationError('invalid evaluation run payload');
  }
  const canonical = {
    schema_version: EVALUATION_RUN_SCHEMA_VERSION,
    run_id: normalized.run_id,
    pipeline_stage: normalized.pipeline_stage,
    artifact_version:
      normalized.artifact_version === undefined
        ? null
        : normalized.artifact_version,
    evaluated_at: evaluatedAtIso(normalized.evaluated_at),
    metrics: orderedMetrics(normalized.metrics),
    summary: orderedSummary(normalized.summary),
    dataset: orderedDataset(normalized.dataset),
    configuration: orderedConfiguration(normalized.configuration),
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');
};

const isDuplicateKeyError = (error) => {
  if (!error) return false;
  return error.code === 11000 || error.code === 'E11000';
};

const toPlainRun = (run) => {
  if (run == null) return run;
  if (typeof run.toObject === 'function') return run.toObject();
  return run;
};

const normalizeListOptions = (options) => {
  if (options === undefined) {
    return { limit: DEFAULT_LIST_LIMIT, pipeline_stage: undefined };
  }
  if (!isPlainObjectLike(options)) {
    throw new EvaluationRunValidationError('invalid evaluation run list options');
  }
  for (const key of Object.keys(options)) {
    if (!EVALUATION_RUN_LIST_OPTION_KEYS.includes(key)) {
      throw new EvaluationRunValidationError('invalid evaluation run list options');
    }
  }

  let limit = DEFAULT_LIST_LIMIT;
  if (options.limit !== undefined) {
    if (
      typeof options.limit !== 'number' ||
      !Number.isInteger(options.limit) ||
      options.limit < 1 ||
      options.limit > MAX_LIST_LIMIT
    ) {
      throw new EvaluationRunValidationError('invalid evaluation run list options');
    }
    limit = options.limit;
  }

  let pipeline_stage;
  if (options.pipeline_stage !== undefined) {
    pipeline_stage = normalizePipelineStage(options.pipeline_stage);
  }

  return { limit, pipeline_stage };
};

export const createRecommendationEvaluationRunService = ({
  EvaluationRunModel = RecommendationEvaluationRun,
} = {}) => {
  const recordEvaluationRun = async (payload) => {
    const normalized = normalizeEvaluationRunPayload(payload);
    const payload_sha256 = computeEvaluationRunPayloadSha256(normalized);

    const document = {
      schema_version: normalized.schema_version,
      run_id: normalized.run_id,
      pipeline_stage: normalized.pipeline_stage,
      artifact_version: normalized.artifact_version,
      evaluated_at: normalized.evaluated_at,
      metrics: orderedMetrics(normalized.metrics),
      summary: orderedSummary(normalized.summary),
      dataset: orderedDataset(normalized.dataset),
      configuration: orderedConfiguration(normalized.configuration),
      payload_sha256,
    };

    try {
      const created = await EvaluationRunModel.create(document);
      return { created: true, run: toPlainRun(created) };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw new EvaluationRunPersistenceError(
          'failed to persist evaluation run',
        );
      }

      let existing = null;
      try {
        existing = await EvaluationRunModel.findOne({
          run_id: normalized.run_id,
        });
      } catch {
        throw new EvaluationRunPersistenceError(
          'failed to persist evaluation run',
        );
      }

      if (!existing) {
        throw new EvaluationRunPersistenceError(
          'failed to persist evaluation run',
        );
      }

      const existingHash =
        typeof existing.payload_sha256 === 'string'
          ? existing.payload_sha256
          : existing.get?.('payload_sha256');
      if (existingHash !== payload_sha256) {
        throw new EvaluationRunConflictError(
          'evaluation run already exists with different content',
        );
      }
      return { created: false, run: toPlainRun(existing) };
    }
  };

  const getEvaluationRunByRunId = async (runId) => {
    const normalizedRunId = normalizeRunId(runId);
    try {
      const run = await EvaluationRunModel.findOne({
        run_id: normalizedRunId,
      }).lean();
      return run ?? null;
    } catch (error) {
      if (error instanceof EvaluationRunError) throw error;
      throw new EvaluationRunPersistenceError(
        'failed to persist evaluation run',
      );
    }
  };

  const listEvaluationRuns = async (options = {}) => {
    const { limit, pipeline_stage } = normalizeListOptions(options);
    const filter = {};
    if (pipeline_stage !== undefined) {
      filter.pipeline_stage = pipeline_stage;
    }
    try {
      const runs = await EvaluationRunModel.find(filter)
        .sort({ evaluated_at: -1, _id: -1 })
        .limit(limit)
        .lean();
      return runs;
    } catch (error) {
      if (error instanceof EvaluationRunError) throw error;
      throw new EvaluationRunPersistenceError(
        'failed to persist evaluation run',
      );
    }
  };

  return {
    recordEvaluationRun,
    getEvaluationRunByRunId,
    listEvaluationRuns,
  };
};

export default createRecommendationEvaluationRunService;
