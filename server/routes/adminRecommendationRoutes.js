import { Router } from 'express';
import { protect, adminOnly } from '../middleware/auth.js';
import { PIPELINE_STAGES } from '../models/RecommendationEvaluationRun.js';
import {
  ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE,
  ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES,
  createAdminRecommendationMetricsService,
} from '../services/adminRecommendationMetricsService.js';

const ALLOWED_KEYS = Object.freeze(['pipeline_stage']);

const invalidQuery = () => ({
  ok: false,
  error: ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES.invalidQuery,
});

export function parseAdminRecommendationMetricsQuery(query) {
  if (query === undefined || query === null) {
    return {
      ok: true,
      value: { pipelineStage: ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE },
    };
  }
  if (typeof query !== 'object' || Array.isArray(query)) return invalidQuery();

  for (const key of Object.keys(query)) {
    if (!ALLOWED_KEYS.includes(key)) return invalidQuery();
  }

  let pipelineStage = ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE;
  if (Object.prototype.hasOwnProperty.call(query, 'pipeline_stage')) {
    const raw = query.pipeline_stage;
    if (typeof raw !== 'string') return invalidQuery();
    if (!PIPELINE_STAGES.includes(raw)) return invalidQuery();
    pipelineStage = raw;
  }

  return { ok: true, value: { pipelineStage } };
}

export function createAdminRecommendationRouter({
  protectMiddleware = protect,
  adminOnlyMiddleware = adminOnly,
  adminRecommendationMetricsService = createAdminRecommendationMetricsService(),
} = {}) {
  const router = Router();

  router.get(
    '/metrics',
    protectMiddleware,
    adminOnlyMiddleware,
    async (req, res) => {
      const parsed = parseAdminRecommendationMetricsQuery(req.query);
      if (!parsed.ok) {
        return res.status(400).json({
          success: false,
          error: parsed.error,
        });
      }

      try {
        const data =
          await adminRecommendationMetricsService.getLatestRecommendationMetrics({
            pipelineStage: parsed.value.pipelineStage,
          });
        return res.status(200).json({ success: true, data });
      } catch {
        return res.status(500).json({
          success: false,
          error: ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES.failed,
        });
      }
    },
  );

  return router;
}

const router = createAdminRecommendationRouter();

export default router;
