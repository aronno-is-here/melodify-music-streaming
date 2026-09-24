import {
  CONFIGURATION_KEYS,
  DATASET_STAT_KEYS,
  EVALUATION_METRIC_KEYS,
  EVALUATION_SUMMARY_KEYS,
  IDENTIFIER_PATTERN,
  PIPELINE_STAGES,
  RUN_ID_PATTERN,
} from '../models/RecommendationEvaluationRun.js';
import { createRecommendationEvaluationRunService } from './recommendationEvaluationRunService.js';

export const ADMIN_RECOMMENDATION_HISTORY_SOURCE = 'evaluation-history';
export const ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE = 'policy';
export const DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT = 20;
export const MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT = 100;
export const ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES = Object.freeze({
  invalidQuery: 'invalid recommendation history query',
  failed: 'failed to load recommendation history',
});

export class AdminRecommendationHistoryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminRecommendationHistoryError';
  }
}

export class AdminRecommendationHistoryValidationError extends AdminRecommendationHistoryError {
  constructor(message) {
    super(message);
    this.name = 'AdminRecommendationHistoryValidationError';
  }
}

export class AdminRecommendationHistoryReadError extends AdminRecommendationHistoryError {
  constructor(message) {
    super(message);
    this.name = 'AdminRecommendationHistoryReadError';
  }
}

const RUN_PROJECTION_MESSAGE = 'invalid evaluation history run';

const isPlainObjectLike = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isValidMetric = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isValidSummaryCount = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  Number.isSafeInteger(value);

const isValidStage = (value) =>
  typeof value === 'string' && PIPELINE_STAGES.includes(value);

const isValidLimit = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT;

const isSafeIdentifier = (value) =>
  typeof value === 'string' &&
  value.length >= 1 &&
  value.length <= 64 &&
  IDENTIFIER_PATTERN.test(value);

const isSeedValue = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 4294967295;

const isComponentCount = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 32;

const isUnitWeight = (value) =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

const isExplorationInterval = (value) =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 100;

const rejectRun = () => {
  throw new AdminRecommendationHistoryValidationError(RUN_PROJECTION_MESSAGE);
};

const normalizeEvaluatedAt = (value) => {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return value;
  }
  return null;
};

const projectMetrics = (metrics) => {
  if (!isPlainObjectLike(metrics)) rejectRun();
  const projected = {};
  for (const key of EVALUATION_METRIC_KEYS) {
    const value = metrics[key];
    if (!isValidMetric(value)) rejectRun();
    projected[key] = value;
  }
  return projected;
};

const projectSummary = (summary) => {
  if (!isPlainObjectLike(summary)) rejectRun();
  const projected = {};
  for (const key of EVALUATION_SUMMARY_KEYS) {
    const value = summary[key];
    if (!isValidSummaryCount(value)) rejectRun();
    projected[key] = value;
  }
  if (projected.evaluated_user_count > projected.relevance_user_count) {
    rejectRun();
  }
  if (projected.unique_recommended_at_10 > projected.catalog_size) {
    rejectRun();
  }
  if (
    projected.diversity_evaluable_user_count > projected.evaluated_user_count
  ) {
    rejectRun();
  }
  return projected;
};

const projectDataset = (dataset) => {
  if (!isPlainObjectLike(dataset)) rejectRun();
  const projected = {};
  for (const key of DATASET_STAT_KEYS) {
    const value = dataset[key];
    if (!isValidSummaryCount(value)) rejectRun();
    projected[key] = value;
  }
  const partitionSum =
    projected.train_event_count +
    projected.validation_event_count +
    projected.test_event_count;
  if (projected.raw_event_count !== partitionSum) rejectRun();
  return projected;
};

