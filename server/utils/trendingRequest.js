export const DEFAULT_TRENDING_API_LIMIT = 10;
export const MAX_TRENDING_API_LIMIT = 50;

export const TRENDING_HTTP_MESSAGES = Object.freeze({
  invalidQuery: 'Invalid trending query',
  disabled: 'Trending is currently disabled',
  failed: 'Unable to load Trending songs',
});

const ALLOWED_KEYS = Object.freeze(['limit']);
const DIGITS_ONLY = /^\d+$/;

const invalid = () => ({ ok: false, error: TRENDING_HTTP_MESSAGES.invalidQuery });

const isPlainObjectLike = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseTrendingRequest(query) {
  if (query === undefined) return { ok: true, value: { limit: DEFAULT_TRENDING_API_LIMIT } };
  if (!isPlainObjectLike(query)) return invalid();

  for (const key of Object.keys(query)) {
    if (!ALLOWED_KEYS.includes(key)) return invalid();
  }

  let limit = DEFAULT_TRENDING_API_LIMIT;
  if (Object.prototype.hasOwnProperty.call(query, 'limit')) {
    const raw = query.limit;
    if (typeof raw !== 'string') return invalid();
    if (!DIGITS_ONLY.test(raw)) return invalid();
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_TRENDING_API_LIMIT) {
      return invalid();
    }
    limit = parsed;
  }

  return { ok: true, value: { limit } };
}
