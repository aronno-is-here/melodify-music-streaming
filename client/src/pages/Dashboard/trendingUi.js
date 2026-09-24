export const TRENDING_BASIS = Object.freeze({
  ACTIVITY: 'activity',
  CATALOG_FALLBACK: 'catalog-fallback',
});

export const TRENDING_MODE = Object.freeze({
  ACTIVITY: 'activity',
  ACTIVITY_PLUS_FALLBACK: 'activity-plus-fallback',
  CATALOG_FALLBACK: 'catalog-fallback',
});

export const TRENDING_REQUEST_LIMIT = 10;
export const TRENDING_REQUEST_PATH = '/api/trending?limit=10';
export const TRENDING_DISABLED_ERROR = 'Trending is currently disabled';
export const TRENDING_LOADING_MESSAGE = 'Loading...';
export const TRENDING_EMPTY_MESSAGE = 'No trending songs available yet.';
export const TRENDING_ERROR_MESSAGE = 'Trending is unavailable right now.';
export const TRENDING_FALLBACK_LABEL = 'Recently added';

const ACCEPTED_BASIS = Object.freeze([
  TRENDING_BASIS.ACTIVITY,
  TRENDING_BASIS.CATALOG_FALLBACK,
]);

const SONG_FIELDS = Object.freeze([
  '_id',
  'title',
  'artist',
  'genre',
  'youtube_id',
  'file_path',
  'poster_url',
  'duration',
  'duration_seconds',
  'release_date',
  'language',
  'category',
]);

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const nonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const isPlayable = (song) =>
  nonEmptyString(song.youtube_id) || nonEmptyString(song.file_path);

const projectSong = (song) => {
  const output = {};
  for (const field of SONG_FIELDS) {
    if (song[field] !== undefined) output[field] = song[field];
  }
  return output;
};

const copyActivityBlock = (activity) => {
  if (!isPlainObject(activity)) return null;
  const output = {};
  for (const key of Object.keys(activity)) {
    if (Object.hasOwn(activity, key)) output[key] = activity[key];
  }
  return output;
};

export function normalizeTrendingItem(item) {
  if (!isPlainObject(item)) return null;
  if (!ACCEPTED_BASIS.includes(item.basis)) return null;

  const song = item.song;
  if (!isPlainObject(song)) return null;
  if (!nonEmptyString(song._id)) return null;
  if (!nonEmptyString(song.title)) return null;
  if (!nonEmptyString(song.artist)) return null;
  if (!isPlayable(song)) return null;

  const normalized = {
    basis: item.basis,
    song: projectSong(song),
  };

  if (item.basis === TRENDING_BASIS.ACTIVITY) {
    if (item.score !== undefined && item.score !== null
      && typeof item.score === 'number' && Number.isFinite(item.score)) {
      normalized.score = item.score;
    }
    const activity = copyActivityBlock(item.activity);
    if (activity) normalized.activity = activity;
  }

  return normalized;
}

const emptyMeta = () => Object.freeze({
  mode: null,
  activity_count: null,
  fallback_count: null,
});

const normalizeMeta = (meta) => {
  if (!isPlainObject(meta)) return emptyMeta();
  const mode = ACCEPTED_BASIS.includes(meta.mode)
    || Object.values(TRENDING_MODE).includes(meta.mode)
    ? meta.mode
    : null;
  return Object.freeze({
    mode,
    activity_count: typeof meta.activity_count === 'number'
      && Number.isFinite(meta.activity_count)
      ? meta.activity_count
      : null,
    fallback_count: typeof meta.fallback_count === 'number'
      && Number.isFinite(meta.fallback_count)
      ? meta.fallback_count
      : null,
  });
};

export function normalizeTrendingResponse(payload) {
  const items = [];
  if (!isPlainObject(payload)) {
    return { items, meta: emptyMeta() };
  }
  if (payload.success !== true) {
    return { items, meta: emptyMeta() };
  }
  const data = payload.data;
  if (!isPlainObject(data)) {
    return { items, meta: emptyMeta() };
  }
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const seen = new Set();
  for (const raw of rawItems) {
    const normalized = normalizeTrendingItem(raw);
    if (!normalized) continue;
    const key = String(normalized.song._id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(normalized);
  }
  return { items, meta: normalizeMeta(data.meta) };
}

export function buildTrendingSongs(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => isPlainObject(item) && isPlainObject(item.song))
    .map((item) => item.song);
}

export function getTrendingDisplayMeta(item) {
  if (!isPlainObject(item)) return null;
  if (item.basis === TRENDING_BASIS.CATALOG_FALLBACK) {
    return TRENDING_FALLBACK_LABEL;
  }
  return null;
}

export function classifyTrendingResult(payload) {
  if (isPlainObject(payload) && payload.success === true
    && isPlainObject(payload.data)) {
    return 'ok';
  }
  if (isPlainObject(payload) && payload.error === TRENDING_DISABLED_ERROR) {
    return 'disabled';
  }
  return 'error';
}
