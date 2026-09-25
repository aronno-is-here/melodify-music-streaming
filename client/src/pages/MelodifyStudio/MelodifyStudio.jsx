import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import cssRaw from './MelodifyStudio.css?raw';

const DEFAULT_POSTER = 'https://picsum.photos/160/160?random';

const EFFECTS_PRESETS = Object.freeze({
  clean: { gain: 1, reverb: 0, echo: 0, bass: 0, treble: 0, label: 'Clean' },
  studio: { gain: 0.85, reverb: 0.15, echo: 0, bass: 0.1, treble: 0.1, label: 'Studio' },
  warm: { gain: 0.9, reverb: 0.1, echo: 0.05, bass: 0.2, treble: -0.1, label: 'Warm' },
  echo: { gain: 0.8, reverb: 0, echo: 0.3, bass: 0, treble: 0, label: 'Echo' },
  hall: { gain: 0.75, reverb: 0.4, echo: 0.1, bass: 0.05, treble: 0.05, label: 'Hall' },
});

const STEPS = Object.freeze({
  SELECT: 'select',
  RECORD: 'record',
  PREVIEW: 'preview',
  PUBLISH: 'publish',
});

const STEP_ITEMS = Object.freeze([
  { key: STEPS.SELECT, label: 'Choose Song' },
  { key: STEPS.RECORD, label: 'Record' },
  { key: STEPS.PREVIEW, label: 'Preview' },
  { key: STEPS.PUBLISH, label: 'Publish' },
]);

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

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
  const [searching, setSearching] = useState(false);
  const [selectedSong, setSelectedSong] = useState(null);
  const [step, setStep] = useState(STEPS.SELECT);

  const [isRecording, setIsRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [recordBlob, setRecordBlob] = useState(null);
  const [recordUrl, setRecordUrl] = useState('');
  const [micPermission, setMicPermission] = useState('prompt');
  const [recordingError, setRecordingError] = useState('');

  const [effects, setEffects] = useState({ ...EFFECTS_PRESETS.clean });
  const [activePreset, setActivePreset] = useState('clean');

  const [postTitle, setPostTitle] = useState('');
  const [postCaption, setPostCaption] = useState('');
  const [postVisibility, setPostVisibility] = useState('public');
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState('');

  const [lyrics, setLyrics] = useState('');

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const gainNodeRef = useRef(null);
  const convolverRef = useRef(null);
  const delayNodeRef = useRef(null);
  const delayGainRef = useRef(null);
  const bassFilterRef = useRef(null);
  const trebleFilterRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const previewAudioRef = useRef(null);

  const cleanupRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    sourceNodeRef.current = null;
    gainNodeRef.current = null;
    convolverRef.current = null;
    delayNodeRef.current = null;
    delayGainRef.current = null;
    bassFilterRef.current = null;
    trebleFilterRef.current = null;
  }, []);

  const fetchKaraoke = useCallback(async (query = '') => {
    setSearching(true);
    const params = query
      ? `/api/karaoke?q=${encodeURIComponent(query)}&limit=50`
      : '/api/karaoke?limit=50';

    const data = await api.get(params);
    if (data.success) {
      setKaraokeTracks(data.karaoke || []);
    }
    setSearching(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      if (cancelled) return;
      await fetchKaraoke(songQuery.trim());
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [fetchKaraoke, songQuery]);

  useEffect(() => {
    return () => {
      cleanupRecording();
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
      }
      if (recordUrl) {
        URL.revokeObjectURL(recordUrl);
      }
    };
  }, [cleanupRecording, recordUrl]);

  useEffect(() => {
    if (!selectedSong || !selectedSong.lyrics) {
      setLyrics('');
      return;
    }

    const plain = selectedSong.lyrics
      .replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n');
    setLyrics(plain);
  }, [selectedSong]);

  const selectSong = (song) => {
    setSelectedSong(song);
    setPostTitle(`${user?.name || 'My'} - ${song.title}`);
    setStep(STEPS.RECORD);
    setRecordBlob(null);
    setRecordTime(0);
    setPublishMsg('');
    setRecordingError('');
    if (recordUrl) {
      URL.revokeObjectURL(recordUrl);
      setRecordUrl('');
    }
  };

  const startRecording = async () => {
    setRecordingError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      streamRef.current = stream;
      setMicPermission('granted');

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;

      const gainNode = audioCtx.createGain();
      gainNode.gain.value = effects.gain;
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
      for (let channel = 0; channel < 2; channel += 1) {
        const channelData = reverbBuffer.getChannelData(channel);
        for (let i = 0; i < reverbLength; i += 1) {
          channelData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / reverbLength, 2);
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

      merger.connect(audioCtx.destination);

      const destination = audioCtx.createMediaStreamDestination();
      merger.connect(destination);

      const recorder = new MediaRecorder(destination.stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setRecordBlob(blob);
        if (recordUrl) {
          URL.revokeObjectURL(recordUrl);
        }
        setRecordUrl(URL.createObjectURL(blob));
        setStep(STEPS.PREVIEW);
        cleanupRecording();
      };

      recorder.start(100);
      setIsRecording(true);
      setRecordTime(0);
      timerRef.current = setInterval(() => {
        setRecordTime((time) => time + 1);
      }, 1000);
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        setMicPermission('denied');
        setRecordingError('Microphone permission denied. Please allow microphone access in your browser settings.');
      } else if (error.name === 'NotFoundError') {
        setRecordingError('No microphone found. Please connect a microphone and try again.');
      } else {
        setRecordingError(`Could not start recording: ${error.message}`);
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const applyPreset = (presetKey) => {
    const next = EFFECTS_PRESETS[presetKey];
    setEffects({ ...next });
    setActivePreset(presetKey);
    if (gainNodeRef.current) gainNodeRef.current.gain.value = next.gain;
    if (bassFilterRef.current) bassFilterRef.current.gain.value = next.bass * 30;
    if (trebleFilterRef.current) trebleFilterRef.current.gain.value = next.treble * 30;
    if (delayGainRef.current) delayGainRef.current.gain.value = next.echo;
  };

  const updateEffect = (effectKey, value) => {
    const numeric = parseFloat(value);
    setEffects((prev) => ({ ...prev, [effectKey]: numeric }));
    setActivePreset('');

    if (effectKey === 'gain' && gainNodeRef.current) gainNodeRef.current.gain.value = numeric;
    if (effectKey === 'bass' && bassFilterRef.current) bassFilterRef.current.gain.value = numeric * 30;
    if (effectKey === 'treble' && trebleFilterRef.current) trebleFilterRef.current.gain.value = numeric * 30;
    if (effectKey === 'echo' && delayGainRef.current) delayGainRef.current.gain.value = numeric;
  };

  const retryRecording = () => {
    setRecordBlob(null);
    if (recordUrl) {
      URL.revokeObjectURL(recordUrl);
      setRecordUrl('');
    }
    setRecordTime(0);
    setStep(STEPS.RECORD);
    setRecordingError('');
  };

  const publishPerformance = async () => {
    if (!recordBlob || !selectedSong || publishing) return;

    setPublishing(true);
    setPublishMsg('');

    const formData = new FormData();
    formData.append('audio', recordBlob, 'recording.webm');
    formData.append('karaokeId', selectedSong._id);
    formData.append('title', postTitle || `${user?.name || 'My'} - ${selectedSong.title}`);
    formData.append('caption', postCaption);
    formData.append('duration', String(recordTime));
    formData.append('effects', JSON.stringify({ ...effects, preset: activePreset || null }));
    formData.append('visibility', postVisibility);

    const result = await api.post('/api/recordings', formData);
    setPublishing(false);

    if (!result.success) {
      setPublishMsg(`Failed to save recording: ${result.error || 'Unknown error'}`);
      return;
    }

    setPublishMsg('Recording saved successfully!');
    setStep(STEPS.SELECT);
    setSelectedSong(null);
    setRecordBlob(null);
    if (recordUrl) {
      URL.revokeObjectURL(recordUrl);
      setRecordUrl('');
    }
    setPostTitle('');
    setPostCaption('');
  };

  return (
    <div className="studio-page">
      <section className="music-section app-surface studio-step-shell" aria-label="Studio workflow steps">
        <SectionHeader
          title="Melodify Studio"
          subtitle="Record and publish your karaoke performance"
          action={<Link to="/feed" className="music-outline-btn studio-shell-link">Open Feed</Link>}
        />
        <ol className="studio-stepper">
          {STEP_ITEMS.map((item) => (
            <li
              key={item.key}
              className={`studio-step ${step === item.key ? 'is-active' : ''}`}
              aria-current={step === item.key ? 'step' : undefined}
            >
              {item.label}
            </li>
          ))}
        </ol>
      </section>

      {step === STEPS.SELECT ? (
        <section className="music-section app-surface studio-panel">
          <SectionHeader title="Choose a karaoke track" subtitle="Search by title or artist to begin recording" />

          <label htmlFor="studio-song-query" className="studio-field-label">Search tracks</label>
          <div className="studio-search-row">
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true"></i>
            <input
              id="studio-song-query"
              type="text"
              value={songQuery}
              onChange={(event) => setSongQuery(event.target.value)}
              placeholder="Search karaoke tracks"
            />
          </div>

          {searching ? <p className="studio-status" role="status">Searching karaoke tracks...</p> : null}

          {!searching && karaokeTracks.length === 0 ? (
            <EmptyState
              icon="fa-music"
              title={songQuery.trim() ? 'No karaoke tracks found' : 'No karaoke tracks available'}
              detail={songQuery.trim() ? `No results for "${songQuery}".` : 'Ask an admin to upload karaoke tracks first.'}
            />
          ) : null}

          {karaokeTracks.length > 0 ? (
            <div className="studio-song-grid" aria-label="Karaoke tracks">
              {karaokeTracks.map((song) => (
                <article key={song._id} className="studio-song-card">
                  <img
                    src={song.poster_url || DEFAULT_POSTER}
                    alt={`${song.title} artwork`}
                    onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
                  />
                  <div className="studio-song-info">
                    <h3>{song.title}</h3>
                    <p>{song.artist}</p>
                  </div>
                  <button type="button" className="music-pill-btn" onClick={() => selectSong(song)}>
                    Record this song
                  </button>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {step === STEPS.RECORD && selectedSong ? (
        <section className="music-section app-surface studio-panel">
          <SectionHeader
            title="Recording session"
            subtitle={micPermission === 'denied' ? 'Microphone access is currently blocked.' : 'Set your sound and start recording.'}
            action={(
              <button
                type="button"
                className="music-outline-btn"
                onClick={() => {
                  setStep(STEPS.SELECT);
                  setSelectedSong(null);
                }}
              >
                Change song
              </button>
            )}
          />

          <div className="studio-now-playing">
            <img
              src={selectedSong.poster_url || DEFAULT_POSTER}
              alt=""
              onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
            />
            <div>
              <strong>{selectedSong.title}</strong>
              <p>{selectedSong.artist}</p>
            </div>
          </div>

          {lyrics ? (
            <div className="studio-lyrics-box">
              {lyrics.split('\n').map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))}
            </div>
          ) : null}

          <div className="studio-effects">
            <h3>Audio preset</h3>
            <div className="studio-presets" role="group" aria-label="Choose audio preset">
              {Object.entries(EFFECTS_PRESETS).map(([key, preset]) => (
                <button
                  type="button"
                  key={key}
                  className={`studio-preset ${activePreset === key ? 'is-active' : ''}`}
                  onClick={() => applyPreset(key)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="studio-slider-grid">
              <label htmlFor="studio-gain">Gain</label>
              <input id="studio-gain" type="range" min="0" max="1.5" step="0.05" value={effects.gain} onChange={(event) => updateEffect('gain', event.target.value)} />
              <span>{Math.round(effects.gain * 100)}%</span>

              <label htmlFor="studio-reverb">Reverb</label>
              <input id="studio-reverb" type="range" min="0" max="1" step="0.05" value={effects.reverb} onChange={(event) => updateEffect('reverb', event.target.value)} />
              <span>{Math.round(effects.reverb * 100)}%</span>

              <label htmlFor="studio-echo">Echo</label>
              <input id="studio-echo" type="range" min="0" max="1" step="0.05" value={effects.echo} onChange={(event) => updateEffect('echo', event.target.value)} />
              <span>{Math.round(effects.echo * 100)}%</span>

              <label htmlFor="studio-bass">Bass</label>
              <input id="studio-bass" type="range" min="-1" max="1" step="0.05" value={effects.bass} onChange={(event) => updateEffect('bass', event.target.value)} />
              <span>{effects.bass > 0 ? '+' : ''}{Math.round(effects.bass * 100)}%</span>

              <label htmlFor="studio-treble">Treble</label>
              <input id="studio-treble" type="range" min="-1" max="1" step="0.05" value={effects.treble} onChange={(event) => updateEffect('treble', event.target.value)} />
              <span>{effects.treble > 0 ? '+' : ''}{Math.round(effects.treble * 100)}%</span>
            </div>
          </div>

          {recordingError ? <p className="studio-error" role="alert">{recordingError}</p> : null}

          <div className={`studio-timer ${isRecording ? 'is-live' : ''}`} aria-live="polite" role="status">
            <span className="studio-dot" aria-hidden="true"></span>
            <strong>{formatTime(recordTime)}</strong>
          </div>

          <div className="studio-record-actions">
            {!isRecording ? (
              <button type="button" className="music-pill-btn studio-record-btn" onClick={startRecording}>
                Start recording
              </button>
            ) : (
              <button type="button" className="music-outline-btn studio-stop-btn" onClick={stopRecording}>
                Stop recording
              </button>
            )}
          </div>
        </section>
      ) : null}

      {step === STEPS.PREVIEW && recordUrl ? (
        <section className="music-section app-surface studio-panel">
          <SectionHeader title="Preview your take" subtitle="Listen to your recording before publishing" />

          <audio ref={previewAudioRef} controls src={recordUrl} className="studio-preview-audio"></audio>
          <p className="studio-status">Recorded duration: {formatTime(recordTime)}</p>

          <div className="studio-inline-actions">
            <button type="button" className="music-outline-btn" onClick={retryRecording}>Re-record</button>
            <button type="button" className="music-pill-btn" onClick={() => setStep(STEPS.PUBLISH)}>Continue</button>
          </div>
        </section>
      ) : null}

      {step === STEPS.PUBLISH && selectedSong ? (
        <section className="music-section app-surface studio-panel">
          <SectionHeader title="Publish performance" subtitle="Set details and visibility for your recording" />

          <form className="studio-publish-form" onSubmit={(event) => {
            event.preventDefault();
            publishPerformance();
          }}>
            <label htmlFor="studio-post-title">Title</label>
            <input
              id="studio-post-title"
              type="text"
              value={postTitle}
              onChange={(event) => setPostTitle(event.target.value)}
              placeholder="Performance title"
              required
            />

            <label htmlFor="studio-post-caption">Caption (optional)</label>
            <textarea
              id="studio-post-caption"
              rows={3}
              maxLength={1000}
              value={postCaption}
              onChange={(event) => setPostCaption(event.target.value)}
              placeholder="Tell listeners about your performance"
            ></textarea>

            <label htmlFor="studio-post-visibility">Visibility</label>
            <select
              id="studio-post-visibility"
              value={postVisibility}
              onChange={(event) => setPostVisibility(event.target.value)}
            >
              <option value="public">Public - anyone can see this post</option>
              <option value="private">Private - only you can see this post</option>
            </select>

            {publishMsg ? (
              <p className={`studio-publish-message ${publishMsg.includes('successfully') ? 'is-success' : 'is-error'}`} role="status" aria-live="polite">
                {publishMsg}
                {publishMsg.includes('successfully') ? (
                  <span>
                    <Link to="/profile">Open your profile</Link>
                  </span>
                ) : null}
              </p>
            ) : null}

            <div className="studio-inline-actions">
              <button type="button" className="music-outline-btn" onClick={() => setStep(STEPS.PREVIEW)}>Back</button>
              <button type="submit" className="music-pill-btn" disabled={publishing || !postTitle.trim()}>
                {publishing ? 'Publishing...' : 'Publish recording'}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
