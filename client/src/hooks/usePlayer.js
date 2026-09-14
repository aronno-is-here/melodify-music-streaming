import { useCallback, useEffect, useRef, useState } from 'react';

export function formatTime(sec) {
  if (!sec || Number.isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function usePlayer() {
  const [list, setList] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [volume, setVolumeState] = useState(50);
  const [muted, setMuted] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [shuffle, setShuffle] = useState(false);

  const audioRef = useRef(null);
  const ytRef = useRef(null);
  const ytReady = useRef(false);
  const pendingLoadRef = useRef(null);
  const pollRef = useRef(null);
  const errorCountRef = useRef(0);
  const repeatRef = useRef(false);
  const shuffleRef = useRef(false);
  const nextRef = useRef(null);
  const playSongRef = useRef(null);
  const stateRef = useRef({ list: [], index: -1, isPlaying: false, volume: 50, muted: false });
  stateRef.current.list = list;
  stateRef.current.index = index;
  stateRef.current.isPlaying = isPlaying;
  stateRef.current.volume = volume;
  stateRef.current.muted = muted;
  repeatRef.current = repeat;
  shuffleRef.current = shuffle;

  const currentSong = index >= 0 && list[index] ? list[index] : null;

  const getContainer = () => {
    let el = document.getElementById('melodify-yt-player');
    if (!el) {
      el = document.createElement('div');
      el.id = 'melodify-yt-player';
      el.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden;pointer-events:none';
      document.body.appendChild(el);
    }
    return el;
  };

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      const p = ytRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') return;
      const t = p.getCurrentTime();
      const d = p.getDuration();
      setCurrentTime(t);
      setDuration(d);
      if (d) setProgress((t / d) * 100);
    }, 250);
  };

  const loadVideo = (song) => {
    const p = ytRef.current;
    if (!p) return;
    p.loadVideoById(song.youtube_id, 0);
    p.setVolume(stateRef.current.muted ? 0 : stateRef.current.volume);
    p.playVideo();
  };

  const playSong = useCallback((newList, i) => {
    const song = newList[i];
    if (!song) return;
    setList(newList);
    setIndex(i);
    errorCountRef.current = 0;
    if (song.youtube_id) {
      audioRef.current?.pause();
      if (ytReady.current && ytRef.current) {
        loadVideo(song);
      } else {
        pendingLoadRef.current = { newList, i };
        setIsPlaying(true);
      }
    } else {
      ytRef.current?.pauseVideo();
      const audio = audioRef.current;
      audio.src = song.file_path;
      audio.play();
    }
  }, []);

  playSongRef.current = playSong;

  const next = useCallback(() => {
    const { list: l, index: i } = stateRef.current;
    if (!l.length) return;
    let n;
    if (shuffleRef.current) {
      n = Math.floor(Math.random() * l.length);
    } else {
      n = (i + 1) % l.length;
    }
    playSongRef.current(l, n);
  }, []);

  nextRef.current = next;

  const ensurePlayer = useCallback(() => {
    if (!ytReady.current || ytRef.current) return;
    ytRef.current = new window.YT.Player(getContainer(), {
      width: '0',
      height: '0',
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1 },
      events: {
        onReady: () => {
          if (pendingLoadRef.current) {
            const { newList, i } = pendingLoadRef.current;
            pendingLoadRef.current = null;
            playSongRef.current(newList, i);
          }
        },
        onStateChange: (e) => {
          if (e.data === window.YT.PlayerState.PLAYING) {
            setIsPlaying(true);
            startPolling();
          } else if (e.data === window.YT.PlayerState.PAUSED) {
            setIsPlaying(false);
          } else if (e.data === window.YT.PlayerState.ENDED) {
            if (repeatRef.current) {
              ytRef.current?.seekTo(0, true);
              ytRef.current?.playVideo();
            } else {
              nextRef.current();
            }
          }
        },
        onError: () => {
          errorCountRef.current += 1;
          const { list: l } = stateRef.current;
          if (errorCountRef.current >= Math.min(3, l.length)) {
            errorCountRef.current = 0;
            setIsPlaying(false);
          } else {
            nextRef.current();
          }
        },
      },
    });
  }, []);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime);
      if (audio.duration) setProgress((audio.currentTime / audio.duration) * 100);
    });
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('ended', () => {
      if (repeatRef.current) {
        audio.currentTime = 0;
        audio.play();
      } else {
        nextRef.current();
      }
    });
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));

    if (window.YT) {
      ytReady.current = true;
      ensurePlayer();
    } else if (!window.__melodifyYTLoading) {
      window.__melodifyYTLoading = true;
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => {
        ytReady.current = true;
        ensurePlayer();
      };
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      audio.pause();
      audio.src = '';
      ytRef.current?.pauseVideo();
    };
  }, []);

  const togglePlay = useCallback(() => {
    const { list: l, index: i, isPlaying: playing } = stateRef.current;
    if (l.length === 0) return;
    if (i === -1) {
      playSongRef.current(l, 0);
      return;
    }
    const song = l[i];
    if (playing) {
      if (song.youtube_id) ytRef.current?.pauseVideo();
      else audioRef.current?.pause();
    } else {
      if (song.youtube_id) {
        if (ytReady.current && ytRef.current) ytRef.current.playVideo();
        else playSongRef.current(l, i);
      } else {
        audioRef.current?.play();
      }
    }
  }, []);

  const pause = useCallback(() => {
    const { list: l, index: i } = stateRef.current;
    const song = l[i];
    if (song?.youtube_id) ytRef.current?.pauseVideo();
    else audioRef.current?.pause();
    setIsPlaying(false);
  }, []);

  const prev = useCallback(() => {
    const { list: l, index: i } = stateRef.current;
    if (!l.length) return;
    const n = (i - 1 + l.length) % l.length;
    playSongRef.current(l, n);
  }, []);

  const setVolume = useCallback((v) => {
    const val = Number(v);
    setVolumeState(val);
    stateRef.current.volume = val;
    audioRef.current.volume = val / 100;
    ytRef.current?.setVolume(val);
    setMuted(val === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const { muted: m, volume: vol } = stateRef.current;
    if (m) {
      audioRef.current.volume = vol / 100;
      ytRef.current?.setVolume(vol);
      setMuted(false);
    } else {
      audioRef.current.volume = 0;
      ytRef.current?.setVolume(0);
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
      const d = p.getDuration();
      if (!d) return;
      p.seekTo(ratio * d, true);
      setCurrentTime(ratio * d);
      setProgress(ratio * 100);
    } else {
      const audio = audioRef.current;
      if (!audio || !audio.duration) return;
      audio.currentTime = ratio * audio.duration;
      setCurrentTime(audio.currentTime);
      setProgress(ratio * 100);
    }
  }, []);

  return {
    currentSong,
    list,
    index,
    isPlaying,
    currentTime,
    duration,
    progress,
    volume,
    muted,
    repeat,
    setRepeat,
    shuffle,
    setShuffle,
    playSong,
    togglePlay,
    pause,
    next,
    prev,
    setVolume,
    toggleMute,
    seek,
  };
}
