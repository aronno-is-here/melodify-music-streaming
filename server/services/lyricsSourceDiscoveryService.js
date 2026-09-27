import {
  buildLyricsSourceClassificationInput,
  classifyLyricsSource,
} from '../utils/lyricsSourceClassification.js';
import { extractSourceAnchors } from '../utils/lyricsSourceHtml.js';
import { sanitizeDiscoveredSourceUrl } from '../utils/lyricsSourceUrl.js';
import { LYRICS_MATCH_CLASS, scoreLyricsMatch } from './lyricsMatchScoring.js';
import { createLyricsSourceCache } from './lyricsSourceCache.js';
import {
  LYRICFIND_PROVIDER_ID,
  MAX_DISCOVERY_SOURCES,
  MAX_QUERY_VARIANTS,
  buildLyricsSourceQueries,
  deriveSourceCandidate,
  getLyricsSourceProvider,
  isSearchResultUrl,
  selectLyricsDiscoveryProviders,
} from './lyricsSourceProviders.js';

export const LYRICS_DISCOVERY_TIMEOUT_MS = 3000;
export const LYRICS_DISCOVERY_MAX_RESPONSE_CHARS = 400000;
export const LYRICS_DISCOVERY_USER_AGENT = 'Melodify/1.0 (+https://github.com/aronno-is-here/melodify-music-streaming)';

const EMPTY_RECORD = Object.freeze({
  category: null,
  combinedBengali: false,
  candidates: Object.freeze([]),
  attempted: Object.freeze([]),
  discoveredAt: null,
});

export function buildLyricsSourceCacheKey(song) {
  return [
    String(song?._id ?? ''),
    String(song?.youtube_id ?? ''),
    String(song?.title ?? ''),
    String(song?.artist ?? ''),
    String(song?.duration ?? ''),
  ].join('|');
}

function defaultShuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function resolveHref(href, baseUrl) {
  if (typeof href !== 'string' || !href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

async function readBoundedHtml(response) {
  if (response?.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = '';
    while (received.length < LYRICS_DISCOVERY_MAX_RESPONSE_CHARS) {
      const { done, value } = await reader.read();
      if (done) break;
      received += decoder.decode(value, { stream: true });
      if (received.length > LYRICS_DISCOVERY_MAX_RESPONSE_CHARS) {
        try {
          await reader.cancel();
        } catch {
          // Reader cancel failures are not actionable.
        }
        return received.slice(0, LYRICS_DISCOVERY_MAX_RESPONSE_CHARS);
      }
    }
    return received;
  }
  if (typeof response?.text === 'function') {
    const text = await response.text();
    return typeof text === 'string' ? text.slice(0, LYRICS_DISCOVERY_MAX_RESPONSE_CHARS) : null;
  }
  return null;
}

/**
 * Multi-source lyrics discovery.
 *
 * Discovery only inspects provider search pages and collects source link
 * metadata (url/title/artist/confidence). Lyric pages themselves are never
 * fetched and no lyric text is ever extracted or persisted.
 */
export function createLyricsSourceDiscoveryService({
  fetchImpl,
  cache = createLyricsSourceCache(),
  shuffle = defaultShuffle,
  now = () => Date.now(),
  timeoutMs = LYRICS_DISCOVERY_TIMEOUT_MS,
} = {}) {
  const inFlight = new Map();

  const fetchSearchPage = async (url, allowedHosts) => {
    const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
    if (typeof fetchFn !== 'function') return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {
        method: 'GET',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': LYRICS_DISCOVERY_USER_AGENT,
        },
      });
      if (!response || response.ok === false) return null;
      if (typeof response.status === 'number' && response.status >= 400) return null;
      const finalUrl = typeof response.url === 'string' && response.url ? response.url : url;
      if (!sanitizeDiscoveredSourceUrl(finalUrl, { allowedHosts })) return null;
      const contentType = typeof response.headers?.get === 'function'
        ? String(response.headers.get('content-type') || '')
        : '';
      if (contentType && !/html|text\/plain/i.test(contentType)) return null;
      const html = await readBoundedHtml(response);
      return html ? html : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  const selectCandidateFromAnchors = (anchors, { provider, song, searchUrl }) => {
    for (const anchor of anchors) {
      const resolved = resolveHref(anchor.href, searchUrl);
      if (!resolved) continue;
      const url = sanitizeDiscoveredSourceUrl(resolved, { allowedHosts: provider.hosts });
      if (!url || isSearchResultUrl(url, searchUrl)) continue;
      const derived = deriveSourceCandidate({ url, text: anchor.text, song });
      if (!derived) continue;
      const match = scoreLyricsMatch({ song, candidate: derived });
      if (match.classification === LYRICS_MATCH_CLASS.EXACT || match.classification === LYRICS_MATCH_CLASS.HIGH) {
        return {
          provider: provider.id,
          providerLabel: provider.label,
          url,
          title: derived.trackName,
          artist: derived.artistName,
          confidence: match.classification,
          discoveredAt: new Date(now()).toISOString(),
        };
      }
    }
    return null;
  };

  const searchProvider = async (provider, song, queries) => {
    const variants = queries.slice(0, MAX_QUERY_VARIANTS);
    for (const query of variants) {
      const builtUrl = provider.searchUrl(query);
      const searchUrl = sanitizeDiscoveredSourceUrl(builtUrl, { allowedHosts: provider.hosts });
      if (!searchUrl) continue;
      const html = await fetchSearchPage(searchUrl, provider.hosts);
      if (html === null) break;
      const anchors = extractSourceAnchors(html);
      const candidate = selectCandidateFromAnchors(anchors, { provider, song, searchUrl });
      if (candidate) return candidate;
    }
    return null;
  };

  const discover = async (song, { forceRefresh = false } = {}) => {
    if (!song || typeof song !== 'object') return EMPTY_RECORD;
    if (song.lyrics_verified === true && typeof song.lyrics === 'string' && song.lyrics.trim()) {
      return EMPTY_RECORD;
    }

    const key = buildLyricsSourceCacheKey(song);
    if (!forceRefresh) {
      const cached = cache.get(key);
      if (cached) return cached;
    }
    const pending = inFlight.get(key);
    if (pending) return pending;

    const run = (async () => {
      try {
        const classification = classifyLyricsSource(buildLyricsSourceClassificationInput(song));
        const queries = buildLyricsSourceQueries({ song, category: classification.category });
        const providers = selectLyricsDiscoveryProviders(classification.category);
        const ordered = shuffle([...providers]).slice(0, MAX_DISCOVERY_SOURCES);

        const attempted = [];
        let candidate = null;
        for (const provider of ordered) {
          attempted.push(provider.id);
          candidate = await searchProvider(provider, song, queries);
          if (candidate) break;
        }

        if (!candidate) {
          const lyricfind = getLyricsSourceProvider(LYRICFIND_PROVIDER_ID);
          if (lyricfind) {
            attempted.push(lyricfind.id);
            candidate = await searchProvider(lyricfind, song, queries);
          }
        }

        const record = {
          category: classification.category,
          combinedBengali: classification.combinedBengali,
          candidates: candidate ? [candidate] : [],
          attempted,
          discoveredAt: new Date(now()).toISOString(),
        };
        return forceRefresh ? cache.merge(key, record) : cache.set(key, record, { negative: !candidate });
      } catch {
        return EMPTY_RECORD;
      }
    })();

    inFlight.set(key, run);
    const settle = () => {
      if (inFlight.get(key) === run) inFlight.delete(key);
    };
    run.then(settle, settle);
    return run;
  };

  const peek = (song) => {
    if (!song || typeof song !== 'object') return EMPTY_RECORD;
    try {
      return cache.get(buildLyricsSourceCacheKey(song)) || EMPTY_RECORD;
    } catch {
      return EMPTY_RECORD;
    }
  };

  return Object.freeze({ discover, peek, cache });
}
