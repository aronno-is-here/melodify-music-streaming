import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Song from '../models/Song.js';

const DEFAULT_SAMPLE_LIMIT = 25;
const MAX_SAMPLE_LIMIT = 200;

const toSafeString = (value) => (typeof value === 'string' ? value.trim() : '');

const hasText = (value) => toSafeString(value).length > 0;

const accumulateKey = (target, rawKey) => {
  const key = toSafeString(rawKey) || 'none';
  target[key] = (target[key] || 0) + 1;
};

export const buildCatalogContentSummary = (songs, options = {}) => {
  const list = Array.isArray(songs) ? songs : [];
  const sampleLimit = Number.isInteger(options.sampleLimit)
    ? Math.max(0, Math.min(MAX_SAMPLE_LIMIT, options.sampleLimit))
    : DEFAULT_SAMPLE_LIMIT;

  const summary = {
    totalSongs: list.length,
    withLyrics: 0,
    withVerifiedLyrics: 0,
    withChords: 0,
    withVerifiedChords: 0,
    withBoth: 0,
    withNeither: 0,
    importedSongs: 0,
    byLyricsSource: {},
    byChordsSource: {},
    byRegionTag: {},
    bySourceProvider: {},
    sampleMissingContent: [],
  };

  for (const song of list) {
    const hasLyrics = hasText(song?.lyrics);
    const hasChords = hasText(song?.chords);

    if (hasLyrics) summary.withLyrics += 1;
    if (song?.lyrics_verified === true) summary.withVerifiedLyrics += 1;
    if (hasChords) summary.withChords += 1;
    if (song?.chords_verified === true) summary.withVerifiedChords += 1;

    if (hasLyrics && hasChords) summary.withBoth += 1;
    if (!hasLyrics && !hasChords) {
      summary.withNeither += 1;
      if (summary.sampleMissingContent.length < sampleLimit) {
        summary.sampleMissingContent.push({
          _id: String(song?._id || ''),
          title: toSafeString(song?.title) || 'Untitled',
          artist: toSafeString(song?.artist) || 'Unknown artist',
          source_provider: toSafeString(song?.source_provider) || 'none',
          regional_tag: toSafeString(song?.regional_tag) || 'none',
        });
      }
    }

    if (hasText(song?.external_id) || hasText(song?.source_provider)) {
      summary.importedSongs += 1;
    }

    accumulateKey(summary.byLyricsSource, song?.lyrics_source);
    accumulateKey(summary.byChordsSource, song?.chords_source);
    accumulateKey(summary.byRegionTag, song?.regional_tag);
    accumulateKey(summary.bySourceProvider, song?.source_provider);
  }

  return summary;
};

export const parseAuditCatalogArgs = (argv) => {
  const args = Array.isArray(argv) ? argv : [];
  let sampleLimit = DEFAULT_SAMPLE_LIMIT;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--sample-limit') {
      const value = args[index + 1];
      if (!/^\d+$/.test(String(value))) {
        throw new Error('Invalid --sample-limit value');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_SAMPLE_LIMIT) {
        throw new Error('Invalid --sample-limit value');
      }
      sampleLimit = parsed;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return { sampleLimit };
};

export const runCatalogContentAuditCli = async ({ argv = process.argv.slice(2), writeOut = console.log, writeErr = console.error } = {}) => {
  try {
    const options = parseAuditCatalogArgs(argv);
    await connectDB();
    const songs = await Song.find({}, {
      title: 1,
      artist: 1,
      lyrics: 1,
      chords: 1,
      lyrics_verified: 1,
      chords_verified: 1,
      lyrics_source: 1,
      chords_source: 1,
      regional_tag: 1,
      source_provider: 1,
      external_id: 1,
    }).sort({ createdAt: -1, _id: -1 }).lean();

    const summary = buildCatalogContentSummary(songs, options);
    writeOut(JSON.stringify({ success: true, summary }, null, 2));
    return 0;
  } catch (error) {
    writeErr(JSON.stringify({ success: false, error: error?.message || 'audit failed' }));
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
  runCatalogContentAuditCli().then((code) => {
    process.exitCode = code;
  });
}
