export const ADMIN_RECOMMENDATION_METRICS_PATH = '/api/admin/recommendations/metrics';
export const ADMIN_RECOMMENDATION_METRICS_SOURCE = 'evaluation-history';
export const DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE = 'policy';

export const ADMIN_RECOMMENDATION_PIPELINE_STAGES = Object.freeze([
  'policy',
  'hybrid',
  'collaborative',
]);

export const ADMIN_RECOMMENDATION_METRICS_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  NO_RUNS: 'no-runs',
  ERROR: 'error',
});

export const ADMIN_RECOMMENDATION_METRICS_ERROR_CODES = Object.freeze({
  REQUEST_FAILED: 'ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED',
  PAYLOAD_INVALID: 'ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID',
});

export const ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED_MESSAGE =
  'Failed to load recommendation metrics.';
export const ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID_MESSAGE =
  'Recommendation metrics response was invalid.';

export const ADMIN_RECOMMENDATION_METRIC_KEYS = Object.freeze([
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

export const ADMIN_RECOMMENDATION_SUMMARY_KEYS = Object.freeze([
  'evaluated_user_count',
  'recommendation_user_count',
  'relevance_user_count',
  'catalog_size',
  'unique_recommended_at_10',
  'diversity_evaluable_user_count',
  'diversity_pair_count',
]);

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isValidMetricValue = (value) =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= 1;

const isValidSummaryCount = (value) =>
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= 0
  && Number.isSafeInteger(value);

const requestFailedResult = () => ({
  state: ADMIN_RECOMMENDATION_METRICS_STATES.ERROR,
  latest: null,
  pipelineStage: null,
  error: {
    code: ADMIN_RECOMMENDATION_METRICS_ERROR_CODES.REQUEST_FAILED,
    message: ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED_MESSAGE,
  },
});

const payloadInvalidResult = () => ({
  state: ADMIN_RECOMMENDATION_METRICS_STATES.ERROR,
  latest: null,
  pipelineStage: null,
  error: {
    code: ADMIN_RECOMMENDATION_METRICS_ERROR_CODES.PAYLOAD_INVALID,
    message: ADMIN_RECOMMENDATION_METRICS_PAYLOAD_INVALID_MESSAGE,
  },
});

const noRunsResult = (pipelineStage) => ({
  state: ADMIN_RECOMMENDATION_METRICS_STATES.NO_RUNS,
  latest: null,
  pipelineStage,
  error: null,
});

const readyResult = (pipelineStage, latest) => ({
  state: ADMIN_RECOMMENDATION_METRICS_STATES.READY,
  latest,
  pipelineStage,
  error: null,
});

export function isValidAdminRecommendationPipelineStage(stage) {
  return (
    typeof stage === 'string'
    && ADMIN_RECOMMENDATION_PIPELINE_STAGES.includes(stage)
  );
}

export function buildAdminRecommendationMetricsPath(pipelineStage) {
  if (!isValidAdminRecommendationPipelineStage(pipelineStage)) {
    throw new Error('invalid pipeline stage');
  }
  return `${ADMIN_RECOMMENDATION_METRICS_PATH}?pipeline_stage=${pipelineStage}`;
}

function normalizeLatest(latest, pipelineStage) {
  if (!isPlainObject(latest)) return null;
  if (latest.pipeline_stage !== pipelineStage) return null;
  if (typeof latest.run_id !== 'string' || !IDENTIFIER_PATTERN.test(latest.run_id)) {
    return null;
  }

  let artifactVersion = null;
  if (latest.artifact_version !== undefined && latest.artifact_version !== null) {
    if (
      typeof latest.artifact_version !== 'string'
      || !IDENTIFIER_PATTERN.test(latest.artifact_version)
    ) {
      return null;
    }
    artifactVersion = latest.artifact_version;
  }

  if (typeof latest.evaluated_at !== 'string' || latest.evaluated_at.length === 0) {
    return null;
  }
  const evaluatedAtDate = new Date(latest.evaluated_at);
  if (Number.isNaN(evaluatedAtDate.getTime())) return null;

  if (!isPlainObject(latest.metrics)) return null;
  const metrics = {};
  for (const key of ADMIN_RECOMMENDATION_METRIC_KEYS) {
    const value = latest.metrics[key];
    if (!isValidMetricValue(value)) return null;
    metrics[key] = value;
  }

  if (!isPlainObject(latest.summary)) return null;
  const summary = {};
  for (const key of ADMIN_RECOMMENDATION_SUMMARY_KEYS) {
    const value = latest.summary[key];
    if (!isValidSummaryCount(value)) return null;
    summary[key] = value;
  }

  if (summary.evaluated_user_count > summary.relevance_user_count) return null;
  if (summary.unique_recommended_at_10 > summary.catalog_size) return null;
  if (summary.diversity_evaluable_user_count > summary.evaluated_user_count) {
    return null;
  }

  return {
    run_id: latest.run_id,
    pipeline_stage: latest.pipeline_stage,
    artifact_version: artifactVersion,
    evaluated_at: latest.evaluated_at,
    metrics,
    summary,
  };
}

export function normalizeAdminRecommendationMetricsResponse(
  raw,
  { pipelineStage } = {},
) {
  if (!isValidAdminRecommendationPipelineStage(pipelineStage)) {
    return requestFailedResult();
  }

  if (!isPlainObject(raw)) {
    return payloadInvalidResult();
  }

  if (raw.success === false) {
    return requestFailedResult();
  }

  if (raw.success !== true) {
    return payloadInvalidResult();
  }

  const data = raw.data;
  if (!isPlainObject(data)) {
    return payloadInvalidResult();
  }
  if (data.source !== ADMIN_RECOMMENDATION_METRICS_SOURCE) {
    return payloadInvalidResult();
  }
  if (data.pipeline_stage !== pipelineStage) {
    return payloadInvalidResult();
  }

  if (data.state === ADMIN_RECOMMENDATION_METRICS_STATES.NO_RUNS) {
    if (data.latest !== null) return payloadInvalidResult();
    return noRunsResult(pipelineStage);
  }

  if (data.state === ADMIN_RECOMMENDATION_METRICS_STATES.READY) {
    const latest = normalizeLatest(data.latest, pipelineStage);
    if (!latest) return payloadInvalidResult();
    return readyResult(pipelineStage, latest);
  }

  return payloadInvalidResult();
}

export async function fetchAdminRecommendationMetrics(options = {}) {
  const pipelineStage =
    options.pipelineStage === undefined
      ? DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE
      : options.pipelineStage;
  const apiClient = options.apiClient;
  const signal = options.signal;

  if (
    !isValidAdminRecommendationPipelineStage(pipelineStage)
    || !apiClient
    || typeof apiClient.get !== 'function'
  ) {
    return requestFailedResult();
  }

  let raw;
  try {
    if (signal === undefined) {
      raw = await apiClient.get(buildAdminRecommendationMetricsPath(pipelineStage));
    } else {
      raw = await apiClient.get(buildAdminRecommendationMetricsPath(pipelineStage), { signal });
    }
  } catch {
    return requestFailedResult();
  }

  return normalizeAdminRecommendationMetricsResponse(raw, { pipelineStage });
}

export default fetchAdminRecommendationMetrics;
