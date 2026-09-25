export const PERSONALIZED_RECOMMENDATION_PATH = '/api/recommendations';
export const DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT = 10;
export const MAX_PERSONALIZED_RECOMMENDATION_LIMIT = 100;
export const PERSONALIZED_RECOMMENDATION_SOURCE = 'personalized-snapshot';
export const PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE =
  'Personalized recommendations are currently unavailable.';
export const PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE =
  'failed to load personalized recommendations';
export const PERSONALIZED_RECOMMENDATION_INVALID_QUERY_MESSAGE =
  'Invalid recommendation query';
export const PERSONALIZED_RECOMMENDATION_SESSION_EXPIRED_MESSAGE = 'Session expired';

export const PERSONALIZED_RECOMMENDATION_STATES = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  READY: 'ready',
  NO_SNAPSHOT: 'no-snapshot',
  EMPTY: 'empty',
  DISABLED: 'disabled',
  ERROR: 'error',
});

export const PERSONALIZED_RECOMMENDATION_ERROR_CODES = Object.freeze({
  REQUEST_FAILED: 'RECOMMENDATION_REQUEST_FAILED',
  PAYLOAD_INVALID: 'RECOMMENDATION_PAYLOAD_INVALID',
});

export const PERSONALIZED_RECOMMENDATION_EMPTY_REASONS = Object.freeze({
  NONE: 'none',
  NO_SNAPSHOT: 'no-snapshot',
  EMPTY_SNAPSHOT: 'empty-snapshot',
  FEATURE_DISABLED: 'feature-disabled',
  REQUEST_ERROR: 'request-error',
});

const SNAPSHOT_PUBLIC_FIELDS = Object.freeze([
  'snapshot_version',
  'generated_at',
  'item_count',
  'available_count',
  'unavailable_count',
]);

const SAFE_ERROR_MESSAGES = new Set([
  PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
  PERSONALIZED_RECOMMENDATION_INVALID_QUERY_MESSAGE,
  PERSONALIZED_RECOMMENDATION_SESSION_EXPIRED_MESSAGE,
  'Invalid server response',
  'Network error',
]);

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const errorResult = (code, message) => ({
  state: PERSONALIZED_RECOMMENDATION_STATES.ERROR,
  songs: [],
  snapshot: null,
  error: { code, message },
});

const disabledResult = () => ({
  state: PERSONALIZED_RECOMMENDATION_STATES.DISABLED,
  songs: [],
  snapshot: null,
  error: null,
});

export function isValidRecommendationLimit(limit) {
  return typeof limit === 'number'
    && Number.isInteger(limit)
    && limit >= 1
    && limit <= MAX_PERSONALIZED_RECOMMENDATION_LIMIT;
}

export function buildPersonalizedRecommendationPath(limit) {
  if (!isValidRecommendationLimit(limit)) {
    throw new Error('invalid recommendation limit');
  }
  return `${PERSONALIZED_RECOMMENDATION_PATH}?limit=${limit}`;
}

function sanitizeErrorMessage(error) {
  if (typeof error === 'string' && SAFE_ERROR_MESSAGES.has(error)) return error;
  return PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE;
}

function normalizeSnapshotMetadata(snapshot) {
  if (!isPlainObject(snapshot)) return null;
  if (!nonEmptyString(snapshot.snapshot_version)) return null;
  if (snapshot.generated_at === undefined || snapshot.generated_at === null) return null;

  const output = {};
  for (const field of SNAPSHOT_PUBLIC_FIELDS) {
    output[field] = snapshot[field];
  }

  const { item_count: itemCount, available_count: availableCount, unavailable_count: unavailableCount } = output;
  if (!Number.isInteger(itemCount) || itemCount < 0) return null;
  if (!Number.isInteger(availableCount) || availableCount < 0) return null;
  if (!Number.isInteger(unavailableCount) || unavailableCount < 0) return null;
  if (availableCount + unavailableCount !== itemCount) return null;

  return output;
}

function validateReadyItems(rawItems, limit) {
  if (!Array.isArray(rawItems)) return null;
  if (rawItems.length > limit) return null;

  const songs = [];
  const seenIds = new Set();
  for (let i = 0; i < rawItems.length; i += 1) {
    const item = rawItems[i];
    if (!isPlainObject(item)) return null;
    if (!Number.isInteger(item.rank) || item.rank !== i + 1) return null;

    const song = item.song;
    if (!isPlainObject(song)) return null;
    if (!nonEmptyString(song._id)) return null;

    const songKey = song._id.toLowerCase();
    if (seenIds.has(songKey)) return null;
    seenIds.add(songKey);
    songs.push(song);
  }

  return songs;
}

