import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8').replace(
    /\r\n/g,
    '\n',
  );

const ADMIN_SOURCE = readSource('./Admin.jsx');
const PAGE_SOURCE = readSource('./AdminAIRecommendation.jsx');
const APP_SOURCE = readSource('../../App.jsx');
const METRICS_UI = readSource('./aiRecommendationMetricsUi.js');
const HISTORY_UI = readSource('./aiRecommendationHistoryUi.js');
const HEALTH_UI = readSource('./aiRecommendationHealthUi.js');
const METRICS_HOOK = readSource('../../hooks/useAdminRecommendationMetrics.js');
const HISTORY_HOOK = readSource('../../hooks/useAdminRecommendationHistory.js');
const HEALTH_HOOK = readSource('../../hooks/useAdminRecommendationHealth.js');

const HANDLER_START = ADMIN_SOURCE.indexOf('const handleSectionClick');
const HANDLER_END = ADMIN_SOURCE.indexOf('const [stats', HANDLER_START);
const HANDLER = ADMIN_SOURCE.slice(HANDLER_START, HANDLER_END);
const AI_BRANCH_START = HANDLER.indexOf("if (s === 'ai-recommendation')");
const LEAVING_BRANCH_START = HANDLER.indexOf('if (location.pathname');
const AI_BRANCH = HANDLER.slice(AI_BRANCH_START, LEAVING_BRANCH_START);
const LEAVING_BRANCH = HANDLER.slice(
  LEAVING_BRANCH_START,
  HANDLER.indexOf('setSection(s);', LEAVING_BRANCH_START) + 'setSection(s);'.length,
);

// ============================================================
// CLICK HANDLER — the reported bug (click appeared to do nothing)
// ============================================================

test('click handler: definition exists and is single (no competing handler)', () => {
  assert.ok(HANDLER_START > 0, 'handleSectionClick must exist in Admin.jsx');
  assert.equal(
    (ADMIN_SOURCE.match(/const handleSectionClick = \(s\) =>/g) || []).length,
    1,
  );
  assert.ok(HANDLER_END > HANDLER_START, 'handler block must be complete');
});

test('click handler: clicking AI Recommendation sets the active section state, not only the URL', () => {
  assert.ok(AI_BRANCH_START > 0, 'AI branch exists');
  assert.ok(AI_BRANCH.includes("setSection('ai-recommendation');"), 'sets section state');
  assert.ok(
    AI_BRANCH.includes("navigate('/admin/ai-recommendation');"),
    'keeps URL navigation for refresh persistence',
  );
  assert.ok(AI_BRANCH.includes('return;'), 'branch does not fall through to setSection(s)');
});

test('click handler: leaving the AI route also updates the section state (no stale view)', () => {
  assert.ok(LEAVING_BRANCH_START > 0, 'leaving branch exists');
  assert.ok(
    LEAVING_BRANCH.includes("navigate('/admin', { state: { section: s } });"),
    'navigates back to /admin with section state',
  );
  assert.ok(LEAVING_BRANCH.includes('setSection(s);'), 'updates section state after leaving');
});

test('click handler: regular section clicks on /admin still set the section directly', () => {
  assert.ok(
    HANDLER.includes('    setSection(s);\n  };'),
    'fallthrough setSection(s) outside any condition',
  );
});

// ============================================================
// SIDEBAR WIRING + ACTIVE STATE
// ============================================================

test('sidebar: every section anchor is a real click target with active class mapping', () => {
  assert.ok(
    ADMIN_SOURCE.includes(
      `<a className={section === s ? 'active' : ''} onClick={() => handleSectionClick(s)}>`,
    ),
    'anchor maps section state to .active and calls the handler',
  );
});

test('sidebar: existing Admin sections remain present, unique, and ordered', () => {
  const sectionsLine = ADMIN_SOURCE.match(/const SECTIONS = \[([^\]]+)\]/);
  assert.ok(sectionsLine);
  const ids = sectionsLine[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(ids, [
    'dashboard',
    'users',
    'music',
    'missing-lyrics',
    'karaoke',
    'moderation',
    'subscriptions',
    'ai-recommendation',
  ]);
  assert.equal(new Set(ids).size, ids.length);
});

