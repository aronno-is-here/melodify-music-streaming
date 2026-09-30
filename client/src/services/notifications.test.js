import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTIFICATION_LIMIT,
  MAX_NOTIFICATION_LIMIT,
  NOTIFICATIONS_PATH,
  NOTIFICATION_TYPES,
  buildMarkAllReadPath,
  buildMarkReadPath,
  buildNotificationsPath,
  buildUnreadCountPath,
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
  normalizeNotificationsResponse,
  normalizeUnreadCountResponse,
} from './notifications.js';

function baseNotification(overrides = {}) {
  return {
    _id: 'n1',
    type: 'post_like',
    read: false,
    actor: { _id: 'u2', name: 'Nadia', avatar: '' },
    post: 'p1',
    friendRequest: null,
    comment: null,
    createdAt: '2026-09-15T10:00:00.000Z',
    ...overrides,
  };
}

function createClient(handlers = {}) {
  const calls = [];
  return {
    calls,
    get: async (path) => {
      calls.push({ method: 'GET', path });
      return handlers.get ? handlers.get(path) : { success: true };
    },
    patch: async (path, body) => {
      calls.push({ method: 'PATCH', path, body });
      return handlers.patch ? handlers.patch(path, body) : { success: true };
    },
  };
}

test('notification paths are bounded and namespaced', () => {
  assert.equal(NOTIFICATIONS_PATH, '/api/notifications');
  assert.equal(buildNotificationsPath(10), '/api/notifications?limit=10');
  assert.equal(buildNotificationsPath(500), '/api/notifications?limit=50');
  assert.equal(buildNotificationsPath('abc'), null);
  assert.equal(buildNotificationsPath(0), null);
  assert.equal(DEFAULT_NOTIFICATION_LIMIT, 20);
  assert.equal(MAX_NOTIFICATION_LIMIT, 50);
  assert.equal(buildUnreadCountPath(), '/api/notifications/unread-count');
  assert.equal(buildMarkReadPath('n1'), '/api/notifications/n1/read');
  assert.equal(buildMarkReadPath(''), null);
  assert.equal(buildMarkAllReadPath(), '/api/notifications/read-all');
});

test('supported notification types cover the required set', () => {
  assert.deepEqual([...NOTIFICATION_TYPES].sort(), [
    'friend_accepted',
    'friend_request',
    'post_comment',
    'post_like',
    'post_share',
  ]);
});

test('normalizeNotificationsResponse keeps only safe fields', () => {
  const normalized = normalizeNotificationsResponse({
    success: true,
    count: 1,
    limit: 20,
    notifications: [baseNotification({ email: 'leak@example.com', password: 'x' })],
  });

  assert.ok(normalized);
  assert.equal(normalized.notifications.length, 1);
  const row = normalized.notifications[0];
  assert.equal(row.email, undefined);
  assert.equal(row.password, undefined);
  assert.deepEqual(Object.keys(row).sort(), [
    '_id',
    'actor',
    'comment',
    'createdAt',
    'friendRequest',
    'post',
    'read',
    'type',
  ]);
  assert.deepEqual(Object.keys(row.actor).sort(), ['_id', 'avatar', 'name']);
});

test('normalizeNotificationsResponse rejects malformed payloads', () => {
  assert.equal(normalizeNotificationsResponse({ success: true }), null);
  assert.equal(normalizeNotificationsResponse({ success: false, notifications: [] }), null);
  assert.equal(
    normalizeNotificationsResponse({ success: true, notifications: [baseNotification({ type: 'gift' })] }),
    null,
  );
  assert.equal(
    normalizeNotificationsResponse({
      success: true,
      count: 5,
      notifications: [baseNotification()],
    }),
    null,
  );
  assert.equal(
    normalizeNotificationsResponse({
      success: true,
      notifications: [baseNotification({ actor: { _id: 'u2', name: 'Nadia', email: 'x@y.z' } })],
    }),
    null,
  );
});

test('normalizeUnreadCountResponse requires a non-negative integer', () => {
  assert.deepEqual(normalizeUnreadCountResponse({ success: true, count: 3 }), { count: 3 });
  assert.equal(normalizeUnreadCountResponse({ success: true, count: -1 }), null);
  assert.equal(normalizeUnreadCountResponse({ success: true, count: '3' }), null);
  assert.equal(normalizeUnreadCountResponse({ success: false, count: 3 }), null);
});

test('fetchNotifications uses the injected client once', async () => {
  const client = createClient({
    get: () => ({ success: true, count: 1, limit: 20, notifications: [baseNotification()] }),
  });

  const result = await fetchNotifications({ apiClient: client });

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].path, '/api/notifications?limit=20');
});

test('fetchNotifications reports a fixed failure message', async () => {
  const client = createClient({ get: () => ({ success: false, error: 'boom\n at Object.<anonymous>' }) });
  const result = await fetchNotifications({ apiClient: client });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Unable to load notifications.');
  assert.deepEqual(result.notifications, []);
});

test('fetchUnreadCount returns the server count', async () => {
  const client = createClient({ get: () => ({ success: true, count: 7 }) });
  const result = await fetchUnreadCount({ apiClient: client });
  assert.equal(result.ok, true);
  assert.equal(result.count, 7);
  assert.equal(client.calls[0].path, '/api/notifications/unread-count');
});

test('markNotificationRead patches a single notification', async () => {
  const client = createClient({ patch: () => ({ success: true, notification: baseNotification({ read: true }) }) });
  const result = await markNotificationRead('n1', { apiClient: client });

  assert.equal(result.ok, true);
  assert.equal(result.notification.read, true);
  assert.equal(client.calls[0].method, 'PATCH');
  assert.equal(client.calls[0].path, '/api/notifications/n1/read');
});

test('markNotificationRead refuses another user payload shape', async () => {
  const client = createClient({ patch: () => ({ success: false, error: 'Not authorized' }) });
  const result = await markNotificationRead('n1', { apiClient: client });
  assert.equal(result.ok, false);
  assert.equal(result.notification, null);
});

test('markAllNotificationsRead patches read-all once', async () => {
  const client = createClient({ patch: () => ({ success: true, modified: 4 }) });
  const result = await markAllNotificationsRead({ apiClient: client });

  assert.equal(result.ok, true);
  assert.equal(result.modified, 4);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].path, '/api/notifications/read-all');
});

test('services never call a client when none is supplied', async () => {
  assert.equal((await fetchNotifications({})).ok, false);
  assert.equal((await fetchUnreadCount({})).ok, false);
  assert.equal((await markNotificationRead('n1', {})).ok, false);
  assert.equal((await markAllNotificationsRead({})).ok, false);
});
