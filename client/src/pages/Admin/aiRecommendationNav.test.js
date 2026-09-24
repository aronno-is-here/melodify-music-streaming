import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const ADMIN_SOURCE = readSource('./Admin.jsx');
const APP_SOURCE = readSource('../../App.jsx');
const PAGE_SOURCE = readSource('./AdminAIRecommendation.jsx');
const UI_SOURCE = readSource('./aiRecommendationMetricsUi.js');
const HOOK_SOURCE = readSource('../../hooks/useAdminRecommendationMetrics.js');
const SERVICE_SOURCE = readSource('../../services/adminRecommendationMetrics.js');

// ============================================================
// NAV ENTRY
// ============================================================

test('nav: visible label is exactly "AI Recommendation"', () => {
  assert.match(ADMIN_SOURCE, /if \(s === 'ai-recommendation'\) return 'AI Recommendation';/);
  assert.equal(/AI Recommendations|Recommendation AI|ML Recommendations|Recommendation Metrics|Model Dashboard/.test(ADMIN_SOURCE), false);
});

test('nav: destination path is /admin/ai-recommendation', () => {
  assert.ok(ADMIN_SOURCE.includes("navigate('/admin/ai-recommendation')"));
  assert.ok(APP_SOURCE.includes('path="/admin/ai-recommendation"'));
});

test('nav: exactly one AI Recommendation section id in SECTIONS', () => {
  const matches = ADMIN_SOURCE.match(/'ai-recommendation'/g) || [];
  assert.ok(matches.length >= 1);
  const sectionsLine = ADMIN_SOURCE.match(/const SECTIONS = \[([^\]]+)\]/);
  assert.ok(sectionsLine);
  const ids = sectionsLine[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.equal(ids.filter((id) => id === 'ai-recommendation').length, 1);
});

test('nav: existing Admin items remain present and order preserved except insertion', () => {
  const sectionsLine = ADMIN_SOURCE.match(/const SECTIONS = \[([^\]]+)\]/);
  assert.ok(sectionsLine);
  const ids = sectionsLine[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(ids, [
    'dashboard',
    'users',
    'music',
    'karaoke',
    'moderation',
    'subscriptions',
    'ai-recommendation',
  ]);
});

test('nav: existing labels unchanged (karaoke + default capitalization path preserved)', () => {
  assert.ok(ADMIN_SOURCE.includes("if (s === 'karaoke') return 'Melodify Studio';"));
  assert.ok(ADMIN_SOURCE.includes("s.charAt(0).toUpperCase() + s.slice(1).replace('moderation', ' Content Moderation')"));
  assert.equal(ADMIN_SOURCE.includes("return 'Melodify Studio';") && ADMIN_SOURCE.includes('sectionLabel'), true);
});

test('nav: no duplicate destination keys in SECTIONS', () => {
  const sectionsLine = ADMIN_SOURCE.match(/const SECTIONS = \[([^\]]+)\]/);
  const ids = sectionsLine[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.equal(new Set(ids).size, ids.length);
});

test('nav: uses existing text sidebar convention (no new icon package / no emoji icon for nav)', () => {
  assert.equal(/lucide|react-icons|@heroicons|react-icons\/|from 'lucide-react'/.test(ADMIN_SOURCE), false);
  const sidebarBlock = ADMIN_SOURCE.slice(ADMIN_SOURCE.indexOf('<nav className="sidebar">'), ADMIN_SOURCE.indexOf('</nav>'));
  assert.equal(/<i |<svg |icon=|Icon/.test(sidebarBlock), false);
  assert.ok(sidebarBlock.includes('{sectionLabel(s)}'));
});

