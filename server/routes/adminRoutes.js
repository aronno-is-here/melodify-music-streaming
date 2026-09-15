import express from 'express';
import User from '../models/User.js';
import Song from '../models/Song.js';
import Report from '../models/Report.js';
import Subscription from '../models/Subscription.js';
import PlayHistory from '../models/PlayHistory.js';
import { protect, adminOnly } from '../middleware/auth.js';

const router = express.Router();

router.use(protect, adminOnly);

import { escapeRegex } from '../utils/escapeRegex.js';

router.get('/stats', async (req, res) => {
  try {
    const [users, songs, plays, activeSubs, pendingReports, recentPlays] = await Promise.all([
      User.countDocuments(),
      Song.countDocuments(),
      PlayHistory.countDocuments(),
      Subscription.countDocuments({ status: 'active' }),
      Report.countDocuments({ status: 'pending' }),
      PlayHistory.find().sort({ playedAt: -1 }).limit(5).populate('song', 'title artist').populate('user', 'name email'),
    ]);
    const revenueAgg = await Subscription.aggregate([
      { $match: { status: 'active' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const revenue = revenueAgg.length > 0 ? revenueAgg[0].total : 0;
    res.json({
      success: true,
      stats: { users, songs, plays, revenue, activeSubs, pendingReports, recentPlays },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/users', async (req, res) => {
  try {
    const q = escapeRegex(String(req.query.q || ''));
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
    const { name, role } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (role !== undefined && ['user', 'admin'].includes(role)) update.role = role;
    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true }).select('-password');
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/reports', async (req, res) => {
  try {
    const reports = await Report.find().sort({ createdAt: -1 });
    res.json({ success: true, reports });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/reports/:id', async (req, res) => {
  try {
    const { status, admin_notes } = req.body;
    const update = {};
    if (status !== undefined && ['pending', 'resolved', 'dismissed'].includes(status)) update.status = status;
    if (admin_notes !== undefined) update.admin_notes = admin_notes;
    const report = await Report.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({ success: true, report });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/reports/:id', async (req, res) => {
  try {
    const report = await Report.findByIdAndDelete(req.params.id);
    if (!report) return res.status(404).json({ success: false, error: 'Report not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/subscriptions', async (req, res) => {
  try {
    const subs = await Subscription.find().sort({ createdAt: -1 });
    res.json({ success: true, subscriptions: subs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/subscriptions/:id', async (req, res) => {
  try {
    const { status } = req.body;
    const update = {};
    if (status !== undefined && ['active', 'expired'].includes(status)) update.status = status;
    const sub = await Subscription.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!sub) return res.status(404).json({ success: false, error: 'Subscription not found' });
    res.json({ success: true, subscription: sub });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
