export const LYRICS_CACHE_MAX_ENTRIES = 500;
export const LYRICS_CACHE_TTL_MS = 15 * 60 * 1000;
export const LYRICS_NEGATIVE_CACHE_TTL_MS = 3 * 60 * 1000;

export function createLyricsCache({
  now = () => Date.now(),
  maxEntries = LYRICS_CACHE_MAX_ENTRIES,
  ttlMs = LYRICS_CACHE_TTL_MS,
  negativeTtlMs = LYRICS_NEGATIVE_CACHE_TTL_MS,
} = {}) {
  const store = new Map();

  const get = (key) => {
    const entry = store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      store.delete(key);
      return null;
    }
    return entry.value;
  };

  const set = (key, value, { negative = false } = {}) => {
    const duration = negative ? negativeTtlMs : ttlMs;
    store.set(key, {
      value,
      expiresAt: now() + duration,
    });
    if (store.size > maxEntries) {
      const first = store.keys().next().value;
      if (first) store.delete(first);
    }
  };

  return Object.freeze({
    get,
    set,
    size: () => store.size,
  });
}
