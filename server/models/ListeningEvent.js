import mongoose from 'mongoose';

export const LISTENING_EVENT_TYPES = Object.freeze([
  'play-started',
  'progress',
  'paused',
  'resumed',
  'seeked',
  'completed',
  'skipped',
  'stopped',
  'replay-started',
]);

export const LISTENING_TRANSITION_REASONS = Object.freeze([
  'manual-next',
  'manual-previous',
  'new-selection',
  'track-ended',
  'repeat',
  'route-change',
  'logout',
  'player-error',
  'unknown',
]);

export const LISTENING_PLAYBACK_SOURCES = Object.freeze([
  'dashboard',
  'homepage',
  'playlist',
  'song-details',
  'user-profile',
  'unknown',
]);

export const MAX_PLAYBACK_SECONDS = 86400;
export const MAX_LISTENED_DELTA_SECONDS = 120;
export const MAX_SEQUENCE = 1000000;
export const MAX_SESSION_ID_LENGTH = 128;
export const MAX_EVENT_ID_LENGTH = 128;

const isNonEmptyTrimmedString = (maxLength) => (value) =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;

const isBoundedFiniteNumber = (value, { min, max, exclusiveMin = false }) => {
  if (!Number.isFinite(value)) return false;
  if (exclusiveMin ? value <= min : value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
};

const optionalBoundedNumber = (bounds, message) => ({
  type: Number,
  validate: {
    validator: (value) => value == null || isBoundedFiniteNumber(value, bounds),
    message,
  },
});

const listeningEventSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    song: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
    session_id: {
      type: String,
      trim: true,
      required: true,
      maxlength: MAX_SESSION_ID_LENGTH,
      validate: {
        validator: isNonEmptyTrimmedString(MAX_SESSION_ID_LENGTH),
        message: 'session_id must be a non-empty bounded string',
      },
    },
    event_id: {
      type: String,
      trim: true,
      required: true,
      maxlength: MAX_EVENT_ID_LENGTH,
      validate: {
        validator: isNonEmptyTrimmedString(MAX_EVENT_ID_LENGTH),
        message: 'event_id must be a non-empty bounded string',
      },
    },
    sequence: {
      type: Number,
      required: true,
      validate: {
        validator: (value) =>
          Number.isInteger(value) && value >= 0 && value <= MAX_SEQUENCE,
        message: `sequence must be an integer between 0 and ${MAX_SEQUENCE}`,
      },
    },
    event_type: {
      type: String,
      required: true,
      enum: LISTENING_EVENT_TYPES,
    },
    position_seconds: optionalBoundedNumber(
      { min: 0, max: MAX_PLAYBACK_SECONDS },
      `position_seconds must be a finite number between 0 and ${MAX_PLAYBACK_SECONDS}`,
    ),
    duration_seconds: optionalBoundedNumber(
      { min: 0, max: MAX_PLAYBACK_SECONDS, exclusiveMin: true },
      `duration_seconds must be a finite number greater than 0 and at most ${MAX_PLAYBACK_SECONDS}`,
    ),
    listened_seconds_delta: optionalBoundedNumber(
      { min: 0, max: MAX_LISTENED_DELTA_SECONDS },
      `listened_seconds_delta must be a finite number between 0 and ${MAX_LISTENED_DELTA_SECONDS}`,
    ),
    client_occurred_at: {
      type: Date,
      default: undefined,
      validate: {
        validator: (value) =>
          value == null || (value instanceof Date && !Number.isNaN(value.getTime())),
        message: 'client_occurred_at must be a valid date when supplied',
      },
    },
    transition_reason: {
      type: String,
      enum: LISTENING_TRANSITION_REASONS,
      default: undefined,
    },
    seek_from_seconds: optionalBoundedNumber(
      { min: 0, max: MAX_PLAYBACK_SECONDS },
      `seek_from_seconds must be a finite number between 0 and ${MAX_PLAYBACK_SECONDS}`,
    ),
    seek_to_seconds: optionalBoundedNumber(
      { min: 0, max: MAX_PLAYBACK_SECONDS },
      `seek_to_seconds must be a finite number between 0 and ${MAX_PLAYBACK_SECONDS}`,
    ),
    playback_source: {
      type: String,
      enum: LISTENING_PLAYBACK_SOURCES,
      default: undefined,
    },
  },
  { timestamps: true },
);

listeningEventSchema.index({ user: 1, event_id: 1 }, { unique: true });
listeningEventSchema.index({ user: 1, session_id: 1, sequence: 1 }, { unique: true });
listeningEventSchema.index({ user: 1, createdAt: -1 });
listeningEventSchema.index({ song: 1, createdAt: -1 });

export default mongoose.model('ListeningEvent', listeningEventSchema);
