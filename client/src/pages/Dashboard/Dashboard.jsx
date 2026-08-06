import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
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

  const [songs, setSongs] = useState([]);
  const [filteredSongs, setFilteredSongs] = useState([]);
  const [currentSongIndex, setCurrentSongIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(50);
  const [progress, setProgress] = useState(0);
  const [search, setSearch] = useState('');
  const [librarySearch, setLibrarySearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const audioRef = useRef(null);
  const currentSong = currentSongIndex >= 0 ? filteredSongs[currentSongIndex] : null;

  const fetchSongs = async () => {
    const data = await api.get('/api/songs');
    if (data.success) {
      setSongs(data.songs);
      setFilteredSongs(data.songs);
      setCurrentSongIndex((prev) => (prev === -1 && data.songs.length > 0 ? 0 : prev));
    }
  };

  useEffect(() => {
    fetchSongs();
  }, []);

  useEffect(() => {
    if (currentSongIndex >= 0 && filteredSongs.length > 0) {
      const song = filteredSongs[currentSongIndex];
      const audio = audioRef.current;
      audio.src = song.file_path;
      if (isPlaying) audio.play();
    }
  }, [currentSongIndex]);

  useEffect(() => {
    const term = search.toLowerCase();
    const list = songs.filter((s) => s.title.toLowerCase().includes(term) || s.artist.toLowerCase().includes(term));
    setFilteredSongs(list);
  }, [search, songs]);

  const playSong = (song) => {
    const audio = audioRef.current;
    audio.src = song.file_path;
    audio.play();
    setIsPlaying(true);
  };

  const handleSongClick = (index) => {
    if (index === currentSongIndex && isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      setCurrentSongIndex(index);
      playSong(filteredSongs[index]);
    }
  };

  const togglePlay = () => {
    if (filteredSongs.length === 0) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      playSong(filteredSongs[currentSongIndex === -1 ? 0 : currentSongIndex]);
      if (currentSongIndex === -1) setCurrentSongIndex(0);
    }
  };

  const prevSong = () => {
    if (filteredSongs.length === 0) return;
    const next = shuffle ? Math.floor(Math.random() * filteredSongs.length) : (currentSongIndex - 1 + filteredSongs.length) % filteredSongs.length;
    setCurrentSongIndex(next);
    playSong(filteredSongs[next]);
  };

  const nextSong = () => {
    if (filteredSongs.length === 0) return;
    const next = shuffle ? Math.floor(Math.random() * filteredSongs.length) : (currentSongIndex + 1) % filteredSongs.length;
    setCurrentSongIndex(next);
    playSong(filteredSongs[next]);
  };

  const handleVolume = (e) => {
    const v = Number(e.target.value);
    setVolume(v);
    audioRef.current.volume = v / 100;
    setMuted(v === 0);
  };

  const toggleMute = () => {
    const audio = audioRef.current;
    if (muted) {
      audio.volume = volume / 100;
      setMuted(false);
    } else {
      audio.volume = 0;
      setMuted(true);
    }
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    setUploading(true);
    const form = e.target;
    const formData = new FormData(form);
    const data = await api.post('/api/songs/upload', formData);
    setUploading(false);
    if (data.success) {
      alert('Song uploaded successfully');
      setPopupOpen(false);
      form.reset();
      fetchSongs();
    } else {
      alert('Error uploading song: ' + data.error);
    }
  };

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
            <button className="add-song-btn" onClick={() => setPopupOpen(true)}>
              Add Song
            </button>
          </h2>
          <div className="library-search">
            <i className="fa-solid fa-magnifying-glass"></i>
            <input type="text" placeholder="Search in Library" value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} />
          </div>
        </div>
        <div className="scroll-grid">
          <div className="search-container">
            <div className="search-bar">
              <i className="fa-solid fa-magnifying-glass"></i>
              <input type="text" placeholder="Search by songs or artists" value={search} onChange={(e) => setSearch(e.target.value)} />
              <i className="fa-solid fa-face-smile"></i>
            </div>
          </div>
          <div className="songs-container">
            <h2>Songs</h2>
            <div className="songs-grid">
              {filteredSongs.map((song, index) => (
                <div className="song-item" key={song._id || index}>
                  <img className="song-poster" src={song.poster_url.startsWith('http') ? song.poster_url : song.poster_url} alt={`${song.title} Poster`} onError={(e) => (e.target.src = DEFAULT_POSTER)} />
                  <div className="play-button" data-index={index} onClick={() => handleSongClick(index)}>
                    <i className={`fa-solid ${index === currentSongIndex && isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                  </div>
                  <div className="song-info">
                    <div className="song-name">{song.title}</div>
                    <div className="artist-name">{song.artist}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="scroll-grid">
          <div className="now-playing-header">
            <h2 id="right-heading">Now Playing</h2>
          </div>
          <img
            className="song-poster"
            src={currentSong ? currentSong.poster_url : DEFAULT_POSTER}
            alt="Now Playing Song Poster"
            onError={(e) => (e.target.src = DEFAULT_POSTER)}
          />
          <div className="song-details">
            {currentSong ? (
              <>
                <h3>{currentSong.title}</h3>
                <p>Artist: {currentSong.artist}</p>
                <p>Genre: {currentSong.genre}</p>
                <p>Duration: {currentSong.duration}</p>
                <p>Release Date: {currentSong.release_date ? String(currentSong.release_date).slice(0, 10) : 'None'}</p>
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
          <div className="progress-container">
            <div className="progress-bar" style={{ width: `${progress}%` }}></div>
          </div>
          <div className="controls">
            <button className={`control-btn shuffle-btn${shuffle ? ' active' : ''}`} aria-label="Toggle shuffle" data-shuffle={shuffle ? 'on' : 'off'} onClick={() => setShuffle(!shuffle)}>
              <i className="fa-solid fa-shuffle"></i>
            </button>
            <button className="control-btn prev-btn" aria-label="Previous song" onClick={prevSong}>
              <i className="fa-solid fa-backward"></i>
            </button>
            <button className="control-btn play-btn" aria-label="Play song" data-state={isPlaying ? 'pause' : 'play'} onClick={togglePlay}>
              <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
            <button className="control-btn next-btn" aria-label="Next song" onClick={nextSong}>
              <i className="fa-solid fa-forward"></i>
            </button>
            <button className={`control-btn repeat-btn${repeat ? ' active' : ''}`} aria-label="Toggle repeat" data-repeat={repeat ? 'on' : 'off'} onClick={() => setRepeat(!repeat)}>
              <i className="fa-solid fa-repeat"></i>
            </button>
          </div>
          <div className="volume-container">
            <button className="volume-btn" aria-label="Toggle mute" data-muted={muted ? 'true' : 'false'} onClick={toggleMute}>
              <i className={`fa-solid ${muted || volume === 0 ? 'fa-volume-mute' : 'fa-volume-high'}`}></i>
            </button>
            <input type="range" className="volume-slider" min="0" max="100" value={muted ? 0 : volume} aria-label="Volume control" onChange={handleVolume} />
          </div>
          <audio
            id="audio-player"
            ref={audioRef}
            onTimeUpdate={(e) => {
              if (e.target.duration) setProgress((e.target.currentTime / e.target.duration) * 100);
            }}
            onEnded={() => {
              if (repeat) {
                playSong(filteredSongs[currentSongIndex]);
              } else {
                nextSong();
              }
            }}
          ></audio>
        </div>
        <div className={`overlay${popupOpen ? ' active' : ''}`} onClick={() => setPopupOpen(false)}></div>
        <div className={`add-song-popup${popupOpen ? ' active' : ''}`}>
          <button className="close-btn" onClick={() => setPopupOpen(false)}>
            ✕
          </button>
          <h3>Add New Song</h3>
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
      </main>
    </>
  );
}