test('sidebar: .active anchor styling exists in Admin.css', () => {
  const css = readSource('./Admin.css');
  assert.match(css, /\.sidebar a\.active/);
});

// ============================================================
// ROUTE + RENDER SWITCH + REFRESH PERSISTENCE
// ============================================================

test('view: Admin render switch shows the AI observability view for the active section', () => {
  assert.ok(
    ADMIN_SOURCE.includes(
      `{section === 'ai-recommendation' && <AdminAIRecommendation />}`,
    ),
    'render switch for the section',
  );
  assert.ok(
    ADMIN_SOURCE.includes(`import AdminAIRecommendation from './AdminAIRecommendation.jsx'`),
    'page import present',
  );
  assert.ok(APP_SOURCE.includes('path="/admin/ai-recommendation"'), 'route target exists');
  const routeIdx = APP_SOURCE.indexOf('path="/admin/ai-recommendation"');
  const routeWindow = APP_SOURCE.slice(routeIdx, routeIdx + 250);
  assert.ok(routeWindow.includes('<AdminProtected>'), 'route stays behind AdminProtected');
});

test('refresh: initializer restores the AI section from the URL on a fresh page load', () => {
  assert.ok(
    ADMIN_SOURCE.includes(
      `if (location.pathname === '/admin/ai-recommendation') return 'ai-recommendation';`,
    ),
    'deep-link initializer branch',
  );
  assert.ok(
    ADMIN_SOURCE.includes('EXISTING_SECTIONS.has(location.state.section)'),
    'location.state section validated against known sections',
  );
});

test('sync: pathname effect restores the AI section when history navigation lands on the route', () => {
  const effect = `  useEffect(() => {
    if (location.pathname === '/admin/ai-recommendation') {
      setSection('ai-recommendation');
    }
  }, [location.pathname]);`;
  assert.ok(ADMIN_SOURCE.includes(effect), 'location.pathname sync effect present');
});

// ============================================================
// VISIBLE STATES — loading / empty / error / ready
// ============================================================

test('loading state: metrics, history, and health each render a status loading view', () => {
  assert.ok(PAGE_SOURCE.includes('{view === ADMIN_AI_DASHBOARD_VIEWS.LOADING && ('));
  assert.ok(PAGE_SOURCE.includes('{historyView === ADMIN_AI_HISTORY_VIEWS.LOADING && ('));
  assert.ok(PAGE_SOURCE.includes('{healthView === ADMIN_AI_HEALTH_VIEWS.LOADING && ('));
  assert.equal(
    (PAGE_SOURCE.match(/ADMIN_AI_(DASHBOARD|HISTORY|HEALTH)_VIEWS\.LOADING/g) || []).length,
    3,
  );
  assert.match(PAGE_SOURCE, /role="status" aria-live="polite"/);
  assert.ok(METRICS_UI.includes('Loading recommendation metrics.'));
  assert.ok(HISTORY_UI.includes('Loading evaluation history.'));
  assert.ok(HEALTH_UI.includes('Loading retraining health.'));
});

test('empty state: metrics and history no-runs views render with exact no-data messages', () => {
  assert.ok(PAGE_SOURCE.includes('{view === ADMIN_AI_DASHBOARD_VIEWS.NO_RUNS && ('));
  assert.ok(PAGE_SOURCE.includes('{historyView === ADMIN_AI_HISTORY_VIEWS.NO_RUNS && ('));
  assert.ok(
    METRICS_UI.includes(
      'No persisted evaluation run is available for this pipeline stage yet.',
    ),
  );
  assert.ok(
    HISTORY_UI.includes(
      'No persisted evaluation history is available for this pipeline stage yet.',
    ),
  );
});

test('empty state: health never-run message is wired through the helper into the ready cards', () => {
  assert.ok(HEALTH_UI.includes(`NEVER_RUN: 'No retraining run has completed yet.'`));
  assert.ok(HEALTH_UI.includes(`'never-run': ADMIN_AI_HEALTH_MESSAGES.NEVER_RUN`));
  assert.ok(PAGE_SOURCE.includes('healthCards'), 'health cards rendered');
});

