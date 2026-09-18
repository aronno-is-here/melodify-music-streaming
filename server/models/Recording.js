import mongoose from 'mongoose';

const recordingSchema = new mongoose.Schema(
  {
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    karaoke: { type: mongoose.Schema.Types.ObjectId, ref: 'Karaoke', required: true },
    title: { type: String, required: true, trim: true },
    caption: { type: String, default: '', maxlength: 1000 },
    audioUrl: { type: String, required: true },
    duration: { type: Number, default: 0 },
    effects: {
      type: {
        gain: { type: Number, default: 1 },
        reverb: { type: Number, default: 0 },
        echo: { type: Number, default: 0 },
        bass: { type: Number, default: 0 },
        treble: { type: Number, default: 0 },
        preset: { type: String, default: 'clean' },
      },
      default: {},
    },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    publishedAsPost: { type: Boolean, default: false },
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  },
  { timestamps: true }
);

recordingSchema.index({ author: 1, createdAt: -1 });

export default mongoose.model('Recording', recordingSchema);
