import { Link, useNavigate } from 'react-router-dom';
import PlayButton from './PlayButton.jsx';
import FavoriteButton from './FavoriteButton.jsx';

const DEFAULT_POSTER = 'https://picsum.photos/120/120?random';

const songDetailsPath = (song) => (
  song?._id && song?.sourceType !== 'external' ? `/song/${song._id}` : null
);

export default function SongRow({
  song,
  subtitle,
  isPlaying,
  isActive,
  isFavorited,
  onPlay,
  onToggleFavorite,
  trailing,
}) {
  const navigate = useNavigate();
  const detailsPath = songDetailsPath(song);
  const meta = (
    <div className="music-row-meta">
      <div className="music-row-title">{song.title}</div>
      <div className="music-row-sub">{subtitle || song.artist}</div>
    </div>
  );

  return (
    <div
      className="music-song-row"
      onClick={() => {
        if (detailsPath) navigate(detailsPath);
      }}
    >
      <img
        className="music-song-row-art"
        src={song.poster_url || DEFAULT_POSTER}
        alt=""
        onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
      />
      {detailsPath ? (
        <Link
          to={detailsPath}
          className="music-row-open"
          aria-label={`View details for ${song.title}`}
          onClick={(event) => event.stopPropagation()}
        >
          {meta}
        </Link>
      ) : (
        meta
      )}
      <div
        className="music-row-actions"
        style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        onClick={(event) => event.stopPropagation()}
      >
        {trailing || null}
        <FavoriteButton
          active={isFavorited}
          onClick={onToggleFavorite}
          ariaLabel={isFavorited ? `Remove ${song.title} from liked songs` : `Add ${song.title} to liked songs`}
        />
        <PlayButton
          isPlaying={isActive && isPlaying}
          onClick={onPlay}
          ariaLabel={isActive && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
        />
      </div>
    </div>
  );
}
