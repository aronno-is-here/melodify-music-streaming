import { normalizeRegionTag } from '../services/regionalCatalog.js';

export const KARAOKE_DISCOVERY_DEFAULT_LIMIT = 12;
export const KARAOKE_DISCOVERY_MAX_LIMIT = 20;
export const KARAOKE_DISCOVERY_DEFAULT_PAGE = 1;
export const KARAOKE_DISCOVERY_MAX_PAGE = 20;

const invalid = (error) => ({ ok: false, error });

export function parseKaraokeDiscoveryQuery(query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return invalid('invalid karaoke discovery query');
  }

  for (const key of Object.keys(query)) {
    if (!['q', 'region', 'limit', 'page'].includes(key)) {
      return invalid('invalid karaoke discovery query');
    }
  }

  let search = '';
  if (query.q !== undefined) {
    if (typeof query.q !== 'string') return invalid('invalid karaoke discovery query');
    search = query.q.trim();
    if (search.length > 200) return invalid('invalid karaoke discovery query');
  }

  let regionTag;
  if (query.region !== undefined) {
    if (typeof query.region !== 'string') return invalid('invalid karaoke discovery query');
    const normalized = normalizeRegionTag(query.region);
    if (!normalized) return invalid('invalid karaoke discovery query');
    regionTag = normalized;
  }

  let limit = KARAOKE_DISCOVERY_DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    if (typeof query.limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(query.limit)) {
      return invalid('invalid karaoke discovery query');
    }
    const parsedLimit = Number.parseInt(query.limit, 10);
    if (parsedLimit < 1 || parsedLimit > KARAOKE_DISCOVERY_MAX_LIMIT) {
      return invalid('invalid karaoke discovery query');
    }
    limit = parsedLimit;
  }

  let page = KARAOKE_DISCOVERY_DEFAULT_PAGE;
  if (query.page !== undefined) {
    if (typeof query.page !== 'string' || !/^[1-9][0-9]{0,2}$/.test(query.page)) {
      return invalid('invalid karaoke discovery query');
    }
    const parsedPage = Number.parseInt(query.page, 10);
    if (parsedPage < 1 || parsedPage > KARAOKE_DISCOVERY_MAX_PAGE) {
      return invalid('invalid karaoke discovery query');
    }
    page = parsedPage;
  }

  return {
    ok: true,
    value: {
      query: search,
      regionTag,
      limit,
      page,
    },
  };
}
