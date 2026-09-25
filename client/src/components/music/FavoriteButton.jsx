export default function FavoriteButton({
  active,
  onClick,
  className = '',
  ariaLabel,
}) {
  return (
    <button
      type="button"
      className={`music-icon-control ${active ? 'is-active' : ''} ${className}`.trim()}
      aria-label={ariaLabel || (active ? 'Remove from liked songs' : 'Add to liked songs')}
      onClick={onClick}
    >
      <i className={`fa-${active ? 'solid' : 'regular'} fa-heart`} aria-hidden="true"></i>
    </button>
  );
}
