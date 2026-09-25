import PlayButton from './PlayButton.jsx';
import FavoriteButton from './FavoriteButton.jsx';

const DEFAULT_POSTER = 'https://picsum.photos/120/120?random';

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
  return (
    <div className="music-song-row">
      <img
        className="music-song-row-art"
        src={song.poster_url || DEFAULT_POSTER}
        alt=""
        onError={(event) => { event.currentTarget.src = DEFAULT_POSTER; }}
      />
      <div className="music-row-meta">
        <div className="music-row-title">{song.title}</div>
        <div className="music-row-sub">{subtitle || song.artist}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
