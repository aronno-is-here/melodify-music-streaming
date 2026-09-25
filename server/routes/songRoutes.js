import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Song from '../models/Song.js';
import { protect, adminOnly } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';

const router = express.Router();
const assetsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets');

import { escapeRegex } from '../utils/escapeRegex.js';

router.get('/', async (req, res) => {
  try {
    const query = {};
    if (req.query.q) {
      const q = escapeRegex(String(req.query.q).trim());
      if (q) query.$or = [{ title: { $regex: q, $options: 'i' } }, { artist: { $regex: q, $options: 'i' } }];
    }
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
    const skip = (page - 1) * limit;
    const [songs, total] = await Promise.all([
      Song.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Song.countDocuments(query),
    ]);
    const result = songs.map((s) => {
      const posterPath = path.join(assetsRoot, 'posters', path.basename(s.poster_url || ''));
      if (s.poster_url && !s.poster_url.startsWith('http') && !fs.existsSync(posterPath)) {
        return { ...s.toObject(), poster_url: 'assets/posters/default_poster.jpg' };
      }
      return s.toObject();
    });
    res.json({ success: true, songs: result, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const song = await Song.findById(req.params.id);
    if (!song) return res.status(404).json({ success: false, error: 'Song not found' });
    const posterPath = path.join(assetsRoot, 'posters', path.basename(song.poster_url || ''));
    if (song.poster_url && !song.poster_url.startsWith('http') && !fs.existsSync(posterPath)) {
      return res.json({ success: true, song: { ...song.toObject(), poster_url: 'assets/posters/default_poster.jpg' } });
    }
    res.json({ success: true, song });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/upload', protect, adminOnly, upload.fields([{ name: 'song_file', maxCount: 1 }, { name: 'poster_file', maxCount: 1 }]), async (req, res) => {
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

router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const { title, artist, genre, duration, youtube_id, poster_url, release_date } = req.body;
    if (!title || !artist || !genre) {
      return res.json({ success: false, error: 'Title, artist, and genre are required' });
    }
    const song = await Song.create({
      title,
      artist,
      genre,
      duration: duration || '3:00',
      youtube_id: youtube_id || '',
      poster_url: poster_url || (youtube_id ? `https://img.youtube.com/vi/${youtube_id}/hqdefault.jpg` : 'https://picsum.photos/150/150?random'),
      release_date: release_date || new Date(),
    });
    res.json({ success: true, message: 'Song created successfully', song });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const { title, artist, genre, duration, release_date } = req.body;
    const update = {};
    if (title !== undefined) update.title = title;
    if (artist !== undefined) update.artist = artist;
    if (genre !== undefined) update.genre = genre;
    if (duration !== undefined) update.duration = duration;
    if (release_date !== undefined) update.release_date = release_date;
    const song = await Song.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!song) return res.status(404).json({ success: false, error: 'Song not found' });
    res.json({ success: true, song });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const song = await Song.findByIdAndDelete(req.params.id);
    if (!song) return res.status(404).json({ success: false, error: 'Song not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const updateSongContent = async (req, res) => {
  try {
    const { lyrics, chords } = req.body;
    const update = {};
    if (lyrics !== undefined) update.lyrics = lyrics;
    if (chords !== undefined) update.chords = chords;
    const song = await Song.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!song) return res.status(404).json({ success: false, error: 'Song not found' });
    res.json({ success: true, song });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

router.patch('/:id/content', protect, adminOnly, updateSongContent);
router.put('/:id/content', protect, adminOnly, updateSongContent);

export default router;
