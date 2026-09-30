import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_MODERATION_MESSAGES,
  ADMIN_REPORT_STATUS_FILTERS,
  filterAdminReports,
  selectAdminModerationView,
  selectReportStatusLabel,
  selectReportStatusTone,
} from './adminOperationsWorkspacesUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const adminCss = readFileSync(join(__dirname, 'Admin.css'), 'utf8').replace(/\r\n/g, '\n');

const moderationBlock = adminSource.slice(
  adminSource.indexOf("section === 'moderation'"),
  adminSource.indexOf("section === 'subscriptions'"),
);

test('1: Moderation header and workspace wrapper exist', () => {
  assert.match(adminSource, /<div id="moderation" className="admin-page">/);
  assert.match(moderationBlock, /<h2>Moderation<\/h2>/);
  assert.match(moderationBlock, /admin-page-header/);
  assert.match(moderationBlock, /admin-page-subtitle/);
  assert.equal(
    ADMIN_MODERATION_MESSAGES.PAGE_SUBTITLE,
    'Review and resolve reports from the Melodify community.',
  );
  assert.match(moderationBlock, /\{ADMIN_MODERATION_MESSAGES\.PAGE_SUBTITLE\}/);
  assert.match(moderationBlock, /onClick=\{\(\) => loadAll\(true\)\} disabled=\{refreshing\}/);
});

