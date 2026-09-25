import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import rateLimit from 'express-rate-limit';
import connectDB from './config/db.js';
import authRoutes from './routes/authRoutes.js';
import songRoutes from './routes/songRoutes.js';
import playlistRoutes from './routes/playlistRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import historyRoutes from './routes/historyRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import favoriteRoutes from './routes/favoriteRoutes.js';
import lyricsRoutes from './routes/lyricsRoutes.js';
import catalogRoutes from './routes/catalogRoutes.js';
import userRoutes from './routes/userRoutes.js';
import followRoutes from './routes/followRoutes.js';
import postRoutes from './routes/postRoutes.js';
import likeRoutes from './routes/likeRoutes.js';
import commentRoutes from './routes/commentRoutes.js';
import mediaRoutes from './routes/mediaRoutes.js';
import karaokeRoutes from './routes/karaokeRoutes.js';
import recordingRoutes from './routes/recordingRoutes.js';
import listeningEventRoutes from './routes/listeningEventRoutes.js';
import trendingRoutes from './routes/trendingRoutes.js';
import recommendationRoutes from './routes/recommendationRoutes.js';
import adminRecommendationRoutes from './routes/adminRecommendationRoutes.js';
import { isSensitiveResetPath, getSafeResetError } from './utils/resetSecurity.js';

dotenv.config();

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS
const rawOrigins = process.env.CORS_ORIGIN || '';
const allowedOrigins = rawOrigins
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

// Body parser with size limit
app.use(express.json({ limit: '2mb' }));

// Rate limiters
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, error: 'Too many attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Lazy DB connect (serverless-friendly)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    res.status(500).json({ success: false, error: 'Database connection failed' });
  }
});

// Static assets
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
app.use('/assets/recordings', express.static(path.join(__dirname, '..', 'assets', 'recordings')));

// Routes with rate limiters
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', strictLimiter);
app.use('/api/auth/reset-password', strictLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/songs', songRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin/recommendations', adminRecommendationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/lyrics', lyricsRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/users', userRoutes);
app.use('/api/follows', followRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/likes', likeRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/karaoke', karaokeRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/listening-events', listeningEventRoutes);
app.use('/api/trending', trendingRoutes);
app.use('/api/recommendations', recommendationRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ success: true, message: 'Melodify API is running' }));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  // Parser errors may contain the raw reset request body; never log or echo them.
  if (isSensitiveResetPath(req.originalUrl)) {
    const { status, body } = getSafeResetError(err);
    return res.status(status).json(body);
  }
  console.error(err);
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(err.statusCode || 500).json({ success: false, error: message });
});

// Export for Vercel serverless
export default app;

// Local dev server
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`Melodify server running on port ${PORT}`));
}
