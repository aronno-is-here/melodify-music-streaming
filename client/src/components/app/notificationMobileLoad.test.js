import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(__dirname, ...parts), 'utf8');

const shellCss = read('..', '..', 'styles', 'app-shell.css');
const bellSrc = read('NotificationBell.jsx');
const uiSrc = read('notificationUi.js');
const ctxSrc = read('..', '..', 'context', 'NotificationContext.jsx');

function basePanelRule() {
  const match = shellCss.match(/\.app-notification-panel \{[^}]*\}/);
  assert.ok(match, 'base panel rule exists');
  return match[0];
}

function mobileMediaBlock() {
  const match = shellCss.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/);
  assert.ok(match, 'mobile media query exists');
  return match[1];
}

test('1. mobile panel uses viewport-safe fixed positioning with 12px insets', () => {
  const block = mobileMediaBlock();
  assert.match(block, /\.app-notification-panel \{/);
  assert.match(block, /position: fixed;/);
  assert.match(block, /left: max\(12px, env\(safe-area-inset-left\)\);/);
  assert.match(block, /right: max\(12px, env\(safe-area-inset-right\)\);/);
  assert.match(block, /top: 72px;/);
  assert.match(block, /max-height: min\(460px, calc\(100dvh - 212px\)\);/);
});

test('2. mobile panel never carries a fixed width larger than the viewport', () => {
  const block = mobileMediaBlock();
  assert.match(block, /width: auto;/);
  assert.match(block, /max-width: none;/);
  const base = basePanelRule();
  assert.match(base, /width: min\(360px, calc\(100vw - 24px\)\);/);
  assert.equal(/width: 3\d\dpx/.test(block), false, 'no hard-coded pixel width on mobile');
});

test('3. desktop dropdown styling remains unchanged above 640px', () => {
  const base = basePanelRule();
  assert.match(base, /position: absolute;/);
  assert.match(base, /top: calc\(100% \+ 8px\);/);
  assert.match(base, /right: 0;/);
  assert.match(base, /z-index: 46;/);
  assert.match(shellCss, /\.app-header \{[^}]*z-index: 40;/);
  assert.match(shellCss, /\.app-notification-list \{[^}]*overflow-y: auto;/);
  assert.match(shellCss, /\.app-notification-panel \{[^}]*overflow: hidden;/);
});

test('4. the error state still offers a Retry button', () => {
  assert.match(bellSrc, /className="app-notification-state app-notification-state-error" role="alert"/);
  assert.match(bellSrc, /className="app-notification-retry"[^>]*>\s*Retry\s*</);
});

test('5. a successful retry reloads the notification list', () => {
  assert.match(bellSrc, /<button type="button" className="app-notification-retry" onClick=\{loadList\}>/);
  assert.match(ctxSrc, /const result = await fetchNotifications\(\{ limit: DEFAULT_NOTIFICATION_LIMIT, apiClient: api \}\);/);
});

test('6. a failed list fetch never clears the unread badge', () => {
  const failureBranch = ctxSrc.match(/if \(!result\.ok\) \{([\s\S]*?)\n {4}\}/);
  assert.ok(failureBranch, 'load failure branch exists');
  assert.equal(failureBranch[1].includes('setUnread'), false);
  assert.match(failureBranch[1], /setError\(result\.error \|\| NOTIFICATION_ERROR_MESSAGE\)/);
});

test('7. a successful load zeroes the badge per the mark-all semantics', () => {
  assert.match(ctxSrc, /const markResult = await markAllNotificationsRead\(\{ apiClient: api \}\);/);
  assert.match(ctxSrc, /if \(markResult\.ok\) \{\s*setItems\(loaded\.map\(\(row\) => \(\{ \.\.\.row, read: true \}\)\)\);\s*setUnread\(0\);/);
  const markBranch = ctxSrc.match(/if \(markResult\.ok\) \{([\s\S]*?)\} else \{([\s\S]*?)\}/);
  assert.ok(markBranch, 'mark-all branch exists');
  assert.equal(markBranch[2].includes('setUnread'), false, 'failed mark-all keeps the badge');
});

test('8. an empty list still shows "No notifications yet"', () => {
  assert.match(uiSrc, /export const NOTIFICATION_EMPTY_MESSAGE = 'No notifications yet\.';/);
  assert.match(bellSrc, /<span>\{NOTIFICATION_EMPTY_MESSAGE\}<\/span>/);
  assert.match(bellSrc, /!loading && !error && items\.length === 0/);
});