export function classifyPersonalizedRecommendationPayload(raw, options = {}) {
  const limit = options.limit === undefined
    ? DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT
    : options.limit;

  if (!isPlainObject(raw)) {
    return errorResult(
      PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
      PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
    );
  }

  if (raw.success === false) {
    if (raw.error === PERSONALIZED_RECOMMENDATION_DISABLED_MESSAGE) {
      return disabledResult();
    }
    return errorResult(
      PERSONALIZED_RECOMMENDATION_ERROR_CODES.REQUEST_FAILED,
      sanitizeErrorMessage(raw.error),
    );
  }

  if (raw.success !== true) {
    return errorResult(
      PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
      PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
    );
  }

  const data = raw.data;
  if (!isPlainObject(data)) {
    return errorResult(
      PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
      PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
    );
  }
  if (data.source !== PERSONALIZED_RECOMMENDATION_SOURCE) {
    return errorResult(
      PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
      PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
    );
  }
  if (!Array.isArray(data.items)) {
    return errorResult(
      PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
      PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
    );
  }

  if (data.status === 'no-snapshot') {
    if (data.items.length !== 0 || data.snapshot !== null) {
      return errorResult(
        PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
        PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
      );
    }
    return {
      state: PERSONALIZED_RECOMMENDATION_STATES.NO_SNAPSHOT,
      songs: [],
      snapshot: null,
      error: null,
    };
  }

  if (data.status === 'ready') {
    if (!isValidRecommendationLimit(limit)) {
      return errorResult(
        PERSONALIZED_RECOMMENDATION_ERROR_CODES.REQUEST_FAILED,
        PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
      );
    }

    const snapshot = normalizeSnapshotMetadata(data.snapshot);
    if (!snapshot) {
      return errorResult(
        PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
        PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
      );
    }

    const songs = validateReadyItems(data.items, limit);
    if (!songs) {
      return errorResult(
        PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
        PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
      );
    }
    if (songs.length > snapshot.available_count) {
      return errorResult(
        PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
        PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
      );
    }

    if (songs.length === 0) {
      return {
        state: PERSONALIZED_RECOMMENDATION_STATES.EMPTY,
        songs: [],
        snapshot,
        error: null,
      };
    }

    return {
      state: PERSONALIZED_RECOMMENDATION_STATES.READY,
      songs,
      snapshot,
      error: null,
    };
  }

  return errorResult(
    PERSONALIZED_RECOMMENDATION_ERROR_CODES.PAYLOAD_INVALID,
    PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
  );
}

export async function fetchPersonalizedRecommendations(options = {}) {
  const limit = options.limit === undefined
    ? DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT
    : options.limit;
  const apiClient = options.apiClient;

  if (!isValidRecommendationLimit(limit)
    || !apiClient
    || typeof apiClient.get !== 'function') {
    return errorResult(
      PERSONALIZED_RECOMMENDATION_ERROR_CODES.REQUEST_FAILED,
      PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
    );
  }

  let raw;
  try {
    raw = await apiClient.get(buildPersonalizedRecommendationPath(limit));
  } catch {
    return errorResult(
      PERSONALIZED_RECOMMENDATION_ERROR_CODES.REQUEST_FAILED,
      PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
    );
  }

  return classifyPersonalizedRecommendationPayload(raw, { limit });
}

export function shouldUseLegacyRecommendationFallback(state) {
  return state === PERSONALIZED_RECOMMENDATION_STATES.NO_SNAPSHOT
    || state === PERSONALIZED_RECOMMENDATION_STATES.EMPTY
    || state === PERSONALIZED_RECOMMENDATION_STATES.DISABLED
    || state === PERSONALIZED_RECOMMENDATION_STATES.ERROR;
}

export function getPersonalizedRecommendationEmptyReason(state) {
  if (state === PERSONALIZED_RECOMMENDATION_STATES.NO_SNAPSHOT) {
    return PERSONALIZED_RECOMMENDATION_EMPTY_REASONS.NO_SNAPSHOT;
  }
  if (state === PERSONALIZED_RECOMMENDATION_STATES.EMPTY) {
    return PERSONALIZED_RECOMMENDATION_EMPTY_REASONS.EMPTY_SNAPSHOT;
  }
  if (state === PERSONALIZED_RECOMMENDATION_STATES.DISABLED) {
    return PERSONALIZED_RECOMMENDATION_EMPTY_REASONS.FEATURE_DISABLED;
  }
  if (state === PERSONALIZED_RECOMMENDATION_STATES.ERROR) {
    return PERSONALIZED_RECOMMENDATION_EMPTY_REASONS.REQUEST_ERROR;
  }
  return PERSONALIZED_RECOMMENDATION_EMPTY_REASONS.NONE;
}
