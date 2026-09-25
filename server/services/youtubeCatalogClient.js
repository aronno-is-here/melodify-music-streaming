export const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
export const DEFAULT_SEARCH_MAX_RESULTS = 5;
export const MAX_SEARCH_MAX_RESULTS = 50;
export const MAX_QUERY_LENGTH = 200;
export const MAX_PAGE_TOKEN_LENGTH = 512;
export const MAX_VIDEO_IDS = 50;
export const MAX_VIDEO_ID_LENGTH = 64;
export const DEFAULT_REQUEST_TIMEOUT_MS = 9000;

const NOT_CONFIGURED_ERROR = 'YouTube catalog API is not configured';

const isPlainObjectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export const createYouTubeCatalogClient = ({
  apiKey = process.env.YOUTUBE_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new Error('YouTube catalog client requires a fetch implementation');
  }
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_REQUEST_TIMEOUT_MS;

  const requireConfigured = () => {
    if (!key) {
      throw new Error(NOT_CONFIGURED_ERROR);
    }
  };

  const buildUrl = (path, params) => {
    const url = new URL(`${YOUTUBE_API_BASE}${path}`);
    for (const [name, value] of params) {
      url.searchParams.set(name, value);
    }
    url.searchParams.set('key', key);
    return url;
  };

  const request = async (operation, url) => {
    const controller = new AbortController();
    let timer;
    const timeoutPromise = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${operation} timed out`));
        controller.abort();
      }, timeout);
    });
    const fetchPromise = fetchImpl(url, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    try {
      const response = await Promise.race([fetchPromise, timeoutPromise]);
      if (!response || typeof response.ok !== 'boolean') {
        throw new Error(`${operation} failed`);
      }
      if (!response.ok) {
        const status = Number.isInteger(response.status) ? response.status : 'unknown';
        throw new Error(`${operation} failed (HTTP ${status})`);
      }
      let body;
      try {
        body = await response.json();
      } catch {
        throw new Error(`${operation} returned a malformed response`);
      }
      if (!isPlainObjectLike(body)) {
        throw new Error(`${operation} returned a malformed response`);
      }
      return body;
    } catch (error) {
      if (error && typeof error.message === 'string' && error.message.startsWith(operation)) {
        throw error;
      }
      if (error && error.name === 'AbortError') {
        throw new Error(`${operation} timed out`);
      }
      throw new Error(`${operation} failed`);
    } finally {
      clearTimeout(timer);
    }
  };

  const searchMusicVideos = async (options) => {
    requireConfigured();
    if (!isPlainObjectLike(options)) {
      throw new Error('YouTube catalog search requires an options object');
    }
    if (typeof options.query !== 'string') {
      throw new Error('YouTube catalog search requires a string query');
    }
    const query = options.query.trim();
    if (!query || query.length > MAX_QUERY_LENGTH) {
      throw new Error('YouTube catalog search requires a non-empty bounded query');
    }
    let pageToken;
    if (options.pageToken !== undefined && options.pageToken !== null) {
      if (typeof options.pageToken !== 'string') {
        throw new Error('YouTube catalog search received an invalid pageToken');
      }
      pageToken = options.pageToken.trim();
      if (!pageToken || pageToken.length > MAX_PAGE_TOKEN_LENGTH) {
        throw new Error('YouTube catalog search received an invalid pageToken');
      }
    }
    let maxResults = DEFAULT_SEARCH_MAX_RESULTS;
    if (options.maxResults !== undefined && options.maxResults !== null) {
      if (!Number.isInteger(options.maxResults) || options.maxResults < 1 || options.maxResults > MAX_SEARCH_MAX_RESULTS) {
        throw new Error('YouTube catalog search received an invalid maxResults');
      }
      maxResults = options.maxResults;
    }
    const params = [
      ['part', 'snippet'],
      ['type', 'video'],
      ['q', query],
      ['maxResults', String(maxResults)],
    ];
    if (pageToken) {
      params.push(['pageToken', pageToken]);
    }
    return request('YouTube catalog search', buildUrl('/search', params));
  };

  const getVideoDetails = async (videoIds) => {
    requireConfigured();
    if (!Array.isArray(videoIds)) {
      throw new Error('YouTube video metadata request requires an array of video IDs');
    }
    const seen = new Set();
    const ids = [];
    for (const entry of videoIds) {
      if (typeof entry !== 'string') {
        throw new Error('YouTube video metadata request received invalid video IDs');
      }
      const id = entry.trim();
      if (!id) {
        continue;
      }
      if (id.length > MAX_VIDEO_ID_LENGTH) {
        throw new Error('YouTube video metadata request received invalid video IDs');
      }
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      ids.push(id);
    }
    if (ids.length === 0) {
      throw new Error('YouTube video metadata request received an empty video ID batch');
    }
    if (ids.length > MAX_VIDEO_IDS) {
      throw new Error('YouTube video metadata request exceeds the maximum video ID batch size');
    }
    return request(
      'YouTube video metadata request',
      buildUrl('/videos', [
        ['part', 'snippet,contentDetails,status'],
        ['id', ids.join(',')],
      ]),
    );
  };

  return Object.freeze({ searchMusicVideos, getVideoDetails });
};
