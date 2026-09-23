import express from 'express';
import User from '../models/User.js';
import Song from '../models/Song.js';
import Report from '../models/Report.js';
import Subscription from '../models/Subscription.js';
import PlayHistory from '../models/PlayHistory.js';
import { protect, adminOnly } from '../middleware/auth.js';
import recommendationConfig from '../config/recommendation.js';
import { parseCatalogSyncRequest } from '../utils/catalogSyncRequest.js';
import { createCatalogSyncService } from '../services/catalogSyncService.js';
import { createYouTubeCatalogClient } from '../services/youtubeCatalogClient.js';
import { normalizeYouTubeMusicCandidates } from '../services/youtubeMusicNormalizer.js';
import { createCatalogUpsertService } from '../services/catalogUpsertService.js';

const router = express.Router();

router.use(protect, adminOnly);

const catalogSyncService = createCatalogSyncService({
  youtubeClient: createYouTubeCatalogClient(),
  normalizer: { normalizeYouTubeMusicCandidates },
  catalogUpsertService: createCatalogUpsertService(),
  catalogSyncEnabled: recommendationConfig.catalogSyncEnabled,
});

router.post('/catalog-sync', async (req, res) => {
  if (!recommendationConfig.catalogSyncEnabled) {
    return res.status(503).json({ success: false, error: 'Catalog synchronization is disabled' });
  }
  const parsed = parseCatalogSyncRequest(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ success: false, error: parsed.error });
  }
  try {
    const data = await catalogSyncService.syncCatalogSearch(parsed.value);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    if (error && error.code === 'CATALOG_SYNC_DISABLED') {
      return res.status(503).json({ success: false, error: 'Catalog synchronization is disabled' });
    }
    if (error && error.code === 'CATALOG_SYNC_UPSTREAM') {
      return res.status(502).json({ success: false, error: 'Catalog synchronization failed' });
    }
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

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

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [totalRevenueAgg, monthlyRevenueAgg, lastMonthRevenueAgg, planBreakdown, totalSubsCount] = await Promise.all([
      Subscription.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Subscription.aggregate([
        { $match: { createdAt: { $gte: startOfMonth }, status: 'active' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Subscription.aggregate([
        { $match: { createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth }, status: 'active' } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Subscription.aggregate([
        { $match: { status: 'active' } },
        { $group: { _id: '$plan', total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Subscription.countDocuments({ status: 'active' }),
    ]);

    const revenue = totalRevenueAgg.length > 0 ? totalRevenueAgg[0].total : 0;
    const monthlyRevenue = monthlyRevenueAgg.length > 0 ? monthlyRevenueAgg[0].total : 0;
    const lastMonthRevenue = lastMonthRevenueAgg.length > 0 ? lastMonthRevenueAgg[0].total : 0;
    const monthlySubs = monthlyRevenueAgg.length > 0 ? monthlyRevenueAgg[0].count : 0;
    const revenueByPlan = {};
    planBreakdown.forEach((p) => { revenueByPlan[p._id || 'Unknown'] = { revenue: p.total, subs: p.count }; });

    res.json({
      success: true,
      stats: {
        users, songs, plays, revenue, activeSubs, pendingReports, recentPlays,
        monthlyRevenue, lastMonthRevenue, monthlySubs,
        totalSubs: totalSubsCount, revenueByPlan,
      },
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
