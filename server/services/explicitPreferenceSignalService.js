import mongoose from 'mongoose';
import Favorite from '../models/Favorite.js';
import Playlist from '../models/Playlist.js';
import Song from '../models/Song.js';
import User from '../models/User.js';

export const EXPLICIT_SIGNAL_TYPES = Object.freeze(['favorite', 'playlist-membership']);
export const MAX_FAVORITES_PER_USER = 1000;
export const MAX_PLAYLISTS_PER_USER = 250;
// Bounds both raw item inspection (including invalid/duplicate entries) and output.
export const MAX_PLAYLIST_MEMBERSHIPS = 5000;
export const EXPLICIT_SIGNAL_LOADING_ERROR = 'Explicit preference signal loading failed';
export const EXPLICIT_SIGNAL_INVALID_USER_ERROR = 'Invalid explicit preference user';

const objectIdString = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)) return value.toLowerCase();
  return null;
};

// Accept one populated-reference level; never coerce or recursively walk objects.
const referenceId = (value) => objectIdString(value)
  ?? (value && typeof value === 'object' && !Array.isArray(value) ? objectIdString(value._id) : null);

const factualTimestamp = (value) => {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const compareSources = (a, b) => compareText(referenceId(a?._id) ?? '', referenceId(b?._id) ?? '');
const compareSignals = (a, b) => compareText(a.type, b.type)
  || compareText(a.song_id, b.song_id) || compareText(a.source_id, b.source_id);

// Prefer the earliest known factual time, then the lowest source ID. Unknown
// times sort last; this policy applies only inside the bounded source window.
const preferEvidence = (candidate, retained) => {
  if (!retained) return true;
  if (candidate.occurred_at !== retained.occurred_at) {
    if (candidate.occurred_at === null) return false;
    if (retained.occurred_at === null) return true;
    return Date.parse(candidate.occurred_at) < Date.parse(retained.occurred_at);
  }
  return compareText(candidate.source_id, retained.source_id) < 0;
};

const emptyResult = () => ({
  signals: [],
  counts: { favorites: 0, playlistMemberships: 0, total: 0 },
  truncated: { favorites: false, playlists: false, memberships: false },
});

export const createExplicitPreferenceSignalService = ({
  FavoriteModel = Favorite,
  PlaylistModel = Playlist,
  SongModel = Song,
  UserModel = User,
} = {}) => {
  const getUserExplicitPreferenceSignals = async (input = {}) => {
    // Only the direct trusted ID is accepted, not nested users or caller emails.
    const userId = objectIdString(input?.userId);
    if (!userId) throw new Error(EXPLICIT_SIGNAL_INVALID_USER_ERROR);

    try {
      const result = emptyResult();
      // Playlist ownership is email-based in the existing schema/routes. Resolve
      // it from persisted identity instead of accepting an alternate caller scope.
      const user = await UserModel.findOne({ _id: userId }).select({ _id: 1, email: 1 }).lean();
      if (!user) return result;
      if (referenceId(user._id) !== userId || typeof user.email !== 'string' || !user.email.trim()) {
        throw new Error(EXPLICIT_SIGNAL_LOADING_ERROR);
      }

      // One extra source row detects truncation; it never contributes evidence.
      const favorites = await FavoriteModel.find({ user: userId })
        .select({ _id: 1, user: 1, song: 1, createdAt: 1 })
        .sort({ _id: 1 }).limit(MAX_FAVORITES_PER_USER + 1).lean();
      const playlists = await PlaylistModel.find({ user_email: user.email })
        .select({ _id: 1, user_email: 1, items: { $slice: MAX_PLAYLIST_MEMBERSHIPS + 1 } })
        .sort({ _id: 1 }).limit(MAX_PLAYLISTS_PER_USER + 1).lean();
      if (!Array.isArray(favorites) || !Array.isArray(playlists)) {
        throw new Error(EXPLICIT_SIGNAL_LOADING_ERROR);
      }
      result.truncated.favorites = favorites.length > MAX_FAVORITES_PER_USER;
      result.truncated.playlists = playlists.length > MAX_PLAYLISTS_PER_USER;

      const byFavoriteSong = new Map();
      for (const favorite of [...favorites].sort(compareSources).slice(0, MAX_FAVORITES_PER_USER)) {
        if (referenceId(favorite?.user) !== userId) continue;
        const songId = referenceId(favorite.song);
        const sourceId = objectIdString(favorite._id);
        if (!songId || !sourceId) continue;
        const signal = {
          type: EXPLICIT_SIGNAL_TYPES[0], song_id: songId, source_id: sourceId,
          occurred_at: factualTimestamp(favorite.createdAt),
        };
        if (preferEvidence(signal, byFavoriteSong.get(songId))) byFavoriteSong.set(songId, signal);
      }

      const memberships = new Map();
      let inspectedItems = 0;
      playlistScan:
      for (const playlist of [...playlists].sort(compareSources).slice(0, MAX_PLAYLISTS_PER_USER)) {
        const sourceId = objectIdString(playlist?._id);
        if (!sourceId || playlist.user_email !== user.email || !Array.isArray(playlist.items)) continue;
        for (const item of playlist.items) {
          if (inspectedItems === MAX_PLAYLIST_MEMBERSHIPS) {
            result.truncated.memberships = true;
            break playlistScan;
          }
          inspectedItems += 1;
          if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
          const songId = referenceId(item.songId);
          if (!songId) continue;
          const signal = {
            type: EXPLICIT_SIGNAL_TYPES[1], song_id: songId, source_id: sourceId,
            occurred_at: factualTimestamp(item.addedAt),
          };
          const key = `${sourceId}:${songId}`;
          if (preferEvidence(signal, memberships.get(key))) memberships.set(key, signal);
        }
      }

      const candidates = [...byFavoriteSong.values(), ...memberships.values()];
      const songIds = [...new Set(candidates.map((signal) => signal.song_id))].sort(compareText);
      if (!songIds.length) return result;
      const songs = await SongModel.find({ _id: { $in: songIds } })
        .select({ _id: 1 }).limit(songIds.length).lean();
      if (!Array.isArray(songs)) throw new Error(EXPLICIT_SIGNAL_LOADING_ERROR);
      const existing = new Set(songs.map((song) => objectIdString(song?._id)).filter(Boolean));
      result.signals = candidates.filter((signal) => existing.has(signal.song_id)).sort(compareSignals);
      result.counts.favorites = result.signals.filter((signal) => signal.type === EXPLICIT_SIGNAL_TYPES[0]).length;
      result.counts.playlistMemberships = result.signals.length - result.counts.favorites;
      result.counts.total = result.signals.length;
      return result;
    } catch {
      // Never attach the original error, query, or persistence details.
      throw new Error(EXPLICIT_SIGNAL_LOADING_ERROR);
    }
  };

  return { getUserExplicitPreferenceSignals };
};

export default createExplicitPreferenceSignalService;