const projectConfiguration = (configuration) => {
  if (!isPlainObjectLike(configuration)) rejectRun();
  if (!Object.prototype.hasOwnProperty.call(configuration, 'random_seed')) {
    rejectRun();
  }
  if (!isSeedValue(configuration.random_seed)) rejectRun();

  const projected = {
    random_seed: configuration.random_seed,
    algorithm: null,
    requested_components: null,
    effective_components: null,
    collaborative_weight: null,
    content_weight: null,
    base_hybrid_policy_weight: null,
    explicit_profile_policy_weight: null,
    exploration_interval: null,
  };

  if (
    Object.prototype.hasOwnProperty.call(configuration, 'algorithm') &&
    configuration.algorithm !== undefined
  ) {
    const algorithm = configuration.algorithm;
    if (algorithm !== null && !isSafeIdentifier(algorithm)) rejectRun();
    projected.algorithm = algorithm;
  }

  const hasRequested = Object.prototype.hasOwnProperty.call(
    configuration,
    'requested_components',
  );
  const hasEffective = Object.prototype.hasOwnProperty.call(
    configuration,
    'effective_components',
  );
  if (hasRequested && configuration.requested_components !== undefined) {
    const requested = configuration.requested_components;
    if (requested !== null && !isComponentCount(requested)) rejectRun();
    projected.requested_components = requested;
  }
  if (hasEffective && configuration.effective_components !== undefined) {
    const effective = configuration.effective_components;
    if (effective !== null && !isComponentCount(effective)) rejectRun();
    projected.effective_components = effective;
  }
  if (
    projected.requested_components !== null &&
    projected.effective_components !== null &&
    projected.effective_components > projected.requested_components
  ) {
    rejectRun();
  }

  const hasCollaborative = Object.prototype.hasOwnProperty.call(
    configuration,
    'collaborative_weight',
  );
  const hasContent = Object.prototype.hasOwnProperty.call(
    configuration,
    'content_weight',
  );
  if (hasCollaborative !== hasContent) rejectRun();
  if (hasCollaborative) {
    const collaborative = configuration.collaborative_weight;
    const content = configuration.content_weight;
    if (
      collaborative === undefined ||
      content === undefined ||
      !isUnitWeight(collaborative) ||
      !isUnitWeight(content)
    ) {
      rejectRun();
    }
    if (Math.abs(collaborative + content - 1) > 1e-9) rejectRun();
    projected.collaborative_weight = collaborative;
    projected.content_weight = content;
  }

  const hasBase = Object.prototype.hasOwnProperty.call(
    configuration,
    'base_hybrid_policy_weight',
  );
  const hasProfile = Object.prototype.hasOwnProperty.call(
    configuration,
    'explicit_profile_policy_weight',
  );
  if (hasBase !== hasProfile) rejectRun();
  if (hasBase) {
    const base = configuration.base_hybrid_policy_weight;
    const profile = configuration.explicit_profile_policy_weight;
    if (
      base === undefined ||
      profile === undefined ||
      !isUnitWeight(base) ||
      !isUnitWeight(profile)
    ) {
      rejectRun();
    }
    if (Math.abs(base + profile - 1) > 1e-9) rejectRun();
    projected.base_hybrid_policy_weight = base;
    projected.explicit_profile_policy_weight = profile;
  }

  if (
    Object.prototype.hasOwnProperty.call(configuration, 'exploration_interval') &&
    configuration.exploration_interval !== undefined
  ) {
    const interval = configuration.exploration_interval;
    if (interval !== null && !isExplorationInterval(interval)) rejectRun();
    projected.exploration_interval = interval;
  }

  for (const key of CONFIGURATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(projected, key)) rejectRun();
  }

  return projected;
};

const projectRun = (run, pipelineStage) => {
  if (!isPlainObjectLike(run)) rejectRun();
  if (
    typeof run.run_id !== 'string' ||
    run.run_id.length === 0 ||
    !RUN_ID_PATTERN.test(run.run_id)
  ) {
    rejectRun();
  }
  if (run.pipeline_stage !== pipelineStage) rejectRun();

  const evaluatedAt = normalizeEvaluatedAt(run.evaluated_at);
  if (evaluatedAt === null) rejectRun();

  let artifactVersion = null;
  if (run.artifact_version !== undefined && run.artifact_version !== null) {
    if (!isSafeIdentifier(run.artifact_version)) rejectRun();
    artifactVersion = run.artifact_version;
  }

  return {
    run_id: run.run_id,
    pipeline_stage: run.pipeline_stage,
    artifact_version: artifactVersion,
    evaluated_at: evaluatedAt,
    metrics: projectMetrics(run.metrics),
    summary: projectSummary(run.summary),
    dataset: projectDataset(run.dataset),
    configuration: projectConfiguration(run.configuration),
  };
};

export function createAdminRecommendationHistoryService({
  evaluationRunService = createRecommendationEvaluationRunService(),
} = {}) {
  if (
    !evaluationRunService ||
    typeof evaluationRunService.listEvaluationRuns !== 'function'
  ) {
    throw new AdminRecommendationHistoryValidationError(
      'invalid evaluation run service',
    );
  }

  const getRecommendationEvaluationHistory = async ({
    pipelineStage = ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE,
    limit = DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  } = {}) => {
    if (!isValidStage(pipelineStage)) {
      throw new AdminRecommendationHistoryValidationError(
        ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES.invalidQuery,
      );
    }
    if (!isValidLimit(limit)) {
      throw new AdminRecommendationHistoryValidationError(
        ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES.invalidQuery,
      );
    }

    let runs;
    try {
      runs = await evaluationRunService.listEvaluationRuns({
        limit,
        pipeline_stage: pipelineStage,
      });
    } catch (error) {
      if (error instanceof AdminRecommendationHistoryError) throw error;
      throw new AdminRecommendationHistoryReadError(
        ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES.failed,
      );
    }

    if (!Array.isArray(runs) || runs.length === 0) {
      return {
        state: 'no-runs',
        source: ADMIN_RECOMMENDATION_HISTORY_SOURCE,
        pipeline_stage: pipelineStage,
        limit,
        count: 0,
        runs: [],
      };
    }

    if (runs.length > limit) {
      throw new AdminRecommendationHistoryValidationError(RUN_PROJECTION_MESSAGE);
    }

    const projectedRuns = runs.map((run) => projectRun(run, pipelineStage));

    return {
      state: 'ready',
      source: ADMIN_RECOMMENDATION_HISTORY_SOURCE,
      pipeline_stage: pipelineStage,
      limit,
      count: projectedRuns.length,
      runs: projectedRuns,
    };
  };

  return { getRecommendationEvaluationHistory };
}

export default createAdminRecommendationHistoryService;
