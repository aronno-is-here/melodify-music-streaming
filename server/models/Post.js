import mongoose from 'mongoose';

const postSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    song: { type: mongoose.Schema.Types.ObjectId, ref: 'Song' },
    karaoke: { type: mongoose.Schema.Types.ObjectId, ref: 'Karaoke' },
    title: { type: String, required: true, trim: true },
    caption: { type: String, default: '', maxlength: 1000 },
    audioUrl: { type: String, required: true },
    duration: { type: Number, default: 0 },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    likesCount: { type: Number, default: 0 },
    commentsCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ visibility: 1, createdAt: -1 });

export default mongoose.model('Post', postSchema);
