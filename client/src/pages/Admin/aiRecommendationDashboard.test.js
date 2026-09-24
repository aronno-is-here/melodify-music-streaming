import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  ADMIN_RECOMMENDATION_METRICS_PATH,
  ADMIN_RECOMMENDATION_PIPELINE_STAGES,
  DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE,
  fetchAdminRecommendationMetrics,
  normalizeAdminRecommendationMetricsResponse,
} from '../../services/adminRecommendationMetrics.js';
import {
  ADMIN_RECOMMENDATION_HISTORY_PATH,
  DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT,
  fetchAdminRecommendationHistory,
  normalizeAdminRecommendationHistoryResponse,
} from '../../services/adminRecommendationHistory.js';
import {
  ADMIN_AI_DASHBOARD_MESSAGES,
  ADMIN_AI_DASHBOARD_VIEWS,
  selectAdminRecommendationDashboardView,
} from './aiRecommendationMetricsUi.js';
import {
  ADMIN_AI_HISTORY_MESSAGES,
  ADMIN_AI_HISTORY_VIEWS,
  selectAdminRecommendationHistoryView,
  selectHistoryRun,
} from './aiRecommendationHistoryUi.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const PAGE_SOURCE = readSource('./AdminAIRecommendation.jsx');
const UI_SOURCE = readSource('./aiRecommendationMetricsUi.js');
const HOOK_SOURCE = readSource('../../hooks/useAdminRecommendationMetrics.js');
const SERVICE_SOURCE = readSource('../../services/adminRecommendationMetrics.js');
const HISTORY_UI_SOURCE = readSource('./aiRecommendationHistoryUi.js');
const HISTORY_HOOK_SOURCE = readSource(
  '../../hooks/useAdminRecommendationHistory.js',
);
const HISTORY_SERVICE_SOURCE = readSource(
  '../../services/adminRecommendationHistory.js',
);
const ADMIN_SOURCE = readSource('./Admin.jsx');
const CSS_SOURCE = readSource('./Admin.css');
const ALL_NEW = PAGE_SOURCE + UI_SOURCE + HOOK_SOURCE + SERVICE_SOURCE;
const ALL_HISTORY = PAGE_SOURCE + HISTORY_UI_SOURCE + HISTORY_HOOK_SOURCE
  + HISTORY_SERVICE_SOURCE;

// ============================================================
// PAGE WIRING
// ============================================================

test('page: heading remains exactly AI Recommendation', () => {
  assert.ok(PAGE_SOURCE.includes('<h2>AI Recommendation</h2>'));
  assert.equal(PAGE_SOURCE.includes('AI Recommendations'), false);
});

test('page: uses the 41/43 hook for metrics state', () => {
  assert.ok(PAGE_SOURCE.includes("useAdminRecommendationMetrics"));
  assert.ok(PAGE_SOURCE.includes("from '../../hooks/useAdminRecommendationMetrics.js'"));
});

test('page: does not call the HTTP client directly', () => {
  assert.equal(PAGE_SOURCE.includes('api.get'), false);
  assert.equal(PAGE_SOURCE.includes('fetch('), false);
  assert.equal(PAGE_SOURCE.includes('axios'), false);
  assert.equal(PAGE_SOURCE.includes("from '../../api/client.js'"), false);
});

test('page: does not embed the metrics path literal', () => {
  assert.equal(PAGE_SOURCE.includes(ADMIN_RECOMMENDATION_METRICS_PATH), false);
  assert.equal(PAGE_SOURCE.includes('/api/admin/recommendations'), false);
  assert.equal(PAGE_SOURCE.includes('recommendations/metrics'), false);
});

test('page: stage selector defaults to policy and lists three stages', () => {
  assert.ok(PAGE_SOURCE.includes('DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE'));
  assert.equal(DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE, 'policy');
  assert.equal(ADMIN_RECOMMENDATION_PIPELINE_STAGES.length, 3);
  assert.ok(PAGE_SOURCE.includes('ADMIN_RECOMMENDATION_PIPELINE_STAGES.map'));
  assert.ok(PAGE_SOURCE.includes('aria-pressed='));
  assert.ok(PAGE_SOURCE.includes("aria-label=\"Pipeline stage\""));
});

test('page: loading view uses role status and aria-live polite', () => {
  assert.ok(PAGE_SOURCE.includes('role="status"'));
  assert.ok(PAGE_SOURCE.includes('aria-live="polite"'));
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_DASHBOARD_MESSAGES.LOADING'));
});

