import mongoose from 'mongoose';

export const NOTIFICATION_TYPES = Object.freeze([
  'friend_request',
  'friend_accepted',
  'post_like',
  'post_comment',
  'post_share',
]);

export const NOTIFICATION_TYPE_SET = Object.freeze(new Set(NOTIFICATION_TYPES));

export function buildNotificationDedupKey({ type, recipient, actor, post }) {
  if (type !== 'post_like' && type !== 'post_share') return null;
  if (!recipient || !actor || !post) return null;
  return `${type}:${String(recipient)}:${String(actor)}:${String(post)}`;
}

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    read: { type: Boolean, default: false },
    post: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
    friendRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'Friendship', default: null },
    comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    dedupKey: { type: String, default: null },
  },
  { timestamps: true, versionKey: false }
);

notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });
notificationSchema.index(
  { dedupKey: 1 },
  {
    unique: true,
    name: 'notification_dedup_unique',
    partialFilterExpression: { dedupKey: { $exists: true } },
  }
);

export default mongoose.model('Notification', notificationSchema);