test('error state: all three sections render alert views with explicit retry controls', () => {
  assert.ok(PAGE_SOURCE.includes('{view === ADMIN_AI_DASHBOARD_VIEWS.ERROR && ('));
  assert.ok(PAGE_SOURCE.includes('{historyView === ADMIN_AI_HISTORY_VIEWS.ERROR && ('));
  assert.ok(PAGE_SOURCE.includes('{healthView === ADMIN_AI_HEALTH_VIEWS.ERROR && ('));
  const alertCount = (PAGE_SOURCE.match(/role="alert"/g) || []).length;
  assert.ok(alertCount >= 3, `expected >= 3 role="alert" views, got ${alertCount}`);
  assert.ok(PAGE_SOURCE.includes('{ADMIN_AI_DASHBOARD_MESSAGES.RETRY}'));
  assert.ok(PAGE_SOURCE.includes('{ADMIN_AI_HISTORY_MESSAGES.RETRY}'));
  assert.ok(PAGE_SOURCE.includes('{ADMIN_AI_HEALTH_MESSAGES.RETRY}'));
  assert.ok(METRICS_UI.includes('Unable to load recommendation metrics.'));
  assert.ok(HISTORY_UI.includes('Unable to load evaluation history.'));
  assert.ok(HEALTH_UI.includes('Unable to load retraining health.'));
});

test('ready state: persisted observability data renders for metrics, history, and health', () => {
  assert.ok(PAGE_SOURCE.includes('{view === ADMIN_AI_DASHBOARD_VIEWS.READY && ('));
  assert.ok(PAGE_SOURCE.includes('{historyView === ADMIN_AI_HISTORY_VIEWS.READY && ('));
  assert.ok(PAGE_SOURCE.includes('{healthView === ADMIN_AI_HEALTH_VIEWS.READY && ('));
  for (const token of [
    'metaCards.map',
    'metricCards.map',
    'summaryCards.map',
    'historyRuns.map',
    'datasetCards.map',
    'reproCards.map',
    'healthCards.map',
  ]) {
    assert.ok(PAGE_SOURCE.includes(token), `renders ${token}`);
  }
  assert.ok(PAGE_SOURCE.includes('aria-pressed={stage === selectedStage}'));
  assert.ok(PAGE_SOURCE.includes('onClick={() => setSelectedRunId(run.run_id)}'));
});

// ============================================================
// NO POLLING / NO AUTO-RETRY
// ============================================================

test('no polling: page and hooks never auto-retry or poll (explicit refresh only)', () => {
  for (const [name, src] of [
    ['page', PAGE_SOURCE],
    ['metrics hook', METRICS_HOOK],
    ['history hook', HISTORY_HOOK],
    ['health hook', HEALTH_HOOK],
  ]) {
    assert.equal(src.includes('setInterval'), false, `${name}: setInterval`);
    assert.equal(src.includes('setTimeout'), false, `${name}: setTimeout`);
  }
  assert.equal(PAGE_SOURCE.includes('useEffect'), false, 'page has no effect-driven fetching');
  for (const hook of [METRICS_HOOK, HISTORY_HOOK, HEALTH_HOOK]) {
    assert.ok(hook.includes('refresh'), 'hook exposes explicit refresh()');
  }
});

// ============================================================
// NO RETRAIN CONTROL / NO AI TRAINING SURFACE
// ============================================================

test('no retrain control: page and Admin contain no retraining action, label, or endpoint', () => {
  for (const [name, src] of [
    ['page', PAGE_SOURCE],
    ['admin', ADMIN_SOURCE],
  ]) {
    assert.equal(/retrain/i.test(src), false, `${name}: retrain token`);
    assert.equal(/\bTrain\b/.test(src), false, `${name}: Train token`);
    assert.equal(/\bDeploy\b/.test(src), false, `${name}: Deploy token`);
    assert.equal(
      /recommendations\/retrain|\/retrain\b/.test(src),
      false,
      `${name}: retrain endpoint literal`,
    );
  }
  assert.equal(/\bActivate\b/.test(PAGE_SOURCE), false, 'page: Activate token');
  assert.equal(PAGE_SOURCE.includes('api.post'), false, 'page: no POST');
  assert.equal(PAGE_SOURCE.includes('api.put'), false, 'page: no PUT');
  assert.equal(PAGE_SOURCE.includes('api.del'), false, 'page: no DELETE');
  assert.equal(PAGE_SOURCE.includes('fetch('), false, 'page: no raw fetch');
});
