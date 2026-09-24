import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import recommendationConfig from '../config/recommendation.js';
import {
  parseTrendingRequest,
  TRENDING_HTTP_MESSAGES,
} from '../utils/trendingRequest.js';
import { createTrendingService } from '../services/trendingService.js';

const router = Router();

const trendingService = createTrendingService();

router.get('/', protect, async (req, res) => {
  if (!recommendationConfig.trendingEnabled) {
    return res.status(503).json({
      success: false,
      error: TRENDING_HTTP_MESSAGES.disabled,
    });
  }

  const parsed = parseTrendingRequest(req.query);
  if (!parsed.ok) {
    return res.status(400).json({
      success: false,
      error: parsed.error,
    });
  }

  try {
    const data = await trendingService.getTrendingSongs(parsed.value);
    return res.status(200).json({ success: true, data });
  } catch {
    return res.status(500).json({
      success: false,
      error: TRENDING_HTTP_MESSAGES.failed,
    });
  }
});

export default router;
