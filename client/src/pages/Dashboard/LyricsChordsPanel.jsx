import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import usePlayer from '../../hooks/usePlayer.js';
import { api } from '../../api/client.js';
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
  const [lyricsLines, setLyricsLines] = useState([]);
  const [lyricsSynced, setLyricsSynced] = useState(false);
  const [chords, setChords] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const lyricsContainerRef = useRef(null);
  const activeLineRef = useRef(null);

  useEffect(() => {
    if (!song?._id) {
      setLyricsLines([]);
      setLyricsSynced(false);
      setChords(song?.chords || '');
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLyricsLines([]);
    setLyricsSynced(false);
    setChords(song.chords || '');

    api.get(`/api/lyrics/${song._id}`).then((data) => {
      if (cancelled) return;
      if (data.success) {
        setLyricsLines(data.lines || []);
        setLyricsSynced(data.synced || false);
      }
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [song?._id, song?.chords]);

  useEffect(() => {
    if (!lyricsSynced || lyricsLines.length === 0) {
      setActiveLineIndex(-1);
      return;
    }

    const time = player.currentTime;
    let idx = -1;
    for (let i = lyricsLines.length - 1; i >= 0; i--) {
      if (lyricsLines[i].time !== null && time >= lyricsLines[i].time) {
        idx = i;
        break;
      }
    }
    setActiveLineIndex(idx);
  }, [player.currentTime, lyricsSynced, lyricsLines]);

  useEffect(() => {
    if (activeLineIndex < 0 || !lyricsContainerRef.current || !activeLineRef.current) return;
    const container = lyricsContainerRef.current;
    const el = activeLineRef.current;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset = elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;
    container.scrollTo({ top: container.scrollTop + offset, behavior: 'smooth' });
  }, [activeLineIndex]);

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

      <div className="lc-content" ref={lyricsContainerRef}>
        {loading ? (
          <div className="lc-empty">Loading...</div>
        ) : activeTab === 'lyrics' ? (
          lyricsLines.length > 0 ? (
            <div className={`lc-lyrics${lyricsSynced ? ' synced' : ''}`}>
              {lyricsLines.map((line, i) => {
                const isActive = lyricsSynced && i === activeLineIndex;
                return (
                  <div
                    key={`${song._id}-lyric-${i}`}
                    ref={isActive ? activeLineRef : null}
                    className={`lc-lyric-line${isActive ? ' active' : ''}${!lyricsSynced ? ' static' : ''}`}
                  >
                    {line.text || '\u00A0'}
                  </div>
                );
              })}
            </div>
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
