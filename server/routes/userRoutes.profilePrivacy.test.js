import test from 'node:test';
import assert from 'node:assert/strict';
import userRoutes from './userRoutes.js';
import User from '../models/User.js';
import Follow from '../models/Follow.js';
import Playlist from '../models/Playlist.js';
import Post from '../models/Post.js';
import { PROFILE_VISIBILITY_FIELDS } from '../utils/profileVisibility.js';
import {
  createCollection,
  createRes,
  getRouteHandler,
  installModelDoubles,
} from './socialTestHarness.js';

const OWNER_ID = '64b64b64b64b64b64b64b711';
const VIEWER_ID = '64b64b64b64b64b64b64b712';
const STRANGER_ID = '64b64b64b64b64b64b64b713';

const searchHandler = getRouteHandler(userRoutes, '/search', 'get');
const profileHandler = getRouteHandler(userRoutes, '/:userId', 'get');
const settingsHandler = getRouteHandler(userRoutes, '/me/settings', 'put');

function seedUser(id, overrides = {}) {
  return {
    _id: id,
    name: 'Aronno',
    email: 'aronno@example.com',
    password: 'x'.repeat(60),
    dob: new Date('2000-01-02'),
    gender: 'man',
    country: 'Bangladesh',
    role: 'user',
    bio: 'Private bio text',
    avatar: '',
    libraryVisibility: 'private',
    phone: '+8801700000000',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function setup({ users = [], follows = [] } = {}) {
  const userStore = createCollection({ idPrefix: 'u'.repeat(16) });
  const followStore = createCollection({ idPrefix: 'f'.repeat(16) });
  const playlistStore = createCollection({ idPrefix: 'p'.repeat(16) });
  const postStore = createCollection({ idPrefix: 'o'.repeat(16) });

  for (const doc of users) userStore._docs.push({ createdAt: new Date(), ...doc });
  for (const doc of follows) followStore._docs.push({ createdAt: new Date(), ...doc });

  const restore = installModelDoubles(
    { User, Follow, Playlist, Post },
    {
      User: userStore,
      Follow: followStore,
      Playlist: playlistStore,
      Post: postStore,
    }
  );

  return { userStore, followStore, playlistStore, postStore, restore };
}

function run(handler, { user, params = {}, query = {}, body = {} } = {}) {
  const res = createRes();
  const req = { user, params, query, body, headers: {} };
  return Promise.resolve(handler(req, res)).then(() => res);
}

function viewerReq(id = VIEWER_ID) {
  return seedUser(id, { email: 'viewer@example.com', name: 'Viewer' });
}

// Simulates the doc `protect` loads for the owner at request time.
function ownerReq(ctx) {
  return ctx.userStore._docs[0];
}

test('1. owner always receives every personal field and the visibility map', async () => {
  const ctx = setup({ users: [seedUser(OWNER_ID)] });
  try {
    const res = await run(profileHandler, { user: viewerReq(OWNER_ID), params: { userId: OWNER_ID } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.isOwnProfile, true);
    assert.equal(res.body.user.email, 'aronno@example.com');
    assert.equal(res.body.user.phone, '+8801700000000');
    assert.ok(res.body.user.dob);
    assert.equal(res.body.user.gender, 'man');
    assert.equal(res.body.user.country, 'Bangladesh');
    assert.equal(res.body.user.bio, 'Private bio text');
    assert.deepEqual(res.body.user.profileVisibility, {
      email: 'private',
      phone: 'private',
      dob: 'private',
      gender: 'private',
      country: 'private',
      bio: 'private',
    });
  } finally {
    ctx.restore();
  }
});

test('2. legacy user without profileVisibility exposes nothing to another viewer', async () => {
  const legacy = seedUser(OWNER_ID);
  delete legacy.profileVisibility;
  const ctx = setup({ users: [legacy] });
  try {
    const res = await run(profileHandler, { user: viewerReq(), params: { userId: OWNER_ID } });

    assert.equal(res.statusCode, 200);
    for (const field of PROFILE_VISIBILITY_FIELDS) {
      assert.equal(field in res.body.user, false, `${field} must be omitted`);
    }
    assert.equal(res.body.user.name, 'Aronno');
    assert.equal(res.body.user.avatar, '');
    assert.equal(res.body.user.libraryVisibility, 'private');
    assert.equal('profileVisibility' in res.body.user, false);
  } finally {
    ctx.restore();
  }
});

test('3. viewer receives exactly the fields marked public', async () => {
  const ctx = setup({
    users: [seedUser(OWNER_ID, {
      profileVisibility: { email: 'public', dob: 'public', bio: 'public' },
    })],
  });
  try {
    const res = await run(profileHandler, { user: viewerReq(), params: { userId: OWNER_ID } });

    assert.equal(res.body.user.email, 'aronno@example.com');
    assert.equal(res.body.user.bio, 'Private bio text');
    assert.ok(res.body.user.dob);
    assert.equal('phone' in res.body.user, false);
    assert.equal('gender' in res.body.user, false);
    assert.equal('country' in res.body.user, false);
    assert.equal('profileVisibility' in res.body.user, false);
  } finally {
    ctx.restore();
  }
});

test('4. invalid stored visibility values fail closed to private', async () => {
  const ctx = setup({
    users: [seedUser(OWNER_ID, {
      profileVisibility: { email: 'yes', phone: 'public', gender: 'PUBLIC' },
    })],
  });
  try {
    const res = await run(profileHandler, { user: viewerReq(), params: { userId: OWNER_ID } });

    assert.equal('email' in res.body.user, false);
    assert.equal('gender' in res.body.user, false);
    assert.equal(res.body.user.phone, '+8801700000000');
  } finally {
    ctx.restore();
  }
});

test('5. followedBy reflects whether the profile follows the viewer', async () => {
  const ctx = setup({
    users: [seedUser(OWNER_ID), viewerReq()],
    follows: [{ _id: 'f'.repeat(16) + '00000001', follower: OWNER_ID, following: VIEWER_ID }],
  });
  try {
    const res = await run(profileHandler, { user: viewerReq(), params: { userId: OWNER_ID } });
    assert.equal(res.body.followedBy, true);
    assert.equal(res.body.isFollowing, false);
  } finally {
    ctx.restore();
  }
});

test('6. followedBy and isFollowing stay false without edges, and followedBy is never true on own profile', async () => {
  const ctx = setup({ users: [seedUser(OWNER_ID), viewerReq()] });
  try {
    const strangerView = await run(profileHandler, { user: viewerReq(), params: { userId: OWNER_ID } });
    assert.equal(strangerView.body.followedBy, false);
    assert.equal(strangerView.body.isFollowing, false);

    const selfView = await run(profileHandler, { user: viewerReq(VIEWER_ID), params: { userId: VIEWER_ID } });
    assert.equal(selfView.body.followedBy, false);
    assert.equal(selfView.body.isOwnProfile, true);
  } finally {
    ctx.restore();
  }
});

test('7. isFollowing still reports edges from viewer to profile', async () => {
  const ctx = setup({
    users: [seedUser(OWNER_ID), viewerReq()],
    follows: [{ _id: 'f'.repeat(16) + '00000002', follower: VIEWER_ID, following: OWNER_ID }],
  });
  try {
    const res = await run(profileHandler, { user: viewerReq(), params: { userId: OWNER_ID } });
    assert.equal(res.body.isFollowing, true);
    assert.equal(res.body.followedBy, false);
  } finally {
    ctx.restore();
  }
});

test('8. people search never returns an email field', async () => {
  const ctx = setup({
    users: [
      seedUser(OWNER_ID, { name: 'Karim Chowdhury' }),
      viewerReq(),
    ],
  });
  try {
    const res = await run(searchHandler, { user: viewerReq(), query: { q: 'Karim' } });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.users.length, 1);
    const found = res.body.users[0];
    assert.equal(found.name, 'Karim Chowdhury');
    assert.equal('email' in found, false);
    assert.equal('bio' in found, false, 'private bio is not shared through search');
    assert.deepEqual(Object.keys(found).sort(), ['_id', 'avatar', 'isFollowing', 'name']);
  } finally {
    ctx.restore();
  }
});

test('9. people search matches names only and cannot be used to probe an email', async () => {
  const ctx = setup({
    users: [
      seedUser(OWNER_ID, { name: 'Karim', email: 'karim.secret@example.com' }),
      viewerReq(),
    ],
  });
  try {
    const byEmail = await run(searchHandler, {
      user: viewerReq(),
      query: { q: 'karim.secret@example.com' },
    });
    assert.equal(byEmail.body.users.length, 0, 'email probing must find nothing');

    const byName = await run(searchHandler, { user: viewerReq(), query: { q: 'Karim' } });
    assert.equal(byName.body.users.length, 1);
  } finally {
    ctx.restore();
  }
});

test('10. people search only includes a bio that is explicitly public', async () => {
  const ctx = setup({
    users: [
      seedUser(OWNER_ID, { name: 'Karim', bio: 'Public bio', profileVisibility: { bio: 'public' } }),
      seedUser(STRANGER_ID, { name: 'Rahim', bio: 'Hidden bio' }),
      viewerReq(),
    ],
  });
  try {
    const publicBio = await run(searchHandler, { user: viewerReq(), query: { q: 'Karim' } });
    assert.equal(publicBio.body.users[0].bio, 'Public bio');

    const privateBio = await run(searchHandler, { user: viewerReq(), query: { q: 'Rahim' } });
    assert.equal('bio' in privateBio.body.users[0], false);
  } finally {
    ctx.restore();
  }
});

test('11. settings rejects an invalid profileVisibility value with a fixed message', async () => {
  const ctx = setup({
    users: [seedUser(OWNER_ID, { profileVisibility: { email: 'public' } })],
  });
  try {
    const res = await run(settingsHandler, {
      user: ownerReq(ctx),
      body: { profileVisibility: { email: 'everyone' } },
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { success: false, error: 'Invalid profile visibility settings.' });
    assert.equal(ctx.userStore._docs[0].profileVisibility.email, 'public', 'stored value unchanged');
  } finally {
    ctx.restore();
  }
});

test('12. settings rejects unknown visibility keys and non-object payloads', async () => {
  const ctx = setup({ users: [seedUser(OWNER_ID)] });
  try {
    for (const payload of [{}, { role: 'public' }, { email: 'public', password: 'private' }, 'public', null, []]) {
      const res = await run(settingsHandler, {
        user: ownerReq(ctx),
        body: { profileVisibility: payload },
      });
      assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(payload)}`);
      assert.equal(res.body.error, 'Invalid profile visibility settings.');
    }
    assert.equal('profileVisibility' in ctx.userStore._docs[0], false);
  } finally {
    ctx.restore();
  }
});

test('13. settings merges a partial visibility patch without clearing other fields', async () => {
  const ctx = setup({
    users: [seedUser(OWNER_ID, { profileVisibility: { email: 'public' } })],
  });
  try {
    const res = await run(settingsHandler, {
      user: ownerReq(ctx),
      body: { profileVisibility: { bio: 'public' } },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);

    const stored = ctx.userStore._docs[0].profileVisibility;
    assert.equal(stored.email, 'public', 'existing public field stays public');
    assert.equal(stored.bio, 'public');
    assert.equal(stored.phone, 'private');
    assert.equal(res.body.user.profileVisibility.bio, 'public');
  } finally {
    ctx.restore();
  }
});

test('14. settings still updates bio and library visibility alongside privacy', async () => {
  const ctx = setup({ users: [seedUser(OWNER_ID)] });
  try {
    const res = await run(settingsHandler, {
      user: ownerReq(ctx),
      body: { bio: 'Updated bio', libraryVisibility: 'public' },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.equal(ctx.userStore._docs[0].bio, 'Updated bio');
    assert.equal(ctx.userStore._docs[0].libraryVisibility, 'public');
  } finally {
    ctx.restore();
  }
});

test('15. settings with no valid fields keeps the existing no-op contract', async () => {
  const ctx = setup({ users: [seedUser(OWNER_ID)] });
  try {
    const res = await run(settingsHandler, { user: ownerReq(ctx), body: {} });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { success: false, error: 'No valid fields to update.' });
  } finally {
    ctx.restore();
  }
});

test('16. private profile never returns library songs to another viewer', async () => {
  const ctx = setup({ users: [seedUser(OWNER_ID, { libraryVisibility: 'private' })] });
  try {
    const res = await run(profileHandler, { user: viewerReq(), params: { userId: OWNER_ID } });
    assert.equal(res.body.isOwnProfile, false);
    assert.deepEqual(res.body.songs, []);
  } finally {
    ctx.restore();
  }
});
