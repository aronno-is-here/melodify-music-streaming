import mongoose from 'mongoose';

const songSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    artist: { type: String, required: true },
    genre: { type: String, required: true },
    file_path: { type: String, required: true },
    poster_url: { type: String, default: 'https://picsum.photos/150/150?random' },
    duration: { type: String, default: '3:00' },
    release_date: { type: Date, default: '2023-01-01' },
  },
  { timestamps: true }
);

export default mongoose.model('Song', songSchema);