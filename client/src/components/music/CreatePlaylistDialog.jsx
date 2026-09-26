import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import AppDialog from '../ui/AppDialog.jsx';

const INITIAL_SUGGESTION_LIMIT = 8;
const SEARCH_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 240;

const normalizeSongs = (payload) => (
  payload?.success && Array.isArray(payload.songs) ? payload.songs : []
);

export default function CreatePlaylistDialog({ open, onClose, onCreated }) {
  const [title, setTitle] = useState('');
  const [selectedSongs, setSelectedSongs] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [baseline, setBaseline] = useState([]);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedIds = useMemo(
    () => new Set(selectedSongs.map((song) => String(song._id))),
    [selectedSongs],
  );

  useEffect(() => {
    if (!open) return undefined;

    setTitle('');
    setSelectedSongs([]);
    setSuggestions([]);
    setBaseline([]);
    setSearch('');
    setSearching(false);
    setSubmitting(false);
    setError('');

    let cancelled = false;
    api.get(`/api/songs?limit=${INITIAL_SUGGESTION_LIMIT}`)
      .then((payload) => {
        if (cancelled) return;
        const songs = normalizeSongs(payload);
        setBaseline(songs);
        setSuggestions(songs);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const term = search.trim();
    if (!term) {
      setSuggestions(baseline);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const payload = await api.get(`/api/songs?q=${encodeURIComponent(term)}&limit=${SEARCH_LIMIT}`);
        if (cancelled) return;
        setSuggestions(normalizeSongs(payload));
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, search, baseline]);

  const toggleSelect = (song) => {
    const id = String(song._id);
    setSelectedSongs((prev) => {
      const exists = prev.some((row) => String(row._id) === id);
      if (exists) return prev.filter((row) => String(row._id) !== id);
      return [...prev, song];
    });
  };

  const removeSelected = (songId) => {
    const id = String(songId);
    setSelectedSongs((prev) => prev.filter((row) => String(row._id) !== id));
  };

  const handleCreate = async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await api.post('/api/playlists', { title: trimmed });
      if (!created?.success || !created?.playlist?._id) {
        setError(created?.error || 'Unable to create the playlist right now.');
        return;
      }
      const playlistId = created.playlist._id;
      const ids = selectedSongs.map((song) => String(song._id));
      let failed = 0;
      for (const songId of ids) {
        try {
          const added = await api.post(`/api/playlists/${playlistId}/songs`, { songId });
          if (!added?.success) failed += 1;
        } catch {
          failed += 1;
        }
      }
      if (typeof onCreated === 'function') {
        onCreated(created.playlist, { failed });
      }
    } catch {
      setError('Unable to create the playlist right now.');
    } finally {
      setSubmitting(false);
    }
  };

  const trimmedTitle = title.trim();

  return (
    <AppDialog
      open={open}
      title="Create playlist"
      onClose={onClose}
      labelledBy="create-playlist-title"
      actions={(
        <>
          <button type="button" className="music-outline-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="music-pill-btn"
            onClick={handleCreate}
            disabled={!trimmedTitle || submitting}
          >
            {submitting ? 'Creating...' : 'Create'}
          </button>
        </>
      )}
    >
      <label className="create-playlist-field" htmlFor="create-playlist-name">
        Playlist name
        <input
          id="create-playlist-name"
          type="text"
          value={title}
          maxLength={80}
          placeholder="My playlist"
          onChange={(event) => setTitle(event.target.value)}
          disabled={submitting}
        />
      </label>

      <label className="create-playlist-field" htmlFor="create-playlist-search">
        Add songs
        <input
          id="create-playlist-search"
          type="search"
          value={search}
          placeholder="Search by title, artist, or album"
          onChange={(event) => setSearch(event.target.value)}
          disabled={submitting}
        />
      </label>

      {error ? (
        <p className="create-playlist-error" role="alert">{error}</p>
      ) : null}

      {selectedSongs.length > 0 ? (
        <div className="create-playlist-selected" aria-label="Selected songs">
          {selectedSongs.map((song) => (
            <span key={`selected-${song._id}`} className="create-playlist-chip">
              {song.title}
              <button
                type="button"
                aria-label={`Remove ${song.title} from selection`}
                onClick={() => removeSelected(song._id)}
                disabled={submitting}
              >
                <i className="fa-solid fa-xmark" aria-hidden="true"></i>
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="create-playlist-suggestions" aria-label="Song suggestions">
        {searching ? (
          <p className="create-playlist-status" role="status">Searching songs...</p>
        ) : suggestions.length === 0 ? (
          <p className="create-playlist-status">No songs match your search.</p>
        ) : (
          suggestions.map((song) => {
            const id = String(song._id);
            const selected = selectedIds.has(id);
            return (
              <button
                type="button"
                key={id}
                className={`create-playlist-song ${selected ? 'is-selected' : ''}`}
                aria-pressed={selected}
                onClick={() => toggleSelect(song)}
                disabled={submitting}
              >
                <img
                  className="create-playlist-art"
                  src={song.poster_url || 'https://picsum.photos/60/60?random'}
                  alt=""
                  onError={(event) => { event.currentTarget.src = 'https://picsum.photos/60/60?random'; }}
                />
                <span className="create-playlist-song-meta">
                  <span className="create-playlist-song-title">{song.title}</span>
                  <span className="create-playlist-song-artist">{song.artist}</span>
                </span>
                <span className="create-playlist-song-check" aria-hidden="true">
                  <i className={`fa-solid ${selected ? 'fa-check' : 'fa-plus'}`}></i>
                </span>
              </button>
            );
          })
        )}
      </div>
    </AppDialog>
  );
}
