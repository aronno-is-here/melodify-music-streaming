import {
  ADMIN_RECOMMENDATION_METRIC_KEYS,
  ADMIN_RECOMMENDATION_METRICS_STATES,
  ADMIN_RECOMMENDATION_PIPELINE_STAGES,
  ADMIN_RECOMMENDATION_SUMMARY_KEYS,
} from '../../services/adminRecommendationMetrics.js';

export const ADMIN_AI_DASHBOARD_VIEWS = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  NO_RUNS: 'no-runs',
  ERROR: 'error',
});

export const ADMIN_AI_DASHBOARD_MESSAGES = Object.freeze({
  LOADING: 'Loading recommendation metrics.',
  NO_RUNS: 'No persisted evaluation run is available for this pipeline stage yet.',
  ERROR: 'Unable to load recommendation metrics.',
  RETRY: 'Retry',
  ARTIFACT_VERSION_MISSING: 'Not recorded',
  EVALUATED_AT_MISSING: 'Not available',
});

const STATE_TO_VIEW = Object.freeze({
  [ADMIN_RECOMMENDATION_METRICS_STATES.IDLE]: ADMIN_AI_DASHBOARD_VIEWS.LOADING,
  [ADMIN_RECOMMENDATION_METRICS_STATES.LOADING]: ADMIN_AI_DASHBOARD_VIEWS.LOADING,
  [ADMIN_RECOMMENDATION_METRICS_STATES.READY]: ADMIN_AI_DASHBOARD_VIEWS.READY,
  [ADMIN_RECOMMENDATION_METRICS_STATES.NO_RUNS]: ADMIN_AI_DASHBOARD_VIEWS.NO_RUNS,
  [ADMIN_RECOMMENDATION_METRICS_STATES.ERROR]: ADMIN_AI_DASHBOARD_VIEWS.ERROR,
});

const PIPELINE_STAGE_LABELS = Object.freeze({
  policy: 'Policy',
  hybrid: 'Hybrid',
  collaborative: 'Collaborative',
});

const METRIC_LABELS = Object.freeze({
  precision_at_5: 'Precision@5',
  precision_at_10: 'Precision@10',
  recall_at_5: 'Recall@5',
  recall_at_10: 'Recall@10',
  ndcg_at_5: 'NDCG@5',
  ndcg_at_10: 'NDCG@10',
  map_at_10: 'MAP@10',
  hit_rate_at_10: 'Hit Rate@10',
  catalog_coverage: 'Catalog Coverage',
  diversity: 'Diversity',
});

const SUMMARY_LABELS = Object.freeze({
  evaluated_user_count: 'Evaluated Users',
  recommendation_user_count: 'Recommendation Users',
  relevance_user_count: 'Relevance Users',
  catalog_size: 'Catalog Size',
  unique_recommended_at_10: 'Unique Recommended @10',
  diversity_evaluable_user_count: 'Diversity-Evaluable Users',
  diversity_pair_count: 'Diversity Pair Count',
});

const META_LABELS = Object.freeze({
  pipeline_stage: 'Pipeline Stage',
  run_id: 'Run ID',
  artifact_version: 'Artifact Version',
  evaluated_at: 'Evaluated At',
});

export function selectAdminRecommendationDashboardView(state) {
  if (!Object.hasOwn(STATE_TO_VIEW, state)) {
    throw new Error('invalid recommendation metrics state');
  }
  return STATE_TO_VIEW[state];
}

export function getPipelineStageLabel(stage) {
  if (!Object.hasOwn(PIPELINE_STAGE_LABELS, stage)) {
    return '';
  }
  return PIPELINE_STAGE_LABELS[stage];
}

export function getPipelineStageOptions() {
  return ADMIN_RECOMMENDATION_PIPELINE_STAGES.map((value) => ({
    value,
    label: PIPELINE_STAGE_LABELS[value],
  }));
}

export function getMetricDisplayLabel(key) {
  if (!Object.hasOwn(METRIC_LABELS, key)) return '';
  return METRIC_LABELS[key];
}

export function getSummaryDisplayLabel(key) {
  if (!Object.hasOwn(SUMMARY_LABELS, key)) return '';
  return SUMMARY_LABELS[key];
}

export function getMetaDisplayLabel(key) {
  if (!Object.hasOwn(META_LABELS, key)) return '';
  return META_LABELS[key];
}

export function formatRecommendationMetric(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  const clamped = Math.min(1, Math.max(0, value));
  return `${(clamped * 100).toFixed(2)}%`;
}

export function formatSummaryCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  return String(Math.trunc(value));
}

export function formatEvaluationDate(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return ADMIN_AI_DASHBOARD_MESSAGES.EVALUATED_AT_MISSING;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return ADMIN_AI_DASHBOARD_MESSAGES.EVALUATED_AT_MISSING;
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  } catch {
    return ADMIN_AI_DASHBOARD_MESSAGES.EVALUATED_AT_MISSING;
  }
}

export function formatArtifactVersion(value) {
  if (value === null || value === undefined || value === '') {
    return ADMIN_AI_DASHBOARD_MESSAGES.ARTIFACT_VERSION_MISSING;
  }
  if (typeof value !== 'string') {
    return ADMIN_AI_DASHBOARD_MESSAGES.ARTIFACT_VERSION_MISSING;
  }
  return value;
}

export function buildMetricCards(metrics) {
  if (metrics === null || metrics === undefined || typeof metrics !== 'object') {
    return [];
  }
  return ADMIN_RECOMMENDATION_METRIC_KEYS.map((key) => ({
    key,
    label: METRIC_LABELS[key],
    value: metrics[key],
    formatted: formatRecommendationMetric(metrics[key]),
  }));
}

export function buildSummaryCards(summary) {
  if (summary === null || summary === undefined || typeof summary !== 'object') {
    return [];
  }
  return ADMIN_RECOMMENDATION_SUMMARY_KEYS.map((key) => ({
    key,
    label: SUMMARY_LABELS[key],
    value: summary[key],
    formatted: formatSummaryCount(summary[key]),
  }));
}

export function buildRunMetaCards(latest) {
  if (latest === null || latest === undefined || typeof latest !== 'object') {
    return [];
  }
  return [
    {
      key: 'pipeline_stage',
      label: META_LABELS.pipeline_stage,
      value: getPipelineStageLabel(latest.pipeline_stage) || latest.pipeline_stage,
    },
    {
      key: 'run_id',
      label: META_LABELS.run_id,
      value: typeof latest.run_id === 'string' ? latest.run_id : '',
    },
    {
      key: 'artifact_version',
      label: META_LABELS.artifact_version,
      value: formatArtifactVersion(latest.artifact_version),
    },
    {
      key: 'evaluated_at',
      label: META_LABELS.evaluated_at,
      value: formatEvaluationDate(latest.evaluated_at),
    },
  ];
}
