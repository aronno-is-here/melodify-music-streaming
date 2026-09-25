import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT,
  PERSONALIZED_RECOMMENDATION_STATES,
  PERSONALIZED_RECOMMENDATION_ERROR_CODES,
  PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
  fetchPersonalizedRecommendations,
  shouldUseLegacyRecommendationFallback,
} from '../services/personalizedRecommendations.js';

const IDLE_RESULT = Object.freeze({
  state: PERSONALIZED_RECOMMENDATION_STATES.IDLE,
  songs: Object.freeze([]),
  snapshot: null,
  error: null,
});

const LOADING_RESULT = Object.freeze({
  state: PERSONALIZED_RECOMMENDATION_STATES.LOADING,
  songs: Object.freeze([]),
  snapshot: null,
  error: null,
});

const requestFailedResult = () => ({
  state: PERSONALIZED_RECOMMENDATION_STATES.ERROR,
  songs: [],
  snapshot: null,
  error: {
    code: PERSONALIZED_RECOMMENDATION_ERROR_CODES.REQUEST_FAILED,
    message: PERSONALIZED_RECOMMENDATION_FAILED_MESSAGE,
  },
});

export function usePersonalizedRecommendations(options = {}) {
  const limit = options.limit === undefined
    ? DEFAULT_PERSONALIZED_RECOMMENDATION_LIMIT
    : options.limit;
  const enabled = options.enabled !== false;

  const [result, setResult] = useState(IDLE_RESULT);
  const generationRef = useRef(0);

  const runRequest = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setResult(LOADING_RESULT);

    try {
      const classified = await fetchPersonalizedRecommendations({
        limit,
        apiClient: api,
      });
      if (generationRef.current !== generation) return;
      setResult(classified);
    } catch {
      if (generationRef.current !== generation) return;
      setResult(requestFailedResult());
    }
  }, [limit]);

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
        const classified = await fetchPersonalizedRecommendations({
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
  }, [enabled, limit]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    await runRequest();
  }, [enabled, runRequest]);

  const isLoading = result.state === PERSONALIZED_RECOMMENDATION_STATES.LOADING;
  const isReady = result.state === PERSONALIZED_RECOMMENDATION_STATES.READY;
  const shouldUseFallback = shouldUseLegacyRecommendationFallback(result.state);

  return {
    state: result.state,
    songs: result.songs,
    snapshot: result.snapshot,
    error: result.error,
    isLoading,
    isReady,
    shouldUseFallback,
    refresh,
  };
}

export default usePersonalizedRecommendations;