test('page: error view has alert role and Retry refresh', () => {
  assert.ok(PAGE_SOURCE.includes('role="alert"'));
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_DASHBOARD_MESSAGES.ERROR'));
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_DASHBOARD_MESSAGES.RETRY'));
  assert.ok(PAGE_SOURCE.includes('refresh()'));
});

test('page: no-runs view uses dedicated message constant', () => {
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_DASHBOARD_MESSAGES.NO_RUNS'));
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_DASHBOARD_VIEWS.NO_RUNS'));
  assert.equal(
    ADMIN_AI_DASHBOARD_MESSAGES.NO_RUNS,
    'No persisted evaluation run is available for this pipeline stage yet.',
  );
});

test('page: ready view renders meta, metrics, and summary grids', () => {
  assert.ok(PAGE_SOURCE.includes('buildRunMetaCards'));
  assert.ok(PAGE_SOURCE.includes('buildMetricCards'));
  assert.ok(PAGE_SOURCE.includes('buildSummaryCards'));
  assert.ok(PAGE_SOURCE.includes('ai-rec-metric-grid'));
  assert.ok(PAGE_SOURCE.includes('ai-rec-summary-grid'));
  assert.ok(PAGE_SOURCE.includes('ai-rec-meta'));
});

test('page: view states drive exclusive branches via helper', () => {
  assert.ok(PAGE_SOURCE.includes('selectAdminRecommendationDashboardView'));
  for (const view of [
    ADMIN_AI_DASHBOARD_VIEWS.LOADING,
    ADMIN_AI_DASHBOARD_VIEWS.READY,
    ADMIN_AI_DASHBOARD_VIEWS.NO_RUNS,
    ADMIN_AI_DASHBOARD_VIEWS.ERROR,
  ]) {
    assert.ok(PAGE_SOURCE.includes(`ADMIN_AI_DASHBOARD_VIEWS.${view.toUpperCase().replace('-', '_')}`) || PAGE_SOURCE.includes(view), view);
  }
  assert.equal(selectAdminRecommendationDashboardView('ready'), 'ready');
});

test('page: no derived ratio or overall labels rendered', () => {
  for (const token of [
    'overall_score',
    'quality_score',
    'composite_score',
    'best_model',
    'winner',
    'winning',
    'grade',
    'tier',
    'Overall',
    'Best Stage',
    'Model Accuracy',
  ]) {
    assert.equal(ALL_NEW.includes(token), false, token);
  }
});

test('page: metrics modules stay history-free and page embeds no history path literal', () => {
  for (const src of [UI_SOURCE, HOOK_SOURCE, SERVICE_SOURCE]) {
    assert.equal(src.includes('/api/admin/recommendations/history'), false);
    assert.equal(src.includes('/api/admin/recommendations/dataset'), false);
    assert.equal(src.includes('recommendation-history'), false);
    assert.equal(src.includes('dataset_stats'), false);
    assert.equal(src.includes('raw_event_count'), false);
  }
  assert.equal(PAGE_SOURCE.includes('/api/admin/recommendations'), false);
  assert.equal(PAGE_SOURCE.includes('raw_event_count'), false);
  assert.equal(PAGE_SOURCE.includes('dataset_stats'), false);
});

test('page: no snapshot payload SHA or configuration rendering', () => {
  for (const token of ['payload_sha256', 'configuration', 'random_seed', 'schema_version']) {
    assert.equal(PAGE_SOURCE.includes(token), false, token);
  }
});

test('page: no feature flag gate', () => {
  for (const src of [PAGE_SOURCE, UI_SOURCE, HOOK_SOURCE, SERVICE_SOURCE]) {
    assert.equal(src.includes('RECOMMENDATION_AI_ENABLED'), false);
    assert.equal(src.includes('recommendationConfig'), false);
    assert.equal(src.includes('aiEnabled'), false);
  }
});

test('page: no polling, randomness, or retrain actions', () => {
  for (const src of [PAGE_SOURCE, UI_SOURCE, HOOK_SOURCE, SERVICE_SOURCE]) {
    assert.equal(src.includes('setInterval'), false);
    assert.equal(src.includes('Math.random'), false);
    assert.equal(src.includes('setTimeout'), false);
    assert.equal(/retrain|re-training/i.test(src), false);
    assert.equal(src.includes('api.post'), false);
    assert.equal(src.includes('api.put'), false);
    assert.equal(src.includes('api.del'), false);
  }
});

