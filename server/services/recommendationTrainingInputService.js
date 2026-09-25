import mongoose from 'mongoose';
import ListeningEvent from '../models/ListeningEvent.js';
import Song from '../models/Song.js';
import User from '../models/User.js';
import Favorite from '../models/Favorite.js';
import Playlist from '../models/Playlist.js';

export const DEFAULT_RETRAIN_SNAPSHOT_LIMIT = 20;
export const MAX_RETRAIN_SNAPSHOT_LIMIT = 100;
export const MAX_RAW_EVENTS = 250000;
export const MAX_UNIQUE_USERS = 50000;
export const MAX_UNIQUE_SONGS = 25000;
export const MAX_EVENT_LOOKAHEAD = MAX_RAW_EVENTS + 1;
export const MAX_SONG_LOOKAHEAD = MAX_UNIQUE_SONGS + 1;
export const MAX_USER_LOOKAHEAD = MAX_UNIQUE_USERS + 1;
export const RETRAIN_INPUT_SCHEMA_VERSION = 1;
export const RETRAIN_RANDOM_SEED = 42;

export const RETRAINING_FAILURE_CODES = Object.freeze({
  ALREADY_RUNNING: 'RETRAIN_ALREADY_RUNNING',
  INPUT_LIMIT: 'TRAINING_INPUT_LIMIT_EXCEEDED',
  INSUFFICIENT: 'INSUFFICIENT_TRAINING_DATA',
  TIMEOUT: 'PYTHON_TIMEOUT',
  PYTHON_FAILED: 'PYTHON_FAILED',
  PYTHON_OUTPUT_INVALID: 'PYTHON_OUTPUT_INVALID',
  ARTIFACT_CONFLICT: 'ARTIFACT_VERSION_CONFLICT',
  EVAL_PERSIST: 'EVALUATION_PERSIST_FAILED',
  SNAPSHOT_PERSIST: 'SNAPSHOT_PERSIST_FAILED',
  INTERNAL: 'RETRAIN_INTERNAL_ERROR',
});

export const RETRAINING_HTTP_MESSAGES = Object.freeze({
  invalidQuery: 'invalid recommendation health query',
  failed: 'failed to load retraining health',
});

export class RecommendationTrainingInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecommendationTrainingInputError';
  }
}

export class RecommendationTrainingInputLimitError extends RecommendationTrainingInputError {
  constructor(message) {
    super(message);
    this.name = 'RecommendationTrainingInputLimitError';
  }
}

export class RecommendationTrainingInputReadError extends RecommendationTrainingInputError {
  constructor(message) {
    super(message);
    this.name = 'RecommendationTrainingInputReadError';
  }
}

