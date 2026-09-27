import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Song from '../models/Song.js';
import {
  buildCatalogSongAssessment,
  CATALOG_REPAIR_CONFIDENCE,
} from '../utils/catalogMetadata.js';

export const REPAIR_CATALOG_METADATA_USAGE = 'node server/scripts/repairCatalogMetadata.js --song-id <song-id> [--song-id <song-id>] [--apply]';

export const REPAIRABLE_FIELDS = Object.freeze([
  'title',
  'artist',
  'language',
  'regional_tag',
  'recommendation_eligible',
]);

export const REPAIR_ERROR_MESSAGES = Object.freeze({
  missingSongId: 'at least one --song-id is required',
  invalidSongId: 'Invalid --song-id value',
  unknownArgument: 'Unknown argument',
  unknownSong: 'Requested --song-id is not present in the catalog',
  disallowedField: 'Refusing to write a field outside the approved repair set',
});

const SONG_ID_PATTERN = /^[a-f0-9]{24}$/i;
const MAX_SONG_IDS = 50;

export function parseRepairCatalogArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const songIds = [];
  let apply = false;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--song-id') {
      const value = String(args[index + 1] ?? '');
      if (!SONG_ID_PATTERN.test(value)) {
        throw new Error(REPAIR_ERROR_MESSAGES.invalidSongId);
      }
      const normalized = value.toLowerCase();
      if (!songIds.includes(normalized)) {
        songIds.push(normalized);
      }
      if (songIds.length > MAX_SONG_IDS) {
        throw new Error(REPAIR_ERROR_MESSAGES.invalidSongId);
      }
      index += 1;
      continue;
    }
    if (token === '--apply') {
      apply = true;
      continue;
    }
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    throw new Error(`${REPAIR_ERROR_MESSAGES.unknownArgument}: ${token}`);
  }

  if (!help && songIds.length === 0) {
    throw new Error(REPAIR_ERROR_MESSAGES.missingSongId);
  }

  return { songIds, apply, help };
}

export function buildCatalogRepairPlan(songs, { songIds = [] } = {}) {
  const requested = songIds.map((value) => String(value).toLowerCase());
  const rows = new Map();
  for (const song of Array.isArray(songs) ? songs : []) {
    rows.set(String(song?._id).toLowerCase(), song);
  }

  const missing = requested.filter((songId) => !rows.has(songId));
  if (missing.length > 0) {
    const error = new Error(`${REPAIR_ERROR_MESSAGES.unknownSong}: ${missing.join(', ')}`);
    error.code = 'UNKNOWN_SONG';
    throw error;
  }

  const changes = [];
  const review = [];

  for (const songId of requested) {
    const song = rows.get(songId);
    const assessment = buildCatalogSongAssessment(song);
    if (assessment.repair.confidence === CATALOG_REPAIR_CONFIDENCE.HIGH) {
      for (const change of assessment.repair.changes) {
        if (!REPAIRABLE_FIELDS.includes(change.field)) {
          const error = new Error(`${REPAIR_ERROR_MESSAGES.disallowedField}: ${change.field}`);
          error.code = 'DISALLOWED_FIELD';
          throw error;
        }
        changes.push({ songId, ...change });
      }
    }
    for (const entry of assessment.review) {
      review.push({ songId, ...entry });
    }
  }

  return { songIds: requested, changes, review };
}

export function formatCatalogRepairPlan(plan, { apply = false } = {}) {
  const lines = [];
  lines.push(`mode: ${apply ? 'apply' : 'dry-run'}`);
  lines.push(`songs: ${plan.songIds.length}`);
  lines.push(`changes: ${plan.changes.length}`);
  lines.push(`review-only: ${plan.review.length}`);
  for (const change of plan.changes) {
    const from = change.from === null || change.from === undefined ? '<unset>' : JSON.stringify(change.from);
    const to = change.to === null || change.to === undefined ? '<unset>' : JSON.stringify(change.to);
    lines.push(`${change.songId} ${change.field}: ${from} -> ${to} (${change.reason})`);
  }
  for (const entry of plan.review) {
    const from = entry.from === null || entry.from === undefined ? '<unset>' : JSON.stringify(entry.from);
    lines.push(`${entry.songId} ${entry.field}: review ${entry.confidence} ${from} (${entry.reason})`);
  }
  return lines;
}

export async function runCatalogRepairCli({
  argv = process.argv.slice(2),
  writeOut = console.log,
  writeErr = console.error,
  connect = connectDB,
  findSongs = (songIds) => Song.find(
    { _id: { $in: songIds } },
    {
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
      source_channel: 1,
      source_channel_id: 1,
    }
  ).lean(),
  applyChanges = async (changes) => {
    const grouped = new Map();
    for (const change of changes) {
      if (!grouped.has(change.songId)) grouped.set(change.songId, {});
      grouped.get(change.songId)[change.field] = change.to;
    }
    let updated = 0;
    for (const [songId, fields] of grouped) {
      const result = await Song.updateOne({ _id: songId }, { $set: fields });
      if (result?.matchedCount === 1) updated += 1;
    }
    return { updated, fields: changes.length };
  },
  disconnect = () => (mongoose.connection.readyState === 0 ? Promise.resolve() : mongoose.disconnect()),
} = {}) {
  try {
    const options = parseRepairCatalogArgs(argv);
    if (options.help) {
      writeOut(REPAIR_CATALOG_METADATA_USAGE);
      return 0;
    }

    await connect();
    const songs = await findSongs(options.songIds);
    const plan = buildCatalogRepairPlan(songs, { songIds: options.songIds });

    if (!options.apply) {
      writeOut('catalog metadata repair (dry run)');
      for (const line of formatCatalogRepairPlan(plan, { apply: false })) writeOut(line);
      return 0;
    }

    if (plan.changes.length === 0) {
      writeOut('catalog metadata repair (apply)');
      writeOut('no approved changes to apply');
      for (const line of formatCatalogRepairPlan(plan, { apply: true })) writeOut(line);
      return 0;
    }

    const outcome = await applyChanges(plan.changes);
    writeOut('catalog metadata repair (apply)');
    for (const line of formatCatalogRepairPlan(plan, { apply: true })) writeOut(line);
    writeOut(JSON.stringify({ applied: true, updatedSongs: outcome.updated, updatedFields: outcome.fields }));
    return 0;
  } catch (error) {
    writeErr(JSON.stringify({ success: false, error: error?.message || 'repair failed' }));
    return 1;
  } finally {
    await disconnect();
  }
}

const scriptPath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entryPath && entryPath === scriptPath) {
  runCatalogRepairCli().then((code) => {
    process.exitCode = code;
  });
}
