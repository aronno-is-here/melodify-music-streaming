import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Song from '../models/Song.js';
import { protect } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();

const assetsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

router.get('/', async (req, res) => {
  try {
    const query = {};
    if (req.query.q) {
      const q = String(req.query.q).trim();
      if (q) query.$or = [{ title: { $regex: q, $options: 'i' } }, { artist: { $regex: q, $options: 'i' } }];
    }
    const songs = await Song.find(query).sort({ createdAt: -1 }).limit(parseInt(req.query.limit || '100', 10));
    const result = songs.map((s) => {
      const posterPath = path.join(assetsRoot, 'posters', path.basename(s.poster_url || ''));
      if (s.poster_url && !s.poster_url.startsWith('http') && !fs.existsSync(posterPath)) {
        return { ...s.toObject(), poster_url: 'assets/posters/default_poster.jpg' };
      }
      return s.toObject();
    });
    res.json({ success: true, songs: result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/upload', protect, upload.fields([{ name: 'song_file', maxCount: 1 }, { name: 'poster_file', maxCount: 1 }]), async (req, res) => {
  try {
    const { title, artist, genre, duration = '3:00', release_date = '2023-01-01' } = req.body;
    if (!title || !artist || !genre) {
      return res.json({ success: false, error: 'Title, artist, and genre are required' });
    }
    if (!req.files?.song_file) {
      return res.json({ success: false, error: 'Invalid song file format' });
    }
    const songFilename = req.files?.song_file?.[0]?.filename ?? null;
    const posterFilename = req.files?.poster_file?.[0]?.filename ?? null;
    const song = await Song.create({
      title,
      artist,
      genre,
      file_path: `assets/songs/uploads/${songFilename}`,
      poster_url: posterFilename ? `assets/posters/${posterFilename}` : 'https://picsum.photos/150/150?random',
      duration,
      release_date,
    });
    res.json({ success: true, message: 'Song uploaded successfully', song });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;