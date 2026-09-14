import express from 'express';
import Favorite from '../models/Favorite.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, async (req, res) => {
  try {
    const favorites = await Favorite.find({ user: req.user._id }).populate('song').sort({ createdAt: -1 });
    res.json({ success: true, favorites: favorites.map((f) => f.song).filter(Boolean) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/ids', protect, async (req, res) => {
  try {
    const favorites = await Favorite.find({ user: req.user._id }).select('song');
    res.json({ success: true, ids: favorites.map((f) => String(f.song)) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:songId', protect, async (req, res) => {
  try {
    const existing = await Favorite.findOne({ user: req.user._id, song: req.params.songId });
    if (existing) {
      return res.json({ success: true, message: 'Already in favorites' });
    }
    await Favorite.create({ user: req.user._id, song: req.params.songId });
    res.json({ success: true, message: 'Added to favorites' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:songId', protect, async (req, res) => {
  try {
    await Favorite.findOneAndDelete({ user: req.user._id, song: req.params.songId });
    res.json({ success: true, message: 'Removed from favorites' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
