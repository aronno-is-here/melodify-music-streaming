import mongoose from 'mongoose';
import ListeningEvent, {
  LISTENING_EVENT_TYPES,
  MAX_LISTENED_DELTA_SECONDS,
  MAX_PLAYBACK_SECONDS,
  MAX_SESSION_ID_LENGTH,
} from '../models/ListeningEvent.js';
import Song from '../models/Song.js';
import { POSITION_DURATION_TOLERANCE_SECONDS } from './listeningEventService.js';
import {
  createExplicitPreferenceSignalService,
  EXPLICIT_SIGNAL_TYPES,
  MAX_FAVORITES_PER_USER,
  MAX_PLAYLIST_MEMBERSHIPS,
} from './explicitPreferenceSignalService.js';

export const DEFAULT_LOOKBACK_DAYS = 90;
export const MIN_LOOKBACK_DAYS = 1;
export const MAX_LOOKBACK_DAYS = 365;
export const MAX_LISTENING_EVENTS_PER_USER = 20000;
export const USER_PREFERENCE_AGGREGATION_ERROR = 'User preference aggregation failed';
export const USER_PREFERENCE_INVALID_USER_ERROR = 'Invalid user preference user';
export const USER_PREFERENCE_INVALID_LOOKBACK_ERROR = 'Invalid user preference lookback';

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_PROJECTION = Object.freeze({
  _id: 1, song: 1, session_id: 1, event_type: 1,
  position_seconds: 1, duration_seconds: 1, listened_seconds_delta: 1, createdAt: 1,
});
const SONG_PROJECTION = Object.freeze({
  _id: 1, title: 1, artist: 1, genre: 1, language: 1, category: 1,
  normalized_artist: 1, normalized_genre: 1, recommendation_eligible: 1,
});
const EVENT_COUNTERS = Object.freeze({
  'play-started': 'play_started_count',
  'replay-started': 'replay_count',
  completed: 'completed_count',
  skipped: 'skipped_count',
  stopped: 'stopped_count',
  progress: 'progress_event_count',
});
const NON_LISTENING_TYPES = new Set(['play-started', 'resumed', 'seeked', 'replay-started']);
const GROUP_TOTAL_FIELDS = Object.freeze([
  'listened_seconds', 'session_count', 'completed_count', 'skipped_count', 'replay_count',
]);

const objectIdString = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return typeof value === 'string' && /^[a-f\d]{24}$/i.test(value) ? value.toLowerCase() : null;
};
const referenceId = (value) => objectIdString(value)
  ?? (value && typeof value === 'object' && !Array.isArray(value) ? objectIdString(value._id) : null);
const dateMillis = (value) => {
  if (!(value instanceof Date) && (typeof value !== 'string' || !value.trim())) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
};
const isoOrNull = (value) => {
  const ms = dateMillis(value);
  return ms === null ? null : new Date(ms).toISOString();
};
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const latestTime = (a, b) => (b && (!a || dateMillis(b) > dateMillis(a)) ? b : a);
const textOrNull = (value) => typeof value === 'string' && value.trim() ? value : null;
const groupingKey = (value) => textOrNull(value)?.trim().toLowerCase().replace(/\s+/g, ' ') ?? null;
const boundedSeconds = (value, max, positive = false) => typeof value === 'number'
  && Number.isFinite(value) && (positive ? value > 0 : value >= 0) && value <= max;

const emptyListening = () => ({
  session_count: 0, play_started_count: 0, replay_count: 0, completed_count: 0,
  skipped_count: 0, stopped_count: 0, progress_event_count: 0,
  listened_seconds: 0, last_event_at: null,
});
const emptyExplicit = () => ({
  favorite: false, favorite_source_id: null, favorite_occurred_at: null,
  playlist_membership_count: 0, playlist_source_ids: [],
});
const emptyCounts = () => ({
  listening_event_count: 0, song_count: 0, active_favorite_count: 0,
  playlist_membership_count: 0, total_listened_seconds: 0,
  completed_count: 0, skipped_count: 0, replay_count: 0,
});

