import {
  ADMIN_RECOMMENDATION_PIPELINE_STAGES,
  DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
} from './adminRecommendationMetrics.js';

export const ADMIN_RECOMMENDATION_HISTORY_PATH =
  '/api/admin/recommendations/history';
export const ADMIN_RECOMMENDATION_HISTORY_SOURCE = 'evaluation-history';
export const DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT = 20;
export const MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT = 100;

export {
  ADMIN_RECOMMENDATION_PIPELINE_STAGES,
  DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
};

export const ADMIN_RECOMMENDATION_HISTORY_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  NO_RUNS: 'no-runs',
  ERROR: 'error',
});

export const ADMIN_RECOMMENDATION_HISTORY_ERROR_CODES = Object.freeze({
  REQUEST_FAILED: 'ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED',
  PAYLOAD_INVALID: 'ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID',
});

export const ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED_MESSAGE =
  'Failed to load evaluation history.';
export const ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID_MESSAGE =
  'Evaluation history response was invalid.';

export const ADMIN_RECOMMENDATION_HISTORY_METRIC_KEYS = Object.freeze([
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

export const ADMIN_RECOMMENDATION_HISTORY_SUMMARY_KEYS = Object.freeze([
  'evaluated_user_count',
  'recommendation_user_count',
  'relevance_user_count',
  'catalog_size',
  'unique_recommended_at_10',
  'diversity_evaluable_user_count',
  'diversity_pair_count',
]);

export const ADMIN_RECOMMENDATION_HISTORY_DATASET_KEYS = Object.freeze([
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

export const ADMIN_RECOMMENDATION_HISTORY_CONFIGURATION_KEYS = Object.freeze([
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

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isValidMetricValue = (value) =>
  typeof value === 'number'
  && Number.isFinite(value)
  && value >= 0
  && value <= 1;

const isValidCount = (value) =>
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= 0
  && Number.isSafeInteger(value);

const isValidStage = (stage) =>
  typeof stage === 'string'
  && ADMIN_RECOMMENDATION_PIPELINE_STAGES.includes(stage);

const isValidLimit = (limit) =>
  typeof limit === 'number'
  && Number.isInteger(limit)
  && limit >= 1
  && limit <= MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT;

export function isValidAdminRecommendationHistoryStage(stage) {
  return isValidStage(stage);
}

export function isValidAdminRecommendationHistoryLimit(limit) {
  return isValidLimit(limit);
}

const requestFailedResult = () => ({
  state: ADMIN_RECOMMENDATION_HISTORY_STATES.ERROR,
  runs: [],
  pipelineStage: null,
  limit: null,
  count: 0,
  error: {
    code: ADMIN_RECOMMENDATION_HISTORY_ERROR_CODES.REQUEST_FAILED,
    message: ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED_MESSAGE,
  },
});

const payloadInvalidResult = () => ({
  state: ADMIN_RECOMMENDATION_HISTORY_STATES.ERROR,
  runs: [],
  pipelineStage: null,
  limit: null,
  count: 0,
  error: {
    code: ADMIN_RECOMMENDATION_HISTORY_ERROR_CODES.PAYLOAD_INVALID,
    message: ADMIN_RECOMMENDATION_HISTORY_PAYLOAD_INVALID_MESSAGE,
  },
});

const noRunsResult = (pipelineStage, limit) => ({
  state: ADMIN_RECOMMENDATION_HISTORY_STATES.NO_RUNS,
  runs: [],
  pipelineStage,
  limit,
  count: 0,
  error: null,
});

const readyResult = (pipelineStage, limit, runs) => ({
  state: ADMIN_RECOMMENDATION_HISTORY_STATES.READY,
  runs,
  pipelineStage,
  limit,
  count: runs.length,
  error: null,
});

function normalizeMetrics(metrics) {
  if (!isPlainObject(metrics)) return null;
  const normalized = {};
  for (const key of ADMIN_RECOMMENDATION_HISTORY_METRIC_KEYS) {
    const value = metrics[key];
    if (!isValidMetricValue(value)) return null;
    normalized[key] = value;
  }
  return normalized;
}

function normalizeSummary(summary) {
  if (!isPlainObject(summary)) return null;
  const normalized = {};
  for (const key of ADMIN_RECOMMENDATION_HISTORY_SUMMARY_KEYS) {
    const value = summary[key];
    if (!isValidCount(value)) return null;
    normalized[key] = value;
  }
  if (normalized.evaluated_user_count > normalized.relevance_user_count) {
    return null;
  }
  if (normalized.unique_recommended_at_10 > normalized.catalog_size) {
    return null;
  }
  if (
    normalized.diversity_evaluable_user_count > normalized.evaluated_user_count
  ) {
    return null;
  }
  return normalized;
}

function normalizeDataset(dataset) {
  if (!isPlainObject(dataset)) return null;
  const normalized = {};
  for (const key of ADMIN_RECOMMENDATION_HISTORY_DATASET_KEYS) {
    const value = dataset[key];
    if (!isValidCount(value)) return null;
    normalized[key] = value;
  }
  const partitionSum =
    normalized.train_event_count
    + normalized.validation_event_count
    + normalized.test_event_count;
  if (normalized.raw_event_count !== partitionSum) return null;
  return normalized;
}

function normalizeConfiguration(configuration) {
  if (!isPlainObject(configuration)) return null;
  if (!Object.hasOwn(configuration, 'random_seed')) return null;
  const seed = configuration.random_seed;
  if (
    typeof seed !== 'number'
    || !Number.isInteger(seed)
    || seed < 0
    || seed > 4294967295
  ) {
    return null;
  }

  const normalized = {
    random_seed: seed,
    algorithm: null,
    requested_components: null,
    effective_components: null,
    collaborative_weight: null,
    content_weight: null,
    base_hybrid_policy_weight: null,
    explicit_profile_policy_weight: null,
    exploration_interval: null,
  };

  if (Object.hasOwn(configuration, 'algorithm')) {
    const algorithm = configuration.algorithm;
    if (algorithm !== null && (
      typeof algorithm !== 'string'
      || !IDENTIFIER_PATTERN.test(algorithm)
    )) {
      return null;
    }
    normalized.algorithm = algorithm;
  }

  const readComponent = (value) => {
    if (value === null) return null;
    if (
      typeof value !== 'number'
      || !Number.isInteger(value)
      || value < 1
      || value > 32
    ) {
      return null;
    }
    return value;
  };

  if (Object.hasOwn(configuration, 'requested_components')) {
    const requested = readComponent(configuration.requested_components);
    if (requested === null && configuration.requested_components !== null) {
      return null;
    }
    normalized.requested_components = requested;
  }
  if (Object.hasOwn(configuration, 'effective_components')) {
    const effective = readComponent(configuration.effective_components);
    if (effective === null && configuration.effective_components !== null) {
      return null;
    }
    normalized.effective_components = effective;
  }
  if (
    normalized.requested_components !== null
    && normalized.effective_components !== null
    && normalized.effective_components > normalized.requested_components
  ) {
    return null;
  }

  const hasCollaborative = Object.hasOwn(configuration, 'collaborative_weight');
  const hasContent = Object.hasOwn(configuration, 'content_weight');
  if (hasCollaborative !== hasContent) return null;
  if (hasCollaborative) {
    const collaborative = configuration.collaborative_weight;
    const content = configuration.content_weight;
    const isUnit = (value) =>
      typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= 1;
    if (!isUnit(collaborative) || !isUnit(content)) return null;
    if (Math.abs(collaborative + content - 1) > 1e-9) return null;
    normalized.collaborative_weight = collaborative;
    normalized.content_weight = content;
  }

  const hasBase = Object.hasOwn(configuration, 'base_hybrid_policy_weight');
  const hasProfile = Object.hasOwn(
    configuration,
    'explicit_profile_policy_weight',
  );
  if (hasBase !== hasProfile) return null;
  if (hasBase) {
    const base = configuration.base_hybrid_policy_weight;
    const profile = configuration.explicit_profile_policy_weight;
    const isUnit = (value) =>
      typeof value === 'number'
      && Number.isFinite(value)
      && value >= 0
      && value <= 1;
    if (!isUnit(base) || !isUnit(profile)) return null;
    if (Math.abs(base + profile - 1) > 1e-9) return null;
    normalized.base_hybrid_policy_weight = base;
    normalized.explicit_profile_policy_weight = profile;
  }

  if (Object.hasOwn(configuration, 'exploration_interval')) {
    const interval = configuration.exploration_interval;
    if (interval !== null && (
      typeof interval !== 'number'
      || !Number.isInteger(interval)
      || interval < 1
      || interval > 100
    )) {
      return null;
    }
    normalized.exploration_interval = interval;
  }

  for (const key of ADMIN_RECOMMENDATION_HISTORY_CONFIGURATION_KEYS) {
    if (!Object.hasOwn(normalized, key)) return null;
  }

  return normalized;
}

function normalizeRun(run, pipelineStage) {
  if (!isPlainObject(run)) return null;
  if (
    typeof run.run_id !== 'string'
    || !IDENTIFIER_PATTERN.test(run.run_id)
  ) {
    return null;
  }
  if (run.pipeline_stage !== pipelineStage) return null;

  if (typeof run.evaluated_at !== 'string' || run.evaluated_at.length === 0) {
    return null;
  }
  const evaluatedAtDate = new Date(run.evaluated_at);
  if (Number.isNaN(evaluatedAtDate.getTime())) return null;

  let artifactVersion = null;
  if (run.artifact_version !== undefined && run.artifact_version !== null) {
    if (
      typeof run.artifact_version !== 'string'
      || !IDENTIFIER_PATTERN.test(run.artifact_version)
    ) {
      return null;
    }
    artifactVersion = run.artifact_version;
  }

  const metrics = normalizeMetrics(run.metrics);
  if (!metrics) return null;
  const summary = normalizeSummary(run.summary);
  if (!summary) return null;
  const dataset = normalizeDataset(run.dataset);
  if (!dataset) return null;
  const configuration = normalizeConfiguration(run.configuration);
  if (!configuration) return null;

  return {
    run_id: run.run_id,
    pipeline_stage: run.pipeline_stage,
    artifact_version: artifactVersion,
    evaluated_at: run.evaluated_at,
    metrics,
    summary,
    dataset,
    configuration,
  };
}

export function buildAdminRecommendationHistoryPath(pipelineStage, limit) {
  if (!isValidStage(pipelineStage)) {
    throw new Error('invalid pipeline stage');
  }
  if (!isValidLimit(limit)) {
    throw new Error('invalid history limit');
  }
  return `${ADMIN_RECOMMENDATION_HISTORY_PATH}?pipeline_stage=${pipelineStage}&limit=${limit}`;
}

export function normalizeAdminRecommendationHistoryResponse(
  raw,
  { pipelineStage, limit } = {},
) {
  if (!isValidStage(pipelineStage) || !isValidLimit(limit)) {
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
  if (data.source !== ADMIN_RECOMMENDATION_HISTORY_SOURCE) {
    return payloadInvalidResult();
  }
  if (data.pipeline_stage !== pipelineStage) {
    return payloadInvalidResult();
  }
  if (data.limit !== limit) {
    return payloadInvalidResult();
  }
  if (typeof data.count !== 'number' || !Number.isInteger(data.count)) {
    return payloadInvalidResult();
  }
  if (!Array.isArray(data.runs)) {
    return payloadInvalidResult();
  }
  if (data.count !== data.runs.length) {
    return payloadInvalidResult();
  }
  if (data.count < 0 || data.count > limit) {
    return payloadInvalidResult();
  }

  if (data.state === ADMIN_RECOMMENDATION_HISTORY_STATES.NO_RUNS) {
    if (data.count !== 0 || data.runs.length !== 0) {
      return payloadInvalidResult();
    }
    return noRunsResult(pipelineStage, limit);
  }

  if (data.state === ADMIN_RECOMMENDATION_HISTORY_STATES.READY) {
    if (data.count < 1) {
      return payloadInvalidResult();
    }
    const runs = [];
    for (const run of data.runs) {
      const normalized = normalizeRun(run, pipelineStage);
      if (!normalized) return payloadInvalidResult();
      runs.push(normalized);
    }
    return readyResult(pipelineStage, limit, runs);
  }

  return payloadInvalidResult();
}

export async function fetchAdminRecommendationHistory(options = {}) {
  const pipelineStage =
    options.pipelineStage === undefined
      ? DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE
      : options.pipelineStage;
  const limit =
    options.limit === undefined
      ? DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT
      : options.limit;
  const apiClient = options.apiClient;
  const signal = options.signal;

  if (
    !isValidStage(pipelineStage)
    || !isValidLimit(limit)
    || !apiClient
    || typeof apiClient.get !== 'function'
  ) {
    return requestFailedResult();
  }

  let raw;
  try {
    const path = buildAdminRecommendationHistoryPath(pipelineStage, limit);
    if (signal === undefined) {
      raw = await apiClient.get(path);
    } else {
      raw = await apiClient.get(path, { signal });
    }
  } catch {
    return requestFailedResult();
  }

  return normalizeAdminRecommendationHistoryResponse(raw, {
    pipelineStage,
    limit,
  });
}

export default fetchAdminRecommendationHistory;
