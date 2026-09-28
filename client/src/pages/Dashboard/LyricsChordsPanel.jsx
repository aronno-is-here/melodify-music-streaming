import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import usePlayer from '../../hooks/usePlayer.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './LyricsChordsPanel.css?raw';
import {
  CHORD_FORMATS,
  detectChordFormat,
  findActiveChord,
  formatChordTime,
  parseChordPro,
  transposeChordSheet,
} from '../../utils/chordSheet.js';

const SOURCE_FALLBACK_STATUSES = new Set(['unavailable', 'ambiguous']);
const hasSourceFallbackStatus = (status) => typeof status === 'string' && SOURCE_FALLBACK_STATUSES.has(status);
const TRANSPOSE_FLOOR = -12;
const TRANSPOSE_CEILING = 12;
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
  const [chordText, setChordText] = useState('');
  const [chordMeta, setChordMeta] = useState(null);
  const [chordLoading, setChordLoading] = useState(false);
  const [transposeOffset, setTransposeOffset] = useState(0);
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
      setChordText(song?.chords || '');
      setChordMeta(null);
      setTransposeOffset(0);
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
    setChordText(song.chords || '');
    setChordMeta(null);
    setTransposeOffset(0);
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

  useEffect(() => {
    if (activeTab !== 'chords') return undefined;
    if (!song?._id) {
      setChordText('');
      setChordMeta(null);
      setChordLoading(false);
      return undefined;
    }

    let cancelled = false;
    setChordLoading(true);
    setChordText(song.chords || '');
    setChordMeta(null);
    api.get(`/api/chords/${song._id}`).then((data) => {
      if (cancelled) return;
      if (data && data.success) {
        setChordText(typeof data.text === 'string' ? data.text : '');
        setChordMeta({
          status: typeof data.status === 'string' ? data.status : '',
          format: CHORD_FORMATS.includes(data.format) ? data.format : null,
          key: typeof data.key === 'string' ? data.key : null,
          capo: typeof data.capo === 'number' ? data.capo : null,
          tuning: typeof data.tuning === 'string' ? data.tuning : null,
          source: typeof data.source === 'string' ? data.source : null,
          sourceUrl: typeof data.sourceUrl === 'string' ? data.sourceUrl : '',
          verified: data.verified === true,
          timeline: Array.isArray(data.timeline) ? data.timeline : null,
        });
        setTransposeOffset(0);
      }
      setChordLoading(false);
    }).catch(() => {
      if (!cancelled) setChordLoading(false);
    });

    return () => { cancelled = true; };
  }, [activeTab, song?._id]);

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

  const chordFormat = chordMeta && CHORD_FORMATS.includes(chordMeta.format)
    ? chordMeta.format
    : detectChordFormat(chordText);
  const chords = useMemo(
    () => transposeChordSheet(chordText, transposeOffset, chordFormat),
    [chordText, transposeOffset, chordFormat]
  );
  const chordTimeline = Array.isArray(chordMeta?.timeline) && chordMeta.timeline.length > 0
    ? chordMeta.timeline
    : null;
  const chordPro = useMemo(() => {
    if (chordTimeline || chordFormat === 'plain') return null;
    const parsed = parseChordPro(chords);
    return parsed.valid ? parsed : null;
  }, [chords, chordFormat, chordTimeline]);
  const activeChordIndex = useMemo(
    () => (chordTimeline ? findActiveChord(chordTimeline, player.currentTime) : -1),
    [chordTimeline, player.currentTime]
  );
  const sourcePageUrl = chordMeta?.sourceUrl || '';

  const changeTranspose = (delta) => {
    setTransposeOffset((current) => {
      const next = current + delta;
      if (next < TRANSPOSE_FLOOR) return TRANSPOSE_FLOOR;
      if (next > TRANSPOSE_CEILING) return TRANSPOSE_CEILING;
      return next;
    });
  };

  const seekToChord = (seconds) => {
    if (!Number.isFinite(seconds) || !player.duration) return;
    player.seek(seconds / player.duration);
  };

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

  const renderChordToolbar = () => (
    <div className="lc-chord-toolbar">
      <div className="lc-chord-meta">
        <span className="lc-chord-meta-item">Key <b>{chordMeta?.key || 'Not set'}</b></span>
        <span className="lc-chord-meta-item">Capo <b>{chordMeta?.capo === null || chordMeta?.capo === undefined ? '0' : chordMeta.capo}</b></span>
        <span className="lc-chord-meta-item">Tuning <b>{chordMeta?.tuning || 'Standard'}</b></span>
        <span className="lc-chord-meta-item">Format <b>{chordFormat}</b></span>
        <span className={`lc-chord-meta-item lc-chord-badge${chordMeta?.verified ? ' verified' : ''}`}>
          {chordMeta?.verified ? 'Verified' : 'Unverified'}
        </span>
      </div>
      <div className="lc-transpose" role="group" aria-label="Transpose chords">
        <button
          type="button"
          className="lc-transpose-btn"
          onClick={() => changeTranspose(-1)}
          disabled={transposeOffset <= TRANSPOSE_FLOOR}
          aria-label="Transpose down one semitone"
        >
          <i className="fa-solid fa-minus"></i>
        </button>
        <span className="lc-transpose-value" aria-live="polite">
          {transposeOffset > 0 ? `+${transposeOffset}` : transposeOffset} semitones
        </span>
        <button
          type="button"
          className="lc-transpose-btn"
          onClick={() => changeTranspose(1)}
          disabled={transposeOffset >= TRANSPOSE_CEILING}
          aria-label="Transpose up one semitone"
        >
          <i className="fa-solid fa-plus"></i>
        </button>
        <button
          type="button"
          className="lc-transpose-btn lc-transpose-reset"
          onClick={() => setTransposeOffset(0)}
          disabled={transposeOffset === 0}
        >
          Reset
        </button>
      </div>
    </div>
  );

  const renderChordBody = () => {
    if (chordTimeline) {
      return (
        <div className="lc-timeline">
          {chordTimeline.map((entry, i) => (
            <button
              type="button"
              key={`${song._id}-chord-time-${i}`}
              className={`lc-timeline-row${i === activeChordIndex ? ' active' : ''}`}
              onClick={() => seekToChord(entry.time)}
              disabled={!player.duration}
            >
              <span className="lc-timeline-time">{formatChordTime(entry.time)}</span>
              <span className="lc-timeline-chord">{entry.chord}</span>
            </button>
          ))}
        </div>
      );
    }

    if (chordPro) {
      return (
        <div className="lc-chordpro">
          {chordPro.lines.map((line, i) => (
            <div className="lc-chordpro-line" key={`${song._id}-chord-line-${i}`}>
              {line.segments.map((segment, j) => (
                <span className="lc-chord-segment" key={`${song._id}-chord-segment-${i}-${j}`}>
                  {segment.chord ? <b className="lc-chord-token">{segment.chord}</b> : null}
                  <span className="lc-chord-syllable">{segment.text}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      );
    }

    return <pre className="lc-text lc-chords">{chords}</pre>;
  };

  const renderChordsTab = () => {
    if (chordLoading) {
      return <div className="lc-empty">Loading...</div>;
    }

    if (!chords.trim()) {
      return (
        <div className="lc-empty">
          <i className="fa-solid fa-guitar"></i>
          <p>Chords not available for this song.</p>
          {sourcePageUrl ? (
            <div className="lc-source-fallback">
              <span className="lc-source-label">Possible source found:</span>
              <a
                className="lc-source-link"
                href={sourcePageUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                View Source
              </a>
              {isAdmin ? (
                <button type="button" className="lc-source-add" onClick={openAdminEditor}>
                  Add Verified Chords
                </button>
              ) : null}
            </div>
          ) : isAdmin ? (
            <div className="lc-source-fallback">
              <button type="button" className="lc-source-add" onClick={openAdminEditor}>
                Add Verified Chords
              </button>
            </div>
          ) : null}
        </div>
      );
    }

    return (
      <>
        {renderChordToolbar()}
        {renderChordBody()}
      </>
    );
  };

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
        ) : (
          renderChordsTab()
        )}
      </div>
    </div>
  );
}
