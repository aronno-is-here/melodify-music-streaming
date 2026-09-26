import { Link, useNavigate } from 'react-router-dom';
import PlayButton from './PlayButton.jsx';
import FavoriteButton from './FavoriteButton.jsx';

const DEFAULT_POSTER = 'https://picsum.photos/300/300?random';

const songDetailsPath = (song) => (
  song?._id && song?.sourceType !== 'external' ? `/song/${song._id}` : null
);

export default function SongCard({
  song,
  isPlaying,
  isActive,
  isFavorited,
  onPlay,
  onToggleFavorite,
}) {
  const navigate = useNavigate();
  const detailsPath = songDetailsPath(song);
  const artwork = (
    <img
      className="music-song-art"
      src={song.poster_url || DEFAULT_POSTER}
      alt={`${song.title} artwork`}
      onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
    />
  );
  const meta = (
    <div className="music-song-meta">
      <div className="music-song-title">{song.title}</div>
      <div className="music-song-artist">{song.artist}</div>
    </div>
  );

  return (
    <article
      className="music-song-card"
      onClick={() => {
        if (detailsPath) navigate(detailsPath);
      }}
    >
      {detailsPath ? (
        <Link
          to={detailsPath}
          className="music-song-open"
          aria-label={`View details for ${song.title}`}
          onClick={(event) => event.stopPropagation()}
        >
          {artwork}
          {meta}
        </Link>
      ) : (
        <div className="music-song-open">
          {artwork}
          {meta}
        </div>
      )}
      <div className="music-card-actions" onClick={(event) => event.stopPropagation()}>
        <PlayButton
          isPlaying={isActive && isPlaying}
          onClick={onPlay}
          ariaLabel={isActive && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
        />
        <FavoriteButton
          active={isFavorited}
          onClick={onToggleFavorite}
          ariaLabel={isFavorited ? `Remove ${song.title} from liked songs` : `Add ${song.title} to liked songs`}
        />
      </div>
    </article>
  );
}
