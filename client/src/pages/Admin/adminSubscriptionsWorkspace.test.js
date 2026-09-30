import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_SUBSCRIPTION_MESSAGES,
  ADMIN_SUBSCRIPTION_STATUS_FILTERS,
  buildSubscriptionSummary,
  filterAdminSubscriptions,
  selectAdminSubscriptionsView,
  selectSubscriptionStatusLabel,
  selectSubscriptionStatusTone,
} from './adminOperationsWorkspacesUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const adminCss = readFileSync(join(__dirname, 'Admin.css'), 'utf8').replace(/\r\n/g, '\n');

const subscriptionsBlock = adminSource.slice(
  adminSource.indexOf("section === 'subscriptions'"),
  adminSource.indexOf("section === 'ai-recommendation'"),
);

test('1: Subscription Management header and workspace wrapper exist', () => {
  assert.match(adminSource, /<div id="subscriptions" className="admin-page">/);
  assert.match(subscriptionsBlock, /<h2>Subscription Management<\/h2>/);
  assert.equal(
    ADMIN_SUBSCRIPTION_MESSAGES.PAGE_SUBTITLE,
    'Monitor and manage Melodify subscription records.',
  );
  assert.match(subscriptionsBlock, /\{ADMIN_SUBSCRIPTION_MESSAGES\.PAGE_SUBTITLE\}/);
  assert.match(subscriptionsBlock, /onClick=\{\(\) => loadAll\(true\)\} disabled=\{refreshing\}/);
});

