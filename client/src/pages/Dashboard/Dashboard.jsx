import { useEffect, useLayoutEffect, useState } from 'react';
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

  useEffect(() => {
    fetchSongs();
    fetchHistory();
    fetchPlaylists();
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

  const handleSongClick = (songIndex) => {
    const song = filteredSongs[songIndex];
    if (!song) return;
    const globalIdx = player.list === filteredSongs ? player.index : -1;
    if (globalIdx === songIndex && player.isPlaying) {
      player.pause();
    } else {
      player.playSong(filteredSongs, songIndex);
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
    setCreatingPlaylist(false);
    if (data.success) {
      setPlaylists((prev) => [data.playlist, ...prev]);
      setNewPlaylistName('');
      setPlaylistModalOpen(false);
      navigate(`/playlist/${data.playlist._id}`);
    } else {
      setPlaylistError(data.error || 'Failed to create playlist.');
    }
  };

  const playingSongId = player.currentSong?._id;

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
          <div className="playlist-list">
            {playlists.length === 0 ? (
              <div style={{ padding: '12px 0', color: '#b3b3b3', fontSize: '13px', textAlign: 'center' }}>
                <p>No playlists yet</p>
                <button className="add-song-btn" style={{ marginTop: '8px', fontSize: '12px' }} onClick={() => setPlaylistModalOpen(true)}>
                  Create your first playlist
                </button>
              </div>
            ) : (
              playlists.map((pl) => (
                <Link key={pl._id} to={`/playlist/${pl._id}`} className="playlist-link" style={{ display: 'block', padding: '8px 10px', borderRadius: '6px', color: playingSongId && pl.items?.some((it) => String(it.songId?._id) === String(playingSongId)) ? '#00b4d8' : '#b3b3b3', textDecoration: 'none', fontSize: '14px', transition: 'background 0.2s, color 0.2s', background: 'transparent', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.color = '#fff'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = playingSongId && pl.items?.some((it) => String(it.songId?._id) === String(playingSongId)) ? '#00b4d8' : '#b3b3b3'; }}>
                  <i className="fa-solid fa-list" style={{ marginRight: '8px', fontSize: '12px' }}></i>
                  {pl.title}
                </Link>
              ))
            )}
          </div>
          {user?.role === 'admin' && (
            <button className="add-song-btn" style={{ marginTop: '12px', width: '100%' }} onClick={() => setPopupOpen(true)}>
              Add Song
            </button>
          )}
        </div>
        <div className="scroll-grid">
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
                  <div className="song-item" key={song._id || index}>
                    <img className="song-poster" src={song.poster_url} alt={`${song.title} Poster`} onError={(e) => (e.target.src = DEFAULT_POSTER)} />
                    <div className="play-button" data-index={index} onClick={() => handleSongClick(index)}>
                      <i className={`fa-solid ${isActive && player.isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                    </div>
                    <div className="song-info">
                      <div className="song-name">{song.title}</div>
                      <div className="artist-name">{song.artist}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
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
            <button className={`control-btn shuffle-btn${player.shuffle ? ' active' : ''}`} aria-label="Toggle shuffle" data-shuffle={player.shuffle ? 'on' : 'off'} onClick={() => player.setShuffle(!player.shuffle)}>
              <i className="fa-solid fa-shuffle"></i>
            </button>
            <button className="control-btn prev-btn" aria-label="Previous song" onClick={player.prev}>
              <i className="fa-solid fa-backward"></i>
            </button>
            <button className="control-btn play-btn" aria-label="Play song" data-state={player.isPlaying ? 'pause' : 'play'} onClick={() => player.togglePlay()}>
              <i className={`fa-solid ${player.isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
            <button className="control-btn next-btn" aria-label="Next song" onClick={player.next}>
              <i className="fa-solid fa-forward"></i>
            </button>
            <button className={`control-btn repeat-btn${player.repeat ? ' active' : ''}`} aria-label="Toggle repeat" data-repeat={player.repeat ? 'on' : 'off'} onClick={() => player.setRepeat(!player.repeat)}>
              <i className="fa-solid fa-repeat"></i>
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

        <div className={`overlay${playlistModalOpen ? ' active' : ''}`} onClick={() => setPlaylistModalOpen(false)}></div>
        <div className={`add-song-popup${playlistModalOpen ? ' active' : ''}`}>
          <button className="close-btn" onClick={() => setPlaylistModalOpen(false)}>✕</button>
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
            <button type="submit" disabled={creatingPlaylist} style={{ marginTop: '10px' }}>
              {creatingPlaylist ? 'Creating...' : 'Create Playlist'}
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
