import express from 'express';
import Song from '../models/Song.js';
import { protect, adminOnly } from '../middleware/auth.js';
import {
  normalizeChordReferenceUrl,
  selectChordApiStatus,
  selectChordPresentation,
} from '../utils/chordProvider.js';
import {
  CHORD_FORMATS,
  CHORD_IMPORT_MAX_BATCH,
  CHORD_SOURCE_OPTIONS,
  MAX_CHORD_NOTES_LENGTH,
  MAX_CHORD_TEXT_LENGTH,
  MAX_CHORD_TUNING_LENGTH,
  MAX_CHORD_VERIFIED_BY_LENGTH,
  detectChordFormat,
  normalizeChordTimeline,
  parseCapo,
  parseChordKey,
  validateChordText,
} from '../../client/src/utils/chordSheet.js';

const router = express.Router();

const CHORDS_ROUTE_ERROR = 'failed to load chords';
const CHORDS_IMPORT_ERROR = 'failed to import chords';
const SONG_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const IMPORT_ENTRY_KEYS = new Set([
  'songId',
  'text',
  'format',
  'key',
  'capo',
  'tuning',
  'notes',
  'verified',
  'timeline',
  'source',
  'sourceUrl',
  'verifiedBy',
]);

export const CHORD_BULK_MAX_BATCH = 200;
const BULK_QUERY_KEYS = new Set(['replaceVerified']);
const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/;

const toBoundedString = (value, maxLength) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > maxLength) return null;
  return trimmed;
};

export const buildChordPayload = (songLike) => {
  const song = songLike && typeof songLike === 'object' ? songLike : {};
  const presentation = selectChordPresentation(song);
  const text = typeof song.chords === 'string' ? song.chords : '';
  const declaredFormat = typeof song.chords_format === 'string' ? song.chords_format : null;
  const key = parseChordKey(song.chords_key === undefined ? null : song.chords_key);
  const capo = parseCapo(song.chords_capo === undefined ? null : song.chords_capo);
  const timeline = normalizeChordTimeline(song.chord_timeline === undefined ? null : song.chord_timeline);
  const referenceUrl = normalizeChordReferenceUrl(song.chords_reference_url);
  const sourceUrl = referenceUrl || presentation.chordifyUrl || null;
  return {
    success: true,
    status: selectChordApiStatus(song),
    text,
    format: CHORD_FORMATS.includes(declaredFormat) ? declaredFormat : (text ? detectChordFormat(text) : null),
    key: key.ok ? key.key : null,
    capo: capo.ok ? capo.capo : null,
    tuning: toBoundedString(song.chords_tuning, MAX_CHORD_TUNING_LENGTH) || null,
    timeline: timeline.ok && timeline.entries.length > 0 ? timeline.entries : null,
    source: toBoundedString(song.chords_source, 64) || null,
    sourceUrl,
    verified: song.chords_verified === true,
  };
};

