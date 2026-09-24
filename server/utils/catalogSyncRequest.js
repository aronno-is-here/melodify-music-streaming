import { MAX_QUERY_LENGTH } from '../services/youtubeCatalogClient.js';

export const CATALOG_SYNC_DEFAULT_MAX_RESULTS = 5;
export const CATALOG_SYNC_MAX_RESULTS_LIMIT = 10;
export const MAX_GENRE_CONTEXT_LENGTH = 128;
export const MAX_LANGUAGE_CONTEXT_LENGTH = 64;

const invalid = (error) => ({ ok: false, error });

const normalizeOptionalBoundedString = (value, maxLength, fieldName) => {
  if (value === undefined || value === null) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'string') {
    return invalid(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: undefined };
  }
  if (trimmed.length > maxLength) {
    return invalid(`${fieldName} exceeds the maximum length`);
  }
  return { ok: true, value: trimmed };
};

export function parseCatalogSyncRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalid('Request body must be an object');
  }

  if (typeof body.query !== 'string') {
    return invalid('query is required and must be a string');
  }
  const query = body.query.trim();
  if (!query) {
    return invalid('query must be a non-empty string');
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return invalid('query exceeds the maximum length');
  }

  const genreResult = normalizeOptionalBoundedString(body.genre, MAX_GENRE_CONTEXT_LENGTH, 'genre');
  if (!genreResult.ok) return genreResult;
  const languageResult = normalizeOptionalBoundedString(body.language, MAX_LANGUAGE_CONTEXT_LENGTH, 'language');
  if (!languageResult.ok) return languageResult;

  let maxResults = CATALOG_SYNC_DEFAULT_MAX_RESULTS;
  if (body.maxResults !== undefined && body.maxResults !== null) {
    if (typeof body.maxResults !== 'number' || !Number.isInteger(body.maxResults)) {
      return invalid('maxResults must be an integer');
    }
    if (body.maxResults < 1 || body.maxResults > CATALOG_SYNC_MAX_RESULTS_LIMIT) {
      return invalid('maxResults must be between 1 and 10');
    }
    maxResults = body.maxResults;
  }

  const value = { query, maxResults };
  if (genreResult.value !== undefined) value.genre = genreResult.value;
  if (languageResult.value !== undefined) value.language = languageResult.value;
  return { ok: true, value };
}
