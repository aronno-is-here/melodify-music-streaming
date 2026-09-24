import ListeningEvent from '../models/ListeningEvent.js';
import Song from '../models/Song.js';
import {
  scoreTrendingSongs as scoreTrendingSongsEngine,
  TRENDING_WINDOW_HOURS,
  MAX_TRENDING_EVENT_INPUTS,
  MAX_TRENDING_LIMIT,
} from './trendingScoreEngine.js';

export const TRENDING_SERVICE_ERROR = 'Trending loading failed';

export const TRENDING_ITEM_BASIS = Object.freeze({
  ACTIVITY: 'activity',
  CATALOG_FALLBACK: 'catalog-fallback',
});

export const TRENDING_MODE = Object.freeze({
  ACTIVITY: 'activity',
  ACTIVITY_PLUS_FALLBACK: 'activity-plus-fallback',
  CATALOG_FALLBACK: 'catalog-fallback',
});

export const FALLBACK_CANDIDATE_MULTIPLIER = 3;
export const MAX_FALLBACK_CANDIDATES = 150;
export const MAX_FALLBACK_EXCLUSIONS = 100;

const EVENT_SELECT =
  '_id user song event_type listened_seconds_delta createdAt';
const SONG_SELECT =
  '_id title artist genre youtube_id file_path poster_url duration duration_seconds release_date language category recommendation_eligible';
const SONG_OUTPUT_FIELDS = Object.freeze([
  '_id', 'title', 'artist', 'genre', 'youtube_id', 'file_path', 'poster_url',
  'duration', 'duration_seconds', 'release_date', 'language', 'category',
]);
const HOUR_MS = 3600000;
const FALLBACK_SORT = Object.freeze({ createdAt: -1, _id: 1 });
const EMPTY_FALLBACK_ACTIVITY = Object.freeze({
  unique_listener_count: 0,
  play_started_count: 0,
  completed_count: 0,
  replay_started_count: 0,
  skipped_count: 0,
  listened_seconds: 0,
  last_activity_at: null,
});

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

const isUsableSong = (song) => Boolean(song)
  && isEligible(song)
  && isPlayable(song)
  && nonEmptyString(song.title)
  && nonEmptyString(song.artist);

const projectSong = (song) => {
  const output = {};
  for (const field of SONG_OUTPUT_FIELDS) {
    if (song[field] !== undefined) output[field] = song[field];
  }
  if (output._id !== undefined) output._id = canonicalId(output._id) ?? output._id;
  return output;
};

const buildActivityItem = (row, song) => ({
  basis: TRENDING_ITEM_BASIS.ACTIVITY,
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
});

const buildFallbackItem = (song) => ({
  basis: TRENDING_ITEM_BASIS.CATALOG_FALLBACK,
  score: null,
  activity: { ...EMPTY_FALLBACK_ACTIVITY },
  song: projectSong(song),
});

const resolveMode = (activityCount, fallbackCount) => {
  if (activityCount > 0 && fallbackCount > 0) return TRENDING_MODE.ACTIVITY_PLUS_FALLBACK;
  if (activityCount > 0) return TRENDING_MODE.ACTIVITY;
  return TRENDING_MODE.CATALOG_FALLBACK;
};

const normalizePublicLimit = (limit) =>
  typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 ? limit : 0;

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
      const publicLimit = normalizePublicLimit(limit);
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
      let ranked = [];
      if (eventCount > 0) {
        ranked = scoreTrendingSongs(events, {
          now: nowDate,
          limit: MAX_TRENDING_LIMIT,
        });
        if (!Array.isArray(ranked)) throw new Error(TRENDING_SERVICE_ERROR);
      }

      const rankedExclusions = [...new Set(
        ranked
          .map((row) => canonicalId(row?.song_id))
          .filter(Boolean),
      )].slice(0, MAX_FALLBACK_EXCLUSIONS);

      const activityItems = [];
      if (ranked.length > 0) {
        const songIds = [...new Set(
          ranked
            .map((row) => canonicalId(row?.song_id))
            .filter(Boolean),
        )];
        if (songIds.length > 0) {
          const songDocs = await SongModel.find({ _id: { $in: songIds } })
            .select(SONG_SELECT)
            .lean();
          if (!Array.isArray(songDocs)) throw new Error(TRENDING_SERVICE_ERROR);

          const songMap = new Map();
          for (const doc of songDocs) {
            const key = canonicalId(doc?._id);
            if (key) songMap.set(key, doc);
          }

          for (const row of ranked) {
            const key = canonicalId(row?.song_id);
            if (!key) continue;
            const song = songMap.get(key);
            if (!isUsableSong(song)) continue;
            activityItems.push(buildActivityItem(row, song));
          }
        }
      }

      let finalActivity = activityItems;
      let fallbackItems = [];
      if (publicLimit > 0 && activityItems.length < publicLimit) {
        const remainingSlots = publicLimit - activityItems.length;
        const candidateLimit = Math.min(
          remainingSlots * FALLBACK_CANDIDATE_MULTIPLIER,
          MAX_FALLBACK_CANDIDATES,
        );
        const fallbackFilter = {};
        if (rankedExclusions.length > 0) {
          fallbackFilter._id = { $nin: rankedExclusions };
        }
        const fallbackDocs = await SongModel.find(fallbackFilter)
          .sort({ ...FALLBACK_SORT })
          .limit(candidateLimit)
          .select(SONG_SELECT)
          .lean();
        if (!Array.isArray(fallbackDocs)) throw new Error(TRENDING_SERVICE_ERROR);

        const seen = new Set(finalActivity.map((item) => item.song._id));
        for (const doc of fallbackDocs) {
          if (fallbackItems.length >= remainingSlots) break;
          const key = canonicalId(doc?._id);
          if (!key || seen.has(key)) continue;
          if (!isUsableSong(doc)) continue;
          seen.add(key);
          fallbackItems.push(buildFallbackItem(doc));
        }
      } else if (publicLimit > 0) {
        finalActivity = activityItems.slice(0, publicLimit);
      }

      const combined = publicLimit > 0
        ? [...finalActivity, ...fallbackItems].slice(0, publicLimit)
        : [...finalActivity, ...fallbackItems];
      const items = combined.map((item, index) => ({
        rank: index + 1,
        ...item,
      }));

      const activityCount = items.filter(
        (item) => item.basis === TRENDING_ITEM_BASIS.ACTIVITY,
      ).length;
      const fallbackCount = items.length - activityCount;

      return {
        items,
        meta: {
          window_hours: TRENDING_WINDOW_HOURS,
          requested_limit: limit,
          returned_count: items.length,
          event_count: eventCount,
          event_input_truncated: eventInputTruncated,
          candidate_count: ranked.length,
          mode: resolveMode(activityCount, fallbackCount),
          activity_count: activityCount,
          fallback_count: fallbackCount,
        },
      };
    } catch {
      throw new Error(TRENDING_SERVICE_ERROR);
    }
  };

  return { getTrendingSongs };
}

export default createTrendingService;
