import { parseLrc } from '../services/lyricsProviderService.js';

export const MAX_LYRICS_TEXT_LENGTH = 100000;
export const MAX_LYRICS_FILE_BYTES = 262144;
export const LYRICS_FILE_EXTENSIONS = Object.freeze(['.txt', '.lrc']);
export const LYRICS_TEXT_FORMATS = Object.freeze(['plain', 'lrc']);
export const LYRICS_TEXT_ERROR_MESSAGES = Object.freeze({
  EMPTY: 'Lyrics text is required',
  TOO_LONG: `Lyrics text must be at most ${MAX_LYRICS_TEXT_LENGTH} characters`,
  FILE_TOO_LARGE: `Lyrics file must be at most ${MAX_LYRICS_FILE_BYTES} bytes`,
  BAD_EXTENSION: 'Lyrics files must be .txt or .lrc',
  INVALID_ENCODING: 'Lyrics file must be UTF-8 text',
  NO_TIMESTAMPS: 'LRC lyrics must contain at least one [mm:ss.xx] timestamp',
  MALFORMED: 'LRC lyrics contain an invalid timestamp',
});

const TIMESTAMP_TAG = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
const BRACKET_TOKEN = /\[[^\]]*\]/g;
const STRICT_TIME_TAG = /^(\d{2}):([0-5]\d)\.(\d{2,3})$/;

export function normalizeNewlines(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\r\n?/g, '\n');
}

export function normalizeLyricsText(text) {
  if (typeof text !== 'string') return '';
  const lines = normalizeNewlines(text).split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end).join('\n').trim();
}

export function getFileExtension(fileName) {
  if (typeof fileName !== 'string') return '';
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  if (dotIndex <= 0) return '';
  return trimmed.slice(dotIndex).toLowerCase();
}

export function isAllowedLyricsFile(fileName) {
  return LYRICS_FILE_EXTENSIONS.includes(getFileExtension(fileName));
}

export function detectLyricsFormat(text) {
  return TIMESTAMP_TAG.test(normalizeLyricsText(text)) ? 'lrc' : 'plain';
}

export function validateLyricsText(text, { format, fileName } = {}) {
  const normalized = normalizeLyricsText(text);
  if (!normalized) return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.EMPTY };
  if (normalized.length > MAX_LYRICS_TEXT_LENGTH) {
    return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.TOO_LONG };
  }
  if (Buffer.byteLength(normalized, 'utf8') > MAX_LYRICS_FILE_BYTES) {
    return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.FILE_TOO_LARGE };
  }
  if (fileName !== undefined && !isAllowedLyricsFile(fileName)) {
    return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.BAD_EXTENSION };
  }
  const resolvedFormat = LYRICS_TEXT_FORMATS.includes(format) ? format : detectLyricsFormat(normalized);
  if (resolvedFormat === 'lrc') {
    const strict = validateLrcStrict(normalized);
    if (!strict.ok) return strict;
    return { ok: true, text: normalized, format: 'lrc', lines: strict.lines };
  }
  return { ok: true, text: normalized, format: 'plain', lines: null };
}

export function validateLrcStrict(text) {
  const normalized = normalizeLyricsText(text);
  if (!normalized) return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.EMPTY };

  const rows = normalized.split('\n');
  let timestampCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.startsWith('[') && !row.includes(']')) {
      return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.MALFORMED, line: index + 1 };
    }
    const tokens = row.match(BRACKET_TOKEN);
    if (!tokens) continue;

    for (const token of tokens) {
      const content = token.slice(1, -1);
      if (!content) {
        if (row.startsWith('[')) {
          return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.MALFORMED, line: index + 1 };
        }
        continue;
      }
      if (content[0] < '0' || content[0] > '9' || !content.includes(':')) continue;
      if (!STRICT_TIME_TAG.test(content)) {
        return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.MALFORMED, line: index + 1 };
      }
      timestampCount += 1;
    }
  }

  if (timestampCount === 0) {
    return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.NO_TIMESTAMPS };
  }

  const lines = parseLrc(normalized);
  if (lines.length === 0) return { ok: false, error: LYRICS_TEXT_ERROR_MESSAGES.NO_TIMESTAMPS };
  return { ok: true, lines };
}
