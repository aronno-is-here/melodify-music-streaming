import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  ADMIN_RECOMMENDATION_HISTORY_ERROR_CODES,
  ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED_MESSAGE,
  ADMIN_RECOMMENDATION_HISTORY_STATES,
  DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
  fetchAdminRecommendationHistory,
  isValidAdminRecommendationHistoryLimit,
  isValidAdminRecommendationHistoryStage,
} from '../services/adminRecommendationHistory.js';

const IDLE_RESULT = Object.freeze({
  state: ADMIN_RECOMMENDATION_HISTORY_STATES.IDLE,
  runs: [],
  error: null,
});

const LOADING_RESULT = Object.freeze({
  state: ADMIN_RECOMMENDATION_HISTORY_STATES.LOADING,
  runs: [],
  error: null,
});

const requestFailedResult = () => ({
  state: ADMIN_RECOMMENDATION_HISTORY_STATES.ERROR,
  runs: [],
  error: {
    code: ADMIN_RECOMMENDATION_HISTORY_ERROR_CODES.REQUEST_FAILED,
    message: ADMIN_RECOMMENDATION_HISTORY_REQUEST_FAILED_MESSAGE,
  },
});

export function useAdminRecommendationHistory(options = {}) {
  const pipelineStage =
    options.pipelineStage === undefined
      ? DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE
      : options.pipelineStage;
  const limit =
    options.limit === undefined
      ? DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT
      : options.limit;
  const enabled = options.enabled !== false;

  const [result, setResult] = useState(IDLE_RESULT);
  const generationRef = useRef(0);

  const runRequest = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setResult(LOADING_RESULT);

    try {
      const classified = await fetchAdminRecommendationHistory({
        pipelineStage,
        limit,
        apiClient: api,
      });
      if (generationRef.current !== generation) return;
      setResult(classified);
    } catch {
      if (generationRef.current !== generation) return;
      setResult(requestFailedResult());
    }
  }, [pipelineStage, limit]);

  useEffect(() => {
    generationRef.current += 1;

    if (!enabled) {
      setResult(IDLE_RESULT);
      return undefined;
    }

    if (
      !isValidAdminRecommendationHistoryStage(pipelineStage)
      || !isValidAdminRecommendationHistoryLimit(limit)
    ) {
      setResult(requestFailedResult());
      return undefined;
    }

    const generation = generationRef.current;
    let cancelled = false;

    setResult(LOADING_RESULT);

    (async () => {
      try {
        const classified = await fetchAdminRecommendationHistory({
          pipelineStage,
          limit,
          apiClient: api,
        });
        if (cancelled || generationRef.current !== generation) return;
        setResult(classified);
      } catch {
        if (cancelled || generationRef.current !== generation) return;
        setResult(requestFailedResult());
      }
    })();

    return () => {
      cancelled = true;
      generationRef.current += 1;
    };
  }, [enabled, pipelineStage, limit]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (
      !isValidAdminRecommendationHistoryStage(pipelineStage)
      || !isValidAdminRecommendationHistoryLimit(limit)
    ) {
      setResult(requestFailedResult());
      return;
    }
    await runRequest();
  }, [enabled, pipelineStage, limit, runRequest]);

  const isLoading =
    result.state === ADMIN_RECOMMENDATION_HISTORY_STATES.LOADING;
  const isReady = result.state === ADMIN_RECOMMENDATION_HISTORY_STATES.READY;

  return {
    state: result.state,
    runs: result.runs,
    error: result.error,
    pipelineStage,
    limit,
    isLoading,
    isReady,
    refresh,
  };
}

export default useAdminRecommendationHistory;
