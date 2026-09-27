export const LYRICS_SOURCE_CACHE_MAX_ENTRIES = 300;
export const LYRICS_SOURCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const LYRICS_SOURCE_CACHE_NEGATIVE_TTL_MS = 30 * 60 * 1000;
export const LYRICS_SOURCE_MAX_CANDIDATES_PER_SONG = 8;

const emptyCandidates = () => [];

function mergeCandidates(existing, incoming) {
  const merged = [...existing];
  const seen = new Set(existing.map((entry) => entry.url));
  for (const candidate of incoming) {
    if (!candidate || typeof candidate.url !== 'string' || seen.has(candidate.url)) continue;
    seen.add(candidate.url);
    merged.push(candidate);
    if (merged.length >= LYRICS_SOURCE_MAX_CANDIDATES_PER_SONG) break;
  }
  return merged;
}

/**
 * Lightweight in-memory cache for discovered source metadata.
 * Stores only source candidate metadata (provider/url/title/artist/confidence)
 * and never page HTML or lyric bodies.
 */
export function createLyricsSourceCache({
  now = () => Date.now(),
  maxEntries = LYRICS_SOURCE_CACHE_MAX_ENTRIES,
  ttlMs = LYRICS_SOURCE_CACHE_TTL_MS,
  negativeTtlMs = LYRICS_SOURCE_CACHE_NEGATIVE_TTL_MS,
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

  const put = (key, value, { negative = false } = {}) => {
    store.set(key, { value, expiresAt: now() + (negative ? negativeTtlMs : ttlMs) });
    if (store.size > maxEntries) {
      const oldest = store.keys().next().value;
      if (oldest !== undefined) store.delete(oldest);
    }
    return value;
  };

  const set = (key, record, options = {}) => put(key, record, options);

  const merge = (key, record, options = {}) => {
    const previous = get(key);
    if (!previous) return put(key, record, options);
    const merged = {
      category: record.category ?? previous.category,
      combinedBengali: record.combinedBengali ?? previous.combinedBengali,
      candidates: mergeCandidates(previous.candidates || emptyCandidates(), record.candidates || emptyCandidates()),
      attempted: record.attempted || previous.attempted || [],
      discoveredAt: record.discoveredAt || previous.discoveredAt || null,
    };
    const negative = merged.candidates.length === 0;
    return put(key, merged, { negative });
  };

  return Object.freeze({
    get,
    set,
    merge,
    size: () => store.size,
  });
}
