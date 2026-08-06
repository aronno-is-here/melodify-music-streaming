import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

const signToken = (user) =>
  jwt.sign({ id: user._id, email: user.email, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

router.post('/signup/step1', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.json({ success: false, error: 'Invalid email format.' });
    }
    const exists = await User.findOne({ email });
    if (exists) {
      return res.json({ success: false, error: 'Email already registered.' });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/signup/step2', async (req, res) => {
  try {
    const password = String(req.body.password || '');
    if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/[0-9#?!&]/.test(password)) {
      return res.json({
        success: false,
        error: 'Password must contain at least 10 characters, 1 letter, and 1 number or special character.',
      });
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/signup/step3', async (req, res) => {
  try {
    const { email, password, name, day, month, year, gender, country } = req.body;
    if (!name || !day || !month || !year || !gender || !country || !email || !password) {
      return res.json({ success: false, error: 'All fields are required.' });
    }
    const dob = new Date(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    if (isNaN(dob.getTime())) {
      return res.json({ success: false, error: 'Invalid date of birth.' });
    }
    if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/[0-9#?!&]/.test(password)) {
      return res.json({ success: false, error: 'Password does not meet requirements.' });
    }
    const exists = await User.findOne({ email });
    if (exists) {
      return res.json({ success: false, error: 'Email already registered.' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ email, password: hashed, name, dob, gender, country });
    return res.json({ success: true, token: signToken(user), user: { id: user._id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const user = await User.findOne({ email });
    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      return res.json({ success: false, error: 'Invalid email or password.' });
    }
    return res.json({ success: true, token: signToken(user), user: { id: user._id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/me', protect, (req, res) => {
  res.json({
    success: true,
    user: { id: req.user._id, email: req.user.email, name: req.user.name, dob: req.user.dob, gender: req.user.gender, country: req.user.country, role: req.user.role },
  });
});

router.put('/me', protect, async (req, res) => {
  try {
    const { name, dob, gender, country } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { name, dob, gender, country },
      { new: true, runValidators: true }
    ).select('-password');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/me/password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!(await bcrypt.compare(currentPassword, req.user.password))) {
      return res.json({ success: false, error: 'Current password is incorrect.' });
    }
    if (newPassword.length < 10 || !/[a-zA-Z]/.test(newPassword) || !/[0-9#?!&]/.test(newPassword)) {
      return res.json({ success: false, error: 'New password must contain at least 10 characters, 1 letter, and 1 number or special character.' });
    }
    req.user.password = await bcrypt.hash(newPassword, 10);
    await req.user.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;