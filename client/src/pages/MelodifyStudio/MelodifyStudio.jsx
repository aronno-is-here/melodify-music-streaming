import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../api/client.js';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import cssRaw from './MelodifyStudio.css?raw';
import { BACKING_MODES, normalizeStudioTrack } from './studioBacking.js';

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

const DISCOVERY_PAGE_SIZE = 12;
const DISCOVERY_REGION_OPTIONS = [
  { id: '', label: 'All' },
  { id: 'bn-bd', label: 'Bangla' },
  { id: 'bn-in', label: 'Kolkata Bengali' },
  { id: 'hi-in', label: 'Hindi' },
  { id: 'en', label: 'English' },
];

const getPosterUrl = (song) => song?.posterUrl || song?.poster_url || 'https://picsum.photos/120/120?random';
const YOUTUBE_API_URL = 'https://www.youtube.com/iframe_api';
let youtubeApiPromise = null;

const loadYoutubeApi = () => {
  if (typeof window === 'undefined') return Promise.reject(new Error('youtube api unavailable'));
  if (window.YT && typeof window.YT.Player === 'function') {
    return Promise.resolve(window.YT);
  }
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-melodify-youtube-api="1"]');
    const script = existing || document.createElement('script');
    if (!existing) {
      script.src = YOUTUBE_API_URL;
      script.async = true;
      script.setAttribute('data-melodify-youtube-api', '1');
      script.onerror = () => reject(new Error('youtube api failed to load'));
      document.head.appendChild(script);
    }
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };
  });

  return youtubeApiPromise;
};

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
  const [recordUrl, setRecordUrl] = useState('');
  const [recordingMeta, setRecordingMeta] = useState(null);
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
  const [uploadState, setUploadState] = useState('idle');
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadStatusText, setUploadStatusText] = useState('');

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
  const recordTimeRef = useRef(0);
  const previewAudioRef = useRef(null);
  const backingAudioRef = useRef(null);
  const mediaDestinationRef = useRef(null);
  const youtubePlayerRef = useRef(null);
  const activeRecordingMetaRef = useRef(null);
  const previewSyncReadyRef = useRef(false);

  const stopYoutubeBacking = () => {
    if (!youtubePlayerRef.current) return;
    try {
      youtubePlayerRef.current.pauseVideo();
      youtubePlayerRef.current.seekTo(0, true);
    } catch {}
  };

  const stopBackingPlayback = useCallback(() => {
    if (backingAudioRef.current) {
      backingAudioRef.current.pause();
      backingAudioRef.current.currentTime = 0;
      backingAudioRef.current.onended = null;
      backingAudioRef.current.removeAttribute('src');
      backingAudioRef.current.load();
      backingAudioRef.current = null;
    }
    stopYoutubeBacking();
  }, []);

  const cleanupRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    stopBackingPlayback();

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
    activeRecordingMetaRef.current = null;
    previewSyncReadyRef.current = false;
    recordTimeRef.current = 0;
  }, [stopBackingPlayback]);

  const fetchKaraoke = useCallback(async (query = '', region = '', page = 1) => {
    setSearching(true);
    setDiscoveryError('');
    try {
      const searchQuery = query ? `&q=${encodeURIComponent(query)}` : '';
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      if (cancelled) return;
      await fetchKaraoke(songQuery.trim(), discoveryRegion, discoveryPage);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [discoveryPage, discoveryRegion, fetchKaraoke, songQuery]);

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
    if (step === STEPS.SELECT) {
      stopBackingPlayback();
    }
  }, [step, stopBackingPlayback]);

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

  useEffect(() => {
    loadYoutubeApi().catch(() => {});
    return undefined;
  }, []);

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

  const ensureYoutubePlayer = async (videoId) => {
    const trackId = typeof videoId === 'string' ? videoId.trim() : '';
    if (!trackId) throw new Error('youtube track id is required');
    const YT = await loadYoutubeApi();

    if (!youtubePlayerRef.current) {
      await new Promise((resolve) => {
        youtubePlayerRef.current = new YT.Player('studio-youtube-player', {
          width: '0',
          height: '0',
          videoId: trackId,
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
          },
          events: {
            onReady: () => resolve(),
          },
        });
      });
    } else {
      youtubePlayerRef.current.cueVideoById(trackId);
    }

    return youtubePlayerRef.current;
  };

  const startBackingPlayback = (song) => {
    const track = normalizeStudioTrack(song);
    stopBackingPlayback();

    if (!track) return BACKING_MODES.NONE;

    if (track.playbackType === BACKING_MODES.AUDIO) {
      const backingAudio = new Audio(track.backingAudioUrl);
      backingAudio.preload = 'auto';
      backingAudio.crossOrigin = 'anonymous';
      backingAudio.volume = backingVolume;
      backingAudioRef.current = backingAudio;
      const started = backingAudio.play();
      if (started && typeof started.catch === 'function') {
        started.catch(() => {});
      }
      return BACKING_MODES.AUDIO;
    }

    if (track.playbackType === BACKING_MODES.YOUTUBE) {
      ensureYoutubePlayer(track.backingProviderTrackId)
        .then((player) => {
          if (youtubePlayerRef.current === player) {
            player.playVideo();
          }
        })
        .catch(() => {});
      return BACKING_MODES.YOUTUBE;
    }

    return BACKING_MODES.NONE;
  };

  const selectSong = (song) => {
    const track = normalizeStudioTrack(song);
    if (!track) return;

    setSelectedSong(track);
    setPostTitle(`${user?.name || 'My'} - ${track.title}`);
    setStep(STEPS.RECORD);
    setRecordBlob(null);
    setRecordUrl('');
    setRecordingMeta(null);
    setRecordTime(0);
    recordTimeRef.current = 0;
    setPublishMsg('');
    setUploadState('idle');
    setUploadProgress(null);
    setUploadStatusText('');
    setRecordingError('');
    if (recordUrl) {
      URL.revokeObjectURL(recordUrl);
      setRecordUrl('');
    }

    startBackingPlayback(track);
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
      if (selectedSong.playbackType !== 'audio' && selectedSong.playbackType !== 'youtube') {
        setRecordingError('Selected track cannot be used for recording. Please choose another track.');
        return;
      }

      stopBackingPlayback();

      if (selectedSong.playbackType === 'audio') {
        const backingAudio = await loadBackingAudio(selectedSong);
        backingAudioRef.current = backingAudio;
      } else if (selectedSong.playbackType === 'youtube') {
        await ensureYoutubePlayer(selectedSong.backingProviderTrackId || selectedSong.youtubeId);
      }

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
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }

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
      let recorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(dest.stream, { mimeType })
          : new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
      } catch {
        recorder = new MediaRecorder(dest.stream);
      }
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const durationMs = Math.max(0, Math.round(recordTimeRef.current * 1000));
        if (activeRecordingMetaRef.current) {
          const nextMeta = {
            ...activeRecordingMetaRef.current,
            recordingDurationMs: durationMs,
          };
          activeRecordingMetaRef.current = nextMeta;
          setRecordingMeta(nextMeta);
        }
        setRecordBlob(blob);
        if (recordUrl) {
          URL.revokeObjectURL(recordUrl);
        }
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

      if (selectedSong.playbackType === 'youtube' && youtubePlayerRef.current) {
        youtubePlayerRef.current.seekTo(0, true);
        youtubePlayerRef.current.playVideo();
      }

      const recordingMode = selectedSong.recordingMode || (selectedSong.playbackType === 'audio' ? 'MIXED' : 'COMPOSITE');
      const baseMeta = {
        recordingMode,
        backingSongId: selectedSong.catalogSongId || '',
        backingProvider: selectedSong.backingProvider || '',
        backingProviderId: selectedSong.backingProviderTrackId || selectedSong.youtubeId || '',
        backingStartOffsetMs: 0,
        recordingDurationMs: 0,
      };
      activeRecordingMetaRef.current = baseMeta;
      setRecordingMeta(baseMeta);

      recorder.start(100);
      setIsRecording(true);
      setRecordTime(0);
      recordTimeRef.current = 0;
      timerRef.current = setInterval(() => {
        setRecordTime((t) => {
          const next = t + 1;
          recordTimeRef.current = next;
          return next;
        });
      }, 1000);
    } catch (error) {
      if (error.name === 'NotAllowedError') {
        setMicPermission('denied');
        setRecordingError('Microphone permission denied. Please allow microphone access in your browser settings.');
      } else if (error.name === 'NotFoundError') {
        setRecordingError('No microphone found. Please connect a microphone and try again.');
      } else if (error.message === 'backing track failed to load') {
        setRecordingError('Backing track failed to load. Try another track.');
      } else if (error.message === 'youtube api failed to load') {
        setRecordingError('YouTube backing failed to load. Please try again later.');
      } else {
        setRecordingError(`Could not start recording: ${error.message}`);
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
    stopYoutubeBacking();
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
    if (gainNodeRef.current) gainNodeRef.current.gain.value = next.gain * vocalGain;
    if (bassFilterRef.current) bassFilterRef.current.gain.value = next.bass * 30;
    if (trebleFilterRef.current) trebleFilterRef.current.gain.value = next.treble * 30;
    if (delayGainRef.current) delayGainRef.current.gain.value = next.echo;
  };

  const updateEffect = (effectKey, value) => {
    const numeric = parseFloat(value);
    setEffects((prev) => ({ ...prev, [effectKey]: numeric }));
    setActivePreset('');

    if (effectKey === 'gain' && gainNodeRef.current) gainNodeRef.current.gain.value = numeric * vocalGain;
    if (effectKey === 'bass' && bassFilterRef.current) bassFilterRef.current.gain.value = numeric * 30;
    if (effectKey === 'treble' && trebleFilterRef.current) trebleFilterRef.current.gain.value = numeric * 30;
    if (effectKey === 'echo' && delayGainRef.current) delayGainRef.current.gain.value = numeric;
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
    if (recordUrl) {
      URL.revokeObjectURL(recordUrl);
      setRecordUrl('');
    }
    setRecordTime(0);
    recordTimeRef.current = 0;
    setUploadState('idle');
    setUploadProgress(null);
    setUploadStatusText('');
    setStep(STEPS.RECORD);
    setRecordingError('');
  };

  const uploadRecordingWithProgress = (formData, token) => new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/recordings');
    xhr.responseType = 'json';
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        const percentage = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        setUploadProgress(percentage);
      } else {
        setUploadProgress(null);
      }
    };

    xhr.upload.onload = () => {
      setUploadState('processing');
      setUploadProgress(100);
      setUploadStatusText('Processing and saving your recording...');
    };

    xhr.onerror = () => reject(new Error('Upload failed'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response || {});
      } else {
        const message = xhr.response?.error || 'Upload failed';
        reject(new Error(message));
      }
    };

    xhr.send(formData);
  });

  const publishPerformance = async () => {
    if (!recordBlob || !selectedSong || publishing) return;

    setPublishing(true);
    setPublishMsg('');
    setUploadState('uploading');
    setUploadProgress(0);
    setUploadStatusText('Uploading recording...');

    try {
      const formData = new FormData();
      formData.append('audio', recordBlob, 'recording.webm');
      const karaokeId = selectedSong.karaokeId || selectedSong._id || '';
      if (karaokeId) formData.append('karaokeId', karaokeId);
      formData.append('title', postTitle || `${user?.name || 'My'} - ${selectedSong.title}`);
      formData.append('caption', postCaption);
      formData.append('duration', String(recordTime));
      formData.append('effects', JSON.stringify({ ...effects, preset: activePreset || null }));
      formData.append('visibility', postVisibility);
      formData.append('recordingMode', recordingMeta?.recordingMode || selectedSong.recordingMode || 'MIC_ONLY');
      if (recordingMeta?.backingSongId || selectedSong.catalogSongId) {
        formData.append('backingSongId', recordingMeta?.backingSongId || selectedSong.catalogSongId);
      }
      if (recordingMeta?.backingProvider || selectedSong.backingProvider) {
        formData.append('backingProvider', recordingMeta?.backingProvider || selectedSong.backingProvider);
      }
      if (recordingMeta?.backingProviderId || selectedSong.backingProviderTrackId || selectedSong.youtubeId) {
        formData.append('backingProviderId', recordingMeta?.backingProviderId || selectedSong.backingProviderTrackId || selectedSong.youtubeId);
      }
      formData.append('backingStartOffsetMs', String(recordingMeta?.backingStartOffsetMs || 0));
      formData.append('recordingDurationMs', String(recordingMeta?.recordingDurationMs || (recordTimeRef.current * 1000)));

      const token = localStorage.getItem('melodify_token');
      let result;
      try {
        result = await uploadRecordingWithProgress(formData, token);
      } catch (err) {
        if (err.message === 'Upload failed') {
          result = await api.post('/api/recordings', formData);
        } else {
          throw err;
        }
      }

      if (!result.success) {
        setUploadState('error');
        setUploadStatusText('Could not save this recording.');
        setPublishMsg(`Failed to save recording: ${result.error || 'Unknown error'}`);
        setPublishing(false);
        return;
      }

      setUploadState('success');
      setUploadProgress(100);
      setUploadStatusText('Upload complete. Recording saved.');
      setPublishMsg('Recording saved successfully!');
      setStep(STEPS.SELECT);
      setSelectedSong(null);
      setRecordBlob(null);
      if (recordUrl) {
        URL.revokeObjectURL(recordUrl);
        setRecordUrl('');
      }
      setRecordingMeta(null);
      setPostTitle('');
      setPostCaption('');
    } catch (err) {
      setUploadState('error');
      setUploadStatusText('Upload failed. Please try again.');
      setPublishMsg(`Save failed: ${err.message}`);
    }
    setPublishing(false);
  };

  const isCompositeRecording = recordingMeta?.recordingMode === 'COMPOSITE' && !!recordingMeta?.backingProviderId;

  useEffect(() => {
    if (step !== STEPS.PREVIEW || !isCompositeRecording) {
      previewSyncReadyRef.current = false;
      stopYoutubeBacking();
      return undefined;
    }
    let cancelled = false;
    ensureYoutubePlayer(recordingMeta.backingProviderId)
      .then(() => {
        if (cancelled) return;
        previewSyncReadyRef.current = true;
      })
      .catch(() => {
        if (cancelled) return;
        previewSyncReadyRef.current = false;
      });

    return () => {
      cancelled = true;
      stopYoutubeBacking();
      previewSyncReadyRef.current = false;
    };
  }, [step, isCompositeRecording, recordingMeta?.backingProviderId]);

  const syncCompositePreviewPlayback = (audioTimeSeconds, shouldPlay) => {
    if (!isCompositeRecording) return;
    if (!previewSyncReadyRef.current || !youtubePlayerRef.current) return;
    const offsetSeconds = (recordingMeta.backingStartOffsetMs || 0) / 1000;
    const targetSeconds = Math.max(0, offsetSeconds + Math.max(0, audioTimeSeconds));
    try {
      youtubePlayerRef.current.seekTo(targetSeconds, true);
      if (shouldPlay) {
        youtubePlayerRef.current.playVideo();
      } else {
        youtubePlayerRef.current.pauseVideo();
      }
    } catch {}
  };

  const changeSong = () => {
    if (isRecording) stopRecording();
    cleanupRecording();
    setStep(STEPS.SELECT);
    setSelectedSong(null);
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
              onChange={(event) => {
                setSongQuery(event.target.value);
                setDiscoveryPage(1);
              }}
              placeholder="Search karaoke tracks"
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

          {discoveryError ? <div className="studio-discovery-status error">{discoveryError}</div> : null}
          {!discoveryError && discoveryExternalState === 'disabled' ? (
            <div className="studio-discovery-status">External provider is unavailable right now.</div>
          ) : null}

          {searching ? <p className="studio-status" role="status">Searching karaoke tracks...</p> : null}

          {!searching && karaokeTracks.length === 0 && !discoveryError ? (
            <EmptyState
              icon="fa-music"
              title={songQuery.trim() ? 'No karaoke tracks found' : 'No karaoke tracks available'}
              detail={songQuery.trim() ? `No results for "${songQuery}".` : 'Ask an admin to upload karaoke tracks first.'}
            />
          ) : null}

          {karaokeTracks.length > 0 ? (
            <div className="studio-song-grid" aria-label="Karaoke tracks">
              {karaokeTracks.map((song) => (
                <article key={song.id || song._id} className="studio-song-card">
                  <div className="studio-song-poster">
                    <img
                      src={getPosterUrl(song)}
                      alt={`${song.title} artwork`}
                      onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
                    />
                    <span className={`studio-track-badge ${song.classification === 'KARAOKE_READY' ? 'ready' : 'singalong'}`}>
                      {song.classification === 'KARAOKE_READY' ? 'KARAOKE_READY' : 'SING_ALONG'}
                    </span>
                  </div>
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

          {discoveryPages > 1 ? (
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
                onClick={changeSong}
              >
                Change song
              </button>
            )}
          />

          <div className="studio-now-playing">
            <img
              src={getPosterUrl(selectedSong)}
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

              <label>Backing</label>
              <input type="range" min="0" max="1.5" step="0.05" value={backingVolume} onChange={(event) => updateBackingVolume(event.target.value)} />
              <span>{Math.round(backingVolume * 100)}%</span>

              <label>Vocal</label>
              <input type="range" min="0" max="2" step="0.05" value={vocalGain} onChange={(event) => updateVocalGain(event.target.value)} />
              <span>{Math.round(vocalGain * 100)}%</span>

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

          <p className="studio-headphone-hint">
            For best results, use headphones to avoid microphone feedback.
          </p>

          <button type="button" className="music-outline-btn" onClick={changeSong}>
            Back to song selection
          </button>
        </section>
      ) : null}

      {step === STEPS.PREVIEW && recordUrl ? (
        <section className="music-section app-surface studio-panel">
          <SectionHeader title="Preview your take" subtitle="Listen to your recording before publishing" />

          <audio
            ref={previewAudioRef}
            controls
            src={recordUrl}
            className="studio-preview-audio"
            onPlay={(event) => {
              syncCompositePreviewPlayback(event.currentTarget.currentTime, true);
            }}
            onPause={(event) => {
              syncCompositePreviewPlayback(event.currentTarget.currentTime, false);
            }}
            onSeeked={(event) => {
              const shouldPlay = !event.currentTarget.paused;
              syncCompositePreviewPlayback(event.currentTarget.currentTime, shouldPlay);
            }}
            onEnded={() => {
              stopYoutubeBacking();
            }}
          ></audio>
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

            {uploadState !== 'idle' ? (
              <div className={`studio-upload-status ${uploadState}`} aria-live="polite">
                <div className="studio-upload-header">
                  <span className="studio-upload-state-label">{uploadState === 'error' ? 'Upload failed' : uploadState === 'success' ? 'Upload complete' : uploadState === 'processing' ? 'Processing' : 'Uploading'}</span>
                  <span className="studio-upload-percent">{typeof uploadProgress === 'number' ? `${uploadProgress}%` : '...'}</span>
                </div>
                <div
                  className="studio-upload-progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={typeof uploadProgress === 'number' ? uploadProgress : undefined}
                >
                  <div className="studio-upload-progress-fill" style={{ width: `${typeof uploadProgress === 'number' ? uploadProgress : 35}%` }}></div>
                </div>
                <p className="studio-upload-text">{uploadStatusText}</p>
              </div>
            ) : null}

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

      <div className="studio-youtube-shell" aria-hidden="true">
        <div id="studio-youtube-player"></div>
      </div>
    </div>
  );
}
