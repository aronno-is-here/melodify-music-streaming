import { useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import usePlayer, { formatTime } from '../../hooks/usePlayer.js';
import cssRaw from './Dashboard.css?raw';

const DEFAULT_POSTER = 'https://picsum.photos/150/150?random';

export default function Dashboard() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'Dashboard');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const player = usePlayer();

  const [songs, setSongs] = useState([]);
  const [filteredSongs, setFilteredSongs] = useState([]);
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');

  const [playlists, setPlaylists] = useState([]);
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [playlistError, setPlaylistError] = useState('');

  const [favorites, setFavorites] = useState([]);
  const [favoritedIds, setFavoritedIds] = useState(new Set());
  const [activePlaylist, setActivePlaylist] = useState(null);
  const [activePlaylistSongs, setActivePlaylistSongs] = useState([]);
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [playlistSearchResults, setPlaylistSearchResults] = useState([]);
  const [playlistSearching, setPlaylistSearching] = useState(false);
  const [playlistAddedIds, setPlaylistAddedIds] = useState(new Set());
  const [playlistOpenOptions, setPlaylistOpenOptions] = useState(null);
  const [showFavorites, setShowFavorites] = useState(false);

  const [newPlSongs, setNewPlSongs] = useState([]);
  const [newPlSearch, setNewPlSearch] = useState('');
  const [newPlSearchResults, setNewPlSearchResults] = useState([]);
  const [newPlSearching, setNewPlSearching] = useState(false);

  const fetchSongs = async () => {
    const data = await api.get('/api/songs');
    if (data.success) {
      setSongs(data.songs);
      setFilteredSongs(data.songs);
    }
  };

  const fetchHistory = async () => {
    const data = await api.get('/api/history');
    if (data.success) setHistory(data.history);
  };

  const fetchPlaylists = async () => {
    const data = await api.get('/api/playlists');
    if (data.success) setPlaylists(data.playlists);
  };

  const fetchFavorites = async () => {
    const data = await api.get('/api/favorites');
    if (data.success) setFavorites(data.favorites);
  };

  const fetchFavoritedIds = async () => {
    const data = await api.get('/api/favorites/ids');
    if (data.success) setFavoritedIds(new Set(data.ids));
  };

  useEffect(() => {
    fetchSongs();
    fetchHistory();
    fetchPlaylists();
    fetchFavorites();
    fetchFavoritedIds();
  }, []);

  useEffect(() => {
    const term = search.toLowerCase();
    if (!term) {
      setFilteredSongs(songs);
    } else {
      const list = songs.filter((s) => s.title.toLowerCase().includes(term) || s.artist.toLowerCase().includes(term));
      setFilteredSongs(list);
    }
  }, [search, songs]);

  const recordPlay = (song) => {
    if (!song?._id) return;
    api.post('/api/history', { songId: song._id }).then(() => {
      setHistory((prev) => [song, ...prev.filter((s) => s._id !== song._id)].slice(0, 20));
    });
  };

  const handleSongClick = (songIndex, songList) => {
    const list = songList || filteredSongs;
    const song = list[songIndex];
    if (!song) return;
    const isCurrentSong = player.currentSong?._id === song._id;
    if (isCurrentSong) {
      player.togglePlay();
    } else {
      player.playSong(list, songIndex);
      recordPlay(song);
    }
  };

  const playFromHistory = (song) => {
    const idx = filteredSongs.findIndex((s) => s._id === song._id);
    if (idx >= 0) {
      handleSongClick(idx);
    } else {
      player.playSong([song], 0);
      recordPlay(song);
    }
  };

  const handleSeek = (e) => {
    const ratio = Number(e.target.value) / 1000;
    player.seek(ratio);
  };

  const handleVolume = (e) => {
    player.setVolume(Number(e.target.value));
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    setUploading(true);
    setUploadMsg('');
    const form = e.target;
    const formData = new FormData(form);
    const data = await api.post('/api/songs/upload', formData);
    setUploading(false);
    if (data.success) {
      setUploadMsg('Song uploaded successfully!');
      setTimeout(() => setUploadMsg(''), 3000);
      setPopupOpen(false);
      form.reset();
      fetchSongs();
    } else {
      setUploadMsg(data.error || 'Upload failed');
    }
  };

  const toggleFavorite = async (songId) => {
    const isFav = favoritedIds.has(songId);
    if (isFav) {
      await api.del(`/api/favorites/${songId}`);
      setFavoritedIds((prev) => {
        const next = new Set(prev);
        next.delete(songId);
        return next;
      });
      setFavorites((prev) => prev.filter((s) => String(s._id) !== String(songId)));
    } else {
      await api.post(`/api/favorites/${songId}`);
      setFavoritedIds((prev) => new Set([...prev, songId]));
      const song = songs.find((s) => String(s._id) === String(songId));
      if (song) setFavorites((prev) => [song, ...prev]);
    }
  };

  const openPlaylist = async (playlistId) => {
    setActivePlaylist(playlistId);
    setShowFavorites(false);
    const data = await api.get(`/api/playlists/${playlistId}`);
    if (data.success) {
      const playlistItems = data.playlist.items || [];
      setActivePlaylistSongs(playlistItems.map((it) => it.songId).filter(Boolean));
      setPlaylistAddedIds(new Set(playlistItems.map((it) => String(it.songId?._id))));
    }
  };

  const openFavorites = () => {
    setShowFavorites(true);
    setActivePlaylist(null);
  };

  const goBackToSongs = () => {
    setActivePlaylist(null);
    setShowFavorites(false);
  };

  const handlePlaylistSearch = async (e) => {
    const term = e.target.value;
    setPlaylistSearch(term);
    if (!term.trim()) {
      setPlaylistSearchResults([]);
      return;
    }
    setPlaylistSearching(true);
    const data = await api.get(`/api/songs?q=${encodeURIComponent(term)}&limit=20`);
    if (data.success) setPlaylistSearchResults(data.songs.filter((s) => !playlistAddedIds.has(String(s._id))));
    setPlaylistSearching(false);
  };

  const addToPlaylist = async (songId) => {
    if (!activePlaylist) return;
    const data = await api.post(`/api/playlists/${activePlaylist}/songs`, { songId });
    if (data.success) {
      const playlistItems = data.playlist.items || [];
      setActivePlaylistSongs(playlistItems.map((it) => it.songId).filter(Boolean));
      setPlaylistAddedIds(new Set(playlistItems.map((it) => String(it.songId?._id))));
      setPlaylistSearchResults((prev) => prev.filter((s) => String(s._id) !== String(songId)));
      setPlaylistSearch('');
      setPlaylistSearchResults([]);
    }
  };

  const removeFromPlaylist = async (songId) => {
    if (!activePlaylist) return;
    const data = await api.del(`/api/playlists/${activePlaylist}/songs/${songId}`);
    if (data.success) {
      const playlistItems = data.playlist.items || [];
      setActivePlaylistSongs(playlistItems.map((it) => it.songId).filter(Boolean));
      setPlaylistAddedIds(new Set(playlistItems.map((it) => String(it.songId?._id))));
    }
  };

  const playPlaylistRow = (rowIndex) => {
    const song = activePlaylistSongs[rowIndex];
    if (!song) return;
    if (player.currentSong?._id === song._id) {
      player.togglePlay();
    } else {
      player.playSong(activePlaylistSongs, rowIndex);
      recordPlay(song);
    }
  };

  const playAllPlaylist = () => {
    if (activePlaylistSongs.length === 0) return;
    player.playSong(activePlaylistSongs, 0);
    recordPlay(activePlaylistSongs[0]);
  };

  const playFavorites = () => {
    if (favorites.length === 0) return;
    player.playSong(favorites, 0);
    recordPlay(favorites[0]);
  };

  const playFavoriteRow = (index) => {
    const song = favorites[index];
    if (!song) return;
    if (player.currentSong?._id === song._id) {
      player.togglePlay();
    } else {
      player.playSong(favorites, index);
      recordPlay(song);
    }
  };

  const handleNewPlSearch = async (e) => {
    const term = e.target.value;
    setNewPlSearch(term);
    if (!term.trim()) {
      setNewPlSearchResults([]);
      return;
    }
    setNewPlSearching(true);
    const data = await api.get(`/api/songs?q=${encodeURIComponent(term)}&limit=10`);
    if (data.success) {
      const existingIds = new Set(newPlSongs.map((s) => String(s._id)));
      setNewPlSearchResults(data.songs.filter((s) => !existingIds.has(String(s._id))));
    }
    setNewPlSearching(false);
  };

  const addSongToNewPlaylist = (song) => {
    setNewPlSongs((prev) => [...prev, song]);
    setNewPlSearch('');
    setNewPlSearchResults([]);
  };

  const removeSongFromNewPlaylist = (songId) => {
    setNewPlSongs((prev) => prev.filter((s) => String(s._id) !== String(songId)));
  };

  const handleCreatePlaylist = async (e) => {
    e.preventDefault();
    const name = newPlaylistName.trim();
    if (!name) {
      setPlaylistError('Playlist name cannot be empty.');
      return;
    }
    setCreatingPlaylist(true);
    setPlaylistError('');
    const data = await api.post('/api/playlists', { title: name });
    if (data.success) {
      const playlistId = data.playlist._id;
      for (const song of newPlSongs) {
        await api.post(`/api/playlists/${playlistId}/songs`, { songId: song._id });
      }
      await fetchPlaylists();
      setNewPlaylistName('');
      setNewPlSongs([]);
      setNewPlSearch('');
      setPlaylistModalOpen(false);
      openPlaylist(playlistId);
    } else {
      setPlaylistError(data.error || 'Failed to create playlist.');
    }
    setCreatingPlaylist(false);
  };

  const deletePlaylist = async (playlistId) => {
    if (!window.confirm('Delete this playlist?')) return;
    await api.del(`/api/playlists/${playlistId}`);
    await fetchPlaylists();
    goBackToSongs();
  };

  const playingSongId = player.currentSong?._id;

  const activePlaylistData = playlists.find((pl) => String(pl._id) === String(activePlaylist));

  return (
    <>
      <header>
        <div className="logo">
          MELOD<span>IFY</span>
        </div>
      </header>
      <div className="profile-container">
        <button className="profile-btn" aria-label="Open profile menu" onClick={() => setMenuOpen(!menuOpen)}>
          <i className="fa-solid fa-user"></i>
        </button>
        {menuOpen && (
          <div className="profile-menu active" id="profile-menu" onClick={(e) => e.stopPropagation()}>
            <ul>
              <li>
                <Link to="/profile" style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                  View Profile
                </Link>
              </li>
              {user?.role === 'admin' && (
                <li>
                  <Link to="/admin" style={{ color: 'inherit', textDecoration: 'none', display: 'block' }}>
                    Admin Panel
                  </Link>
                </li>
              )}
              <li onClick={() => { logout(); navigate('/login'); }}>Logout</li>
            </ul>
          </div>
        )}
      </div>
      <main id="mainContainer" className={collapsed ? 'collapsed' : ''} onClick={() => menuOpen && setMenuOpen(false)}>
        <div className="scroll-grid">
          <h2>
            <button className="toggle-btn" style={{ background: 'none', border: 'none', color: '#00b4d8', cursor: 'pointer', fontSize: '16px' }} onClick={() => setCollapsed(!collapsed)}>
              ◀
            </button>
            <span className="grid-title">Library</span>
            <button className="add-song-btn" style={{ marginLeft: 'auto', fontSize: '18px', padding: '4px 10px' }} onClick={() => setPlaylistModalOpen(true)} title="Create Playlist">
              +
            </button>
          </h2>

          <div
            className={`sidebar-item sidebar-favorites${showFavorites ? ' active' : ''}`}
            onClick={openFavorites}
          >
            <div className="sidebar-thumb sidebar-thumb-fav">
              <i className="fa-solid fa-heart"></i>
            </div>
            <div className="sidebar-label">
              <div className="sidebar-name">Liked Songs</div>
              <div className="sidebar-sub">{favorites.length} songs</div>
            </div>
          </div>

          <div className="playlist-list">
            {playlists.length === 0 ? (
              <div style={{ padding: '12px 0', color: '#b3b3b3', fontSize: '13px', textAlign: 'center' }}>
                <p>No playlists yet</p>
                <button className="add-song-btn" style={{ marginTop: '8px', fontSize: '12px' }} onClick={() => setPlaylistModalOpen(true)}>
                  Create your first playlist
                </button>
              </div>
            ) : (
              playlists.map((pl) => {
                const firstSong = pl.items?.[0]?.songId;
                const thumb = firstSong?.poster_url || null;
                const isActivePlaylist = String(activePlaylist) === String(pl._id) && !showFavorites;
                return (
                  <div
                    key={pl._id}
                    className={`sidebar-item${isActivePlaylist ? ' active' : ''}`}
                    onClick={() => openPlaylist(pl._id)}
                  >
                    <div className="sidebar-thumb">
                      {thumb ? (
                        <img src={thumb} alt={pl.title} onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
                      ) : null}
                      <div className="sidebar-thumb-placeholder" style={thumb ? { display: 'none' } : {}}>
                        <i className="fa-solid fa-list"></i>
                      </div>
                    </div>
                    <div className="sidebar-label">
                      <div className="sidebar-name">{pl.title}</div>
                      <div className="sidebar-sub">{pl.items?.length || 0} songs</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {user?.role === 'admin' && (
            <button className="add-song-btn" style={{ marginTop: '12px', width: '100%' }} onClick={() => setPopupOpen(true)}>
              Add Song
            </button>
          )}
        </div>

        <div className="scroll-grid">
          {(activePlaylist || showFavorites) ? (
            <>
              <div className="playlist-view-header">
                <button className="back-btn" onClick={goBackToSongs}>
                  <i className="fa-solid fa-chevron-left"></i>
                </button>
                <h2 className="playlist-view-title">
                  {showFavorites ? 'Liked Songs' : activePlaylistData?.title || 'Playlist'}
                </h2>
                {!showFavorites && activePlaylistData && (
                  <button className="delete-playlist-btn" onClick={() => deletePlaylist(activePlaylist)} title="Delete playlist">
                    <i className="fa-solid fa-trash"></i>
                  </button>
                )}
              </div>
              <div className="playlist-view-stats">
                <span>{showFavorites ? favorites.length : activePlaylistSongs.length} songs</span>
                {!showFavorites && (
                  <button className="play-all-btn" onClick={playAllPlaylist}>
                    <i className={`fa-solid ${player.isPlaying && player.currentSong && activePlaylistSongs.some((s) => s._id === player.currentSong._id) ? 'fa-pause' : 'fa-play'}`}></i>
                    Play All
                  </button>
                )}
                {showFavorites && (
                  <button className="play-all-btn" onClick={playFavorites}>
                    <i className={`fa-solid ${player.isPlaying && player.currentSong && favorites.some((s) => s._id === player.currentSong._id) ? 'fa-pause' : 'fa-play'}`}></i>
                    Play All
                  </button>
                )}
              </div>

              <div className="playlist-table">
                {(showFavorites ? favorites : activePlaylistSongs).map((song, ri) => {
                  const isCurrent = playingSongId === song._id;
                  return (
                    <div className={`playlist-row${isCurrent ? ' playing' : ''}`} key={song._id} onClick={() => showFavorites ? playFavoriteRow(ri) : playPlaylistRow(ri)}>
                      <div className="pl-row-num">{ri + 1}</div>
                      <div className="pl-row-title">
                        <img src={song.poster_url || DEFAULT_POSTER} alt="" className="pl-row-img" onError={(e) => (e.target.src = DEFAULT_POSTER)} />
                        <div>
                          <div className={`pl-row-name${isCurrent ? ' playing' : ''}`}>{song.title}</div>
                          <div className="pl-row-artist">{song.artist}</div>
                        </div>
                      </div>
                      <div className="pl-row-duration">{song.duration || ''}</div>
                      <div className="pl-row-actions" onClick={(e) => e.stopPropagation()}>
                        <button className={`fav-btn${favoritedIds.has(String(song._id)) ? ' active' : ''}`} onClick={() => toggleFavorite(song._id)}>
                          <i className={`fa-${favoritedIds.has(String(song._id)) ? 'solid' : 'regular'} fa-heart`}></i>
                        </button>
                        {!showFavorites && (
                          <button className="remove-btn" onClick={() => removeFromPlaylist(song._id)}>
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {((showFavorites && favorites.length === 0) || (!showFavorites && activePlaylistSongs.length === 0)) && (
                  <div className="pl-empty">
                    {showFavorites ? 'No liked songs yet.' : 'No songs in this playlist.'}
                  </div>
                )}
              </div>

              {!showFavorites && (
                <div className="playlist-add-section">
                  <div className="playlist-add-search">
                    <i className="fa-solid fa-magnifying-glass"></i>
                    <input type="text" placeholder="Search songs to add..." value={playlistSearch} onChange={handlePlaylistSearch} />
                  </div>
                  {playlistSearch.trim() && (
                    <div className="playlist-add-results">
                      {playlistSearching ? (
                        <div className="pl-search-status">Searching...</div>
                      ) : playlistSearchResults.length === 0 ? (
                        <div className="pl-search-status">No matching songs found</div>
                      ) : (
                        playlistSearchResults.map((song) => (
                          <div className="playlist-add-item" key={song._id}>
                            <img src={song.poster_url || DEFAULT_POSTER} alt="" className="pl-add-img" onError={(e) => (e.target.src = DEFAULT_POSTER)} />
                            <div className="pl-add-info">
                              <div className="pl-add-name">{song.title}</div>
                              <div className="pl-add-artist">{song.artist}</div>
                            </div>
                            <button className="add-to-pl-btn" onClick={() => addToPlaylist(song._id)}>
                              <i className="fa-solid fa-plus"></i>
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="recent-container">
                <h2>Recently Played</h2>
                {history.length === 0 ? (
                  <p className="recent-empty">No songs played yet</p>
                ) : (
                  <div className="recent-grid">
                    {history.map((song, index) => (
                      <div className="song-item recent-item" key={song._id || index}>
                        <img className="song-poster" src={song.poster_url} alt={`${song.title} Poster`} onError={(e) => (e.target.src = DEFAULT_POSTER)} />
                        <div className="play-button" onClick={() => playFromHistory(song)}>
                          <i className="fa-solid fa-play"></i>
                        </div>
                        <div className="song-info">
                          <div className="song-name">{song.title}</div>
                          <div className="artist-name">{song.artist}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="search-container">
                <div className="search-bar">
                  <i className="fa-solid fa-magnifying-glass"></i>
                  <input type="text" placeholder="Search by songs or artists" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
              </div>
              <div className="songs-container">
                <h2>Recommended Songs</h2>
                <div className="songs-grid">
                  {filteredSongs.map((song, index) => {
                    const isActive = playingSongId === song._id;
                    return (
                      <div className="song-item" key={song._id || index} onClick={() => handleSongClick(index)}>
                        <div className="song-poster-wrapper">
                          <img className="song-poster" src={song.poster_url} alt={`${song.title} Poster`} onError={(e) => (e.target.src = DEFAULT_POSTER)} />
                          <div className="play-button">
                            <i className={`fa-solid ${isActive && player.isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                          </div>
                        </div>
                        <div className="song-info">
                          <div className="song-name">{song.title}</div>
                          <div className="artist-name">{song.artist}</div>
                        </div>
                        <button className={`grid-fav-btn${favoritedIds.has(String(song._id)) ? ' active' : ''}`} onClick={(e) => { e.stopPropagation(); toggleFavorite(song._id); }}>
                          <i className={`fa-${favoritedIds.has(String(song._id)) ? 'solid' : 'regular'} fa-heart`}></i>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="scroll-grid">
          <div className="now-playing-header">
            <h2 id="right-heading">Now Playing</h2>
          </div>
          <img
            className="song-poster"
            src={player.currentSong ? player.currentSong.poster_url : DEFAULT_POSTER}
            alt="Now Playing Song Poster"
            onError={(e) => (e.target.src = DEFAULT_POSTER)}
          />
          <div className="song-details">
            {player.currentSong ? (
              <>
                <h3>{player.currentSong.title}</h3>
                <p>Artist: {player.currentSong.artist}</p>
                <p>Genre: {player.currentSong.genre}</p>
                <p>Duration: {player.currentSong.duration}</p>
                <p>Release Date: {player.currentSong.release_date ? String(player.currentSong.release_date).slice(0, 10) : 'None'}</p>
              </>
            ) : (
              <>
                <h3>No Song Selected</h3>
                <p>Artist: None</p>
                <p>Genre: None</p>
                <p>Duration: 0:00</p>
                <p>Release Date: None</p>
              </>
            )}
          </div>
          <input
            type="range"
            className="progress-slider"
            min="0"
            max="1000"
            step="1"
            value={Math.min(1000, Math.round(player.progress * 10))}
            onChange={handleSeek}
            aria-label="Seek bar"
            style={{ '--fill': `${player.progress}%` }}
          />
          <div className="progress-time">
            <span>{formatTime(player.currentTime)}</span>
            <span>{player.currentSong ? player.currentSong.duration : formatTime(player.duration)}</span>
          </div>
          <div className="controls">
            <button className="control-btn prev-btn" aria-label="Previous song" onClick={player.prev}>
              <i className="fa-solid fa-backward"></i>
            </button>
            <button className="control-btn play-btn" aria-label="Play song" data-state={player.isPlaying ? 'pause' : 'play'} onClick={() => player.togglePlay()}>
              <i className={`fa-solid ${player.isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
            <button className="control-btn next-btn" aria-label="Next song" onClick={player.next}>
              <i className="fa-solid fa-forward"></i>
            </button>
            <button className={`control-btn mode-btn${player.playMode !== 'list' ? ' active' : ''}`} aria-label="Toggle play mode" onClick={() => {
              const modes = ['list', 'single', 'shuffle'];
              const i = modes.indexOf(player.playMode);
              player.setPlayMode(modes[(i + 1) % modes.length]);
            }}>
              {player.playMode === 'list' && <i className="fa-solid fa-repeat"></i>}
              {player.playMode === 'single' && <><i className="fa-solid fa-repeat"></i><span className="mode-badge">1</span></>}
              {player.playMode === 'shuffle' && <i className="fa-solid fa-shuffle"></i>}
            </button>
          </div>
          <div className="volume-container">
            <button className="volume-btn" aria-label="Toggle mute" data-muted={player.muted ? 'true' : 'false'} onClick={player.toggleMute}>
              <i className={`fa-solid ${player.muted || player.volume === 0 ? 'fa-volume-mute' : 'fa-volume-high'}`}></i>
            </button>
            <input type="range" className="volume-slider" min="0" max="100" value={player.muted ? 0 : player.volume} aria-label="Volume control" onChange={handleVolume} />
          </div>
        </div>

        <div className={`overlay${popupOpen ? ' active' : ''}`} onClick={() => setPopupOpen(false)}></div>
        <div className={`add-song-popup${popupOpen ? ' active' : ''}`}>
          <button className="close-btn" onClick={() => setPopupOpen(false)}>
            ✕
          </button>
          <h3>Add New Song</h3>
          {uploadMsg && (
            <div style={{ padding: 10, marginBottom: 10, borderRadius: 4, background: uploadMsg.includes('success') ? '#4caf50' : '#dc3545', color: '#fff' }}>{uploadMsg}</div>
          )}
          <form id="add-song-form" encType="multipart/form-data" onSubmit={handleUpload}>
            <label htmlFor="title">Title</label>
            <input type="text" id="title" name="title" required />
            <label htmlFor="artist">Artist</label>
            <input type="text" id="artist" name="artist" required />
            <label htmlFor="genre">Genre</label>
            <select id="genre" name="genre" required>
              <option value="Bengali">Bengali</option>
              <option value="Hindi">Hindi</option>
              <option value="English">English</option>
            </select>
            <label htmlFor="song_file">Song File (MP3/WAV)</label>
            <input type="file" id="song_file" name="song_file" accept=".mp3,.wav" required />
            <label htmlFor="poster_file">Poster Image (JPG/PNG)</label>
            <input type="file" id="poster_file" name="poster_file" accept=".jpg,.jpeg,.png" required />
            <label htmlFor="duration">Duration (e.g., 3:30)</label>
            <input type="text" id="duration" name="duration" placeholder="3:30" />
            <label htmlFor="release_date">Release Date</label>
            <input type="date" id="release_date" name="release_date" />
            <button type="submit" disabled={uploading}>{uploading ? 'Uploading...' : 'Upload Song'}</button>
          </form>
        </div>

        <div className={`overlay${playlistModalOpen ? ' active' : ''}`} onClick={() => { setPlaylistModalOpen(false); setNewPlSongs([]); setNewPlSearch(''); }}></div>
        <div className={`add-song-popup playlist-create-modal${playlistModalOpen ? ' active' : ''}`}>
          <button className="close-btn" onClick={() => { setPlaylistModalOpen(false); setNewPlSongs([]); setNewPlSearch(''); }}>✕</button>
          <h3>Create New Playlist</h3>
          {playlistError && (
            <div style={{ padding: 10, marginBottom: 10, borderRadius: 4, background: '#dc3545', color: '#fff' }}>{playlistError}</div>
          )}
          <form onSubmit={handleCreatePlaylist}>
            <label htmlFor="playlist-name">Playlist Name</label>
            <input
              type="text"
              id="playlist-name"
              placeholder="My Playlist"
              value={newPlaylistName}
              onChange={(e) => { setNewPlaylistName(e.target.value); setPlaylistError(''); }}
              maxLength={60}
              required
            />

            <label style={{ marginTop: '12px' }}>Add Songs (optional)</label>
            <div className="new-pl-search">
              <i className="fa-solid fa-magnifying-glass"></i>
              <input
                type="text"
                placeholder="Search songs to add..."
                value={newPlSearch}
                onChange={handleNewPlSearch}
              />
            </div>
            {newPlSearch.trim() && (
              <div className="new-pl-results">
                {newPlSearching ? (
                  <div className="new-pl-status">Searching...</div>
                ) : newPlSearchResults.length === 0 ? (
                  <div className="new-pl-status">No matching songs</div>
                ) : (
                  newPlSearchResults.map((song) => (
                    <div className="new-pl-result-item" key={song._id}>
                      <img src={song.poster_url || DEFAULT_POSTER} alt="" className="new-pl-result-img" onError={(e) => (e.target.src = DEFAULT_POSTER)} />
                      <div className="new-pl-result-info">
                        <div className="new-pl-result-name">{song.title}</div>
                        <div className="new-pl-result-artist">{song.artist}</div>
                      </div>
                      <button type="button" className="new-pl-add-btn" onClick={() => addSongToNewPlaylist(song)}>
                        <i className="fa-solid fa-plus"></i>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
            {newPlSongs.length > 0 && (
              <div className="new-pl-selected">
                {newPlSongs.map((song) => (
                  <div className="new-pl-chip" key={song._id}>
                    <span>{song.title}</span>
                    <button type="button" onClick={() => removeSongFromNewPlaylist(song._id)}>
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button type="submit" disabled={creatingPlaylist} style={{ marginTop: '10px' }}>
              {creatingPlaylist ? 'Creating...' : 'Create Playlist'}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
