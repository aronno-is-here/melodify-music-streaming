import { normalizeLyricsText, MAX_LYRICS_TEXT_LENGTH, LYRICS_TEXT_ERROR_MESSAGES } from './lyricsTextImport.js';

export const MAX_BULK_LYRICS_ENTRIES = 500;
export const MAX_BULK_IMPORT_BYTES = 786432;
export const MAX_BULK_LYRICS_FILE_NAME_LENGTH = 255;
export const MAX_BULK_SOURCE_URL_LENGTH = 1024;
export const MAX_BULK_SONG_ID_LENGTH = 64;
export const MAX_BULK_TEXT_FIELD_LENGTH = 512;
export const MAX_BULK_NOTES_LENGTH = 1000;

export const BULK_IMPORT_FIELDS = Object.freeze([
  'songId',
  'title',
  'artist',
  'language',
  'lyrics',
  'sourceUrl',
  'sourceProvider',
  'notes',
]);

export const BULK_IMPORT_FORMATS = Object.freeze(['csv', 'json']);

export const BULK_IMPORT_ERROR_MESSAGES = Object.freeze({
  EMPTY_FILE: 'Import file is required',
  FILE_TOO_LARGE: `Import file must be at most ${MAX_BULK_IMPORT_BYTES} bytes`,
  INVALID_ENCODING: 'Import file must be UTF-8 text',
  TOO_MANY_ENTRIES: `Import file must contain at most ${MAX_BULK_LYRICS_ENTRIES} entries`,
  INVALID_FORMAT: 'Import file must be CSV or JSON',
  MISSING_HEADER: 'CSV file must include a songId column',
  MALFORMED_CSV: 'CSV file could not be parsed',
  MALFORMED_JSON: 'JSON file could not be parsed',
  MISSING_ENTRIES: 'Import file must contain at least one entry',
  ENTRY_INVALID: 'Import entry is invalid',
  UNKNOWN_SONG_ID: 'songId does not match a Melodify song',
});

export const BULK_IMPORT_REJECTION_REASONS = Object.freeze({
  NOT_AN_OBJECT: 'entry is not an object',
  MISSING_SONG_ID: 'songId is required',
  INVALID_SONG_ID: 'songId is invalid',
  MISSING_LYRICS: 'lyrics are required',
  INVALID_LYRICS: 'lyrics are invalid',
  INVALID_LANGUAGE: 'language is invalid',
  INVALID_SOURCE_URL: 'sourceUrl is invalid',
  INVALID_TEXT_FIELD: 'a text field is invalid',
  INVALID_FORMAT: 'entry format is invalid',
});

export function normalizeLyricsSourceUrl(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_BULK_SOURCE_URL_LENGTH) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function detectBulkImportFormat(fileName) {
  if (typeof fileName !== 'string') return null;
  const dotIndex = fileName.trim().lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const extension = fileName.trim().slice(dotIndex).toLowerCase();
  if (extension === '.csv') return 'csv';
  if (extension === '.json') return 'json';
  return null;
}

export function parseCsvRows(text) {
  const source = typeof text === 'string' ? text : '';
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        inQuotes = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }
    if (char === '"' && field === '') {
      inQuotes = true;
      index += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      index += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (inQuotes) return null;
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function parseBulkCsv(text) {
  const normalized = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
  const rows = parseCsvRows(normalized);
  if (!rows) return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.MALFORMED_CSV };

  const nonEmptyRows = rows.filter((row) => row.some((cell) => cell.trim() !== ''));
  if (nonEmptyRows.length === 0) {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.MISSING_ENTRIES };
  }

  const header = nonEmptyRows[0].map((cell) => cell.trim());
  const songIdColumn = header.findIndex((cell) => cell.toLowerCase() === 'songid');
  if (songIdColumn === -1) {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.MISSING_HEADER };
  }

  const entries = nonEmptyRows.slice(1).map((row) => {
    const entry = {};
    header.forEach((key, columnIndex) => {
      const value = row[columnIndex];
      if (value === undefined) return;
      const normalizedKey = BULK_IMPORT_FIELDS.find((field) => field.toLowerCase() === key.toLowerCase());
      if (!normalizedKey) return;
      entry[normalizedKey] = value;
    });
    return entry;
  });

  if (entries.length === 0) {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.MISSING_ENTRIES };
  }
  return { ok: true, entries };
}

export function parseBulkJson(text) {
  const normalized = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.MALFORMED_JSON };
  }

  let entries = parsed;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray(parsed.entries)) {
    entries = parsed.entries;
  }

  if (!Array.isArray(entries)) {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.MALFORMED_JSON };
  }
  if (entries.length === 0) {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.MISSING_ENTRIES };
  }
  return { ok: true, entries };
}

