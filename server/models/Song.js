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
    release_date: { type: Date, default: '2023-01-01' },
    lyrics: { type: String, default: '' },
    chords: { type: String, default: '' },
    // Opt in to these fields in future server queries; unknown metadata stays unset.
    language: { type: String, trim: true, select: false },
    category: { type: String, trim: true, select: false },
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
    source_provider: { type: String, trim: true, select: false },
    external_id: { type: String, trim: true, select: false },
    // Missing metadata must not exclude legacy songs from future recommendations.
    recommendation_eligible: { type: Boolean, default: true, select: false },
    metadata_provenance: { type: metadataProvenanceSchema, select: false },
    metadata_refreshed_at: { type: Date, select: false },
  },
  { timestamps: true }
);

export default mongoose.model('Song', songSchema);
