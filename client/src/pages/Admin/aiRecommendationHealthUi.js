import { ADMIN_RECOMMENDATION_HEALTH_STATES } from '../../services/adminRecommendationHealth.js';

export const ADMIN_AI_HEALTH_VIEWS = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});

export const ADMIN_AI_HEALTH_MESSAGES = Object.freeze({
  LOADING: 'Loading retraining health.',
  ERROR: 'Unable to load retraining health.',
  RETRY: 'Refresh Status',
  NEVER_RUN: 'No retraining run has completed yet.',
  RUNNING: 'A retraining run is in progress.',
  COMPLETED: 'The latest retraining run completed.',
  FAILED: 'The latest retraining run failed.',
  NOT_AVAILABLE: 'Not available',
  NOT_RECORDED: 'Not recorded',
});

const STATE_TO_VIEW = Object.freeze({
  [ADMIN_RECOMMENDATION_HEALTH_STATES.IDLE]: ADMIN_AI_HEALTH_VIEWS.LOADING,
  [ADMIN_RECOMMENDATION_HEALTH_STATES.LOADING]: ADMIN_AI_HEALTH_VIEWS.LOADING,
  [ADMIN_RECOMMENDATION_HEALTH_STATES.READY]: ADMIN_AI_HEALTH_VIEWS.READY,
  [ADMIN_RECOMMENDATION_HEALTH_STATES.ERROR]: ADMIN_AI_HEALTH_VIEWS.ERROR,
});

const BACKEND_STATE_MESSAGES = Object.freeze({
  'never-run': ADMIN_AI_HEALTH_MESSAGES.NEVER_RUN,
  running: ADMIN_AI_HEALTH_MESSAGES.RUNNING,
  completed: ADMIN_AI_HEALTH_MESSAGES.COMPLETED,
  failed: ADMIN_AI_HEALTH_MESSAGES.FAILED,
});

export function selectAdminRecommendationHealthView(state) {
  if (!Object.hasOwn(STATE_TO_VIEW, state)) {
    throw new Error('invalid retraining health state');
  }
  return STATE_TO_VIEW[state];
}

export function getBackendStateMessage(backendState) {
  if (!Object.hasOwn(BACKEND_STATE_MESSAGES, backendState)) {
    return ADMIN_AI_HEALTH_MESSAGES.NOT_AVAILABLE;
  }
  return BACKEND_STATE_MESSAGES[backendState];
}

export function formatHealthDate(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return ADMIN_AI_HEALTH_MESSAGES.NOT_AVAILABLE;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return ADMIN_AI_HEALTH_MESSAGES.NOT_AVAILABLE;
  }
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  } catch {
    return ADMIN_AI_HEALTH_MESSAGES.NOT_AVAILABLE;
  }
}

export function formatHealthCount(value) {
  if (value === null || value === undefined) {
    return ADMIN_AI_HEALTH_MESSAGES.NOT_RECORDED;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return ADMIN_AI_HEALTH_MESSAGES.NOT_RECORDED;
  }
  return String(Math.trunc(value));
}

export function formatHealthText(value) {
  if (value === null || value === undefined || value === '') {
    return ADMIN_AI_HEALTH_MESSAGES.NOT_RECORDED;
  }
  if (typeof value !== 'string') {
    return ADMIN_AI_HEALTH_MESSAGES.NOT_RECORDED;
  }
  return value;
}

export function buildHealthStatusCards(backendState, lease, latest) {
  if (typeof backendState !== 'string') return [];
  const cards = [
    {
      key: 'status',
      label: 'Status',
      formatted: getBackendStateMessage(backendState),
    },
  ];

  if (lease && lease.active === true) {
    cards.push({
      key: 'lease_run_id',
      label: 'Active Run ID',
      formatted: formatHealthText(lease.run_id),
    });
    cards.push({
      key: 'lease_expires',
      label: 'Lease Expires',
      formatted: formatHealthDate(lease.expires_at),
    });
  }

  if (latest) {
    cards.push({
      key: 'run_id',
      label: 'Run ID',
      formatted: formatHealthText(latest.run_id),
    });
    cards.push({
      key: 'finished_at',
      label: 'Finished At',
      formatted: formatHealthDate(latest.finished_at),
    });
    cards.push({
      key: 'duration',
      label: 'Duration (ms)',
      formatted: formatHealthCount(latest.duration_ms),
    });
    cards.push({
      key: 'evaluation_created',
      label: 'Evaluation Recorded',
      formatted: latest.evaluation_created ? 'Yes' : 'No',
    });
    cards.push({
      key: 'snapshots_persisted',
      label: 'Snapshots Persisted',
      formatted: formatHealthCount(latest.snapshot_persisted_count),
    });
    cards.push({
      key: 'snapshots_reused',
      label: 'Snapshots Reused',
      formatted: formatHealthCount(latest.snapshot_reused_count),
    });
    if (latest.failure_code) {
      cards.push({
        key: 'failure_code',
        label: 'Failure Code',
        formatted: latest.failure_code,
      });
    }
  }

  return cards;
}
