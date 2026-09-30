import express from 'express';
import Friendship, { FRIEND_STATUS } from '../models/Friendship.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import {
  clearFriendRequestNotifications,
  closeFriendRequestNotification,
  createNotification,
} from '../services/notificationService.js';

const router = express.Router();

export const FRIEND_STATUS_LABELS = Object.freeze({
  none: 'none',
  outgoing_pending: 'outgoing_pending',
  incoming_pending: 'incoming_pending',
  friends: 'friends',
});

const MAX_FRIEND_LIST = 100;
const MAX_REQUEST_LIST = 50;

function sameId(left, right) {
  return Boolean(left) && Boolean(right) && String(left) === String(right);
}

function projectRequest(doc) {
  if (!doc) return null;
  const requester = doc.requester && typeof doc.requester === 'object' && doc.requester.name
    ? { _id: doc.requester._id, name: doc.requester.name, avatar: doc.requester.avatar || '' }
    : doc.requester;
  const recipient = doc.recipient && typeof doc.recipient === 'object' && doc.recipient.name
    ? { _id: doc.recipient._id, name: doc.recipient.name, avatar: doc.recipient.avatar || '' }
    : doc.recipient;
  return {
    _id: doc._id,
    requester,
    recipient,
    status: doc.status,
    createdAt: doc.createdAt,
    acceptedAt: doc.acceptedAt || null,
  };
}

/**
 * Resolves the relationship between `currentId` and `otherId`.
 * A rejected request is treated as no active relationship so either side may
 * start over; only one active (pending/accepted) relationship can exist.
 */
export async function resolveFriendRelation(currentId, otherId) {
  const forward = await Friendship.findOne({ requester: currentId, recipient: otherId });
  if (forward) {
    if (forward.status === FRIEND_STATUS.ACCEPTED) {
      return { status: FRIEND_STATUS_LABELS.friends, request: forward };
    }
    if (forward.status === FRIEND_STATUS.PENDING) {
      return { status: FRIEND_STATUS_LABELS.outgoing_pending, request: forward };
    }
  }

  const reverse = await Friendship.findOne({ requester: otherId, recipient: currentId });
  if (reverse) {
    if (reverse.status === FRIEND_STATUS.ACCEPTED) {
      return { status: FRIEND_STATUS_LABELS.friends, request: reverse };
    }
    if (reverse.status === FRIEND_STATUS.PENDING) {
      return { status: FRIEND_STATUS_LABELS.incoming_pending, request: reverse };
    }
  }

  return { status: FRIEND_STATUS_LABELS.none, request: null };
}

async function loadPendingRequest(requestId, currentUserId) {
  const request = await Friendship.findById(requestId);
  if (!request) return { error: { status: 404, body: { success: false, error: 'Friend request not found' } } };
  if (!sameId(request.recipient, currentUserId)) {
    return { error: { status: 403, body: { success: false, error: 'Not authorized' } } };
  }
  if (request.status !== FRIEND_STATUS.PENDING) {
    return {
      error: {
        status: 409,
        body: {
          success: false,
          error: 'This friend request is no longer pending.',
          status: request.status === FRIEND_STATUS.ACCEPTED ? FRIEND_STATUS_LABELS.friends : 'rejected',
        },
      },
    };
  }
  return { request };
}

router.get('/status/:userId', protect, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (sameId(targetId, req.user._id)) {
      return res.json({ success: true, status: FRIEND_STATUS_LABELS.none, isSelf: true, requestId: null });
    }

    const targetUser = await User.findById(targetId).select('_id');
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

    const relation = await resolveFriendRelation(req.user._id, targetId);
    return res.json({
      success: true,
      status: relation.status,
      isSelf: false,
      requestId: relation.request ? String(relation.request._id) : null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to load friend status' });
  }
});

