import test from 'node:test';
import assert from 'node:assert/strict';
import notificationRoutes, { ACTIVE_NOTIFICATION_TYPES, projectNotification } from './notificationRoutes.js';
import likeRoutes from './likeRoutes.js';
import commentRoutes from './commentRoutes.js';
import postRoutes from './postRoutes.js';
import Notification from '../models/Notification.js';
import Post from '../models/Post.js';
import Like from '../models/Like.js';
import Comment from '../models/Comment.js';
import { createNotification } from '../services/notificationService.js';
import {
  createCollection,
  createRes,
  getRouteHandler,
  installModelDoubles,
} from './socialTestHarness.js';

const USER_A = '64b64b64b64b64b64b64b611';
const USER_B = '64b64b64b64b64b64b64b612';
const POST_ID = '64b64b64b64b64b64b64b621';

const listHandler = getRouteHandler(notificationRoutes, '/', 'get');
const unreadHandler = getRouteHandler(notificationRoutes, '/unread-count', 'get');
const readAllHandler = getRouteHandler(notificationRoutes, '/read-all', 'patch');
const readOneHandler = getRouteHandler(notificationRoutes, '/:id/read', 'patch');

const likeHandler = getRouteHandler(likeRoutes, '/:postId', 'post');
const commentHandler = getRouteHandler(commentRoutes, '/:postId', 'post');
const shareHandler = getRouteHandler(postRoutes, '/:postId/share', 'post');

