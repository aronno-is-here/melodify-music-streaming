import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { protect } from '../middleware/auth.js';
import { hasTokenPurpose, TOKEN_USE_ACCESS, TOKEN_USE_PASSWORD_RESET } from '../utils/tokenPurpose.js';

const router = express.Router();

const signToken = (user) =>
  jwt.sign({ id: user._id, email: user.email, role: user.role, token_use: TOKEN_USE_ACCESS }, process.env.JWT_SECRET, {
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
    return res.json({ success: true, token: signToken(user), user: { id: user._id, email: user.email, name: user.name, role: user.role, bio: user.bio || '', avatar: user.avatar || '', libraryVisibility: user.libraryVisibility || 'private' } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) {
      return res.json({ success: false, error: 'Email and password are required.' });
    }
    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      return res.json({ success: false, error: 'Invalid email or password.' });
    }
    return res.json({ success: true, token: signToken(user), user: { id: user._id, email: user.email, name: user.name, role: user.role, bio: user.bio || '', avatar: user.avatar || '', libraryVisibility: user.libraryVisibility || 'private' } });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/me', protect, (req, res) => {
  res.json({
    success: true,
    user: { id: req.user._id, email: req.user.email, name: req.user.name, dob: req.user.dob, gender: req.user.gender, country: req.user.country, role: req.user.role, bio: req.user.bio || '', avatar: req.user.avatar || '', libraryVisibility: req.user.libraryVisibility || 'private' },
  });
});

router.put('/me', protect, async (req, res) => {
  try {
    const allowedFields = ['name', 'dob', 'gender', 'country'];
    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }
    if (Object.keys(update).length === 0) {
      return res.json({ success: false, error: 'No valid fields to update.' });
    }
    const user = await User.findByIdAndUpdate(req.user._id, update, { new: true, runValidators: true });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/me/password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.json({ success: false, error: 'Current and new password are required.' });
    }
    const userWithPassword = await User.findById(req.user._id).select('+password');
    if (!userWithPassword || !userWithPassword.password) {
      return res.json({ success: false, error: 'User not found.' });
    }
    if (!(await bcrypt.compare(currentPassword, userWithPassword.password))) {
      return res.json({ success: false, error: 'Current password is incorrect.' });
    }
    if (newPassword.length < 10 || !/[a-zA-Z]/.test(newPassword) || !/[0-9#?!&]/.test(newPassword)) {
      return res.json({ success: false, error: 'New password must contain at least 10 characters, 1 letter, and 1 number or special character.' });
    }
    userWithPassword.password = await bcrypt.hash(newPassword, 10);
    userWithPassword.passwordChangedAt = new Date();
    await userWithPassword.save();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
    }
    const token = jwt.sign({ id: user._id, token_use: TOKEN_USE_PASSWORD_RESET }, process.env.JWT_SECRET, { expiresIn: '1h' });
    console.log(`Password reset token for ${email}: ${token}`);
    res.json({ success: true, message: 'If an account exists, a reset link has been sent.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.json({ success: false, error: 'Token and password are required.' });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.json({ success: false, error: 'Invalid or expired reset token.' });
    }
    if (!hasTokenPurpose(decoded, TOKEN_USE_PASSWORD_RESET)) {
      return res.json({ success: false, error: 'Invalid token.' });
    }
    const user = await User.findById(decoded.id).select('+password passwordChangedAt');
    if (!user) {
      return res.json({ success: false, error: 'Invalid token.' });
    }
    if (user.passwordChangedAt) {
      const tokenIssuedAt = new Date(decoded.iat * 1000);
      if (tokenIssuedAt < user.passwordChangedAt) {
        return res.json({ success: false, error: 'Reset token has been invalidated. Please request a new one.' });
      }
    }
    if (password.length < 10 || !/[a-zA-Z]/.test(password) || !/[0-9#?!&]/.test(password)) {
      return res.json({ success: false, error: 'Password must contain at least 10 characters, 1 letter, and 1 number or special character.' });
    }
    user.password = await bcrypt.hash(password, 10);
    user.passwordChangedAt = new Date();
    await user.save();
    res.json({ success: true, message: 'Password reset successful.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