test('page: no Python/model/server imports', () => {
  for (const token of [
    'TruncatedSVD',
    'train_collaborative_model',
    'evaluate_recommendations',
    'rank_hybrid_candidates',
    'rank_with_cold_start_policy',
    'child_process',
    'RecommendationEvaluationRun',
    'RecommendationSnapshot',
    'from \'server',
    'ml/',
    'PlayerContext',
    'usePersonalizedRecommendations',
    'pages/Dashboard',
    '../Dashboard',
  ]) {
    assert.equal(PAGE_SOURCE.includes(token), false, token);
    assert.equal(UI_SOURCE.includes(token), false, token);
    assert.equal(HOOK_SOURCE.includes(token), false, token);
  }
});

test('page: no auth role/JWT parsing on the page', () => {
  assert.equal(PAGE_SOURCE.includes('localStorage'), false);
  assert.equal(PAGE_SOURCE.includes('jsonwebtoken'), false);
  assert.equal(PAGE_SOURCE.includes('atob('), false);
  assert.equal(PAGE_SOURCE.includes('Bearer '), false);
  assert.equal(PAGE_SOURCE.includes('user.role'), false);
  assert.equal(PAGE_SOURCE.includes('isAdmin'), false);
});

test('page: still rendered from Admin content area', () => {
  assert.ok(ADMIN_SOURCE.includes("section === 'ai-recommendation' && <AdminAIRecommendation />"));
  assert.ok(ADMIN_SOURCE.includes("import AdminAIRecommendation from './AdminAIRecommendation.jsx'"));
});

// ============================================================
// SERVICE CONTRACT (client)
// ============================================================

test('service: exports exact path and default stage', () => {
  assert.equal(ADMIN_RECOMMENDATION_METRICS_PATH, '/api/admin/recommendations/metrics');
  assert.equal(DEFAULT_ADMIN_RECOMMENDATION_PIPELINE_STAGE, 'policy');
});

test('service: normalize ready preserves ten metrics and seven summary keys', () => {
  const metrics = {
    precision_at_5: 1,
    precision_at_10: 1,
    recall_at_5: 1,
    recall_at_10: 1,
    ndcg_at_5: 1,
    ndcg_at_10: 1,
    map_at_10: 1,
    hit_rate_at_10: 1,
    catalog_coverage: 1,
    diversity: 1,
  };
  const summary = {
    evaluated_user_count: 1,
    recommendation_user_count: 1,
    relevance_user_count: 1,
    catalog_size: 1,
    unique_recommended_at_10: 1,
    diversity_evaluable_user_count: 1,
    diversity_pair_count: 1,
  };
  const result = normalizeAdminRecommendationMetricsResponse(
    {
      success: true,
      data: {
        state: 'ready',
        source: 'evaluation-history',
        pipeline_stage: 'policy',
        latest: {
          run_id: 'r1',
          pipeline_stage: 'policy',
          artifact_version: null,
          evaluated_at: '2026-09-15T00:00:00.000Z',
          metrics,
          summary,
        },
      },
    },
    { pipelineStage: 'policy' },
  );
  assert.equal(result.state, 'ready');
  assert.deepEqual(Object.keys(result.latest.metrics), Object.keys(metrics));
  assert.deepEqual(Object.keys(result.latest.summary), Object.keys(summary));
});

