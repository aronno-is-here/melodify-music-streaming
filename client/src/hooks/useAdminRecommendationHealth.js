import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES,
  ADMIN_RECOMMENDATION_HEALTH_REQUEST_FAILED_MESSAGE,
  ADMIN_RECOMMENDATION_HEALTH_STATES,
  fetchAdminRecommendationHealth,
} from '../services/adminRecommendationHealth.js';

const IDLE_RESULT = Object.freeze({
  state: ADMIN_RECOMMENDATION_HEALTH_STATES.IDLE,
  backendState: null,
  lease: null,
  latest: null,
  error: null,
});

const LOADING_RESULT = Object.freeze({
  state: ADMIN_RECOMMENDATION_HEALTH_STATES.LOADING,
  backendState: null,
  lease: null,
  latest: null,
  error: null,
});

const requestFailedResult = () => ({
  state: ADMIN_RECOMMENDATION_HEALTH_STATES.ERROR,
  backendState: null,
  lease: null,
  latest: null,
  error: {
    code: ADMIN_RECOMMENDATION_HEALTH_ERROR_CODES.REQUEST_FAILED,
    message: ADMIN_RECOMMENDATION_HEALTH_REQUEST_FAILED_MESSAGE,
  },
});

export function useAdminRecommendationHealth(options = {}) {
  const enabled = options.enabled !== false;

  const [result, setResult] = useState(IDLE_RESULT);
  const generationRef = useRef(0);

  const runRequest = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setResult(LOADING_RESULT);

    try {
      const classified = await fetchAdminRecommendationHealth({
        apiClient: api,
      });
      if (generationRef.current !== generation) return;
      setResult(classified);
    } catch {
      if (generationRef.current !== generation) return;
      setResult(requestFailedResult());
    }
  }, []);

  useEffect(() => {
    generationRef.current += 1;

    if (!enabled) {
      setResult(IDLE_RESULT);
      return undefined;
    }

    const generation = generationRef.current;
    let cancelled = false;

    setResult(LOADING_RESULT);

    (async () => {
      try {
        const classified = await fetchAdminRecommendationHealth({
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
  }, [enabled]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    await runRequest();
  }, [enabled, runRequest]);

  const isLoading =
    result.state === ADMIN_RECOMMENDATION_HEALTH_STATES.LOADING;
  const isReady = result.state === ADMIN_RECOMMENDATION_HEALTH_STATES.READY;

  return {
    state: result.state,
    backendState: result.backendState,
    lease: result.lease,
    latest: result.latest,
    error: result.error,
    isLoading,
    isReady,
    refresh,
  };
}

export default useAdminRecommendationHealth;
