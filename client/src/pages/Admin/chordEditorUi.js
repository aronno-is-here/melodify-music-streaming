import {
  CHORD_FORMATS,
  formatChordTime,
  normalizeChordTimeline,
  validateChordText,
} from '../../utils/chordSheet.js';

export const CHORD_EDITOR_STATES = Object.freeze({
  EMPTY: 'empty',
  FILE_SELECTED: 'file-selected',
  PARSING: 'parsing',
  PREVIEW_READY: 'preview-ready',
  SAVING: 'saving',
  SUCCESS: 'success',
  ERROR: 'error',
});

export const CHORD_EDITOR_STATE_LABELS = Object.freeze({
  empty: 'No chord draft',
  'file-selected': 'Chord draft loaded',
  parsing: 'Parsing chord file…',
  'preview-ready': 'Preview ready',
  saving: 'Saving chords…',
  success: 'Chords saved.',
  error: 'Chord draft needs attention',
});

export const CHORD_LIST_STATUSES = Object.freeze(['Verified', 'Unverified', 'Missing']);

export function hasChordContent(song) {
  const text = song && typeof song.chords === 'string' ? song.chords.trim() : '';
  if (text) return true;
  const timeline = song ? song.chord_timeline : null;
  return Array.isArray(timeline) && timeline.length > 0;
}

export function selectChordListStatus(song) {
  if (!hasChordContent(song)) return 'Missing';
  return song.chords_verified === true ? 'Verified' : 'Unverified';
}

export function evaluateChordDraftSave({ text, format, timelineText } = {}) {
  const sheet = typeof text === 'string' ? text : '';
  const resolvedFormat = CHORD_FORMATS.includes(format) ? format : 'plain';
  const trimmedTimeline = typeof timelineText === 'string' ? timelineText.trim() : '';
  let timeline = [];
  if (trimmedTimeline) {
    try {
      const parsed = JSON.parse(trimmedTimeline);
      if (!Array.isArray(parsed)) {
        return { ok: false, error: 'Chord timeline must be a JSON array.', timeline: [], format: resolvedFormat };
      }
      timeline = parsed;
    } catch {
      return { ok: false, error: 'Chord timeline must be a JSON array.', timeline: [], format: resolvedFormat };
    }
  }
  if (sheet.trim()) {
    const check = validateChordText(sheet, resolvedFormat);
    if (!check.ok) return { ok: false, error: check.error, timeline, format: resolvedFormat };
  }
  if (!sheet.trim() && timeline.length === 0) {
    return { ok: false, error: 'Add chord text or a timeline before saving.', timeline, format: resolvedFormat };
  }
  return { ok: true, error: null, timeline, format: resolvedFormat };
}

export function buildChordPreview({ text, timeline } = {}) {
  const normalized = normalizeChordTimeline(Array.isArray(timeline) ? timeline : null);
  if (normalized.ok && normalized.entries.length > 0) {
    return {
      kind: 'timeline',
      lines: normalized.entries.map((entry) => `${formatChordTime(entry.time)}  ${entry.chord}`),
      text: '',
    };
  }
  const sheet = typeof text === 'string' ? text : '';
  if (sheet.trim()) {
    return { kind: 'sheet', lines: sheet.split(/\r?\n/), text: sheet };
  }
  return { kind: 'empty', lines: [], text: '' };
}
