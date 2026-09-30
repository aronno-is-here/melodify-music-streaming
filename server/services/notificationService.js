import Notification from '../models/Notification.js';
import { buildNotificationDedupKey } from '../models/Notification.js';

export const NOTIFICATION_SELF_ACTION_ERROR = 'You cannot notify yourself about your own action.';

function sameId(left, right) {
  return Boolean(left) && Boolean(right) && String(left) === String(right);
}

function sanitizeReference(value) {
  if (!value) return null;
  return value;
}

/**
 * Creates a notification for `recipient` caused by `actor`.
 *
 * Rules:
 * - never notifies a user about their own action
 * - never throws: notification failures must not break the triggering action
 * - idempotent for `post_like` / `post_share` via the deterministic dedup key
 */
export async function createNotification({
  recipient,
  actor,
  type,
  post = null,
  friendRequest = null,
  comment = null,
} = {}) {
  if (!recipient || !actor || !type) return null;
  if (sameId(recipient, actor)) return null;

  const dedupKey = buildNotificationDedupKey({ type, recipient, actor, post });

  try {
    return await Notification.create({
      recipient: sanitizeReference(recipient),
      actor: sanitizeReference(actor),
      type,
      post: sanitizeReference(post),
      friendRequest: sanitizeReference(friendRequest),
      comment: sanitizeReference(comment),
      dedupKey,
      read: false,
    });
  } catch (error) {
    if (error && (error.code === 11000 || error.name === 'MongoServerError')) {
      return null;
    }
    return null;
  }
}

/**
 * Removes any stale friend-request notifications that belong to a friendship
 * document before a fresh `friend_request` notification is written (used when a
 * previously rejected request is sent again).
 */
export async function clearFriendRequestNotifications(friendRequestId) {
  if (!friendRequestId) return null;
  try {
    return await Notification.deleteMany({ friendRequest: friendRequestId, type: 'friend_request' });
  } catch (error) {
    return null;
  }
}

/**
 * Removes the original `friend_request` notification once the request leaves the
 * pending state (accepted or rejected) so the panel can never show stale actions.
 */
export async function closeFriendRequestNotification(friendRequestId) {
  return clearFriendRequestNotifications(friendRequestId);
}
