import {
  ADMIN_RECOMMENDATION_HISTORY_CONFIGURATION_KEYS,
  ADMIN_RECOMMENDATION_HISTORY_DATASET_KEYS,
  ADMIN_RECOMMENDATION_HISTORY_STATES,
} from '../../services/adminRecommendationHistory.js';

export const ADMIN_AI_HISTORY_VIEWS = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  NO_RUNS: 'no-runs',
  ERROR: 'error',
});

export const ADMIN_AI_HISTORY_MESSAGES = Object.freeze({
  LOADING: 'Loading evaluation history.',
  NO_RUNS:
    'No persisted evaluation history is available for this pipeline stage yet.',
  ERROR: 'Unable to load evaluation history.',
  RETRY: 'Retry',
  ARTIFACT_VERSION_MISSING: 'Not recorded',
  EVALUATED_AT_MISSING: 'Not available',
  CONFIG_MISSING: 'Not recorded',
});

const STATE_TO_VIEW = Object.freeze({
  [ADMIN_RECOMMENDATION_HISTORY_STATES.IDLE]:
    ADMIN_AI_HISTORY_VIEWS.LOADING,
  [ADMIN_RECOMMENDATION_HISTORY_STATES.LOADING]:
    ADMIN_AI_HISTORY_VIEWS.LOADING,
  [ADMIN_RECOMMENDATION_HISTORY_STATES.READY]: ADMIN_AI_HISTORY_VIEWS.READY,
  [ADMIN_RECOMMENDATION_HISTORY_STATES.NO_RUNS]:
    ADMIN_AI_HISTORY_VIEWS.NO_RUNS,
  [ADMIN_RECOMMENDATION_HISTORY_STATES.ERROR]: ADMIN_AI_HISTORY_VIEWS.ERROR,
});

const DATASET_LABELS = Object.freeze({
  raw_event_count: 'Raw Events',
  train_event_count: 'Train Events',
  validation_event_count: 'Validation Events',
  test_event_count: 'Test Events',
  unique_user_count: 'Unique Users',
  unique_song_count: 'Unique Songs',
  session_count: 'Sessions',
  interaction_pair_count: 'Interaction Pairs',
  content_feature_count: 'Content Features',
});

const CONFIGURATION_LABELS = Object.freeze({
  random_seed: 'Random Seed',
  algorithm: 'Algorithm',
  requested_components: 'Requested Components',
  effective_components: 'Effective Components',
  collaborative_weight: 'Collaborative Weight',
  content_weight: 'Content Weight',
  base_hybrid_policy_weight: 'Base Hybrid Policy Weight',
  explicit_profile_policy_weight: 'Explicit Profile Policy Weight',
  exploration_interval: 'Exploration Interval',
});

export function selectAdminRecommendationHistoryView(state) {
  if (!Object.hasOwn(STATE_TO_VIEW, state)) {
    throw new Error('invalid recommendation history state');
  }
  return STATE_TO_VIEW[state];
}

export function formatHistoryCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '';
  }
  return String(Math.trunc(value));
}

export function formatOptionalConfigurationValue(value) {
  if (value === null || value === undefined) {
    return ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING;
    }
    return String(value);
  }
  if (typeof value === 'string') {
    if (value.length === 0) {
      return ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING;
    }
    return value;
  }
  return ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING;
}

export function formatConfigurationWeight(value) {
  if (value === null || value === undefined) {
    return ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ADMIN_AI_HISTORY_MESSAGES.CONFIG_MISSING;
  }
  const clamped = Math.min(1, Math.max(0, value));
  return clamped.toFixed(2);
}

export function formatArtifactVersion(value) {
  if (value === null || value === undefined || value === '') {
    return ADMIN_AI_HISTORY_MESSAGES.ARTIFACT_VERSION_MISSING;
  }
  if (typeof value !== 'string') {
    return ADMIN_AI_HISTORY_MESSAGES.ARTIFACT_VERSION_MISSING;
  }
  return value;
}

export function formatEvaluationDate(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return ADMIN_AI_HISTORY_MESSAGES.EVALUATED_AT_MISSING;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return ADMIN_AI_HISTORY_MESSAGES.EVALUATED_AT_MISSING;
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  } catch {
    return ADMIN_AI_HISTORY_MESSAGES.EVALUATED_AT_MISSING;
  }
}

export function buildDatasetCards(run) {
  if (run === null || run === undefined || typeof run !== 'object') {
    return [];
  }
  const dataset = run.dataset;
  if (dataset === null || dataset === undefined || typeof dataset !== 'object') {
    return [];
  }
  return ADMIN_RECOMMENDATION_HISTORY_DATASET_KEYS.map((key) => ({
    key,
    label: DATASET_LABELS[key],
    value: dataset[key],
    formatted: formatHistoryCount(dataset[key]),
  }));
}

export function buildConfigurationCards(run) {
  if (run === null || run === undefined || typeof run !== 'object') {
    return [];
  }
  const configuration = run.configuration;
  if (
    configuration === null
    || configuration === undefined
    || typeof configuration !== 'object'
  ) {
    return [];
  }
  const weightKeys = new Set([
    'collaborative_weight',
    'content_weight',
    'base_hybrid_policy_weight',
    'explicit_profile_policy_weight',
  ]);
  return ADMIN_RECOMMENDATION_HISTORY_CONFIGURATION_KEYS.map((key) => {
    const raw = configuration[key];
    return {
      key,
      label: CONFIGURATION_LABELS[key],
      value: raw,
      formatted: weightKeys.has(key)
        ? formatConfigurationWeight(raw)
        : formatOptionalConfigurationValue(raw),
    };
  });
}

export function selectHistoryRun(runs, selectedRunId) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return null;
  }
  if (
    typeof selectedRunId === 'string'
    && selectedRunId.length > 0
  ) {
    const match = runs.find(
      (run) =>
        run !== null
        && typeof run === 'object'
        && run.run_id === selectedRunId,
    );
    if (match) return match;
  }
  const first = runs[0];
  if (first !== null && typeof first === 'object') {
    return first;
  }
  return null;
}
