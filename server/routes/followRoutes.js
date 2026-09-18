import express from 'express';
import Follow from '../models/Follow.js';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/:userId', protect, async (req, res) => {
  try {
    const targetId = req.params.userId;
    if (String(targetId) === String(req.user._id)) {
      return res.json({ success: false, error: 'You cannot follow yourself.' });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) return res.status(404).json({ success: false, error: 'User not found' });

    const existing = await Follow.findOne({ follower: req.user._id, following: targetId });
    if (existing) {
      return res.json({ success: true, message: 'Already following', isFollowing: true });
    }

    await Follow.create({ follower: req.user._id, following: targetId });

    const [followersCount, followingCount] = await Promise.all([
      Follow.countDocuments({ following: targetId }),
      Follow.countDocuments({ follower: targetId }),
    ]);

    res.json({ success: true, isFollowing: true, followersCount, followingCount });
  } catch (error) {
    if (error.code === 11000) {
      return res.json({ success: true, message: 'Already following', isFollowing: true });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:userId', protect, async (req, res) => {
  try {
    const targetId = req.params.userId;
    await Follow.findOneAndDelete({ follower: req.user._id, following: targetId });

    const [followersCount, followingCount] = await Promise.all([
      Follow.countDocuments({ following: targetId }),
      Follow.countDocuments({ follower: targetId }),
    ]);

    res.json({ success: true, isFollowing: false, followersCount, followingCount });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:userId/followers', protect, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const follows = await Follow.find({ following: req.params.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('follower', 'name email avatar bio');

    const total = await Follow.countDocuments({ following: req.params.userId });
    const followerIds = follows.map((f) => f.follower?._id).filter(Boolean);

    const myFollowing = await Follow.find({ follower: req.user._id, following: { $in: followerIds } }).select('following');
    const followingSet = new Set(myFollowing.map((f) => String(f.following)));

    const users = follows.map((f) => ({
      _id: f.follower._id,
      name: f.follower.name,
      email: f.follower.email,
      avatar: f.follower.avatar,
      bio: f.follower.bio,
      isFollowing: followingSet.has(String(f.follower._id)),
    }));

    res.json({ success: true, users, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:userId/following', protect, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const follows = await Follow.find({ follower: req.params.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('following', 'name email avatar bio');

    const total = await Follow.countDocuments({ follower: req.params.userId });
    const followingIds = follows.map((f) => f.following?._id).filter(Boolean);

    const myFollowing = await Follow.find({ follower: req.user._id, following: { $in: followingIds } }).select('following');
    const followingSet = new Set(myFollowing.map((f) => String(f.following)));

    const users = follows.map((f) => ({
      _id: f.following._id,
      name: f.following.name,
      email: f.following.email,
      avatar: f.following.avatar,
      bio: f.following.bio,
      isFollowing: followingSet.has(String(f.following._id)),
    }));

    res.json({ success: true, users, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
