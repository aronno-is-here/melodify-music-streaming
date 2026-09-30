import test from 'node:test';
import assert from 'node:assert/strict';
import friendRoutes, { FRIEND_STATUS_LABELS, resolveFriendRelation } from './friendRoutes.js';
import Friendship from '../models/Friendship.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import {
  createCollection,
  createRes,
  getRouteHandler,
  installModelDoubles,
} from './socialTestHarness.js';

const USER_A = '64b64b64b64b64b64b64b601';
const USER_B = '64b64b64b64b64b64b64b602';
const USER_C = '64b64b64b64b64b64b64b603';

const handlers = {
  status: getRouteHandler(friendRoutes, '/status/:userId', 'get'),
  request: getRouteHandler(friendRoutes, '/request/:userId', 'post'),
  accept: getRouteHandler(friendRoutes, '/:requestId/accept', 'post'),
  reject: getRouteHandler(friendRoutes, '/:requestId/reject', 'post'),
  requests: getRouteHandler(friendRoutes, '/requests', 'get'),
  list: getRouteHandler(friendRoutes, '/', 'get'),
};

function setup({ friendships = [], users = [USER_A, USER_B, USER_C] } = {}) {
  const friendshipStore = createCollection({ uniqueKeys: [['requester', 'recipient']], idPrefix: 'f'.repeat(16) });
  const userStore = createCollection({ idPrefix: 'u'.repeat(16) });
  const notificationStore = createCollection({ uniqueKeys: [['dedupKey']], idPrefix: 'n'.repeat(16) });

  for (const doc of friendships) {
    friendshipStore._docs.push({
      acceptedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...doc,
    });
  }
  for (const id of users) {
    userStore._docs.push({ _id: id, name: `User ${id.slice(-2)}`, avatar: '' });
  }

  const restore = installModelDoubles(
    { Friendship, User, Notification },
    {
      Friendship: friendshipStore,
      User: userStore,
      Notification: notificationStore,
    }
  );

  return { friendshipStore, userStore, notificationStore, restore };
}

function run(handler, { userId, params = {}, query = {}, body = {} } = {}) {
  const res = createRes();
  const req = { user: { _id: userId }, params, query, body, headers: {} };
  return Promise.resolve(handler(req, res)).then(() => res);
}

test('1. send request creates a pending friendship and a friend_request notification', async () => {
  const ctx = setup();
  try {
    const res = await run(handlers.request, { userId: USER_A, params: { userId: USER_B } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.status, FRIEND_STATUS_LABELS.outgoing_pending);
    assert.ok(res.body.requestId);

    assert.equal(ctx.friendshipStore._docs.length, 1);
    assert.equal(ctx.friendshipStore._docs[0].status, 'pending');
    assert.equal(String(ctx.friendshipStore._docs[0].requester), USER_A);
    assert.equal(String(ctx.friendshipStore._docs[0].recipient), USER_B);

    assert.equal(ctx.notificationStore._docs.length, 1);
    const notification = ctx.notificationStore._docs[0];
    assert.equal(notification.type, 'friend_request');
    assert.equal(String(notification.recipient), USER_B);
    assert.equal(String(notification.actor), USER_A);
    assert.equal(notification.read, false);
  } finally {
    ctx.restore();
  }
});

test('2. cannot send a friend request to yourself', async () => {
  const ctx = setup();
  try {
    const res = await run(handlers.request, { userId: USER_A, params: { userId: USER_A } });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(ctx.friendshipStore._docs.length, 0);
    assert.equal(ctx.notificationStore._docs.length, 0);
  } finally {
    ctx.restore();
  }
});

test('3. duplicate request is idempotent', async () => {
  const ctx = setup();
  try {
    const first = await run(handlers.request, { userId: USER_A, params: { userId: USER_B } });
    const second = await run(handlers.request, { userId: USER_A, params: { userId: USER_B } });

    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.success, true);
    assert.equal(second.body.status, FRIEND_STATUS_LABELS.outgoing_pending);
    assert.equal(second.body.requestId, first.body.requestId);
    assert.equal(second.body.duplicate, true);

    assert.equal(ctx.friendshipStore._docs.length, 1);
    assert.equal(ctx.notificationStore._docs.length, 1);
  } finally {
    ctx.restore();
  }
});

