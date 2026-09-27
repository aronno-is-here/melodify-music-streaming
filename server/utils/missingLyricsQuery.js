import { escapeRegex } from './escapeRegex.js';

export const MISSING_LYRICS_LANGUAGE_FILTERS = Object.freeze([
  Object.freeze({ value: 'hindi', label: 'Hindi' }),
  Object.freeze({ value: 'bn-bd', label: 'Bangladeshi Bengali' }),
  Object.freeze({ value: 'bn-in', label: 'Kolkata/Indian Bengali' }),
  Object.freeze({ value: 'english', label: 'English' }),
]);

export const MISSING_LYRICS_LANGUAGE_VALUES = Object.freeze(
  MISSING_LYRICS_LANGUAGE_FILTERS.map((filter) => filter.value),
);

export const DEFAULT_MISSING_LYRICS_PAGE = 1;
export const DEFAULT_MISSING_LYRICS_LIMIT = 20;
export const MAX_MISSING_LYRICS_LIMIT = 50;

export const MISSING_LYRICS_QUERY_ERROR_MESSAGES = Object.freeze({
  INVALID_QUERY: 'invalid missing lyrics query',
});

const HINDI_ALIASES = Object.freeze(['hi', 'hin', 'hindi']);
const BENGALI_ALIASES = Object.freeze(['bn', 'ben', 'bengali', 'bangla']);
const ENGLISH_ALIASES = Object.freeze(['en', 'eng', 'english']);
const LANGUAGE_ALIASES = Object.freeze({
  hindi: HINDI_ALIASES,
  'bn-bd': BENGALI_ALIASES,
  'bn-in': BENGALI_ALIASES,
  english: ENGLISH_ALIASES,
});
const REGIONAL_TAG_VALUES = Object.freeze({
  hindi: 'hi-in',
  'bn-bd': 'bn-bd',
  'bn-in': 'bn-in',
  english: 'en',
});

export function parseMissingLyricsQuery(rawQuery = {}) {
  if (!rawQuery || typeof rawQuery !== 'object' || Array.isArray(rawQuery)) {
    return { ok: false, error: MISSING_LYRICS_QUERY_ERROR_MESSAGES.INVALID_QUERY };
  }

  const allowedKeys = new Set(['q', 'language', 'missing', 'page', 'limit']);
  for (const key of Object.keys(rawQuery)) {
    if (!allowedKeys.has(key)) {
      return { ok: false, error: MISSING_LYRICS_QUERY_ERROR_MESSAGES.INVALID_QUERY };
    }
  }

  let q = null;
  if (rawQuery.q !== undefined && rawQuery.q !== null && rawQuery.q !== '') {
    if (typeof rawQuery.q !== 'string') {
      return { ok: false, error: MISSING_LYRICS_QUERY_ERROR_MESSAGES.INVALID_QUERY };
    }
    const trimmedQuery = rawQuery.q.trim();
    if (trimmedQuery.length > 200) {
      return { ok: false, error: MISSING_LYRICS_QUERY_ERROR_MESSAGES.INVALID_QUERY };
    }
    q = trimmedQuery || null;
  }

  let language = null;
  if (rawQuery.language !== undefined && rawQuery.language !== null && rawQuery.language !== '') {
    if (typeof rawQuery.language !== 'string' || !MISSING_LYRICS_LANGUAGE_VALUES.includes(rawQuery.language)) {
      return { ok: false, error: MISSING_LYRICS_QUERY_ERROR_MESSAGES.INVALID_QUERY };
    }
    language = rawQuery.language;
  }

  let missing = true;
  if (rawQuery.missing !== undefined) {
    if (rawQuery.missing !== '0' && rawQuery.missing !== '1') {
      return { ok: false, error: MISSING_LYRICS_QUERY_ERROR_MESSAGES.INVALID_QUERY };
    }
    missing = rawQuery.missing === '1';
  }

  const page = parsePositiveInteger(rawQuery.page, DEFAULT_MISSING_LYRICS_PAGE, 1, Number.MAX_SAFE_INTEGER);
  if (page === null) {
    return { ok: false, error: MISSING_LYRICS_QUERY_ERROR_MESSAGES.INVALID_QUERY };
  }

  const limit = parsePositiveInteger(
    rawQuery.limit,
    DEFAULT_MISSING_LYRICS_LIMIT,
    1,
    MAX_MISSING_LYRICS_LIMIT,
  );
  if (limit === null) {
    return { ok: false, error: MISSING_LYRICS_QUERY_ERROR_MESSAGES.INVALID_QUERY };
  }

  return { ok: true, q, language, missing, page, limit };
}

export function buildMissingLyricsFilter({ q, language, missing } = {}) {
  const clauses = [];

  if (missing !== false) {
    clauses.push({
      $or: [
        { lyrics_verified: { $ne: true } },
        { lyrics: { $exists: false } },
        { lyrics: null },
        { lyrics: '' },
      ],
    });
  } else {
    clauses.push({
      $and: [{ lyrics_verified: true }, { lyrics: { $exists: true, $nin: ['', null] } }],
    });
  }

  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    clauses.push({ $or: [{ title: pattern }, { artist: pattern }, { album: pattern }] });
  }

  if (language) {
    const aliases = LANGUAGE_ALIASES[language];
    const languageClause = {
      $or: [
        { language: { $in: aliases } },
        { lyrics_language: { $in: aliases } },
        { regional_tag: REGIONAL_TAG_VALUES[language] },
      ],
    };
    if (language === 'bn-bd') {
      clauses.push({ $and: [{ regional_tag: { $ne: 'bn-in' } }, languageClause] });
    } else if (language === 'bn-in') {
      clauses.push({ regional_tag: 'bn-in' });
    } else {
      clauses.push(languageClause);
    }
  }

  if (clauses.length === 0) return {};
  if (clauses.length === 1) return clauses[0];
  return { $and: clauses };
}

export function selectMissingLyricsRow(song) {
  if (!song || typeof song !== 'object') return null;
  const lyrics = typeof song.lyrics === 'string' ? song.lyrics : '';
  const verified = song.lyrics_verified === true;
  const hasVerifiedLyrics = verified && lyrics.trim().length > 0;
  const source = typeof song.lyrics_source === 'string' ? song.lyrics_source : '';
  return {
    songId: String(song._id),
    title: typeof song.title === 'string' ? song.title : '',
    artist: typeof song.artist === 'string' ? song.artist : '',
    album: typeof song.album === 'string' ? song.album : '',
    duration: typeof song.duration === 'string' ? song.duration : '',
    language: typeof song.language === 'string' ? song.language : '',
    lyricsLanguage: typeof song.lyrics_language === 'string' ? song.lyrics_language : '',
    regionalTag: typeof song.regional_tag === 'string' ? song.regional_tag : '',
    lyricsStatus: hasVerifiedLyrics ? 'verified' : lyrics ? 'legacy' : 'missing',
    source,
    lrclibStatus: source.startsWith('lrclib') ? 'stored' : 'not-stored',
    sourceUrl: typeof song.lyrics_source_url === 'string' ? song.lyrics_source_url : '',
    lyricsLength: lyrics.length,
  };
}

function parsePositiveInteger(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}