const normalizeChordImportEntry = (raw) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'Invalid chord import entry' };
  }
  for (const field of Object.keys(raw)) {
    if (!IMPORT_ENTRY_KEYS.has(field)) return { error: 'Unknown chord import field' };
  }
  const songId = typeof raw.songId === 'string' ? raw.songId : '';
  if (!SONG_ID_PATTERN.test(songId)) return { error: 'Invalid chord song id' };
  const text = typeof raw.text === 'string' ? raw.text : '';
  if (text.length > MAX_CHORD_TEXT_LENGTH) return { error: 'Invalid chords value' };
  let format = raw.format === undefined || raw.format === null || raw.format === '' ? null : raw.format;
  if (format !== null && !CHORD_FORMATS.includes(format)) return { error: 'Invalid chords format' };
  if (!format) format = detectChordFormat(text);
  if (text) {
    const sheetCheck = validateChordText(text, format);
    if (!sheetCheck.ok) return { error: 'Invalid chords sheet' };
  }
  const key = parseChordKey(raw.key === undefined ? null : raw.key);
  if (!key.ok) return { error: 'Invalid chords key' };
  const capo = parseCapo(raw.capo === undefined ? null : raw.capo);
  if (!capo.ok) return { error: 'Invalid chords capo' };
  const tuning = toBoundedString(raw.tuning, MAX_CHORD_TUNING_LENGTH);
  if (tuning === null) return { error: 'Invalid chords tuning' };
  const notes = toBoundedString(raw.notes, MAX_CHORD_NOTES_LENGTH);
  if (notes === null) return { error: 'Invalid chords notes' };
  const verifiedBy = toBoundedString(raw.verifiedBy, MAX_CHORD_VERIFIED_BY_LENGTH);
  if (verifiedBy === null) return { error: 'Invalid chords verifier' };
  const verifiedProvided = raw.verified !== undefined && raw.verified !== null;
  if (verifiedProvided && typeof raw.verified !== 'boolean') {
    return { error: 'Invalid chords verification flag' };
  }
  const timeline = normalizeChordTimeline(raw.timeline === undefined ? null : raw.timeline);
  if (!timeline.ok) return { error: 'Invalid chord timeline' };
  const sourceProvided = raw.source !== undefined && raw.source !== null && raw.source !== '';
  if (sourceProvided && !CHORD_SOURCE_OPTIONS.includes(raw.source)) return { error: 'Invalid chords source' };
  let sourceUrl = null;
  if (raw.sourceUrl !== undefined && raw.sourceUrl !== null && raw.sourceUrl !== '') {
    sourceUrl = normalizeChordReferenceUrl(raw.sourceUrl);
    if (!sourceUrl) return { error: 'Invalid chord source URL' };
  }
  return {
    entry: {
      songId,
      text,
      format,
      key: key.key,
      capo: capo.capo,
      tuning,
      notes,
      verifiedBy,
      verified: raw.verified === true,
      verifiedProvided,
      timeline: timeline.entries,
      source: sourceProvided ? raw.source : null,
      sourceUrl,
    },
  };
};

export const parseChordImportPayload = (payload) => {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'Invalid chord import payload' };
  }
  for (const field of Object.keys(payload)) {
    if (field !== 'songs') return { ok: false, error: 'Unknown chord import field' };
  }
  const songs = payload.songs;
  if (!Array.isArray(songs) || songs.length === 0 || songs.length > CHORD_IMPORT_MAX_BATCH) {
    return { ok: false, error: 'Invalid chord import batch' };
  }
  const entries = [];
  for (const raw of songs) {
    const normalized = normalizeChordImportEntry(raw);
    if (normalized.error) return { ok: false, error: normalized.error };
    entries.push(normalized.entry);
  }
  return { ok: true, error: null, entries };
};

export const parseChordBulkQuery = (query) => {
  const source = query && typeof query === 'object' && !Array.isArray(query) ? query : {};
  for (const key of Object.keys(source)) {
    if (!BULK_QUERY_KEYS.has(key)) return { ok: false, error: 'Invalid chord bulk query' };
    const value = source[key];
    if (typeof value !== 'string' || (value !== 'true' && value !== 'false')) {
      return { ok: false, error: 'Invalid chord bulk query' };
    }
  }
  return { ok: true, error: null, replaceVerified: source.replaceVerified === 'true' };
};

const mapChordBulkEntry = (raw) => {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const hasChords = Object.prototype.hasOwnProperty.call(raw, 'chords');
  const hasText = Object.prototype.hasOwnProperty.call(raw, 'text');
  if (hasChords && hasText) return null;
  if (hasChords) {
    const mapped = { ...raw };
    delete mapped.chords;
    mapped.text = raw.chords;
    return mapped;
  }
  return { ...raw };
};

export const parseChordBulkPayload = (payload) => {
  if (!Array.isArray(payload) || payload.length === 0 || payload.length > CHORD_BULK_MAX_BATCH) {
    return { ok: false, error: 'Invalid chord bulk batch', requested: 0, counts: null, entries: null };
  }
  const counts = { imported: 0, rejected: 0, duplicate: 0, invalid: 0 };
  const entries = [];
  const seen = new Set();
  for (const raw of payload) {
    const mapped = mapChordBulkEntry(raw);
    if (!mapped) {
      counts.invalid += 1;
      continue;
    }
    const normalized = normalizeChordImportEntry(mapped);
    if (normalized.error) {
      counts.invalid += 1;
      continue;
    }
    const entry = normalized.entry;
    if (!('text' in mapped) || entry.text.trim().length === 0) {
      counts.invalid += 1;
      continue;
    }
    if (HTML_TAG_PATTERN.test(entry.text) || HTML_TAG_PATTERN.test(entry.notes)) {
      counts.invalid += 1;
      continue;
    }
    if (seen.has(entry.songId)) {
      counts.duplicate += 1;
      continue;
    }
    seen.add(entry.songId);
    entries.push(entry);
  }
  return { ok: true, error: null, requested: payload.length, counts, entries };
};

