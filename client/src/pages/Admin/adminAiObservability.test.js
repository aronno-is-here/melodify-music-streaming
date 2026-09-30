import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_AI_DASHBOARD_MESSAGES,
  ADMIN_AI_DASHBOARD_VIEWS,
  buildMetricCards,
  buildRunMetaCards,
} from './aiRecommendationMetricsUi.js';
import {
  ADMIN_AI_HISTORY_MESSAGES,
  ADMIN_AI_HISTORY_VIEWS,
} from './aiRecommendationHistoryUi.js';
import {
  ADMIN_AI_HEALTH_MESSAGES,
  ADMIN_AI_HEALTH_VIEWS,
} from './aiRecommendationHealthUi.js';
import {
  ADMIN_AI_PREFLIGHT_MESSAGES,
  ADMIN_AI_PREFLIGHT_VIEWS,
} from './aiRecommendationPreflightUi.js';
import { selectHistoryRun } from './aiRecommendationHistoryUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(join(__dirname, 'AdminAIRecommendation.jsx'), 'utf8')
  .replace(/\r\n/g, '\n');
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8').replace(/\r\n/g, '\n');

test('1: page header uses the checkpoint D title and subtitle', () => {
  assert.match(pageSource, /<div id="ai-recommendation" className="admin-page">/);
  assert.match(pageSource, /<h2>AI Recommendation<\/h2>/);
  assert.match(
    pageSource,
    /Monitor recommendation model status, snapshots, metrics, and serving health\./,
  );
  assert.equal(pageSource.includes('quality metrics and evaluation history'), false);
  assert.equal(/checkpoint|41\/43|40\/43|TODO|FIXME/i.test(pageSource), false);
});

test('2: observability panels each render with headings and subtitles', () => {
  const panels = [
    ['ai-rec-snapshot-heading', 'Current Snapshot'],
    ['ai-rec-history-heading', 'Evaluation History'],
    ['ai-rec-dataset-heading', 'Dataset Statistics'],
    ['ai-rec-repro-heading', 'Reproducibility Configuration'],
    ['ai-rec-health-heading', 'Model Health'],
    ['ai-rec-serving-heading', 'Data &amp; Serving Status'],
  ];
  for (const [id, title] of panels) {
    assert.ok(pageSource.includes(`<h3 id="${id}">${title}</h3>`), title);
    assert.ok(
      pageSource.includes(`aria-labelledby="${id}"`),
      `aria-labelledby for ${title}`,
    );
  }
  assert.match(pageSource, /<h3 id="ai-rec-metrics-heading">Metrics<\/h3>/);
  assert.equal((pageSource.match(/<h3 /g) || []).length, 7);
  assert.equal((pageSource.match(/aria-labelledby=/g) || []).length, 7);
  assert.match(pageSource, /admin-panel-subheading/);
});

test('3: stage selector keeps the shared pipeline-stage contract', () => {
  assert.match(pageSource, /aria-label="Pipeline stage"/);
  assert.match(pageSource, /role="group"/);
  assert.match(pageSource, /aria-pressed=\{stage === selectedStage\}/);
  assert.match(pageSource, /onClick=\{\(\) => handleStageChange\(stage\)\}/);
  const handle = pageSource.slice(
    pageSource.indexOf('const handleStageChange'),
    pageSource.indexOf('return ('),
  );
  assert.ok(
    handle.indexOf('setSelectedRunId(null)') > handle.indexOf('setSelectedStage(stage)'),
    'stage change clears the selected history run',
  );
});

