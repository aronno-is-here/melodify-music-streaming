import mongoose from 'mongoose';

const karaokeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    artist: { type: String, required: true, trim: true },
    genre: { type: String, required: true, trim: true },
    youtube_id: { type: String, default: '' },
    file_path: { type: String, default: '' },
    poster_url: { type: String, default: 'https://picsum.photos/150/150?random' },
    duration: { type: String, default: '3:00' },
    lyrics: { type: String, default: '' },
    available: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.model('Karaoke', karaokeSchema);