// The lookback can begin mid-session: do not reconstruct or revalidate session
// transitions from this partial history. Invalid deltas contribute no seconds.
const validEvent = (event, sinceMs, untilMs) => {
  const songId = referenceId(event?.song);
  const createdMs = dateMillis(event?.createdAt);
  const sessionId = typeof event?.session_id === 'string' ? event.session_id.trim() : '';
  if (!objectIdString(event?._id) || !songId || !sessionId || sessionId.length > MAX_SESSION_ID_LENGTH
    || !LISTENING_EVENT_TYPES.includes(event.event_type)
    || createdMs === null || createdMs < sinceMs || createdMs > untilMs) return null;
  const position = event.position_seconds;
  const duration = event.duration_seconds;
  if ((position != null && !boundedSeconds(position, MAX_PLAYBACK_SECONDS))
    || (duration != null && !boundedSeconds(duration, MAX_PLAYBACK_SECONDS, true))
    || (position != null && duration != null && position > duration + POSITION_DURATION_TOLERANCE_SECONDS)) return null;
  const delta = event.listened_seconds_delta;
  return {
    songId, sessionId, type: event.event_type, at: new Date(createdMs).toISOString(),
    seconds: !NON_LISTENING_TYPES.has(event.event_type) && boundedSeconds(delta, MAX_LISTENED_DELTA_SECONDS) ? delta : 0,
  };
};

const metadataFor = (song) => ({
  title: textOrNull(song.title), artist: textOrNull(song.artist),
  normalized_artist: textOrNull(song.normalized_artist), genre: textOrNull(song.genre),
  normalized_genre: textOrNull(song.normalized_genre), language: textOrNull(song.language),
  category: textOrNull(song.category),
  recommendation_eligible: typeof song.recommendation_eligible === 'boolean' ? song.recommendation_eligible : null,
});

const groupSongs = (songs, field, normalizedField) => {
  const groups = new Map();
  // Songs arrive sorted by ID, making the first contributing label deterministic.
  for (const song of songs) {
    const raw = song.metadata[field];
    const preferred = normalizedField ? song.metadata[normalizedField] : null;
    const key = groupingKey(preferred) ?? groupingKey(raw);
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, {
        key, label: (raw ?? preferred).trim().replace(/\s+/g, ' '), song_count: 0,
        listened_seconds: 0, session_count: 0, completed_count: 0, skipped_count: 0,
        replay_count: 0, favorite_song_count: 0, playlist_membership_count: 0, last_event_at: null,
      });
    }
    const group = groups.get(key);
    group.song_count += 1;
    for (const fieldName of GROUP_TOTAL_FIELDS) group[fieldName] += song.listening[fieldName];
    group.favorite_song_count += Number(song.explicit.favorite);
    group.playlist_membership_count += song.explicit.playlist_membership_count;
    group.last_event_at = latestTime(group.last_event_at, song.listening.last_event_at);
  }
  return [...groups.values()].sort((a, b) => compareText(a.key, b.key));
};

