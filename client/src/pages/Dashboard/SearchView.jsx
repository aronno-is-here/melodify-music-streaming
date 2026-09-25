import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api/client.js';
import usePlayer from '../../hooks/usePlayer.js';
import SongRow from '../../components/music/SongRow.jsx';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import './SearchView.css';

const DEFAULT_SONG_LIMIT = 50;

export default function SearchView() {
  const {
    songs,
    favoritedIds,
    toggleFavorite,
  } = useOutletContext();
  const player = usePlayer();

  const [query, setQuery] = useState('');
  const [songResults, setSongResults] = useState([]);
  const [userResults, setUserResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSongResults(songs.slice(0, 18));
      setUserResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const [songPayload, userPayload] = await Promise.all([
        api.get(`/api/songs?q=${encodeURIComponent(trimmed)}&limit=${DEFAULT_SONG_LIMIT}`).catch(() => ({ success: false })),
        trimmed.length >= 2
          ? api.get(`/api/users/search?q=${encodeURIComponent(trimmed)}&limit=12`).catch(() => ({ success: false }))
          : Promise.resolve({ success: true, users: [] }),
      ]);

      if (cancelled) return;
      setSongResults(songPayload.success && Array.isArray(songPayload.songs) ? songPayload.songs : []);
      setUserResults(userPayload.success && Array.isArray(userPayload.users) ? userPayload.users : []);
      setLoading(false);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, songs]);

  const headline = useMemo(() => {
    if (!query.trim()) return 'Search songs and artists';
    return `Results for "${query.trim()}"`;
  }, [query]);

  const playResult = (index) => {
    const song = songResults[index];
    if (!song) return;
    if (player.currentSong?._id === song._id) {
      player.togglePlay();
      return;
    }
    player.playSong(songResults, index);
  };

  return (
    <div className="search-view">
      <section className="search-hero app-surface">
        <h1>{headline}</h1>
        <label htmlFor="shell-search-input" className="search-input-wrap">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input
            id="shell-search-input"
            type="search"
            placeholder="Search by song title, artist, or user"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search songs and users"
          />
        </label>
      </section>

      <section className="music-section app-surface" aria-busy={loading}>
        <SectionHeader
          title="Songs"
          subtitle="Playable results from your music catalog"
        />
        {loading ? (
          <p className="dashboard-status" role="status">Searching...</p>
        ) : null}
        {!loading && songResults.length === 0 ? (
          <EmptyState icon="fa-magnifying-glass" title="No songs found" detail="Try a different song title or artist." />
        ) : null}
        {!loading && songResults.length > 0 ? (
          <div>
            {songResults.map((song, index) => (
              <SongRow
                key={`${song._id}-${index}`}
                song={song}
                isPlaying={player.isPlaying}
                isActive={player.currentSong?._id === song._id}
                isFavorited={favoritedIds.has(String(song._id))}
                onPlay={() => playResult(index)}
                onToggleFavorite={() => toggleFavorite(song._id)}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="music-section app-surface">
        <SectionHeader
          title="Users"
          subtitle="Jump directly to public user profiles"
        />
        {query.trim().length < 2 ? (
          <EmptyState icon="fa-user" title="Type at least 2 characters" detail="User search appears while you type." />
        ) : null}
        {query.trim().length >= 2 && userResults.length === 0 && !loading ? (
          <EmptyState icon="fa-user" title="No users found" detail="Try a different name or email." />
        ) : null}
        {userResults.length > 0 ? (
          <div className="search-user-grid" role="list">
            {userResults.map((entry) => (
              <Link to={`/user/${entry._id}`} className="search-user-card" key={entry._id} role="listitem">
                <span className="search-user-avatar" aria-hidden="true">
                  {entry.avatar ? <img src={entry.avatar} alt="" /> : (entry.name?.charAt(0)?.toUpperCase() || 'U')}
                </span>
                <span className="search-user-meta">
                  <span className="search-user-name">{entry.name}</span>
                  <span className="search-user-email">{entry.email}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