test('nav: no new icon dependency imported in Admin or page', () => {
  for (const src of [ADMIN_SOURCE, PAGE_SOURCE]) {
    assert.equal(/from ['"]lucide/.test(src), false);
    assert.equal(/from ['"]react-icons/.test(src), false);
    assert.equal(/from ['"]@heroicons/.test(src), false);
  }
});

// ============================================================
// ROUTE
// ============================================================

test('route: /admin/ai-recommendation exists in App', () => {
  assert.ok(APP_SOURCE.includes('path="/admin/ai-recommendation"'));
});

test('route: path is rendered through Admin (shell) under AdminProtected', () => {
  const idx = APP_SOURCE.indexOf('path="/admin/ai-recommendation"');
  assert.ok(idx >= 0);
  const window = APP_SOURCE.slice(idx, idx + 250);
  assert.ok(window.includes('<AdminProtected>'));
  assert.ok(window.includes('<Admin />'));
});

test('route: reuses the existing AdminProtected guard (same helper as /admin)', () => {
  assert.equal(APP_SOURCE.includes('function AdminProtected'), true);
  const adminProtectedCount = (APP_SOURCE.match(/<AdminProtected>/g) || []).length;
  assert.equal(adminProtectedCount, 2);
  assert.match(APP_SOURCE, /if \(user\.role !== 'admin'\) return <Navigate to="\/dashboard" replace \/>;/);
});

test('route: no second/custom admin guard function added', () => {
  const guardDefs = APP_SOURCE.match(/function \w*Protected/g) || [];
  assert.deepEqual(guardDefs, ['function Protected', 'function AdminProtected']);
  assert.equal(/isAdmin\s*\(/.test(APP_SOURCE), false);
  assert.equal(/function AdminGuard/.test(APP_SOURCE), false);
  assert.equal(/function RequireAdmin/.test(APP_SOURCE), false);
});

test('route: direct path represented in App source', () => {
  assert.ok(/path="\/admin\/ai-recommendation"/.test(APP_SOURCE));
});

test('route: no public unprotected duplicate of the AI path', () => {
  const occurrences = APP_SOURCE.match(/path="\/admin\/ai-recommendation"/g) || [];
  assert.equal(occurrences.length, 1);
  const idx = APP_SOURCE.indexOf('path="/admin/ai-recommendation"');
  const before = APP_SOURCE.slice(Math.max(0, idx - 200), idx);
  const after = APP_SOURCE.slice(idx, idx + 300);
  assert.ok((before + after).includes('AdminProtected'));
});

test('route: no alias that exposes the page without protection', () => {
  assert.equal(/path="\/ai-recommendation"/.test(APP_SOURCE), false);
  assert.equal(/path="\/admin\/ai"/.test(APP_SOURCE) && !APP_SOURCE.includes('/admin/ai-recommendation'), false);
  const allAiPaths = APP_SOURCE.match(/path="[^"]*ai-recommendation[^"]*"/g) || [];
  assert.deepEqual(allAiPaths, ['path="/admin/ai-recommendation"']);
});

// ============================================================
// PAGE SHELL
// ============================================================

test('shell: visible heading is exactly "AI Recommendation"', () => {
  assert.ok(PAGE_SOURCE.includes('<h2>AI Recommendation</h2>'));
  assert.equal(PAGE_SOURCE.includes('AI Recommendations'), false);
});

test('shell: factual subtitle only (dashboard subtitle replaces 40/43 placeholder)', () => {
  assert.ok(PAGE_SOURCE.includes('Monitor the latest persisted recommendation evaluation for each pipeline stage.'));
  assert.equal(PAGE_SOURCE.includes('Recommendation model quality metrics and evaluation history will appear here.'), false);
  assert.equal(/checkpoint|41\/43|40\/43|TODO|FIXME/i.test(PAGE_SOURCE), false);
});

test('shell: no hardcoded fake metric values or best/winner claims in page', () => {
  const banned = [
    '92%',
    '88%',
    '95%',
    '0.91',
    'best model',
    'winner',
    'Model Accuracy',
    'Users 1,000',
    'overall_score',
    'quality_score',
    'composite_score',
    'best_model',
  ];
  for (const token of banned) {
    assert.equal(PAGE_SOURCE.includes(token), false, token);
  }
});

test('shell: metric display labels live in the UI helper, not hardcoded in page', () => {
  assert.equal(PAGE_SOURCE.includes('Precision@'), false);
  assert.equal(PAGE_SOURCE.includes('NDCG@'), false);
  assert.equal(PAGE_SOURCE.includes('MAP@'), false);
  assert.equal(UI_SOURCE.includes('Precision@5'), true);
});

test('shell: loading/error/no-runs handling is present via view helper constants', () => {
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_DASHBOARD_VIEWS'));
  assert.ok(PAGE_SOURCE.includes('ADMIN_AI_DASHBOARD_MESSAGES'));
  assert.ok(UI_SOURCE.includes('NO_RUNS'));
  assert.equal(PAGE_SOURCE.includes("'no-runs'"), false);
  assert.equal(PAGE_SOURCE.includes('isLoading'), false);
  assert.equal(PAGE_SOURCE.includes('setError'), false);
});

test('shell: no chart datasets or sample metric objects', () => {
  for (const token of ['datasets', 'chartData', 'sampleMetrics', 'mockMetrics', 'fakeMetrics', 'labels:']) {
    assert.equal(PAGE_SOURCE.includes(token), false, token);
  }
  assert.equal(/\{[\s\S]*precision_at_5[\s\S]*\}/.test(PAGE_SOURCE), false);
});

test('shell: page rendered from Admin content area for the section', () => {
  assert.ok(ADMIN_SOURCE.includes("section === 'ai-recommendation' && <AdminAIRecommendation />"));
  assert.ok(ADMIN_SOURCE.includes("import AdminAIRecommendation from './AdminAIRecommendation.jsx'"));
});

// ============================================================
// NO FETCH / NO API
// ============================================================

test('no fetch: page has zero direct recommendation metrics/history/dataset requests', () => {
  for (const src of [PAGE_SOURCE, ADMIN_SOURCE]) {
    assert.equal(src.includes('/api/admin/recommendations/metrics'), false);
    assert.equal(src.includes('/api/admin/recommendations/history'), false);
    assert.equal(src.includes('api/admin/recommendations'), false);
    assert.equal(src.includes('/api/admin/recommendation'), false);
    assert.equal(src.includes('/api/admin/dataset'), false);
    assert.equal(src.includes('/api/admin/model-history'), false);
  }
  assert.equal(PAGE_SOURCE.includes('api.get'), false);
  assert.equal(PAGE_SOURCE.includes('fetch('), false);
  assert.equal(PAGE_SOURCE.includes('axios'), false);
  assert.equal(PAGE_SOURCE.includes("from '../../api/client.js'"), false);
  assert.equal(PAGE_SOURCE.includes('useEffect'), false);
  assert.equal(PAGE_SOURCE.includes('useState'), true);
  assert.equal(PAGE_SOURCE.includes('useAdminRecommendationMetrics'), true);
});

test('no fetch: Admin AI section introduces no new recommendation endpoint call', () => {
  assert.equal(ADMIN_SOURCE.includes('/api/admin/recommendations'), false);
  assert.equal(ADMIN_SOURCE.includes('recommendations/metrics'), false);
});

// ============================================================
// NO FEATURE FLAG
// ============================================================

test('no flag: nav/page do not import recommendationConfig or check RECOMMENDATION_AI_ENABLED', () => {
  for (const src of [ADMIN_SOURCE, PAGE_SOURCE, APP_SOURCE]) {
    assert.equal(src.includes('RECOMMENDATION_AI_ENABLED'), false);
    assert.equal(src.includes('recommendationConfig'), false);
    assert.equal(src.includes('aiEnabled'), false);
  }
});

test('no flag: no conditional around the AI nav item', () => {
  const sectionsLine = ADMIN_SOURCE.match(/const SECTIONS = \[([^\]]+)\]/)[1];
  assert.ok(sectionsLine.includes("'ai-recommendation'"));
  assert.equal(/ai-recommendation[^\]]*\?/.test(sectionsLine), false);
});

// ============================================================
// ACCESS BOUNDARY
// ============================================================

test('access: page route depends on existing AdminProtected contract', () => {
  assert.ok(APP_SOURCE.includes('<AdminProtected>'));
  const idx = APP_SOURCE.indexOf('path="/admin/ai-recommendation"');
  const block = APP_SOURCE.slice(idx, idx + 200);
  assert.ok(block.includes('AdminProtected'));
});

test('access: link visibility is not the only protection (route-level guard independent of nav)', () => {
  assert.ok(APP_SOURCE.includes('path="/admin/ai-recommendation"'));
  const guardAtTop = APP_SOURCE.indexOf('function AdminProtected');
  const routeAt = APP_SOURCE.indexOf('path="/admin/ai-recommendation"');
  assert.ok(guardAtTop < routeAt);
  assert.match(APP_SOURCE, /user\.role !== 'admin'/);
});

test('access: no localStorage role parser added in Admin or App', () => {
  for (const src of [ADMIN_SOURCE, APP_SOURCE, PAGE_SOURCE]) {
    assert.equal(src.includes('localStorage'), false);
    assert.equal(/getItem\(['"]role/.test(src), false);
    assert.equal(/setItem\(['"]role/.test(src), false);
  }
});

test('access: no JWT parsing added', () => {
  for (const src of [ADMIN_SOURCE, APP_SOURCE, PAGE_SOURCE]) {
    assert.equal(src.includes('jwt'), false);
    assert.equal(src.includes('jsonwebtoken'), false);
    assert.equal(src.includes('atob('), false);
    assert.equal(src.includes('Bearer '), false);
  }
});

test('access: no custom isAdmin / duplicate role check in new page or Admin AI wiring', () => {
  assert.equal(PAGE_SOURCE.includes('user.role'), false);
  assert.equal(PAGE_SOURCE.includes('role ==='), false);
  assert.equal(PAGE_SOURCE.includes('role==='), false);
  assert.equal(PAGE_SOURCE.includes('isAdmin'), false);
  assert.equal(PAGE_SOURCE.includes('localStorage'), false);
  assert.equal(/function\s+\w*[Ii]sAdmin/.test(APP_SOURCE), false);
  assert.equal(PAGE_SOURCE.includes('role="status"'), true);
  assert.equal(PAGE_SOURCE.includes('role="alert"'), true);
});

// ============================================================
// SCOPE / STATIC SAFETY
// ============================================================

test('scope: no server/Python/model/Dashboard/Player imports in new page', () => {
  assert.equal(PAGE_SOURCE.includes("from 'server"), false);
  assert.equal(PAGE_SOURCE.includes('/server/'), false);
  assert.equal(PAGE_SOURCE.includes('ml/'), false);
  assert.equal(PAGE_SOURCE.includes('RecommendationEvaluationRun'), false);
  assert.equal(PAGE_SOURCE.includes('RecommendationSnapshot'), false);
  assert.equal(PAGE_SOURCE.includes('pages/Dashboard'), false);
  assert.equal(PAGE_SOURCE.includes('../Dashboard'), false);
  assert.equal(PAGE_SOURCE.includes('PlayerContext'), false);
  assert.equal(PAGE_SOURCE.includes('usePersonalizedRecommendations'), false);
});

test('scope: no evaluation calculation / retraining / write action', () => {
  for (const src of [PAGE_SOURCE, ADMIN_SOURCE]) {
    assert.equal(/retrain|re-training|retrainModel/.test(src), false);
    assert.equal(/evaluate\(|calculateMetric|computeScore/.test(src), false);
  }
  assert.equal(PAGE_SOURCE.includes('api.post'), false);
  assert.equal(PAGE_SOURCE.includes('api.put'), false);
  assert.equal(PAGE_SOURCE.includes('api.del'), false);
});

test('static safety: forbidden tokens absent from page + Admin AI additions', () => {
  const combined = PAGE_SOURCE + ADMIN_SOURCE;
  const forbidden = [
    '/api/admin/recommendations/history',
    '/api/admin/recommendations/dataset',
    'RecommendationEvaluationRun',
    'RecommendationSnapshot',
    'payload_sha256',
    'TruncatedSVD',
    'child_process',
    'Math.random',
    'jwt.verify',
    'jsonwebtoken',
    'overall_score',
    'quality_score',
    'composite_score',
    'best_model',
    'winner',
    'winning',
    'RECOMMENDATION_AI_ENABLED',
    'recommendationConfig',
  ];
  for (const token of forbidden) {
    assert.equal(combined.includes(token), false, token);
  }
  assert.equal(PAGE_SOURCE.includes('setInterval'), false);
  assert.equal(PAGE_SOURCE.includes('/api/admin/recommendations/metrics'), false);
});

test('static safety: page does not hardcode raw metric keys', () => {
  for (const token of [
    'precision_at_',
    'recall_at_',
    'ndcg_at_',
    'map_at_',
    'hit_rate_at_',
    'catalog_coverage',
  ]) {
    assert.equal(PAGE_SOURCE.includes(token), false, token);
  }
  assert.equal(UI_SOURCE.includes('precision_at_5'), true);
});

test('static safety: Admin setInterval only for existing stats polling (unchanged behavior)', () => {
  assert.ok(ADMIN_SOURCE.includes('setInterval(() => loadAll(true), 30000)'));
  assert.equal(PAGE_SOURCE.includes('setInterval'), false);
});

test('page shell: metrics client service is a dedicated module, not inlined in page', () => {
  assert.equal(PAGE_SOURCE.includes('createAdmin'), false);
  assert.equal(PAGE_SOURCE.includes('metricsClient'), false);
  assert.equal(PAGE_SOURCE.includes('adminRecommendationClient'), false);
  assert.equal(PAGE_SOURCE.includes('ADMIN_RECOMMENDATION_METRICS_PATH'), false);
  assert.equal(PAGE_SOURCE.includes('fetchAdminRecommendationMetrics'), false);
  assert.equal(HOOK_SOURCE.includes('fetchAdminRecommendationMetrics'), true);
  assert.equal(SERVICE_SOURCE.includes('ADMIN_RECOMMENDATION_METRICS_PATH'), true);
});
