const LRCLIB_BASE_URL = 'https://lrclib.net/api';

export const LRCLIB_USER_AGENT = 'Melodify/1.0 (+https://github.com/aronno-is-here/melodify-music-streaming)';
export const LRCLIB_DEFAULT_TIMEOUT_MS = 5000;
export const LRCLIB_MAX_RETRY_AFTER_MS = 10000;

const isPlainObjectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeRetryAfterMs = (headerValue) => {
  if (!headerValue || typeof headerValue !== 'string') return null;
  const seconds = Number.parseInt(headerValue.trim(), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(seconds * 1000, LRCLIB_MAX_RETRY_AFTER_MS);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' && typeof value !== 'number') continue;
    const normalized = String(value).trim();
    if (!normalized) continue;
    query.set(key, normalized);
  }
  return query;
}

export function createLrclibClient({
  fetchImpl,
  timeoutMs = LRCLIB_DEFAULT_TIMEOUT_MS,
} = {}) {
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : LRCLIB_DEFAULT_TIMEOUT_MS;

  const requestJson = async (path, params = {}, { allowArray = false } = {}) => {
    const query = toQuery(params);
    const url = `${LRCLIB_BASE_URL}${path}?${query.toString()}`;

    const runRequest = async () => {
      const effectiveFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
      if (typeof effectiveFetch !== 'function') {
        throw new Error('LRCLIB client requires fetch');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), safeTimeoutMs);
      try {
        const response = await effectiveFetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': LRCLIB_USER_AGENT,
            'X-User-Agent': LRCLIB_USER_AGENT,
          },
        });
        if (response.status === 429) {
          const retryAfterMs = normalizeRetryAfterMs(response.headers?.get?.('Retry-After'));
          return { status: 429, retryAfterMs };
        }
        if (!response.ok) {
          return { status: response.status, body: null };
        }
        const body = await response.json().catch(() => null);
        if (allowArray) {
          if (!Array.isArray(body)) return { status: response.status, body: [] };
          return { status: response.status, body };
        }
        if (!isPlainObjectLike(body)) return { status: response.status, body: null };
        return { status: response.status, body };
      } finally {
        clearTimeout(timer);
      }
    };

    const first = await runRequest();
    if (first.status === 429 && first.retryAfterMs) {
      await wait(first.retryAfterMs);
      return runRequest();
    }
    return first;
  };

  const getExact = (params) => requestJson('/get', params, { allowArray: false });
  const search = (params) => requestJson('/search', params, { allowArray: true });

  return Object.freeze({ getExact, search });
}
