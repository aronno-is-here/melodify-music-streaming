export const PLAYBACK_STATUS_MESSAGES = Object.freeze({
  loading: 'Loading…',
  blocked: 'Tap to play',
  error: 'Unable to play this song.',
});

export const PLAYBACK_RETRY_LABEL = 'Retry';
export const PLAYBACK_RETRY_ARIA_LABEL = 'Retry playback';

const RETRY_STATUSES = new Set(['blocked', 'error']);

export function selectPlaybackStatusPresentation({ playbackStatus, hasSong } = {}) {
  if (!playbackStatus || typeof playbackStatus !== 'string') {
    throw new TypeError('playbackStatus must be a string');
  }
  const message = Object.prototype.hasOwnProperty.call(PLAYBACK_STATUS_MESSAGES, playbackStatus)
    ? PLAYBACK_STATUS_MESSAGES[playbackStatus]
    : null;
  if (!hasSong || !message) {
    return {
      visible: false,
      message: null,
      showRetry: false,
      retryLabel: PLAYBACK_RETRY_LABEL,
      retryAriaLabel: PLAYBACK_RETRY_ARIA_LABEL,
    };
  }
  return {
    visible: true,
    message,
    showRetry: RETRY_STATUSES.has(playbackStatus),
    retryLabel: PLAYBACK_RETRY_LABEL,
    retryAriaLabel: PLAYBACK_RETRY_ARIA_LABEL,
  };
}
