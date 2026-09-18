import express from 'express';
import Karaoke from '../models/Karaoke.js';
import { protect, adminOnly } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { escapeRegex } from '../utils/escapeRegex.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const q = req.query.q ? escapeRegex(String(req.query.q).trim()) : '';
    const query = { available: true };
    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { artist: { $regex: q, $options: 'i' } },
      ];
    }
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const skip = (page - 1) * limit;
    const [karaoke, total] = await Promise.all([
      Karaoke.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Karaoke.countDocuments(query),
    ]);
    res.json({ success: true, karaoke, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/all', protect, adminOnly, async (req, res) => {
  try {
    const karaoke = await Karaoke.find().sort({ createdAt: -1 });
    res.json({ success: true, karaoke });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const k = await Karaoke.findById(req.params.id);
    if (!k) return res.status(404).json({ success: false, error: 'Karaoke track not found' });
    res.json({ success: true, karaoke: k });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { title, artist, genre, duration, youtube_id, poster_url, lyrics } = req.body;
    if (!title || !artist || !genre) {
      return res.json({ success: false, error: 'Title, artist, and genre are required' });
    }
    const k = await Karaoke.create({
      title,
      artist,
      genre,
      duration: duration || '3:00',
      youtube_id: youtube_id || '',
      poster_url: poster_url || (youtube_id ? `https://img.youtube.com/vi/${youtube_id}/hqdefault.jpg` : 'https://picsum.photos/150/150?random'),
      lyrics: lyrics || '',
    });
    res.json({ success: true, message: 'Karaoke track created', karaoke: k });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/upload', protect, adminOnly, upload.fields([
  { name: 'audio_file', maxCount: 1 },
  { name: 'poster_file', maxCount: 1 },
]), async (req, res) => {
  try {
    const { title, artist, genre, duration = '3:00' } = req.body;
    if (!title || !artist || !genre) {
      return res.json({ success: false, error: 'Title, artist, and genre are required' });
    }
    if (!req.files?.audio_file) {
      return res.json({ success: false, error: 'Audio file is required for karaoke upload' });
    }
    const audioFilename = req.files.audio_file[0].filename;
    const posterFilename = req.files.poster_file?.[0]?.filename;
    const k = await Karaoke.create({
      title,
      artist,
      genre,
      duration,
      file_path: `assets/songs/uploads/${audioFilename}`,
      poster_url: posterFilename ? `assets/posters/${posterFilename}` : 'https://picsum.photos/150/150?random',
    });
    res.json({ success: true, message: 'Karaoke track uploaded', karaoke: k });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const { title, artist, genre, duration, lyrics, available } = req.body;
    const update = {};
    if (title !== undefined) update.title = title;
    if (artist !== undefined) update.artist = artist;
    if (genre !== undefined) update.genre = genre;
    if (duration !== undefined) update.duration = duration;
    if (lyrics !== undefined) update.lyrics = lyrics;
    if (available !== undefined) update.available = available;
    const k = await Karaoke.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!k) return res.status(404).json({ success: false, error: 'Karaoke track not found' });
    res.json({ success: true, karaoke: k });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const k = await Karaoke.findByIdAndDelete(req.params.id);
    if (!k) return res.status(404).json({ success: false, error: 'Karaoke track not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