test('4: page is observability only - no retraining or mutation controls', () => {
  assert.equal(/retrain/i.test(pageSource), false);
  assert.equal(/retrain/i.test(adminSource), false);
  for (const token of ['api.post', 'api.put', 'api.del', 'fetch(', 'useEffect', 'setInterval', 'setTimeout']) {
    assert.equal(pageSource.includes(token), false, token);
  }
  for (const token of ['Train Model', 'Evaluate Now', 'Activate', 'Deploy', 'Promote']) {
    assert.equal(pageSource.includes(token), false, token);
  }
  assert.equal((pageSource.match(/useState\(/g) || []).length, 2);
});

test('5: page reads only client hooks, services, and UI helpers', () => {
  const imports = [...pageSource.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
  assert.ok(imports.length >= 9);
  for (const path of imports) {
    const allowed =
      path === 'react' ||
      path.startsWith('../../hooks/') ||
      path.startsWith('../../services/') ||
      path.startsWith('./aiRecommendation');
    assert.ok(allowed, path);
  }
  assert.equal(/from '.*server\//.test(pageSource), false);
  assert.equal(pageSource.includes('child_process'), false);
  assert.equal(pageSource.includes('python'), false);
});

test('6: per-panel loading, unavailable, and error states use exact messages', () => {
  assert.equal(ADMIN_AI_DASHBOARD_VIEWS.LOADING, 'loading');
  assert.equal(ADMIN_AI_DASHBOARD_VIEWS.NO_RUNS, 'no-runs');
  assert.equal(ADMIN_AI_DASHBOARD_VIEWS.ERROR, 'error');
  assert.ok(ADMIN_AI_DASHBOARD_MESSAGES.NO_RUNS.length > 0);
  assert.ok(ADMIN_AI_HISTORY_MESSAGES.NO_RUNS.length > 0);
  assert.ok(ADMIN_AI_HEALTH_MESSAGES.ERROR.length > 0);
  assert.ok(ADMIN_AI_PREFLIGHT_MESSAGES.ERROR.length > 0);
  assert.ok(ADMIN_AI_HEALTH_VIEWS.READY === 'ready');
  assert.ok(ADMIN_AI_PREFLIGHT_VIEWS.READY === 'ready');
  assert.ok(ADMIN_AI_HISTORY_VIEWS.READY === 'ready');
  assert.equal(
    (pageSource.match(/ADMIN_AI_(DASHBOARD|HISTORY|HEALTH)_VIEWS\.LOADING/g) || []).length,
    3,
    'exactly three core sources own a loading branch',
  );
  assert.match(pageSource, /role="status" aria-live="polite"/);
  const alerts = (pageSource.match(/role="alert"/g) || []).length;
  assert.ok(alerts >= 3, `expected at least three alert branches, got ${alerts}`);
});

test('7: each source refreshes independently with its own retry', () => {
  assert.ok(
    pageSource.indexOf('onClick={() => refresh()}') < pageSource.indexOf('refreshHistory()'),
    'metrics retry precedes history refresh in source order',
  );
  assert.match(pageSource, /onClick=\{\(\) => refreshHistory\(\)\}/);
  assert.match(pageSource, /onClick=\{\(\) => refreshHealth\(\)\}/);
  assert.match(pageSource, /onClick=\{\(\) => refreshPreflight\(\)\}/);
  assert.match(pageSource, /const \{\s*state: metricsState/);
  assert.match(pageSource, /const \{\s*state: historyState/);
  assert.match(pageSource, /const \{\s*state: healthState/);
  assert.match(pageSource, /const \{\s*state: preflightState/);
});

test('8: metrics render only from a ready run with no zero placeholders', () => {
  assert.match(
    pageSource,
    /view === ADMIN_AI_DASHBOARD_VIEWS\.READY\s*\? buildMetricCards\(latest\.metrics\)/,
  );
  assert.match(
    pageSource,
    /view === ADMIN_AI_DASHBOARD_VIEWS\.READY\s*\? buildSummaryCards\(latest\.summary\)/,
  );
  assert.equal(buildMetricCards(null).length, 0);
  assert.equal(buildRunMetaCards(null).length, 0);
  assert.equal((pageSource.match(/\{card\.formatted \|\| 'Unavailable'\}/g) || []).length, 2);
  assert.equal(pageSource.includes('0.00%'), false, 'no hardcoded zero metric');
  assert.match(pageSource, /\{metaCards\.map\(/);
  assert.match(pageSource, /\{metricCards\.map\(/);
  assert.match(pageSource, /\{summaryCards\.map\(/);
});

test('9: evaluation history drives dataset and reproducibility sections', () => {
  assert.match(pageSource, /\{historyRuns\.map\(\(run\) => \{/);
  assert.match(pageSource, /onClick=\{\(\) => setSelectedRunId\(run\.run_id\)\}/);
  assert.match(pageSource, /\{selectedRun && \(/);
  assert.match(pageSource, /\{datasetCards\.map\(/);
  assert.match(pageSource, /\{reproCards\.map\(/);
  const runs = [
    { run_id: 'run-a', evaluated_at: '2026-09-01T00:00:00.000Z' },
    { run_id: 'run-b', evaluated_at: '2026-09-02T00:00:00.000Z' },
  ];
  assert.equal(selectHistoryRun(runs, null).run_id, 'run-a');
  assert.equal(selectHistoryRun(runs, 'run-b').run_id, 'run-b');
  assert.equal(
    selectHistoryRun(runs, 'missing').run_id,
    'run-a',
    'unknown selection falls back to the first run',
  );
  assert.equal(selectHistoryRun([], 'run-a'), null);
  assert.equal(pageSource.includes('buildDatasetCards(null'), false);
});

test('10: model health and preflight panels stay read-only', () => {
  assert.match(pageSource, /\{healthCards\.map\(/);
  assert.match(pageSource, /\{preflightCards\.map\(/);
  assert.match(pageSource, /getPreflightSufficiencyMessage\(preflightData\)/);
  assert.equal(pageSource.includes('runRecommendationRetraining'), false);
  assert.equal(pageSource.includes('collectRetrainingInput'), false);
  assert.equal(adminSource.includes('RECOMMENDATION_AI_ENABLED'), false);
});

test('11: one unavailable source cannot blank the whole page', () => {
  const headings = [
    'Current Snapshot',
    'Evaluation History',
    'Model Health',
    'Data &amp; Serving Status',
  ];
  for (const title of headings) {
    const guard = pageSource.indexOf(`<h3 id=`);
    assert.ok(guard >= 0);
    assert.ok(
      pageSource.includes(`${title}</h3>`),
      `${title} heading renders regardless of other sources`,
    );
  }
  assert.equal(
    (pageSource.match(/view === ADMIN_AI_DASHBOARD_VIEWS\.READY && \(/g) || []).length,
    2,
    'only the snapshot ready view and the metrics panel are gated behind a ready run',
  );
  assert.match(pageSource, /\{healthView === ADMIN_AI_HEALTH_VIEWS\.READY && \(/);
  assert.match(pageSource, /\{preflightView === ADMIN_AI_PREFLIGHT_VIEWS\.READY && \(/);
});

test('12: page source stays within the shared admin visual system', () => {
  for (const className of [
    'admin-page',
    'admin-page-header',
    'admin-page-subtitle',
    'admin-panel',
    'admin-panel-head',
    'admin-panel-subheading',
    'ai-rec-stage-selector',
    'ai-rec-state',
    'ai-rec-metric-grid',
    'ai-rec-history-list',
  ]) {
    assert.ok(pageSource.includes(className), className);
  }
  assert.equal(pageSource.includes('style={{'), false);
});
