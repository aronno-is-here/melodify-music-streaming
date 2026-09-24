import { Router } from 'express';
import { protect } from '../middleware/auth.js';
import recommendationConfig from '../config/recommendation.js';
import {
  parseListeningEventRequest,
  mapListeningEventResult,
  LISTENING_EVENT_HTTP_MESSAGES,
} from '../utils/listeningEventRequest.js';
import { createListeningEventService } from '../services/listeningEventService.js';

const router = Router();

const listeningEventService = createListeningEventService();

router.post('/', protect, async (req, res) => {
  if (!recommendationConfig.listeningEventsEnabled) {
    return res.status(503).json({
      success: false,
      error: LISTENING_EVENT_HTTP_MESSAGES.disabled,
    });
  }

  const parsed = parseListeningEventRequest(req.body);
  if (!parsed.ok) {
    return res.status(400).json({
      success: false,
      error: LISTENING_EVENT_HTTP_MESSAGES.invalidBody,
    });
  }

  try {
    const result = await listeningEventService.recordListeningEvent({
      userId: req.user._id,
      event: parsed.value,
    });
    const mapped = mapListeningEventResult(result);
    return res.status(mapped.httpStatus).json(mapped.body);
  } catch {
    return res.status(500).json({
      success: false,
      error: LISTENING_EVENT_HTTP_MESSAGES.failed,
    });
  }
});

export default router;
