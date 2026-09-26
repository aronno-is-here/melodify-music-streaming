import { useEffect, useMemo, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import usePlayer from '../../hooks/usePlayer.js';
import SongRow from '../../components/music/SongRow.jsx';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import CreatePlaylistDialog from '../../components/music/CreatePlaylistDialog.jsx';
import './LibraryView.css';

const TAB_KEYS = Object.freeze(['liked', 'playlists', 'recent']);

function toPlaylistQueue(playlist) {
  if (!playlist || !Array.isArray(playlist.items)) return [];
  return playlist.items.map((item) => item.songId).filter(Boolean);
}

export default function LibraryView() {
  const {
    playlists,
    favorites,
    history,
    favoritedIds,
    toggleFavorite,
    refreshCoreData,
  } = useOutletContext();
  const player = usePlayer();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabFromUrl = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState(
    TAB_KEYS.includes(tabFromUrl) ? tabFromUrl : 'playlists',
  );
  const [activePlaylistId, setActivePlaylistId] = useState(
    playlists[0]?._id ? String(playlists[0]._id) : null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [libraryStatus, setLibraryStatus] = useState(null);

  useEffect(() => {
    if (TAB_KEYS.includes(tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl, activeTab]);

  useEffect(() => {
    if (!playlists.length) {
      setActivePlaylistId(null);
      return;
    }
    if (!activePlaylistId) {
      setActivePlaylistId(String(playlists[0]._id));
    }
  }, [playlists, activePlaylistId]);

  const setTab = (tab) => {
    setActiveTab(tab);
    setSearchParams(tab === 'playlists' ? {} : { tab });
  };

  const activePlaylist = useMemo(
    () => playlists.find((playlist) => String(playlist._id) === String(activePlaylistId)) || null,
    [playlists, activePlaylistId],
  );
  const activePlaylistSongs = useMemo(
    () => toPlaylistQueue(activePlaylist),
    [activePlaylist],
  );

  const playQueueAt = (queue, index) => {
    const song = queue[index];
    if (!song) return;
    if (player.currentSong?._id === song._id) {
      player.togglePlay();
      return;
    }
    player.playSong(queue, index);
  };

  const handlePlaylistCreated = async (playlist, result = {}) => {
    setCreateOpen(false);
    const failed = Number(result.failed) || 0;
    if (failed > 0) {
      setLibraryStatus({
        tone: 'error',
        text: `Playlist created, but ${failed} song${failed === 1 ? '' : 's'} could not be added.`,
      });
    } else {
      setLibraryStatus({
        tone: 'success',
        text: `Playlist "${playlist?.title || 'playlist'}" created.`,
      });
    }
    if (typeof refreshCoreData === 'function') {
      await refreshCoreData();
    }
    if (playlist?._id) {
      setActivePlaylistId(String(playlist._id));
    }
  };

  return (
    <div className="library-view">
      <section className="library-top app-surface">
        <SectionHeader
          title="Your Library"
          subtitle="Liked songs, playlists, and listening history"
        />
        <div className="library-tabs" role="tablist" aria-label="Library views">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'liked'}
            className={`library-tab ${activeTab === 'liked' ? 'is-active' : ''}`}
            onClick={() => setTab('liked')}
          >
            Liked Songs
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'playlists'}
            className={`library-tab ${activeTab === 'playlists' ? 'is-active' : ''}`}
            onClick={() => setTab('playlists')}
          >
            Playlists
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'recent'}
            className={`library-tab ${activeTab === 'recent' ? 'is-active' : ''}`}
            onClick={() => setTab('recent')}
          >
            Recently Played
          </button>
        </div>
      </section>

      {activeTab === 'liked' ? (
        <section className="music-section app-surface" role="tabpanel">
          {favorites.length === 0 ? (
            <EmptyState icon="fa-heart" title="No liked songs yet" detail="Tap the heart icon on any song to save it here." />
          ) : (
            <div>
              {favorites.map((song, index) => (
                <SongRow
                  key={`${song._id}-${index}`}
                  song={song}
                  subtitle={song.artist}
                  isPlaying={player.isPlaying}
                  isActive={player.currentSong?._id === song._id}
                  isFavorited={favoritedIds.has(String(song._id))}
                  onPlay={() => playQueueAt(favorites, index)}
                  onToggleFavorite={() => toggleFavorite(song._id)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'playlists' ? (
        <section className="music-section app-surface" role="tabpanel">
          <div className="library-playlists-toolbar">
            <button
              type="button"
              className="music-pill-btn"
              onClick={() => setCreateOpen(true)}
            >
              <i className="fa-solid fa-plus" aria-hidden="true"></i>
              Create Playlist
            </button>
            {libraryStatus ? (
              <p
                className={`library-status ${libraryStatus.tone === 'error' ? 'is-error' : 'is-success'}`}
                role="status"
              >
                {libraryStatus.text}
              </p>
            ) : null}
          </div>
          {playlists.length === 0 ? (
            <EmptyState icon="fa-book-open" title="No playlists yet" detail="Create a playlist to see it here." />
          ) : (
            <div className="library-playlists-layout">
              <div className="library-playlist-list" role="list">
                {playlists.map((playlist) => {
                  const queue = toPlaylistQueue(playlist);
                  const active = String(playlist._id) === String(activePlaylistId);
                  return (
                    <button
                      type="button"
                      role="listitem"
                      key={playlist._id}
                      className={`library-playlist-card ${active ? 'is-active' : ''}`}
                      onClick={() => setActivePlaylistId(String(playlist._id))}
                    >
                      <span className="library-playlist-title">{playlist.title}</span>
                      <span className="library-playlist-count">{queue.length} songs</span>
                    </button>
                  );
                })}
              </div>

              <div>
                <SectionHeader
                  title={activePlaylist?.title || 'Playlist'}
                  subtitle={`${activePlaylistSongs.length} songs`}
                  action={(
                    <button
                      type="button"
                      className="music-section-action"
                      onClick={() => playQueueAt(activePlaylistSongs, 0)}
                      disabled={activePlaylistSongs.length === 0}
                    >
                      Play All
                    </button>
                  )}
                />

                {activePlaylistSongs.length === 0 ? (
                  <EmptyState icon="fa-compact-disc" title="Playlist is empty" detail="Add songs to this playlist from the playlist page." />
                ) : (
                  <div>
                    {activePlaylistSongs.map((song, index) => (
                      <SongRow
                        key={`${song._id}-${index}`}
                        song={song}
                        subtitle={song.artist}
                        isPlaying={player.isPlaying}
                        isActive={player.currentSong?._id === song._id}
                        isFavorited={favoritedIds.has(String(song._id))}
                        onPlay={() => playQueueAt(activePlaylistSongs, index)}
                        onToggleFavorite={() => toggleFavorite(song._id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {activeTab === 'recent' ? (
        <section className="music-section app-surface" role="tabpanel">
          {history.length === 0 ? (
            <EmptyState icon="fa-clock-rotate-left" title="No recent listening yet" detail="Start playback and your history appears here." />
          ) : (
            <div>
              {history.map((song, index) => (
                <SongRow
                  key={`${song._id}-${index}`}
                  song={song}
                  subtitle={song.artist}
                  isPlaying={player.isPlaying}
                  isActive={player.currentSong?._id === song._id}
                  isFavorited={favoritedIds.has(String(song._id))}
                  onPlay={() => playQueueAt(history, index)}
                  onToggleFavorite={() => toggleFavorite(song._id)}
                />
              ))}
            </div>
          )}
        </section>
      ) : null}

      <CreatePlaylistDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handlePlaylistCreated}
      />
    </div>
  );
}