router.post('/request/:userId', protect, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (sameId(targetId, req.user._id)) {
      return res.status(400).json({ success: false, error: 'You cannot send a friend request to yourself.' });
    }

    const targetUser = await User.findById(targetId).select('_id');
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

    const relation = await resolveFriendRelation(req.user._id, targetId);

    if (relation.status === FRIEND_STATUS_LABELS.friends) {
      return res.status(409).json({
        success: false,
        error: 'You are already friends with this user.',
        status: FRIEND_STATUS_LABELS.friends,
        requestId: String(relation.request._id),
      });
    }

    if (relation.status === FRIEND_STATUS_LABELS.outgoing_pending) {
      return res.json({
        success: true,
        status: FRIEND_STATUS_LABELS.outgoing_pending,
        requestId: String(relation.request._id),
        duplicate: true,
      });
    }

    if (relation.status === FRIEND_STATUS_LABELS.incoming_pending) {
      return res.status(409).json({
        success: false,
        code: 'FRIEND_REQUEST_INCOMING',
        error: 'This user has already sent you a friend request.',
        status: FRIEND_STATUS_LABELS.incoming_pending,
        requestId: String(relation.request._id),
      });
    }

    const forward = await Friendship.findOne({ requester: req.user._id, recipient: targetId });

    let request;
    let reused = false;

    if (forward && forward.status === FRIEND_STATUS.REJECTED) {
      forward.status = FRIEND_STATUS.PENDING;
      forward.acceptedAt = null;
      await forward.save();
      request = forward;
      reused = true;
    } else if (forward) {
      request = forward;
    } else {
      try {
        request = await Friendship.create({
          requester: req.user._id,
          recipient: targetId,
          status: FRIEND_STATUS.PENDING,
        });
      } catch (error) {
        if (error && error.code === 11000) {
          const existing = await resolveFriendRelation(req.user._id, targetId);
          if (existing.request) {
            return res.json({
              success: true,
              status: existing.status,
              requestId: String(existing.request._id),
              duplicate: true,
            });
          }
        }
        throw error;
      }
    }

    await clearFriendRequestNotifications(request._id);
    await createNotification({
      recipient: targetId,
      actor: req.user._id,
      type: 'friend_request',
      friendRequest: request._id,
    });

    return res.json({
      success: true,
      status: FRIEND_STATUS_LABELS.outgoing_pending,
      requestId: String(request._id),
      duplicate: false,
      reused,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to send friend request' });
  }
});

router.post('/:requestId/accept', protect, async (req, res) => {
  try {
    const { request, error } = await loadPendingRequest(req.params.requestId, req.user._id);
    if (error) return res.status(error.status).json(error.body);

    const updated = await Friendship.findByIdAndUpdate(
      request._id,
      { status: FRIEND_STATUS.ACCEPTED, acceptedAt: new Date() },
      { new: true }
    );

    await closeFriendRequestNotification(request._id);
    await createNotification({
      recipient: request.requester,
      actor: req.user._id,
      type: 'friend_accepted',
      friendRequest: request._id,
    });

    return res.json({
      success: true,
      status: FRIEND_STATUS_LABELS.friends,
      requestId: String(updated ? updated._id : request._id),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to accept friend request' });
  }
});

router.post('/:requestId/reject', protect, async (req, res) => {
  try {
    const { request, error } = await loadPendingRequest(req.params.requestId, req.user._id);
    if (error) return res.status(error.status).json(error.body);

    await Friendship.findByIdAndUpdate(request._id, {
      status: FRIEND_STATUS.REJECTED,
      acceptedAt: null,
    });

    await closeFriendRequestNotification(request._id);

    return res.json({
      success: true,
      status: 'rejected',
      requestId: String(request._id),
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to reject friend request' });
  }
});

router.get('/requests', protect, async (req, res) => {
  try {
    const docs = await Friendship.find({ recipient: req.user._id, status: FRIEND_STATUS.PENDING })
      .sort({ createdAt: -1 })
      .limit(MAX_REQUEST_LIST)
      .populate('requester', 'name avatar');

    res.json({
      success: true,
      requests: docs.map(projectRequest),
      count: docs.length,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load friend requests' });
  }
});

router.get('/', protect, async (req, res) => {
  try {
    const docs = await Friendship.find({
      status: FRIEND_STATUS.ACCEPTED,
      $or: [{ requester: req.user._id }, { recipient: req.user._id }],
    })
      .sort({ acceptedAt: -1 })
      .limit(MAX_FRIEND_LIST)
      .populate('requester', 'name avatar')
      .populate('recipient', 'name avatar');

    const friends = docs.map((doc) => {
      const other = sameId(doc.requester?._id || doc.requester, req.user._id)
        ? doc.recipient
        : doc.requester;
      return {
        _id: other && other._id ? other._id : other,
        name: other && other.name ? other.name : '',
        avatar: other && other.avatar ? other.avatar : '',
        friendshipId: doc._id,
        acceptedAt: doc.acceptedAt || null,
      };
    });

    res.json({ success: true, friends, count: friends.length });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to load friends' });
  }
});

export default router;
