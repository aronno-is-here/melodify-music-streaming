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
      onClick={(event) => {
        event.stopPropagation();
        if (typeof onClick === 'function') onClick(event);
      }}
    >
      <i className={`fa-${active ? 'solid' : 'regular'} fa-heart`} aria-hidden="true"></i>
    </button>
  );
}
