import mongoose from 'mongoose';

const playlistSchema = new mongoose.Schema(
  {
    user_email: { type: String, required: true },
    title: { type: String, required: true },
    songIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Song' }],
  },
  { timestamps: true }
);

export default mongoose.model('Playlist', playlistSchema);