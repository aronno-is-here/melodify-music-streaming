import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import usePlayer from '../../hooks/usePlayer.js';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import SongRow from '../../components/music/SongRow.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import AppDialog from '../../components/ui/AppDialog.jsx';
import cssRaw from './Playlist.css?raw';

const DEFAULT_POSTER = 'https://picsum.photos/120/120?random';

function parseDuration(durationText) {
  if (!durationText) return 0;
  const parts = String(durationText).split(':').map(Number);
  if (parts.length === 2) return (parts[0] * 60) + parts[1];
  if (parts.length === 3) return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  return 0;
}

function formatPlaylistLength(items) {
  const totalSeconds = items.reduce((sum, item) => sum + parseDuration(item.songId?.duration), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes} min ${seconds} sec`;
}

function formatAddedDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Recently';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function normalizeSearchSongs(payload, existingIds) {
  if (!payload?.success || !Array.isArray(payload.songs)) return [];
  return payload.songs.filter((song) => !existingIds.has(String(song._id)));
}

export default function Playlist() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Playlist');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { id } = useParams();
  const {
    user,
    favoritedIds,
    toggleFavorite,
  } = useOutletContext();
  const player = usePlayer();

  const [playlist, setPlaylist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState({ tone: '', text: '' });
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');

  const items = playlist?.items || [];
  const songs = useMemo(() => items.map((item) => item.songId).filter(Boolean), [items]);
  const existingIds = useMemo(() => new Set(songs.map((song) => String(song._id))), [songs]);
  const playingId = player.currentSong?._id ? String(player.currentSong._id) : null;

  useEffect(() => {
    let cancelled = false;

    const fetchPlaylist = async () => {
      setLoading(true);
      const data = await api.get(`/api/playlists/${id}`);
      if (cancelled) return;

      if (data.success) {
        setPlaylist(data.playlist);
        setRenameValue(data.playlist?.title || '');
        setNotFound(false);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    };

    fetchPlaylist();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const term = search.trim();
    if (!term) {
      setSearchResults([]);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      const payload = await api.get(`/api/songs?q=${encodeURIComponent(term)}&limit=20`);
      if (cancelled) return;
      setSearchResults(normalizeSearchSongs(payload, existingIds));
      setSearching(false);
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, existingIds]);

  const openRenameDialog = () => {
    setRenameValue(playlist?.title || '');
    setRenameOpen(true);
  };

  const addSong = async (songId) => {
    const data = await api.post(`/api/playlists/${id}/songs`, { songId });
    if (data.success) {
      setPlaylist(data.playlist);
      setSearchResults((prev) => prev.filter((song) => String(song._id) !== String(songId)));
      setStatus({ tone: 'success', text: 'Song added to playlist.' });
    } else {
      setStatus({ tone: 'error', text: data.error || 'Unable to add this song right now.' });
    }
  };

  const removeSong = async (songId) => {
    const data = await api.del(`/api/playlists/${id}/songs/${songId}`);
    if (data.success) {
      setPlaylist(data.playlist);
      setStatus({ tone: 'success', text: 'Song removed from playlist.' });
    } else {
      setStatus({ tone: 'error', text: data.error || 'Unable to remove this song right now.' });
    }
  };

  const renamePlaylist = async () => {
    const nextTitle = renameValue.trim();
    if (!nextTitle || nextTitle === playlist?.title) {
      setRenameOpen(false);
      return;
    }

    const data = await api.put(`/api/playlists/${id}`, { title: nextTitle });
    if (data.success) {
      setPlaylist(data.playlist);
      setStatus({ tone: 'success', text: 'Playlist name updated.' });
      setRenameOpen(false);
    } else {
      setStatus({ tone: 'error', text: data.error || 'Unable to rename this playlist right now.' });
    }
  };

  const deletePlaylist = async () => {
    const data = await api.del(`/api/playlists/${id}`);
    if (data.success) {
      window.location.href = '/library';
      return;
    }
    setStatus({ tone: 'error', text: data.error || 'Unable to delete this playlist right now.' });
  };

  const copyShareLink = async () => {
    try {
      await navigator.clipboard?.writeText(window.location.href);
      setStatus({ tone: 'success', text: 'Playlist link copied to clipboard.' });
      setShareOpen(false);
    } catch {
      setStatus({ tone: 'error', text: 'Could not copy link. You can copy it manually below.' });
    }
  };

  const playAll = () => {
    const firstSong = songs[0];
    if (!firstSong) return;
    if (playingId === String(firstSong._id)) {
      player.togglePlay();
      return;
    }
    player.playSong(songs, 0);
  };

  const playRow = (rowIndex) => {
    const song = songs[rowIndex];
    if (!song) return;
    if (playingId === String(song._id)) {
      player.togglePlay();
      return;
    }
    player.playSong(songs, rowIndex);
  };

  const downloadSong = (song) => {
    if (song.youtube_id) {
      window.open(`https://www.youtube.com/watch?v=${song.youtube_id}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (song.file_path) {
      window.open(`/assets/${song.file_path.replace(/^assets\//, '')}`, '_blank', 'noopener,noreferrer');
    }
  };

  if (notFound) {
    return (
      <div className="playlist-page">
        <section className="music-section app-surface playlist-state">
          <EmptyState
            icon="fa-circle-exclamation"
            title="Playlist not found"
            detail="The playlist might be deleted or unavailable to your account."
          />
          <Link to="/library" className="music-outline-btn playlist-state-action">Back to Library</Link>
        </section>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="playlist-page">
        <section className="music-section app-surface playlist-state" aria-busy="true">
          <p className="playlist-status" role="status">Loading playlist...</p>
        </section>
      </div>
    );
  }

  const coverLetters = playlist?.title?.trim().slice(0, 3).toUpperCase() || 'MEL';

  return (
    <div className="playlist-page">
      <section className="playlist-hero app-surface">
        <div className="playlist-cover" aria-hidden="true">{coverLetters}</div>
        <div className="playlist-meta">
          <p className="playlist-kicker">Public Playlist</p>
          <h1>{playlist.title}</h1>
          <p className="playlist-owner">{user?.name || user?.email || playlist.user_email}</p>
          <p className="playlist-count">{items.length} songs • {formatPlaylistLength(items)}</p>

          <div className="playlist-actions">
            <button type="button" className="music-pill-btn" onClick={playAll}>
              <i className="fa-solid fa-play" aria-hidden="true"></i>
              Play All
            </button>
            <button type="button" className="music-outline-btn" onClick={openRenameDialog}>Rename</button>
            <button type="button" className="music-outline-btn" onClick={() => setShareOpen(true)}>Share</button>
            <button type="button" className="music-outline-btn playlist-danger" onClick={() => setDeleteOpen(true)}>Delete</button>
          </div>
        </div>
      </section>

      {status.text ? (
        <p className={`playlist-feedback ${status.tone === 'error' ? 'error' : 'success'}`} role="status" aria-live="polite">
          {status.text}
        </p>
      ) : null}

      <section className="music-section app-surface">
        <SectionHeader
          title="Playlist Songs"
          subtitle="Tap play on any row to start from that song"
        />

        {items.length === 0 ? (
          <EmptyState
            icon="fa-compact-disc"
            title="No songs in this playlist yet"
            detail="Use the search area below to add songs."
          />
        ) : (
          <div>
            {items.map((item, rowIndex) => {
              const song = item.songId;
              if (!song) return null;

              return (
                <SongRow
                  key={`${song._id}-${rowIndex}`}
                  song={song}
                  subtitle={`${song.artist} • ${song.genre || 'Genre unavailable'} • Added ${formatAddedDate(item.addedAt)}`}
                  isPlaying={player.isPlaying}
                  isActive={playingId === String(song._id)}
                  isFavorited={favoritedIds.has(String(song._id))}
                  onPlay={() => playRow(rowIndex)}
                  onToggleFavorite={() => toggleFavorite(song._id)}
                  trailing={(
                    <div className="playlist-row-actions">
                      <span className="playlist-duration">{song.duration || '0:00'}</span>
                      <button
                        type="button"
                        className="music-icon-control"
                        aria-label={`Remove ${song.title} from playlist`}
                        onClick={() => removeSong(song._id)}
                      >
                        <i className="fa-solid fa-trash-can" aria-hidden="true"></i>
                      </button>
                      <button
                        type="button"
                        className="music-icon-control"
                        aria-label={`Open source for ${song.title}`}
                        onClick={() => downloadSong(song)}
                      >
                        <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
                      </button>
                    </div>
                  )}
                />
              );
            })}
          </div>
        )}
      </section>

      <section className="music-section app-surface">
        <SectionHeader
          title="Add Songs"
          subtitle="Search the catalog and add tracks to this playlist"
        />
        <label className="playlist-search-wrap" htmlFor="playlist-search">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input
            id="playlist-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search songs, artists, or genre"
          />
        </label>

        {search.trim() ? (
          <div className="playlist-search-results" aria-busy={searching}>
            {searching ? (
              <p className="playlist-status" role="status">Searching songs...</p>
            ) : searchResults.length === 0 ? (
              <p className="playlist-status" role="status">No matching songs found.</p>
            ) : (
              searchResults.map((song) => (
                <div key={song._id} className="playlist-search-row">
                  <img
                    src={song.poster_url || DEFAULT_POSTER}
                    alt=""
                    className="playlist-search-art"
                    onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
                  />
                  <div className="playlist-search-meta">
                    <strong>{song.title}</strong>
                    <span>{song.artist}</span>
                  </div>
                  <button
                    type="button"
                    className="music-outline-btn"
                    onClick={() => addSong(song._id)}
                  >
                    Add
                  </button>
                </div>
              ))
            )}
          </div>
        ) : null}
      </section>

      <AppDialog
        open={renameOpen}
        title="Rename playlist"
        onClose={() => setRenameOpen(false)}
        labelledBy="playlist-rename-title"
        actions={(
          <>
            <button type="button" className="music-outline-btn" onClick={() => setRenameOpen(false)}>Cancel</button>
            <button type="button" className="music-pill-btn" onClick={renamePlaylist}>Save</button>
          </>
        )}
      >
        <label className="playlist-dialog-field" htmlFor="playlist-new-title">
          Playlist name
          <input
            id="playlist-new-title"
            type="text"
            value={renameValue}
            maxLength={80}
            onChange={(event) => setRenameValue(event.target.value)}
          />
        </label>
      </AppDialog>

      <AppDialog
        open={deleteOpen}
        title="Delete playlist"
        onClose={() => setDeleteOpen(false)}
        labelledBy="playlist-delete-title"
        actions={(
          <>
            <button type="button" className="music-outline-btn" onClick={() => setDeleteOpen(false)}>Cancel</button>
            <button type="button" className="music-pill-btn playlist-danger-btn" onClick={deletePlaylist}>Delete</button>
          </>
        )}
      >
        <p className="playlist-dialog-copy">
          This permanently deletes <strong>{playlist?.title}</strong>. This action cannot be undone.
        </p>
      </AppDialog>

      <AppDialog
        open={shareOpen}
        title="Share playlist"
        onClose={() => setShareOpen(false)}
        labelledBy="playlist-share-title"
        actions={(
          <>
            <button type="button" className="music-outline-btn" onClick={() => setShareOpen(false)}>Close</button>
            <button type="button" className="music-pill-btn" onClick={copyShareLink}>Copy Link</button>
          </>
        )}
      >
        <label className="playlist-dialog-field" htmlFor="playlist-share-url">
          Playlist URL
          <input id="playlist-share-url" type="text" readOnly value={window.location.href} />
        </label>
      </AppDialog>
    </div>
  );
}
