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

const MAX_PROVIDER_ID_LENGTH = 256;
const MAX_CONTENT_LANGUAGE_LENGTH = 64;

const isPlainObjectLike = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeBoundedText = (value, maxLength) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) return null;
  return trimmed;
};

const normalizeOptionalDate = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const normalizeHttpsUrl = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1024) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

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
    if (!isPlainObjectLike(req.body)) {
      return res.status(400).json({ success: false, error: 'Invalid content payload' });
    }

    const allowedKeys = new Set([
      'lyrics',
      'lyrics_verified',
      'lyrics_source',
      'lyrics_provider_id',
      'lyrics_language',
      'lyrics_match_status',
      'lyrics_last_checked_at',
      'chords',
      'chords_verified',
      'chords_source',
      'chords_provider_id',
      'chordify_url',
      'chordify_embed_url',
      'chords_reference_url',
      'chords_last_checked_at',
    ]);

    for (const key of Object.keys(req.body)) {
      if (!allowedKeys.has(key)) {
        return res.status(400).json({ success: false, error: 'Unknown content field' });
      }
    }

    const update = {};

    if (req.body.lyrics !== undefined) {
      if (req.body.lyrics !== null && typeof req.body.lyrics !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid lyrics value' });
      }
      update.lyrics = req.body.lyrics || '';
    }
    if (req.body.lyrics_verified !== undefined) {
      if (typeof req.body.lyrics_verified !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Invalid lyrics verification flag' });
      }
      update.lyrics_verified = req.body.lyrics_verified;
    }
    if (req.body.lyrics_source !== undefined) {
      const allowedLyricsSource = new Set(['db_verified', 'lrclib', 'legacy_unverified', 'none']);
      if (typeof req.body.lyrics_source !== 'string' || !allowedLyricsSource.has(req.body.lyrics_source)) {
        return res.status(400).json({ success: false, error: 'Invalid lyrics source' });
      }
      update.lyrics_source = req.body.lyrics_source;
    }
    if (req.body.lyrics_provider_id !== undefined) {
      const providerId = normalizeBoundedText(req.body.lyrics_provider_id, MAX_PROVIDER_ID_LENGTH);
      if (req.body.lyrics_provider_id && !providerId) {
        return res.status(400).json({ success: false, error: 'Invalid lyrics provider id' });
      }
      update.lyrics_provider_id = providerId || '';
    }
    if (req.body.lyrics_language !== undefined) {
      const language = normalizeBoundedText(req.body.lyrics_language, MAX_CONTENT_LANGUAGE_LENGTH);
      if (req.body.lyrics_language && !language) {
        return res.status(400).json({ success: false, error: 'Invalid lyrics language' });
      }
      update.lyrics_language = language || '';
    }
    if (req.body.lyrics_match_status !== undefined) {
      const allowedMatchStatus = new Set(['EXACT', 'HIGH', 'AMBIGUOUS', 'NONE']);
      if (typeof req.body.lyrics_match_status !== 'string' || !allowedMatchStatus.has(req.body.lyrics_match_status)) {
        return res.status(400).json({ success: false, error: 'Invalid lyrics match status' });
      }
      update.lyrics_match_status = req.body.lyrics_match_status;
    }
    if (req.body.lyrics_last_checked_at !== undefined) {
      const checkedAt = normalizeOptionalDate(req.body.lyrics_last_checked_at);
      if (checkedAt === null) return res.status(400).json({ success: false, error: 'Invalid lyrics checked time' });
      update.lyrics_last_checked_at = checkedAt || null;
    }

    if (req.body.chords !== undefined) {
      if (req.body.chords !== null && typeof req.body.chords !== 'string') {
        return res.status(400).json({ success: false, error: 'Invalid chords value' });
      }
      update.chords = req.body.chords || '';
    }
    if (req.body.chords_verified !== undefined) {
      if (typeof req.body.chords_verified !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Invalid chords verification flag' });
      }
      update.chords_verified = req.body.chords_verified;
    }
    if (req.body.chords_source !== undefined) {
      const allowedChordsSource = new Set(['db_verified', 'chordify', 'other', 'none']);
      if (typeof req.body.chords_source !== 'string' || !allowedChordsSource.has(req.body.chords_source)) {
        return res.status(400).json({ success: false, error: 'Invalid chords source' });
      }
      update.chords_source = req.body.chords_source;
    }
    if (req.body.chords_provider_id !== undefined) {
      const providerId = normalizeBoundedText(req.body.chords_provider_id, MAX_PROVIDER_ID_LENGTH);
      if (req.body.chords_provider_id && !providerId) {
        return res.status(400).json({ success: false, error: 'Invalid chords provider id' });
      }
      update.chords_provider_id = providerId || '';
    }
    if (req.body.chordify_url !== undefined) {
      const chordifyUrl = normalizeHttpsUrl(req.body.chordify_url);
      if (req.body.chordify_url && !chordifyUrl) {
        return res.status(400).json({ success: false, error: 'Invalid chordify URL' });
      }
      update.chordify_url = chordifyUrl || '';
    }
    if (req.body.chordify_embed_url !== undefined) {
      const chordifyEmbedUrl = normalizeHttpsUrl(req.body.chordify_embed_url);
      if (req.body.chordify_embed_url && !chordifyEmbedUrl) {
        return res.status(400).json({ success: false, error: 'Invalid chordify embed URL' });
      }
      update.chordify_embed_url = chordifyEmbedUrl || '';
    }
    if (req.body.chords_reference_url !== undefined) {
      const referenceUrl = normalizeHttpsUrl(req.body.chords_reference_url);
      if (req.body.chords_reference_url && !referenceUrl) {
        return res.status(400).json({ success: false, error: 'Invalid chords reference URL' });
      }
      update.chords_reference_url = referenceUrl || '';
    }
    if (req.body.chords_last_checked_at !== undefined) {
      const checkedAt = normalizeOptionalDate(req.body.chords_last_checked_at);
      if (checkedAt === null) return res.status(400).json({ success: false, error: 'Invalid chords checked time' });
      update.chords_last_checked_at = checkedAt || null;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: 'No content fields provided' });
    }

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
