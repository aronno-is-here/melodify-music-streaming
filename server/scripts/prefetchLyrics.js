import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Song from '../models/Song.js';
import { createLyricsProviderService, LYRICS_RESOLUTION_STATUS } from '../services/lyricsProviderService.js';

export const DEFAULT_PREFETCH_LIMIT = 25;
export const MAX_PREFETCH_LIMIT = 200;
export const MAX_PREFETCH_OFFSET = 10000;

const toSafeString = (value) => (typeof value === 'string' ? value.trim() : '');

const parseBoundedInt = (value, { min, max, flagName }) => {
  if (!/^\d+$/.test(String(value))) throw new Error(`Invalid ${flagName} value`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(`Invalid ${flagName} value`);
  return parsed;
};

export const parsePrefetchLyricsArgs = (argv) => {
  const args = Array.isArray(argv) ? argv : [];
  let limit = DEFAULT_PREFETCH_LIMIT;
  let offset = 0;
  let dryRun = false;
  let includeLegacy = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--limit') {
      limit = parseBoundedInt(args[index + 1], { min: 1, max: MAX_PREFETCH_LIMIT, flagName: '--limit' });
      index += 1;
      continue;
    }
    if (token === '--offset') {
      offset = parseBoundedInt(args[index + 1], { min: 0, max: MAX_PREFETCH_OFFSET, flagName: '--offset' });
      index += 1;
      continue;
    }
    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (token === '--include-legacy') {
      includeLegacy = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { limit, offset, dryRun, includeLegacy };
};

const buildSongQuery = ({ includeLegacy }) => {
  const base = { lyrics_verified: { $ne: true } };
  if (includeLegacy) return base;
  return {
    ...base,
    $or: [
      { lyrics: { $exists: false } },
      { lyrics: '' },
      { lyrics: null },
    ],
  };
};

const mapLyricsStateToSource = (state) => {
  if (state === LYRICS_RESOLUTION_STATUS.PROVIDER) return 'lrclib';
  if (state === LYRICS_RESOLUTION_STATUS.LEGACY_UNVERIFIED) return 'legacy_unverified';
  if (state === LYRICS_RESOLUTION_STATUS.VERIFIED) return 'db_verified';
  return 'none';
};

const mapMatchStatus = (value) => {
  if (typeof value !== 'string') return 'NONE';
  const normalized = value.trim().toUpperCase();
  if (normalized === 'EXACT' || normalized === 'HIGH' || normalized === 'AMBIGUOUS') return normalized;
  return 'NONE';
};

export const runLyricsPrefetch = async ({
  findSongs,
  resolveSongLyrics,
  updateSong,
  options,
  now = () => new Date(),
}) => {
  const songs = await findSongs(options);
  const results = [];
  let updatedCount = 0;
  let unavailableCount = 0;

  for (const song of songs) {
    const songId = String(song?._id || '');
    if (!songId) continue;
    try {
      const resolved = await resolveSongLyrics(songId);
      if (!resolved || resolved.notFound) {
        results.push({ songId, status: 'not-found' });
        unavailableCount += 1;
        continue;
      }

      const state = resolved.lyrics?.status || LYRICS_RESOLUTION_STATUS.UNAVAILABLE;
      const summaryItem = {
        songId,
        title: toSafeString(song.title),
        artist: toSafeString(song.artist),
        status: state,
      };

      if (state === LYRICS_RESOLUTION_STATUS.UNAVAILABLE || state === LYRICS_RESOLUTION_STATUS.AMBIGUOUS) {
        unavailableCount += 1;
      }

      if (!options.dryRun) {
        const payload = {
          lyrics_source: mapLyricsStateToSource(state),
          lyrics_match_status: mapMatchStatus(resolved.lyrics?.match),
          lyrics_provider_id: toSafeString(resolved.lyrics?.provider?.providerLyricsId),
          lyrics_last_checked_at: now(),
        };
        if (state === LYRICS_RESOLUTION_STATUS.PROVIDER && toSafeString(resolved.lyrics?.plain)) {
          payload.lyrics = resolved.lyrics.plain;
          payload.lyrics_verified = false;
          updatedCount += 1;
        }
        await updateSong(songId, payload);
      }

      results.push(summaryItem);
    } catch (error) {
      results.push({
        songId,
        title: toSafeString(song.title),
        artist: toSafeString(song.artist),
        status: 'failed',
        error: error && typeof error.message === 'string' ? error.message : 'prefetch failed',
      });
    }
  }

  return {
    totalCandidates: songs.length,
    dryRun: options.dryRun,
    updatedCount,
    unavailableCount,
    results,
  };
};

export const runLyricsPrefetchCli = async ({ argv = process.argv.slice(2), writeOut = console.log, writeErr = console.error } = {}) => {
  try {
    const options = parsePrefetchLyricsArgs(argv);
    await connectDB();
    const lyricsService = createLyricsProviderService();

    const findSongs = async () => Song.find(buildSongQuery(options), {
      _id: 1,
      title: 1,
      artist: 1,
    })
      .sort({ createdAt: -1, _id: -1 })
      .skip(options.offset)
      .limit(options.limit)
      .lean();

    const updateSong = async (songId, payload) => Song.findByIdAndUpdate(songId, payload, { new: false });

    const summary = await runLyricsPrefetch({
      findSongs,
      resolveSongLyrics: lyricsService.resolveSongLyrics,
      updateSong,
      options,
    });

    writeOut(JSON.stringify({ success: true, summary }, null, 2));
    return 0;
  } catch (error) {
    writeErr(JSON.stringify({ success: false, error: error?.message || 'lyrics prefetch failed' }));
    return 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
};

const scriptPath = fileURLToPath(import.meta.url);
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (entryPath && entryPath === scriptPath) {
  runLyricsPrefetchCli().then((code) => {
    process.exitCode = code;
  });
}
