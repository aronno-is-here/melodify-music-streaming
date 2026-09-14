import express from 'express';
import Playlist from '../models/Playlist.js';
import Song from '../models/Song.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, async (req, res) => {
  try {
    const playlists = await Playlist.find({ user_email: req.user.email }).populate('items.songId').sort({ createdAt: -1 });
    res.json({ success: true, playlists });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    const playlist = await Playlist.findOne({ _id: req.params.id, user_email: req.user.email }).populate('items.songId');
    if (!playlist) return res.status(404).json({ success: false, error: 'Playlist not found' });
    res.json({ success: true, playlist });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.json({ success: false, error: 'Playlist title is required' });
    const playlist = await Playlist.create({ user_email: req.user.email, title, items: [] });
    res.json({ success: true, playlist });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:id', protect, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.json({ success: false, error: 'Playlist title is required' });
    const playlist = await Playlist.findOneAndUpdate(
      { _id: req.params.id, user_email: req.user.email },
      { title },
      { new: true }
    ).populate('items.songId');
    if (!playlist) return res.status(404).json({ success: false, error: 'Playlist not found' });
    res.json({ success: true, playlist });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:id/songs', protect, async (req, res) => {
  try {
    const { songId } = req.body;
    if (!songId) return res.json({ success: false, error: 'Song ID is required' });
    const playlist = await Playlist.findOne({ _id: req.params.id, user_email: req.user.email });
    if (!playlist) return res.status(404).json({ success: false, error: 'Playlist not found' });
    if (!playlist.items.some((item) => String(item.songId) === String(songId))) {
      playlist.items.push({ songId });
    }
    await playlist.save();
    const populated = await Playlist.findById(playlist._id).populate('items.songId');
    res.json({ success: true, playlist: populated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id/songs/:songId', protect, async (req, res) => {
  try {
    const playlist = await Playlist.findOne({ _id: req.params.id, user_email: req.user.email });
    if (!playlist) return res.status(404).json({ success: false, error: 'Playlist not found' });
    playlist.items = playlist.items.filter((item) => String(item.songId) !== String(req.params.songId));
    await playlist.save();
    const populated = await Playlist.findById(playlist._id).populate('items.songId');
    res.json({ success: true, playlist: populated });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id', protect, async (req, res) => {
  try {
    await Playlist.findOneAndDelete({ _id: req.params.id, user_email: req.user.email });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
