import mongoose from 'mongoose';

export const FRIEND_STATUS = Object.freeze({
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
});

export const FRIEND_STATUS_VALUES = Object.freeze([
  FRIEND_STATUS.PENDING,
  FRIEND_STATUS.ACCEPTED,
  FRIEND_STATUS.REJECTED,
]);

export function buildFriendshipPairKey(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

const friendshipSchema = new mongoose.Schema(
  {
    requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: FRIEND_STATUS_VALUES, default: FRIEND_STATUS.PENDING },
    pair: { type: String, required: true },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false }
);

friendshipSchema.pre('validate', function assignCanonicalPair(next) {
  if (this.requester && this.recipient) {
    this.pair = buildFriendshipPairKey(this.requester, this.recipient);
  }
  next();
});

friendshipSchema.index({ requester: 1, recipient: 1 }, { unique: true });
friendshipSchema.index(
  { pair: 1 },
  { unique: true, name: 'pair_pending_unique', partialFilterExpression: { status: FRIEND_STATUS.PENDING } }
);
friendshipSchema.index({ recipient: 1, status: 1, createdAt: -1 });
friendshipSchema.index({ requester: 1, status: 1 });
friendshipSchema.index({ pair: 1, status: 1 });

export default mongoose.model('Friendship', friendshipSchema);
