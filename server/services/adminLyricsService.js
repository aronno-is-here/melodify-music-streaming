import {
  buildMissingLyricsFilter,
  parseMissingLyricsQuery,
  selectMissingLyricsRow,
} from '../utils/missingLyricsQuery.js';
import {
  MAX_LYRICS_FILE_BYTES,
  MAX_LYRICS_TEXT_LENGTH,
  validateLyricsText,
} from '../utils/lyricsTextImport.js';
import {
  BULK_IMPORT_ERROR_MESSAGES,
  MAX_BULK_LYRICS_ENTRIES,
  MAX_BULK_IMPORT_BYTES,
  MAX_BULK_NOTES_LENGTH,
  MAX_BULK_SOURCE_URL_LENGTH,
  MAX_BULK_TEXT_FIELD_LENGTH,
  normalizeLyricsSourceUrl,
  parseBulkImport,
} from '../utils/bulkLyricsImport.js';
import { withScriptPresentation } from '../utils/lyricsRomanization.js';

export const ADMIN_LYRICS_VERIFIED_SOURCE = 'db_verified';
export const ADMIN_LYRICS_MATCH_STATUS = 'EXACT';
export const MAX_ADMIN_LYRICS_SONG_ID_LENGTH = 64;
export const MAX_ADMIN_LYRICS_VERIFIED_BY_LENGTH = 128;
export const MAX_ADMIN_LYRICS_LANGUAGE_LENGTH = 64;
export const MAX_ADMIN_LYRICS_PROVIDER_LENGTH = 256;
export const MAX_ADMIN_LYRICS_NOTES_LENGTH = 1000;

export const ADMIN_LYRICS_ERROR_MESSAGES = Object.freeze({
  SONG_ID_INVALID: 'Song id is invalid',
  SONG_NOT_FOUND: 'Song not found',
  VERIFIED_LYRICS_EXISTS: 'Verified lyrics already exist for this song',
  LYRICS_INVALID: 'Lyrics are invalid',
  LANGUAGE_INVALID: 'Language is invalid',
  SOURCE_URL_INVALID: 'Source URL is invalid',
  SOURCE_PROVIDER_INVALID: 'Source provider is invalid',
  NOTES_INVALID: 'Notes are invalid',
  VERIFIED_BY_INVALID: 'Verified by is invalid',
  REPLACE_INVALID: 'Replace flag is invalid',
  ENTRY_LIMIT: `Import file must contain at most ${MAX_BULK_LYRICS_ENTRIES} entries`,
  READ_FAILED: 'failed to load missing lyrics',
  SAVE_FAILED: 'failed to save verified lyrics',
  IMPORT_FAILED: 'failed to import verified lyrics',
});

export class AdminLyricsError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = 'AdminLyricsError';
    this.code = code;
    this.status = status;
  }
}

export class AdminLyricsValidationError extends AdminLyricsError {
  constructor(message, code = 'VALIDATION') {
    super(message, code, 400);
    this.name = 'AdminLyricsValidationError';
  }
}

export class AdminLyricsNotFoundError extends AdminLyricsError {
  constructor(message, code = 'NOT_FOUND') {
    super(message, code, 404);
    this.name = 'AdminLyricsNotFoundError';
  }
}

export class AdminLyricsConflictError extends AdminLyricsError {
  constructor(message, code = 'CONFLICT') {
    super(message, code, 409);
    this.name = 'AdminLyricsConflictError';
  }
}

export class AdminLyricsReadError extends AdminLyricsError {
  constructor(message, code = 'READ_FAILED') {
    super(message, code, 500);
    this.name = 'AdminLyricsReadError';
  }
}

export class AdminLyricsSaveError extends AdminLyricsError {
  constructor(message, code = 'SAVE_FAILED') {
    super(message, code, 500);
    this.name = 'AdminLyricsSaveError';
  }
}

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

export function isValidSongId(value) {
  return typeof value === 'string' && value.length <= MAX_ADMIN_LYRICS_SONG_ID_LENGTH && OBJECT_ID_PATTERN.test(value);
}

function normalizeOptional(value, maxLength, errorMessage, ErrorClass) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string') throw new ErrorClass(errorMessage);
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw new ErrorClass(errorMessage);
  return trimmed;
}