const objectIdHex = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)) {
    return value.toLowerCase();
  }
  if (
    value
    && typeof value === 'object'
    && typeof value.toHexString === 'function'
  ) {
    try {
      return value.toHexString().toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
};

const nonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

const isEligibleSong = (song) => song.recommendation_eligible !== false;

const normalizeOptionalText = (value) =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const normalizeCreatedAt = (value) => {
  if (value instanceof Date) {
    const time = value.getTime();
    if (Number.isNaN(time)) return null;
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }
  return null;
};

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const buildSongEntry = (song) => {
  const id = objectIdHex(song._id);
  if (!id) return null;
  return {
    _id: id,
    artist: normalizeOptionalText(song.artist),
    genre: normalizeOptionalText(song.genre),
    language: normalizeOptionalText(song.language),
    category: normalizeOptionalText(song.category),
  };
};

const normalizeEvent = (event) => {
  const id = objectIdHex(event._id);
  const user = objectIdHex(event.user);
  const song = objectIdHex(event.song);
  const createdAt = normalizeCreatedAt(event.createdAt);
  if (!id || !user || !song || !createdAt) return null;
  if (!nonEmptyString(event.session_id)) return null;
  if (typeof event.sequence !== 'number' || !Number.isInteger(event.sequence)) {
    return null;
  }
  if (!nonEmptyString(event.event_type)) return null;
  const entry = {
    _id: id,
    user,
    song,
    session_id: event.session_id,
    sequence: event.sequence,
    event_type: event.event_type,
    createdAt,
  };
  if (
    typeof event.listened_seconds_delta === 'number'
    && Number.isFinite(event.listened_seconds_delta)
  ) {
    entry.listened_seconds_delta = event.listened_seconds_delta;
  }
  return entry;
};

const buildProfileMap = async ({
  userIds,
  FavoriteModel,
  PlaylistModel,
  UserModel,
}) => {
  const profiles = {};
  if (userIds.length === 0) return profiles;

  const favorites = await FavoriteModel.find({ user: { $in: userIds } })
    .select({ _id: 0, user: 1, song: 1 })
    .limit(1000 * userIds.length + 1)
    .lean();
  if (!Array.isArray(favorites)) {
    throw new RecommendationTrainingInputReadError(
      'failed to load retraining input',
    );
  }

  const favoriteByUser = new Map();
  for (const favorite of favorites) {
    const userId = objectIdHex(favorite?.user);
    const songId = objectIdHex(favorite?.song);
    if (!userId || !songId) continue;
    if (!favoriteByUser.has(userId)) favoriteByUser.set(userId, new Set());
    favoriteByUser.get(userId).add(songId);
  }

  const users = await UserModel.find({ _id: { $in: userIds } })
    .select({ _id: 1, email: 1 })
    .limit(userIds.length)
    .lean();
  if (!Array.isArray(users)) {
    throw new RecommendationTrainingInputReadError(
      'failed to load retraining input',
    );
  }

  const emailByUser = new Map();
  const emails = [];
  for (const user of users) {
    const userId = objectIdHex(user._id);
    if (!userId || !nonEmptyString(user.email)) continue;
    emailByUser.set(userId, user.email);
    emails.push(user.email);
  }

  const playlistSongCounts = new Map();
  if (emails.length > 0) {
    const playlists = await PlaylistModel.find({ user_email: { $in: emails } })
      .select({ _id: 0, user_email: 1, items: 1 })
      .limit(250 * emails.length + 1)
      .lean();
    if (!Array.isArray(playlists)) {
      throw new RecommendationTrainingInputReadError(
        'failed to load retraining input',
      );
    }
    const userIdByEmail = new Map();
    for (const [userId, email] of emailByUser) userIdByEmail.set(email, userId);
    for (const playlist of playlists) {
      const userId = userIdByEmail.get(playlist?.user_email);
      if (!userId || !Array.isArray(playlist.items)) continue;
      for (const item of playlist.items) {
        const songId = objectIdHex(item?.songId);
        if (!songId) continue;
        if (!playlistSongCounts.has(userId)) {
          playlistSongCounts.set(userId, new Map());
        }
        const counts = playlistSongCounts.get(userId);
        counts.set(songId, (counts.get(songId) ?? 0) + 1);
      }
    }
  }

  for (const userId of userIds) {
    const favoriteSet = favoriteByUser.get(userId);
    const playlistCounts = playlistSongCounts.get(userId);
    const favoriteSongIds = favoriteSet
      ? [...favoriteSet].sort(compareText)
      : [];
    const playlistSongCountsOut = {};
    if (playlistCounts) {
      for (const songId of [...playlistCounts.keys()].sort(compareText)) {
        playlistSongCountsOut[songId] = playlistCounts.get(songId);
      }
    }
    if (favoriteSongIds.length === 0 && Object.keys(playlistSongCountsOut).length === 0) {
      profiles[userId] = null;
      continue;
    }
    profiles[userId] = {
      favorite_song_ids: favoriteSongIds,
      playlist_song_counts: playlistSongCountsOut,
    };
  }

  return profiles;
};

export function createRecommendationTrainingInputService({
  SongModel = Song,
  UserModel = User,
  ListeningEventModel = ListeningEvent,
  FavoriteModel = Favorite,
  PlaylistModel = Playlist,
} = {}) {
  if (typeof SongModel?.find !== 'function') {
    throw new RecommendationTrainingInputError('invalid song model');
  }
  if (typeof UserModel?.find !== 'function') {
    throw new RecommendationTrainingInputError('invalid user model');
  }
  if (typeof ListeningEventModel?.find !== 'function') {
    throw new RecommendationTrainingInputError('invalid listening event model');
  }

  const collectRetrainingInput = async () => {
    try {
      const songDocs = await SongModel.find({
        recommendation_eligible: { $ne: false },
      })
        .select({
          _id: 1,
          artist: 1,
          genre: 1,
          language: 1,
          category: 1,
          recommendation_eligible: 1,
        })
        .sort({ _id: 1 })
        .limit(MAX_SONG_LOOKAHEAD)
        .lean();
      if (!Array.isArray(songDocs)) {
        throw new RecommendationTrainingInputReadError(
          'failed to load retraining input',
        );
      }
      if (songDocs.length > MAX_UNIQUE_SONGS) {
        throw new RecommendationTrainingInputLimitError(
          'song_count exceeds limit',
        );
      }
      const songs = [];
      const songIds = new Set();
      for (const doc of songDocs) {
        if (!isEligibleSong(doc)) continue;
        const entry = buildSongEntry(doc);
        if (!entry) continue;
        songs.push(entry);
        songIds.add(entry._id);
      }
      if (songs.length === 0) {
        throw new RecommendationTrainingInputLimitError('songs must be non-empty');
      }

      const userDocs = await UserModel.find({})
        .select({ _id: 1 })
        .sort({ _id: 1 })
        .limit(MAX_USER_LOOKAHEAD)
        .lean();
      if (!Array.isArray(userDocs)) {
        throw new RecommendationTrainingInputReadError(
          'failed to load retraining input',
        );
      }
      if (userDocs.length > MAX_UNIQUE_USERS) {
        throw new RecommendationTrainingInputLimitError(
          'user_count exceeds limit',
        );
      }
      const users = [];
      for (const doc of userDocs) {
        const id = objectIdHex(doc._id);
        if (id) users.push(id);
      }

      const eventDocs = await ListeningEventModel.find({})
        .select({
          _id: 1,
          user: 1,
          song: 1,
          session_id: 1,
          sequence: 1,
          event_type: 1,
          listened_seconds_delta: 1,
          createdAt: 1,
        })
        .sort({ createdAt: -1, _id: -1 })
        .limit(MAX_EVENT_LOOKAHEAD)
        .lean();
      if (!Array.isArray(eventDocs)) {
        throw new RecommendationTrainingInputReadError(
          'failed to load retraining input',
        );
      }
      const eventWindowTruncated = eventDocs.length > MAX_RAW_EVENTS;
      const windowDocs = eventWindowTruncated
        ? eventDocs.slice(0, MAX_RAW_EVENTS)
        : eventDocs;
      const events = [];
      for (let index = windowDocs.length - 1; index >= 0; index -= 1) {
        const entry = normalizeEvent(windowDocs[index]);
        if (entry) events.push(entry);
      }

      const eventUserIds = new Set();
      for (const event of events) eventUserIds.add(event.user);
      const profileUserIds = users.filter((id) => eventUserIds.has(id));
      const profiles = await buildProfileMap({
        userIds: profileUserIds,
        FavoriteModel,
        PlaylistModel,
        UserModel,
      });

      return {
        schema_version: RETRAIN_INPUT_SCHEMA_VERSION,
        songs,
        users,
        events,
        profiles,
        event_window_truncated: eventWindowTruncated,
        unique_song_count: songs.length,
        unique_user_count: users.length,
        input_event_count: events.length,
      };
    } catch (error) {
      if (error instanceof RecommendationTrainingInputError) throw error;
      throw new RecommendationTrainingInputReadError(
        'failed to load retraining input',
      );
    }
  };

  return { collectRetrainingInput };
}

export default createRecommendationTrainingInputService;
