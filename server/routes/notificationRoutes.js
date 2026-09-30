import express from 'express';
import Notification from '../models/Notification.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

export const DEFAULT_NOTIFICATION_LIMIT = 20;
export const MAX_NOTIFICATION_LIMIT = 50;
export const NOTIFICATION_SOURCE = 'notifications';

const SAFE_ACTOR_FIELDS = 'name avatar';
const SAFE_POST_FIELDS = 'title';
const SAFE_COMMENT_FIELDS = 'text';

function parseLimit(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_NOTIFICATION_LIMIT;
  if (Array.isArray(raw)) return NaN;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return NaN;
  return Math.min(MAX_NOTIFICATION_LIMIT, value);
}

export function projectNotification(doc) {
  if (!doc) return null;
  const actor = doc.actor && typeof doc.actor === 'object' && !Array.isArray(doc.actor) && (doc.actor._id || doc.actor.name)
    ? { _id: doc.actor._id, name: doc.actor.name || '', avatar: doc.actor.avatar || '' }
    : doc.actor;
  const post = doc.post && typeof doc.post === 'object' && !Array.isArray(doc.post) && doc.post._id
    ? { _id: doc.post._id, title: doc.post.title || '' }
    : doc.post;
  const comment = doc.comment && typeof doc.comment === 'object' && !Array.isArray(doc.comment) && doc.comment._id
    ? { _id: doc.comment._id, text: doc.comment.text || '' }
    : doc.comment;
  const friendRequest = doc.friendRequest && typeof doc.friendRequest === 'object' && !Array.isArray(doc.friendRequest)
    && doc.friendRequest._id
    ? { _id: doc.friendRequest._id, status: doc.friendRequest.status || null }
    : doc.friendRequest;

  return {
    _id: doc._id,
    recipient: doc.recipient,
    actor,
    type: doc.type,
    read: Boolean(doc.read),
    post,
    friendRequest,
    comment,
    createdAt: doc.createdAt,
  };
}

async function loadOwnNotification(id, userId) {
  const notification = await Notification.findById(id);
  if (!notification) return { error: { status: 404, body: { success: false, error: 'Notification not found' } } };
  if (String(notification.recipient) !== String(userId)) {
    return { error: { status: 403, body: { success: false, error: 'Not authorized' } } };
  }
  return { notification };
}

router.get('/', protect, async (req, res) => {
  try {
    const limit = parseLimit(req.query.limit);
    if (Number.isNaN(limit)) {
      return res.status(400).json({ success: false, error: 'Invalid notification limit' });
    }

    const docs = await Notification.find({ recipient: req.user._id })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .populate('actor', SAFE_ACTOR_FIELDS)
      .populate('post', SAFE_POST_FIELDS)
      .populate('comment', SAFE_COMMENT_FIELDS);

    return res.json({
      success: true,
      source: NOTIFICATION_SOURCE,
      notifications: docs.map(projectNotification),
      count: docs.length,
      limit,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load notifications' });
  }
});

router.get('/unread-count', protect, async (req, res) => {
  try {
    const count = await Notification.countDocuments({ recipient: req.user._id, read: false });
    return res.json({ success: true, count });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load unread count' });
  }
});

router.patch('/read-all', protect, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { $set: { read: true } }
    );
    const modified = result && typeof result.modifiedCount === 'number' ? result.modifiedCount : 0;
    return res.json({ success: true, count: 0, modified });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to mark notifications read' });
  }
});

router.patch('/:id/read', protect, async (req, res) => {
  try {
    const { notification, error } = await loadOwnNotification(req.params.id, req.user._id);
    if (error) return res.status(error.status).json(error.body);

    if (!notification.read) {
      notification.read = true;
      await notification.save();
    }

    return res.json({ success: true, notification: projectNotification(notification) });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to mark notification read' });
  }
});

export default router;
