export const ADMIN_RECOMMENDATION_HEALTH_PATH =
  '/api/admin/recommendations/health';
export const ADMIN_RECOMMENDATION_HEALTH_SOURCE = 'retraining-health';

export const ADMIN_RECOMMENDATION_HEALTH_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});

export const ADMIN_RECOMMENDATION_HEALTH_BACKEND_STATES = Object.freeze([
  'running',
  'never-run',
  'completed',
  'failed',
]);

export const ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES = Object.freeze({
  REQUEST_FAILED: 'ADMIN_RECOMMENDATION_HEALTH_REQUEST_FAILED',
  PAYLOAD_INVALID: 'ADMIN_RECOMMENDATION_HEALTH_PAYLOAD_INVALID',
});

export const ADMIN_RECOMMENDATION_HEALTH_REQUEST_FAILED_MESSAGE =
  'Failed to load retraining health.';
export const ADMIN_RECOMMENDATION_HEALTH_PAYLOAD_INVALID_MESSAGE =
  'Retraining health response was invalid.';

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isValidCount = (value) =>
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= 0
  && Number.isSafeInteger(value);

const isValidNullableText = (value) =>
  value === null || (typeof value === 'string' && value.length > 0);

const isValidNullableIso = (value) => {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length === 0) return false;
  return !Number.isNaN(new Date(value).getTime());
};

const isValidIdentifierOrNull = (value) =>
  value === null ||
  (typeof value === 'string' && IDENTIFIER_PATTERN.test(value));

const requestFailedResult = () => ({
  state: ADMIN_RECOMMENDATION_HEALTH_STATES.ERROR,
  backendState: null,
  lease: null,
  latest: null,
  error: {
    code: ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.REQUEST_FAILED,
    message: ADMIN_RECOMMENDATION_HEALTH_REQUEST_FAILED_MESSAGE,
  },
});

const payloadInvalidResult = () => ({
  state: ADMIN_RECOMMENDATION_HEALTH_STATES.ERROR,
  backendState: null,
  lease: null,
  latest: null,
  error: {
    code: ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.PAYLOAD_INVALID,
    message: ADMIN_RECOMMENDATION_HEALTH_PAYLOAD_INVALID_MESSAGE,
  },
});

const readyResult = (backendState, lease, latest) => ({
  state: ADMIN_RECOMMENDATION_HEALTH_STATES.READY,
  backendState,
  lease,
  latest,
  error: null,
});

function normalizeLease(lease, backendState) {
  if (!isPlainObject(lease)) return null;
  if (typeof lease.active !== 'boolean') return null;
  if (backendState === 'running' && lease.active !== true) return null;
  if (backendState !== 'running' && lease.active !== false) return null;

  if (lease.active) {
    if (typeof lease.run_id !== 'string' || !IDENTIFIER_PATTERN.test(lease.run_id)) {
      return null;
    }
    if (typeof lease.expires_at !== 'string' || lease.expires_at.length === 0) {
      return null;
    }
    if (Number.isNaN(new Date(lease.expires_at).getTime())) return null;
    return {
      active: true,
      run_id: lease.run_id,
      expires_at: lease.expires_at,
    };
  }

  if (lease.run_id !== null || lease.expires_at !== null) {
    if (lease.run_id !== null && typeof lease.run_id !== 'string') return null;
    if (lease.expires_at !== null && typeof lease.expires_at !== 'string') {
      return null;
    }
  }
  return {
    active: false,
    run_id: typeof lease.run_id === 'string' ? lease.run_id : null,
    expires_at: typeof lease.expires_at === 'string' ? lease.expires_at : null,
  };
}

