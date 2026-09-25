import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api/client.js';
import usePlayer from '../../hooks/usePlayer.js';
import SongRow from '../../components/music/SongRow.jsx';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import './SearchView.css';

const DEFAULT_SONG_LIMIT = 50;
const CATALOG_SEARCH_LIMIT = 40;
const DEFAULT_POSTER = 'https://picsum.photos/120/120?random';

const REGION_OPTIONS = [
  { id: '', label: 'All' },
  { id: 'bn-bd', label: 'Bangla' },
  { id: 'bn-in', label: 'Kolkata' },
  { id: 'hi-in', label: 'Hindi' },
  { id: 'en', label: 'English' },
];

const mapCatalogEntryToSong = (entry) => {
  if (entry?.sourceType === 'local' && entry.song?._id) {
    return {
      ...entry.song,
      sourceType: 'local',
    };
  }
  const provider = String(entry?.provider || 'youtube');
  const providerTrackId = String(entry?.providerTrackId || entry?.youtube_id || '');
  return {
    _id: `external:${provider}:${providerTrackId || entry?.id || entry?.title || 'unknown'}`,
    title: entry?.title || 'Untitled',
    artist: entry?.artist || 'Unknown artist',
    poster_url: entry?.thumbnail || DEFAULT_POSTER,
    duration: entry?.duration || '',
    youtube_id: entry?.youtube_id || '',
    sourceType: 'external',
    provider,
    providerTrackId,
    regionTag: entry?.regionTag || null,
  };
};

export default function SearchView() {
  const {
    songs,
    favoritedIds,
    toggleFavorite,
  } = useOutletContext();
  const player = usePlayer();

  const [query, setQuery] = useState('');
  const [regionTag, setRegionTag] = useState('');
  const [songResults, setSongResults] = useState([]);
  const [userResults, setUserResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [externalState, setExternalState] = useState('skipped');
  const [importingSongIds, setImportingSongIds] = useState(() => new Set());

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setSongResults(songs.slice(0, 18));
      setUserResults([]);
      setCatalogError('');
      setExternalState('skipped');
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setCatalogError('');
      const regionQuery = regionTag ? `&region=${encodeURIComponent(regionTag)}` : '';
      const [catalogPayload, userPayload] = await Promise.all([
        api
          .get(`/api/catalog/search?q=${encodeURIComponent(trimmed)}&limit=${CATALOG_SEARCH_LIMIT}${regionQuery}`)
          .catch(() => ({ success: false })),
        trimmed.length >= 2
          ? api.get(`/api/users/search?q=${encodeURIComponent(trimmed)}&limit=12`).catch(() => ({ success: false }))
          : Promise.resolve({ success: true, users: [] }),
      ]);

      if (cancelled) return;

      let results = [];
      let nextState = 'skipped';
      if (catalogPayload?.success && Array.isArray(catalogPayload?.data?.mergedResults)) {
        results = catalogPayload.data.mergedResults.map(mapCatalogEntryToSong);
        nextState = catalogPayload.data.externalState || 'skipped';
        if (catalogPayload.data.externalState === 'error') {
          setCatalogError(catalogPayload.data.externalError || 'External catalog unavailable.');
        }
      } else {
        const fallbackPayload = await api
          .get(`/api/songs?q=${encodeURIComponent(trimmed)}&limit=${DEFAULT_SONG_LIMIT}`)
          .catch(() => ({ success: false }));
        if (cancelled) return;
        results = fallbackPayload.success && Array.isArray(fallbackPayload.songs) ? fallbackPayload.songs : [];
        nextState = 'error';
        if (results.length === 0) setCatalogError('Search failed. Please try again.');
      }

      setSongResults(results);
      setExternalState(nextState);
      setUserResults(userPayload.success && Array.isArray(userPayload.users) ? userPayload.users : []);
      setLoading(false);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, songs, regionTag]);

  const headline = useMemo(() => {
    if (!query.trim()) return 'Search songs and artists';
    return `Results for "${query.trim()}"`;
  }, [query]);

  const markImporting = (entryId, isImporting) => {
    setImportingSongIds((prev) => {
      const next = new Set(prev);
      if (isImporting) next.add(entryId);
      else next.delete(entryId);
      return next;
    });
  };

  const upsertImportedSong = (song) => {
    if (!song?._id) return;
    setSongResults((prev) => prev.map((entry) => {
      if (entry.providerTrackId && song.youtube_id && entry.providerTrackId === song.youtube_id) {
        return { ...song, sourceType: 'local' };
      }
      if (entry._id === song._id) return { ...song, sourceType: 'local' };
      return entry;
    }));
  };

  const importExternalSong = async (song) => {
    if (!song || song.sourceType !== 'external' || !song.providerTrackId) return null;
    const entryId = String(song._id);
    if (importingSongIds.has(entryId)) return null;
    markImporting(entryId, true);
    try {
      const payload = {
        provider: song.provider || 'youtube',
        providerTrackId: song.providerTrackId,
      };
      if (regionTag) payload.regionTag = regionTag;
      const data = await api.post('/api/catalog/import', payload);
      if (!data?.success || !data?.data?.song?._id) return null;
      upsertImportedSong(data.data.song);
      return data.data.song;
    } finally {
      markImporting(entryId, false);
    }
  };

  const playResult = async (index) => {
    const song = songResults[index];
    if (!song) return;
    if (song.sourceType === 'external') {
      const imported = await importExternalSong(song);
      if (!imported) return;
      player.playSong([imported], 0);
      return;
    }
    if (player.currentSong?._id === song._id) {
      player.togglePlay();
      return;
    }
    const localQueue = songResults.filter((entry) => entry.sourceType !== 'external');
    const queueIndex = localQueue.findIndex((entry) => String(entry._id) === String(song._id));
    if (queueIndex < 0) return;
    player.playSong(localQueue, queueIndex);
  };

  const handleToggleFavorite = async (song) => {
    if (!song) return;
    if (song.sourceType === 'external') {
      const imported = await importExternalSong(song);
      if (!imported?._id) return;
      await toggleFavorite(imported._id);
      return;
    }
    await toggleFavorite(song._id);
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
        <div className="search-region-chips" role="tablist" aria-label="Search regions">
          {REGION_OPTIONS.map((option) => (
            <button
              key={option.id || 'all'}
              type="button"
              className={`search-region-chip${regionTag === option.id ? ' active' : ''}`}
              aria-pressed={regionTag === option.id}
              onClick={() => setRegionTag(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="music-section app-surface" aria-busy={loading}>
        <SectionHeader
          title="Songs"
          subtitle="Playable results from your music catalog"
        />
        {loading ? (
          <p className="dashboard-status" role="status">Searching...</p>
        ) : null}
        {!loading && catalogError ? (
          <p className="search-feedback" role="status">{catalogError}</p>
        ) : null}
        {!loading && !catalogError && externalState === 'disabled' ? (
          <p className="search-feedback">External catalog is unavailable right now.</p>
        ) : null}
        {!loading && songResults.length === 0 && !catalogError ? (
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
                onToggleFavorite={() => handleToggleFavorite(song)}
                trailing={(
                  <span className={`song-source-badge${song.sourceType === 'external' ? ' external' : ''}`}>
                    {importingSongIds.has(String(song._id)) ? 'Importing...' : (song.sourceType === 'external' ? 'External' : 'Library')}
                  </span>
                )}
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
