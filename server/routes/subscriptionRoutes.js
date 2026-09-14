import express from 'express';
import Subscription from '../models/Subscription.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

const PLANS = {
  Individual: { months: 3, amount: 219 },
  Student: { months: 1, amount: 109 },
  Duo: { months: 1, amount: 299 },
};

router.get('/me', protect, async (req, res) => {
  try {
    const sub = await Subscription.findOne({ user_email: req.user.email, status: 'active' }).sort({ createdAt: -1 });
    if (sub && sub.end_date && new Date(sub.end_date) < new Date()) {
      sub.status = 'expired';
      await sub.save();
      return res.json({ success: true, subscription: null });
    }
    res.json({ success: true, subscription: sub || null });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/', protect, async (req, res) => {
  try {
    const plan = PLANS[req.body.plan] ? req.body.plan : 'Individual';
    const { months, amount } = PLANS[plan];
    await Subscription.updateMany({ user_email: req.user.email, status: 'active' }, { status: 'expired' });
    const end_date = new Date();
    end_date.setMonth(end_date.getMonth() + months);
    const subscription = await Subscription.create({ user_email: req.user.email, plan, status: 'active', amount, end_date });
    res.json({ success: true, message: `Subscribed to Premium ${plan}`, subscription });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/cancel', protect, async (req, res) => {
  try {
    const sub = await Subscription.findOneAndUpdate(
      { user_email: req.user.email, status: 'active' },
      { status: 'expired', end_date: new Date() },
      { new: true }
    );
    res.json({ success: true, subscription: sub });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
