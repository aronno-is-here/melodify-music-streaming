import test from 'node:test';
import assert from 'node:assert/strict';
import * as notificationUiModule from './notificationUi.js';
import {
  NOTIFICATION_EMPTY_MESSAGE,
  NOTIFICATION_ERROR_MESSAGE,
  buildNotificationItems,
  clampUnreadCount,
  describeNotification,
  getNotificationActorId,
  getNotificationActorName,
  getNotificationTarget,
  getUnreadBadge,
} from './notificationUi.js';

function notification(overrides = {}) {
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

test('5. notification text is human readable for every supported type', () => {
  assert.equal(
    describeNotification(notification({ type: 'friend_request', actor: { _id: 'u2', name: 'Rahim' } })),
    'Rahim sent you a friend request',
  );
  assert.equal(
    describeNotification(notification({ type: 'friend_accepted', actor: { _id: 'u2', name: 'Karim' } })),
    'Karim accepted your friend request',
  );
  assert.equal(
    describeNotification(notification({ type: 'post_like', actor: { _id: 'u2', name: 'Nadia' } })),
    'Nadia liked your post',
  );
  assert.equal(
    describeNotification(notification({ type: 'post_comment', actor: { _id: 'u2', name: 'Samira' } })),
    'Samira commented on your post',
  );
  assert.equal(
    describeNotification(notification({ type: 'post_share', actor: { _id: 'u2', name: 'Rafi' } })),
    'Rafi shared your post',
  );
});

test('notification text never leaks raw enum values', () => {
  for (const type of ['friend_request', 'friend_accepted', 'post_like', 'post_comment', 'post_share']) {
    const text = describeNotification(notification({ type, actor: { _id: 'u2', name: 'Ayaan' } }));
    assert.equal(text.includes(type), false, type);
    assert.equal(text.includes('_'), false, type);
  }
  assert.equal(describeNotification({ type: 'unknown_kind' }), 'Someone interacted with your post');
  assert.equal(describeNotification(null), '');
});

test('missing actor names fall back to a safe label', () => {
  assert.equal(getNotificationActorName(notification({ actor: null })), 'Someone');
  assert.equal(getNotificationActorName(notification({ actor: { _id: 'u2', name: '   ' } })), 'Someone');
  assert.equal(getNotificationActorName(notification({ actor: 'u2' })), 'Someone');
  assert.equal(getNotificationActorId(notification({ actor: 'u2' })), 'u2');
});

test('14. notification navigation targets profile or feed', () => {
  assert.equal(
    getNotificationTarget(notification({ type: 'friend_request', actor: { _id: 'u2', name: 'Rahim' } })),
    '/user/u2',
  );
  assert.equal(
    getNotificationTarget(notification({ type: 'friend_accepted', actor: { _id: 'u2', name: 'Karim' } })),
    '/user/u2',
  );
  assert.equal(getNotificationTarget(notification({ type: 'post_like' })), '/feed');
  assert.equal(getNotificationTarget(notification({ type: 'post_comment' })), '/feed');
  assert.equal(getNotificationTarget(notification({ type: 'post_share' })), '/feed');
  assert.equal(getNotificationTarget(notification({ type: 'friend_request', actor: { name: 'Rahim' } })), '/feed');
});

test('6. friend action helpers are retired and items never expose action fields', () => {
  assert.equal('getFriendActionRequestId' in notificationUiModule, false);
  assert.equal('hasFriendActions' in notificationUiModule, false);

  const pending = notification({ type: 'friend_request', friendRequest: 'r1', actor: { _id: 'u3', name: 'Rahim' } });
  const items = buildNotificationItems([pending, notification({ type: 'post_like' })]);
  assert.equal('showFriendActions' in items[0], false);
  assert.equal('requestId' in items[0], false);
  assert.equal('showFriendActions' in items[1], false);
  assert.equal('requestId' in items[1], false);
  assert.equal(items[0].text, 'Rahim sent you a friend request');
  assert.equal(items[0].target, '/user/u3');
  assert.equal(items[1].text, 'Nadia liked your post');
  assert.equal(items[1].target, '/feed');
  assert.equal(items[0].initial, 'R');
  assert.equal(items[1].initial, 'N');
});

test('2. unread badge renders the exact count and a readable label', () => {
  assert.deepEqual(getUnreadBadge(0), {
    show: false,
    text: '',
    ariaLabel: 'No unread notifications',
  });
  assert.equal(getUnreadBadge(1).text, '1');
  assert.equal(getUnreadBadge(1).ariaLabel, '1 unread notification');
  assert.equal(getUnreadBadge(7).text, '7');
  assert.equal(getUnreadBadge(7).ariaLabel, '7 unread notifications');
  assert.equal(getUnreadBadge(250).text, '99+');
  assert.equal(getUnreadBadge(-3).show, false);
  assert.equal(getUnreadBadge('4').show, false);
  assert.equal(clampUnreadCount(-1), 0);
  assert.equal(clampUnreadCount(5), 5);
});

test('panel state messages are stable', () => {
  assert.equal(NOTIFICATION_EMPTY_MESSAGE, 'No notifications yet.');
  assert.equal(NOTIFICATION_ERROR_MESSAGE, 'Unable to load notifications.');
});

test('buildNotificationItems tolerates bad input', () => {
  assert.deepEqual(buildNotificationItems(null), []);
  assert.deepEqual(buildNotificationItems('nope'), []);
  assert.equal(buildNotificationItems([null, undefined, 42, notification()]).length, 1);
});
