import { Router } from 'express';
import { protect, adminOnly } from '../middleware/auth.js';
import { PIPELINE_STAGES } from '../models/RecommendationEvaluationRun.js';
import {
  ADMIN_RECOMMENDATION_METRICS_DEFAULT_STAGE,
  ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES,
  createAdminRecommendationMetricsService,
} from '../services/adminRecommendationMetricsService.js';
import {
  ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE,
  ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES,
  DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  createAdminRecommendationHistoryService,
} from '../services/adminRecommendationHistoryService.js';

const ALLOWED_KEYS = Object.freeze(['pipeline_stage']);

const HISTORY_ALLOWED_KEYS = Object.freeze(['pipeline_stage', 'limit']);

const HISTORY_LIMIT_PATTERN = /^([1-9][0-9]{0,2})$/;

const invalidQuery = () => ({
  ok: false,
  error: ADMIN_RECOMMENDATION_METRICS_HTTP_MESSAGES.invalidQuery,
});

const invalidHistoryQuery = () => ({
  ok: false,
  error: ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES.invalidQuery,
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

export function parseAdminRecommendationHistoryQuery(query) {
  if (query === undefined || query === null) {
    return {
      ok: true,
      value: {
        pipelineStage: ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE,
        limit: DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
      },
    };
  }
  if (typeof query !== 'object' || Array.isArray(query)) {
    return invalidHistoryQuery();
  }

  for (const key of Object.keys(query)) {
    if (!HISTORY_ALLOWED_KEYS.includes(key)) return invalidHistoryQuery();
  }

  let pipelineStage = ADMIN_RECOMMENDATION_HISTORY_DEFAULT_STAGE;
  if (Object.prototype.hasOwnProperty.call(query, 'pipeline_stage')) {
    const raw = query.pipeline_stage;
    if (typeof raw !== 'string') return invalidHistoryQuery();
    if (!PIPELINE_STAGES.includes(raw)) return invalidHistoryQuery();
    pipelineStage = raw;
  }

  let limit = DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT;
  if (Object.prototype.hasOwnProperty.call(query, 'limit')) {
    const raw = query.limit;
    if (typeof raw !== 'string') return invalidHistoryQuery();
    if (!HISTORY_LIMIT_PATTERN.test(raw)) return invalidHistoryQuery();
    const parsedLimit = Number(raw);
    if (
      !Number.isInteger(parsedLimit) ||
      parsedLimit < 1 ||
      parsedLimit > MAX_ADMIN_RECOMMENDATION_HISTORY_LIMIT
    ) {
      return invalidHistoryQuery();
    }
    limit = parsedLimit;
  }

  return { ok: true, value: { pipelineStage, limit } };
}

export function createAdminRecommendationRouter({
  protectMiddleware = protect,
  adminOnlyMiddleware = adminOnly,
  adminRecommendationMetricsService = createAdminRecommendationMetricsService(),
  adminRecommendationHistoryService = createAdminRecommendationHistoryService(),
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

  router.get(
    '/history',
    protectMiddleware,
    adminOnlyMiddleware,
    async (req, res) => {
      const parsed = parseAdminRecommendationHistoryQuery(req.query);
      if (!parsed.ok) {
        return res.status(400).json({
          success: false,
          error: parsed.error,
        });
      }

      try {
        const data =
          await adminRecommendationHistoryService.getRecommendationEvaluationHistory(
            {
              pipelineStage: parsed.value.pipelineStage,
              limit: parsed.value.limit,
            },
          );
        return res.status(200).json({ success: true, data });
      } catch {
        return res.status(500).json({
          success: false,
          error: ADMIN_RECOMMENDATION_HISTORY_HTTP_MESSAGES.failed,
        });
      }
    },
  );

  return router;
}

const router = createAdminRecommendationRouter();

export default router;
