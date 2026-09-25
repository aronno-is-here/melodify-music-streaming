import { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import cssRaw from './MelodifyStudio.css?raw';

const EFFECTS_PRESETS = {
  clean: { gain: 1, reverb: 0, echo: 0, bass: 0, treble: 0, label: 'Clean' },
  studio: { gain: 0.85, reverb: 0.15, echo: 0, bass: 0.1, treble: 0.1, label: 'Studio' },
  warm: { gain: 0.9, reverb: 0.1, echo: 0.05, bass: 0.2, treble: -0.1, label: 'Warm' },
  echo: { gain: 0.8, reverb: 0, echo: 0.3, bass: 0, treble: 0, label: 'Echo' },
  hall: { gain: 0.75, reverb: 0.4, echo: 0.1, bass: 0.05, treble: 0.05, label: 'Hall' },
};

const STEPS = { SELECT: 'select', RECORD: 'record', PREVIEW: 'preview', PUBLISH: 'publish' };
const DISCOVERY_PAGE_SIZE = 12;
const DISCOVERY_REGION_OPTIONS = [
  { id: '', label: 'All' },
  { id: 'bn-bd', label: 'Bangla' },
  { id: 'bn-in', label: 'Kolkata Bengali' },
  { id: 'hi-in', label: 'Hindi' },
  { id: 'en', label: 'English' },
];

const getPosterUrl = (song) => song?.posterUrl || song?.poster_url || 'https://picsum.photos/120/120?random';

export default function MelodifyStudio() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'MelodifyStudio');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { user } = useAuth();

  const [karaokeTracks, setKaraokeTracks] = useState([]);
  const [songQuery, setSongQuery] = useState('');
  const [discoveryRegion, setDiscoveryRegion] = useState('');
  const [discoveryPage, setDiscoveryPage] = useState(1);
  const [discoveryPages, setDiscoveryPages] = useState(1);
  const [discoveryExternalState, setDiscoveryExternalState] = useState('skipped');
  const [discoveryError, setDiscoveryError] = useState('');
  const [searching, setSearching] = useState(false);
  const [selectedSong, setSelectedSong] = useState(null);
  const [step, setStep] = useState(STEPS.SELECT);

  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [recordBlob, setRecordBlob] = useState(null);
  const [recordUrl, setRecordUrl] = useState(null);
  const [micPermission, setMicPermission] = useState('prompt');
  const [recordingError, setRecordingError] = useState('');

  const [effects, setEffects] = useState({ ...EFFECTS_PRESETS.clean });
  const [activePreset, setActivePreset] = useState('clean');
  const [backingVolume, setBackingVolume] = useState(0.9);
  const [vocalGain, setVocalGain] = useState(1);

  const [postTitle, setPostTitle] = useState('');
  const [postCaption, setPostCaption] = useState('');
  const [postVisibility, setPostVisibility] = useState('public');
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');

  const [showLyrics, setShowLyrics] = useState(false);
  const [lyrics, setLyrics] = useState('');

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const gainNodeRef = useRef(null);
  const backingSourceNodeRef = useRef(null);
  const backingSpeakerGainRef = useRef(null);
  const backingRecorderGainRef = useRef(null);
  const convolverRef = useRef(null);
  const delayNodeRef = useRef(null);
  const delayGainRef = useRef(null);
  const bassFilterRef = useRef(null);
  const trebleFilterRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const previewAudioRef = useRef(null);
  const backingAudioRef = useRef(null);
  const mediaDestinationRef = useRef(null);

  useEffect(() => {
    fetchKaraoke();
    return () => {
      cleanupRecording();
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchKaraoke(songQuery.trim(), discoveryRegion, discoveryPage);
    }, 300);
    return () => clearTimeout(timer);
  }, [songQuery, discoveryRegion, discoveryPage]);

  const fetchKaraoke = async (q = '', region = '', page = 1) => {
    setSearching(true);
    setDiscoveryError('');
    try {
      const searchQuery = q ? `&q=${encodeURIComponent(q)}` : '';
      const regionQuery = region ? `&region=${encodeURIComponent(region)}` : '';
      const params = `/api/karaoke/discovery?limit=${DISCOVERY_PAGE_SIZE}&page=${page}${regionQuery}${searchQuery}`;
      const data = await api.get(params);
      if (data.success && data.data) {
        setKaraokeTracks(Array.isArray(data.data.items) ? data.data.items : []);
        setDiscoveryPages(Math.max(1, Number(data.data.pages) || 1));
        setDiscoveryExternalState(data.data.externalState || 'skipped');
        if (data.data.externalState === 'error' && data.data.externalError) {
          setDiscoveryError('External provider is temporarily unavailable.');
        }
      } else {
        setKaraokeTracks([]);
        setDiscoveryPages(1);
        setDiscoveryError('Failed to load karaoke discovery.');
      }
    } catch {
      setKaraokeTracks([]);
      setDiscoveryPages(1);
      setDiscoveryError('Failed to load karaoke discovery.');
    }
    setSearching(false);
  };

  useEffect(() => {
    if (selectedSong && selectedSong.lyrics) {
      const plain = selectedSong.lyrics
        .replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '')
        .split('\n')
        .filter((l) => l.trim())
        .join('\n');
      setLyrics(plain);
    } else {
      setLyrics('');
    }
  }, [selectedSong]);

  const cleanupRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (backingAudioRef.current) {
      backingAudioRef.current.pause();
      backingAudioRef.current.currentTime = 0;
      backingAudioRef.current.src = '';
      backingAudioRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    sourceNodeRef.current = null;
    gainNodeRef.current = null;
    backingSourceNodeRef.current = null;
    backingSpeakerGainRef.current = null;
    backingRecorderGainRef.current = null;
    convolverRef.current = null;
    delayNodeRef.current = null;
    delayGainRef.current = null;
    bassFilterRef.current = null;
    trebleFilterRef.current = null;
    mediaDestinationRef.current = null;
  };

  const loadBackingAudio = (song) => {
    if (!song || song.playbackType !== 'audio' || !song.backingAudioUrl) {
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      const backingAudio = new Audio(song.backingAudioUrl);
      backingAudio.preload = 'auto';
      backingAudio.crossOrigin = 'anonymous';
      const onReady = () => {
        backingAudio.removeEventListener('canplaythrough', onReady);
        backingAudio.removeEventListener('error', onError);
        resolve(backingAudio);
      };
      const onError = () => {
        backingAudio.removeEventListener('canplaythrough', onReady);
        backingAudio.removeEventListener('error', onError);
        reject(new Error('backing track failed to load'));
      };
      backingAudio.addEventListener('canplaythrough', onReady, { once: true });
      backingAudio.addEventListener('error', onError, { once: true });
      backingAudio.load();
    });
  };

  const selectRecorderMimeType = () => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
    for (const candidate of candidates) {
      if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    }
    return '';
  };

  const selectSong = (song) => {
    setSelectedSong(song);
    setPostTitle(`${user?.name || 'My'} - ${song.title}`);
    setStep(STEPS.RECORD);
    setRecordBlob(null);
    setRecordUrl(null);
    setRecordTime(0);
    setPublishMsg('');
    setRecordingError('');
  };

  const startRecording = async () => {
    setRecordingError('');
    try {
      if (!selectedSong) {
        setRecordingError('Please select a karaoke track first.');
        return;
      }
      if (typeof MediaRecorder === 'undefined') {
        setRecordingError('MediaRecorder is not supported in this browser.');
        return;
      }
      if (selectedSong.playbackType !== 'audio') {
        setRecordingError('This track supports sing-along mode only. Select a KARAOKE_READY track to record with backing audio.');
        return;
      }

      const backingAudio = await loadBackingAudio(selectedSong);
      backingAudioRef.current = backingAudio;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      setMicPermission('granted');

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const gainNode = audioCtx.createGain();
      gainNode.gain.value = effects.gain * vocalGain;
      gainNodeRef.current = gainNode;

      const bassFilter = audioCtx.createBiquadFilter();
      bassFilter.type = 'lowshelf';
      bassFilter.frequency.value = 200;
      bassFilter.gain.value = effects.bass * 30;
      bassFilterRef.current = bassFilter;

      const trebleFilter = audioCtx.createBiquadFilter();
      trebleFilter.type = 'highshelf';
      trebleFilter.frequency.value = 3000;
      trebleFilter.gain.value = effects.treble * 30;
      trebleFilterRef.current = trebleFilter;

      const convolver = audioCtx.createConvolver();
      const reverbLength = audioCtx.sampleRate * 2;
      const reverbBuffer = audioCtx.createBuffer(2, reverbLength, audioCtx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const data = reverbBuffer.getChannelData(ch);
        for (let i = 0; i < reverbLength; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / reverbLength, 2);
        }
      }
      convolver.buffer = reverbBuffer;
      convolverRef.current = convolver;

      const reverbGain = audioCtx.createGain();
      reverbGain.gain.value = effects.reverb;

      const dryGain = audioCtx.createGain();
      dryGain.gain.value = 1 - effects.reverb * 0.5;

      const delayNode = audioCtx.createDelay(1);
      delayNode.delayTime.value = 0.3;
      delayNodeRef.current = delayNode;

      const delayGain = audioCtx.createGain();
      delayGain.gain.value = effects.echo;
      delayGainRef.current = delayGain;

      const backingSpeakerGain = audioCtx.createGain();
      backingSpeakerGain.gain.value = backingVolume;
      backingSpeakerGainRef.current = backingSpeakerGain;

      const backingRecorderGain = audioCtx.createGain();
      backingRecorderGain.gain.value = backingVolume;
      backingRecorderGainRef.current = backingRecorderGain;

      source.connect(bassFilter);
      bassFilter.connect(trebleFilter);
      trebleFilter.connect(gainNode);

      gainNode.connect(dryGain);
      gainNode.connect(convolver);
      convolver.connect(reverbGain);

      const merger = audioCtx.createGain();
      dryGain.connect(merger);
      reverbGain.connect(merger);

      gainNode.connect(delayNode);
      delayNode.connect(delayGain);
      delayGain.connect(merger);

      const dest = audioCtx.createMediaStreamDestination();
      merger.connect(dest);
      mediaDestinationRef.current = dest;

      if (backingAudioRef.current) {
        const backingSourceNode = audioCtx.createMediaElementSource(backingAudioRef.current);
        backingSourceNodeRef.current = backingSourceNode;
        backingSourceNode.connect(backingSpeakerGain);
        backingSourceNode.connect(backingRecorderGain);
        backingSpeakerGain.connect(audioCtx.destination);
        backingRecorderGain.connect(dest);
      }

      const mimeType = selectRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(dest.stream, { mimeType })
        : new MediaRecorder(dest.stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        setRecordBlob(blob);
        setRecordUrl(URL.createObjectURL(blob));
        setStep(STEPS.PREVIEW);
        setIsRecording(false);
        cleanupRecording();
      };

      if (backingAudioRef.current) {
        backingAudioRef.current.currentTime = 0;
        backingAudioRef.current.onended = () => {
          stopRecording();
        };
        await backingAudioRef.current.play();
      }

      recorder.start(100);
      setIsRecording(true);
      setRecordTime(0);
      timerRef.current = setInterval(() => setRecordTime((t) => t + 1), 1000);
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        setMicPermission('denied');
        setRecordingError('Microphone permission denied. Please allow microphone access in your browser settings.');
      } else if (err.name === 'NotFoundError') {
        setRecordingError('No microphone found. Please connect a microphone and try again.');
      } else if (err.message === 'backing track failed to load') {
        setRecordingError('Backing track failed to load. Try another track.');
      } else {
        setRecordingError('Could not start recording: ' + err.message);
      }
      cleanupRecording();
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (backingAudioRef.current) {
      backingAudioRef.current.pause();
      backingAudioRef.current.currentTime = 0;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const applyPreset = (key) => {
    setEffects({ ...EFFECTS_PRESETS[key] });
    setActivePreset(key);
    if (gainNodeRef.current) gainNodeRef.current.gain.value = EFFECTS_PRESETS[key].gain * vocalGain;
    if (bassFilterRef.current) bassFilterRef.current.gain.value = EFFECTS_PRESETS[key].bass * 30;
    if (trebleFilterRef.current) trebleFilterRef.current.gain.value = EFFECTS_PRESETS[key].treble * 30;
    if (convolverRef.current && convolverRef.current.context) {
      const nodes = convolverRef.current.context.state;
    }
    if (delayGainRef.current) delayGainRef.current.gain.value = EFFECTS_PRESETS[key].echo;
  };

  const updateEffect = (key, value) => {
    const val = parseFloat(value);
    setEffects((prev) => ({ ...prev, [key]: val }));
    setActivePreset('');
    if (key === 'gain' && gainNodeRef.current) gainNodeRef.current.gain.value = val * vocalGain;
    if (key === 'bass' && bassFilterRef.current) bassFilterRef.current.gain.value = val * 30;
    if (key === 'treble' && trebleFilterRef.current) trebleFilterRef.current.gain.value = val * 30;
    if (key === 'echo' && delayGainRef.current) delayGainRef.current.gain.value = val;
  };

  const updateBackingVolume = (value) => {
    const next = parseFloat(value);
    setBackingVolume(next);
    if (backingSpeakerGainRef.current) backingSpeakerGainRef.current.gain.value = next;
    if (backingRecorderGainRef.current) backingRecorderGainRef.current.gain.value = next;
  };

  const updateVocalGain = (value) => {
    const next = parseFloat(value);
    setVocalGain(next);
    if (gainNodeRef.current) gainNodeRef.current.gain.value = effects.gain * next;
  };

  const retryRecording = () => {
    setRecordBlob(null);
    setRecordUrl(null);
    setRecordTime(0);
    setStep(STEPS.RECORD);
    setRecordingError('');
  };

  const publishPerformance = async () => {
    if (!recordBlob || !selectedSong || publishing) return;
    setPublishing(true);
    setPublishMsg('');

    try {
      const formData = new FormData();
      formData.append('audio', recordBlob, 'recording.webm');
      formData.append('karaokeId', selectedSong._id);
      formData.append('title', postTitle || `${user?.name} - ${selectedSong.title}`);
      formData.append('caption', postCaption);
      formData.append('duration', String(recordTime));
      formData.append('effects', JSON.stringify({ ...effects, preset: activePreset }));
      formData.append('visibility', postVisibility);

      const token = localStorage.getItem('melodify_token');
      const res = await fetch('/api/recordings', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      const result = await res.json();

      if (result.success) {
        setPublishMsg('Recording saved successfully!');
        setStep(STEPS.SELECT);
        setSelectedSong(null);
        setRecordBlob(null);
        setRecordUrl(null);
        setPostTitle('');
        setPostCaption('');
      } else {
        setPublishMsg('Failed to save recording: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      setPublishMsg('Save failed: ' + err.message);
    }
    setPublishing(false);
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="studio-page">
      <header className="studio-header">
        <Link to="/dashboard" className="studio-back" aria-label="Back to Dashboard">
          <i className="fa-solid fa-chevron-left"></i>
          <span>Dashboard</span>
        </Link>
        <div className="studio-logo">
          MELOD<span>IFY</span> STUDIO
        </div>
      </header>

      <main className="studio-content">
        {step === STEPS.SELECT && (
          <>
            <div className="studio-hero">
              <div className="studio-hero-icon">
                <i className="fa-solid fa-microphone-lines"></i>
              </div>
              <h1>Melodify Studio</h1>
              <p>Choose a song to start your karaoke performance</p>
            </div>

            <div className="studio-song-select">
              <div className="studio-search-bar">
                <i className="fa-solid fa-magnifying-glass"></i>
                <input
                  type="text"
                  placeholder="Search karaoke tracks by title or artist..."
                  value={songQuery}
                  onChange={(e) => {
                    setSongQuery(e.target.value);
                    setDiscoveryPage(1);
                  }}
                />
              </div>

              <div className="studio-region-filters" role="tablist" aria-label="Discovery region filters">
                {DISCOVERY_REGION_OPTIONS.map((regionOption) => (
                  <button
                    key={regionOption.id || 'all'}
                    type="button"
                    className={`studio-region-chip${discoveryRegion === regionOption.id ? ' active' : ''}`}
                    aria-pressed={discoveryRegion === regionOption.id}
                    onClick={() => {
                      setDiscoveryRegion(regionOption.id);
                      setDiscoveryPage(1);
                    }}
                  >
                    {regionOption.label}
                  </button>
                ))}
              </div>

              {discoveryError && <div className="studio-discovery-status error">{discoveryError}</div>}
              {!discoveryError && discoveryExternalState === 'disabled' && (
                <div className="studio-discovery-status">External provider is unavailable right now.</div>
              )}

              {searching ? (
                <div className="studio-empty-small">
                  <i className="fa-solid fa-spinner fa-spin" style={{ fontSize: 18, marginBottom: 8 }}></i>
                  <p>Searching karaoke tracks...</p>
                </div>
              ) : karaokeTracks.length === 0 ? (
                <div className="studio-empty-small">
                  <i className="fa-solid fa-music" style={{ fontSize: 28, marginBottom: 8, color: 'rgba(255,255,255,0.15)' }}></i>
                  {songQuery.trim() ? (
                    <p>No karaoke track found for "{songQuery}"</p>
                  ) : (
                    <p>No karaoke tracks available yet. Ask an admin to upload some.</p>
                  )}
                </div>
              ) : (
                <div className="studio-song-grid">
                  {karaokeTracks.map((song) => (
                    <div
                      key={song.id || song._id}
                      className="studio-song-card"
                      onClick={() => selectSong(song)}
                    >
                      <div className="studio-song-poster">
                        <img
                          src={getPosterUrl(song)}
                          alt={song.title}
                          onError={(e) => { e.target.src = 'https://picsum.photos/120/120?random'; }}
                        />
                        <div className="studio-song-overlay">
                          <i className="fa-solid fa-microphone-lines"></i>
                        </div>
                        <span className={`studio-track-badge ${song.classification === 'KARAOKE_READY' ? 'ready' : 'singalong'}`}>
                          {song.classification === 'KARAOKE_READY' ? 'KARAOKE_READY' : 'SING_ALONG'}
                        </span>
                      </div>
                      <div className="studio-song-info">
                        <span className="studio-song-title">{song.title}</span>
                        <span className="studio-song-artist">{song.artist}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {discoveryPages > 1 && (
                <div className="studio-pagination">
                  <button
                    type="button"
                    className="studio-page-btn"
                    onClick={() => setDiscoveryPage((prev) => Math.max(1, prev - 1))}
                    disabled={discoveryPage <= 1 || searching}
                  >
                    Previous
                  </button>
                  <span className="studio-page-indicator">Page {discoveryPage} of {discoveryPages}</span>
                  <button
                    type="button"
                    className="studio-page-btn"
                    onClick={() => setDiscoveryPage((prev) => Math.min(discoveryPages, prev + 1))}
                    disabled={discoveryPage >= discoveryPages || searching}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {step === STEPS.RECORD && selectedSong && (
          <div className="studio-recording">
            <div className="studio-now-playing">
              <img
                className="studio-np-poster"
                src={getPosterUrl(selectedSong)}
                alt=""
                onError={(e) => { e.target.src = 'https://picsum.photos/80/80?random'; }}
              />
              <div className="studio-np-info">
                <span className="studio-np-title">{selectedSong.title}</span>
                <span className="studio-np-artist">{selectedSong.artist}</span>
              </div>
              <button className="studio-change-btn" onClick={() => { setStep(STEPS.SELECT); setSelectedSong(null); }}>
                Change
              </button>
            </div>

            {lyrics && (
              <div className="studio-lyrics-box">
                <div className="studio-lyrics-scroll">
                  {lyrics.split('\n').map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </div>
            )}

            <div className="studio-effects">
              <h3>Audio Effects</h3>
              <div className="studio-presets">
                {Object.entries(EFFECTS_PRESETS).map(([key, preset]) => (
                  <button
                    key={key}
                    className={`studio-preset ${activePreset === key ? 'active' : ''}`}
                    onClick={() => applyPreset(key)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="studio-sliders">
                <div className="studio-slider-row">
                  <label>Gain</label>
                  <input type="range" min="0" max="1.5" step="0.05" value={effects.gain} onChange={(e) => updateEffect('gain', e.target.value)} />
                  <span>{Math.round(effects.gain * 100)}%</span>
                </div>
                <div className="studio-slider-row">
                  <label>Backing</label>
                  <input type="range" min="0" max="1.5" step="0.05" value={backingVolume} onChange={(e) => updateBackingVolume(e.target.value)} />
                  <span>{Math.round(backingVolume * 100)}%</span>
                </div>
                <div className="studio-slider-row">
                  <label>Vocal</label>
                  <input type="range" min="0" max="2" step="0.05" value={vocalGain} onChange={(e) => updateVocalGain(e.target.value)} />
                  <span>{Math.round(vocalGain * 100)}%</span>
                </div>
                <div className="studio-slider-row">
                  <label>Reverb</label>
                  <input type="range" min="0" max="1" step="0.05" value={effects.reverb} onChange={(e) => updateEffect('reverb', e.target.value)} />
                  <span>{Math.round(effects.reverb * 100)}%</span>
                </div>
                <div className="studio-slider-row">
                  <label>Echo</label>
                  <input type="range" min="0" max="1" step="0.05" value={effects.echo} onChange={(e) => updateEffect('echo', e.target.value)} />
                  <span>{Math.round(effects.echo * 100)}%</span>
                </div>
                <div className="studio-slider-row">
                  <label>Bass</label>
                  <input type="range" min="-1" max="1" step="0.05" value={effects.bass} onChange={(e) => updateEffect('bass', e.target.value)} />
                  <span>{effects.bass > 0 ? '+' : ''}{Math.round(effects.bass * 100)}%</span>
                </div>
                <div className="studio-slider-row">
                  <label>Treble</label>
                  <input type="range" min="-1" max="1" step="0.05" value={effects.treble} onChange={(e) => updateEffect('treble', e.target.value)} />
                  <span>{effects.treble > 0 ? '+' : ''}{Math.round(effects.treble * 100)}%</span>
                </div>
              </div>
            </div>

            <div className="studio-record-area">
              {recordingError && <div className="studio-error">{recordingError}</div>}

              <div className={`studio-record-timer ${isRecording ? 'recording' : ''}`}>
                <div className="studio-record-dot"></div>
                <span>{formatTime(recordTime)}</span>
              </div>

              <div className="studio-record-controls">
                {!isRecording ? (
                  <button className="studio-record-btn" onClick={startRecording}>
                    <i className="fa-solid fa-circle" style={{ color: '#ff4444' }}></i>
                    Start Recording
                  </button>
                ) : (
                  <button className="studio-stop-btn" onClick={stopRecording}>
                    <i className="fa-solid fa-stop"></i>
                    Stop Recording
                  </button>
                )}
              </div>

              <p className="studio-headphone-hint">
                For best results, use headphones to avoid microphone feedback.
              </p>

              <button className="studio-back-link" onClick={() => { setStep(STEPS.SELECT); setSelectedSong(null); }}>
                Back to song selection
              </button>
            </div>
          </div>
        )}

        {step === STEPS.PREVIEW && recordUrl && (
          <div className="studio-preview">
            <h2>Preview Recording</h2>

            <div className="studio-preview-song">
              <img
                src={getPosterUrl(selectedSong)}
                alt=""
                onError={(e) => { e.target.src = 'https://picsum.photos/60/60?random'; }}
              />
              <div>
                <span className="studio-preview-title">{selectedSong?.title}</span>
                <span className="studio-preview-artist">{selectedSong?.artist}</span>
              </div>
            </div>

            <audio
              ref={previewAudioRef}
              controls
              src={recordUrl}
              className="studio-preview-audio"
            ></audio>

            <div className="studio-preview-meta">
              <span>Duration: {formatTime(recordTime)}</span>
            </div>

            <div className="studio-preview-actions">
              <button className="studio-retry-btn" onClick={retryRecording}>
                <i className="fa-solid fa-rotate-right"></i>
                Re-record
              </button>
              <button className="studio-next-btn" onClick={() => setStep(STEPS.PUBLISH)}>
                Next
                <i className="fa-solid fa-arrow-right"></i>
              </button>
            </div>
          </div>
        )}

        {step === STEPS.PUBLISH && (
          <div className="studio-publish">
            <h2>Publish Performance</h2>

            <div className="studio-publish-song">
              <img
                src={getPosterUrl(selectedSong)}
                alt=""
                onError={(e) => { e.target.src = 'https://picsum.photos/60/60?random'; }}
              />
              <div>
                <span className="studio-publish-song-title">{selectedSong?.title}</span>
                <span className="studio-publish-song-artist">{selectedSong?.artist}</span>
              </div>
            </div>

            <div className="studio-publish-form">
              <div className="studio-form-group">
                <label>Title</label>
                <input
                  type="text"
                  value={postTitle}
                  onChange={(e) => setPostTitle(e.target.value)}
                  placeholder="Performance title"
                />
              </div>
              <div className="studio-form-group">
                <label>Caption (optional)</label>
                <textarea
                  rows="3"
                  maxLength="1000"
                  value={postCaption}
                  onChange={(e) => setPostCaption(e.target.value)}
                  placeholder="Tell others about your performance..."
                ></textarea>
              </div>
              <div className="studio-form-group">
                <label>Visibility</label>
                <select value={postVisibility} onChange={(e) => setPostVisibility(e.target.value)}>
                  <option value="public">Public - Anyone can see</option>
                  <option value="private">Private - Only you</option>
                </select>
              </div>
            </div>

            {publishMsg && (
              <div className={`studio-publish-msg ${publishMsg.includes('successfully') ? 'success' : 'error'}`}>
                {publishMsg}
                {publishMsg.includes('successfully') && (
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    <Link to="/profile" style={{ color: '#00b4d8' }}>View in Profile</Link>
                  </div>
                )}
              </div>
            )}

            <div className="studio-publish-actions">
              <button className="studio-cancel-btn" onClick={() => setStep(STEPS.PREVIEW)}>
                Back
              </button>
              <button
                className="studio-publish-btn"
                onClick={publishPerformance}
                disabled={publishing || !postTitle.trim()}
              >
                {publishing ? 'Publishing...' : 'Publish'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
