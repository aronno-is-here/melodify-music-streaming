import express from 'express';
import Like from '../models/Like.js';
import Post from '../models/Post.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/:postId', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const existing = await Like.findOne({ user: req.user._id, post: post._id });
    if (existing) {
      return res.json({ success: true, isLiked: true, likesCount: post.likesCount });
    }

    await Like.create({ user: req.user._id, post: post._id });
    await Post.findByIdAndUpdate(post._id, { $inc: { likesCount: 1 } });

    const updated = await Post.findById(post._id);
    res.json({ success: true, isLiked: true, likesCount: updated.likesCount });
  } catch (error) {
    if (error.code === 11000) {
      const post = await Post.findById(req.params.postId);
      return res.json({ success: true, isLiked: true, likesCount: post?.likesCount || 0 });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:postId', protect, async (req, res) => {
  try {
    const deleted = await Like.findOneAndDelete({ user: req.user._id, post: req.params.postId });
    if (deleted) {
      await Post.findByIdAndUpdate(req.params.postId, { $inc: { likesCount: -1 } });
    }

    const post = await Post.findById(req.params.postId);
    res.json({ success: true, isLiked: false, likesCount: post ? Math.max(0, post.likesCount) : 0 });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
