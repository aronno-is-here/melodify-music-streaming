export const CATALOG_SYNC_DEFAULT_MAX_RESULTS = 5;
export const CATALOG_SYNC_MIN_RESULTS = 1;
export const CATALOG_SYNC_MAX_RESULTS = 10;
export const CATALOG_SYNC_MAX_QUERY_LENGTH = 200;
export const CATALOG_SYNC_MAX_GENRE_LENGTH = 128;
export const CATALOG_SYNC_MAX_LANGUAGE_LENGTH = 64;

export const CATALOG_SYNC_DISABLED_MESSAGE = 'Catalog synchronization is currently disabled.';
export const CATALOG_SYNC_UPSTREAM_MESSAGE = 'YouTube catalog service is temporarily unavailable.';
export const CATALOG_SYNC_GENERIC_MESSAGE = 'Catalog synchronization failed.';

const STATUS_LABELS = Object.freeze({
  inserted: 'Inserted',
  updated: 'Updated',
  'adopted-legacy': 'Adopted legacy',
  skipped: 'Skipped',
  conflict: 'Conflict',
  ineligible: 'Ineligible',
  'invalid-identity': 'Invalid identity',
  'missing-artist': 'Missing artist',
  'ambiguous-legacy-match': 'Ambiguous legacy match',
  'conflicting-legacy-identity': 'Conflicting legacy identity',
  'persistence-failed': 'Persistence failed',
});

const KNOWN_ERROR_MESSAGES = Object.freeze({
  'Catalog synchronization is disabled': CATALOG_SYNC_DISABLED_MESSAGE,
  'Catalog synchronization failed': CATALOG_SYNC_UPSTREAM_MESSAGE,
  'Internal server error': CATALOG_SYNC_GENERIC_MESSAGE,
  'Admin access required': 'Admin access required.',
  'Session expired': 'Session expired.',
});

const isSafeValidationMessage = (message) => {
  if (typeof message !== 'string' || !message || message.length > 200) return false;
  if (message.includes('\n') || message.includes('\r') || message.includes('    at ')) return false;
  if (message.includes('Error:') || message.includes('E11000') || message.includes('AIza')) return false;
  return /^(query|genre|language|maxResults|Request body)\b/.test(message);
};

export function buildCatalogSyncPayload(values) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    return { ok: false, error: 'Invalid catalog sync request.' };
  }

  const rawQuery = values.query;
  if (typeof rawQuery !== 'string') {
    return { ok: false, error: 'Search query is required.' };
  }
  const query = rawQuery.trim();
  if (!query) {
    return { ok: false, error: 'Search query is required.' };
  }
  if (query.length > CATALOG_SYNC_MAX_QUERY_LENGTH) {
    return { ok: false, error: `Search query must be ${CATALOG_SYNC_MAX_QUERY_LENGTH} characters or fewer.` };
  }

  let maxResults = CATALOG_SYNC_DEFAULT_MAX_RESULTS;
  const rawMax = values.maxResults;
  if (rawMax !== undefined && rawMax !== null && rawMax !== '') {
    const parsedMax = typeof rawMax === 'number' ? rawMax : Number(rawMax);
    if (!Number.isInteger(parsedMax) || parsedMax < CATALOG_SYNC_MIN_RESULTS || parsedMax > CATALOG_SYNC_MAX_RESULTS) {
      return { ok: false, error: `Max results must be an integer between ${CATALOG_SYNC_MIN_RESULTS} and ${CATALOG_SYNC_MAX_RESULTS}.` };
    }
    maxResults = parsedMax;
  }

  const payload = { query, maxResults };

  const rawGenre = values.genre;
  if (rawGenre !== undefined && rawGenre !== null && rawGenre !== '') {
    if (typeof rawGenre !== 'string') {
      return { ok: false, error: 'Genre must be text.' };
    }
    const genre = rawGenre.trim();
    if (genre) {
      if (genre.length > CATALOG_SYNC_MAX_GENRE_LENGTH) {
        return { ok: false, error: `Genre must be ${CATALOG_SYNC_MAX_GENRE_LENGTH} characters or fewer.` };
      }
      payload.genre = genre;
    }
  }

  const rawLanguage = values.language;
  if (rawLanguage !== undefined && rawLanguage !== null && rawLanguage !== '') {
    if (typeof rawLanguage !== 'string') {
      return { ok: false, error: 'Language must be text.' };
    }
    const language = rawLanguage.trim();
    if (language) {
      if (language.length > CATALOG_SYNC_MAX_LANGUAGE_LENGTH) {
        return { ok: false, error: `Language must be ${CATALOG_SYNC_MAX_LANGUAGE_LENGTH} characters or fewer.` };
      }
      payload.language = language;
    }
  }

  return { ok: true, payload };
}

export function formatCatalogSyncStatus(value) {
  if (typeof value !== 'string' || !value) return '—';
  if (Object.hasOwn(STATUS_LABELS, value)) return STATUS_LABELS[value];
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function mapCatalogSyncError(data, status) {
  if (typeof status === 'number') {
    if (status === 503) return CATALOG_SYNC_DISABLED_MESSAGE;
    if (status === 502) return CATALOG_SYNC_UPSTREAM_MESSAGE;
    if (status === 500) return CATALOG_SYNC_GENERIC_MESSAGE;
    if (status === 403) return 'Admin access required.';
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return CATALOG_SYNC_GENERIC_MESSAGE;
  }
  if (data.success === true) return null;

  const raw = typeof data.error === 'string' ? data.error : '';
  if (Object.hasOwn(KNOWN_ERROR_MESSAGES, raw)) return KNOWN_ERROR_MESSAGES[raw];
  if (isSafeValidationMessage(raw)) return raw;

  return CATALOG_SYNC_GENERIC_MESSAGE;
}
