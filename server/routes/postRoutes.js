import express from 'express';
import Post from '../models/Post.js';
import Like from '../models/Like.js';
import Comment from '../models/Comment.js';
import Song from '../models/Song.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const filter = { visibility: 'public' };
    if (req.query.author) filter.author = req.query.author;

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .populate('author', 'name email avatar')
        .populate('song', 'title artist poster_url youtube_id')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Post.countDocuments(filter),
    ]);

    const postIds = posts.map((p) => p._id);
    const myLikes = await Like.find({ user: req.user._id, post: { $in: postIds } }).select('post');
    const likedSet = new Set(myLikes.map((l) => String(l.post)));

    const postsWithState = posts.map((p) => ({
      _id: p._id,
      author: p.author,
      song: p.song,
      title: p.title,
      caption: p.caption,
      audioUrl: p.audioUrl,
      duration: p.duration,
      visibility: p.visibility,
      likesCount: p.likesCount,
      commentsCount: p.commentsCount,
      createdAt: p.createdAt,
      isLiked: likedSet.has(String(p._id)),
    }));

    res.json({ success: true, posts: postsWithState, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:postId', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId)
      .populate('author', 'name email avatar')
      .populate('song', 'title artist poster_url youtube_id');

    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });
    if (post.visibility === 'private' && String(post.author._id) !== String(req.user._id)) {
      return res.status(404).json({ success: false, error: 'Post not found' });
    }

    const isLiked = await Like.findOne({ user: req.user._id, post: post._id });

    res.json({
      success: true,
      post: {
        ...post.toObject(),
        isLiked: !!isLiked,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const { songId, title, caption, audioUrl, duration, visibility } = req.body;

    if (!songId || !title || !audioUrl) {
      return res.json({ success: false, error: 'Song, title, and audio are required.' });
    }

    const song = await Song.findById(songId);
    if (!song) return res.json({ success: false, error: 'Song not found.' });

    const post = await Post.create({
      author: req.user._id,
      song: songId,
      title: String(title).slice(0, 200),
      caption: String(caption || '').slice(0, 1000),
      audioUrl,
      duration: duration || 0,
      visibility: ['public', 'private'].includes(visibility) ? visibility : 'public',
    });

    const populated = await Post.findById(post._id)
      .populate('author', 'name email avatar')
      .populate('song', 'title artist poster_url youtube_id');

    res.json({ success: true, post: populated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:postId', protect, async (req, res) => {
  try {
    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ success: false, error: 'Post not found' });

    const isAdmin = req.user.role === 'admin';
    const isOwner = String(post.author) === String(req.user._id);
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    await Post.findByIdAndDelete(post._id);
    await Like.deleteMany({ post: post._id });
    await Comment.deleteMany({ post: post._id });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
