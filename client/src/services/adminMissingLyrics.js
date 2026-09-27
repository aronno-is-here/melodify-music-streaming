export const ADMIN_MISSING_LYRICS_PATH = '/api/admin/lyrics';
export const ADMIN_LYRICS_IMPORT_PATH = '/api/admin/lyrics/import';

export const MAX_LYRICS_TEXT_LENGTH = 100000;
export const MAX_LYRICS_FILE_BYTES = 262144;
export const MAX_BULK_IMPORT_BYTES = 786432;
export const MAX_BULK_LYRICS_ENTRIES = 500;
export const LYRICS_FILE_EXTENSIONS = Object.freeze(['.txt', '.lrc']);
export const BULK_IMPORT_FILE_EXTENSIONS = Object.freeze(['.csv', '.json']);
export const MAX_BULK_FILE_COUNT = 1;

export const MISSING_LYRICS_LANGUAGE_FILTERS = Object.freeze([
  Object.freeze({ value: '', label: 'All languages' }),
  Object.freeze({ value: 'hindi', label: 'Hindi' }),
  Object.freeze({ value: 'bn-bd', label: 'Bangladeshi Bengali' }),
  Object.freeze({ value: 'bn-in', label: 'Kolkata/Indian Bengali' }),
  Object.freeze({ value: 'english', label: 'English' }),
]);

export const ADMIN_MISSING_LYRICS_MESSAGES = Object.freeze({
  QUEUE_FAILED: 'Unable to load the missing lyrics queue.',
  QUEUE_INVALID: 'The missing lyrics queue response was invalid.',
  SAVE_FAILED: 'Unable to save verified lyrics.',
  SAVE_INVALID: 'The save response was invalid.',
  IMPORT_FAILED: 'Unable to import lyrics.',
  IMPORT_INVALID: 'The import response was invalid.',
  EMPTY_FILE: 'Choose a file first.',
  BAD_FILE_TYPE: 'Only .txt and .lrc lyric files are allowed.',
  BAD_BULK_FILE_TYPE: 'Only .csv and .json import files are allowed.',
  FILE_TOO_LARGE: 'That file is too large.',
  TEXT_TOO_LONG: 'Lyrics are too long.',
  PASTE_FAILED: 'That file could not be read as UTF-8 text.',
  NO_FILE_SELECTED: 'Select at least one file.',
});

export function lyricsSongPath(songId) {
  return `${ADMIN_MISSING_LYRICS_PATH}/${songId}`;
}

export function getFileExtension(fileName) {
  if (typeof fileName !== 'string') return '';
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return trimmed.slice(dotIndex).toLowerCase();
}

export function buildMissingLyricsPath({ q, language, missing, page, limit } = {}) {
  const params = [];
  const push = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    params.push(`${key}=${encodeURIComponent(value)}`);
  };
  push('q', typeof q === 'string' ? q.trim() : '');
  push('language', language);
  push('missing', typeof missing === 'boolean' ? (missing ? '1' : '0') : '');
  push('page', Number.isInteger(page) && page > 1 ? String(page) : '');
  push('limit', Number.isInteger(limit) && limit > 0 ? String(limit) : '');
  if (params.length === 0) return ADMIN_MISSING_LYRICS_PATH;
  return `${ADMIN_MISSING_LYRICS_PATH}?${params.join('&')}`;
}

export function detectLyricsFormat(text) {
  return typeof text === 'string' && /\[(\d{2}):(\d{2})\.(\d{2,3})\]/.test(text) ? 'lrc' : 'plain';
}

export function validateLyricsFileSelection({ name, size, type } = {}) {
  const extension = getFileExtension(name);
  if (!LYRICS_FILE_EXTENSIONS.includes(extension)) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.BAD_FILE_TYPE };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.EMPTY_FILE };
  }
  if (size > MAX_LYRICS_FILE_BYTES) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.FILE_TOO_LARGE };
  }
  if (type && type !== 'application/octet-stream' && !/^text\//i.test(type)) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.PASTE_FAILED };
  }
  return { ok: true, extension };
}

export function validateBulkFileSelection({ name, size } = {}) {
  const extension = getFileExtension(name);
  if (!BULK_IMPORT_FILE_EXTENSIONS.includes(extension)) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.BAD_BULK_FILE_TYPE };
  }
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.EMPTY_FILE };
  }
  if (size > MAX_BULK_IMPORT_BYTES) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.FILE_TOO_LARGE };
  }
  return { ok: true, extension };
}

