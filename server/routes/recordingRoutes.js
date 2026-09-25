import express from 'express';
import Recording from '../models/Recording.js';
import Karaoke from '../models/Karaoke.js';
import Song from '../models/Song.js';
import Post from '../models/Post.js';
import { protect } from '../middleware/auth.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { parseRecordingSyncPayload, RECORDING_MODE } from '../utils/recordingSyncPayload.js';

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsRoot = path.join(__dirname, '..', '..', 'assets');
const baseDir = isProd ? '/tmp' : uploadsRoot;
const recordingsDir = path.join(baseDir, 'recordings');
fs.mkdirSync(recordingsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, recordingsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.webm';
    const unique = crypto.randomBytes(12).toString('hex');
    cb(null, `rec-${unique}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExts = ['.webm', '.ogg', '.wav', '.mp3', '.m4a', '.mp4'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(null, allowedExts.includes(ext));
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

router.get('/', protect, async (req, res) => {
  try {
    const query = { author: req.user._id };
    if (req.query.karaokeId) query.karaoke = req.query.karaokeId;

    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const [recordings, total] = await Promise.all([
      Recording.find(query)
        .populate('karaoke', 'title artist poster_url duration')
        .populate('backingSong', 'title artist poster_url duration youtube_id')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Recording.countDocuments(query),
    ]);

    res.json({ success: true, recordings, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/user/:userId', protect, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    const query = { author: req.params.userId, visibility: 'public' };
    if (String(req.params.userId) === String(req.user._id)) {
      delete query.visibility;
    }

    const [recordings, total] = await Promise.all([
      Recording.find(query)
        .populate('karaoke', 'title artist poster_url duration')
        .populate('backingSong', 'title artist poster_url duration youtube_id')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Recording.countDocuments(query),
    ]);

    res.json({ success: true, recordings, page, limit, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id)
      .populate('author', 'name email avatar')
      .populate('karaoke', 'title artist poster_url duration')
      .populate('backingSong', 'title artist poster_url duration youtube_id');

    if (!recording) return res.status(404).json({ success: false, error: 'Recording not found' });
    if (recording.visibility === 'private' && String(recording.author._id) !== String(req.user._id)) {
      return res.status(404).json({ success: false, error: 'Recording not found' });
    }

    res.json({ success: true, recording });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', protect, upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No audio file uploaded.' });
    }

    const { karaokeId, title, caption, duration, effects, visibility } = req.body;
    if (!title) {
      return res.status(400).json({ success: false, error: 'Recording title is required.' });
    }

    const syncMeta = parseRecordingSyncPayload(req.body);
    if (!syncMeta.ok) {
      return res.status(400).json({ success: false, error: syncMeta.error });
    }

    let karaoke = null;
    if (karaokeId) {
      karaoke = await Karaoke.findById(karaokeId);
      if (!karaoke) return res.status(404).json({ success: false, error: 'Karaoke track not found' });
    }

    let backingSong = null;
    if (syncMeta.value.backingSongId) {
      backingSong = await Song.findById(syncMeta.value.backingSongId);
      if (!backingSong) return res.status(404).json({ success: false, error: 'Backing song not found' });
    }

    if (!karaoke && !backingSong && !syncMeta.value.backingProviderId) {
      return res.status(400).json({ success: false, error: 'Backing track reference is required.' });
    }

    let parsedEffects = {};
    try { parsedEffects = effects ? JSON.parse(effects) : {}; } catch {}

    const parsedDurationSeconds = parseInt(duration, 10) || 0;
    const recordingDurationMs = syncMeta.value.recordingDurationMs > 0
      ? syncMeta.value.recordingDurationMs
      : parsedDurationSeconds * 1000;

    const recording = await Recording.create({
      author: req.user._id,
      karaoke: karaoke?._id || null,
      backingSong: backingSong?._id || null,
      recordingMode: syncMeta.value.recordingMode || RECORDING_MODE.MIC_ONLY,
      backingProvider: syncMeta.value.backingProvider || '',
      backingProviderId: syncMeta.value.backingProviderId || '',
      backingStartOffsetMs: syncMeta.value.backingStartOffsetMs || 0,
      recordingDurationMs,
      title: String(title).slice(0, 200),
      caption: String(caption || '').slice(0, 1000),
      audioUrl: `/assets/recordings/${req.file.filename}`,
      duration: parsedDurationSeconds,
      effects: parsedEffects,
      visibility: ['public', 'private'].includes(visibility) ? visibility : 'public',
    });

    const populated = await Recording.findById(recording._id)
      .populate('karaoke', 'title artist poster_url duration')
      .populate('backingSong', 'title artist poster_url duration youtube_id');

    res.json({ success: true, recording: populated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:id', protect, async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id);
    if (!recording) return res.status(404).json({ success: false, error: 'Recording not found' });
    if (String(recording.author) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    const { title, caption, visibility } = req.body;
    const update = {};
    if (title !== undefined) update.title = String(title).slice(0, 200);
    if (caption !== undefined) update.caption = String(caption).slice(0, 1000);
    if (visibility !== undefined && ['public', 'private'].includes(visibility)) {
      update.visibility = visibility;
    }

    const updated = await Recording.findByIdAndUpdate(req.params.id, update, { new: true })
      .populate('karaoke', 'title artist poster_url duration')
      .populate('backingSong', 'title artist poster_url duration youtube_id');

    res.json({ success: true, recording: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id);
    if (!recording) return res.status(404).json({ success: false, error: 'Recording not found' });
    if (String(recording.author) !== String(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }

    if (recording.audioUrl && recording.audioUrl.startsWith('/assets/recordings/')) {
      const filePath = path.join(baseDir, 'recordings', path.basename(recording.audioUrl));
      fs.unlink(filePath, () => {});
    }

    await Recording.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:id/publish', protect, async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id)
      .populate('karaoke', 'title artist poster_url')
      .populate('backingSong', 'title artist poster_url');

    if (!recording) return res.status(404).json({ success: false, error: 'Recording not found' });
    if (String(recording.author) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    if (recording.publishedAsPost) {
      return res.json({ success: false, error: 'Already published' });
    }

    const { caption, visibility } = req.body;

    const post = await Post.create({
      author: req.user._id,
      karaoke: recording.karaoke?._id || undefined,
      song: recording.backingSong?._id || undefined,
      title: recording.title,
      caption: caption || recording.caption || '',
      audioUrl: recording.audioUrl,
      duration: recording.duration,
      visibility: visibility || recording.visibility || 'public',
    });

    await Recording.findByIdAndUpdate(req.params.id, {
      publishedAsPost: true,
      postId: post._id,
    });

    res.json({ success: true, post });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
