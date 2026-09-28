import { ADMIN_RECOMMENDATION_PREFLIGHT_STATES } from '../../services/adminRecommendationPreflight.js';

export const ADMIN_AI_PREFLIGHT_VIEWS = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});

export const ADMIN_AI_PREFLIGHT_MESSAGES = Object.freeze({
  LOADING: 'Loading training readiness.',
  ERROR: 'Unable to load training readiness.',
  RETRY: 'Refresh Status',
  READY: 'Training data meets the minimum readiness thresholds.',
  NOT_RECORDED: 'Not recorded',
  ENABLED: 'Enabled',
  DISABLED: 'Disabled',
});

export const ADMIN_AI_PREFLIGHT_REASON_MESSAGES = Object.freeze({
  NO_LISTENING_EVENTS: 'No listening events are recorded yet.',
  INSUFFICIENT_SONGS: 'The music catalog has fewer than two songs.',
  INSUFFICIENT_TRAINING_DATA:
    'Recorded listening events do not resolve to catalog songs.',
  INSUFFICIENT_USERS: 'Fewer than two distinct listeners are recorded.',
  INSUFFICIENT_INTERACTIONS:
    'Fewer than two user and song interaction pairs are recorded.',
});

const STATE_TO_VIEW = Object.freeze({
  [ADMIN_RECOMMENDATION_PREFLIGHT_STATES.IDLE]: ADMIN_AI_PREFLIGHT_VIEWS.LOADING,
  [ADMIN_RECOMMENDATION_PREFLIGHT_STATES.LOADING]:
    ADMIN_AI_PREFLIGHT_VIEWS.LOADING,
  [ADMIN_RECOMMENDATION_PREFLIGHT_STATES.READY]: ADMIN_AI_PREFLIGHT_VIEWS.READY,
  [ADMIN_RECOMMENDATION_PREFLIGHT_STATES.ERROR]: ADMIN_AI_PREFLIGHT_VIEWS.ERROR,
});

export function selectAdminRecommendationPreflightView(state) {
  if (!Object.hasOwn(STATE_TO_VIEW, state)) {
    throw new Error('invalid training readiness state');
  }
  return STATE_TO_VIEW[state];
}

export function formatPreflightCount(value) {
  if (value === null || value === undefined) {
    return ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED;
  }
  return String(Math.trunc(value));
}

export function formatPreflightFlag(value) {
  return value === true
    ? ADMIN_AI_PREFLIGHT_MESSAGES.ENABLED
    : ADMIN_AI_PREFLIGHT_MESSAGES.DISABLED;
}

export function getPreflightSufficiencyMessage(data) {
  if (!data || typeof data !== 'object') {
    return ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED;
  }
  const sufficiency = data.sufficiency;
  if (!sufficiency || typeof sufficiency !== 'object') {
    return ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED;
  }
  if (sufficiency.state === 'ready') {
    return ADMIN_AI_PREFLIGHT_MESSAGES.READY;
  }
  if (
    typeof sufficiency.reason === 'string'
    && Object.hasOwn(ADMIN_AI_PREFLIGHT_REASON_MESSAGES, sufficiency.reason)
  ) {
    return ADMIN_AI_PREFLIGHT_REASON_MESSAGES[sufficiency.reason];
  }
  return ADMIN_AI_PREFLIGHT_MESSAGES.NOT_RECORDED;
}

export function buildPreflightCards(data) {
  if (!data || typeof data !== 'object') return [];
  const flags = data.feature_flags;
  const catalog = data.catalog;
  const telemetry = data.telemetry;
  const persisted = data.persisted;
  if (!flags || !catalog || !telemetry || !persisted) return [];

  return [
    {
      key: 'ai_mode',
      label: 'AI Recommendation',
      formatted: formatPreflightFlag(flags.recommendation_ai_enabled),
    },
    {
      key: 'listening_events_capture',
      label: 'Listening Events Capture',
      formatted: formatPreflightFlag(flags.listening_events_enabled),
    },
    {
      key: 'catalog_songs',
      label: 'Catalog Songs',
      formatted: formatPreflightCount(catalog.songs),
    },
    {
      key: 'listening_events',
      label: 'Listening Events',
      formatted: formatPreflightCount(telemetry.listening_events),
    },
    {
      key: 'usable_events',
      label: 'Usable Events',
      formatted: formatPreflightCount(telemetry.usable_events),
    },
    {
      key: 'distinct_users',
      label: 'Distinct Listeners',
      formatted: formatPreflightCount(telemetry.distinct_users),
    },
    {
      key: 'distinct_songs',
      label: 'Distinct Songs Played',
      formatted: formatPreflightCount(telemetry.distinct_songs),
    },
    {
      key: 'evaluation_runs',
      label: 'Evaluation Runs',
      formatted: formatPreflightCount(persisted.evaluation_runs),
    },
    {
      key: 'snapshots',
      label: 'Recommendation Snapshots',
      formatted: formatPreflightCount(persisted.snapshots),
    },
  ];
}
