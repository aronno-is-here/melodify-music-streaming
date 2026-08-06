import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import PlayHistory from '../models/PlayHistory.js';
import Song from '../models/Song.js';

const router = Router();

router.post('/', protect, async (req, res) => {
  try {
    const songId = String(req.body.songId || '');
    if (!songId) return res.json({ success: false, error: 'songId is required' });
    const song = await Song.findById(songId);
    if (!song) return res.json({ success: false, error: 'Song not found' });
    await PlayHistory.create({ user: req.user._id, song: songId });
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/', protect, async (req, res) => {
  try {
    const history = await PlayHistory.find({ user: req.user._id })
      .sort({ playedAt: -1 })
      .limit(20)
      .populate('song');
    const songs = history.map((h) => h.song).filter(Boolean);
    return res.json({ success: true, history: songs });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;