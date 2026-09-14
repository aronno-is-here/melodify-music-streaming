import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import usePlayer, { formatTime } from '../../hooks/usePlayer.js';
import cssRaw from './SongDetails.css?raw';

const DEFAULT_POSTER = 'https://picsum.photos/300/300?random';

export default function SongDetails() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'SongDetails');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { id } = useParams();
  const navigate = useNavigate();
  const [song, setSong] = useState(null);
  const [related, setRelated] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [shuffled, setShuffled] = useState(false);
  const player = usePlayer();

  useEffect(() => {
    const fetchSong = async () => {
      const data = await api.get(`/api/songs/${id}`);
      if (!data.success) {
        setNotFound(true);
        return;
      }
      setSong(data.song);
      const all = await api.get('/api/songs?limit=100');
      if (all.success) {
        const others = all.songs.filter((s) => String(s._id) !== String(data.song._id));
        const sameArtist = others.filter((s) => s.artist.toLowerCase() === data.song.artist.toLowerCase());
        const sameGenre = others.filter((s) => s.genre.toLowerCase() === data.song.genre.toLowerCase());
        const rest = others.filter((s) => !sameArtist.includes(s) && !sameGenre.includes(s));
        setRelated([...sameArtist, ...sameGenre, ...rest].slice(0, 10));
      }
    };
    fetchSong();
  }, [id]);

  if (notFound) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#121212', color: '#fff', fontFamily: 'Roboto, sans-serif' }}>
        <h2>Song not found</h2>
        <Link to="/dashboard" style={{ color: '#00b4d8', marginTop: '12px' }}>Back to Dashboard</Link>
      </div>
    );
  }

  if (!song) return null;

  const tracks = [song, ...related];
  const displayTracks = useMemo(() => {
    if (!shuffled) return tracks;
    const copy = [...tracks];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }, [tracks, shuffled]);
  const playingId = player.currentSong?._id;
  const subtitle = `${song.artist} • ${String(song.release_date || '').slice(0, 4) || 'Unknown year'} • ${displayTracks.length} songs`;
  const totalDuration = displayTracks.reduce((sum, t) => {
    const parts = String(t.duration || '0:00').split(':').map(Number);
    return sum + (parts.length === 2 ? parts[0] * 60 + parts[1] : 0);
  }, 0);
  const totalLabel = `${Math.floor(totalDuration / 60)} min ${totalDuration % 60} sec`;

  const playTrack = (trackIndex) => {
    if (player.isPlaying && playingId === displayTracks[trackIndex]._id) player.pause();
    else player.playSong(displayTracks, trackIndex);
  };

  const togglePlay = () => {
    if (player.currentSong) player.togglePlay();
    else player.playSong(displayTracks, 0);
  };

  const toggleShuffle = () => {
    setShuffled((s) => {
      const nextVal = !s;
      if (nextVal && player.isPlaying) player.playSong(displayTracks, 0);
      return nextVal;
    });
  };

  const downloadSong = () => {
    if (song.youtube_id) window.open(`https://www.youtube.com/watch?v=${song.youtube_id}`, '_blank');
    else if (song.file_path) window.open(`/assets/${song.file_path.replace(/^assets\//, '')}`, '_blank');
  };

  const menuClick = () => {
    window.alert('Menu options:\n\n• Add to Playlist\n• Share Album\n• Go to Artist');
  };

  const seekFromEvent = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    player.seek(Math.max(0, Math.min(1, ratio)));
  };

  return (
    <div className="container">
      <div className="header">
        <button className="back-button" onClick={() => navigate(-1)}>
          <i className="fas fa-chevron-left"></i>
        </button>
        <span>Album</span>
      </div>

      <div className="album-container">
        <div className="album-art">
          <img src={song.poster_url} alt={`${song.title} Poster`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => (e.target.src = DEFAULT_POSTER)} />
        </div>
        <div className="album-info">
          <div className="album-type">Song</div>
          <h1 className="album-title">{song.title}</h1>
          <p className="album-subtitle">
            {subtitle} • {totalLabel}
          </p>

          <div className="album-actions">
            <button className="play-btn" id="playBtn" onClick={togglePlay}>
              <i className={`fas ${player.isPlaying && player.currentSong ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
            <button className={`action-btn${favorite ? ' added' : ''}`} id="addBtn" onClick={() => setFavorite(!favorite)}>
              <i className={`${favorite ? 'fas' : 'far'} fa-heart`}></i>
            </button>
            <button className="action-btn" id="downloadBtn" onClick={downloadSong}>
              <i className="fas fa-download"></i>
            </button>
            <button className="action-btn" id="menuBtn" onClick={menuClick}>
              <i className="fas fa-ellipsis-h"></i>
            </button>
          </div>
        </div>
      </div>

      <div className="tracklist">
        <div className="track-header">
          <div>#</div>
          <div>Title</div>
          <div>Time</div>
        </div>

        {displayTracks.map((track, trackIndex) => (
          <div className={`track-item${playingId === track._id ? ' playing' : ''}`} key={track._id} onClick={() => playTrack(trackIndex)}>
            <div className="track-number">{trackIndex + 1}</div>
            <div className="track-info">
              <div className="track-title">{track.title}</div>
              <div className="track-artist">{track.artist}</div>
            </div>
            <div className="track-duration">{track.duration || '0:00'}</div>
            <div className="progress-bar" style={{ transform: `scaleX(${playingId === track._id ? player.progress / 100 : 0})` }}></div>
          </div>
        ))}
      </div>

      <div className="footer-player">
        <div className="now-playing">
          <div className="now-playing-img">
            {player.currentSong && <img src={player.currentSong.poster_url} alt="Now playing" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => (e.target.src = DEFAULT_POSTER)} />}
          </div>
          <div className="now-playing-info">
            <div className="now-playing-title">{player.currentSong?.title || 'Not Playing'}</div>
            <div className="now-playing-artist">{player.currentSong ? player.currentSong.artist : 'Select a song to play'}</div>
          </div>
        </div>

        <div className="player-controls">
          <div className="control-buttons">
            <button className="control-btn" onClick={toggleShuffle} style={shuffled ? { color: '#1db954' } : undefined}><i className="fas fa-random"></i></button>
            <button className="control-btn" onClick={player.prev}><i className="fas fa-step-backward"></i></button>
            <button className="control-btn play-pause" id="footerPlayBtn" onClick={togglePlay}>
              <i className={`fas ${player.isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
            </button>
            <button className="control-btn" onClick={player.next}><i className="fas fa-step-forward"></i></button>
            <button className="control-btn" onClick={() => player.setRepeat(!player.repeat)} style={player.repeat ? { color: '#1db954' } : undefined}><i className="fas fa-repeat"></i></button>
          </div>

          <div className="progress-container" onClick={seekFromEvent} style={{ cursor: 'pointer' }}>
            <div className="progress-time">{formatTime(player.currentTime)}</div>
            <div className="progress-bar-full">
              <div className="progress-bar-current" style={{ width: `${player.progress}%` }}></div>
            </div>
            <div className="progress-time">{formatTime(player.duration)}</div>
          </div>
        </div>

        <div className="volume-controls">
          <i className={`fas ${player.muted ? 'fa-volume-mute' : 'fa-volume-up'} volume-icon`} onClick={player.toggleMute}></i>
          <div className="volume-bar" onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            player.setVolume(Math.round(((e.clientX - rect.left) / rect.width) * 100));
          }} style={{ cursor: 'pointer' }}>
            <div className="volume-level" style={{ width: `${player.muted ? 0 : player.volume}%` }}></div>
          </div>
        </div>
      </div>
    </div>
  );
}
