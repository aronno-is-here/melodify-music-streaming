export const ADMIN_RECOMMENDATION_PREFLIGHT_PATH =
  '/api/admin/recommendations/preflight';
export const ADMIN_RECOMMENDATION_PREFLIGHT_SOURCE = 'recommendation-preflight';

export const ADMIN_RECOMMENDATION_PREFLIGHT_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error',
});

export const ADMIN_RECOMMENDATION_PREFLIGHT_SUFFICIENCY_STATES = Object.freeze([
  'ready',
  'insufficient',
]);

export const ADMIN_RECOMMENDATION_PREFLIGHT_REASONS = Object.freeze([
  'NO_LISTENING_EVENTS',
  'INSUFFICIENT_SONGS',
  'INSUFFICIENT_TRAINING_DATA',
  'INSUFFICIENT_USERS',
  'INSUFFICIENT_INTERACTIONS',
]);

export const ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES = Object.freeze({
  REQUEST_FAILED: 'ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED',
  PAYLOAD_INVALID: 'ADMIN_RECOMMENDATION_PREFLIGHT_PAYLOAD_INVALID',
});

export const ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED_MESSAGE =
  'Failed to load training readiness.';
export const ADMIN_RECOMMENDATION_PREFLIGHT_PAYLOAD_INVALID_MESSAGE =
  'Training readiness response was invalid.';

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isValidCount = (value) =>
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= 0
  && Number.isSafeInteger(value);

const errorResult = (code, message) => ({
  state: ADMIN_RECOMMENDATION_PREFLIGHT_STATES.ERROR,
  data: null,
  error: { code, message },
});

const requestFailedResult = () =>
  errorResult(
    ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES.REQUEST_FAILED,
    ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED_MESSAGE,
  );

const payloadInvalidResult = () =>
  errorResult(
    ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES.PAYLOAD_INVALID,
    ADMIN_RECOMMENDATION_PREFLIGHT_PAYLOAD_INVALID_MESSAGE,
  );

const readyResult = (data) => ({
  state: ADMIN_RECOMMENDATION_PREFLIGHT_STATES.READY,
  data,
  error: null,
});

function normalizeFlags(value) {
  if (!isPlainObject(value)) return null;
  if (typeof value.recommendation_ai_enabled !== 'boolean') return null;
  if (typeof value.listening_events_enabled !== 'boolean') return null;
  return {
    recommendation_ai_enabled: value.recommendation_ai_enabled,
    listening_events_enabled: value.listening_events_enabled,
  };
}

function normalizeBlock(value, keys) {
  if (!isPlainObject(value)) return null;
  const result = {};
  for (const key of keys) {
    if (!isValidCount(value[key])) return null;
    result[key] = value[key];
  }
  return result;
}

function normalizeSufficiency(value) {
  if (!isPlainObject(value)) return null;
  if (!ADMIN_RECOMMENDATION_PREFLIGHT_SUFFICIENCY_STATES.includes(value.state)) {
    return null;
  }
  const reason = value.reason;
  if (value.state === 'ready') {
    if (reason !== null) return null;
    return { state: value.state, reason: null };
  }
  if (!ADMIN_RECOMMENDATION_PREFLIGHT_REASONS.includes(reason)) return null;
  return { state: value.state, reason };
}

export function normalizeAdminRecommendationPreflightResponse(raw) {
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
  if (data.source !== ADMIN_RECOMMENDATION_PREFLIGHT_SOURCE) {
    return payloadInvalidResult();
  }

  const featureFlags = normalizeFlags(data.feature_flags);
  if (!featureFlags) return payloadInvalidResult();

  const catalog = normalizeBlock(data.catalog, ['songs']);
  if (!catalog) return payloadInvalidResult();

  const telemetry = normalizeBlock(data.telemetry, [
    'listening_events',
    'usable_events',
    'distinct_users',
    'distinct_songs',
  ]);
  if (!telemetry) return payloadInvalidResult();

  const persisted = normalizeBlock(data.persisted, [
    'evaluation_runs',
    'snapshots',
  ]);
  if (!persisted) return payloadInvalidResult();

  const sufficiency = normalizeSufficiency(data.sufficiency);
  if (!sufficiency) return payloadInvalidResult();

  return readyResult({
    source: ADMIN_RECOMMENDATION_PREFLIGHT_SOURCE,
    feature_flags: featureFlags,
    catalog,
    telemetry,
    persisted,
    sufficiency,
  });
}

export async function fetchAdminRecommendationPreflight(options = {}) {
  const apiClient = options.apiClient;
  const signal = options.signal;

  if (!apiClient || typeof apiClient.get !== 'function') {
    return requestFailedResult();
  }

  let raw;
  try {
    if (signal === undefined) {
      raw = await apiClient.get(ADMIN_RECOMMENDATION_PREFLIGHT_PATH);
    } else {
      raw = await apiClient.get(ADMIN_RECOMMENDATION_PREFLIGHT_PATH, { signal });
    }
  } catch {
    return requestFailedResult();
  }

  return normalizeAdminRecommendationPreflightResponse(raw);
}

export default fetchAdminRecommendationPreflight;
