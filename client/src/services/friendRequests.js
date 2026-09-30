export const FRIENDS_PATH = '/api/friends';

export const FRIEND_STATUSES = Object.freeze({
  NONE: 'none',
  OUTGOING_PENDING: 'outgoing_pending',
  INCOMING_PENDING: 'incoming_pending',
  FRIENDS: 'friends',
  REJECTED: 'rejected',
});

export const FRIEND_PROFILE_STATUSES = Object.freeze([
  FRIEND_STATUSES.NONE,
  FRIEND_STATUSES.OUTGOING_PENDING,
  FRIEND_STATUSES.INCOMING_PENDING,
  FRIEND_STATUSES.FRIENDS,
]);

export const FRIEND_ACTION_LABELS = Object.freeze({
  none: 'Add Friend',
  outgoing_pending: 'Request Sent',
  incoming_pending: 'Accept Request',
  friends: 'Friends',
});

export const FRIEND_REJECT_LABEL = 'Reject';

export const FRIEND_REQUEST_ERROR_MESSAGES = Object.freeze({
  REQUEST_FAILED: 'Unable to update friend request.',
  LOAD_FAILED: 'Unable to load friend status.',
  PAYLOAD_INVALID: 'Friend request response was invalid.',
});

export const FRIEND_REQUEST_INCOMING_CODE = 'FRIEND_REQUEST_INCOMING';

export function buildFriendStatusPath(userId) {
  return `${FRIENDS_PATH}/status/${encodeURIComponent(String(userId))}`;
}

export function buildFriendRequestPath(userId) {
  return `${FRIENDS_PATH}/request/${encodeURIComponent(String(userId))}`;
}

export function buildAcceptFriendRequestPath(requestId) {
  return `${FRIENDS_PATH}/${encodeURIComponent(String(requestId))}/accept`;
}

export function buildRejectFriendRequestPath(requestId) {
  return `${FRIENDS_PATH}/${encodeURIComponent(String(requestId))}/reject`;
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isSafeId = (value) =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 64;

const KNOWN_STATUSES = new Set(Object.values(FRIEND_STATUSES));

const isKnownStatus = (value) => typeof value === 'string' && KNOWN_STATUSES.has(value);

export function normalizeFriendStatusResponse(payload) {
  if (!isPlainObject(payload) || payload.success !== true) return null;
  if (!FRIEND_PROFILE_STATUSES.includes(payload.status)) return null;
  if (payload.requestId !== null && payload.requestId !== undefined && !isSafeId(payload.requestId)) {
    return null;
  }
  if (payload.isSelf !== undefined && typeof payload.isSelf !== 'boolean') return null;

  return {
    status: payload.status,
    requestId: payload.requestId || null,
    isSelf: Boolean(payload.isSelf),
  };
}

export function normalizeFriendActionResponse(payload) {
  if (!isPlainObject(payload) || payload.success !== true) return null;
  if (!isKnownStatus(payload.status)) return null;
  if (payload.requestId !== undefined && payload.requestId !== null && !isSafeId(payload.requestId)) {
    return null;
  }
  return {
    status: payload.status,
    requestId: payload.requestId || null,
    code: typeof payload.code === 'string' ? payload.code : null,
    error: typeof payload.error === 'string' ? payload.error : null,
  };
}

function resolveClient(apiClient) {
  if (apiClient) return apiClient;
  return null;
}

export async function fetchFriendStatus(userId, { apiClient } = {}) {
  const client = resolveClient(apiClient);
  if (!client || !isSafeId(userId)) {
    return { ok: false, error: FRIEND_REQUEST_ERROR_MESSAGES.LOAD_FAILED, status: FRIEND_STATUSES.NONE, requestId: null };
  }

  const payload = await client.get(buildFriendStatusPath(userId));
  const normalized = normalizeFriendStatusResponse(payload);
  if (!normalized) {
    const message = payload && typeof payload.error === 'string'
      ? payload.error
      : FRIEND_REQUEST_ERROR_MESSAGES.LOAD_FAILED;
    return { ok: false, error: message, status: FRIEND_STATUSES.NONE, requestId: null };
  }
  return { ok: true, error: null, ...normalized };
}

export async function sendFriendRequest(userId, { apiClient } = {}) {
  const client = resolveClient(apiClient);
  if (!client || !isSafeId(userId)) {
    return { ok: false, error: FRIEND_REQUEST_ERROR_MESSAGES.REQUEST_FAILED, status: FRIEND_STATUSES.NONE, requestId: null };
  }

  const payload = await client.post(buildFriendRequestPath(userId), {});
  const normalized = normalizeFriendActionResponse(payload);
  if (!normalized) {
    const message = payload && typeof payload.error === 'string'
      ? payload.error
      : FRIEND_REQUEST_ERROR_MESSAGES.REQUEST_FAILED;
    return {
      ok: false,
      error: message,
      code: payload && payload.code === FRIEND_REQUEST_INCOMING_CODE ? FRIEND_REQUEST_INCOMING_CODE : null,
      status: isKnownStatus(payload && payload.status) ? payload.status : FRIEND_STATUSES.NONE,
      requestId: (payload && payload.requestId) || null,
    };
  }
  return { ok: true, error: null, ...normalized };
}

export async function acceptFriendRequest(requestId, { apiClient } = {}) {
  return mutateFriendRequest(requestId, 'accept', apiClient);
}

export async function rejectFriendRequest(requestId, { apiClient } = {}) {
  return mutateFriendRequest(requestId, 'reject', apiClient);
}

async function mutateFriendRequest(requestId, action, apiClient) {
  const client = resolveClient(apiClient);
  if (!client || !isSafeId(requestId)) {
    return { ok: false, error: FRIEND_REQUEST_ERROR_MESSAGES.REQUEST_FAILED, status: null };
  }

  const path = action === 'accept'
    ? buildAcceptFriendRequestPath(requestId)
    : buildRejectFriendRequestPath(requestId);

  const payload = await client.post(path, {});
  const normalized = normalizeFriendActionResponse(payload);
  if (!normalized) {
    const message = payload && typeof payload.error === 'string'
      ? payload.error
      : FRIEND_REQUEST_ERROR_MESSAGES.REQUEST_FAILED;
    return { ok: false, error: message, status: null };
  }
  return { ok: true, error: null, ...normalized };
}
