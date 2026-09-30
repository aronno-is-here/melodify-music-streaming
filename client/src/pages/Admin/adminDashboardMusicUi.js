import { selectChordListStatus } from './chordEditorUi.js';

export const ADMIN_DASHBOARD_STAT_META = Object.freeze([
  { key: 'users', label: 'Total Users', icon: 'fa-users', source: 'stats', context: 'Registered accounts' },
  { key: 'songs', label: 'Songs', icon: 'fa-music', source: 'songs', context: 'In catalog' },
  { key: 'karaoke', label: 'Karaoke', icon: 'fa-microphone-lines', source: 'karaoke', context: 'Backing tracks' },
  { key: 'pendingReports', label: 'Pending Reports', icon: 'fa-flag', source: 'stats', context: 'Awaiting moderation' },
  { key: 'activeSubs', label: 'Active Subs', icon: 'fa-credit-card', source: 'stats', context: 'Subscriptions' },
  { key: 'plays', label: 'Plays', icon: 'fa-chart-simple', source: 'stats', context: 'All time' },
]);

export const ADMIN_DASHBOARD_MESSAGES = Object.freeze({
  STAT_LOADING: 'Loading…',
  STAT_UNAVAILABLE: 'Unavailable',
  HEALTH_UNAVAILABLE: 'Unavailable',
  QUICK_ACTIONS: 'Quick Actions',
  CONTENT_HEALTH: 'Content Health',
  REVENUE: 'Revenue',
  RECENT_PLAYS: 'Recent Plays',
  NO_RECENT_PLAYS: 'No recent plays.',
});

export const ADMIN_DASHBOARD_QUICK_ACTIONS = Object.freeze([
  { id: 'add-song', label: 'Add Song', icon: 'fa-circle-plus', section: 'music', opensAddSong: true, description: 'Add a track by YouTube ID or file upload' },
  { id: 'manage-lyrics', label: 'Manage Lyrics', icon: 'fa-file-lines', section: 'missing-lyrics', description: 'Close gaps in lyric coverage' },
  { id: 'manage-chords', label: 'Manage Chords', icon: 'fa-guitar', section: 'chords', description: 'Manage chord sheets per song' },
  { id: 'add-karaoke', label: 'Add Karaoke', icon: 'fa-microphone-lines', section: 'karaoke', description: 'Add a Studio backing track' },
  { id: 'review-reports', label: 'Review Reports', icon: 'fa-flag', section: 'moderation', description: 'Resolve pending reports' },
]);

export const ADMIN_HEALTH_LABELS = Object.freeze({
  lyricsAvailable: 'Lyrics Available',
  lyricsMissing: 'Lyrics Missing',
  chordsAvailable: 'Chords Available',
  chordsMissing: 'Chords Missing',
});

export function selectAdminStatValue(key, context) {
  const status = context && context.dataStatus ? context.dataStatus : {};
  const stats = (context && context.stats) || {};
  const songs = (context && context.songs) || [];
  const karaokeTracks = (context && context.karaokeTracks) || [];

  if (key === 'karaoke') {
    return { status: status.karaoke || 'error', value: karaokeTracks.length };
  }

  if (key === 'songs') {
    if (status.stats === 'ready' && Number.isFinite(stats.songs)) {
      return { status: 'ready', value: stats.songs };
    }
    if (status.songs === 'ready' && Number.isFinite(songs.length)) {
      return { status: 'ready', value: songs.length };
    }
    if (status.stats === 'loading' || status.songs === 'loading') {
      return { status: 'loading', value: null };
    }
    return { status: 'error', value: null };
  }

  if (key === 'users' || key === 'pendingReports' || key === 'activeSubs' || key === 'plays') {
    if (status.stats === 'ready') {
      return { status: 'ready', value: stats[key] };
    }
    return { status: status.stats || 'error', value: null };
  }

  return { status: 'error', value: null };
}

export function selectStatCardPresentation(selection) {
  const status = selection && selection.status;
  const value = selection ? selection.value : null;

  if (status === 'loading') {
    return { state: 'loading', display: ADMIN_DASHBOARD_MESSAGES.STAT_LOADING };
  }
  if (status !== 'ready') {
    return { state: 'unavailable', display: ADMIN_DASHBOARD_MESSAGES.STAT_UNAVAILABLE };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { state: 'unavailable', display: ADMIN_DASHBOARD_MESSAGES.STAT_UNAVAILABLE };
  }
  return { state: 'ready', display: String(value) };
}