router.post('/import', protect, adminOnly, async (req, res) => {
  try {
    const parsed = parseChordImportPayload(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }

    const uniqueIds = [...new Set(parsed.entries.map((entry) => entry.songId))];
    const songs = await Song.find({ _id: { $in: uniqueIds } }).select('_id');
    if (songs.length !== uniqueIds.length) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }

    for (const entry of parsed.entries) {
      const update = {
        chords: entry.text,
        chords_format: entry.format,
        chords_key: entry.key,
        chords_capo: entry.capo,
        chords_tuning: entry.tuning,
        chords_notes: entry.notes,
        chords_verified_by: entry.verifiedBy,
        chord_timeline: entry.timeline,
        chords_last_checked_at: new Date(),
      };
      if (entry.verifiedProvided) update.chords_verified = entry.verified;
      if (entry.source) update.chords_source = entry.source;
      if (entry.sourceUrl) update.chords_reference_url = entry.sourceUrl;
      await Song.findByIdAndUpdate(entry.songId, update, { runValidators: true });
    }

    return res.json({ success: true, requested: parsed.entries.length, updated: parsed.entries.length });
  } catch {
    return res.status(500).json({ success: false, error: CHORDS_IMPORT_ERROR });
  }
});

router.post('/bulk', protect, adminOnly, async (req, res) => {
  try {
    const query = parseChordBulkQuery(req.query);
    if (!query.ok) {
      return res.status(400).json({ success: false, error: query.error });
    }
    const parsed = parseChordBulkPayload(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ success: false, error: parsed.error });
    }
    const { counts, entries } = parsed;
    if (entries.length > 0) {
      const songIds = entries.map((entry) => entry.songId);
      const songs = await Song.find({ _id: { $in: songIds } }).select('_id chords_verified');
      const verifiedById = new Map(songs.map((song) => [String(song._id), song.chords_verified === true]));
      for (const entry of entries) {
        if (!verifiedById.has(entry.songId)) {
          counts.rejected += 1;
          continue;
        }
        if (verifiedById.get(entry.songId) && !query.replaceVerified) {
          counts.rejected += 1;
          continue;
        }
        const update = {
          chords: entry.text,
          chords_format: entry.format,
          chords_key: entry.key,
          chords_capo: entry.capo,
          chords_tuning: entry.tuning,
          chords_notes: entry.notes,
          chords_verified_by: entry.verifiedBy,
          chord_timeline: entry.timeline,
          chords_last_checked_at: new Date(),
        };
        if (entry.verifiedProvided) update.chords_verified = entry.verified;
        if (entry.source) update.chords_source = entry.source;
        if (entry.sourceUrl) update.chords_reference_url = entry.sourceUrl;
        const updated = await Song.findByIdAndUpdate(entry.songId, update, { runValidators: true });
        if (updated) counts.imported += 1;
        else counts.rejected += 1;
      }
    }
    return res.json({
      success: true,
      requested: parsed.requested,
      imported: counts.imported,
      rejected: counts.rejected,
      duplicate: counts.duplicate,
      invalid: counts.invalid,
    });
  } catch {
    return res.status(500).json({ success: false, error: CHORDS_IMPORT_ERROR });
  }
});

router.get('/:songId', async (req, res) => {
  try {
    const songId = typeof req.params.songId === 'string' ? req.params.songId : '';
    if (!SONG_ID_PATTERN.test(songId)) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }
    const song = await Song.findById(songId);
    if (!song) {
      return res.status(404).json({ success: false, error: 'Song not found' });
    }
    return res.json(buildChordPayload(song));
  } catch {
    return res.status(500).json({ success: false, error: CHORDS_ROUTE_ERROR });
  }
});

export default router;
