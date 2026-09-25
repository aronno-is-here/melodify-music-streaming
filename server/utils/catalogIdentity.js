const MAX_PROVIDER_LENGTH = 128;
const MAX_EXTERNAL_ID_LENGTH = 256;

export function normalizeSourceProvider(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= MAX_PROVIDER_LENGTH ? normalized : null;
}

export function normalizeExternalId(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= MAX_EXTERNAL_ID_LENGTH ? normalized : null;
}

export function buildCatalogIdentity(provider, externalId) {
  const normalizedProvider = normalizeSourceProvider(provider);
  const normalizedId = normalizeExternalId(externalId);
  if (normalizedProvider === null || normalizedId === null) return null;
  // Encode a pair so delimiters within either component cannot collide.
  return JSON.stringify([normalizedProvider, normalizedId]);
}

function isSongLike(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

export function getCatalogIdentityFromSongLike(input) {
  if (!isSongLike(input)) return null;
  return buildCatalogIdentity(input.source_provider, input.external_id);
}

export function getLegacyYoutubeLookupId(input) {
  if (!isSongLike(input)) return null;
  // A lookup candidate only; never infer or mutate canonical provider metadata.
  return normalizeExternalId(input.youtube_id);
}
