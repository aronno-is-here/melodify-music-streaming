import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import recommendationConfig from '../config/recommendation.js';
import {
  createPersonalizedRecommendationService,
  DEFAULT_RECOMMENDATION_API_LIMIT,
  MAX_RECOMMENDATION_API_LIMIT,
  PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES,
} from '../services/personalizedRecommendationService.js';

const ALLOWED_KEYS = Object.freeze(['limit']);
const DIGITS_ONLY = /^\d+$/;

const isPlainObjectLike = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const invalidQuery = () => ({
  ok: false,
  error: PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.invalidQuery,
});

export function parseRecommendationRequest(query) {
  if (query === undefined || query === null) {
    return { ok: true, value: { limit: DEFAULT_RECOMMENDATION_API_LIMIT } };
  }
  if (!isPlainObjectLike(query)) return invalidQuery();

  for (const key of Object.keys(query)) {
    if (!ALLOWED_KEYS.includes(key)) return invalidQuery();
  }

  let limit = DEFAULT_RECOMMENDATION_API_LIMIT;
  if (Object.prototype.hasOwnProperty.call(query, 'limit')) {
    const raw = query.limit;
    if (typeof raw !== 'string') return invalidQuery();
    if (!DIGITS_ONLY.test(raw)) return invalidQuery();
    const parsed = Number(raw);
    if (!Number.isInteger(parsed)
      || parsed < 1
      || parsed > MAX_RECOMMENDATION_API_LIMIT) {
      return invalidQuery();
    }
    limit = parsed;
  }

  return { ok: true, value: { limit } };
}

export function createRecommendationRouter({
  protectMiddleware = protect,
  personalizedRecommendationService = createPersonalizedRecommendationService(),
  isRecommendationsEnabled = () => recommendationConfig.aiEnabled,
} = {}) {
  const router = Router();

  router.get('/', protectMiddleware, async (req, res) => {
    if (!isRecommendationsEnabled()) {
      return res.status(503).json({
        success: false,
        error: PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.disabled,
      });
    }

    const parsed = parseRecommendationRequest(req.query);
    if (!parsed.ok) {
      return res.status(400).json({
        success: false,
        error: parsed.error,
      });
    }

    try {
      const data = await personalizedRecommendationService.getPersonalizedRecommendations({
        userId: req.user?._id,
        limit: parsed.value.limit,
      });
      return res.status(200).json({ success: true, data });
    } catch {
      return res.status(500).json({
        success: false,
        error: PERSONALIZED_RECOMMENDATION_HTTP_MESSAGES.failed,
      });
    }
  });

  return router;
}

const router = createRecommendationRouter();

export default router;
