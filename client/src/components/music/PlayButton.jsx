export default function PlayButton({
  isPlaying,
  onClick,
  className = '',
  ariaLabel,
}) {
  return (
    <button
      type="button"
      className={`music-icon-control ${className}`.trim()}
      aria-label={ariaLabel || (isPlaying ? 'Pause song' : 'Play song')}
      onClick={onClick}
    >
      <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`} aria-hidden="true"></i>
    </button>
  );
}
