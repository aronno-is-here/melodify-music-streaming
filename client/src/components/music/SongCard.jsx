import PlayButton from './PlayButton.jsx';
import FavoriteButton from './FavoriteButton.jsx';

const DEFAULT_POSTER = 'https://picsum.photos/300/300?random';

export default function SongCard({
  song,
  isPlaying,
  isActive,
  isFavorited,
  onPlay,
  onToggleFavorite,
}) {
  return (
    <article className="music-song-card">
      <img
        className="music-song-art"
        src={song.poster_url || DEFAULT_POSTER}
        alt={`${song.title} artwork`}
        onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
      />
      <div className="music-song-meta">
        <div className="music-song-title">{song.title}</div>
        <div className="music-song-artist">{song.artist}</div>
      </div>
      <div className="music-card-actions">
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
