import mongoose from 'mongoose';

const metadataProvenanceSchema = new mongoose.Schema(
  {
    source: { type: String, trim: true, maxlength: 128 },
    reference: { type: String, trim: true, maxlength: 256 },
    imported_at: { type: Date },
  },
  { _id: false, strict: true }
);

const songSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    artist: { type: String, required: true },
    genre: { type: String, required: true },
    youtube_id: { type: String, default: '' },
    file_path: { type: String, default: '' },
    poster_url: { type: String, default: 'https://picsum.photos/150/150?random' },
    duration: { type: String, default: '3:00' },
    album: { type: String, default: '' },
    release_date: { type: Date, default: '2023-01-01' },
    lyrics: { type: String, default: '' },
    chords: { type: String, default: '' },
    lyrics_source: { type: String, trim: true, maxlength: 64 },
    lyrics_verified: { type: Boolean, default: false },
    lyrics_provider_id: { type: String, trim: true, maxlength: 256 },
    lyrics_last_checked_at: { type: Date },
    lyrics_language: { type: String, trim: true, maxlength: 64 },
    lyrics_match_status: { type: String, trim: true, maxlength: 32 },
    chords_source: { type: String, trim: true, maxlength: 64 },
    chords_verified: { type: Boolean, default: false },
    chords_provider_id: { type: String, trim: true, maxlength: 256 },
    chords_last_checked_at: { type: Date },
    chordify_url: { type: String, trim: true, maxlength: 1024 },
    chordify_embed_url: { type: String, trim: true, maxlength: 1024 },
    chords_reference_url: { type: String, trim: true, maxlength: 1024 },
    // Opt in to these fields in future server queries; unknown metadata stays unset.
    language: { type: String, trim: true, maxlength: 16, select: false },
    category: { type: String, trim: true, select: false },
    regional_tag: { type: String, trim: true, maxlength: 16 },
    duration_seconds: {
      type: Number,
      select: false,
      validate: {
        validator: (value) => value == null || (Number.isFinite(value) && value >= 0),
        message: 'duration_seconds must be a finite non-negative number',
      },
    },
    normalized_artist: { type: String, trim: true, select: false },
    normalized_genre: { type: String, trim: true, select: false },
    source_provider: { type: String, trim: true, maxlength: 64, select: false },
    external_id: { type: String, trim: true, maxlength: 256, select: false },
    // Missing metadata must not exclude legacy songs from future recommendations.
    recommendation_eligible: { type: Boolean, default: true, select: false },
    metadata_provenance: { type: metadataProvenanceSchema, select: false },
    metadata_refreshed_at: { type: Date, select: false },
  },
  { timestamps: true }
);

// Only explicit, non-empty identities participate; legacy songs stay outside uniqueness.
songSchema.index(
  { source_provider: 1, external_id: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source_provider: { $type: 'string', $gt: '' },
      external_id: { $type: 'string', $gt: '' },
    },
  }
);

songSchema.index(
  { youtube_id: 1 },
  {
    unique: false,
    partialFilterExpression: { youtube_id: { $type: 'string', $gt: '' } },
  }
);

export default mongoose.model('Song', songSchema);
