import express from 'express';
import multer from 'multer';
import User from '../models/User.js';
import Follow from '../models/Follow.js';
import Song from '../models/Song.js';
import Playlist from '../models/Playlist.js';
import { protect } from '../middleware/auth.js';
import { escapeRegex } from '../utils/escapeRegex.js';

const router = express.Router();

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    cb(null, AVATAR_MIME_TYPES.includes(file.mimetype));
  },
});

export function detectAvatarMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
  if (buffer.toString('latin1', 0, 4) === 'RIFF' && buffer.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

router.get('/search', protect, async (req, res) => {
  try {
    const q = escapeRegex(String(req.query.q || '').trim());
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    if (!q || q.length < 1) {
      return res.json({ success: true, users: [], total: 0, pages: 0 });
    }

    const filter = {
      _id: { $ne: req.user._id },
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
      ],
    };

    const [users, total] = await Promise.all([
      User.find(filter).select('name email avatar bio').skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    const userIds = users.map((u) => u._id);
    const myFollowing = await Follow.find({ follower: req.user._id, following: { $in: userIds } }).select('following');
    const followingSet = new Set(myFollowing.map((f) => String(f.following)));

    const usersWithFollowState = users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      avatar: u.avatar,
      bio: u.bio,
      isFollowing: followingSet.has(String(u._id)),
    }));

    res.json({ success: true, users: usersWithFollowState, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:userId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select('name email avatar bio libraryVisibility createdAt');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });

    const [followersCount, followingCount] = await Promise.all([
      Follow.countDocuments({ following: user._id }),
      Follow.countDocuments({ follower: user._id }),
    ]);

    const isFollowing = await Follow.findOne({ follower: req.user._id, following: user._id });
    const isOwnProfile = String(user._id) === String(req.user._id);

    let songs = [];
    if (isOwnProfile || (user.libraryVisibility === 'public' && user._id)) {
      const playlists = await Playlist.find({ user_email: user.email }).populate('items.songId');
      const songMap = new Map();
      for (const pl of playlists) {
        for (const item of pl.items) {
          if (item.songId) songMap.set(String(item.songId._id), item.songId);
        }
      }
      songs = Array.from(songMap.values());
    }

    let posts = [];
    if (isOwnProfile) {
      const Post = (await import('../models/Post.js')).default;
      posts = await Post.find({ author: user._id, visibility: { $ne: 'private' } })
        .populate('song', 'title artist poster_url')
        .sort({ createdAt: -1 })
        .limit(20);
    } else {
      const Post = (await import('../models/Post.js')).default;
      posts = await Post.find({ author: user._id, visibility: 'public' })
        .populate('song', 'title artist poster_url')
        .sort({ createdAt: -1 })
        .limit(20);
    }

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        bio: user.bio,
        libraryVisibility: user.libraryVisibility,
        createdAt: user.createdAt,
      },
      followersCount,
      followingCount,
      isFollowing: !!isFollowing,
      isOwnProfile,
      songs: isOwnProfile || user.libraryVisibility === 'public' ? songs : [],
      posts,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/me/avatar', protect, (req, res, next) => {
  avatarUpload.single('avatar')(req, res, (error) => {
    if (error) {
      const message = error.code === 'LIMIT_FILE_SIZE'
        ? 'Avatar image must be 5MB or smaller.'
        : 'Avatar must be a JPEG, PNG, or WebP image.';
      return res.status(400).json({ success: false, error: message });
    }
    return next();
  });
}, async (req, res) => {
  try {
    if (!req.file || !AVATAR_MIME_TYPES.includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, error: 'Avatar must be a JPEG, PNG, or WebP image.' });
    }
    if (detectAvatarMime(req.file.buffer) !== req.file.mimetype) {
      return res.status(400).json({ success: false, error: 'Avatar must be a JPEG, PNG, or WebP image.' });
    }
    const avatar = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    const user = await User.findByIdAndUpdate(req.user._id, { avatar }, { new: true, runValidators: true })
      .select('name email avatar bio libraryVisibility gender country dob role');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update avatar.' });
  }
});

router.put('/me/settings', protect, async (req, res) => {
  try {
    const { bio, libraryVisibility, avatar } = req.body;
    const update = {};
    if (bio !== undefined) update.bio = String(bio).slice(0, 500);
    if (libraryVisibility !== undefined && ['public', 'private'].includes(libraryVisibility)) {
      update.libraryVisibility = libraryVisibility;
    }
    if (avatar !== undefined) update.avatar = String(avatar).slice(0, 500);

    if (Object.keys(update).length === 0) {
      return res.json({ success: false, error: 'No valid fields to update.' });
    }

    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true })
      .select('name email avatar bio libraryVisibility gender country dob role');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
