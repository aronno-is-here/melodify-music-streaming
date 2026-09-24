import {
  EVALUATION_METRIC_KEYS,
  EVALUATION_SUMMARY_KEYS,
  IDENTIFIER_PATTERN,
  PIPELINE_STAGES,
  RUN_ID_PATTERN,
} from '../models/RecommendationEvaluationRun.js';
import { createRecommendationEvaluationRunService } from './recommendationEvaluationRunService.js';

export const ADMIN_RECOMMENDATION_METRICS_SOURCE = 'evaluation-history';
export const ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE = 'policy';
export const ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES = Object.freeze({
  invalidQuery: 'invalid recommendation metrics query',
  failed: 'failed to load recommendation metrics',
});

export class AdminRecommendationMetricsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AdminRecommendationMetricsError';
  }
}

export class AdminRecommendationMetricsValidationError extends AdminRecommendationMetricsError {
  constructor(message) {
    super(message);
    this.name = 'AdminRecommendationMetricsValidationError';
  }
}

export class AdminRecommendationMetricsReadError extends AdminRecommendationMetricsError {
  constructor(message) {
    super(message);
    this.name = 'AdminRecommendationMetricsReadError';
  }
}

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
  value >= 0;

const isValidStage = (value) =>
  typeof value === 'string' && PIPELINE_STAGES.includes(value);

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

const projectLatestRun = (run, pipelineStage) => {
  if (!isPlainObjectLike(run)) {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation metrics run',
    );
  }
  if (
    typeof run.run_id !== 'string' ||
    run.run_id.length === 0 ||
    !RUN_ID_PATTERN.test(run.run_id)
  ) {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation metrics run',
    );
  }
  if (run.pipeline_stage !== pipelineStage) {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation metrics run',
    );
  }

  const evaluatedAt = normalizeEvaluatedAt(run.evaluated_at);
  if (evaluatedAt === null) {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation metrics run',
    );
  }

  let artifactVersion = null;
  if (run.artifact_version !== undefined && run.artifact_version !== null) {
    if (
      typeof run.artifact_version !== 'string' ||
      !IDENTIFIER_PATTERN.test(run.artifact_version)
    ) {
      throw new AdminRecommendationMetricsValidationError(
        'invalid evaluation metrics run',
      );
    }
    artifactVersion = run.artifact_version;
  }

  if (!isPlainObjectLike(run.metrics)) {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation metrics run',
    );
  }
  const metrics = {};
  for (const key of EVALUATION_METRIC_KEYS) {
    const value = run.metrics[key];
    if (!isValidMetric(value)) {
      throw new AdminRecommendationMetricsValidationError(
        'invalid evaluation metrics run',
      );
    }
    metrics[key] = value;
  }

  if (!isPlainObjectLike(run.summary)) {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation metrics run',
    );
  }
  const summary = {};
  for (const key of EVALUATION_SUMMARY_KEYS) {
    const value = run.summary[key];
    if (!isValidSummaryCount(value)) {
      throw new AdminRecommendationMetricsValidationError(
        'invalid evaluation metrics run',
      );
    }
    summary[key] = value;
  }

  if (summary.evaluated_user_count > summary.relevance_user_count) {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation metrics run',
    );
  }
  if (summary.unique_recommended_at_10 > summary.catalog_size) {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation metrics run',
    );
  }
  if (
    summary.diversity_evaluable_user_count > summary.evaluated_user_count
  ) {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation metrics run',
    );
  }

  return {
    run_id: run.run_id,
    pipeline_stage: run.pipeline_stage,
    artifact_version: artifactVersion,
    evaluated_at: evaluatedAt,
    metrics,
    summary,
  };
};

export function createAdminRecommendationMetricsService({
  evaluationRunService = createRecommendationEvaluationRunService(),
} = {}) {
  if (!evaluationRunService || typeof evaluationRunService.listEvaluationRuns !== 'function') {
    throw new AdminRecommendationMetricsValidationError(
      'invalid evaluation run service',
    );
  }

  const getLatestRecommendationMetrics = async ({
    pipelineStage = ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE,
  } = {}) => {
    if (!isValidStage(pipelineStage)) {
      throw new AdminRecommendationMetricsValidationError(
        ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES.invalidQuery,
      );
    }

    let runs;
    try {
      runs = await evaluationRunService.listEvaluationRuns({
        limit: 1,
        pipeline_stage: pipelineStage,
      });
    } catch (error) {
      if (error instanceof AdminRecommendationMetricsError) throw error;
      throw new AdminRecommendationMetricsReadError(
        ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES.failed,
      );
    }

    if (!Array.isArray(runs) || runs.length === 0) {
      return {
        state: 'no-runs',
        source: ADMIN_RECOMMENDATION_METRICS_SOURCE,
        pipeline_stage: pipelineStage,
        latest: null,
      };
    }

    return {
      state: 'ready',
      source: ADMIN_RECOMMENDATION_METRICS_SOURCE,
      pipeline_stage: pipelineStage,
      latest: projectLatestRun(runs[0], pipelineStage),
    };
  };

  return { getLatestRecommendationMetrics };
}

export default createAdminRecommendationMetricsService;