function toPresentation(text, format, lines) {
  const presentationLines = lines && lines.length > 0 ? lines : plainLines(text);
  const presentation = withScriptPresentation({ plain: text, lines: presentationLines });
  return {
    plain: text,
    synced: format === 'lrc',
    script: presentation.script,
    romanizedLines: presentation.romanizedLines,
    displayLines: presentation.displayLines,
  };
}

function plainLines(text) {
  if (typeof text !== 'string') return [];
  return text
    .split('\n')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => ({ time: null, text: row }));
}

function toSourceCandidate(record) {
  const candidate = record?.candidates?.[0];
  if (!candidate || typeof candidate.url !== 'string') return null;
  return {
    provider: candidate.provider ?? null,
    providerLabel: candidate.providerLabel ?? null,
    url: candidate.url,
    title: candidate.title ?? null,
    artist: candidate.artist ?? null,
    confidence: candidate.confidence ?? null,
  };
}

export function createAdminLyricsService({ SongModel, lyricsDiscovery } = {}) {
  if (!SongModel) throw new Error('SongModel is required');

  const peekCandidate = (song) => {
    if (!lyricsDiscovery || typeof lyricsDiscovery.peek !== 'function') return null;
    try {
      return toSourceCandidate(lyricsDiscovery.peek(song));
    } catch {
      return null;
    }
  };

  const listMissingLyrics = async (rawQuery) => {
    const parsed = parseMissingLyricsQuery(rawQuery);
    if (!parsed.ok) {
      throw new AdminLyricsValidationError(parsed.error, 'INVALID_QUERY');
    }

    const filter = buildMissingLyricsFilter(parsed);
    const skip = (parsed.page - 1) * parsed.limit;

    let total = 0;
    let docs = [];
    try {
      total = await SongModel.countDocuments(filter);
      docs = await SongModel.find(filter)
        .select('+language lyrics title artist album duration lyrics_language regional_tag lyrics_verified lyrics_source lyrics_source_url lyrics_provider_id')
        .sort({ title: 1, _id: 1 })
        .skip(skip)
        .limit(parsed.limit)
        .lean();
    } catch {
      throw new AdminLyricsReadError(ADMIN_LYRICS_ERROR_MESSAGES.READ_FAILED);
    }

    const rows = (Array.isArray(docs) ? docs : []).map((doc) => ({
      ...selectMissingLyricsRow(doc),
      sourceCandidate: peekCandidate(doc),
    }));

    const pages = Math.max(1, Math.ceil(total / parsed.limit));
    return {
      state: total === 0 ? 'empty' : 'ready',
      q: parsed.q,
      language: parsed.language,
      missing: parsed.missing,
      page: parsed.page,
      limit: parsed.limit,
      total,
      pages,
      count: rows.length,
      rows,
    };
  };

  const saveVerifiedLyrics = async (input) => {
    const {
      songId,
      lyrics,
      language,
      sourceUrl,
      sourceProvider,
      notes,
      replaceVerified,
      verifiedBy,
      format,
    } = input || {};

    if (!isValidSongId(songId)) {
      throw new AdminLyricsValidationError(ADMIN_LYRICS_ERROR_MESSAGES.SONG_ID_INVALID, 'SONG_ID_INVALID');
    }
    if (replaceVerified !== undefined && typeof replaceVerified !== 'boolean') {
      throw new AdminLyricsValidationError(ADMIN_LYRICS_ERROR_MESSAGES.REPLACE_INVALID, 'REPLACE_INVALID');
    }

    const safeLanguage = normalizeOptional(
      language,
      MAX_ADMIN_LYRICS_LANGUAGE_LENGTH,
      ADMIN_LYRICS_ERROR_MESSAGES.LANGUAGE_INVALID,
      AdminLyricsValidationError,
    );
    const safeProvider = normalizeOptional(
      sourceProvider,
      MAX_ADMIN_LYRICS_PROVIDER_LENGTH,
      ADMIN_LYRICS_ERROR_MESSAGES.SOURCE_PROVIDER_INVALID,
      AdminLyricsValidationError,
    );
    const safeNotes = normalizeOptional(
      notes,
      MAX_ADMIN_LYRICS_NOTES_LENGTH,
      ADMIN_LYRICS_ERROR_MESSAGES.NOTES_INVALID,
      AdminLyricsValidationError,
    );
    const safeVerifiedBy = normalizeOptional(
      verifiedBy,
      MAX_ADMIN_LYRICS_VERIFIED_BY_LENGTH,
      ADMIN_LYRICS_ERROR_MESSAGES.VERIFIED_BY_INVALID,
      AdminLyricsValidationError,
    );

    const safeSourceUrl = normalizeLyricsSourceUrl(sourceUrl);
    if (safeSourceUrl === null) {
      throw new AdminLyricsValidationError(ADMIN_LYRICS_ERROR_MESSAGES.SOURCE_URL_INVALID, 'SOURCE_URL_INVALID');
    }

    const validation = validateLyricsText(lyrics, {
      format: format === 'plain' || format === 'lrc' ? format : undefined,
    });
    if (!validation.ok) {
      throw new AdminLyricsValidationError(validation.error, 'LYRICS_INVALID');
    }

    let song;
    try {
      song = await SongModel.findById(songId).select('+language');
    } catch {
      throw new AdminLyricsSaveError(ADMIN_LYRICS_ERROR_MESSAGES.SAVE_FAILED);
    }
    if (!song) {
      throw new AdminLyricsNotFoundError(ADMIN_LYRICS_ERROR_MESSAGES.SONG_NOT_FOUND);
    }

    const existingLyrics = typeof song.lyrics === 'string' ? song.lyrics : '';
    const hasExistingVerifiedLyrics = song.lyrics_verified === true && existingLyrics.trim().length > 0;
    if (hasExistingVerifiedLyrics && replaceVerified !== true) {
      throw new AdminLyricsConflictError(
        ADMIN_LYRICS_ERROR_MESSAGES.VERIFIED_LYRICS_EXISTS,
        'VERIFIED_LYRICS_EXISTS',
      );
    }

    const update = {
      lyrics: validation.text,
      lyrics_verified: true,
      lyrics_source: ADMIN_LYRICS_VERIFIED_SOURCE,
      lyrics_source_url: safeSourceUrl,
      lyrics_provider_id: safeProvider,
      lyrics_language: safeLanguage,
      lyrics_notes: safeNotes,
      lyrics_match_status: ADMIN_LYRICS_MATCH_STATUS,
      lyrics_last_checked_at: typeof input.now === 'function' ? input.now() : new Date(),
      lyrics_verified_by: safeVerifiedBy,
    };

    try {
      Object.assign(song, update);
      await song.save();
    } catch {
      throw new AdminLyricsSaveError(ADMIN_LYRICS_ERROR_MESSAGES.SAVE_FAILED);
    }

    return {
      songId: String(song._id ?? songId),
      saved: true,
      replaced: hasExistingVerifiedLyrics,
      format: validation.format,
      presentation: toPresentation(validation.text, validation.format, validation.lines),
      lyricsVerified: true,
      lyricsSource: ADMIN_LYRICS_VERIFIED_SOURCE,
      lyricsLanguage: safeLanguage,
      lyricsSourceUrl: safeSourceUrl,
      lyricsProviderId: safeProvider,
      lyricsNotes: safeNotes,
      verifiedBy: safeVerifiedBy,
    };
  };

  const bulkImport = async (input) => {
    const { text, fileName, format, verifiedBy, replaceVerified, now } = input || {};

    const safeVerifiedBy = normalizeOptional(
      verifiedBy,
      MAX_ADMIN_LYRICS_VERIFIED_BY_LENGTH,
      ADMIN_LYRICS_ERROR_MESSAGES.VERIFIED_BY_INVALID,
      AdminLyricsValidationError,
    );
    if (replaceVerified !== undefined && typeof replaceVerified !== 'boolean') {
      throw new AdminLyricsValidationError(ADMIN_LYRICS_ERROR_MESSAGES.REPLACE_INVALID, 'REPLACE_INVALID');
    }

    const parsed = parseBulkImport({ text, fileName, format });
    if (!parsed.ok) {
      throw new AdminLyricsValidationError(parsed.error, 'BULK_PARSE_FAILED');
    }
    if (parsed.entries.length > MAX_BULK_LYRICS_ENTRIES) {
      throw new AdminLyricsValidationError(ADMIN_LYRICS_ERROR_MESSAGES.ENTRY_LIMIT, 'ENTRY_LIMIT');
    }

    const songIds = [...new Set(parsed.entries.map((entry) => entry.songId))];
    const validSongIds = songIds.filter(isValidSongId);
    const invalidSongIdSet = new Set(songIds.filter((id) => !isValidSongId(id)));

    let docs = [];
    if (validSongIds.length > 0) {
      try {
        docs = await SongModel.find({ _id: { $in: validSongIds } })
          .select('+language lyrics lyrics_verified lyrics_source')
          .lean();
      } catch {
        throw new AdminLyricsSaveError(ADMIN_LYRICS_ERROR_MESSAGES.IMPORT_FAILED);
      }
    }

    const byId = new Map();
    (Array.isArray(docs) ? docs : []).forEach((doc) => {
      byId.set(String(doc._id), doc);
    });

    const counts = {
      imported: 0,
      rejected: 0,
      duplicate: 0,
      invalid: parsed.invalid.length,
      total: parsed.entries.length + parsed.invalid.length,
    };
    const invalidDetails = [...parsed.invalid];
    const rejectedDetails = [];
    const importedSongIds = [];
    const batchSeen = new Set();

    for (const entry of parsed.entries) {
      if (invalidSongIdSet.has(entry.songId)) {
        counts.rejected += 1;
        rejectedDetails.push({ index: entry.index, reason: BULK_IMPORT_ERROR_MESSAGES.UNKNOWN_SONG_ID });
        continue;
      }

      const doc = byId.get(entry.songId);
      if (!doc) {
        counts.rejected += 1;
        rejectedDetails.push({ index: entry.index, reason: BULK_IMPORT_ERROR_MESSAGES.UNKNOWN_SONG_ID });
        continue;
      }

      const existingLyrics = typeof doc.lyrics === 'string' ? doc.lyrics : '';
      const hasExistingVerifiedLyrics = doc.lyrics_verified === true && existingLyrics.trim().length > 0;
      if ((hasExistingVerifiedLyrics || batchSeen.has(entry.songId)) && replaceVerified !== true) {
        counts.duplicate += 1;
        continue;
      }

      try {
        await SongModel.updateOne(
          { _id: entry.songId },
          {
            $set: {
              lyrics: entry.lyrics,
              lyrics_verified: true,
              lyrics_source: ADMIN_LYRICS_VERIFIED_SOURCE,
              lyrics_source_url: entry.sourceUrl,
              lyrics_provider_id: entry.sourceProvider,
              lyrics_language: entry.language,
              lyrics_notes: entry.notes,
              lyrics_match_status: ADMIN_LYRICS_MATCH_STATUS,
              lyrics_last_checked_at: typeof now === 'function' ? now() : new Date(),
              lyrics_verified_by: safeVerifiedBy,
            },
          },
        );
      } catch {
        counts.rejected += 1;
        rejectedDetails.push({ index: entry.index, reason: ADMIN_LYRICS_ERROR_MESSAGES.IMPORT_FAILED });
        continue;
      }

      batchSeen.add(entry.songId);
      counts.imported += 1;
      importedSongIds.push(entry.songId);
    }

    return {
      state: 'ready',
      format: parsed.format,
      counts,
      importedSongIds,
      invalid: invalidDetails,
      rejected: rejectedDetails,
      limits: {
        maxEntries: MAX_BULK_LYRICS_ENTRIES,
        maxTextLength: MAX_LYRICS_TEXT_LENGTH,
        maxLyricsFileBytes: MAX_LYRICS_FILE_BYTES,
        maxFileBytes: MAX_BULK_IMPORT_BYTES,
        maxSourceUrlLength: MAX_BULK_SOURCE_URL_LENGTH,
        maxTextFieldLength: MAX_BULK_TEXT_FIELD_LENGTH,
        maxNotesLength: MAX_BULK_NOTES_LENGTH,
        maxSongIdLength: MAX_ADMIN_LYRICS_SONG_ID_LENGTH,
      },
    };
  };

  return Object.freeze({ listMissingLyrics, saveVerifiedLyrics, bulkImport });
}
