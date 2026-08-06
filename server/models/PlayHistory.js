import mongoose from 'mongoose';

const playHistorySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    song: { type: mongoose.Schema.Types.ObjectId, ref: 'Song', required: true },
    playedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

playHistorySchema.index({ user: 1, playedAt: -1 });

export default mongoose.model('PlayHistory', playHistorySchema);
