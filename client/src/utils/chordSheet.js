export const CHORD_FORMATS = Object.freeze(['plain', 'chordpro', 'synced']);
export const CHORD_STATUSES = Object.freeze(['verified', 'available', 'unavailable', 'source-found']);
export const CHORD_SOURCE_OPTIONS = Object.freeze(['db_verified', 'chordify', 'other', 'none']);
export const CHORD_IMPORT_EXTENSIONS = Object.freeze(['cho', 'chordpro', 'txt']);
export const MAX_CHORD_TEXT_LENGTH = 100000;
export const MAX_CHORD_TOKEN_LENGTH = 32;
export const MAX_CHORD_KEY_LENGTH = 8;
export const MAX_CAPO = 12;
export const MAX_TRANSPOSE_SEMITONES = 12;
export const MAX_TIMELINE_ENTRIES = 2000;
export const MAX_TIMELINE_TIME_SECONDS = 86400;
export const MAX_TIMELINE_CHORD_LENGTH = 32;
export const CHORD_IMPORT_MAX_BYTES = 65536;
export const CHORD_IMPORT_MAX_BATCH = 25;
export const MAX_CHORD_TUNING_LENGTH = 32;
export const MAX_CHORD_NOTES_LENGTH = 1000;
export const MAX_CHORD_VERIFIED_BY_LENGTH = 128;
export const MAX_CHORD_SOURCE_LENGTH = 64;

const SHARP_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
const FLAT_NAMES = Object.freeze(['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']);

const NOTE_INDEX = Object.freeze({
  'C': 0, 'B#': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4, 'Fb': 4,
  'E#': 5, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9,
  'A#': 10, 'Bb': 10, 'B': 11, 'Cb': 11,
});

const CHORD_ROOT_PATTERN = '[A-G](?:#|b)?';
const CHORD_QUALITY_PATTERN = '[A-Za-z0-9()+#-]*';
const CHORD_TOKEN_RE = new RegExp(`^(${CHORD_ROOT_PATTERN})(${CHORD_QUALITY_PATTERN})(?:\\/(${CHORD_ROOT_PATTERN})(${CHORD_QUALITY_PATTERN}))?$`);
const SEPARATOR_TOKEN_RE = /^[-|–—.]+$/;
const MARKER_PATTERN = /\[[^\[\]\r\n]+\]/;
const SCRIPT_PATTERN = /<\s*script/i;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const spelledNote = (index, usesFlat) => {
  const wrapped = ((index % 12) + 12) % 12;
  return usesFlat ? FLAT_NAMES[wrapped] : SHARP_NAMES[wrapped];
};

export const normalizeSemitoneOffset = (value) => {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < -MAX_TRANSPOSE_SEMITONES || value > MAX_TRANSPOSE_SEMITONES) return null;
  return value;
};

export const normalizeTransposition = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  const rounded = Math.trunc(value);
  if (rounded < -MAX_TRANSPOSE_SEMITONES) return -MAX_TRANSPOSE_SEMITONES;
  if (rounded > MAX_TRANSPOSE_SEMITONES) return MAX_TRANSPOSE_SEMITONES;
  return rounded;
};

export function parseChordToken(token) {
  if (typeof token !== 'string') return null;
  const value = token.trim();
  if (!value || value.length > MAX_CHORD_TOKEN_LENGTH) return null;
  const match = CHORD_TOKEN_RE.exec(value);
  if (!match) return null;
  const rootIndex = NOTE_INDEX[match[1]];
  if (rootIndex === undefined) return null;
  const bass = match[3] || null;
  let bassIndex = null;
  if (bass) {
    bassIndex = NOTE_INDEX[bass];
    if (bassIndex === undefined) return null;
  }
  return {
    root: match[1],
    rootIndex,
    quality: match[2],
    bass,
    bassIndex,
    usesFlat: match[1].indexOf('b') !== -1,
  };
}

export function parseChordKey(value) {
  if (value === null || value === undefined) return { ok: true, key: null };
  if (typeof value !== 'string') return { ok: false, key: null };
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, key: null };
  if (trimmed.length > MAX_CHORD_KEY_LENGTH) return { ok: false, key: null };
  if (!parseChordToken(trimmed)) return { ok: false, key: null };
  return { ok: true, key: trimmed };
}