export const createUserPreferenceAggregationService = ({
  ListeningEventModel = ListeningEvent,
  SongModel = Song,
  explicitPreferenceSignalService = createExplicitPreferenceSignalService(),
  now = () => new Date(),
} = {}) => {
  const getUserPreferenceProfile = async (input = {}) => {
    const userId = objectIdString(input?.userId);
    if (!userId) throw new Error(USER_PREFERENCE_INVALID_USER_ERROR);
    const lookbackDays = input.lookbackDays === undefined ? DEFAULT_LOOKBACK_DAYS : input.lookbackDays;
    if (!Number.isInteger(lookbackDays) || lookbackDays < MIN_LOOKBACK_DAYS || lookbackDays > MAX_LOOKBACK_DAYS) {
      throw new Error(USER_PREFERENCE_INVALID_LOOKBACK_ERROR);
    }

    try {
      const untilMs = dateMillis(now());
      const sinceMs = untilMs === null ? NaN : untilMs - lookbackDays * DAY_MS;
      const since = new Date(sinceMs);
      const until = new Date(untilMs);
      if (untilMs === null || !Number.isFinite(since.getTime())) throw new Error(USER_PREFERENCE_AGGREGATION_ERROR);
      const events = await ListeningEventModel.find({ user: userId, createdAt: { $gte: since, $lte: until } })
        .select({ ...EVENT_PROJECTION }).sort({ createdAt: 1, _id: 1 })
        .limit(MAX_LISTENING_EVENTS_PER_USER + 1).lean();
      const evidence = await explicitPreferenceSignalService.getUserExplicitPreferenceSignals({ userId });
      if (!Array.isArray(events) || !Array.isArray(evidence?.signals)
        || evidence.signals.length > MAX_FAVORITES_PER_USER + MAX_PLAYLIST_MEMBERSHIPS
        || !['favorites', 'playlists', 'memberships'].every((key) => typeof evidence.truncated?.[key] === 'boolean')) {
        throw new Error(USER_PREFERENCE_AGGREGATION_ERROR);
      }
      const result = {
        window: { lookback_days: lookbackDays, since: since.toISOString(), until: until.toISOString() },
        songs: [], genres: [], artists: [], languages: [], counts: emptyCounts(),
        truncated: {
          listeningEvents: events.length > MAX_LISTENING_EVENTS_PER_USER,
          explicitFavorites: evidence.truncated.favorites,
          explicitPlaylists: evidence.truncated.playlists,
          explicitMemberships: evidence.truncated.memberships,
        },
      };
      const bySong = new Map();
      const stateFor = (songId) => {
        if (!bySong.has(songId)) bySong.set(songId, {
          listening: emptyListening(), explicit: emptyExplicit(),
          sessions: new Set(), playlists: new Set(), eventCount: 0,
        });
        return bySong.get(songId);
      };
      const retained = events.slice(0, MAX_LISTENING_EVENTS_PER_USER + 1).sort((a, b) => (
        (dateMillis(a?.createdAt) ?? 0) - (dateMillis(b?.createdAt) ?? 0)
        || compareText(objectIdString(a?._id) ?? '', objectIdString(b?._id) ?? '')
      )).slice(0, MAX_LISTENING_EVENTS_PER_USER);
      for (const row of retained) {
        const event = validEvent(row, sinceMs, untilMs);
        if (!event) continue;
        const state = stateFor(event.songId);
        state.eventCount += 1;
        state.sessions.add(event.sessionId);
        const counter = EVENT_COUNTERS[event.type];
        if (counter) state.listening[counter] += 1;
        state.listening.listened_seconds += event.seconds;
        state.listening.last_event_at = latestTime(state.listening.last_event_at, event.at);
      }
      for (const signal of evidence.signals) {
        const songId = referenceId(signal?.song_id);
        const sourceId = objectIdString(signal?.source_id);
        if (!songId || !sourceId || !EXPLICIT_SIGNAL_TYPES.includes(signal.type)) continue;
        const state = stateFor(songId);
        if (signal.type === 'favorite') {
          const at = isoOrNull(signal.occurred_at);
          const existing = state.explicit;
          // 17/43 supplies one Favorite per song. This tie-break also makes
          // unexpected duplicate adapter output deterministic without rereads.
          const candidateTime = dateMillis(at) ?? Infinity;
          const retainedTime = dateMillis(existing.favorite_occurred_at) ?? Infinity;
          if (!existing.favorite || candidateTime < retainedTime
            || (candidateTime === retainedTime && compareText(sourceId, existing.favorite_source_id) < 0)) {
            existing.favorite = true;
            existing.favorite_source_id = sourceId;
            existing.favorite_occurred_at = at;
          }
        } else {
          state.playlists.add(sourceId);
        }
      }

      const songIds = [...bySong.keys()].sort(compareText);
      if (!songIds.length) return result;
      const documents = await SongModel.find({ _id: { $in: songIds } })
        .select({ ...SONG_PROJECTION }).limit(songIds.length).lean();
      if (!Array.isArray(documents)) throw new Error(USER_PREFERENCE_AGGREGATION_ERROR);
      const metadata = new Map(documents.map((song) => [objectIdString(song?._id), song]));
      for (const songId of songIds) {
        if (!metadata.has(songId)) continue;
        const state = bySong.get(songId);
        state.listening.session_count = state.sessions.size;
        state.explicit.playlist_source_ids = [...state.playlists].sort(compareText);
        state.explicit.playlist_membership_count = state.playlists.size;
        const song = { song_id: songId, listening: state.listening, explicit: state.explicit, metadata: metadataFor(metadata.get(songId)) };
        result.songs.push(song);
        result.counts.listening_event_count += state.eventCount;
        result.counts.song_count += 1;
        result.counts.active_favorite_count += Number(song.explicit.favorite);
        result.counts.playlist_membership_count += song.explicit.playlist_membership_count;
        result.counts.total_listened_seconds += song.listening.listened_seconds;
        for (const field of ['completed_count', 'skipped_count', 'replay_count']) result.counts[field] += song.listening[field];
      }
      result.genres = groupSongs(result.songs, 'genre', 'normalized_genre');
      result.artists = groupSongs(result.songs, 'artist', 'normalized_artist');
      result.languages = groupSongs(result.songs, 'language');
      return result;
    } catch {
      throw new Error(USER_PREFERENCE_AGGREGATION_ERROR);
    }
  };

  return { getUserPreferenceProfile };
};

export default createUserPreferenceAggregationService;
