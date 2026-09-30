import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(__dirname, ...parts), 'utf8');

const bellSrc = read('NotificationBell.jsx');
const shellSrc = read('AuthenticatedAppShell.jsx');
const uiSrc = read('notificationUi.js');
const ctxSrc = read('..', '..', 'context', 'NotificationContext.jsx');
const shellCss = read('..', '..', 'styles', 'app-shell.css');
const homeSrc = read('..', '..', 'pages', 'Home', 'Home.jsx');
const apiSrc = read('..', '..', 'api', 'client.js');

test('1. bell renders in the authenticated shell header', () => {
  assert.match(shellSrc, /import NotificationBell from '\.\/NotificationBell\.jsx';/);
  assert.match(shellSrc, /<NotificationBell \/>/);
  assert.match(bellSrc, /className=\{isHomeVariant \? 'home-icon-btn app-bell-btn' : 'app-icon-btn app-bell-btn'\}/);
  assert.match(bellSrc, /aria-expanded=\{open\}/);
  assert.match(bellSrc, /aria-label=\{badge\.ariaLabel\}/);
});

test('2. unread badge renders when the count is greater than zero', () => {
  assert.match(bellSrc, /\{badge\.show \? \(\s*<span className="app-bell-badge" aria-hidden="true">\{badge\.text\}<\/span>\s*\) : null\}/);
  assert.match(shellCss, /\.app-bell-badge\s*\{/);
  assert.equal(uiSrc.includes('99+'), true);
});

test('3. opening the bell fetches recent notifications', () => {
  assert.match(bellSrc, /if \(!open\) return undefined;\s*setError\(''\);\s*loadList\(\);/);
  assert.match(ctxSrc, /const result = await fetchNotifications\(\{ limit: DEFAULT_NOTIFICATION_LIMIT, apiClient: api \}\);/);
  assert.match(bellSrc, /useEffect\(\(\) => \{\s*refreshUnread\(\);\s*\}, \[refreshUnread\]\);/);
});

test('4. empty and error states are rendered', () => {
  assert.match(bellSrc, /NOTIFICATION_EMPTY_MESSAGE/);
  assert.match(bellSrc, /role="status"/);
  assert.match(bellSrc, /role="alert"/);
  assert.match(bellSrc, /Loading notifications\.\.\./);
  assert.match(bellSrc, /onClick=\{loadList\}/);
});

test('5. items render human-readable text, never raw enums', () => {
  assert.match(bellSrc, /\{item\.text\}/);
  assert.equal(bellSrc.includes("item.type === 'post_like'"), false);
  assert.equal(/\{item\.type\}/.test(bellSrc), false);
  assert.equal(bellSrc.includes('friend_request`'), false);
});

test('6. friend-request Accept/Reject controls are retired from the bell', () => {
  assert.equal(bellSrc.includes('showFriendActions'), false);
  assert.equal(bellSrc.includes('app-notification-accept'), false);
  assert.equal(bellSrc.includes('app-notification-reject'), false);
  assert.equal(bellSrc.includes('friendRequestId'), false);
  assert.equal(uiSrc.includes('getFriendActionRequestId'), false);
  assert.equal(uiSrc.includes('hasFriendActions'), false);
  assert.equal(uiSrc.includes('showFriendActions'), false);
  assert.equal(bellSrc.includes('friendRequests'), false);
});

test('7-8. bell performs no friend-request service calls', () => {
  assert.equal(bellSrc.includes('acceptFriendRequest'), false);
  assert.equal(bellSrc.includes('rejectFriendRequest'), false);
  assert.equal(bellSrc.includes('item.requestId'), false);
  assert.equal(/Accept|Reject/.test(bellSrc), false);
});

test('9. mark-all-read clears the list and the unread badge', () => {
  assert.match(bellSrc, /onClick=\{handleMarkAll\}/);
  assert.match(ctxSrc, /await markAllNotificationsRead\(\{ apiClient: api \}\);/);
  assert.match(ctxSrc, /setUnread\(0\);/);
});

test('mark-one-read is exposed for unread items only', () => {
  assert.match(bellSrc, /!\item\.read \? \(/);
  assert.match(bellSrc, /await markRead\(item\._id\)/);
  assert.match(ctxSrc, /await markNotificationRead\(notificationId, \{ apiClient: api \}\)/);
  assert.match(bellSrc, /aria-label="Mark notification as read"/);
  assert.match(apiSrc, /patch: \(path, body\) => request\(path, \{ method: 'PATCH', body: JSON\.stringify\(body \?\? \{\}\)/);
});

test('14. clicking an item navigates to a safe target', () => {
  assert.match(bellSrc, /setOpen\(false\);\s*navigate\(item\.target\);/);
  assert.match(shellCss, /\.app-notification-panel\s*\{/);
});

test('no aggressive polling or storage access in the bell', () => {
  assert.equal(bellSrc.includes('setInterval'), false);
  assert.equal(bellSrc.includes('setTimeout'), false);
  assert.equal(bellSrc.includes('localStorage'), false);
  assert.equal(bellSrc.includes('sessionStorage'), false);
  assert.equal(shellSrc.includes('localStorage.removeItem'), false);
  assert.equal(shellSrc.includes('sessionStorage'), false);
});

test('homepage bell is only functional for signed-in visitors', () => {
  assert.match(homeSrc, /import NotificationBell from '\.\.\/\.\.\/components\/app\/NotificationBell\.jsx';/);
  assert.match(homeSrc, /\{user \? \(\s*<NotificationBell variant="home" \/>\s*\) : \(/);
  assert.equal(/logout|localStorage|removeItem|melodify_token/.test(homeSrc), false);
});

test('3. bell remains clickable and opens even when the unread count is zero', () => {
  const buttonStart = bellSrc.indexOf('aria-label={badge.ariaLabel}');
  const buttonEnd = bellSrc.indexOf('</button>', buttonStart);
  assert.ok(buttonStart >= 0 && buttonEnd > buttonStart, 'bell button markup not found');
  const buttonBlock = bellSrc.slice(buttonStart, buttonEnd);
  assert.equal(buttonBlock.includes('disabled'), false);
  assert.match(buttonBlock, /onClick=\{\(\) => setOpen\(\(value\) => !value\)\}/);
  assert.equal(/disabled=\{[^}]*unread/.test(bellSrc), false);
  assert.match(bellSrc, /aria-expanded=\{open\}/);
  assert.match(bellSrc, /\{open \? \(/);
  assert.match(uiSrc, /NOTIFICATION_UNREAD_ZERO_LABEL = 'No unread notifications'/);
});

test('4. opening the bell with no notifications shows the empty state', () => {
  assert.match(
    bellSrc,
    /\{!loading && !error && items\.length === 0 \? \(\s*<p className="app-notification-state app-notification-empty" role="status">[\s\S]*?\{NOTIFICATION_EMPTY_MESSAGE\}[\s\S]*?<\/p>\s*\) : null\}/,
  );
  assert.match(uiSrc, /NOTIFICATION_EMPTY_MESSAGE = 'No notifications yet\.'/);
  assert.match(shellCss, /\.app-notification-empty\s*\{/);
});

test('5. existing notification list still renders', () => {
  assert.match(bellSrc, /<ul className="app-notification-list" aria-label="Recent notifications">/);
  assert.match(bellSrc, /\{items\.map\(\(item\) =>/);
  assert.match(bellSrc, /Mark all read/);
  assert.match(bellSrc, /aria-label="Mark notification as read"/);
  assert.equal(bellSrc.includes('app-notification-accept'), false);
  assert.equal(bellSrc.includes('app-notification-reject'), false);
});

test('6. loading and error retry states remain intact', () => {
  assert.match(bellSrc, /Loading notifications\.\.\./);
  assert.match(bellSrc, /role="alert"/);
  assert.match(bellSrc, /className="app-notification-retry" onClick=\{loadList\}/);
  assert.match(bellSrc, /setError\(result\.error \|\| NOTIFICATION_ERROR_MESSAGE\)/);
  assert.match(bellSrc, /if \(!open\) return undefined;\s*setError\(''\);\s*loadList\(\);/);
});

test('signed-out homepage bell is explicitly non-functional', () => {
  assert.match(homeSrc, /disabled aria-disabled="true"/);
  assert.equal(/<button className="home-icon-btn" aria-label="Notifications"/.test(homeSrc), false);
});
