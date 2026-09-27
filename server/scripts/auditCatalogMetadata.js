import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Song from '../models/Song.js';
import { buildCatalogSongAssessment, summarizeCatalogAssessments, CATALOG_REPAIR_CONFIDENCE } from '../utils/catalogMetadata.js';

export const AUDIT_CATALOG_METADATA_USAGE = 'node server/scripts/auditCatalogMetadata.js [--song-id <song-id>]';

const SONG_ID_PATTERN = /^[a-f0-9]{24}$/i;

export const KNOWN_CASE_TITLE_PATTERNS = Object.freeze([
  'jabo hariye',
  'opekkha',
  'opare',
  'mitwa',
  'aadat',
  'piers morgan',
]);

export function parseAuditCatalogMetadataArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const songIds = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--song-id') {
      const value = String(args[index + 1] ?? '');
      if (!SONG_ID_PATTERN.test(value)) {
        throw new Error('Invalid --song-id value');
      }
      if (!songIds.includes(value.toLowerCase())) {
        songIds.push(value.toLowerCase());
      }
      if (songIds.length > 50) {
        throw new Error('Too many --song-id values');
      }
      index += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      return { songIds: [], help: true };
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { songIds, help: false };
}

const isKnownCase = (title) => {
  const normalized = String(title || '').toLowerCase();
  return KNOWN_CASE_TITLE_PATTERNS.some((needle) => normalized.includes(needle));
};

export function buildCatalogMetadataAudit(songs) {
  const list = Array.isArray(songs) ? songs : [];
  const assessments = list.map((song) => buildCatalogSongAssessment(song));
  const summary = summarizeCatalogAssessments(assessments);

  const songIds = {
    probableUploaderAsArtist: [],
    noisyTitle: [],
    missingLanguage: [],
    missingRegion: [],
    placeholderLyrics: [],
    nonMusic: [],
    ambiguous: [],
    highConfidenceRepair: [],
  };

  const repairs = [];
  const review = [];

  for (const assessment of assessments) {
    const findings = assessment.findings;
    if (findings.uploaderAsArtist) songIds.probableUploaderAsArtist.push(assessment.songId);
    if (findings.noisyTitle) songIds.noisyTitle.push(assessment.songId);
    if (findings.missingLanguage) songIds.missingLanguage.push(assessment.songId);
    if (findings.missingRegion) songIds.missingRegion.push(assessment.songId);
    if (findings.nonMusic) songIds.nonMusic.push(assessment.songId);
    if (findings.ambiguous) songIds.ambiguous.push(assessment.songId);
    if (assessment.repair.confidence === 'HIGH' && assessment.repair.changes.length > 0) {
      songIds.highConfidenceRepair.push(assessment.songId);
      repairs.push({
        songId: assessment.songId,
        confidence: assessment.repair.confidence,
        changes: assessment.repair.changes,
      });
    }
    for (const entry of assessment.review) {
      review.push({ songId: assessment.songId, ...entry });
    }
  }

  const knownCases = assessments
    .filter((assessment) => isKnownCase(assessment.title))
    .map((assessment) => ({
      songId: assessment.songId,
      title: assessment.title,
      artist: assessment.artist,
      uploaderLevel: assessment.uploaderLevel,
      nonMusic: assessment.nonMusic,
      language: assessment.language,
      regionalTag: assessment.regionalTag,
      repairConfidence: assessment.repair.confidence,
      changes: assessment.repair.changes.map((change) => ({
        field: change.field,
        from: change.from,
        to: change.to,
        reason: change.reason,
      })),
      review: assessment.review,
    }));

  return {
    audited: summary.audited,
    summary,
    songIds,
    repairs,
    review,
    knownCases,
  };
}

export async function runCatalogMetadataAuditCli({
  argv = process.argv.slice(2),
  writeOut = console.log,
  writeErr = console.error,
  connect = connectDB,
  findSongs = (songIds) => {
    const filter = songIds.length > 0 ? { _id: { $in: songIds } } : {};
    return Song.find(filter, {
      album: 1,
      title: 1,
      artist: 1,
      genre: 1,
      language: 1,
      category: 1,
      regional_tag: 1,
      duration: 1,
      duration_seconds: 1,
      lyrics: 1,
      recommendation_eligible: 1,
      source_provider: 1,
      external_id: 1,
    }).sort({ _id: 1 }).lean();
  },
  disconnect = () => (mongoose.connection.readyState === 0 ? Promise.resolve() : mongoose.disconnect()),
} = {}) {
  try {
    const options = parseAuditCatalogMetadataArgs(argv);
    if (options.help) {
      writeOut(AUDIT_CATALOG_METADATA_USAGE);
      return 0;
    }
    await connect();
    const songs = await findSongs(options.songIds);
    const audit = buildCatalogMetadataAudit(songs);
    writeOut(JSON.stringify({ success: true, usage: AUDIT_CATALOG_METADATA_USAGE, ...audit }, null, 2));
    return 0;
  } catch (error) {
    writeErr(JSON.stringify({ success: false, error: error?.message || 'audit failed' }));
    return 1;
  } finally {
    await disconnect();
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entryPath && entryPath === scriptPath) {
  runCatalogMetadataAuditCli().then((code) => {
    process.exitCode = code;
  });
}
