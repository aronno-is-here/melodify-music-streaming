import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import usePlayer from '../../hooks/usePlayer.js';
import SectionHeader from '../../components/music/SectionHeader.jsx';
import SongRow from '../../components/music/SongRow.jsx';
import EmptyState from '../../components/music/EmptyState.jsx';
import AppDialog from '../../components/ui/AppDialog.jsx';
import LyricsChordsPanel from '../Dashboard/LyricsChordsPanel.jsx';
import cssRaw from './SongDetails.css?raw';

const DEFAULT_POSTER = 'https://picsum.photos/500/500?random';

function buildRelatedSongs(targetSong, allSongs) {
  if (!targetSong || !Array.isArray(allSongs)) return [];

  const others = allSongs.filter((song) => String(song._id) !== String(targetSong._id));
  const targetArtist = String(targetSong.artist || '').toLowerCase();
  const targetGenre = String(targetSong.genre || '').toLowerCase();

  const sameArtist = others.filter((song) => String(song.artist || '').toLowerCase() === targetArtist);
  const sameGenre = others.filter((song) => String(song.genre || '').toLowerCase() === targetGenre);

  const grouped = [...sameArtist, ...sameGenre, ...others];
  const seen = new Set();
  const deduped = [];

  for (const song of grouped) {
    const songId = String(song._id);
    if (seen.has(songId)) continue;
    seen.add(songId);
    deduped.push(song);
    if (deduped.length >= 14) break;
  }

  return deduped;
}

export default function SongDetails() {
  useLayoutEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-page-css', 'SongDetails');
    style.textContent = cssRaw;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  const { id } = useParams();
  const {
    favoritedIds,
    toggleFavorite,
  } = useOutletContext();

  const player = usePlayer();
  const [song, setSong] = useState(null);
  const [relatedSongs, setRelatedSongs] = useState([]);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lyricsOpen, setLyricsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadSong = async () => {
      setLoading(true);
      const detail = await api.get(`/api/songs/${id}`);
      if (cancelled) return;

      if (!detail.success) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setSong(detail.song);
      setNotFound(false);

      const all = await api.get('/api/songs?limit=100');
      if (cancelled) return;

      if (all.success) {
        setRelatedSongs(buildRelatedSongs(detail.song, all.songs));
      } else {
        setRelatedSongs([]);
      }

      setLoading(false);
    };

    loadSong();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const queue = useMemo(() => (song ? [song, ...relatedSongs] : []), [song, relatedSongs]);
  const currentSongId = player.currentSong?._id ? String(player.currentSong._id) : null;
  const isCurrentSong = song && currentSongId === String(song._id);
  const isFavorited = song ? favoritedIds.has(String(song._id)) : false;

  const playFromQueue = (index) => {
    const target = queue[index];
    if (!target) return;
    if (currentSongId === String(target._id)) {
      player.togglePlay();
      return;
    }
    player.playSong(queue, index);
  };

  const playPrimary = () => {
    if (!song) return;
    if (isCurrentSong) {
      player.togglePlay();
      return;
    }
    player.playSong(queue, 0);
  };

  const openSource = () => {
    if (!song) return;
    if (song.youtube_id) {
      window.open(`https://www.youtube.com/watch?v=${song.youtube_id}`, '_blank', 'noopener,noreferrer');
      return;
    }
    if (song.file_path) {
      window.open(`/assets/${song.file_path.replace(/^assets\//, '')}`, '_blank', 'noopener,noreferrer');
    }
  };

  if (notFound) {
    return (
      <div className="song-details-page">
        <section className="music-section app-surface song-details-state">
          <EmptyState
            icon="fa-circle-exclamation"
            title="Song not found"
            detail="The song may have been removed from the catalog."
          />
          <Link to="/dashboard" className="music-outline-btn">Back to dashboard</Link>
        </section>
      </div>
    );
  }

  if (loading || !song) {
    return (
      <div className="song-details-page">
        <section className="music-section app-surface song-details-state">
          <p className="song-details-status" role="status">Loading song details...</p>
        </section>
      </div>
    );
  }

  return (
    <div className="song-details-page">
      <section className="song-details-hero app-surface">
        <img
          className="song-details-art"
          src={song.poster_url || DEFAULT_POSTER}
          alt={`${song.title} artwork`}
          onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
        />

        <div className="song-details-meta">
          <p className="song-details-kicker">Song Details</p>
          <h1>{song.title}</h1>
          <p>{song.artist}</p>
          <div className="song-details-tags">
            {song.genre ? <span>{song.genre}</span> : null}
            {song.language ? <span>{song.language}</span> : null}
            {song.release_date ? <span>{String(song.release_date).slice(0, 4)}</span> : null}
            {song.duration ? <span>{song.duration}</span> : null}
          </div>

          <div className="song-details-actions">
            <button type="button" className="music-pill-btn" onClick={playPrimary}>
              <i className={`fa-solid ${isCurrentSong && player.isPlaying ? 'fa-pause' : 'fa-play'}`} aria-hidden="true"></i>
              {isCurrentSong && player.isPlaying ? 'Pause' : 'Play'}
            </button>
            <button type="button" className="music-outline-btn" onClick={() => toggleFavorite(song._id)}>
              <i className={`${isFavorited ? 'fa-solid' : 'fa-regular'} fa-heart`} aria-hidden="true"></i>
              {isFavorited ? 'Liked' : 'Like'}
            </button>
            <button type="button" className="music-outline-btn" onClick={() => setLyricsOpen(true)}>
              <i className="fa-solid fa-music" aria-hidden="true"></i>
              Lyrics & Chords
            </button>
            <button type="button" className="music-outline-btn" onClick={openSource}>
              <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i>
              Open Source
            </button>
          </div>
        </div>
      </section>

      <section className="music-section app-surface">
        <SectionHeader
          title="Related Tracks"
          subtitle="Curated from matching artist and genre"
        />

        {queue.length === 0 ? (
          <EmptyState
            icon="fa-compact-disc"
            title="No tracks available"
          />
        ) : (
          <div>
            {queue.map((track, index) => (
              <SongRow
                key={`${track._id}-${index}`}
                song={track}
                subtitle={track.artist}
                isPlaying={player.isPlaying}
                isActive={currentSongId === String(track._id)}
                isFavorited={favoritedIds.has(String(track._id))}
                onPlay={() => playFromQueue(index)}
                onToggleFavorite={() => toggleFavorite(track._id)}
                trailing={<span className="song-details-duration">{track.duration || '0:00'}</span>}
              />
            ))}
          </div>
        )}
      </section>

      <AppDialog
        open={lyricsOpen}
        title="Lyrics & Chords"
        onClose={() => setLyricsOpen(false)}
        labelledBy="song-details-lyrics-title"
        width="720px"
      >
        <div className="song-details-lyrics-wrap">
          <LyricsChordsPanel onClose={() => setLyricsOpen(false)} />
        </div>
      </AppDialog>
    </div>
  );
}
