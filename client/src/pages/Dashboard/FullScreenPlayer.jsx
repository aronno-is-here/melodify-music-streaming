import { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import usePlayer, { formatTime } from '../../hooks/usePlayer.js';
import { selectPlaybackStatusPresentation } from './playbackStatusUi.js';
import LyricsChordsPanel from './LyricsChordsPanel.jsx';
import cssRaw from './FullScreenPlayer.css?raw';

const DEFAULT_POSTER = 'https://picsum.photos/600/600?random';

export default function FullScreenPlayer({ onClose, isFavorited, onToggleFavorite }) {
  const [closing, setClosing] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
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
    setTimeout(() => onClose(), 220);
  }, [onClose]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') {
        if (lyricsOpen) {
          setLyricsOpen(false);
          return;
        }
        handleClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handleClose, lyricsOpen]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const handleSeek = (event) => {
    const ratio = Number(event.target.value) / 1000;
    player.seek(ratio);
  };

  const handleVolume = (event) => {
    player.setVolume(Number(event.target.value));
  };

  const playBtnBlur = () => {
    playBtnRef.current?.blur();
  };

  const song = player.currentSong;
  const poster = song?.poster_url || DEFAULT_POSTER;
  const hasSong = Boolean(song);
  const playbackStatusUi = selectPlaybackStatusPresentation({
    playbackStatus: player.playbackStatus,
    hasSong,
  });

  return (
    <div className={`fs-player${closing ? ' closing' : ''}`} role="dialog" aria-label="Full player" aria-modal="true">
      <div className="fs-bg">
        <img className="fs-bg-img" src={poster} alt="" aria-hidden="true" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
      </div>
      <div className="fs-overlay"></div>

      <div className="fs-top">
        <button className="fs-close-btn" type="button" aria-label="Minimize player" onClick={handleClose}>
          <i className="fa-solid fa-chevron-down" aria-hidden="true"></i>
          <span>Minimize</span>
        </button>
      </div>

      <div className="fs-content">
        <div className="fs-poster-wrap">
          <img className="fs-poster" src={poster} alt={song ? `${song.title} artwork` : 'No song selected'} onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }} />
        </div>

        <div className="fs-song-info">
          <div className="fs-title">{song?.title || 'No Song Selected'}</div>
          <div className="fs-artist">{song?.artist || 'Select a song to play'}</div>
          {song?.genre ? <div className="fs-genre">{song.genre}</div> : null}
        </div>

        {hasSong ? (
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

            {playbackStatusUi.visible ? (
              <div className="fs-status" role="status" aria-live="polite">
                <span>{playbackStatusUi.message}</span>
                {playbackStatusUi.showRetry ? (
                  <button type="button" className="fs-status-retry" onClick={player.retryPlayback}>
                    {playbackStatusUi.retryLabel}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="fs-controls">
              <button
                className={`fs-ctrl-btn${player.playMode !== 'list' ? ' active' : ''}`}
                type="button"
                aria-label="Toggle play mode"
                onClick={() => {
                  const modes = ['list', 'single', 'shuffle'];
                  const idx = modes.indexOf(player.playMode);
                  player.setPlayMode(modes[(idx + 1) % modes.length]);
                }}
              >
                {player.playMode === 'shuffle' ? <i className="fa-solid fa-shuffle" aria-hidden="true"></i> : <i className="fa-solid fa-repeat" aria-hidden="true"></i>}
              </button>
              <button className="fs-ctrl-btn" type="button" aria-label="Previous song" onClick={player.prev}>
                <i className="fa-solid fa-backward-step" aria-hidden="true"></i>
              </button>
              <button
                ref={playBtnRef}
                className="fs-play-btn"
                type="button"
                aria-label={player.isPlaying ? 'Pause' : 'Play'}
                onClick={player.togglePlay}
                onMouseUp={playBtnBlur}
              >
                <i className={`fa-solid ${player.isPlaying ? 'fa-pause' : 'fa-play'}`} aria-hidden="true"></i>
              </button>
              <button className="fs-ctrl-btn" type="button" aria-label="Next song" onClick={player.next}>
                <i className="fa-solid fa-forward-step" aria-hidden="true"></i>
              </button>
              <button
                className={`fs-ctrl-btn ${isFavorited ? 'active' : ''}`}
                type="button"
                aria-label={isFavorited ? 'Remove from liked songs' : 'Add to liked songs'}
                onClick={onToggleFavorite}
              >
                <i className={`fa-${isFavorited ? 'solid' : 'regular'} fa-heart`} aria-hidden="true"></i>
              </button>
            </div>

            <div className="fs-lower-actions">
              <button
                type="button"
                className="fs-lyrics-btn"
                onClick={() => setLyricsOpen((open) => !open)}
                aria-expanded={lyricsOpen}
                aria-controls="fs-lyrics-sheet"
              >
                <i className="fa-solid fa-music" aria-hidden="true"></i>
                {lyricsOpen ? 'Hide Lyrics & Chords' : 'Show Lyrics & Chords'}
              </button>

              <div className="fs-volume">
                <button className="fs-volume-btn" type="button" aria-label="Toggle mute" onClick={player.toggleMute}>
                  <i className={`fa-solid ${player.muted || player.volume === 0 ? 'fa-volume-xmark' : 'fa-volume-high'}`} aria-hidden="true"></i>
                </button>
                <input
                  type="range"
                  className="fs-volume-slider"
                  min="0"
                  max="100"
                  value={player.muted ? 0 : player.volume}
                  aria-label="Volume"
                  onChange={handleVolume}
                  style={{ '--fill': `${player.muted ? 0 : player.volume}%` }}
                />
              </div>
            </div>
          </>
        ) : null}
      </div>

      {lyricsOpen ? (
        <div id="fs-lyrics-sheet" className="fs-lyrics-sheet">
          <LyricsChordsPanel onClose={() => setLyricsOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}
