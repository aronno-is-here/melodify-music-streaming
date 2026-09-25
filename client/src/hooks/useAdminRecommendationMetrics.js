import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  ADMIN_RECOMMENDATION_METRICS_STATES,
  ADMIN_RECOMMENDATION_METRICS_ERROR_CODES,
  ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED_MESSAGE,
  DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
  fetchAdminRecommendationMetrics,
  isValidAdminRecommendationPipelineStage,
} from '../services/adminRecommendationMetrics.js';

const IDLE_RESULT = Object.freeze({
  state: ADMIN_RECOMMENDATION_METRICS_STATES.IDLE,
  latest: null,
  error: null,
});

const LOADING_RESULT = Object.freeze({
  state: ADMIN_RECOMMENDATION_METRICS_STATES.LOADING,
  latest: null,
  error: null,
});

const requestFailedResult = () => ({
  state: ADMIN_RECOMMENDATION_METRICS_STATES.ERROR,
  latest: null,
  error: {
    code: ADMIN_RECOMMENDATION_METRICS_ERROR_CODES.REQUEST_FAILED,
    message: ADMIN_RECOMMENDATION_METRICS_REQUEST_FAILED_MESSAGE,
  },
});

export function useAdminRecommendationMetrics(options = {}) {
  const pipelineStage =
    options.pipelineStage === undefined
      ? DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE
      : options.pipelineStage;
  const enabled = options.enabled !== false;

  const [result, setResult] = useState(IDLE_RESULT);
  const generationRef = useRef(0);

  const runRequest = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setResult(LOADING_RESULT);

    try {
      const classified = await fetchAdminRecommendationMetrics({
        pipelineStage,
        apiClient: api,
      });
      if (generationRef.current !== generation) return;
      setResult(classified);
    } catch {
      if (generationRef.current !== generation) return;
      setResult(requestFailedResult());
    }
  }, [pipelineStage]);

  useEffect(() => {
    generationRef.current += 1;

    if (!enabled) {
      setResult(IDLE_RESULT);
      return undefined;
    }

    if (!isValidAdminRecommendationPipelineStage(pipelineStage)) {
      setResult(requestFailedResult());
      return undefined;
    }

    const generation = generationRef.current;
    let cancelled = false;

    setResult(LOADING_RESULT);

    (async () => {
      try {
        const classified = await fetchAdminRecommendationMetrics({
          pipelineStage,
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
  }, [enabled, pipelineStage]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (!isValidAdminRecommendationPipelineStage(pipelineStage)) {
      setResult(requestFailedResult());
      return;
    }
    await runRequest();
  }, [enabled, pipelineStage, runRequest]);

  const isLoading = result.state === ADMIN_RECOMMENDATION_METRICS_STATES.LOADING;
  const isReady = result.state === ADMIN_RECOMMENDATION_METRICS_STATES.READY;

  return {
    state: result.state,
    latest: result.latest,
    error: result.error,
    pipelineStage,
    isLoading,
    isReady,
    refresh,
  };
}

export default useAdminRecommendationMetrics;
