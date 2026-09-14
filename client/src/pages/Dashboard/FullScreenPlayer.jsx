import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import usePlayer, { formatTime } from '../../hooks/usePlayer.js';
import cssRaw from './FullScreenPlayer.css?raw';

const DEFAULT_POSTER = 'https://picsum.photos/600/600?random';

export default function FullScreenPlayer({ onClose }) {
  const [closing, setClosing] = useState(false);
  const player = usePlayer();
  const playBtnRef = useRef(null);

  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'FullScreenPlayer');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => onClose(), 260);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const handleSeek = (e) => {
    const ratio = Number(e.target.value) / 1000;
    player.seek(ratio);
  };

  const handleVolume = (e) => {
    player.setVolume(Number(e.target.value));
  };

  const playBtnBlur = () => {
    if (playBtnRef.current) playBtnRef.current.blur();
  };

  const song = player.currentSong;
  const poster = song?.poster_url || DEFAULT_POSTER;
  const hasSong = !!song;

  return (
    <div className={`fs-player${closing ? ' closing' : ''}`}>
      <div className="fs-bg">
        <img className="fs-bg-img" src={poster} alt="" aria-hidden="true" onError={(e) => { e.target.style.display = 'none'; }} />
      </div>
      <div className="fs-overlay"></div>

      <div className="fs-top">
        <button className="fs-close-btn" type="button" aria-label="Close full screen player" onClick={handleClose}>
          <i className="fa-solid fa-chevron-left"></i>
          <span>Back</span>
        </button>
      </div>

      <div className="fs-content">
        <div className="fs-poster-wrap">
          <img className="fs-poster" src={poster} alt={song ? `${song.title} artwork` : 'No song selected'} onError={(e) => { e.target.src = DEFAULT_POSTER; }} />
        </div>

        <div className="fs-song-info">
          <div className="fs-title">{song?.title || 'No Song Selected'}</div>
          <div className="fs-artist">{song?.artist || 'Select a song to play'}</div>
          {song?.genre && <div className="fs-genre">{song.genre}</div>}
        </div>

        {hasSong && (
          <>
            <div className="fs-progress">
              <input
                type="range"
                className="fs-progress-slider"
                min="0"
                max="1000"
                step="1"
                value={Math.min(1000, Math.round(player.progress * 10))}
                onChange={handleSeek}
                aria-label="Seek"
                style={{ '--fill': `${player.progress}%` }}
              />
              <div className="fs-progress-time">
                <span>{formatTime(player.currentTime)}</span>
                <span>{song?.duration || formatTime(player.duration)}</span>
              </div>
            </div>

            <div className="fs-controls">
              <button className={`fs-ctrl-btn${player.playMode !== 'list' ? ' active' : ''}`} type="button" aria-label="Toggle play mode" onClick={() => {
                const modes = ['list', 'single', 'shuffle'];
                const i = modes.indexOf(player.playMode);
                player.setPlayMode(modes[(i + 1) % modes.length]);
              }}>
                {player.playMode === 'list' && <i className="fa-solid fa-repeat"></i>}
                {player.playMode === 'single' && <><i className="fa-solid fa-repeat"></i><span className="fs-mode-badge">1</span></>}
                {player.playMode === 'shuffle' && <i className="fa-solid fa-shuffle"></i>}
              </button>
              <button className="fs-ctrl-btn" type="button" aria-label="Previous song" onClick={player.prev}>
                <i className="fa-solid fa-backward-step"></i>
              </button>
              <button
                ref={playBtnRef}
                className="fs-play-btn"
                type="button"
                aria-label={player.isPlaying ? 'Pause' : 'Play'}
                onClick={player.togglePlay}
                onMouseUp={playBtnBlur}
              >
                <i className={`fa-solid ${player.isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
              </button>
              <button className="fs-ctrl-btn" type="button" aria-label="Next song" onClick={player.next}>
                <i className="fa-solid fa-forward-step"></i>
              </button>
              <div className="fs-controls-spacer"></div>
            </div>

            <div className="fs-volume">
              <button className="fs-volume-btn" type="button" aria-label="Toggle mute" onClick={player.toggleMute}>
                <i className={`fa-solid ${player.muted || player.volume === 0 ? 'fa-volume-xmark' : 'fa-volume-high'}`}></i>
              </button>
              <input
                type="range"
                className="fs-volume-slider"
                min="0"
                max="100"
                value={player.muted ? 0 : player.volume}
                aria-label="Volume"
                onChange={handleVolume}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
