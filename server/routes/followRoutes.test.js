import test from 'node:test';
import assert from 'node:assert/strict';
import followRoutes from './followRoutes.js';
import Follow from '../models/Follow.js';
import User from '../models/User.js';
import {
  createCollection,
  createRes,
  getRouteHandler,
  installModelDoubles,
} from './socialTestHarness.js';

const ME_ID = '64b64b64b64b64b64b64b721';
const TARGET_ID = '64b64b64b64b64b64b64b722';
const OTHER_ID = '64b64b64b64b64b64b64b723';
const UNKNOWN_ID = '64b64b64b64b64b64b64b7ff';

const followHandler = getRouteHandler(followRoutes, '/:userId', 'post');
const unfollowHandler = getRouteHandler(followRoutes, '/:userId', 'delete');
const followersHandler = getRouteHandler(followRoutes, '/:userId/followers', 'get');
const followingHandler = getRouteHandler(followRoutes, '/:userId/following', 'get');

function seedUser(id, overrides = {}) {
  return {
    _id: id,
    name: 'Listener',
    email: `${id}@example.com`,
    avatar: '',
    bio: 'Private bio',
    role: 'user',
    ...overrides,
  };
}

function setup({ users = [], follows = [] } = {}) {
  const userStore = createCollection({ idPrefix: 'u'.repeat(16) });
  const followStore = createCollection({
    idPrefix: 'f'.repeat(16),
    populateRef: (id) => userStore._docs.find((doc) => String(doc._id) === String(id)) || null,
  });

  for (const doc of users) userStore._docs.push({ createdAt: new Date(), ...doc });
  for (const doc of follows) followStore._docs.push({ createdAt: new Date(), ...doc });

  const restore = installModelDoubles({ Follow, User }, { Follow: followStore, User: userStore });
  return { userStore, followStore, restore };
}

function run(handler, { userId = ME_ID, params = {}, query = {} } = {}) {
  const res = createRes();
  const req = { user: { _id: userId }, params: { userId, ...params }, query, headers: {}, body: {} };
  return Promise.resolve(handler(req, res)).then(() => res);
}