test('2: queue toolbar exposes report search and status filter', () => {
  assert.equal(ADMIN_MODERATION_MESSAGES.SEARCH_PLACEHOLDER, 'Search reports...');
  assert.equal(ADMIN_MODERATION_MESSAGES.FILTER_STATUS, 'Filter by status');
  assert.match(moderationBlock, /className="admin-toolbar"/);
  assert.match(moderationBlock, /placeholder=\{ADMIN_MODERATION_MESSAGES\.SEARCH_PLACEHOLDER\}/);
  assert.match(moderationBlock, /aria-label="Search reports"/);
  assert.match(moderationBlock, /value=\{reportSearch\}/);
  assert.match(moderationBlock, /value=\{reportStatusFilter\}/);
  assert.deepEqual(
    ADMIN_REPORT_STATUS_FILTERS.map((option) => option.value),
    ['all', 'pending', 'resolved', 'dismissed'],
  );
  assert.match(moderationBlock, /\{ADMIN_REPORT_STATUS_FILTERS\.map\(/);
});

test('3: queue table shows real report fields without inventing columns', () => {
  for (const header of ['Report', 'Reporter', 'Target', 'Reason', 'Status', 'Date', 'Actions']) {
    assert.ok(moderationBlock.includes(`<th>${header}</th>`), header);
  }
  assert.match(moderationBlock, /\{filteredReports\.map\(\(r\) => \(/);
  assert.match(moderationBlock, /key=\{r\._id\}/);
  assert.match(moderationBlock, /\{r\.type \|\| 'report'\}/);
  assert.match(moderationBlock, /title=\{r\.user_email\}/);
  assert.match(moderationBlock, /r\.content_id \? \(/);
  assert.match(moderationBlock, /title=\{r\.reason\}/);
  assert.match(moderationBlock, /\{formatAdminDate\(r\.createdAt\)\}/);
  assert.match(moderationBlock, /admin-cell-truncate/);
});

test('4: status badges use the real pending/resolved/dismissed states', () => {
  assert.equal(selectReportStatusLabel('pending'), 'Pending');
  assert.equal(selectReportStatusLabel('resolved'), 'Resolved');
  assert.equal(selectReportStatusLabel('dismissed'), 'Dismissed');
  assert.equal(selectReportStatusTone('pending'), 'warn');
  assert.equal(selectReportStatusTone('resolved'), 'ok');
  assert.equal(selectReportStatusTone('dismissed'), 'muted');
  assert.equal(selectReportStatusTone('unknown'), 'muted');
  assert.match(moderationBlock, /selectReportStatusTone\(r\.status\)/);
  assert.match(moderationBlock, /selectReportStatusLabel\(r\.status\)/);
});

test('5: resolve, dismiss, and delete semantics are unchanged', () => {
  assert.match(moderationBlock, /\{r\.status === 'pending' && \(/);
  assert.match(moderationBlock, /onClick=\{\(\) => resolveReport\(r\._id, 'resolved'\)\}>Resolve</);
  assert.match(moderationBlock, /onClick=\{\(\) => resolveReport\(r\._id, 'dismissed'\)\}>Dismiss</);
  assert.match(moderationBlock, /onClick=\{\(\) => deleteReport\(r\._id\)\}>Delete</);
  assert.equal(
    (moderationBlock.match(/resolveReport\(/g) || []).length,
    2,
    'only the two explicit pending actions call resolveReport',
  );
  const resolveHandler = adminSource.slice(
    adminSource.indexOf('const resolveReport'),
    adminSource.indexOf('const deleteReport'),
  );
  assert.match(resolveHandler, /api\.put\(`\/api\/admin\/reports\/\$\{id\}`, \{ status \}\)/);
  const deleteHandler = adminSource.slice(
    adminSource.indexOf('const deleteReport'),
    adminSource.indexOf('const updateSubscription'),
  );
  assert.match(deleteHandler, /confirm\('Delete this report\?'\)/);
  assert.match(deleteHandler, /api\.del\(`\/api\/admin\/reports\/\$\{id\}`\)/);
});

test('6: no auto-resolution and no report writes outside the explicit actions', () => {
  assert.equal(moderationBlock.includes('resolveReport(null'), false);
  assert.equal(moderationBlock.includes('useEffect'), false);
  assert.equal(moderationBlock.includes('setTimeout'), false);
  assert.equal(moderationBlock.includes('api.post'), false);
  assert.equal(moderationBlock.includes('api.put'), false);
  assert.equal(moderationBlock.includes('api.del'), false);
  for (const token of ['Auto-resolve', 'Auto Resolve', 'Bulk Resolve']) {
    assert.equal(moderationBlock.includes(token), false, token);
  }
});

test('7: loading, empty, no-match, and error states use the exact messages', () => {
  assert.equal(ADMIN_MODERATION_MESSAGES.LOADING, 'Loading moderation queue...');
  assert.equal(ADMIN_MODERATION_MESSAGES.EMPTY, 'No pending moderation items.');
  assert.equal(
    ADMIN_MODERATION_MESSAGES.NO_MATCHES,
    'No reports match the current filter.',
  );
  assert.equal(ADMIN_MODERATION_MESSAGES.ERROR, 'Unable to load moderation items.');
  assert.equal(ADMIN_MODERATION_MESSAGES.RETRY, 'Retry');
  assert.match(moderationBlock, /moderationView === 'loading'/);
  assert.match(moderationBlock, /moderationView === 'error'/);
  assert.match(moderationBlock, /moderationView === 'empty'/);
  assert.match(moderationBlock, /moderationView === 'no-matches'/);
  assert.match(moderationBlock, /admin-error-state" role="alert"/);
  assert.match(moderationBlock, /role="status"/);
  assert.match(moderationBlock, /\{ADMIN_MODERATION_MESSAGES\.RETRY\}/);
  assert.match(moderationBlock, /ADMIN_MODERATION_MESSAGES\.REFRESH_FAILED/);
});

test('8: filter helper performs bounded client-side report filtering', () => {
  const reports = [
    { _id: 'r1', type: 'abuse', user_email: 'a@mail.test', reason: 'spam', status: 'pending', content_id: 'song1' },
    { _id: 'r2', type: 'report', user_email: 'b@mail.test', reason: 'offensive', status: 'resolved' },
    { _id: 'r3', type: 'report', user_email: 'c@mail.test', reason: 'spam', status: 'dismissed' },
  ];
  assert.deepEqual(
    filterAdminReports(reports, { status: 'pending' }).map((r) => r._id),
    ['r1'],
  );
  assert.deepEqual(
    filterAdminReports(reports, { query: 'spam' }).map((r) => r._id),
    ['r1', 'r3'],
  );
  assert.deepEqual(
    filterAdminReports(reports, { query: 'song1' }).map((r) => r._id),
    ['r1'],
  );
  assert.equal(filterAdminReports(reports, { query: 'zzz' }).length, 0);
  assert.deepEqual(filterAdminReports(null, {}), []);
});

test('9: view selector distinguishes loading, error, empty, no-matches, ready', () => {
  assert.equal(selectAdminModerationView({ status: 'loading' }), 'loading');
  assert.equal(selectAdminModerationView({ status: 'error', totalReports: 0 }), 'error');
  assert.equal(selectAdminModerationView({ status: 'ready', totalReports: 0 }), 'empty');
  assert.equal(
    selectAdminModerationView({ status: 'ready', totalReports: 3, matchCount: 0 }),
    'no-matches',
  );
  assert.equal(
    selectAdminModerationView({ status: 'ready', totalReports: 3, matchCount: 1 }),
    'ready',
  );
});

test('10: workspace reuses the shared admin visual system', () => {
  for (const className of [
    'admin-page',
    'admin-toolbar',
    'admin-table-shell',
    'admin-table-scroll',
    'admin-badge',
    'admin-state-block',
    'admin-error-state',
    'admin-inline-notice',
  ]) {
    assert.ok(adminCss.includes(`.${className}`), className);
  }
});
