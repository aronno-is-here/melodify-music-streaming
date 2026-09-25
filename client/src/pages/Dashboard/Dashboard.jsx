import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { api } from '../../api/client.js';
import usePlayer from '../../hooks/usePlayer.js';
import usePersonalizedRecommendations from '../../hooks/usePersonalizedRecommendations.js';
import SongCard from '../../components/music/SongCard.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import {
  TRENDING_REQUEST_PATH,
  TRENDING_LOADING_MESSAGE,
  TRENDING_EMPTY_MESSAGE,
  TRENDING_ERROR_MESSAGE,
  normalizeTrendingResponse,
  buildTrendingSongs,
  classifyTrendingResult,
} from './trendingUi.js';
import {
  DASHBOARD_RECOMMENDATION_MODES,
  DASHBOARD_RECOMMENDATION_LOADING_MESSAGE,
  selectDashboardRecommendationPresentation,
} from './recommendationUi.js';
import {
  createArtistBuckets,
  createGenreBuckets,
  createQuickPicks,
  createRecentlyAddedSongs,
} from './discoverySections.js';
import './Dashboard.css';

const PERSONALIZED_RECOMMENDATION_LIMIT = 10;

function toPlaylistSongQueue(playlist) {
  if (!playlist || !Array.isArray(playlist.items)) return [];
  return playlist.items
    .map((item) => item?.songId)
    .filter(Boolean);
}