export function computeAdminContentHealth(songs) {
  const list = Array.isArray(songs) ? songs : [];
  let lyricsAvailable = 0;
  let chordsAvailable = 0;

  for (const song of list) {
    const hasVerifiedLyrics = Boolean(
      song
      && song.lyrics_verified === true
      && typeof song.lyrics === 'string'
      && song.lyrics.trim().length > 0,
    );
    if (hasVerifiedLyrics) lyricsAvailable += 1;
    if (selectChordListStatus(song) !== 'Missing') chordsAvailable += 1;
  }

  const total = list.length;
  return {
    total,
    lyricsAvailable,
    lyricsMissing: total - lyricsAvailable,
    chordsAvailable,
    chordsMissing: total - chordsAvailable,
  };
}

export const ADMIN_MUSIC_MESSAGES = Object.freeze({
  LOADING: 'Loading music...',
  EMPTY: 'No songs found.',
  NO_MATCHES: 'No songs match your search.',
  ERROR: 'Unable to load music.',
  REFRESH_FAILED: 'Unable to refresh music.',
  RETRY: 'Retry',
  SEARCH_PLACEHOLDER: 'Search songs...',
  ALL_GENRES: 'All genres',
  PAGE_SUBTITLE: 'Manage songs, metadata, lyrics, chords, and playback sources.',
});

export const ADMIN_LYRICS_STATUSES = Object.freeze(['Verified', 'Available', 'Missing']);
export const ADMIN_MEDIA_SOURCES = Object.freeze(['YouTube', 'Local', 'None']);

export function selectAdminLyricsStatus(song) {
  const text = song && typeof song.lyrics === 'string' ? song.lyrics.trim() : '';
  if (!text) return 'Missing';
  return song.lyrics_verified === true ? 'Verified' : 'Available';
}

export function selectAdminMediaSource(song) {
  if (song && typeof song.youtube_id === 'string' && song.youtube_id.trim()) return 'YouTube';
  if (song && typeof song.file_path === 'string' && song.file_path.trim()) return 'Local';
  return 'None';
}

export function selectAdminBadgeTone(status) {
  if (status === 'Verified' || status === 'YouTube' || status === 'Local') return 'ok';
  if (status === 'Available') return 'info';
  if (status === 'Unverified' || status === 'Missing') return 'warn';
  return 'muted';
}

export function collectAdminCatalogGenres(songs) {
  const genres = new Set();
  for (const song of Array.isArray(songs) ? songs : []) {
    if (song && typeof song.genre === 'string' && song.genre.trim()) {
      genres.add(song.genre.trim());
    }
  }
  return Array.from(genres).sort((a, b) => a.localeCompare(b));
}

export function filterAdminCatalogSongs(songs, options = {}) {
  const list = Array.isArray(songs) ? songs : [];
  const query = String(options.query || '').trim().toLowerCase();
  const genre = options.genre || 'all';

  return list.filter((song) => {
    if (!song) return false;
    if (genre !== 'all' && (typeof song.genre !== 'string' || song.genre.trim() !== genre)) return false;
    if (!query) return true;
    return [song.title, song.artist, song.album].some(
      (field) => typeof field === 'string' && field.toLowerCase().includes(query),
    );
  });
}

export function selectAdminMusicView(options = {}) {
  const status = options.status;
  const totalSongs = options.totalSongs || 0;
  const matchCount = options.matchCount || 0;

  if (status === 'loading') return 'loading';
  if (status === 'error' && totalSongs === 0) return 'error';
  if (totalSongs === 0) return 'empty';
  if (matchCount === 0) return 'no-matches';
  return 'ready';
}

export function selectAdminMusicViewMessage(view) {
  if (view === 'loading') return ADMIN_MUSIC_MESSAGES.LOADING;
  if (view === 'error') return ADMIN_MUSIC_MESSAGES.ERROR;
  if (view === 'empty') return ADMIN_MUSIC_MESSAGES.EMPTY;
  if (view === 'no-matches') return ADMIN_MUSIC_MESSAGES.NO_MATCHES;
  return '';
}