function normalizeLatest(latest) {
  if (latest === null) return null;
  if (!isPlainObject(latest)) return null;
  if (
    typeof latest.attempt_id !== 'string' ||
    !IDENTIFIER_PATTERN.test(latest.attempt_id)
  ) {
    return null;
  }
  if (
    typeof latest.run_id !== 'string' ||
    !IDENTIFIER_PATTERN.test(latest.run_id)
  ) {
    return null;
  }
  if (latest.status !== 'completed' && latest.status !== 'failed') {
    return null;
  }
  if (typeof latest.started_at !== 'string' || latest.started_at.length === 0) {
    return null;
  }
  if (Number.isNaN(new Date(latest.started_at).getTime())) return null;
  if (typeof latest.finished_at !== 'string' || latest.finished_at.length === 0) {
    return null;
  }
  if (Number.isNaN(new Date(latest.finished_at).getTime())) return null;

  if (latest.status === 'completed' && latest.failure_code != null) {
    return null;
  }
  if (latest.status === 'failed') {
    if (
      typeof latest.failure_code !== 'string' ||
      latest.failure_code.length === 0
    ) {
      return null;
    }
  } else if (latest.failure_code !== null && latest.failure_code !== undefined) {
    if (typeof latest.failure_code !== 'string') return null;
  }

  if (!isValidIdentifierOrNull(latest.artifact_version)) return null;
  if (!isValidIdentifierOrNull(latest.evaluation_run_id)) return null;
  if (!isValidIdentifierOrNull(latest.snapshot_version)) return null;
  if (!isValidNullableText(latest.failure_message)) return null;

  const optionalCounts = [
    'duration_ms',
    'snapshot_limit',
    'input_event_count',
    'usable_event_count',
    'dropped_event_count',
    'train_event_count',
    'validation_event_count',
    'test_event_count',
    'unique_user_count',
    'unique_song_count',
    'session_count',
    'interaction_pair_count',
    'content_feature_count',
    'snapshot_persisted_count',
    'snapshot_reused_count',
  ];
  for (const key of optionalCounts) {
    if (!isValidCount(latest[key])) return null;
  }

  return {
    attempt_id: latest.attempt_id,
    run_id: latest.run_id,
    status: latest.status,
    started_at: latest.started_at,
    finished_at: latest.finished_at,
    duration_ms: latest.duration_ms ?? null,
    pipeline_stage:
      latest.pipeline_stage === 'policy' ? latest.pipeline_stage : null,
    snapshot_limit: latest.snapshot_limit ?? null,
    artifact_version: latest.artifact_version ?? null,
    evaluation_run_id: latest.evaluation_run_id ?? null,
    snapshot_version: latest.snapshot_version ?? null,
    event_window_truncated: latest.event_window_truncated === true,
    evaluation_created: latest.evaluation_created === true,
    failure_code:
      typeof latest.failure_code === 'string' ? latest.failure_code : null,
    failure_message:
      typeof latest.failure_message === 'string' ? latest.failure_message : null,
    input_event_count: latest.input_event_count ?? null,
    usable_event_count: latest.usable_event_count ?? null,
    dropped_event_count: latest.dropped_event_count ?? null,
    train_event_count: latest.train_event_count ?? null,
    validation_event_count: latest.validation_event_count ?? null,
    test_event_count: latest.test_event_count ?? null,
    unique_user_count: latest.unique_user_count ?? null,
    unique_song_count: latest.unique_song_count ?? null,
    session_count: latest.session_count ?? null,
    interaction_pair_count: latest.interaction_pair_count ?? null,
    content_feature_count: latest.content_feature_count ?? null,
    snapshot_persisted_count: latest.snapshot_persisted_count ?? null,
    snapshot_reused_count: latest.snapshot_reused_count ?? null,
  };
}

export function normalizeAdminRecommendationHealthResponse(raw) {
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
  if (data.source !== ADMIN_RECOMMENDATION_HEALTH_SOURCE) {
    return payloadInvalidResult();
  }
  if (!ADMIN_RECOMMENDATION_HEALTH_BACKEND_STATES.includes(data.state)) {
    return payloadInvalidResult();
  }

  const lease = normalizeLease(data.lease, data.state);
  if (!lease) return payloadInvalidResult();

  const latest = normalizeLatest(data.latest);
  if (data.latest !== null && !latest) return payloadInvalidResult();
  if (data.latest === null && data.state === 'running') {
    // running may have null latest (first attempt in progress)
  }

  return readyResult(data.state, lease, latest);
}

export async function fetchAdminRecommendationHealth(options = {}) {
  const apiClient = options.apiClient;
  const signal = options.signal;

  if (!apiClient || typeof apiClient.get !== 'function') {
    return requestFailedResult();
  }

  let raw;
  try {
    if (signal === undefined) {
      raw = await apiClient.get(ADMIN_RECOMMENDATION_HEALTH_PATH);
    } else {
      raw = await apiClient.get(ADMIN_RECOMMENDATION_HEALTH_PATH, { signal });
    }
  } catch {
    return requestFailedResult();
  }

  return normalizeAdminRecommendationHealthResponse(raw);
}

export default fetchAdminRecommendationHealth;
