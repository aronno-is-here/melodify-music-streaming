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

dotenv.config();

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// CORS
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',');
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
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

// Connect to DB
await connectDB();

// Static assets
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// Routes with rate limiters
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', strictLimiter);
app.use('/api/auth/reset-password', strictLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/songs', songRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ success: true, message: 'Melodify API is running' }));

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  const message = process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message;
  res.status(err.statusCode || 500).json({ success: false, error: message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Melodify server running on port ${PORT}`));
