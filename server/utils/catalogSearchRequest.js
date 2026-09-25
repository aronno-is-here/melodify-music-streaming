import { normalizeRegionTag } from '../services/regionalCatalog.js';

export const CATALOG_SEARCH_DEFAULT_LIMIT = 20;
export const CATALOG_SEARCH_MAX_LIMIT = 40;

export const CATALOG_SEARCH_QUERY_KEYS = Object.freeze([
  'q',
  'region',
  'limit',
  'external',
  'broaden',
]);

export const VERCEL_ROUTING_METADATA_KEYS = Object.freeze(['path']);

const invalid = (error) => ({ ok: false, error });

function parseBoolean(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  return undefined;
}

export function parseCatalogSearchQuery(query) {
  if (query === null || typeof query !== 'object' || Array.isArray(query)) {
    return invalid('invalid catalog search query');
  }

  const keys = Object.keys(query);
  for (const key of keys) {
    const isApplicationKey = CATALOG_SEARCH_QUERY_KEYS.includes(key);
    const isVercelRoutingMetadata = VERCEL_ROUTING_METADATA_KEYS.includes(key);
    if (!isApplicationKey && !isVercelRoutingMetadata) {
      return invalid('invalid catalog search query');
    }
  }

  if (typeof query.q !== 'string' || !query.q.trim()) {
    return invalid('search query is required');
  }
  const q = query.q.trim();
  if (q.length > 200) {
    return invalid('search query is too long');
  }

  let limit = CATALOG_SEARCH_DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(query.limit)) {
      return invalid('invalid catalog search query');
    }
    const parsed = Number.parseInt(query.limit, 10);
    if (parsed < 1 || parsed > CATALOG_SEARCH_MAX_LIMIT) {
      return invalid('invalid catalog search query');
    }
    limit = parsed;
  }

  let regionTag;
  if (query.region !== undefined) {
    if (typeof query.region !== 'string') {
      return invalid('invalid catalog search query');
    }
    const normalized = normalizeRegionTag(query.region);
    if (!normalized) return invalid('invalid catalog search query');
    regionTag = normalized;
  }

  const includeExternal = parseBoolean(query.external);
  const broadenExternal = parseBoolean(query.broaden);

  return {
    ok: true,
    value: {
      query: q,
      regionTag,
      limit,
      includeExternal: includeExternal !== false,
      broadenExternal: broadenExternal === true,
    },
  };
}
