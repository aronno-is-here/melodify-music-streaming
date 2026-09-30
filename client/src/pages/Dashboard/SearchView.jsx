import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api/client.js';
import usePlayer from '../../hooks/usePlayer.js';
import SongRow from '../../components/music/SongRow.jsx';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import './SearchView.css';

const DEFAULT_SONG_LIMIT = 50;
const CATALOG_SEARCH_LIMIT = 40;
const PEOPLE_SEARCH_LIMIT = 12;
const SEARCH_DEBOUNCE_MS = 250;
const DEFAULT_POSTER = 'https://picsum.photos/120/120?random';

const SONGS_TAB_ID = 'search-tab-songs';
const PEOPLE_TAB_ID = 'search-tab-people';
const SONGS_PANEL_ID = 'search-panel-songs';
const PEOPLE_PANEL_ID = 'search-panel-people';

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
    favoritedIds,
    toggleFavorite,
  } = useOutletContext();
  const player = usePlayer();

  const [mode, setMode] = useState('songs');
  const [songQuery, setSongQuery] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [regionTag, setRegionTag] = useState('');
  const [songResults, setSongResults] = useState([]);
  const [userResults, setUserResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [externalState, setExternalState] = useState('skipped');
  const [importingSongIds, setImportingSongIds] = useState(() => new Set());

  const isSongsMode = mode === 'songs';

  useEffect(() => {
    if (mode !== 'songs') return undefined;
    const trimmed = songQuery.trim();
    if (!trimmed) {
      setSongResults([]);
      setCatalogError('');
      setExternalState('skipped');
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setCatalogError('');
      const regionQuery = regionTag ? `&region=${encodeURIComponent(regionTag)}` : '';
      const catalogPayload = await api
        .get(`/api/catalog/search?q=${encodeURIComponent(trimmed)}&limit=${CATALOG_SEARCH_LIMIT}${regionQuery}`)
        .catch(() => ({ success: false }));

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
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, songQuery, regionTag]);

  useEffect(() => {
    if (mode !== 'people') return undefined;
    const trimmed = peopleQuery.trim();
    if (!trimmed) {
      setUserResults([]);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      const userPayload = await api
        .get(`/api/users/search?q=${encodeURIComponent(trimmed)}&limit=${PEOPLE_SEARCH_LIMIT}`)
        .catch(() => ({ success: false }));

      if (cancelled) return;

      setUserResults(userPayload.success && Array.isArray(userPayload.users) ? userPayload.users : []);
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, peopleQuery]);

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

  const handleQueryChange = (event) => {
    const value = event.target.value;
    if (mode === 'songs') setSongQuery(value);
    else setPeopleQuery(value);
  };

  return (
    <div className="search-view">
      <section className="search-hero app-surface">
        <h1>Search</h1>
        <div className="search-mode-tabs" role="tablist" aria-label="Search modes">
          <button
            type="button"
            role="tab"
            id={SONGS_TAB_ID}
            className={`search-mode-tab${isSongsMode ? ' active' : ''}`}
            aria-selected={isSongsMode}
            aria-controls={SONGS_PANEL_ID}
            onClick={() => setMode('songs')}
          >
            Songs
          </button>
          <button
            type="button"
            role="tab"
            id={PEOPLE_TAB_ID}
            className={`search-mode-tab${!isSongsMode ? ' active' : ''}`}
            aria-selected={!isSongsMode}
            aria-controls={PEOPLE_PANEL_ID}
            onClick={() => setMode('people')}
          >
            People
          </button>
        </div>
        <label htmlFor="shell-search-input" className="search-input-wrap">
          <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
          <input
            id="shell-search-input"
            type="search"
            placeholder={isSongsMode ? 'Search songs, artists, albums...' : 'Search people...'}
            value={isSongsMode ? songQuery : peopleQuery}
            onChange={handleQueryChange}
            aria-label={isSongsMode ? 'Search songs, artists, albums' : 'Search people'}
          />
        </label>
        {isSongsMode ? (
          <div className="search-region-chips" role="group" aria-label="Search regions">
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
        ) : null}
      </section>

      {isSongsMode ? (
        <section
          className="music-section app-surface"
          id={SONGS_PANEL_ID}
          role="tabpanel"
          aria-labelledby={SONGS_TAB_ID}
          aria-busy={loading}
        >
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
          {!loading && !catalogError && !songQuery.trim() ? (
            <EmptyState
              icon="fa-magnifying-glass"
              title="Search for songs, artists, or albums."
              detail="Results appear as you type."
            />
          ) : null}
          {!loading && !catalogError && Boolean(songQuery.trim()) && songResults.length === 0 ? (
            <EmptyState icon="fa-magnifying-glass" title="No songs found." detail="Try a different song title or artist." />
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
      ) : (
        <section
          className="music-section app-surface"
          id={PEOPLE_PANEL_ID}
          role="tabpanel"
          aria-labelledby={PEOPLE_TAB_ID}
          aria-busy={loading}
        >
          <SectionHeader
            title="People"
            subtitle="Jump directly to public user profiles"
          />
          {loading ? (
            <p className="dashboard-status" role="status">Searching...</p>
          ) : null}
          {!loading && !peopleQuery.trim() ? (
            <EmptyState icon="fa-user" title="Search for people." detail="Find listeners by name." />
          ) : null}
          {!loading && Boolean(peopleQuery.trim()) && userResults.length === 0 ? (
            <EmptyState icon="fa-user" title="No people found." detail="Try a different name." />
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
                    {entry.bio ? <span className="search-user-bio">{entry.bio}</span> : null}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}