test('2: summary cards render real subscription counts when data is ready', () => {
  const summary = buildSubscriptionSummary([
    { status: 'active' },
    { status: 'expired' },
    { status: 'active' },
    null,
  ]);
  assert.deepEqual(
    summary.map((card) => [card.key, card.label, card.value]),
    [
      ['total', 'Total Subscriptions', 4],
      ['active', 'Active', 2],
      ['expired', 'Expired', 1],
    ],
  );
  assert.deepEqual(buildSubscriptionSummary(null).map((card) => card.value), [0, 0, 0]);
  assert.match(
    subscriptionsBlock,
    /dataStatus\.subscriptions === 'ready' && subscriptions\.length > 0 && \(/,
  );
  assert.match(subscriptionsBlock, /aria-label="Subscription summary"/);
  assert.match(subscriptionsBlock, /admin-stats-grid admin-summary-grid/);
  assert.match(subscriptionsBlock, /\{subscriptionSummary\.map\(/);
});

test('3: toolbar exposes subscription search and status filter', () => {
  assert.equal(ADMIN_SUBSCRIPTION_MESSAGES.SEARCH_PLACEHOLDER, 'Search subscriptions...');
  assert.match(subscriptionsBlock, /className="admin-toolbar"/);
  assert.match(subscriptionsBlock, /placeholder=\{ADMIN_SUBSCRIPTION_MESSAGES\.SEARCH_PLACEHOLDER\}/);
  assert.match(subscriptionsBlock, /aria-label="Search subscriptions"/);
  assert.match(subscriptionsBlock, /value=\{subscriptionSearch\}/);
  assert.match(subscriptionsBlock, /value=\{subscriptionStatusFilter\}/);
  assert.deepEqual(
    ADMIN_SUBSCRIPTION_STATUS_FILTERS.map((option) => option.value),
    ['all', 'active', 'expired'],
  );
  assert.match(subscriptionsBlock, /\{ADMIN_SUBSCRIPTION_STATUS_FILTERS\.map\(/);
});

test('4: table shows real subscription fields without inventing columns', () => {
  for (const header of [
    'User',
    'Plan',
    'Status',
    'Start Date',
    'End Date',
    'Amount',
    'Actions',
  ]) {
    assert.ok(subscriptionsBlock.includes(`<th>${header}</th>`), header);
  }
  assert.equal(subscriptionsBlock.includes('<th>Renewal</th>'), false, 'no invented column');
  assert.match(subscriptionsBlock, /\{filteredSubscriptions\.map\(\(sub\) => \(/);
  assert.match(subscriptionsBlock, /key=\{sub\._id\}/);
  assert.match(subscriptionsBlock, /title=\{sub\.user_email\}/);
  assert.match(subscriptionsBlock, /\{sub\.plan\}/);
  assert.match(subscriptionsBlock, /\{formatAdminDate\(sub\.createdAt\)\}/);
  assert.match(subscriptionsBlock, /\{formatAdminDate\(sub\.end_date\)\}/);
  assert.match(subscriptionsBlock, /\$\{sub\.amount\}/);
});

test('5: status badges use the real active/expired states', () => {
  assert.equal(selectSubscriptionStatusLabel('active'), 'Active');
  assert.equal(selectSubscriptionStatusLabel('expired'), 'Expired');
  assert.equal(selectSubscriptionStatusTone('active'), 'ok');
  assert.equal(selectSubscriptionStatusTone('expired'), 'muted');
  assert.equal(selectSubscriptionStatusTone('unknown'), 'muted');
  assert.match(subscriptionsBlock, /selectSubscriptionStatusTone\(sub\.status\)/);
  assert.match(subscriptionsBlock, /selectSubscriptionStatusLabel\(sub\.status\)/);
});

test('6: expire and activate actions are preserved with their semantics', () => {
  assert.match(subscriptionsBlock, /\{sub\.status === 'active' \? \(/);
  assert.match(
    subscriptionsBlock,
    /onClick=\{\(\) => updateSubscription\(sub\._id, 'expired'\)\}>Expire</,
  );
  assert.match(subscriptionsBlock, /\) : \(/);
  assert.match(
    subscriptionsBlock,
    /onClick=\{\(\) => updateSubscription\(sub\._id, 'active'\)\}>Activate</,
  );
  assert.equal((subscriptionsBlock.match(/updateSubscription\(/g) || []).length, 2);
  const handler = adminSource.slice(
    adminSource.indexOf('const updateSubscription'),
    adminSource.indexOf('const addSong'),
  );
  assert.match(handler, /api\.put\(`\/api\/admin\/subscriptions\/\$\{id\}`, \{ status \}\)/);
});

test('7: no payment-processing behavior is introduced', () => {
  for (const token of ['refund', 'Refund', 'payment', 'Payment', 'checkout', 'Checkout']) {
    assert.equal(subscriptionsBlock.includes(token), false, token);
  }
  assert.equal(subscriptionsBlock.includes('api.post'), false);
  assert.equal(subscriptionsBlock.includes('api.put'), false);
  assert.equal(subscriptionsBlock.includes('api.del'), false);
  assert.equal(subscriptionsBlock.includes('useEffect'), false);
});

test('8: loading, empty, no-match, and error states use the exact messages', () => {
  assert.equal(ADMIN_SUBSCRIPTION_MESSAGES.LOADING, 'Loading subscriptions...');
  assert.equal(ADMIN_SUBSCRIPTION_MESSAGES.EMPTY, 'No subscriptions found.');
  assert.equal(
    ADMIN_SUBSCRIPTION_MESSAGES.NO_MATCHES,
    'No subscriptions match the current filter.',
  );
  assert.equal(ADMIN_SUBSCRIPTION_MESSAGES.ERROR, 'Unable to load subscriptions.');
  assert.equal(ADMIN_SUBSCRIPTION_MESSAGES.RETRY, 'Retry');
  assert.equal(ADMIN_SUBSCRIPTION_MESSAGES.REFRESH_FAILED, 'Unable to refresh subscriptions.');
  assert.match(subscriptionsBlock, /subscriptionsView === 'loading'/);
  assert.match(subscriptionsBlock, /subscriptionsView === 'error'/);
  assert.match(subscriptionsBlock, /subscriptionsView === 'empty'/);
  assert.match(subscriptionsBlock, /subscriptionsView === 'no-matches'/);
  assert.match(subscriptionsBlock, /admin-error-state" role="alert"/);
  assert.match(subscriptionsBlock, /role="status"/);
  assert.match(subscriptionsBlock, /\{ADMIN_SUBSCRIPTION_MESSAGES\.RETRY\}/);
  assert.match(subscriptionsBlock, /ADMIN_SUBSCRIPTION_MESSAGES\.REFRESH_FAILED/);
});

test('9: filter helper performs bounded client-side subscription filtering', () => {
  const subscriptions = [
    { _id: 's1', user_email: 'aronno@mail.test', plan: 'premium', status: 'active' },
    { _id: 's2', user_email: 'mimi@mail.test', plan: 'student', status: 'expired' },
    { _id: 's3', user_email: 'ehsanul@mail.test', plan: 'premium', status: 'expired' },
  ];
  assert.deepEqual(
    filterAdminSubscriptions(subscriptions, { status: 'active' }).map((s) => s._id),
    ['s1'],
  );
  assert.deepEqual(
    filterAdminSubscriptions(subscriptions, { query: 'premium', status: 'expired' }).map((s) => s._id),
    ['s3'],
  );
  assert.deepEqual(
    filterAdminSubscriptions(subscriptions, { query: 'ARONNO' }).map((s) => s._id),
    ['s1'],
  );
  assert.equal(filterAdminSubscriptions(subscriptions, { query: 'zzz' }).length, 0);
  assert.deepEqual(filterAdminSubscriptions(null, {}), []);
});

test('10: view selector distinguishes loading, error, empty, no-matches, ready', () => {
  assert.equal(selectAdminSubscriptionsView({ status: 'loading' }), 'loading');
  assert.equal(selectAdminSubscriptionsView({ status: 'error', totalSubscriptions: 0 }), 'error');
  assert.equal(selectAdminSubscriptionsView({ status: 'ready', totalSubscriptions: 0 }), 'empty');
  assert.equal(
    selectAdminSubscriptionsView({ status: 'ready', totalSubscriptions: 2, matchCount: 0 }),
    'no-matches',
  );
  assert.equal(
    selectAdminSubscriptionsView({ status: 'ready', totalSubscriptions: 2, matchCount: 1 }),
    'ready',
  );
  assert.equal(
    selectAdminSubscriptionsView({ status: 'error', totalSubscriptions: 2, matchCount: 1 }),
    'ready',
    'a failed refresh keeps already loaded rows visible',
  );
});

test('11: workspace reuses the shared admin visual system', () => {
  for (const className of [
    'admin-page',
    'admin-toolbar',
    'admin-stats-grid',
    'admin-stat-card',
    'admin-table-scroll',
    'admin-badge',
    'admin-state-block',
    'admin-error-state',
  ]) {
    assert.ok(adminCss.includes(`.${className}`), className);
  }
  assert.match(adminCss, /\.admin-summary-grid/);
  assert.match(adminCss, /\.admin-cell-truncate/);
});