export function parseCapo(value) {
  if (value === null || value === undefined || value === '') return { ok: true, capo: null };
  if (typeof value === 'boolean') return { ok: false, capo: null };
  let numeric = value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) return { ok: false, capo: null };
    numeric = Number(trimmed);
  }
  if (typeof numeric !== 'number' || !Number.isInteger(numeric)) return { ok: false, capo: null };
  if (numeric < 0 || numeric > MAX_CAPO) return { ok: false, capo: null };
  return { ok: true, capo: numeric };
}

export function transposeChord(chord, semitones) {
  const offset = normalizeSemitoneOffset(semitones);
  if (offset === null) return null;
  const parsed = parseChordToken(chord);
  if (!parsed) return null;
  const root = spelledNote(parsed.rootIndex + offset, parsed.usesFlat);
  if (!parsed.bass) return `${root}${parsed.quality}`;
  return `${root}${parsed.quality}/${spelledNote(parsed.bassIndex + offset, parsed.usesFlat)}`;
}

export function isChordLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  const tokens = trimmed.split(/\s+/);
  let chordCount = 0;
  for (const token of tokens) {
    if (SEPARATOR_TOKEN_RE.test(token)) continue;
    if (!CHORD_TOKEN_RE.test(token)) return false;
    chordCount += 1;
  }
  return chordCount > 0;
}

const splitLineWithMarkers = (raw) => {
  const segments = [];
  let chord = null;
  let start = 0;
  let cursor = 0;
  while (cursor < raw.length) {
    if (raw[cursor] !== '[') {
      cursor += 1;
      continue;
    }
    const close = raw.indexOf(']', cursor + 1);
    if (close === -1) return { ok: false, segments: [], error: 'Chord marker is not closed' };
    const token = raw.slice(cursor + 1, close);
    if (!parseChordToken(token)) return { ok: false, segments: [], error: 'Chord marker is invalid' };
    segments.push({ chord, text: raw.slice(start, cursor) });
    chord = token.trim();
    cursor = close + 1;
    start = cursor;
  }
  segments.push({ chord, text: raw.slice(start) });
  return { ok: true, segments, error: null };
};

export function parseChordPro(text) {
  if (typeof text !== 'string') return { valid: false, error: 'Chord sheet must be text', lines: [] };
  if (text.length > MAX_CHORD_TEXT_LENGTH) return { valid: false, error: 'Chord sheet is too long', lines: [] };
  if (SCRIPT_PATTERN.test(text)) return { valid: false, error: 'Chord sheet contains disallowed markup', lines: [] };
  const lines = [];
  let markerCount = 0;
  for (const raw of text.split(/\r?\n/)) {
    const split = splitLineWithMarkers(raw);
    if (!split.ok) return { valid: false, error: split.error, lines: [] };
    for (const segment of split.segments) {
      if (segment.chord) markerCount += 1;
    }
    lines.push({ raw, segments: split.segments });
  }
  if (markerCount === 0) return { valid: false, error: 'Chord sheet has no chord markers', lines };
  return { valid: true, error: null, lines };
}

export function detectChordFormat(text) {
  if (typeof text !== 'string' || !text.trim()) return 'plain';
  if (!MARKER_PATTERN.test(text)) return 'plain';
  return parseChordPro(text).valid ? 'chordpro' : 'plain';
}

export function validateChordText(text, format = 'plain') {
  if (typeof text !== 'string') return { ok: false, error: 'Chord sheet must be text' };
  if (text.length > MAX_CHORD_TEXT_LENGTH) return { ok: false, error: 'Chord sheet is too long' };
  if (SCRIPT_PATTERN.test(text)) return { ok: false, error: 'Chord sheet contains disallowed markup' };
  if (!CHORD_FORMATS.includes(format)) return { ok: false, error: 'Invalid chord format' };
  if (format === 'plain') {
    if (!text.split(/\r?\n/).some(isChordLine)) return { ok: false, error: 'Chord sheet has no chord lines' };
    return { ok: true, error: null };
  }
  const parsed = parseChordPro(text);
  if (!parsed.valid) return { ok: false, error: parsed.error };
  return { ok: true, error: null };
}