test('4. reverse-direction duplicate request is handled deterministically', async () => {
  const ctx = setup({
    friendships: [{ _id: 'f'.repeat(16) + '00000001', requester: USER_B, recipient: USER_A, status: 'pending' }],
  });
  try {
    const res = await run(handlers.request, { userId: USER_A, params: { userId: USER_B } });

    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, 'FRIEND_REQUEST_INCOMING');
    assert.equal(res.body.status, FRIEND_STATUS_LABELS.incoming_pending);
    assert.equal(res.body.requestId, 'f'.repeat(16) + '00000001');
    assert.equal(ctx.friendshipStore._docs.length, 1);
  } finally {
    ctx.restore();
  }
});

test('5. recipient can accept and the requester gets a friend_accepted notification', async () => {
  const ctx = setup({
    friendships: [{ _id: 'f'.repeat(16) + '00000002', requester: USER_A, recipient: USER_B, status: 'pending' }],
  });
  ctx.notificationStore._docs.push({
    _id: 'n'.repeat(16) + '00000001',
    recipient: USER_B,
    actor: USER_A,
    type: 'friend_request',
    read: false,
    friendRequest: 'f'.repeat(16) + '00000002',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const res = await run(handlers.accept, {
      userId: USER_B,
      params: { requestId: 'f'.repeat(16) + '00000002' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, FRIEND_STATUS_LABELS.friends);

    assert.equal(ctx.friendshipStore._docs[0].status, 'accepted');
    assert.ok(ctx.friendshipStore._docs[0].acceptedAt);

    const types = ctx.notificationStore._docs.map((doc) => doc.type);
    assert.ok(!types.includes('friend_request'), 'pending request notification is closed');
    assert.ok(types.includes('friend_accepted'));

    const accepted = ctx.notificationStore._docs.find((doc) => doc.type === 'friend_accepted');
    assert.equal(String(accepted.recipient), USER_A);
    assert.equal(String(accepted.actor), USER_B);
  } finally {
    ctx.restore();
  }
});

test('6. requester cannot accept their own request', async () => {
  const ctx = setup({
    friendships: [{ _id: 'f'.repeat(16) + '00000003', requester: USER_A, recipient: USER_B, status: 'pending' }],
  });
  try {
    const res = await run(handlers.accept, {
      userId: USER_A,
      params: { requestId: 'f'.repeat(16) + '00000003' },
    });

    assert.equal(res.statusCode, 403);
    assert.equal(res.body.success, false);
    assert.equal(ctx.friendshipStore._docs[0].status, 'pending');
  } finally {
    ctx.restore();
  }
});

test('7. unrelated user cannot accept another request', async () => {
  const ctx = setup({
    friendships: [{ _id: 'f'.repeat(16) + '00000004', requester: USER_A, recipient: USER_B, status: 'pending' }],
  });
  try {
    const res = await run(handlers.accept, {
      userId: USER_C,
      params: { requestId: 'f'.repeat(16) + '00000004' },
    });

    assert.equal(res.statusCode, 403);
    assert.equal(ctx.friendshipStore._docs[0].status, 'pending');
  } finally {
    ctx.restore();
  }
});

test('8. reject closes the request without an acceptance notification', async () => {
  const ctx = setup({
    friendships: [{ _id: 'f'.repeat(16) + '00000005', requester: USER_A, recipient: USER_B, status: 'pending' }],
  });
  ctx.notificationStore._docs.push({
    _id: 'n'.repeat(16) + '00000002',
    recipient: USER_B,
    actor: USER_A,
    type: 'friend_request',
    read: false,
    friendRequest: 'f'.repeat(16) + '00000005',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const res = await run(handlers.reject, {
      userId: USER_B,
      params: { requestId: 'f'.repeat(16) + '00000005' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'rejected');
    assert.equal(ctx.friendshipStore._docs[0].status, 'rejected');
    assert.equal(ctx.notificationStore._docs.length, 0);

    const relation = await resolveFriendRelation(USER_A, USER_B);
    assert.equal(relation.status, FRIEND_STATUS_LABELS.none);
  } finally {
    ctx.restore();
  }
});

test('9. accepted users report friends status', async () => {
  const ctx = setup({
    friendships: [{ _id: 'f'.repeat(16) + '00000006', requester: USER_A, recipient: USER_B, status: 'accepted' }],
  });
  try {
    const res = await run(handlers.status, { userId: USER_A, params: { userId: USER_B } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, FRIEND_STATUS_LABELS.friends);
    assert.equal(res.body.requestId, 'f'.repeat(16) + '00000006');

    const reverse = await run(handlers.status, { userId: USER_B, params: { userId: USER_A } });
    assert.equal(reverse.body.status, FRIEND_STATUS_LABELS.friends);
  } finally {
    ctx.restore();
  }
});

test('friend status reports none / outgoing / incoming correctly', async () => {
  const ctx = setup();
  try {
    const none = await run(handlers.status, { userId: USER_A, params: { userId: USER_B } });
    assert.equal(none.body.status, FRIEND_STATUS_LABELS.none);
    assert.equal(none.body.requestId, null);

    await run(handlers.request, { userId: USER_A, params: { userId: USER_B } });
    const outgoing = await run(handlers.status, { userId: USER_A, params: { userId: USER_B } });
    assert.equal(outgoing.body.status, FRIEND_STATUS_LABELS.outgoing_pending);

    const incoming = await run(handlers.status, { userId: USER_B, params: { userId: USER_A } });
    assert.equal(incoming.body.status, FRIEND_STATUS_LABELS.incoming_pending);
    assert.equal(incoming.body.requestId, outgoing.body.requestId);

    const self = await run(handlers.status, { userId: USER_A, params: { userId: USER_A } });
    assert.equal(self.body.isSelf, true);
    assert.equal(self.body.status, FRIEND_STATUS_LABELS.none);
  } finally {
    ctx.restore();
  }
});

test('unknown target user returns 404', async () => {
  const ctx = setup({ users: [USER_A] });
  try {
    const res = await run(handlers.request, {
      userId: USER_A,
      params: { userId: '64b64b64b64b64b64b64b6ff' },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
  } finally {
    ctx.restore();
  }
});

test('re-request after rejection reopens the same request and refreshes its notification', async () => {
  const ctx = setup({
    friendships: [{ _id: 'f'.repeat(16) + '00000007', requester: USER_A, recipient: USER_B, status: 'rejected' }],
  });
  ctx.notificationStore._docs.push({
    _id: 'n'.repeat(16) + '00000003',
    recipient: USER_B,
    actor: USER_A,
    type: 'friend_request',
    read: true,
    friendRequest: 'f'.repeat(16) + '00000007',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  try {
    const res = await run(handlers.request, { userId: USER_A, params: { userId: USER_B } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.requestId, 'f'.repeat(16) + '00000007');
    assert.equal(ctx.friendshipStore._docs.length, 1);
    assert.equal(ctx.friendshipStore._docs[0].status, 'pending');
    assert.equal(ctx.notificationStore._docs.length, 1);
    assert.equal(ctx.notificationStore._docs[0].read, false);
  } finally {
    ctx.restore();
  }
});

test('incoming request list and friends list are scoped to the current user', async () => {
  const ctx = setup({
    friendships: [
      { _id: 'f'.repeat(16) + '00000008', requester: USER_A, recipient: USER_B, status: 'pending' },
      { _id: 'f'.repeat(16) + '00000009', requester: USER_C, recipient: USER_A, status: 'pending' },
      { _id: 'f'.repeat(16) + '0000000a', requester: USER_A, recipient: USER_C, status: 'accepted' },
    ],
  });
  try {
    const requests = await run(handlers.requests, { userId: USER_B });
    assert.equal(requests.body.count, 1);
    assert.equal(requests.body.requests[0]._id, 'f'.repeat(16) + '00000008');

    const friends = await run(handlers.list, { userId: USER_A });
    assert.equal(friends.body.count, 1);
    assert.equal(String(friends.body.friends[0]._id), USER_C);
  } finally {
    ctx.restore();
  }
});

test('only the pending state can be accepted or rejected', async () => {
  const ctx = setup({
    friendships: [{ _id: 'f'.repeat(16) + '0000000b', requester: USER_A, recipient: USER_B, status: 'accepted' }],
  });
  try {
    const res = await run(handlers.accept, {
      userId: USER_B,
      params: { requestId: 'f'.repeat(16) + '0000000b' },
    });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.status, FRIEND_STATUS_LABELS.friends);
  } finally {
    ctx.restore();
  }
});
