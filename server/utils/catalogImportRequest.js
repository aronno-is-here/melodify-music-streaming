import { normalizeRegionTag } from '../services/regionalCatalog.js';

export const CATALOG_IMPORT_ALLOWED_FIELDS = Object.freeze([
  'provider',
  'providerTrackId',
  'regionTag',
  'genre',
  'language',
]);

const MAX_TEXT_LENGTH = 128;

const invalid = (error) => ({ ok: false, error });

const normalizeOptionalText = (value, fieldName) => {
  if (value === undefined || value === null) return { ok: true, value: undefined };
  if (typeof value !== 'string') return invalid(`${fieldName} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: undefined };
  if (trimmed.length > MAX_TEXT_LENGTH) return invalid(`${fieldName} exceeds the maximum length`);
  return { ok: true, value: trimmed };
};

export function parseCatalogImportRequest(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return invalid('Request body must be an object');
  }

  for (const key of Object.keys(body)) {
    if (!CATALOG_IMPORT_ALLOWED_FIELDS.includes(key)) {
      return invalid('invalid catalog import request');
    }
  }

  if (typeof body.provider !== 'string' || !body.provider.trim()) {
    return invalid('provider is required');
  }
  if (typeof body.providerTrackId !== 'string' || !body.providerTrackId.trim()) {
    return invalid('providerTrackId is required');
  }

  const provider = body.provider.trim().toLowerCase();
  const providerTrackId = body.providerTrackId.trim();

  const genre = normalizeOptionalText(body.genre, 'genre');
  if (!genre.ok) return genre;
  const language = normalizeOptionalText(body.language, 'language');
  if (!language.ok) return language;

  let regionTag;
  if (body.regionTag !== undefined && body.regionTag !== null) {
    if (typeof body.regionTag !== 'string') {
      return invalid('regionTag must be a string');
    }
    const normalizedRegion = normalizeRegionTag(body.regionTag);
    if (!normalizedRegion) {
      return invalid('regionTag is invalid');
    }
    regionTag = normalizedRegion;
  }

  const value = {
    provider,
    providerTrackId,
  };
  if (genre.value !== undefined) value.genre = genre.value;
  if (language.value !== undefined) value.language = language.value;
  if (regionTag !== undefined) value.regionTag = regionTag;
  return { ok: true, value };
}
