import { useEffect } from 'react';

export default function AppDialog({
  open,
  title,
  onClose,
  children,
  actions,
  width = '560px',
  labelledBy,
}) {
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="music-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="music-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ maxWidth: width }}
      >
        <div className="music-dialog-head">
          <h2 id={labelledBy} className="music-dialog-title">{title}</h2>
          <button
            type="button"
            className="music-icon-control"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <i className="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
        <div className="music-dialog-body">{children}</div>
        {actions ? <div className="music-dialog-actions">{actions}</div> : null}
      </div>
    </div>
  );
}
