import {
  ADMIN_MISSING_LYRICS_MESSAGES,
  detectLyricsFormat,
  validateLyricsDraft,
} from '../../services/adminMissingLyrics.js';

export const MISSING_LYRICS_VIEWS = Object.freeze({
  LOADING: 'loading',
  ERROR: 'error',
  EMPTY: 'empty',
  READY: 'ready',
});

export const MISSING_LYRICS_MESSAGES = Object.freeze({
  LOADING: 'Loading the missing lyrics queue…',
  EMPTY: 'No songs match this filter.',
  REFRESH: 'Refresh',
  IMPORT: 'Import CSV/JSON',
  ADD_LYRICS: 'Add Lyrics',
  FIND_SOURCES: 'Find Sources',
  OPEN_SOURCE: 'Open Source',
  OPEN_SONG: 'Open Song',
  PREVIOUS: 'Previous',
  NEXT: 'Next',
  PASTE_FILE: 'Paste from file',
  REPLACE_HINT: 'Replace verified lyrics',
  SAVE: 'Save verified lyrics',
  CANCEL: 'Cancel',
  SAVED: 'Verified lyrics saved.',
  IMPORTED: 'Import complete.',
});

export const LYRICS_STATUS_LABELS = Object.freeze({
  missing: 'Missing',
  legacy: 'Unverified',
  verified: 'Verified',
});

export const LRCLIB_STATUS_LABELS = Object.freeze({
  stored: 'Stored',
  'not-stored': 'Not stored',
});

export const MISSING_LYRICS_DEFAULT_LIMIT = 20;
export const MISSING_LYRICS_PAGE_SIZE_OPTIONS = Object.freeze([10, 20, 50]);

export const LYRICS_FILE_INPUT_ACCEPT = '.txt,.lrc';
export const BULK_IMPORT_FILE_INPUT_ACCEPT = '.csv,.json';

export const ADD_LYRICS_FIELD_IDS = Object.freeze({
  title: 'add-lyrics-song',
  artist: 'add-lyrics-artist',
  language: 'add-lyrics-language',
  sourceUrl: 'add-lyrics-source-url',
  sourceProvider: 'add-lyrics-source-provider',
  lyrics: 'add-lyrics-text',
  format: 'add-lyrics-format',
  notes: 'add-lyrics-notes',
  file: 'add-lyrics-file',
  replace: 'add-lyrics-replace',
});

export function selectMissingLyricsView({ loading, error, rows, total } = {}) {
  if (loading) return MISSING_LYRICS_VIEWS.LOADING;
  if (error) return MISSING_LYRICS_VIEWS.ERROR;
  if (!Array.isArray(rows) || rows.length === 0 || !Number.isFinite(total) || total === 0) {
    return MISSING_LYRICS_VIEWS.EMPTY;
  }
  return MISSING_LYRICS_VIEWS.READY;
}

export function lyricsStatusLabel(status) {
  return LYRICS_STATUS_LABELS[status] || LYRICS_STATUS_LABELS.missing;
}

export function lrclibStatusLabel(status) {
  return LRCLIB_STATUS_LABELS[status] || LRCLIB_STATUS_LABELS['not-stored'];
}

export function formatLanguageLabel(row) {
  if (!row || typeof row !== 'object') return 'Unknown';
  const parts = [];
  if (row.regionalTag) parts.push(row.regionalTag);
  const candidate = row.lyricsLanguage || row.language;
  if (candidate && !parts.includes(candidate)) parts.push(candidate);
  if (parts.length === 0) return 'Unknown';
  return parts.join(' · ');
}

export function buildPagination(page, pages) {
  const safePages = Number.isInteger(pages) && pages > 0 ? pages : 1;
  const safePage = Number.isInteger(page) && page > 0 ? Math.min(page, safePages) : 1;
  return {
    page: safePage,
    pages: safePages,
    canPrev: safePage > 1,
    canNext: safePage < safePages,
    label: `Page ${safePage} of ${safePages}`,
    show: safePages > 1,
  };
}

export function selectAddLyricsInitialValues(row) {
  const record = row && typeof row === 'object' ? row : {};
  const candidate = record.sourceCandidate && typeof record.sourceCandidate === 'object'
    ? record.sourceCandidate
    : null;
  return {
    songId: typeof record.songId === 'string' ? record.songId : '',
    title: typeof record.title === 'string' ? record.title : '',
    artist: typeof record.artist === 'string' ? record.artist : '',
    language: typeof record.lyricsLanguage === 'string' && record.lyricsLanguage
      ? record.lyricsLanguage
      : (typeof record.language === 'string' ? record.language : ''),
    sourceUrl: candidate && typeof candidate.url === 'string' ? candidate.url : '',
    sourceProvider: candidate && typeof candidate.provider === 'string' ? candidate.provider : '',
    notes: '',
    lyrics: '',
    format: 'plain',
    replaceVerified: false,
    candidateUrl: candidate && typeof candidate.url === 'string' ? candidate.url : '',
    hasVerifiedLyrics: record.lyricsStatus === 'verified',
  };
}

export function validateAddLyricsDraft(draft) {
  const base = draft && typeof draft === 'object' ? draft : {};
  const result = validateLyricsDraft({ lyrics: base.lyrics, format: base.format });
  if (!result.ok) return { ok: false, error: result.error, format: 'plain' };
  return { ok: true, text: result.text, format: result.format, error: '' };
}

export function refreshLyricsFormat(text) {
  return detectLyricsFormat(text);
}

export function buildImportCountCards(counts) {
  const source = counts && typeof counts === 'object' ? counts : {};
  const read = (key) => (Number.isInteger(source[key]) && source[key] >= 0 ? source[key] : 0);
  return [
    { key: 'imported', label: 'Imported', value: read('imported') },
    { key: 'duplicate', label: 'Duplicate', value: read('duplicate') },
    { key: 'rejected', label: 'Rejected', value: read('rejected') },
    { key: 'invalid', label: 'Invalid', value: read('invalid') },
  ];
}

export function buildQueueRowActions(row) {
  const record = row && typeof row === 'object' ? row : {};
  const candidateUrl = record.sourceCandidate && typeof record.sourceCandidate.url === 'string'
    ? record.sourceCandidate.url
    : '';
  return {
    songId: typeof record.songId === 'string' ? record.songId : '',
    openSongHref: record.songId ? `/song/${record.songId}` : '',
    canFindSources: Boolean(record.songId),
    openSourceUrl: candidateUrl || record.sourceUrl || '',
    canOpenSource: Boolean(candidateUrl || record.sourceUrl),
    canAddLyrics: Boolean(record.songId),
    isVerified: record.lyricsStatus === 'verified',
  };
}

export { ADMIN_MISSING_LYRICS_MESSAGES };
