import ListeningEvent from '../models/ListeningEvent.js';
import Song from '../models/Song.js';
import {
  scoreTrendingSongs as scoreTrendingSongsEngine,
  TRENDING_WINDOW_HOURS,
  MAX_TRENDING_EVENT_INPUTS,
  MAX_TRENDING_LIMIT,
} from './trendingScoreEngine.js';

export const TRENDING_SERVICE_ERROR = 'Trending loading failed';

const EVENT_SELECT =
  '_id user song event_type listened_seconds_delta createdAt';
const SONG_SELECT =
  '_id title artist genre youtube_id file_path poster_url duration duration_seconds release_date language category recommendation_eligible';
const SONG_OUTPUT_FIELDS = Object.freeze([
  '_id', 'title', 'artist', 'genre', 'youtube_id', 'file_path', 'poster_url',
  'duration', 'duration_seconds', 'release_date', 'language', 'category',
]);
const HOUR_MS = 3600000;

const canonicalId = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.toLowerCase();
  if (typeof value.toHexString === 'function') {
    try {
      return String(value.toHexString()).toLowerCase();
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value._id !== undefined) return canonicalId(value._id);
  return null;
};

const nonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const isPlayable = (song) =>
  nonEmptyString(song.youtube_id) || nonEmptyString(song.file_path);

const isEligible = (song) => song.recommendation_eligible !== false;

const projectSong = (song) => {
  const output = {};
  for (const field of SONG_OUTPUT_FIELDS) {
    if (song[field] !== undefined) output[field] = song[field];
  }
  if (output._id !== undefined) output._id = canonicalId(output._id) ?? output._id;
  return output;
};

export function createTrendingService({
  ListeningEventModel = ListeningEvent,
  SongModel = Song,
  scoreTrendingSongs = scoreTrendingSongsEngine,
  now = () => new Date(),
} = {}) {
  const getTrendingSongs = async ({ limit } = {}) => {
    try {
      const nowDate = now();
      if (!(nowDate instanceof Date) || Number.isNaN(nowDate.getTime())) {
        throw new Error(TRENDING_SERVICE_ERROR);
      }
      const until = nowDate;
      const since = new Date(nowDate.getTime() - TRENDING_WINDOW_HOURS * HOUR_MS);

      const rawEvents = await ListeningEventModel.find({
        createdAt: { $gte: since, $lte: until },
      })
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_TRENDING_EVENT_INPUTS + 1)
        .select(EVENT_SELECT)
        .lean();

      if (!Array.isArray(rawEvents)) throw new Error(TRENDING_SERVICE_ERROR);

      let eventInputTruncated = false;
      let events = rawEvents;
      if (rawEvents.length > MAX_TRENDING_EVENT_INPUTS) {
        eventInputTruncated = true;
        events = rawEvents.slice(0, MAX_TRENDING_EVENT_INPUTS);
      }

      const eventCount = events.length;
      const baseMeta = {
        window_hours: TRENDING_WINDOW_HOURS,
        requested_limit: limit,
        returned_count: 0,
        event_count: eventCount,
        event_input_truncated: eventInputTruncated,
        candidate_count: 0,
      };

      if (eventCount === 0) {
        return { items: [], meta: baseMeta };
      }

      const ranked = scoreTrendingSongs(events, {
        now: nowDate,
        limit: MAX_TRENDING_LIMIT,
      });
      if (!Array.isArray(ranked)) throw new Error(TRENDING_SERVICE_ERROR);

      baseMeta.candidate_count = ranked.length;
      if (ranked.length === 0) {
        return { items: [], meta: baseMeta };
      }

      const songIds = [...new Set(
        ranked
          .map((row) => canonicalId(row?.song_id))
          .filter(Boolean),
      )];
      if (songIds.length === 0) {
        return { items: [], meta: baseMeta };
      }

      const songDocs = await SongModel.find({ _id: { $in: songIds } })
        .select(SONG_SELECT)
        .lean();
      if (!Array.isArray(songDocs)) throw new Error(TRENDING_SERVICE_ERROR);

      const songMap = new Map();
      for (const doc of songDocs) {
        const key = canonicalId(doc?._id);
        if (key) songMap.set(key, doc);
      }

      const eligible = [];
      for (const row of ranked) {
        const key = canonicalId(row?.song_id);
        if (!key) continue;
        const song = songMap.get(key);
        if (!song) continue;
        if (!isEligible(song)) continue;
        if (!isPlayable(song)) continue;
        if (!nonEmptyString(song.title) || !nonEmptyString(song.artist)) continue;
        eligible.push({ row, song });
      }

      const limited = typeof limit === 'number' && Number.isInteger(limit) && limit >= 1
        ? eligible.slice(0, limit)
        : eligible;

      const items = limited.map(({ row, song }, index) => ({
        rank: index + 1,
        score: row.score,
        activity: {
          unique_listener_count: row.unique_listener_count,
          play_started_count: row.play_started_count,
          completed_count: row.completed_count,
          replay_started_count: row.replay_started_count,
          skipped_count: row.skipped_count,
          listened_seconds: row.listened_seconds,
          last_activity_at: row.last_activity_at,
        },
        song: projectSong(song),
      }));

      return {
        items,
        meta: {
          ...baseMeta,
          returned_count: items.length,
        },
      };
    } catch {
      throw new Error(TRENDING_SERVICE_ERROR);
    }
  };

  return { getTrendingSongs };
}

export default createTrendingService;
