import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  createListeningTelemetryController,
  LISTENING_TELEMETRY_DISABLED_MESSAGE,
} from './listeningTelemetry.js';

const PlayerContext = createContext(null);

export const PLAYBACK_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  PLAYING: 'playing',
  PAUSED: 'paused',
  BLOCKED: 'blocked',
  ERROR: 'error',
});

export const YOUTUBE_INIT_TIMEOUT_MS = 10000;
export const PLAY_CONFIRM_TIMEOUT_MS = 8000;

export function usePlayer() {
  return useContext(PlayerContext);
}

export function formatTime(sec) {
  if (!sec || Number.isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function PlayerProvider({ children }) {
  const [list, setList] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackStatus, setPlaybackStatusState] = useState(PLAYBACK_STATUS.IDLE);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [volume, setVolumeState] = useState(50);
  const [muted, setMuted] = useState(false);
  const [playMode, setPlayMode] = useState('list');

  const audioRef = useRef(null);
  const ytRef = useRef(null);
  const ytApiReady = useRef(false);
  const playerReadyRef = useRef(false);
  const pendingLoadRef = useRef(null);
  const pollRef = useRef(null);
  const errorCountRef = useRef(0);
  const playModeRef = useRef('list');
  const nextRef = useRef(null);
  const playSongRef = useRef(null);
  const transitioningRef = useRef(false);
  const targetSongRef = useRef(null);
  const playbackStatusRef = useRef(PLAYBACK_STATUS.IDLE);
  const initTimerRef = useRef(null);
  const confirmTimerRef = useRef(null);
  const stateRef = useRef({ list: [], index: -1, isPlaying: false, volume: 50, muted: false });
  stateRef.current.list = list;
  stateRef.current.index = index;
  stateRef.current.isPlaying = isPlaying;
  stateRef.current.volume = volume;
  stateRef.current.muted = muted;
  playModeRef.current = playMode;

  const telemetryRef = useRef(null);
  if (!telemetryRef.current) {
    telemetryRef.current = createListeningTelemetryController({
      sendEvent: async (payload) => {
        const result = await api.post('/api/listening-events', payload);
        if (result && result.error === LISTENING_TELEMETRY_DISABLED_MESSAGE) {
          return { disabled: true };
        }
        return result;
      },
      recordHistory: (songId) => {
        if (!songId) return Promise.resolve();
        if (!localStorage.getItem('melodify_token')) return Promise.resolve();
        return api.post('/api/history', { songId }).catch(() => {});
      },
      makeId: () => {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID();
        }
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        let out = '';
        for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
        return out;
      },
      now: () => new Date(),
      hasAuthToken: () => Boolean(localStorage.getItem('melodify_token')),
    });
  }
  const telemetry = telemetryRef.current;

  const currentSong = index >= 0 && list[index] ? list[index] : null;

  const setStatus = useCallback((next) => {
    playbackStatusRef.current = next;
    setPlaybackStatusState(next);
  }, []);

  const clearInitTimer = useCallback(() => {
    if (initTimerRef.current) {
      clearTimeout(initTimerRef.current);
      initTimerRef.current = null;
    }
  }, []);

  const clearConfirmTimer = useCallback(() => {
    if (confirmTimerRef.current) {
      clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = null;
    }
  }, []);

  const clearPlaybackTimers = useCallback(() => {
    clearInitTimer();
    clearConfirmTimer();
  }, [clearInitTimer, clearConfirmTimer]);

  const startInitTimer = useCallback(() => {
    clearInitTimer();
    initTimerRef.current = setTimeout(() => {
      initTimerRef.current = null;
      if (playerReadyRef.current) return;
      setIsPlaying(false);
      setStatus(PLAYBACK_STATUS.ERROR);
    }, YOUTUBE_INIT_TIMEOUT_MS);
  }, [clearInitTimer, setStatus]);

  const startConfirmTimer = useCallback(() => {
    clearConfirmTimer();
    confirmTimerRef.current = setTimeout(() => {
      confirmTimerRef.current = null;
      if (playbackStatusRef.current !== PLAYBACK_STATUS.LOADING) return;
      let enginePlaying = false;
      try {
        const p = ytRef.current;
        enginePlaying = Boolean(
          p &&
          window.YT &&
          typeof p.getPlayerState === 'function' &&
          p.getPlayerState() === window.YT.PlayerState.PLAYING,
        );
      } catch {
        enginePlaying = false;
      }
      if (enginePlaying) return;
      setIsPlaying(false);
      setStatus(PLAYBACK_STATUS.BLOCKED);
    }, PLAY_CONFIRM_TIMEOUT_MS);
  }, [clearConfirmTimer, setStatus]);

  const markPlaying = useCallback(() => {
    clearPlaybackTimers();
    errorCountRef.current = 0;
    transitioningRef.current = false;
    targetSongRef.current = null;
    setIsPlaying(true);
    setStatus(PLAYBACK_STATUS.PLAYING);
  }, [clearPlaybackTimers, setStatus]);

  const markPaused = useCallback(() => {
    clearConfirmTimer();
    setIsPlaying(false);
    setStatus(PLAYBACK_STATUS.PAUSED);
  }, [clearConfirmTimer, setStatus]);

  const isYoutubeTrackActive = useCallback(() => {
    const song = stateRef.current.list[stateRef.current.index];
    return Boolean(song && song.youtube_id);
  }, []);

  const getContainer = useCallback(() => {
    let el = document.getElementById('melodify-yt-player');
    if (!el) {
      el = document.createElement('div');
      el.id = 'melodify-yt-player';
      el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;overflow:hidden;opacity:0.01;pointer-events:none';
      document.body.appendChild(el);
    }
    return el;
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      const p = ytRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') return;
      try {
        const t = p.getCurrentTime();
        const d = p.getDuration();
        setCurrentTime(t);
        setDuration(d);
        if (d) setProgress((t / d) * 100);
        telemetry.progress({ position: t, duration: d });
      } catch {}
    }, 250);
  }, [telemetry]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadVideo = useCallback((song) => {
    const p = ytRef.current;
    if (!p || !song?.youtube_id) return;
    setStatus(PLAYBACK_STATUS.LOADING);
    try {
      p.loadVideoById(song.youtube_id, 0);
      p.setVolume(stateRef.current.muted ? 0 : stateRef.current.volume);
      p.playVideo();
      startPolling();
      startConfirmTimer();
    } catch (err) {
      console.error('YouTube loadVideoById error:', err);
      stopPolling();
      setIsPlaying(false);
      setStatus(PLAYBACK_STATUS.ERROR);
    }
  }, [startConfirmTimer, startPolling, setStatus, stopPolling]);

  const switchTrack = useCallback((newList, i, transitionReason) => {
    const song = newList?.[i];
    if (!song) return;
    const previous = telemetry.getSessionSnapshot();
    const sameTrack = previous?.songId === String(song._id);
    const oldSong = stateRef.current.list[stateRef.current.index];
    let position;
    let mediaDuration;
    try {
      position = oldSong?.youtube_id ? ytRef.current?.getCurrentTime() : audioRef.current?.currentTime;
      mediaDuration = oldSong?.youtube_id ? ytRef.current?.getDuration() : audioRef.current?.duration;
    } catch {}
    if (!sameTrack && transitionReason) {
      telemetry.skip({ reason: transitionReason, position, duration: mediaDuration });
    } else if (sameTrack && previous.started && !previous.terminal && !previous.paused) {
      // Existing same-song selection reloads at zero; observe it as a seek,
      // not abandonment or replay. Paused reloads reset the baseline on resume.
      telemetry.seek({ from: position, to: 0, duration: mediaDuration });
    }
    telemetry.prepare(song);
    stateRef.current.list = newList;
    stateRef.current.index = i;
    setList(newList);
    setIndex(i);
    if (transitionReason) errorCountRef.current = 0;
    transitioningRef.current = true;
    targetSongRef.current = song;
    clearPlaybackTimers();

    if (song.youtube_id) {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
      setStatus(PLAYBACK_STATUS.LOADING);
      if (playerReadyRef.current && ytRef.current) {
        loadVideo(song);
      } else {
        pendingLoadRef.current = { song };
        startInitTimer();
      }
    } else {
      if (ytRef.current) {
        try { ytRef.current.pauseVideo(); } catch {}
      }
      stopPolling();
      const audio = audioRef.current;
      if (audio) {
        audio.src = song.file_path || '';
        setStatus(PLAYBACK_STATUS.LOADING);
        const attempt = audio.play();
        if (attempt && typeof attempt.catch === 'function') {
          attempt.catch(() => {
            stopPolling();
            setIsPlaying(false);
            setStatus(PLAYBACK_STATUS.ERROR);
          });
        }
      }
    }
  }, [clearPlaybackTimers, loadVideo, startInitTimer, setStatus, stopPolling, telemetry]);

  const playSong = useCallback((newList, i) => {
    switchTrack(newList, i, 'new-selection');
  }, [switchTrack]);

  playSongRef.current = switchTrack;

  const advanceNext = useCallback((transitionReason) => {
    const { list: l, index: i } = stateRef.current;
    if (!l.length) return;
    let n;
    if (playModeRef.current === 'shuffle') {
      n = Math.floor(Math.random() * l.length);
    } else {
      n = (i + 1) % l.length;
    }
    playSongRef.current(l, n, transitionReason);
  }, []);

  // Media ENDED/error callbacks use the automatic path with no manual reason.
  nextRef.current = advanceNext;

  const next = useCallback(() => advanceNext('manual-next'), [advanceNext]);

  const ensurePlayer = useCallback(() => {
    if (ytRef.current) return;
    ytApiReady.current = true;
    ytRef.current = new window.YT.Player(getContainer(), {
      width: '1',
      height: '1',
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1 },
      events: {
        onReady: () => {
          playerReadyRef.current = true;
          clearInitTimer();
          const pending = pendingLoadRef.current;
          if (pending) {
            pendingLoadRef.current = null;
            if (pending.song?.youtube_id) {
              loadVideo(pending.song);
            }
          }
        },
        onStateChange: (e) => {
          const p = ytRef.current;
          const readPos = () => {
            try {
              return p && typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : undefined;
            } catch {
              return undefined;
            }
          };
          const readDur = () => {
            try {
              return p && typeof p.getDuration === 'function' ? p.getDuration() : undefined;
            } catch {
              return undefined;
            }
          };
          if (e.data === window.YT.PlayerState.PLAYING) {
            markPlaying();
            startPolling();
            telemetry.confirmedPlay({ position: readPos(), duration: readDur() });
          } else if (e.data === window.YT.PlayerState.PAUSED) {
            if (isYoutubeTrackActive()) markPaused();
            stopPolling();
            telemetry.pause({ position: readPos(), duration: readDur() });
          } else if (e.data === window.YT.PlayerState.ENDED) {
            stopPolling();
            if (transitioningRef.current) return;
            telemetry.complete({ position: readDur(), duration: readDur() });
            if (playModeRef.current === 'single') {
              try {
                ytRef.current?.seekTo(0, true);
                ytRef.current?.playVideo();
              } catch {}
            } else {
              nextRef.current();
            }
          }
        },
        onError: (e) => {
          errorCountRef.current += 1;
          const { list: l } = stateRef.current;
          if (errorCountRef.current >= Math.min(3, l.length || 1)) {
            errorCountRef.current = 0;
            stopPolling();
            setIsPlaying(false);
            setStatus(PLAYBACK_STATUS.ERROR);
          } else {
            nextRef.current();
          }
        },
      },
    });
    },
    [clearInitTimer, getContainer, isYoutubeTrackActive, loadVideo, markPlaying, markPaused, setStatus, startPolling, stopPolling, telemetry],
  );

  const loadYT = useCallback(() => {
    if (window.YT && window.YT.Player) {
      ensurePlayer();
      return;
    }
    const existing = document.querySelector('script[src*="youtube.com/iframe_api"]');
    if (!existing) window.__melodifyYTLoading = false;
    if (!window.__melodifyYTLoading) {
      window.__melodifyYTLoading = true;
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => {
        ensurePlayer();
      };
    }
  }, [ensurePlayer]);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
      telemetry.progress({
        position: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : undefined,
      });
    });
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('ended', () => {
      telemetry.complete({
        position: Number.isFinite(audio.duration) ? audio.duration : undefined,
        duration: Number.isFinite(audio.duration) ? audio.duration : undefined,
      });
      if (playModeRef.current === 'single') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        nextRef.current();
      }
    });
    audio.addEventListener('play', () => {
      markPlaying();
      telemetry.confirmedPlay({
        position: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : undefined,
      });
    });
    audio.addEventListener('pause', () => {
      if (!isYoutubeTrackActive()) markPaused();
      telemetry.pause({
        position: audio.currentTime,
        duration: Number.isFinite(audio.duration) ? audio.duration : undefined,
      });
    });

    loadYT();

    return () => {
      clearPlaybackTimers();
      stopPolling();
      audio.pause();
      audio.src = '';
    };
  }, [clearPlaybackTimers, loadYT, markPaused, stopPolling, telemetry]);

  const togglePlay = useCallback(() => {
    const { list: l, index: i, isPlaying: playing } = stateRef.current;
    if (l.length === 0) return;
    if (i === -1) {
      playSongRef.current(l, 0);
      return;
    }
    const song = l[i];
    if (playing) {
      if (song?.youtube_id) {
        try { ytRef.current?.pauseVideo(); } catch {}
      } else {
        audioRef.current?.pause();
      }
      return;
    }
    if (song?.youtube_id) {
      if (playerReadyRef.current && ytRef.current) {
        setStatus(PLAYBACK_STATUS.LOADING);
        startConfirmTimer();
        try { ytRef.current.playVideo(); } catch { setIsPlaying(false); setStatus(PLAYBACK_STATUS.ERROR); }
      } else {
        pendingLoadRef.current = { song };
        setStatus(PLAYBACK_STATUS.LOADING);
        startInitTimer();
        loadYT();
      }
    } else {
      setStatus(PLAYBACK_STATUS.LOADING);
      const attempt = audioRef.current?.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(() => {
          stopPolling();
          setIsPlaying(false);
          setStatus(PLAYBACK_STATUS.ERROR);
        });
      }
    }
  }, [loadYT, startConfirmTimer, startInitTimer, setStatus, stopPolling]);

  const pause = useCallback(() => {
    const { list: l, index: i } = stateRef.current;
    const song = l[i];
    if (song?.youtube_id) {
      try { ytRef.current?.pauseVideo(); } catch {}
    } else {
      audioRef.current?.pause();
    }
    setIsPlaying(false);
  }, []);

  const prev = useCallback(() => {
    const { list: l, index: i } = stateRef.current;
    if (!l.length) return;
    const n = (i - 1 + l.length) % l.length;
    playSongRef.current(l, n, 'manual-previous');
  }, []);

  const setVolume = useCallback((v) => {
    const val = Number(v);
    setVolumeState(val);
    stateRef.current.volume = val;
    if (audioRef.current) audioRef.current.volume = val / 100;
    try { ytRef.current?.setVolume(val); } catch {}
    setMuted(val === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const { muted: m, volume: vol } = stateRef.current;
    if (m) {
      if (audioRef.current) audioRef.current.volume = vol / 100;
      try { ytRef.current?.setVolume(vol); } catch {}
      setMuted(false);
    } else {
      if (audioRef.current) audioRef.current.volume = 0;
      try { ytRef.current?.setVolume(0); } catch {}
      setMuted(true);
    }
  }, []);

  const seek = useCallback((ratio) => {
    const { list: l, index: i } = stateRef.current;
    const song = l[i];
    if (!song) return;
    if (song.youtube_id) {
      const p = ytRef.current;
      if (!p || typeof p.getDuration !== 'function') return;
      try {
        const d = p.getDuration();
        if (!d) return;
        let from;
        try {
          from = typeof p.getCurrentTime === 'function' ? p.getCurrentTime() : undefined;
        } catch {
          from = undefined;
        }
        const to = ratio * d;
        telemetry.seek({ from, to, duration: d });
        p.seekTo(to, true);
        setCurrentTime(to);
        setProgress(ratio * 100);
      } catch {}
    } else {
      const audio = audioRef.current;
      if (!audio || !audio.duration) return;
      const from = audio.currentTime;
      const to = ratio * audio.duration;
      telemetry.seek({ from, to, duration: audio.duration });
      audio.currentTime = to;
      setCurrentTime(audio.currentTime);
      setProgress(ratio * 100);
    }
  }, [telemetry]);

  const retryPlayback = useCallback(() => {
    const { list: l, index: i } = stateRef.current;
    const song = l[i];
    if (!song) return;
    clearPlaybackTimers();
    if (song.youtube_id) {
      if (playerReadyRef.current && ytRef.current) {
        loadVideo(song);
      } else {
        pendingLoadRef.current = { song };
        setStatus(PLAYBACK_STATUS.LOADING);
        startInitTimer();
        loadYT();
      }
    } else {
      const audio = audioRef.current;
      if (!audio || !song.file_path) {
        stopPolling();
        setIsPlaying(false);
        setStatus(PLAYBACK_STATUS.ERROR);
        return;
      }
      setStatus(PLAYBACK_STATUS.LOADING);
      const attempt = audio.play();
      if (attempt && typeof attempt.catch === 'function') {
        attempt.catch(() => {
          stopPolling();
          setIsPlaying(false);
          setStatus(PLAYBACK_STATUS.ERROR);
        });
      }
    }
  }, [clearPlaybackTimers, loadVideo, loadYT, startInitTimer, setStatus, stopPolling]);

  const value = {
    currentSong,
    list,
    index,
    isPlaying,
    playbackStatus,
    currentTime,
    duration,
    progress,
    volume,
    muted,
    playMode,
    setPlayMode,
    playSong,
    togglePlay,
    pause,
    next,
    prev,
    setVolume,
    toggleMute,
    seek,
    retryPlayback,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}