function seedNotification(id, overrides = {}) {
  return {
    _id: id,
    recipient: USER_A,
    actor: USER_B,
    type: 'post_like',
    read: false,
    post: POST_ID,
    friendRequest: null,
    comment: null,
    dedupKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup({ notifications = [], posts = [], likes = [], comments = [] } = {}) {
  const notificationStore = createCollection({ uniqueKeys: [['dedupKey']], idPrefix: 'n'.repeat(16) });
  const postStore = createCollection({ idPrefix: 'p'.repeat(16) });
  const likeStore = createCollection({ uniqueKeys: [['user', 'post']], idPrefix: 'l'.repeat(16) });
  const commentStore = createCollection({ idPrefix: 'c'.repeat(16) });

  for (const doc of notifications) notificationStore._docs.push({ createdAt: new Date(), ...doc });
  for (const doc of posts) {
    postStore._docs.push({ likesCount: 0, commentsCount: 0, visibility: 'public', createdAt: new Date(), ...doc });
  }
  for (const doc of likes) likeStore._docs.push({ createdAt: new Date(), ...doc });
  for (const doc of comments) commentStore._docs.push({ createdAt: new Date(), ...doc });

  const restore = installModelDoubles(
    { Notification, Post, Like, Comment },
    {
      Notification: notificationStore,
      Post: postStore,
      Like: likeStore,
      Comment: commentStore,
    }
  );

  return { notificationStore, postStore, likeStore, commentStore, restore };
}

function run(handler, { userId, params = {}, query = {}, body = {} } = {}) {
  const res = createRes();
  const req = { user: { _id: userId }, params, query, body, headers: {} };
  return Promise.resolve(handler(req, res)).then(() => res);
}

test('17. notification list is recipient-scoped and newest first', async () => {
  const ctx = setup({
    notifications: [
      seedNotification('n'.repeat(16) + '00000001', { createdAt: new Date('2026-01-01T00:00:00Z') }),
      seedNotification('n'.repeat(16) + '00000002', { recipient: USER_B, createdAt: new Date('2026-01-03T00:00:00Z') }),
      seedNotification('n'.repeat(16) + '00000003', { createdAt: new Date('2026-01-02T00:00:00Z') }),
    ],
  });
  try {
    const res = await run(listHandler, { userId: USER_A });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.notifications.length, 2);
    assert.equal(res.body.notifications[0]._id, 'n'.repeat(16) + '00000003');
    assert.equal(res.body.notifications[1]._id, 'n'.repeat(16) + '00000001');
    assert.equal(res.body.notifications[0].actor.name, undefined);
    assert.equal(res.body.notifications[0].actor.avatar, undefined);
  } finally {
    ctx.restore();
  }
});

test('notification list honours a bounded limit', async () => {
  const ctx = setup({
    notifications: [
      seedNotification('n'.repeat(16) + '00000011'),
      seedNotification('n'.repeat(16) + '00000012'),
      seedNotification('n'.repeat(16) + '00000013'),
    ],
  });
  try {
    const limited = await run(listHandler, { userId: USER_A, query: { limit: '2' } });
    assert.equal(limited.body.notifications.length, 2);
    assert.equal(limited.body.limit, 2);

    const capped = await run(listHandler, { userId: USER_A, query: { limit: '500' } });
    assert.equal(capped.body.limit, 50);

    const invalid = await run(listHandler, { userId: USER_A, query: { limit: 'abc' } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.body.success, false);
  } finally {
    ctx.restore();
  }
});

test('18. unread count only counts the current user unread notifications', async () => {
  const ctx = setup({
    notifications: [
      seedNotification('n'.repeat(16) + '00000021'),
      seedNotification('n'.repeat(16) + '00000022', { read: true }),
      seedNotification('n'.repeat(16) + '00000023'),
      seedNotification('n'.repeat(16) + '00000024', { recipient: USER_B, read: false }),
    ],
  });
  try {
    const res = await run(unreadHandler, { userId: USER_A });
    assert.deepEqual(res.body, { success: true, count: 2 });
  } finally {
    ctx.restore();
  }
});

test('19. mark one notification read', async () => {
  const ctx = setup({
    notifications: [seedNotification('n'.repeat(16) + '00000031')],
  });
  try {
    const res = await run(readOneHandler, {
      userId: USER_A,
      params: { id: 'n'.repeat(16) + '00000031' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.notification.read, true);
    assert.equal(ctx.notificationStore._docs[0].read, true);

    const count = await run(unreadHandler, { userId: USER_A });
    assert.equal(count.body.count, 0);
  } finally {
    ctx.restore();
  }
});

test('20. mark all notifications read', async () => {
  const ctx = setup({
    notifications: [
      seedNotification('n'.repeat(16) + '00000041'),
      seedNotification('n'.repeat(16) + '00000042'),
      seedNotification('n'.repeat(16) + '00000043', { recipient: USER_B }),
    ],
  });
  try {
    const res = await run(readAllHandler, { userId: USER_A });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.modified, 2);
    assert.equal(ctx.notificationStore._docs[0].read, true);
    assert.equal(ctx.notificationStore._docs[1].read, true);
    assert.equal(ctx.notificationStore._docs[2].read, false);

    const count = await run(unreadHandler, { userId: USER_A });
    assert.equal(count.body.count, 0);
  } finally {
    ctx.restore();
  }
});

test('21. cannot modify another user notification', async () => {
  const ctx = setup({
    notifications: [seedNotification('n'.repeat(16) + '00000051')],
  });
  try {
    const res = await run(readOneHandler, {
      userId: USER_B,
      params: { id: 'n'.repeat(16) + '00000051' },
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.equal(ctx.notificationStore._docs[0].read, false);

    const missing = await run(readOneHandler, {
      userId: USER_A,
      params: { id: 'n'.repeat(16) + '00000099' },
    });
    assert.equal(missing.statusCode, 404);
  } finally {
    ctx.restore();
  }
});

test('13. like creates a post_like notification for the post author', async () => {
  const ctx = setup({
    posts: [{ _id: POST_ID, author: USER_B }],
  });
  try {
    const res = await run(likeHandler, { userId: USER_A, params: { postId: POST_ID } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isLiked, true);

    assert.equal(ctx.notificationStore._docs.length, 1);
    const notification = ctx.notificationStore._docs[0];
    assert.equal(notification.type, 'post_like');
    assert.equal(String(notification.recipient), USER_B);
    assert.equal(String(notification.actor), USER_A);
    assert.equal(String(notification.post), POST_ID);
    assert.equal(notification.read, false);
    assert.ok(notification.dedupKey.includes('post_like'));
  } finally {
    ctx.restore();
  }
});

test('14. duplicate like does not duplicate the notification', async () => {
  const ctx = setup({
    posts: [{ _id: POST_ID, author: USER_B, likesCount: 1 }],
    likes: [{ _id: 'l'.repeat(16) + '00000001', user: USER_A, post: POST_ID }],
  });
  try {
    const res = await run(likeHandler, { userId: USER_A, params: { postId: POST_ID } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isLiked, true);
    assert.equal(ctx.notificationStore._docs.length, 0);
    assert.equal(ctx.likeStore._docs.length, 1);
  } finally {
    ctx.restore();
  }
});

test('13b. liking your own post never notifies yourself', async () => {
  const ctx = setup({
    posts: [{ _id: POST_ID, author: USER_A }],
  });
  try {
    const res = await run(likeHandler, { userId: USER_A, params: { postId: POST_ID } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isLiked, true);
    assert.equal(ctx.notificationStore._docs.length, 0);
  } finally {
    ctx.restore();
  }
});

test('15. comment creates a post_comment notification', async () => {
  const ctx = setup({
    posts: [{ _id: POST_ID, author: USER_B }],
  });
  try {
    const res = await run(commentHandler, {
      userId: USER_A,
      params: { postId: POST_ID },
      body: { text: 'Nice take!' },
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.comment);

    assert.equal(ctx.notificationStore._docs.length, 1);
    const notification = ctx.notificationStore._docs[0];
    assert.equal(notification.type, 'post_comment');
    assert.equal(String(notification.recipient), USER_B);
    assert.equal(String(notification.actor), USER_A);
    assert.ok(notification.comment);
  } finally {
    ctx.restore();
  }
});

test('15b. self comment never notifies yourself', async () => {
  const ctx = setup({
    posts: [{ _id: POST_ID, author: USER_A }],
  });
  try {
    const res = await run(commentHandler, {
      userId: USER_A,
      params: { postId: POST_ID },
      body: { text: 'My own post' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(ctx.notificationStore._docs.length, 0);
  } finally {
    ctx.restore();
  }
});

test('16. share records one post_share notification for the author', async () => {
  const ctx = setup({
    posts: [{ _id: POST_ID, author: USER_B }],
  });
  try {
    const first = await run(shareHandler, { userId: USER_A, params: { postId: POST_ID } });
    const second = await run(shareHandler, { userId: USER_A, params: { postId: POST_ID } });

    assert.equal(first.statusCode, 200);
    assert.equal(first.body.shared, true);
    assert.equal(second.statusCode, 200);
    assert.equal(ctx.postStore._docs.length, 1, 'no repost is created');

    const shares = ctx.notificationStore._docs.filter((doc) => doc.type === 'post_share');
    assert.equal(shares.length, 1, 'double click / retry does not duplicate the share notification');
    assert.equal(String(shares[0].recipient), USER_B);
    assert.equal(String(shares[0].actor), USER_A);
  } finally {
    ctx.restore();
  }
});

test('16b. self share never notifies yourself', async () => {
  const ctx = setup({
    posts: [{ _id: POST_ID, author: USER_A }],
  });
  try {
    const res = await run(shareHandler, { userId: USER_A, params: { postId: POST_ID } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.notified, false);
    assert.equal(ctx.notificationStore._docs.length, 0);
  } finally {
    ctx.restore();
  }
});

test('share returns 404 for a missing post', async () => {
  const ctx = setup();
  try {
    const res = await run(shareHandler, {
      userId: USER_A,
      params: { postId: '64b64b64b64b64b64b64b6ff' },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    assert.equal(ctx.notificationStore._docs.length, 0);
  } finally {
    ctx.restore();
  }
});

test('12. createNotification never notifies a user about their own action', async () => {
  const ctx = setup();
  try {
    const result = await createNotification({
      recipient: USER_A,
      actor: USER_A,
      type: 'post_like',
      post: POST_ID,
    });
    assert.equal(result, null);
    assert.equal(ctx.notificationStore._docs.length, 0);
  } finally {
    ctx.restore();
  }
});

test('active notification types are exactly the post interaction set', () => {
  assert.deepEqual([...ACTIVE_NOTIFICATION_TYPES], ['post_like', 'post_comment', 'post_share']);
  assert.equal(ACTIVE_NOTIFICATION_TYPES.includes('friend_request'), false);
  assert.equal(ACTIVE_NOTIFICATION_TYPES.includes('friend_accepted'), false);
});

test('legacy friend notification types are excluded from the bell list', async () => {
  const ctx = setup({
    notifications: [
      seedNotification('n'.repeat(16) + '00000061', { type: 'post_like' }),
      seedNotification('n'.repeat(16) + '00000062', { type: 'friend_request', friendRequest: 'f'.repeat(16) + '00000001' }),
      seedNotification('n'.repeat(16) + '00000063', { type: 'friend_accepted', friendRequest: 'f'.repeat(16) + '00000001' }),
      seedNotification('n'.repeat(16) + '00000064', { type: 'post_comment' }),
    ],
  });
  try {
    const res = await run(listHandler, { userId: USER_A });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.notifications.length, 2);
    const types = res.body.notifications.map((item) => item.type).sort();
    assert.deepEqual(types, ['post_comment', 'post_like']);
    assert.equal(res.body.count, 2);
  } finally {
    ctx.restore();
  }
});

test('unread count ignores legacy friend notification types so badges stay consistent', async () => {
  const ctx = setup({
    notifications: [
      seedNotification('n'.repeat(16) + '00000071', { type: 'friend_request', read: false }),
      seedNotification('n'.repeat(16) + '00000072', { type: 'friend_accepted', read: false }),
      seedNotification('n'.repeat(16) + '00000073', { type: 'post_like', read: false }),
      seedNotification('n'.repeat(16) + '00000074', { type: 'post_share', read: true }),
    ],
  });
  try {
    const count = await run(unreadHandler, { userId: USER_A });
    assert.deepEqual(count.body, { success: true, count: 1 });

    const list = await run(listHandler, { userId: USER_A });
    const unreadListed = list.body.notifications.filter((item) => !item.read);
    assert.equal(unreadListed.length, count.body.count, 'list and badge report the same unread set');
  } finally {
    ctx.restore();
  }
});

test('read-all may mark legacy friend rows read as a harmless superset', async () => {
  const ctx = setup({
    notifications: [
      seedNotification('n'.repeat(16) + '00000081', { type: 'friend_request' }),
      seedNotification('n'.repeat(16) + '00000082', { type: 'post_like' }),
    ],
  });
  try {
    const res = await run(readAllHandler, { userId: USER_A });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.modified, 2);
    assert.equal(ctx.notificationStore._docs.every((doc) => doc.read === true), true);

    const count = await run(unreadHandler, { userId: USER_A });
    assert.equal(count.body.count, 0);
  } finally {
    ctx.restore();
  }
});

test('mixed active, legacy, and null-reference rows load from the list and unread count', async () => {
  const hugeAvatar = `data:image/png;base64,${'A'.repeat(5000)}`;
  const longName = 'N'.repeat(400);
  const ctx = setup({
    notifications: [
      seedNotification('n'.repeat(16) + '00000091', {
        type: 'post_like',
        read: false,
        actor: { _id: USER_B, name: longName, avatar: hugeAvatar },
      }),
      seedNotification('n'.repeat(16) + '00000092', {
        type: 'post_comment',
        read: false,
        actor: null,
        post: null,
        comment: null,
        friendRequest: null,
      }),
      seedNotification('n'.repeat(16) + '00000093', {
        type: 'friend_request',
        read: false,
        friendRequest: 'f'.repeat(16) + '00000001',
      }),
      seedNotification('n'.repeat(16) + '00000094', {
        type: 'friend_accepted',
        read: true,
        friendRequest: 'f'.repeat(16) + '00000001',
      }),
    ],
  });
  try {
    const list = await run(listHandler, { userId: USER_A, query: { limit: '20' } });
    assert.equal(list.statusCode, 200);
    assert.equal(list.body.success, true);
    assert.equal(list.body.notifications.length, 2, 'only active rows are returned');
    const types = list.body.notifications.map((row) => row.type).sort();
    assert.deepEqual(types, ['post_comment', 'post_like']);
    assert.equal(list.body.count, 2);

    const populatedRow = list.body.notifications.find((row) => row.type === 'post_like');
    assert.equal(populatedRow.actor.name.length <= 120, true, 'actor name is bounded');
    assert.equal(populatedRow.actor.avatar, '', 'oversized base64 avatars are dropped');

    const nullRow = list.body.notifications.find((row) => row.type === 'post_comment');
    assert.equal(nullRow.actor, null, 'deleted actor serializes as null');
    assert.equal(nullRow.post, null, 'deleted post serializes as null');
    assert.equal(nullRow.comment, null, 'deleted comment serializes as null');
    assert.equal(JSON.parse(JSON.stringify(nullRow)).actor, null, 'payload survives JSON serialization');

    const count = await run(unreadHandler, { userId: USER_A });
    assert.equal(count.statusCode, 200);
    assert.deepEqual(count.body, { success: true, count: 2 }, 'unread count uses the same active-type rule');
    const unreadActive = list.body.notifications.filter((row) => !row.read).length;
    assert.equal(unreadActive, count.body.count, 'legacy rows never widen either endpoint');
  } finally {
    ctx.restore();
  }
});

test('actor projections are bounded to values the client accepts', () => {
  const projected = projectNotification({
    _id: 'n1',
    recipient: USER_A,
    type: 'post_like',
    read: false,
    createdAt: new Date('2026-09-15T00:00:00Z'),
    actor: { _id: USER_B, name: 'N'.repeat(400), avatar: `data:image/jpeg;base64,${'B'.repeat(9000)}` },
    post: POST_ID,
    comment: null,
    friendRequest: null,
  });
  assert.equal(projected.actor.name.length, 120);
  assert.equal(projected.actor.avatar, '');

  const shortUrl = projectNotification({
    _id: 'n2',
    recipient: USER_A,
    type: 'post_like',
    read: true,
    createdAt: new Date('2026-09-15T00:00:00Z'),
    actor: { _id: USER_B, name: 'Sana', avatar: 'https://example.com/avatar.png' },
    post: POST_ID,
    comment: null,
    friendRequest: null,
  });
  assert.equal(shortUrl.actor.name, 'Sana');
  assert.equal(shortUrl.actor.avatar, 'https://example.com/avatar.png');
});

test('friend_request and friend_accepted notifications carry the actor and request refs', async () => {
  const ctx = setup();
  try {
    const request = await createNotification({
      recipient: USER_B,
      actor: USER_A,
      type: 'friend_request',
      friendRequest: 'f'.repeat(16) + '00000001',
    });
    assert.ok(request);
    assert.equal(String(request.recipient), USER_B);
    assert.equal(String(request.actor), USER_A);
    assert.equal(String(request.friendRequest), 'f'.repeat(16) + '00000001');

    const accepted = await createNotification({
      recipient: USER_A,
      actor: USER_B,
      type: 'friend_accepted',
      friendRequest: 'f'.repeat(16) + '00000001',
    });
    assert.ok(accepted);
    assert.equal(accepted.type, 'friend_accepted');
    assert.equal(accepted.read, false);

    const denied = await createNotification({
      recipient: USER_A,
      actor: USER_A,
      type: 'friend_accepted',
      friendRequest: 'f'.repeat(16) + '00000001',
    });
    assert.equal(denied, null);
    assert.equal(ctx.notificationStore._docs.length, 2);
  } finally {
    ctx.restore();
  }
});
