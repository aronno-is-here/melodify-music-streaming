import mongoose from 'mongoose';

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
  },
  { timestamps: true }
);

export default mongoose.model('Song', songSchema);
