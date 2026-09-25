import { useEffect, useState } from 'react';
import usePlayer, { formatTime } from '../../hooks/usePlayer.js';
import { selectPlaybackStatusPresentation } from '../../pages/Dashboard/playbackStatusUi.js';
import FavoriteButton from '../music/FavoriteButton.jsx';
import LyricsChordsPanel from '../../pages/Dashboard/LyricsChordsPanel.jsx';

const DEFAULT_POSTER = 'https://picsum.photos/140/140?random';

export default function GlobalPlayerBar({ isFavorited, onToggleFavorite, onExpand }) {
  const player = usePlayer();
  const song = player.currentSong;
  const [lyricsOpen, setLyricsOpen] = useState(false);

  useEffect(() => {
    if (!song) {
      setLyricsOpen(false);
    }
  }, [song]);

  const handleSeek = (event) => {
    const ratio = Number(event.target.value) / 1000;
    player.seek(ratio);
  };

  const handleVolume = (event) => {
    player.setVolume(Number(event.target.value));
  };

  const playbackStatusUi = selectPlaybackStatusPresentation({
    playbackStatus: player.playbackStatus,
    hasSong: Boolean(song),
  });

  return (
    <>
      <div className="app-player app-player-desktop" role="region" aria-label="Global music player">
        <div className="app-player-main">
          <div className="app-player-left">
            <img
              className="app-player-art"
              src={song?.poster_url || DEFAULT_POSTER}
              alt={song ? `${song.title} artwork` : 'No song selected'}
              onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
            />
            <div className="app-player-meta">
              <div className="app-player-title">{song?.title || 'Choose a song to start listening'}</div>
              <div className="app-player-artist">{song ? song.artist : 'Melodify'}</div>
            </div>
          </div>

          <div className="app-player-center">
            <div className="app-player-controls">
              <button type="button" className="music-icon-control" aria-label="Previous song" onClick={player.prev}>
                <i className="fa-solid fa-backward-step" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                className="music-icon-control app-player-primary"
                aria-label={player.isPlaying ? 'Pause song' : 'Play song'}
                onClick={player.togglePlay}
              >
                <i className={`fa-solid ${player.isPlaying ? 'fa-pause' : 'fa-play'}`} aria-hidden="true"></i>
              </button>
              <button type="button" className="music-icon-control" aria-label="Next song" onClick={player.next}>
                <i className="fa-solid fa-forward-step" aria-hidden="true"></i>
              </button>
              <button
                type="button"
                className={`music-icon-control ${player.playMode !== 'list' ? 'is-active' : ''}`}
                aria-label="Toggle play mode"
                onClick={() => {
                  const modes = ['list', 'single', 'shuffle'];
                  const idx = modes.indexOf(player.playMode);
                  player.setPlayMode(modes[(idx + 1) % modes.length]);
                }}
              >
                {player.playMode === 'shuffle' ? (
                  <i className="fa-solid fa-shuffle" aria-hidden="true"></i>
                ) : (
                  <i className="fa-solid fa-repeat" aria-hidden="true"></i>
                )}
              </button>
            </div>

            <div className="app-player-progress-wrap">
              <span className="app-player-time">{formatTime(player.currentTime)}</span>
              <input
                type="range"
                className="app-player-progress"
                min="0"
                max="1000"
                step="1"
                value={Math.min(1000, Math.round(player.progress * 10))}
                onChange={handleSeek}
                aria-label="Seek playback"
                style={{ '--fill': `${player.progress}%` }}
              />
              <span className="app-player-time">{song ? song.duration : formatTime(player.duration)}</span>
            </div>

            {playbackStatusUi.visible ? (
              <div className="app-player-status" role="status" aria-live="polite">
                <span>{playbackStatusUi.message}</span>
                {playbackStatusUi.showRetry ? (
                  <button type="button" className="music-outline-btn" onClick={player.retryPlayback}>
                    {playbackStatusUi.retryLabel}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="app-player-right">
            <FavoriteButton
              active={Boolean(song && isFavorited)}
              onClick={() => { if (song) onToggleFavorite(song._id); }}
              ariaLabel={song ? `Toggle liked state for ${song.title}` : 'Toggle liked state'}
            />
            <button type="button" className="music-icon-control" aria-label="Toggle mute" onClick={player.toggleMute}>
              <i className={`fa-solid ${player.muted || player.volume === 0 ? 'fa-volume-xmark' : 'fa-volume-high'}`} aria-hidden="true"></i>
            </button>
            <button
              type="button"
              className={`music-icon-control ${lyricsOpen ? 'is-active' : ''}`}
              aria-label={lyricsOpen ? 'Hide lyrics and chords' : 'Show lyrics and chords'}
              aria-expanded={lyricsOpen}
              aria-controls="app-player-lyrics-drawer"
              disabled={!song}
              onClick={() => setLyricsOpen((open) => !open)}
            >
              <i className="fa-solid fa-music" aria-hidden="true"></i>
            </button>
            <input
              type="range"
              className="app-player-volume"
              min="0"
              max="100"
              value={player.muted ? 0 : player.volume}
              onChange={handleVolume}
              aria-label="Volume"
              style={{ '--fill': `${player.muted ? 0 : player.volume}%` }}
            />
            <button
              type="button"
              className="music-icon-control"
              aria-label="Open full player"
              onClick={() => {
                setLyricsOpen(false);
                onExpand();
              }}
            >
              <i className="fa-solid fa-up-right-and-down-left-from-center" aria-hidden="true"></i>
            </button>
          </div>
        </div>
      </div>

      {song ? (
        <div
          className="app-player-mini"
          onClick={() => {
            setLyricsOpen(false);
            onExpand();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setLyricsOpen(false);
              onExpand();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Open full player"
        >
          <span className="app-mini-progress" style={{ width: `${player.progress}%` }}></span>
          <img
            className="app-mini-art"
            src={song.poster_url || DEFAULT_POSTER}
            alt=""
            onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
          />
          <span className="app-mini-meta">
            <span className="app-mini-title">{song.title}</span>
            <span className="app-mini-artist">{song.artist}</span>
          </span>
          <span className="app-mini-controls">
            <button
              type="button"
              className="music-icon-control"
              aria-label={player.isPlaying ? 'Pause song' : 'Play song'}
              onClick={(event) => {
                event.stopPropagation();
                player.togglePlay();
              }}
            >
              <i className={`fa-solid ${player.isPlaying ? 'fa-pause' : 'fa-play'}`} aria-hidden="true"></i>
            </button>
            <button
              type="button"
              className="music-icon-control"
              aria-label="Next song"
              onClick={(event) => {
                event.stopPropagation();
                player.next();
              }}
            >
              <i className="fa-solid fa-forward-step" aria-hidden="true"></i>
            </button>
            <button
              type="button"
              className={`music-icon-control ${lyricsOpen ? 'is-active' : ''}`}
              aria-label={lyricsOpen ? 'Hide lyrics and chords' : 'Show lyrics and chords'}
              aria-expanded={lyricsOpen}
              aria-controls="app-player-lyrics-drawer"
              onClick={(event) => {
                event.stopPropagation();
                setLyricsOpen((open) => !open);
              }}
            >
              <i className="fa-solid fa-music" aria-hidden="true"></i>
            </button>
          </span>
        </div>
      ) : null}

      {song && lyricsOpen ? (
        <div id="app-player-lyrics-drawer" className="app-player-lyrics-drawer" role="region" aria-label="Lyrics and chords">
          <div className="app-player-lyrics-sheet app-surface">
            <LyricsChordsPanel onClose={() => setLyricsOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