export default function Dashboard() {
  const {
    user,
    songs,
    history,
    playlists,
    favorites,
    favoritedIds,
    loadingCore,
    toggleFavorite,
  } = useOutletContext();

  const player = usePlayer();
  const [trendingStatus, setTrendingStatus] = useState('loading');
  const [trendingItems, setTrendingItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const loadTrending = async () => {
      try {
        const data = await api.get(TRENDING_REQUEST_PATH);
        if (cancelled) return;
        const kind = classifyTrendingResult(data);
        if (kind === 'disabled') {
          setTrendingStatus('disabled');
          setTrendingItems([]);
          return;
        }
        if (kind !== 'ok') {
          setTrendingStatus('error');
          setTrendingItems([]);
          return;
        }
        const { items } = normalizeTrendingResponse(data);
        if (cancelled) return;
        setTrendingItems(items);
        setTrendingStatus(items.length > 0 ? 'ready' : 'empty');
      } catch {
        if (!cancelled) {
          setTrendingStatus('error');
          setTrendingItems([]);
        }
      }
    };

    loadTrending();
    return () => { cancelled = true; };
  }, []);

  const personalizedRecommendations = usePersonalizedRecommendations({
    limit: PERSONALIZED_RECOMMENDATION_LIMIT,
  });

  const recommendationPresentation = selectDashboardRecommendationPresentation({
    state: personalizedRecommendations.state,
    personalizedSongs: personalizedRecommendations.songs,
    legacySongs: songs,
  });

  const recentlyAddedSongs = useMemo(() => createRecentlyAddedSongs(songs, 10), [songs]);
  const quickPickSongs = useMemo(() => createQuickPicks({ history, favorites, songs, limit: 12 }), [history, favorites, songs]);
  const genreBuckets = useMemo(() => createGenreBuckets(songs, { bucketLimit: 8, songLimit: 10 }), [songs]);
  const artistBuckets = useMemo(() => createArtistBuckets(songs, { bucketLimit: 8, songLimit: 10 }), [songs]);
  const trendingSongs = useMemo(() => buildTrendingSongs(trendingItems), [trendingItems]);

  const playlistCards = useMemo(() => (
    playlists.slice(0, 6).map((playlist) => {
      const queue = toPlaylistSongQueue(playlist);
      return {
        _id: playlist._id,
        title: playlist.title,
        count: queue.length,
        queue,
        poster: queue[0]?.poster_url || 'https://picsum.photos/300/300?random',
      };
    })
  ), [playlists]);

  const playSongQueue = (queue, index) => {
    const song = queue[index];
    if (!song) return;
    if (player.currentSong?._id === song._id) {
      player.togglePlay();
      return;
    }
    player.playSong(queue, index);
  };

  const renderSongRow = (queue) => {
    if (!Array.isArray(queue) || queue.length === 0) {
      return (
        <EmptyState
          icon="fa-compact-disc"
          title="Nothing here yet"
          detail="Your listening activity will appear after your next song."
        />
      );
    }

    return (
      <div className="music-row-scroll" role="list">
        {queue.map((song, index) => (
          <SongCard
            key={`${song._id}-${index}`}
            song={song}
            isPlaying={player.isPlaying}
            isActive={player.currentSong?._id === song._id}
            isFavorited={favoritedIds.has(String(song._id))}
            onPlay={() => playSongQueue(queue, index)}
            onToggleFavorite={() => toggleFavorite(song._id)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="dashboard-page">
      <section className="dashboard-hero app-surface">
        <div>
          <p className="dashboard-eyebrow">Welcome back</p>
          <h1>{user?.name ? `${user.name}, discover your next favorite track` : 'Discover your next favorite track'}</h1>
          <p className="dashboard-subcopy">
            Continue listening, pick up from your history, and explore fresh music in one responsive experience.
          </p>
        </div>
        <div className="dashboard-hero-actions">
          <Link to="/search" className="music-pill-btn">Open Search</Link>
          <Link to="/library" className="music-outline-btn">Go to Library</Link>
        </div>
      </section>

      <section className="music-section app-surface">
        <SectionHeader
          title="Continue Listening"
          subtitle="Picked from your recent plays"
        />
        {renderSongRow(history)}
      </section>

      {trendingStatus !== 'disabled' ? (
        <section className="music-section app-surface" aria-busy={trendingStatus === 'loading'}>
          <SectionHeader
            title="Trending Now"
            subtitle="Live activity from the Melodify community"
          />
          {trendingStatus === 'loading' ? (
            <p className="dashboard-status" role="status">{TRENDING_LOADING_MESSAGE}</p>
          ) : null}
          {trendingStatus === 'empty' ? (
            <p className="dashboard-status" role="status">{TRENDING_EMPTY_MESSAGE}</p>
          ) : null}
          {trendingStatus === 'error' ? (
            <p className="dashboard-status" role="status">{TRENDING_ERROR_MESSAGE}</p>
          ) : null}
          {trendingStatus === 'ready' ? renderSongRow(trendingSongs) : null}
        </section>
      ) : null}

      <section className="music-section app-surface">
        <SectionHeader
          title="Recommended For You"
          subtitle="Personalized when available, smart fallback when not"
        />
        {recommendationPresentation.mode === DASHBOARD_RECOMMENDATION_MODES.LOADING ? (
          <p className="dashboard-status" role="status">{DASHBOARD_RECOMMENDATION_LOADING_MESSAGE}</p>
        ) : renderSongRow(recommendationPresentation.songs)}
      </section>

      <section className="music-section app-surface">
        <SectionHeader
          title="Recently Added"
          subtitle="Newest catalog drops"
        />
        {renderSongRow(recentlyAddedSongs)}
      </section>

      <section className="music-section app-surface">
        <SectionHeader
          title="Quick Picks"
          subtitle="A fast mix from history, likes, and your library"
        />
        {renderSongRow(quickPickSongs)}
      </section>

      <section className="music-section app-surface">
        <SectionHeader
          title="Discover by Genre"
          subtitle="Grouped from available song metadata"
        />
        {genreBuckets.length === 0 ? (
          <EmptyState icon="fa-tags" title="No genres available yet" />
        ) : (
          <div className="music-chip-grid">
            {genreBuckets.map((bucket) => (
              <article className="music-chip-card" key={bucket.label}>
                <div className="music-chip-title">{bucket.label}</div>
                <div className="music-chip-sub">{bucket.count} songs</div>
                <button
                  type="button"
                  className="music-outline-btn"
                  onClick={() => playSongQueue(bucket.songs, 0)}
                >
                  Play Genre Mix
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="music-section app-surface">
        <SectionHeader
          title="Discover by Artist"
          subtitle="Curated from your current catalog"
        />
        {artistBuckets.length === 0 ? (
          <EmptyState icon="fa-user" title="No artists available yet" />
        ) : (
          <div className="music-chip-grid">
            {artistBuckets.map((bucket) => (
              <article className="music-chip-card" key={bucket.label}>
                <div className="music-chip-title">{bucket.label}</div>
                <div className="music-chip-sub">{bucket.count} songs</div>
                <button
                  type="button"
                  className="music-outline-btn"
                  onClick={() => playSongQueue(bucket.songs, 0)}
                >
                  Play Artist Mix
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="music-section app-surface">
        <SectionHeader
          title="Your Playlists / Liked Songs"
          subtitle="Access your personal library quickly"
          action={<Link className="music-section-action" to="/library">Open Library</Link>}
        />

        <div className="dashboard-library-cards">
          <article className="dashboard-library-card">
            <h3>Liked Songs</h3>
            <p>{favorites.length} songs saved</p>
            <button
              type="button"
              className="music-outline-btn"
              onClick={() => playSongQueue(favorites, 0)}
              disabled={favorites.length === 0}
            >
              Play Liked Songs
            </button>
          </article>

          {playlistCards.map((playlist) => (
            <article key={playlist._id} className="dashboard-library-card">
              <img src={playlist.poster} alt="" className="dashboard-library-poster" />
              <h3>{playlist.title}</h3>
              <p>{playlist.count} songs</p>
              <button
                type="button"
                className="music-outline-btn"
                onClick={() => playSongQueue(playlist.queue, 0)}
                disabled={playlist.queue.length === 0}
              >
                Play Playlist
              </button>
            </article>
          ))}
        </div>

        {loadingCore ? (
          <p className="dashboard-status" role="status">Loading your library...</p>
        ) : null}
      </section>
    </div>
  );
}
