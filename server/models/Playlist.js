import mongoose from 'mongoose';

const playlistItemSchema = new mongoose.Schema(
  {
    songId: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const playlistSchema = new mongoose.Schema(
  {
    user_email: { type: String, required: true },
    title: { type: String, required: true },
    items: [playlistItemSchema],
  },
  { timestamps: true }
);

export default mongoose.model('Playlist', playlistSchema);