export function validateBulkEntries(rawEntries) {
  const entries = [];
  const invalid = [];

  rawEntries.forEach((rawEntry, index) => {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      invalid.push({ index, reason: BULK_IMPORT_REJECTION_REASONS.NOT_AN_OBJECT });
      return;
    }

    const songId = typeof rawEntry.songId === 'string' ? rawEntry.songId.trim() : '';
    if (!songId) {
      invalid.push({ index, reason: BULK_IMPORT_REJECTION_REASONS.MISSING_SONG_ID });
      return;
    }
    if (songId.length > MAX_BULK_SONG_ID_LENGTH || !/^[a-zA-Z0-9_-]+$/.test(songId)) {
      invalid.push({ index, reason: BULK_IMPORT_REJECTION_REASONS.INVALID_SONG_ID });
      return;
    }

    const lyrics = normalizeLyricsText(rawEntry.lyrics);
    if (!lyrics) {
      invalid.push({ index, reason: BULK_IMPORT_REJECTION_REASONS.MISSING_LYRICS });
      return;
    }
    if (lyrics.length > MAX_LYRICS_TEXT_LENGTH) {
      invalid.push({ index, reason: BULK_IMPORT_REJECTION_REASONS.INVALID_LYRICS });
      return;
    }

    const language = normalizeOptionalBounded(rawEntry.language, MAX_BULK_TEXT_FIELD_LENGTH);
    if (language === null) {
      invalid.push({ index, reason: BULK_IMPORT_REJECTION_REASONS.INVALID_LANGUAGE });
      return;
    }

    const sourceUrl = normalizeLyricsSourceUrl(rawEntry.sourceUrl);
    if (sourceUrl === null) {
      invalid.push({ index, reason: BULK_IMPORT_REJECTION_REASONS.INVALID_SOURCE_URL });
      return;
    }

    const title = normalizeOptionalBounded(rawEntry.title, MAX_BULK_TEXT_FIELD_LENGTH);
    const artist = normalizeOptionalBounded(rawEntry.artist, MAX_BULK_TEXT_FIELD_LENGTH);
    const sourceProvider = normalizeOptionalBounded(rawEntry.sourceProvider, MAX_BULK_TEXT_FIELD_LENGTH);
    const notes = normalizeOptionalBounded(rawEntry.notes, MAX_BULK_NOTES_LENGTH);
    if (title === null || artist === null || sourceProvider === null || notes === null) {
      invalid.push({ index, reason: BULK_IMPORT_REJECTION_REASONS.INVALID_TEXT_FIELD });
      return;
    }

    entries.push({
      index,
      songId,
      lyrics,
      title,
      artist,
      language,
      sourceUrl,
      sourceProvider,
      notes,
    });
  });

  return { entries, invalid };
}

function normalizeOptionalBounded(value, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length > maxLength) return null;
  return trimmed;
}

export function readBoundedImportText(buffer, { maxBytes = MAX_BULK_IMPORT_BYTES } = {}) {
  if (!buffer || typeof buffer.length !== 'number') {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.EMPTY_FILE };
  }
  if (buffer.length === 0) {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.EMPTY_FILE };
  }
  if (buffer.length > maxBytes) {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.FILE_TOO_LARGE };
  }
  const text = buffer.toString('utf8');
  if (text.includes('\uFFFD')) {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.INVALID_ENCODING };
  }
  return { ok: true, text: text.replace(/\r\n?/g, '\n') };
}

export function parseBulkImport({ text, fileName, format } = {}) {
  const resolvedFormat = BULK_IMPORT_FORMATS.includes(format) ? format : detectBulkImportFormat(fileName);
  if (!resolvedFormat) return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.INVALID_FORMAT };

  const normalized = typeof text === 'string' ? text.replace(/\r\n?/g, '\n') : '';
  if (!normalized.trim()) return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.EMPTY_FILE };

  const parsed = resolvedFormat === 'csv' ? parseBulkCsv(normalized) : parseBulkJson(normalized);
  if (!parsed.ok) return parsed;

  if (parsed.entries.length > MAX_BULK_LYRICS_ENTRIES) {
    return { ok: false, error: BULK_IMPORT_ERROR_MESSAGES.TOO_MANY_ENTRIES };
  }

  const validated = validateBulkEntries(parsed.entries);
  return { ok: true, format: resolvedFormat, ...validated };
}

export { LYRICS_TEXT_ERROR_MESSAGES, MAX_LYRICS_TEXT_LENGTH };
