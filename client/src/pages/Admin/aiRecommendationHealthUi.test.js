import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { ADMIN_RECOMMENDATION_HEALTH_STATES } from '../../services/adminRecommendationHealth.js';
import {
  ADMIN_AI_HEALTH_MESSAGES,
  ADMIN_AI_HEALTH_VIEWS,
  buildHealthStatusCards,
  formatHealthCount,
  formatHealthDate,
  formatHealthText,
  getBackendStateMessage,
  selectAdminRecommendationHealthView,
} from './aiRecommendationHealthUi.js';

const readSource = (relativePath) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const UI_SOURCE = readSource('./aiRecommendationHealthUi.js');

test('health ui: view selector maps idle/loading to loading, ready, error', () => {
  assert.equal(
    selectAdminRecommendationHealthView(ADMIN_RECOMMENDATION_HEALTH_STATES.IDLE),
    ADMIN_AI_HEALTH_VIEWS.LOADING,
  );
  assert.equal(
    selectAdminRecommendationHealthView(ADMIN_RECOMMENDATION_HEALTH_STATES.LOADING),
    ADMIN_AI_HEALTH_VIEWS.LOADING,
  );
  assert.equal(
    selectAdminRecommendationHealthView(ADMIN_RECOMMENDATION_HEALTH_STATES.READY),
    ADMIN_AI_HEALTH_VIEWS.READY,
  );
  assert.equal(
    selectAdminRecommendationHealthView(ADMIN_RECOMMENDATION_HEALTH_STATES.ERROR),
    ADMIN_AI_HEALTH_VIEWS.ERROR,
  );
});

test('health ui: unknown state throws', () => {
  assert.throws(() => selectAdminRecommendationHealthView('bogus'), /invalid/);
});

test('health ui: backend state messages are factual', () => {
  assert.equal(getBackendStateMessage('never-run'), ADMIN_AI_HEALTH_MESSAGES.NEVER_RUN);
  assert.equal(getBackendStateMessage('running'), ADMIN_AI_HEALTH_MESSAGES.RUNNING);
  assert.equal(getBackendStateMessage('completed'), ADMIN_AI_HEALTH_MESSAGES.COMPLETED);
  assert.equal(getBackendStateMessage('failed'), ADMIN_AI_HEALTH_MESSAGES.FAILED);
  assert.equal(getBackendStateMessage('unknown'), ADMIN_AI_HEALTH_MESSAGES.NOT_AVAILABLE);
  assert.equal(ADMIN_AI_HEALTH_MESSAGES.RETRY, 'Refresh Status');
});

test('health ui: no healthy/unhealthy/quality language', () => {
  const blob = JSON.stringify(ADMIN_AI_HEALTH_MESSAGES) + UI_SOURCE;
  for (const token of ['healthy', 'unhealthy', 'quality', 'winner', 'grade', 'score']) {
    assert.equal(blob.includes(token), false, token);
  }
});

test('health ui: formatHealthDate handles invalid values', () => {
  assert.equal(formatHealthDate('not-a-date'), ADMIN_AI_HEALTH_MESSAGES.NOT_AVAILABLE);
  assert.equal(formatHealthDate(''), ADMIN_AI_HEALTH_MESSAGES.NOT_AVAILABLE);
  assert.equal(formatHealthDate(null), ADMIN_AI_HEALTH_MESSAGES.NOT_AVAILABLE);
  const formatted = formatHealthDate('2026-09-15T12:00:00.000Z');
  assert.equal(typeof formatted, 'string');
  assert.ok(formatted.length > 0);
  assert.notEqual(formatted, ADMIN_AI_HEALTH_MESSAGES.NOT_AVAILABLE);
});

test('health ui: formatHealthCount and formatHealthText', () => {
  assert.equal(formatHealthCount(12), '12');
  assert.equal(formatHealthCount(null), ADMIN_AI_HEALTH_MESSAGES.NOT_RECORDED);
  assert.equal(formatHealthCount(undefined), ADMIN_AI_HEALTH_MESSAGES.NOT_RECORDED);
  assert.equal(formatHealthCount('x'), ADMIN_AI_HEALTH_MESSAGES.NOT_RECORDED);
  assert.equal(formatHealthText('run-43-01'), 'run-43-01');
  assert.equal(formatHealthText(null), ADMIN_AI_HEALTH_MESSAGES.NOT_RECORDED);
  assert.equal(formatHealthText(''), ADMIN_AI_HEALTH_MESSAGES.NOT_RECORDED);
});

test('health ui: buildHealthStatusCards for never-run', () => {
  const cards = buildHealthStatusCards('never-run', { active: false }, null);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].label, 'Status');
  assert.equal(cards[0].formatted, ADMIN_AI_HEALTH_MESSAGES.NEVER_RUN);
});

test('health ui: buildHealthStatusCards for running with active lease', () => {
  const cards = buildHealthStatusCards(
    'running',
    {
      active: true,
      run_id: 'run-43-01',
      expires_at: '2026-09-15T12:10:00.000Z',
    },
    null,
  );
  const labels = cards.map((c) => c.label);
  assert.ok(labels.includes('Status'));
  assert.ok(labels.includes('Active Run ID'));
  assert.ok(labels.includes('Lease Expires'));
});

test('health ui: buildHealthStatusCards for completed with latest', () => {
  const cards = buildHealthStatusCards(
    'completed',
    { active: false },
    {
      run_id: 'run-43-01',
      finished_at: '2026-09-15T12:01:00.000Z',
      duration_ms: 60000,
      evaluation_created: true,
      snapshot_persisted_count: 3,
      snapshot_reused_count: 1,
      failure_code: null,
    },
  );
  const labels = cards.map((c) => c.label);
  assert.ok(labels.includes('Run ID'));
  assert.ok(labels.includes('Finished At'));
  assert.ok(labels.includes('Duration (ms)'));
  assert.ok(labels.includes('Evaluation Recorded'));
  assert.ok(labels.includes('Snapshots Persisted'));
  assert.equal(labels.includes('Failure Code'), false);
});

test('health ui: buildHealthStatusCards includes failure code when present', () => {
  const cards = buildHealthStatusCards(
    'failed',
    { active: false },
    {
      run_id: 'run-43-01',
      finished_at: '2026-09-15T12:01:00.000Z',
      duration_ms: 1000,
      evaluation_created: false,
      snapshot_persisted_count: 0,
      snapshot_reused_count: 0,
      failure_code: 'PYTHON_TIMEOUT',
    },
  );
  const failure = cards.find((c) => c.key === 'failure_code');
  assert.ok(failure);
  assert.equal(failure.formatted, 'PYTHON_TIMEOUT');
});

test('health ui: buildHealthStatusCards invalid input returns empty', () => {
  assert.deepEqual(buildHealthStatusCards(null, null, null), []);
  assert.deepEqual(buildHealthStatusCards(undefined, null, null), []);
});