export function transposeChordLine(line, semitones, format = 'plain') {
  if (typeof line !== 'string') return '';
  const offset = normalizeSemitoneOffset(semitones);
  if (offset === null || offset === 0) return line;
  if (format === 'chordpro' || format === 'synced') {
    return line.replace(/\[([^\[\]]*)\]/g, (match, token) => {
      const transposed = transposeChord(token, offset);
      return transposed ? `[${transposed}]` : match;
    });
  }
  if (!isChordLine(line)) return line;
  return line.split(/(\s+)/).map((part) => {
    if (!part.trim() || SEPARATOR_TOKEN_RE.test(part.trim())) return part;
    return transposeChord(part, offset) || part;
  }).join('');
}

export function transposeChordSheet(text, semitones, format = 'plain') {
  if (typeof text !== 'string') return '';
  const offset = normalizeSemitoneOffset(semitones);
  if (offset === null || offset === 0) return text;
  return text.split('\n').map((line) => transposeChordLine(line, offset, format)).join('\n');
}

export function normalizeChordTimeline(value) {
  if (value === null || value === undefined || value === '') {
    return { ok: true, entries: [], error: null };
  }
  if (!Array.isArray(value)) return { ok: false, entries: [], error: 'Chord timeline must be an array' };
  if (value.length > MAX_TIMELINE_ENTRIES) return { ok: false, entries: [], error: 'Chord timeline is too long' };
  const entries = [];
  for (const item of value) {
    if (!isPlainObject(item)) return { ok: false, entries: [], error: 'Chord timeline entries must be objects' };
    const time = item.time;
    const chord = item.chord;
    if (typeof time !== 'number' || !Number.isFinite(time) || time < 0 || time > MAX_TIMELINE_TIME_SECONDS) {
      return { ok: false, entries: [], error: 'Chord timeline time is out of range' };
    }
    if (typeof chord !== 'string' || !chord.trim() || chord.trim().length > MAX_TIMELINE_CHORD_LENGTH) {
      return { ok: false, entries: [], error: 'Chord timeline chord is invalid' };
    }
    if (SCRIPT_PATTERN.test(chord)) return { ok: false, entries: [], error: 'Chord timeline chord is invalid' };
    entries.push({ time, chord: chord.trim() });
  }
  entries.sort((a, b) => (a.time - b.time) || (a.chord < b.chord ? -1 : a.chord > b.chord ? 1 : 0));
  return { ok: true, entries, error: null };
}

export const formatChordTime = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return '0:00';
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export function findActiveChord(timeline, time) {
  if (!Array.isArray(timeline) || timeline.length === 0) return -1;
  if (typeof time !== 'number' || !Number.isFinite(time)) return -1;
  let low = 0;
  let high = timeline.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const entry = timeline[mid];
    if (entry && typeof entry.time === 'number' && entry.time <= time) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export async function readChordImportFile(file, extension) {
  const failure = (error) => ({ ok: false, error, text: '', format: 'plain' });
  if (!file || typeof file.name !== 'string' || typeof file.text !== 'function') {
    return failure('Select a chord file to import');
  }
  const requested = typeof extension === 'string' ? extension.trim().replace(/^\./, '').toLowerCase() : '';
  if (!CHORD_IMPORT_EXTENSIONS.includes(requested)) return failure('Unsupported chord file type');
  if (!file.name.toLowerCase().endsWith(`.${requested}`)) return failure('File extension does not match');
  if (typeof file.size === 'number' && file.size > CHORD_IMPORT_MAX_BYTES) return failure('Chord file is too large');
  let text = '';
  try {
    text = await file.text();
  } catch {
    return failure('Unable to read chord file');
  }
  if (text.length > MAX_CHORD_TEXT_LENGTH) return failure('Chord sheet is too long');
  const format = detectChordFormat(text);
  const check = validateChordText(text, format);
  if (!check.ok) return failure(check.error);
  return { ok: true, error: null, text, format };
}
