import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (...parts) => readFileSync(join(__dirname, ...parts), 'utf8');

const ctxSrc = read('NotificationContext.jsx');
const mainSrc = read('..', 'main.jsx');
const bellSrc = read('..', 'components', 'app', 'NotificationBell.jsx');
const shellSrc = read('..', 'components', 'app', 'AuthenticatedAppShell.jsx');
const homeSrc = read('..', 'pages', 'Home', 'Home.jsx');

test('NotificationProvider is mounted inside AuthProvider and wraps the app', () => {
  assert.match(mainSrc, /import \{ NotificationProvider \} from '\.\/context\/NotificationContext\.jsx';/);
  assert.match(mainSrc, /<AuthProvider>\s*<NotificationProvider>[\s\S]*?<App \/>[\s\S]*<\/NotificationProvider>\s*<\/AuthProvider>/);
  assert.match(ctxSrc, /return <NotificationContext\.Provider value=\{value\}>\{children\}<\/NotificationContext\.Provider>/);
});

test('both bells read the same shared notification state', () => {
  assert.match(bellSrc, /import \{ useNotifications \} from '\.\.\/\.\.\/context\/NotificationContext\.jsx';/);
  assert.match(shellSrc, /<NotificationBell \/>/);
  assert.match(homeSrc, /<NotificationBell variant="home" \/>/);
  assert.equal(ctxSrc.includes('useNotifications'), true);
  assert.equal(bellSrc.includes('fetchUnreadCount'), false);
  assert.equal(bellSrc.includes('fetchNotifications'), false);
  assert.equal(bellSrc.includes('setInterval'), false);
  assert.equal(bellSrc.includes('setTimeout'), false);
});

test('the context performs no polling or timers', () => {
  assert.equal(ctxSrc.includes('setInterval'), false);
  assert.equal(ctxSrc.includes('setTimeout'), false);
  assert.equal(ctxSrc.includes('localStorage'), false);
  assert.equal(ctxSrc.includes('sessionStorage'), false);
});

test('failed list loads never clear the unread badge', () => {
  const failureBranch = ctxSrc.match(/if \(!result\.ok\) \{([\s\S]*?)\n {4}\}/);
  assert.ok(failureBranch, 'load failure branch exists');
  assert.equal(failureBranch[1].includes('setUnread'), false);
  assert.match(failureBranch[1], /setError\(result\.error \|\| NOTIFICATION_ERROR_MESSAGE\)/);
  assert.match(ctxSrc, /const result = await fetchNotifications\(\{ limit: DEFAULT_NOTIFICATION_LIMIT, apiClient: api \}\);/);
});

test('a successful list load marks everything read and zeroes the badge', () => {
  assert.match(ctxSrc, /const markResult = await markAllNotificationsRead\(\{ apiClient: api \}\);/);
  assert.match(ctxSrc, /if \(markResult\.ok\) \{\s*setItems\(loaded\.map\(\(row\) => \(\{ \.\.\.row, read: true \}\)\)\);\s*setUnread\(0\);/);
});

test('mark-all failure keeps the loaded list and keeps the badge', () => {
  const markBranch = ctxSrc.match(/if \(markResult\.ok\) \{([\s\S]*?)\} else \{([\s\S]*?)\}/);
  assert.ok(markBranch, 'markResult branch exists');
  assert.equal(markBranch[2].includes('setUnread'), false);
  assert.match(markBranch[2], /setItems\(loaded\);/);
});

test('refreshing the unread count is a no-op without a signed-in user', () => {
  assert.match(ctxSrc, /const refreshUnread = useCallback\(async \(\) => \{\s*if \(!user\) \{\s*setUnread\(0\);\s*return \{ ok: false \};/);
  assert.match(ctxSrc, /if \(refreshInFlightRef\.current\) return refreshInFlightRef\.current;/);
});

test('logging out resets items, badge, error, and pending generations', () => {
  assert.match(ctxSrc, /if \(!user\) \{\s*generationRef\.current \+= 1;\s*setItems\(\[\]\);\s*setUnread\(0\);\s*setError\(''\);\s*setLoading\(false\);/);
});

test('stale list responses are discarded via the generation counter', () => {
  const guards = ctxSrc.match(/if \(generationRef\.current !== generation\) return \{ ok: false \};/g);
  assert.ok(guards && guards.length >= 2, 'both load and mark check the generation');
});

test('read actions update the shared list and badge together', () => {
  assert.match(ctxSrc, /const result = await markNotificationRead\(notificationId, \{ apiClient: api \}\);/);
  assert.match(ctxSrc, /setUnread\(\(prev\) => Math\.max\(0, prev - 1\)\);/);
  assert.match(ctxSrc, /const markAllRead = useCallback\(async \(\) => \{[\s\S]*?setUnread\(0\);/);
});

test('the shared value is memoized so consumers do not re-render needlessly', () => {
  assert.match(ctxSrc, /const value = useMemo\(\(\) => \(\{/);
  assert.match(ctxSrc, /\}\), \[items, unread, loading, error, refreshUnread, loadList, markRead, markAllRead\]\);/);
});

test('signed-out bells never issue requests and signed-in bells refresh on mount', () => {
  assert.match(bellSrc, /useEffect\(\(\) => \{\s*refreshUnread\(\);\s*\}, \[refreshUnread\]\);/);
  assert.match(ctxSrc, /const loadList = useCallback\(async \(\) => \{\s*if \(!user\) return \{ ok: false \};/);
  assert.match(ctxSrc, /const request = fetchUnreadCount\(\{ apiClient: api \}\)\.then\(\(result\) => \{\s*if \(result\.ok\) setUnread\(clampUnreadCount\(result\.count\)\);/);
});
