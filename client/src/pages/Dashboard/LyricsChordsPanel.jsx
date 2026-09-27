import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import usePlayer from '../../hooks/usePlayer.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './LyricsChordsPanel.css?raw';

const SOURCE_FALLBACK_STATUSES = new Set(['unavailable', 'ambiguous']);
const hasSourceFallbackStatus = (status) => typeof status === 'string' && SOURCE_FALLBACK_STATUSES.has(status);
const toSourceCandidate = (value) => (
  value && typeof value === 'object' && typeof value.url === 'string' && value.url
    ? {
      provider: typeof value.provider === 'string' ? value.provider : '',
      providerLabel: typeof value.providerLabel === 'string' ? value.providerLabel : '',
      url: value.url,
      title: typeof value.title === 'string' ? value.title : '',
      artist: typeof value.artist === 'string' ? value.artist : '',
      confidence: typeof value.confidence === 'string' ? value.confidence : '',
    }
    : null
);

export default function LyricsChordsPanel({ onClose }) {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'LyricsChordsPanel');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const player = usePlayer();
  const navigate = useNavigate();
  const auth = useAuth();
  const isAdmin = auth?.user?.role === 'admin';
  const song = player.currentSong;
  const [activeTab, setActiveTab] = useState('lyrics');
  const [lyricsLines, setLyricsLines] = useState([]);
  const [lyricsSynced, setLyricsSynced] = useState(false);
  const [romanizedLines, setRomanizedLines] = useState(null);
  const [lyricsScript, setLyricsScript] = useState('other');
  const [lyricsView, setLyricsView] = useState('original');
  const [chords, setChords] = useState('');
  const [loading, setLoading] = useState(false);
  const [sourceCandidate, setSourceCandidate] = useState(null);
  const [activeLineIndex, setActiveLineIndex] = useState(-1);
  const lyricsContainerRef = useRef(null);
  const activeLineRef = useRef(null);

  useEffect(() => {
    if (!song?._id) {
      setLyricsLines([]);
      setLyricsSynced(false);
      setRomanizedLines(null);
      setLyricsScript('other');
      setLyricsView('original');
      setChords(song?.chords || '');
      setSourceCandidate(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLyricsLines([]);
    setLyricsSynced(false);
    setRomanizedLines(null);
    setLyricsScript('other');
    setLyricsView('original');
    setChords(song.chords || '');
    setSourceCandidate(null);

    api.get(`/api/lyrics/${song._id}`).then((data) => {
      if (cancelled) return;
      if (data.success) {
        const script = typeof data.script === 'string' ? data.script : 'other';
        const romanized = Array.isArray(data.romanizedLines) && data.romanizedLines.length > 0
          ? data.romanizedLines
          : null;
        setLyricsLines(data.lines || []);
        setLyricsSynced(data.synced || false);
        setRomanizedLines(romanized);
        setLyricsScript(script);
        setLyricsView(script === 'devanagari' && romanized ? 'romanized' : 'original');

        const cachedCandidate = toSourceCandidate(data.sourceCandidate);
        if (cachedCandidate) {
          setSourceCandidate(cachedCandidate);
        } else if (hasSourceFallbackStatus(data.status) && localStorage.getItem('melodify_token')) {
          api.get(`/api/lyrics/${song._id}/sources`).then((sources) => {
            if (cancelled) return;
            const discovered = Array.isArray(sources?.candidates)
              ? toSourceCandidate(sources.candidates[0])
              : null;
            if (discovered) setSourceCandidate(discovered);
          }).catch(() => {});
        }
      }
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [song?._id, song?.chords]);

  const openAdminEditor = () => {
    if (!song?._id) return;
    navigate('/admin', { state: { section: 'music', editSongId: song._id } });
  };

  const showRomanized = lyricsView === 'romanized'
    && Array.isArray(romanizedLines)
    && romanizedLines.length > 0;
  const displayLines = showRomanized ? romanizedLines : lyricsLines;
  const canToggleLyricsView = Boolean(romanizedLines) && lyricsLines.length > 0;
  const lyricsViewLabels = lyricsScript === 'bengali'
    ? { original: 'বাংলা', romanized: 'Romanized' }
    : { original: 'Original', romanized: 'Romanized' };

  useEffect(() => {
    if (!lyricsSynced || displayLines.length === 0) {
      setActiveLineIndex(-1);
      return;
    }

    const time = player.currentTime;
    let idx = -1;
    for (let i = displayLines.length - 1; i >= 0; i--) {
      if (displayLines[i].time !== null && time >= displayLines[i].time) {
        idx = i;
        break;
      }
    }
    setActiveLineIndex(idx);
  }, [player.currentTime, lyricsSynced, displayLines]);

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
            <>
              {canToggleLyricsView ? (
                <div className="lc-view-toggle" role="group" aria-label="Lyrics view">
                  <button
                    type="button"
                    className={`lc-view-btn${lyricsView === 'original' ? ' active' : ''}`}
                    aria-pressed={lyricsView === 'original'}
                    onClick={() => setLyricsView('original')}
                  >
                    {lyricsViewLabels.original}
                  </button>
                  <button
                    type="button"
                    className={`lc-view-btn${lyricsView === 'romanized' ? ' active' : ''}`}
                    aria-pressed={lyricsView === 'romanized'}
                    onClick={() => setLyricsView('romanized')}
                  >
                    {lyricsViewLabels.romanized}
                  </button>
                </div>
              ) : null}
              <div className={`lc-lyrics${lyricsSynced ? ' synced' : ''}`}>
                {displayLines.map((line, i) => {
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
            </>
          ) : (
            <div className="lc-empty">
              <i className="fa-solid fa-music"></i>
              <p>Lyrics not available in Melodify.</p>
              {sourceCandidate ? (
                <div className="lc-source-fallback">
                  <span className="lc-source-label">Possible source found:</span>
                  <a
                    className="lc-source-link"
                    href={sourceCandidate.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View Source
                  </a>
                  {isAdmin ? (
                    <button
                      type="button"
                      className="lc-source-add"
                      onClick={openAdminEditor}
                    >
                      Add Verified Lyrics
                    </button>
                  ) : null}
                </div>
              ) : null}
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
