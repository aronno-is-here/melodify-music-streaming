import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES,
  ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED_MESSAGE,
  ADMIN_RECOMMENDATION_PREFLIGHT_STATES,
  fetchAdminRecommendationPreflight,
} from '../services/adminRecommendationPreflight.js';

const IDLE_RESULT = Object.freeze({
  state: ADMIN_RECOMMENDATION_PREFLIGHT_STATES.IDLE,
  data: null,
  error: null,
});

const LOADING_RESULT = Object.freeze({
  state: ADMIN_RECOMMENDATION_PREFLIGHT_STATES.LOADING,
  data: null,
  error: null,
});

const requestFailedResult = () => ({
  state: ADMIN_RECOMMENDATION_PREFLIGHT_STATES.ERROR,
  data: null,
  error: {
    code: ADMIN_RECOMMENDATION_PREFLIGHT_ERROR_CODES.REQUEST_FAILED,
    message: ADMIN_RECOMMENDATION_PREFLIGHT_REQUEST_FAILED_MESSAGE,
  },
});

export function useAdminRecommendationPreflight(options = {}) {
  const enabled = options.enabled !== false;

  const [result, setResult] = useState(IDLE_RESULT);
  const generationRef = useRef(0);

  const runRequest = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setResult(LOADING_RESULT);

    try {
      const classified = await fetchAdminRecommendationPreflight({
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
        const classified = await fetchAdminRecommendationPreflight({
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
    result.state === ADMIN_RECOMMENDATION_PREFLIGHT_STATES.LOADING;
  const isReady = result.state === ADMIN_RECOMMENDATION_PREFLIGHT_STATES.READY;

  return {
    state: result.state,
    data: result.data,
    error: result.error,
    isLoading,
    isReady,
    refresh,
  };
}

export default useAdminRecommendationPreflight;
