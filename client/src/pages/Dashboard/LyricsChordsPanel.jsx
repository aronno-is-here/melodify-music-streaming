import { useEffect, useLayoutEffect, useState } from 'react';
import usePlayer from '../../hooks/usePlayer.js';
import cssRaw from './LyricsChordsPanel.css?raw';

export default function LyricsChordsPanel({ onClose }) {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'LyricsChordsPanel');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const player = usePlayer();
  const song = player.currentSong;
  const [activeTab, setActiveTab] = useState('lyrics');
  const [lyrics, setLyrics] = useState('');
  const [chords, setChords] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!song?._id) return;
    setLoading(true);
    setLyrics(song.lyrics || '');
    setChords(song.chords || '');
    setLoading(false);
  }, [song?._id, song?.lyrics, song?.chords]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!song) return null;

  return (
    <div className="lc-panel">
      <div className="lc-header">
        <div className="lc-tabs">
          <button
            className={`lc-tab${activeTab === 'lyrics' ? ' active' : ''}`}
            onClick={() => setActiveTab('lyrics')}
            aria-label="Show lyrics"
          >
            <i className="fa-solid fa-music"></i>
            Lyrics
          </button>
          <button
            className={`lc-tab${activeTab === 'chords' ? ' active' : ''}`}
            onClick={() => setActiveTab('chords')}
            aria-label="Show chords"
          >
            <i className="fa-solid fa-guitar"></i>
            Chords
          </button>
        </div>
        <button className="lc-close" onClick={onClose} aria-label="Close panel">
          <i className="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div className="lc-song-info">
        <img
          className="lc-poster"
          src={song.poster_url || 'https://picsum.photos/60/60?random'}
          alt=""
          onError={(e) => { e.target.src = 'https://picsum.photos/60/60?random'; }}
        />
        <div>
          <div className="lc-title">{song.title}</div>
          <div className="lc-artist">{song.artist}</div>
        </div>
      </div>

      <div className="lc-content">
        {loading ? (
          <div className="lc-empty">Loading...</div>
        ) : activeTab === 'lyrics' ? (
          lyrics.trim() ? (
            <div className="lc-text">{lyrics}</div>
          ) : (
            <div className="lc-empty">
              <i className="fa-solid fa-music"></i>
              <p>Lyrics not available for this song.</p>
            </div>
          )
        ) : chords.trim() ? (
          <pre className="lc-text lc-chords">{chords}</pre>
        ) : (
          <div className="lc-empty">
            <i className="fa-solid fa-guitar"></i>
            <p>Chords not available for this song.</p>
          </div>
        )}
      </div>
    </div>
  );
}
