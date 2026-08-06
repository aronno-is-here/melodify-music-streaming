import express from 'express';
import Song from '../models/Song.js';
import User from '../models/User.js';
import Report from '../models/Report.js';
import Subscription from '../models/Subscription.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.use(protect, adminOnly);

router.get('/stats', async (req, res) => {
  try {
    const users = await User.countDocuments();
    const songs = await Song.countDocuments();
    res.json({
      success: true,
      stats: {
        users,
        songs,
        plays: Math.floor(Math.random() * 10000),
        revenue: Math.floor(Math.random() * 5000),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '');
    const filter = q
      ? { $or: [{ name: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }] }
      : {};
    const users = await User.find(filter).select('-password');
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).select('-password');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const reports = await Report.find();
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/reports/:id', async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/subscriptions', async (req, res) => {
  try {
    const subs = await Subscription.find();
    res.json({ success: true, subscriptions: subs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/subscriptions/:id', async (req, res) => {
  try {
    const sub = await Subscription.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, subscription: sub });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;