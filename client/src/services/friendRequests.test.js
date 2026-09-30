import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRIENDS_PATH,
  FRIEND_ACTION_LABELS,
  FRIEND_STATUSES,
  acceptFriendRequest,
  buildAcceptFriendRequestPath,
  buildFriendRequestPath,
  buildFriendStatusPath,
  buildRejectFriendRequestPath,
  fetchFriendStatus,
  rejectFriendRequest,
  sendFriendRequest,
} from './friendRequests.js';

function createClient(handlers = {}) {
  const calls = [];
  const record = (method, path, body) => {
    calls.push({ method, path, body });
  };
  return {
    calls,
    get: async (path) => {
      record('GET', path);
      return handlers.get ? handlers.get(path) : { success: true };
    },
    post: async (path, body) => {
      record('POST', path, body);
      return handlers.post ? handlers.post(path, body) : { success: true };
    },
  };
}

test('friend paths are built from the shared base path only', () => {
  assert.equal(FRIENDS_PATH, '/api/friends');
  assert.equal(buildFriendStatusPath('u1'), '/api/friends/status/u1');
  assert.equal(buildFriendRequestPath('u1'), '/api/friends/request/u1');
  assert.equal(buildAcceptFriendRequestPath('r1'), '/api/friends/r1/accept');
  assert.equal(buildRejectFriendRequestPath('r1'), '/api/friends/r1/reject');
});

test('relationship labels cover every profile button state', () => {
  assert.equal(FRIEND_ACTION_LABELS.none, 'Add Friend');
  assert.equal(FRIEND_ACTION_LABELS.outgoing_pending, 'Request Sent');
  assert.equal(FRIEND_ACTION_LABELS.incoming_pending, 'Accept Request');
  assert.equal(FRIEND_ACTION_LABELS.friends, 'Friends');
  assert.equal(FRIEND_STATUSES.REJECTED, 'rejected');
});

test('fetchFriendStatus normalizes a successful payload', async () => {
  const client = createClient({
    get: () => ({ success: true, status: 'incoming_pending', requestId: 'r1', isSelf: false }),
  });

  const result = await fetchFriendStatus('u2', { apiClient: client });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'incoming_pending');
  assert.equal(result.requestId, 'r1');
  assert.equal(client.calls[0].path, '/api/friends/status/u2');
});

test('fetchFriendStatus rejects unknown statuses and missing client', async () => {
  const bad = createClient({ get: () => ({ success: true, status: 'besties' }) });
  const badResult = await fetchFriendStatus('u2', { apiClient: bad });
  assert.equal(badResult.ok, false);
  assert.equal(badResult.status, FRIEND_STATUSES.NONE);

  const missing = await fetchFriendStatus('u2', {});
  assert.equal(missing.ok, false);
  assert.equal(missing.error, 'Unable to load friend status.');
});

test('sendFriendRequest posts to the request endpoint', async () => {
  const client = createClient({
    post: () => ({ success: true, status: 'outgoing_pending', requestId: 'r9' }),
  });

  const result = await sendFriendRequest('u2', { apiClient: client });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'outgoing_pending');
  assert.equal(client.calls[0].method, 'POST');
  assert.equal(client.calls[0].path, '/api/friends/request/u2');
});

test('sendFriendRequest surfaces the reverse-request conflict', async () => {
  const client = createClient({
    post: () => ({
      success: false,
      code: 'FRIEND_REQUEST_INCOMING',
      error: 'This user has already sent you a friend request.',
      status: 'incoming_pending',
      requestId: 'r4',
    }),
  });

  const result = await sendFriendRequest('u2', { apiClient: client });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'FRIEND_REQUEST_INCOMING');
  assert.equal(result.status, 'incoming_pending');
  assert.equal(result.requestId, 'r4');
});

test('accept and reject hit their own endpoints', async () => {
  const client = createClient({
    post: (path) => ({
      success: true,
      status: path.endsWith('/accept') ? 'friends' : 'rejected',
      requestId: 'r1',
    }),
  });

  const accepted = await acceptFriendRequest('r1', { apiClient: client });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.status, 'friends');
  assert.equal(client.calls[0].path, '/api/friends/r1/accept');

  const rejected = await rejectFriendRequest('r1', { apiClient: client });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.status, 'rejected');
  assert.equal(client.calls[1].path, '/api/friends/r1/reject');
});

test('friend mutations are safe without a client or with a bad id', async () => {
  assert.equal((await sendFriendRequest('u2', {})).ok, false);
  assert.equal((await acceptFriendRequest('', { apiClient: createClient() })).ok, false);
  assert.equal((await rejectFriendRequest('   ', { apiClient: createClient() })).ok, false);
});

test('friend status response strips unknown fields', async () => {
  const client = createClient({
    get: () => ({ success: true, status: 'friends', requestId: 'r1', email: 'leak@example.com' }),
  });
  const result = await fetchFriendStatus('u2', { apiClient: client });
  assert.equal(result.ok, true);
  assert.equal(result.email, undefined);
  assert.deepEqual(Object.keys(result).sort(), ['error', 'isSelf', 'ok', 'requestId', 'status']);
});