export function validateLyricsDraft({ lyrics, format } = {}) {
  const text = typeof lyrics === 'string' ? lyrics.replace(/\r\n?/g, '\n').trim() : '';
  if (!text) return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.EMPTY_FILE };
  if (text.length > MAX_LYRICS_TEXT_LENGTH) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.TEXT_TOO_LONG };
  }
  const resolvedFormat = format === 'lrc' || format === 'plain' ? format : detectLyricsFormat(text);
  return { ok: true, text, format: resolvedFormat };
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function normalizeMissingLyricsQueueResponse(payload) {
  const root = asRecord(payload);
  if (!root || root.success !== true) return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_FAILED };
  const data = asRecord(root.data);
  if (!data) return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_INVALID };
  if (!Array.isArray(data.rows)) return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_INVALID };
  if (!Number.isInteger(data.total) || !Number.isInteger(data.page) || !Number.isInteger(data.limit)) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_INVALID };
  }
  if (data.rows.length > data.limit) return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_INVALID };

  const rows = data.rows.map((row) => {
    const record = asRecord(row) || {};
    return {
      songId: typeof record.songId === 'string' ? record.songId : '',
      title: typeof record.title === 'string' ? record.title : '',
      artist: typeof record.artist === 'string' ? record.artist : '',
      album: typeof record.album === 'string' ? record.album : '',
      duration: typeof record.duration === 'string' ? record.duration : '',
      language: typeof record.language === 'string' ? record.language : '',
      lyricsLanguage: typeof record.lyricsLanguage === 'string' ? record.lyricsLanguage : '',
      regionalTag: typeof record.regionalTag === 'string' ? record.regionalTag : '',
      lyricsStatus: record.lyricsStatus === 'verified' || record.lyricsStatus === 'legacy'
        ? record.lyricsStatus
        : 'missing',
      source: typeof record.source === 'string' ? record.source : '',
      lrclibStatus: record.lrclibStatus === 'stored' ? 'stored' : 'not-stored',
      sourceUrl: typeof record.sourceUrl === 'string' ? record.sourceUrl : '',
      sourceCandidate: asRecord(record.sourceCandidate),
    };
  });

  return {
    ok: true,
    data: {
      state: data.state === 'empty' ? 'empty' : 'ready',
      q: typeof data.q === 'string' ? data.q : '',
      language: typeof data.language === 'string' ? data.language : '',
      missing: data.missing !== false,
      page: data.page,
      limit: data.limit,
      total: data.total,
      pages: Number.isInteger(data.pages) && data.pages > 0 ? data.pages : 1,
      rows,
    },
  };
}

export function normalizeAdminLyricsSaveResponse(payload) {
  const root = asRecord(payload);
  if (!root || root.success !== true) return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.SAVE_FAILED };
  const data = asRecord(root.data);
  if (!data || data.saved !== true || typeof data.songId !== 'string') {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.SAVE_INVALID };
  }
  return {
    ok: true,
    data: {
      songId: data.songId,
      replaced: data.replaced === true,
      format: data.format === 'lrc' ? 'lrc' : 'plain',
      lyricsVerified: data.lyricsVerified === true,
      lyricsSource: typeof data.lyricsSource === 'string' ? data.lyricsSource : '',
      presentation: asRecord(data.presentation),
    },
  };
}

export function normalizeBulkImportResponse(payload) {
  const root = asRecord(payload);
  if (!root || root.success !== true) return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.IMPORT_FAILED };
  const data = asRecord(root.data);
  const counts = asRecord(data?.counts);
  if (!data || !counts) return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.IMPORT_INVALID };
  const readCount = (key) => (Number.isInteger(counts[key]) && counts[key] >= 0 ? counts[key] : null);
  const normalized = {
    imported: readCount('imported'),
    rejected: readCount('rejected'),
    duplicate: readCount('duplicate'),
    invalid: readCount('invalid'),
    total: readCount('total'),
  };
  if (Object.values(normalized).some((value) => value === null)) {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.IMPORT_INVALID };
  }
  return {
    ok: true,
    data: {
      state: 'ready',
      format: data.format === 'csv' ? 'csv' : 'json',
      counts: normalized,
      invalid: Array.isArray(data.invalid) ? data.invalid : [],
      rejected: Array.isArray(data.rejected) ? data.rejected : [],
      importedSongIds: Array.isArray(data.importedSongIds) ? data.importedSongIds : [],
    },
  };
}

export function mapAdminLyricsError(payload, fallback) {
  const root = asRecord(payload);
  if (root && typeof root.error === 'string' && root.error.trim()) return root.error.trim();
  return fallback;
}

async function resolveApiClient(apiClient) {
  if (apiClient) return apiClient;
  const module = await import('../api/client.js');
  return module.api;
}

export async function fetchMissingLyricsQueue(params, apiClient) {
  try {
    const client = await resolveApiClient(apiClient);
    const payload = await client.get(buildMissingLyricsPath(params));
    return normalizeMissingLyricsQueueResponse(payload);
  } catch {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_FAILED };
  }
}

export async function saveVerifiedLyrics(songId, body, apiClient) {
  try {
    const client = await resolveApiClient(apiClient);
    const payload = await client.post(lyricsSongPath(songId), body);
    const normalized = normalizeAdminLyricsSaveResponse(payload);
    if (normalized.ok) return normalized;
    return { ok: false, error: mapAdminLyricsError(payload, normalized.error) };
  } catch {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.SAVE_FAILED };
  }
}

export async function importVerifiedLyrics(body, apiClient) {
  try {
    const client = await resolveApiClient(apiClient);
    const payload = await client.post(ADMIN_LYRICS_IMPORT_PATH, body);
    const normalized = normalizeBulkImportResponse(payload);
    if (normalized.ok) return normalized;
    return { ok: false, error: mapAdminLyricsError(payload, normalized.error) };
  } catch {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.IMPORT_FAILED };
  }
}

export async function findSongLyricsSources(songId, apiClient) {
  try {
    const client = await resolveApiClient(apiClient);
    const payload = await client.get(`/api/lyrics/${encodeURIComponent(songId)}/sources?refresh=1`);
    if (payload && payload.success === true && Array.isArray(payload.candidates)) {
      return { ok: true, candidates: payload.candidates };
    }
    return { ok: false, error: mapAdminLyricsError(payload, ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_FAILED) };
  } catch {
    return { ok: false, error: ADMIN_MISSING_LYRICS_MESSAGES.QUEUE_FAILED };
  }
}
