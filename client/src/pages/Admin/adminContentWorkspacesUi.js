import { selectChordListStatus } from './chordEditorUi.js';

export const ADMIN_CHORD_MESSAGES = Object.freeze({
  LOADING: 'Loading chords...',
  EMPTY: 'No songs in the catalog.',
  NO_MATCHES: 'No songs match the current filters.',
  ERROR: 'Unable to load chords.',
  REFRESH_FAILED: 'Unable to refresh chords.',
  RETRY: 'Retry',
  SEARCH_PLACEHOLDER: 'Search songs or artists...',
  FILTER_STATUS: 'Filter by chord status',
  PAGE_SUBTITLE: 'Manage, import, verify, and update chord sheets for songs in the Melodify catalog.',
  OPEN_SOURCE: 'Open Source',
});

export const ADMIN_CHORD_STATUS_FILTERS = Object.freeze([
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Available' },
  { value: 'missing', label: 'Missing' },
  { value: 'verified', label: 'Verified' },
  { value: 'unverified', label: 'Unverified' },
]);

export function filterAdminChordSongs(songs, options = {}) {
  const list = Array.isArray(songs) ? songs : [];
  const query = String(options.query || '').trim().toLowerCase();
  const status = options.status || 'all';

  return list.filter((song) => {
    if (!song) return false;
    const chordStatus = selectChordListStatus(song);
    if (status === 'missing' && chordStatus !== 'Missing') return false;
    if (status === 'verified' && chordStatus !== 'Verified') return false;
    if (status === 'unverified' && chordStatus !== 'Unverified') return false;
    if (status === 'available' && chordStatus === 'Missing') return false;
    if (!query) return true;
    return [song.title, song.artist, song.album].some(
      (field) => typeof field === 'string' && field.toLowerCase().includes(query),
    );
  });
}

export function selectAdminChordView(options = {}) {
  const status = options.status;
  const totalSongs = options.totalSongs || 0;
  const matchCount = options.matchCount || 0;

  if (status === 'loading') return 'loading';
  if (status === 'error' && totalSongs === 0) return 'error';
  if (totalSongs === 0) return 'empty';
  if (matchCount === 0) return 'no-matches';
  return 'ready';
}

export function selectAdminChordViewMessage(view) {
  if (view === 'loading') return ADMIN_CHORD_MESSAGES.LOADING;
  if (view === 'error') return ADMIN_CHORD_MESSAGES.ERROR;
  if (view === 'empty') return ADMIN_CHORD_MESSAGES.EMPTY;
  if (view === 'no-matches') return ADMIN_CHORD_MESSAGES.NO_MATCHES;
  return '';
}

export const ADMIN_KARAOKE_MESSAGES = Object.freeze({
  LOADING: 'Loading karaoke...',
  EMPTY: 'No karaoke tracks available.',
  ERROR: 'Unable to load karaoke content.',
  REFRESH_FAILED: 'Unable to refresh karaoke content.',
  RETRY: 'Retry',
  ADDED: 'Karaoke added successfully.',
  ADD_FAILED: 'Failed to add karaoke track.',
  UPLOAD_FAILED: 'Upload failed.',
  PAGE_SUBTITLE: 'Manage karaoke tracks and content used by Melodify Studio.',
  LIBRARY_TITLE: 'Karaoke Library',
  ADD_TITLE: 'Add Karaoke',
  LIBRARY_HINT: 'Backing tracks available in Melodify Studio for karaoke recording.',
  ADD_HINT: 'Add a YouTube backing track or upload an audio file for Melodify Studio.',
});

export function selectAdminKaraokeView(options = {}) {
  const status = options.status;
  const totalTracks = options.totalTracks || 0;

  if (status === 'loading') return 'loading';
  if (status === 'error' && totalTracks === 0) return 'error';
  if (totalTracks === 0) return 'empty';
  return 'ready';
}

export function selectAdminKaraokeViewMessage(view) {
  if (view === 'loading') return ADMIN_KARAOKE_MESSAGES.LOADING;
  if (view === 'error') return ADMIN_KARAOKE_MESSAGES.ERROR;
  if (view === 'empty') return ADMIN_KARAOKE_MESSAGES.EMPTY;
  return '';
}

export function selectKaraokeSource(track) {
  const record = track && typeof track === 'object' ? track : {};
  if (typeof record.youtube_id === 'string' && record.youtube_id.trim()) return 'YouTube';
  if (typeof record.file_path === 'string' && record.file_path.trim()) return 'Uploaded';
  return 'None';
}

export function selectKaraokeSourceTone(source) {
  if (source === 'YouTube') return 'info';
  if (source === 'Uploaded') return 'ok';
  return 'muted';
}

export function selectKaraokeAvailability(track) {
  const record = track && typeof track === 'object' ? track : {};
  return record.available === false ? 'Hidden' : 'Available';
}

export function selectKaraokeAvailabilityTone(availability) {
  return availability === 'Available' ? 'ok' : 'muted';
}