test('service: fetch is async one-call helper and rejects bad stages', async () => {
  let calls = 0;
  const bad = await fetchAdminRecommendationMetrics({
    pipelineStage: 'Policy',
    apiClient: { get: async () => { calls += 1; return {}; } },
  });
  assert.equal(calls, 0);
  assert.equal(bad.state, 'error');
  const good = await fetchAdminRecommendationMetrics({
    pipelineStage: 'collaborative',
    apiClient: {
      get: async () => {
        calls += 1;
        return {
          success: true,
          data: {
            state: 'no-runs',
            source: 'evaluation-history',
            pipeline_stage: 'collaborative',
            latest: null,
          },
        };
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(good.state, 'no-runs');
});

// ============================================================
// HOOK SOURCE
// ============================================================

test('hook: uses generation counter for race safety', () => {
  assert.ok(HOOK_SOURCE.includes('generationRef'));
  assert.ok(HOOK_SOURCE.includes('cancelled'));
});

test('hook: stage change path clears latest by entering loading first', () => {
  assert.ok(HOOK_SOURCE.includes('LOADING_RESULT'));
  assert.ok(HOOK_SOURCE.includes('latest: null'));
  assert.ok(HOOK_SOURCE.includes('[enabled, pipelineStage]'));
});

test('hook: exposes refresh and derived flags', () => {
  assert.ok(HOOK_SOURCE.includes('refresh'));
  assert.ok(HOOK_SOURCE.includes('isLoading'));
  assert.ok(HOOK_SOURCE.includes('isReady'));
  assert.ok(HOOK_SOURCE.includes('pipelineStage'));
});

test('hook: no polling or auto-retry', () => {
  assert.equal(HOOK_SOURCE.includes('setInterval'), false);
  assert.equal(HOOK_SOURCE.includes('setTimeout'), false);
  assert.equal(HOOK_SOURCE.includes('retryCount'), false);
});

test('hook: reuses shared api client', () => {
  assert.ok(HOOK_SOURCE.includes("from '../api/client.js'"));
  assert.ok(HOOK_SOURCE.includes('apiClient: api'));
});

// ============================================================
// CSS
// ============================================================

test('css: selector, metric, summary, and state styles exist', () => {
  for (const selector of [
    '.ai-rec-stage-selector',
    '.ai-rec-stage-btn',
    '.ai-rec-metric-grid',
    '.ai-rec-summary-grid',
    '.ai-rec-meta',
    '.ai-rec-state',
    '.ai-rec-error',
  ]) {
    assert.ok(CSS_SOURCE.includes(selector), selector);
  }
});

test('css: responsive grids use auto-fill without JS viewport logic', () => {
  assert.ok(CSS_SOURCE.includes('repeat(auto-fill, minmax('));
  assert.equal(PAGE_SOURCE.includes('window.innerWidth'), false);
  assert.equal(PAGE_SOURCE.includes('matchMedia'), false);
});

// ============================================================
// STATIC SAFETY (new/changed client code)
// ============================================================

test('static safety: forbidden tokens absent from all new client code', () => {
  const forbidden = [
    '/api/admin/recommendations/history',
    '/api/admin/recommendations/dataset',
    'overall_score',
    'quality_score',
    'composite_score',
    'best_model',
    'winner',
    'winning',
    'grade',
    'tier',
    'TruncatedSVD',
    'train_collaborative_model',
    'evaluate_recommendations',
    'rank_hybrid_candidates',
    'rank_with_cold_start_policy',
    'child_process',
    'Math.random',
    'setInterval',
    'payload_sha256',
    'RECOMMENDATION_AI_ENABLED',
    'recommendationConfig.aiEnabled',
  ];
  for (const token of forbidden) {
    assert.equal(ALL_NEW.includes(token), false, token);
  }
});

test('static safety: no raw server metric key rendering required on page', () => {
  for (const key of [
    'precision_at_5',
    'precision_at_10',
    'recall_at_5',
    'ndcg_at_5',
    'map_at_10',
    'hit_rate_at_10',
    'catalog_coverage',
  ]) {
    assert.equal(PAGE_SOURCE.includes(key), false, key);
  }
  assert.equal(UI_SOURCE.includes('precision_at_5'), true);
});

test('static safety: no session/token leakage strings', () => {
  for (const token of ['melodify_token', 'Authorization', 'JWT_SECRET', 'password']) {
    assert.equal(ALL_NEW.includes(token), false, token);
  }
});

test('view helper: exclusive view keys avoid raw no-runs literal on page', () => {
  assert.equal(PAGE_SOURCE.includes("'no-runs'"), false);
  assert.equal(PAGE_SOURCE.includes('"no-runs"'), false);
  assert.equal(UI_SOURCE.includes("NO_RUNS: 'no-runs'"), true);
  assert.equal(HISTORY_UI_SOURCE.includes("NO_RUNS: 'no-runs'"), true);
});

// ============================================================
// HISTORY PAGE INTEGRATION (42/43)
// ============================================================

test('history page: uses the 42/43 history hook with shared stage selector', () => {
  assert.ok(PAGE_SOURCE.includes('useAdminRecommendationHistory'));
  assert.ok(
    PAGE_SOURCE.includes(
      "from '../../hooks/useAdminRecommendationHistory.js'",
    ),
  );
  assert.equal(
    (PAGE_SOURCE.match(/useState\(/g) || []).length,
    2,
    'stage selector + local run selection only',
  );
  assert.equal(PAGE_SOURCE.includes('useEffect'), false);
  assert.ok(PAGE_SOURCE.includes('handleStageChange'));
  assert.ok(PAGE_SOURCE.includes('setSelectedRunId(null)'));
});

test('history page: renders the three required section headings', () => {
  assert.ok(PAGE_SOURCE.includes('>Evaluation History</h3>'));
  assert.ok(PAGE_SOURCE.includes('>Dataset Statistics</h3>'));
  assert.ok(PAGE_SOURCE.includes('>Reproducibility Configuration</h3>'));
});

test('history page: history error retry refreshes history only', () => {
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_HISTORY_MESSAGES.ERROR'));
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_HISTORY_MESSAGES.RETRY'));
  assert.ok(PAGE_SOURCE.includes('refreshHistory()'));
  assert.ok(PAGE_SOURCE.includes('refresh()'));
  const historyRetryIndex = PAGE_SOURCE.indexOf('refreshHistory()');
  const metricsRetryIndex = PAGE_SOURCE.indexOf('refresh()');
  assert.ok(historyRetryIndex >= 0);
  assert.ok(metricsRetryIndex >= 0);
  assert.ok(historyRetryIndex > metricsRetryIndex);
});

test('history page: no-runs and loading use history message constants with roles', () => {
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_HISTORY_MESSAGES.LOADING'));
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_HISTORY_MESSAGES.NO_RUNS'));
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_HISTORY_VIEWS'));
  assert.equal(
    ADMIN_AI_HISTORY_MESSAGES.NO_RUNS,
    'No persisted evaluation history is available for this pipeline stage yet.',
  );
  assert.equal(
    ADMIN_AI_HISTORY_MESSAGES.ERROR,
    'Unable to load evaluation history.',
  );
});

test('history page: local run selection via selectHistoryRun and aria-pressed rows', () => {
  assert.ok(PAGE_SOURCE.includes('selectHistoryRun'));
  assert.ok(PAGE_SOURCE.includes('setSelectedRunId(run.run_id)'));
  assert.ok(PAGE_SOURCE.includes('ai-rec-history-row'));
  assert.ok(PAGE_SOURCE.includes('aria-pressed={stage === selectedStage}'));
  assert.ok(PAGE_SOURCE.includes('aria-pressed={isSelected}'));
});

test('history page: dataset and configuration cards come from UI helpers', () => {
  assert.ok(PAGE_SOURCE.includes('buildDatasetCards'));
  assert.ok(PAGE_SOURCE.includes('buildConfigurationCards'));
  assert.ok(PAGE_SOURCE.includes('selectedRun'));
  assert.equal(PAGE_SOURCE.includes('raw_event_count'), false);
  assert.equal(PAGE_SOURCE.includes('random_seed'), false);
  assert.equal(PAGE_SOURCE.includes('configuration.'), false);
});

test('history page: no train/retrain/write actions or second stage selector', () => {
  assert.equal(/retrain|re-training/i.test(PAGE_SOURCE), false);
  assert.equal(PAGE_SOURCE.includes('api.post'), false);
  assert.equal(PAGE_SOURCE.includes('api.put'), false);
  assert.equal(
    (PAGE_SOURCE.match(/ADMIN_RECOMMENDATION_PIPELINE_STAGES\.map/g) || [])
      .length,
    1,
  );
  assert.equal(PAGE_SOURCE.includes('setInterval'), false);
  assert.equal(PAGE_SOURCE.includes('Math.random'), false);
});

// ============================================================
// HISTORY SERVICE CONTRACT (client)
// ============================================================

test('history service: exports exact path, source, default limit 20', () => {
  assert.equal(
    ADMIN_RECOMMENDATION_HISTORY_PATH,
    '/api/admin/recommendations/history',
  );
  assert.equal(DEFAULT_ADMIN_RECOMMENDATION_HISTORY_LIMIT, 20);
});

test('history service: normalize no-runs and ready envelopes', () => {
  const noRuns = normalizeAdminRecommendationHistoryResponse(
    {
      success: true,
      data: {
        state: 'no-runs',
        source: 'evaluation-history',
        pipeline_stage: 'policy',
        limit: 20,
        count: 0,
        runs: [],
      },
    },
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(noRuns.state, 'no-runs');
  assert.deepEqual(noRuns.runs, []);

  const ready = normalizeAdminRecommendationHistoryResponse(
    {
      success: true,
      data: {
        state: 'ready',
        source: 'evaluation-history',
        pipeline_stage: 'policy',
        limit: 20,
        count: 1,
        runs: [
          {
            run_id: 'r1',
            pipeline_stage: 'policy',
            artifact_version: null,
            evaluated_at: '2026-09-15T00:00:00.000Z',
            metrics: Object.fromEntries(
              [
                'precision_at_5',
                'precision_at_10',
                'recall_at_5',
                'recall_at_10',
                'ndcg_at_5',
                'ndcg_at_10',
                'map_at_10',
                'hit_rate_at_10',
                'catalog_coverage',
                'diversity',
              ].map((k) => [k, 0.5]),
            ),
            summary: Object.fromEntries(
              [
                'evaluated_user_count',
                'recommendation_user_count',
                'relevance_user_count',
                'catalog_size',
                'unique_recommended_at_10',
                'diversity_evaluable_user_count',
                'diversity_pair_count',
              ].map((k) => [k, 1]),
            ),
            dataset: Object.fromEntries(
              [
                'raw_event_count',
                'train_event_count',
                'validation_event_count',
                'test_event_count',
                'unique_user_count',
                'unique_song_count',
                'session_count',
                'interaction_pair_count',
                'content_feature_count',
              ].map((k) => [k, 0]),
            ),
            configuration: { random_seed: 42 },
          },
        ],
      },
    },
    { pipelineStage: 'policy', limit: 20 },
  );
  assert.equal(ready.state, 'ready');
  assert.equal(ready.count, 1);
  assert.equal(ready.runs[0].run_id, 'r1');
});

test('history service: fetch is async one-call helper and rejects bad inputs', async () => {
  let calls = 0;
  const bad = await fetchAdminRecommendationHistory({
    pipelineStage: 'Policy',
    limit: 20,
    apiClient: {
      get: async () => {
        calls += 1;
        return {};
      },
    },
  });
  assert.equal(calls, 0);
  assert.equal(bad.state, 'error');

  const good = await fetchAdminRecommendationHistory({
    pipelineStage: 'collaborative',
    limit: 5,
    apiClient: {
      get: async () => {
        calls += 1;
        return {
          success: true,
          data: {
            state: 'no-runs',
            source: 'evaluation-history',
            pipeline_stage: 'collaborative',
            limit: 5,
            count: 0,
            runs: [],
          },
        };
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(good.state, 'no-runs');
});

// ============================================================
// HISTORY HOOK SOURCE
// ============================================================

test('history hook: uses generation counter and clears runs on stage change', () => {
  assert.ok(HISTORY_HOOK_SOURCE.includes('generationRef'));
  assert.ok(HISTORY_HOOK_SOURCE.includes('cancelled'));
  assert.ok(HISTORY_HOOK_SOURCE.includes('LOADING_RESULT'));
  assert.ok(HISTORY_HOOK_SOURCE.includes('runs: []'));
  assert.ok(HISTORY_HOOK_SOURCE.includes('[enabled, pipelineStage, limit]'));
});

test('history hook: exposes refresh and derived flags without polling', () => {
  assert.ok(HISTORY_HOOK_SOURCE.includes('refresh'));
  assert.ok(HISTORY_HOOK_SOURCE.includes('isLoading'));
  assert.ok(HISTORY_HOOK_SOURCE.includes('isReady'));
  assert.equal(HISTORY_HOOK_SOURCE.includes('setInterval'), false);
  assert.equal(HISTORY_HOOK_SOURCE.includes('setTimeout'), false);
  assert.equal(HISTORY_HOOK_SOURCE.includes('retryCount'), false);
  assert.ok(HISTORY_HOOK_SOURCE.includes("from '../api/client.js'"));
  assert.ok(HISTORY_HOOK_SOURCE.includes('apiClient: api'));
});

// ============================================================
// HISTORY UI HELPER INTEGRATION
// ============================================================

test('history ui: selectAdminRecommendationHistoryView covers all five states', () => {
  assert.equal(selectAdminRecommendationHistoryView('idle'), 'loading');
  assert.equal(selectAdminRecommendationHistoryView('loading'), 'loading');
  assert.equal(selectAdminRecommendationHistoryView('ready'), 'ready');
  assert.equal(selectAdminRecommendationHistoryView('no-runs'), 'no-runs');
  assert.equal(selectAdminRecommendationHistoryView('error'), 'error');
  assert.throws(() => selectAdminRecommendationHistoryView('bogus'));
  assert.deepEqual(Object.keys(ADMIN_AI_HISTORY_VIEWS).sort(), [
    'ERROR',
    'LOADING',
    'NO_RUNS',
    'READY',
  ]);
});

test('history ui: selectHistoryRun defaults to first and preserves selection', () => {
  const runs = [{ run_id: 'a' }, { run_id: 'b' }];
  assert.equal(selectHistoryRun(runs, null).run_id, 'a');
  assert.equal(selectHistoryRun(runs, 'b').run_id, 'b');
  assert.equal(selectHistoryRun(runs, 'gone').run_id, 'a');
  assert.equal(selectHistoryRun([], null), null);
  assert.equal(selectHistoryRun(null, 'a'), null);
});

// ============================================================
// CSS (history)
// ============================================================

test('css: history row styles exist alongside metrics styles', () => {
  for (const selector of [
    '.ai-rec-history-list',
    '.ai-rec-history-row',
    '.ai-rec-history-cell',
  ]) {
    assert.ok(CSS_SOURCE.includes(selector), selector);
  }
});

// ============================================================
// STATIC SAFETY (history additions)
// ============================================================

test('static safety: history additions free of forbidden tokens', () => {
  const forbidden = [
    'overall_score',
    'quality_score',
    'composite_score',
    'best_model',
    'winner',
    'winning',
    'grade',
    'tier',
    'TruncatedSVD',
    'train_collaborative_model',
    'evaluate_recommendations',
    'rank_hybrid_candidates',
    'rank_with_cold_start_policy',
    'child_process',
    'Math.random',
    'setInterval',
    'payload_sha256',
    'RECOMMENDATION_AI_ENABLED',
    'recommendationConfig.aiEnabled',
    'schema_version',
    'Train/Retrain',
    'Activate',
    'Deploy',
    'Promote',
  ];
  for (const token of forbidden) {
    assert.equal(ALL_HISTORY.includes(token), false, token);
  }
});

test('static safety: history path literal only in history service module', () => {
  assert.equal(HISTORY_SERVICE_SOURCE.includes(ADMIN_RECOMMENDATION_HISTORY_PATH), true);
  assert.equal(PAGE_SOURCE.includes('/api/admin/recommendations'), false);
  assert.equal(HISTORY_HOOK_SOURCE.includes('/api/admin/recommendations'), false);
  assert.equal(HISTORY_UI_SOURCE.includes('/api/admin/recommendations'), false);
});

test('static safety: no session/token leakage in history additions', () => {
  for (const token of [
    'melodify_token',
    'Authorization',
    'JWT_SECRET',
    'password',
    'localStorage',
    'Bearer ',
  ]) {
    assert.equal(ALL_HISTORY.includes(token), false, token);
  }
});

test('static safety: no Python/server/Dashboard imports in history additions', () => {
  for (const src of [
    PAGE_SOURCE,
    HISTORY_UI_SOURCE,
    HISTORY_HOOK_SOURCE,
    HISTORY_SERVICE_SOURCE,
  ]) {
    for (const token of [
      'TruncatedSVD',
      'child_process',
      'RecommendationEvaluationRun',
      'RecommendationSnapshot',
      'from \'server',
      'ml/',
      'PlayerContext',
      'usePersonalizedRecommendations',
      'pages/Dashboard',
      '../Dashboard',
    ]) {
      assert.equal(src.includes(token), false, token);
    }
  }
});

test('static safety: no HTTP verbs beyond GET in history client stack', () => {
  for (const src of [HISTORY_SERVICE_SOURCE, HISTORY_HOOK_SOURCE]) {
    assert.equal(src.includes('api.post'), false);
    assert.equal(src.includes('api.put'), false);
    assert.equal(src.includes('api.del'), false);
    assert.equal(src.includes('api.patch'), false);
    assert.equal(src.includes('axios'), false);
    assert.equal(src.includes('fetch('), false);
  }
});
