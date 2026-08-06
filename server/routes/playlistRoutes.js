import express from 'express';
import Playlist from '../models/Playlist.js';
import Song from '../models/Song.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', protect, async (req, res) => {
  try {
    const playlists = await Playlist.find({ user_email: req.user.email }).populate('songIds');
    res.json({ success: true, playlists });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const { title } = req.body;
    if (!title) return res.json({ success: false, error: 'Playlist title is required' });
    const playlist = await Playlist.create({ user_email: req.user.email, title, songIds: [] });
    res.json({ success: true, playlist });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:id/songs', protect, async (req, res) => {
  try {
    const { songId } = req.body;
    const playlist = await Playlist.findOne({ _id: req.params.id, user_email: req.user.email });
    if (!playlist) return res.status(404).json({ success: false, error: 'Playlist not found' });
    if (!playlist.songIds.includes(songId)) playlist.songIds.push(songId);
    await playlist.save();
    res.json({ success: true, playlist });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/:id/songs/:songId', protect, async (req, res) => {
  try {
    const playlist = await Playlist.findOne({ _id: req.params.id, user_email: req.user.email });
    if (!playlist) return res.status(404).json({ success: false, error: 'Playlist not found' });
    playlist.songIds = playlist.songIds.filter((s) => String(s) !== String(req.params.songId));
    await playlist.save();
    res.json({ success: true, playlist });
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