test('1. following a user creates the edge and reports isFollowing true', async () => {
  const ctx = setup({ users: [seedUser(ME_ID), seedUser(TARGET_ID)] });
  try {
    const res = await run(followHandler, { params: { userId: TARGET_ID } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.isFollowing, true);
    assert.equal(res.body.followersCount, 1);
    assert.equal(res.body.followingCount, 0);
    assert.equal(ctx.followStore._docs.length, 1);
    assert.equal(String(ctx.followStore._docs[0].follower), ME_ID);
    assert.equal(String(ctx.followStore._docs[0].following), TARGET_ID);
  } finally {
    ctx.restore();
  }
});

test('2. following twice is idempotent', async () => {
  const ctx = setup({ users: [seedUser(ME_ID), seedUser(TARGET_ID)] });
  try {
    const first = await run(followHandler, { params: { userId: TARGET_ID } });
    const second = await run(followHandler, { params: { userId: TARGET_ID } });

    assert.equal(first.body.isFollowing, true);
    assert.equal(second.body.success, true);
    assert.equal(second.body.isFollowing, true);
    assert.equal(ctx.followStore._docs.length, 1);
  } finally {
    ctx.restore();
  }
});

test('3. cannot follow yourself', async () => {
  const ctx = setup({ users: [seedUser(ME_ID)] });
  try {
    const res = await run(followHandler, { params: { userId: ME_ID } });
    assert.deepEqual(res.body, { success: false, error: 'You cannot follow yourself.' });
    assert.equal(ctx.followStore._docs.length, 0);
  } finally {
    ctx.restore();
  }
});

test('4. following an unknown user returns 404', async () => {
  const ctx = setup({ users: [seedUser(ME_ID)] });
  try {
    const res = await run(followHandler, { params: { userId: UNKNOWN_ID } });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    assert.equal(ctx.followStore._docs.length, 0);
  } finally {
    ctx.restore();
  }
});

test('5. unfollowing removes the edge and reports isFollowing false', async () => {
  const ctx = setup({
    users: [seedUser(ME_ID), seedUser(TARGET_ID)],
    follows: [{ _id: 'f'.repeat(16) + '00000001', follower: ME_ID, following: TARGET_ID }],
  });
  try {
    const res = await run(unfollowHandler, { params: { userId: TARGET_ID } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.isFollowing, false);
    assert.equal(res.body.followersCount, 0);
    assert.equal(ctx.followStore._docs.length, 0);
  } finally {
    ctx.restore();
  }
});

test('6. follower list exposes only public-safe identity fields', async () => {
  const ctx = setup({
    users: [seedUser(ME_ID), seedUser(OTHER_ID, { name: 'Karim', bio: 'Hidden' })],
    follows: [{ _id: 'f'.repeat(16) + '00000002', follower: OTHER_ID, following: ME_ID }],
  });
  try {
    const res = await run(followersHandler, { params: { userId: ME_ID } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.users.length, 1);
    const entry = res.body.users[0];
    assert.deepEqual(Object.keys(entry).sort(), ['_id', 'avatar', 'isFollowing', 'name']);
    assert.equal('email' in entry, false);
    assert.equal('bio' in entry, false);
    assert.equal(entry.name, 'Karim');
  } finally {
    ctx.restore();
  }
});

test('7. following list exposes only public-safe identity fields', async () => {
  const ctx = setup({
    users: [seedUser(ME_ID), seedUser(OTHER_ID, { name: 'Rahim', bio: 'Hidden' })],
    follows: [{ _id: 'f'.repeat(16) + '00000003', follower: ME_ID, following: OTHER_ID }],
  });
  try {
    const res = await run(followingHandler, { params: { userId: ME_ID } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.users.length, 1);
    const entry = res.body.users[0];
    assert.deepEqual(Object.keys(entry).sort(), ['_id', 'avatar', 'isFollowing', 'name']);
    assert.equal('email' in entry, false);
    assert.equal('bio' in entry, false);
  } finally {
    ctx.restore();
  }
});

test('8. follower entries mark which ones the viewer already follows', async () => {
  const ctx = setup({
    users: [seedUser(ME_ID), seedUser(OTHER_ID, { name: 'Karim' })],
    follows: [
      { _id: 'f'.repeat(16) + '00000004', follower: OTHER_ID, following: ME_ID },
      { _id: 'f'.repeat(16) + '00000005', follower: ME_ID, following: OTHER_ID },
    ],
  });
  try {
    const res = await run(followersHandler, { params: { userId: ME_ID } });
    assert.equal(res.body.users[0].isFollowing, true);
  } finally {
    ctx.restore();
  }
});

test('9. follower list only returns edges pointing at the requested profile', async () => {
  const ctx = setup({
    users: [seedUser(ME_ID), seedUser(TARGET_ID), seedUser(OTHER_ID)],
    follows: [
      { _id: 'f'.repeat(16) + '00000006', follower: OTHER_ID, following: ME_ID },
      { _id: 'f'.repeat(16) + '00000007', follower: OTHER_ID, following: TARGET_ID },
    ],
  });
  try {
    const mine = await run(followersHandler, { params: { userId: ME_ID } });
    assert.equal(mine.body.users.length, 1);

    const theirs = await run(followersHandler, { params: { userId: TARGET_ID } });
    assert.equal(theirs.body.users.length, 1);
    assert.equal(String(theirs.body.users[0]._id), OTHER_ID);
  } finally {
    ctx.restore();
  }
});

test('10. follower list keeps the bounded limit and page math', async () => {
  const follows = [];
  for (let index = 0; index < 3; index += 1) {
    follows.push({
      _id: `f`.repeat(16) + String(index).padStart(8, '0'),
      follower: OTHER_ID,
      following: ME_ID,
    });
  }
  const ctx = setup({ users: [seedUser(ME_ID), seedUser(OTHER_ID)], follows });
  try {
    const capped = await run(followersHandler, { params: { userId: ME_ID }, query: { limit: '500' } });
    assert.equal(capped.body.limit, 50);
    assert.equal(capped.body.total, 3);
    assert.equal(capped.body.pages, 1);

    const paged = await run(followersHandler, {
      params: { userId: ME_ID },
      query: { page: '2', limit: '2' },
    });
    assert.equal(paged.body.users.length, 1);
    assert.equal(paged.body.page, 2);
  } finally {
    ctx.restore();
  }
});
