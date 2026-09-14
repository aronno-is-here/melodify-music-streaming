import { useEffect, useLayoutEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import usePlayer from '../../hooks/usePlayer.js';
import cssRaw from './Playlist.css?raw';

const DEFAULT_POSTER = 'https://picsum.photos/48/48?random';

function parseDuration(d) {
  if (!d) return 0;
  const parts = String(d).split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function totalTimeLabel(items) {
  const total = items.reduce((sum, item) => sum + parseDuration(item.songId?.duration), 0);
  const mins = Math.floor(total / 60);
  const secs = Math.round(total % 60);
  return `${mins} min ${secs} sec`;
}

function formatAdded(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'Recently';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [playlist, setPlaylist] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openOptions, setOpenOptions] = useState(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [addedIds, setAddedIds] = useState([]);

  const player = usePlayer();
  const items = playlist?.items || [];
  const songs = items.map((item) => item.songId).filter(Boolean);
  const playingId = player.currentSong?._id;

  const fetchPlaylist = async () => {
    const data = await api.get(`/api/playlists/${id}`);
    if (data.success) setPlaylist(data.playlist);
    else setNotFound(true);
  };

  useEffect(() => {
    fetchPlaylist();
  }, [id]);

  useEffect(() => {
    setAddedIds(items.map((item) => String(item.songId?._id)));
  }, [playlist]);

  const handleSearch = async (e) => {
    const term = e.target.value;
    setSearch(term);
    if (!term.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const data = await api.get(`/api/songs?q=${encodeURIComponent(term)}&limit=20`);
    if (data.success) setSearchResults(data.songs.filter((s) => !addedIds.includes(String(s._id))));
    setSearching(false);
  };

  const addSong = async (songId) => {
    const data = await api.post(`/api/playlists/${id}/songs`, { songId });
    if (data.success) {
      setPlaylist(data.playlist);
      setSearchResults((prev) => prev.filter((s) => String(s._id) !== String(songId)));
    }
  };

  const removeSong = async (songId) => {
    const data = await api.del(`/api/playlists/${id}/songs/${songId}`);
    if (data.success) setPlaylist(data.playlist);
  };

  const renamePlaylist = async () => {
    setMenuOpen(false);
    const title = window.prompt('Edit playlist name:', playlist?.title);
    if (!title || title.trim() === playlist?.title) return;
    const data = await api.put(`/api/playlists/${id}`, { title: title.trim() });
    if (data.success) setPlaylist(data.playlist);
  };

  const sharePlaylist = () => {
    setMenuOpen(false);
    navigator.clipboard?.writeText(window.location.href);
    window.alert('Playlist link copied to clipboard');
  };

  const deletePlaylist = async () => {
    setMenuOpen(false);
    if (!window.confirm('Delete this playlist?')) return;
    const data = await api.del(`/api/playlists/${id}`);
    if (data.success) navigate('/dashboard');
  };

  const playAll = () => {
    if (songs.length === 0) return;
    if (player.isPlaying && player.currentSong) player.togglePlay();
    else player.playSong(songs, 0);
  };

  const playRow = (index) => {
    if (player.isPlaying && player.currentSong?._id === songs[index]?._id) {
      player.pause();
    } else {
      player.playSong(songs, index);
    }
  };

  const downloadSong = (song) => {
    if (song.youtube_id) window.open(`https://www.youtube.com/watch?v=${song.youtube_id}`, '_blank');
    else if (song.file_path) window.open(`/assets/${song.file_path.replace(/^assets\//, '')}`, '_blank');
  };

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#121212', color: '#fff', fontFamily: 'Roboto, sans-serif' }}>
        <h2>Playlist not found</h2>
        <Link to="/dashboard" style={{ color: '#00b4d8', marginTop: '12px' }}>Back to Dashboard</Link>
      </div>
    );
  }

  if (!playlist) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#121212', color: '#fff' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', marginBottom: '12px' }}>Loading playlist...</div>
          <div style={{ width: '32px', height: '32px', border: '3px solid #333', borderTopColor: '#1db954', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto' }}></div>
        </div>
      </div>
    );
  }

  const coverLetters = playlist.title.trim().slice(0, 3).toUpperCase() || 'MEL';

  return (
    <div className="container">
      <div style={{ padding: '12px 24px 0' }}>
        <Link to="/dashboard" style={{ color: '#b3b3b3', textDecoration: 'none', fontSize: '14px', fontFamily: 'Roboto, sans-serif' }}>
          <i className="fas fa-chevron-left"></i> Back to Dashboard
        </Link>
      </div>
      <div className="header">
        <div className="cover-image">{coverLetters}</div>
        <div className="playlist-info">
          <div className="playlist-type">Public Playlist</div>
          <h1 className="playlist-title">{playlist.title}</h1>
          <div className="playlist-owner">{user?.name || user?.email || playlist.user_email}</div>
          <div className="playlist-stats">
            <span className="stat-item">{items.length} songs</span>
            <span className="stat-item">•</span>
            <span className="stat-item">{totalTimeLabel(items)}</span>
          </div>
          <div className="controls-top">
            <button className="play-btn" onClick={playAll}>
              <i className={`fas ${player.isPlaying && player.currentSong ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
            <div className={`icon-btn menu-btn${menuOpen ? ' show' : ''}`}>
              <i className="fas fa-ellipsis-h" onClick={() => setMenuOpen(!menuOpen)}></i>
              <div className="menu-options">
                <div className="menu-option" onClick={renamePlaylist}>
                  <i className="fas fa-edit"></i>
                  <span>Edit details</span>
                </div>
                <div className="menu-option" onClick={sharePlaylist}>
                  <i className="fas fa-share-alt"></i>
                  <span>Share</span>
                </div>
                <div className="menu-option delete" onClick={deletePlaylist}>
                  <i className="fas fa-trash-alt"></i>
                  <span>Delete playlist</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="song-table">
        <div className="table-header">
          <div>#</div>
          <div>Title</div>
          <div>Genre</div>
          <div>Date added</div>
          <div>⏱</div>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: '32px 16px', textAlign: 'center', color: '#b3b3b3', fontFamily: 'Roboto, sans-serif' }}>
            No songs in this playlist yet — search below to add some.
          </div>
        ) : (
          items.map((item, index) => {
            const song = item.songId;
            if (!song) return null;
            const isCurrent = playingId === String(song._id);
            return (
              <div className={`song-row${isCurrent ? ' playing' : ''}`} key={song._id} onClick={() => playRow(index)}>
                <div className="song-number">{index + 1}</div>
                <div className="song-title-artist">
                  <img className="song-image" src={song.poster_url} alt={song.title} onError={(e) => (e.target.src = DEFAULT_POSTER)} />
                  <div className="song-info">
                    <div className="song-title">{song.title}</div>
                    <div className="song-artist">{song.artist}</div>
                  </div>
                </div>
                <div className="song-album">{song.genre || '—'}</div>
                <div className="song-date">{formatAdded(item.addedAt)}</div>
                <div className="song-duration">
                  {song.duration}
                  <button className="options-btn" onClick={(e) => { e.stopPropagation(); setOpenOptions(openOptions === song._id ? null : song._id); }}>
                    <i className="fas fa-ellipsis-h"></i>
                  </button>
                  <div className={`options-menu${openOptions === song._id ? ' show' : ''}`} onClick={(e) => e.stopPropagation()}>
                    <div className="option-item" onClick={() => playRow(index)}>
                      <i className="fas fa-play"></i>
                      <span>Play song</span>
                    </div>
                    <div className="option-item" onClick={() => window.alert('Added to favorites')}>
                      <i className="fas fa-heart"></i>
                      <span>Add to favorites</span>
                    </div>
                    <div className="option-item remove" onClick={() => removeSong(song._id)}>
                      <i className="fas fa-times"></i>
                      <span>Remove from playlist</span>
                    </div>
                    <div className="option-item" onClick={() => downloadSong(song)}>
                      <i className="fas fa-download"></i>
                      <span>Download</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="search-section">
        <h3 className="search-text">Let's find something for your playlist</h3>
        <div className="search-container">
          <i className="fas fa-search search-icon"></i>
          <input type="text" className="search-bar" placeholder="Search for songs, artists, or albums..." value={search} onChange={handleSearch} />
        </div>
        {search.trim() && (
          <div style={{ marginTop: '16px' }}>
            {searching ? (
              <p style={{ color: '#b3b3b3', fontFamily: 'Roboto, sans-serif' }}>Searching...</p>
            ) : searchResults.length === 0 ? (
              <p style={{ color: '#b3b3b3', fontFamily: 'Roboto, sans-serif' }}>No matching songs found</p>
            ) : (
              searchResults.map((song) => (
                <div key={song._id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 12px', background: '#1a1a1a', borderRadius: '8px', marginBottom: '8px' }}>
                  <img src={song.poster_url} alt={song.title} width="36" height="36" style={{ borderRadius: '4px', objectFit: 'cover' }} onError={(e) => (e.target.src = DEFAULT_POSTER)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#fff', fontFamily: 'Roboto, sans-serif', fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.title}</div>
                    <div style={{ color: '#b3b3b3', fontFamily: 'Roboto, sans-serif', fontSize: '12px' }}>{song.artist}</div>
                  </div>
                  <button onClick={() => addSong(song._id)} style={{ background: '#1db954', border: 'none', color: '#fff', borderRadius: '999px', padding: '6px 14px', cursor: 'pointer', fontFamily: 'Roboto, sans-serif', fontWeight: 700, fontSize: '13px' }}>
                    <i className="fas fa-plus"></i> Add
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className={`floating-player${player.isPlaying && player.currentSong ? ' show' : ''}`}>
        <img src={player.currentSong?.poster_url || DEFAULT_POSTER} alt="Now playing" onError={(e) => (e.target.src = DEFAULT_POSTER)} />
        <div className="floating-info">
          <div className="floating-title">{player.currentSong?.title || 'Not Playing'}</div>
          <div className="floating-artist">{player.currentSong?.artist || ''}</div>
        </div>
        <div className="floating-controls">
          <button onClick={player.prev}><i className="fas fa-step-backward"></i></button>
          <button onClick={player.togglePlay}><i className={`fas ${player.isPlaying ? 'fa-pause' : 'fa-play'}`}></i></button>
          <button onClick={player.next}><i className="fas fa-step-forward"></i></button>
        </div>
      </div>
    </div>
  );
}
