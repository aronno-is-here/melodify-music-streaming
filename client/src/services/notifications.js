export const NOTIFICATIONS_PATH = '/api/notifications';
export const DEFAULT_NOTIFICATION_LIMIT = 20;
export const MAX_NOTIFICATION_LIMIT = 50;

export const NOTIFICATION_TYPES = Object.freeze([
  'friend_request',
  'friend_accepted',
  'post_like',
  'post_comment',
  'post_share',
]);

export const NOTIFICATION_MESSAGES = Object.freeze({
  REQUEST_FAILED: 'Unable to load notifications.',
  PAYLOAD_INVALID: 'Notifications response was invalid.',
  MARK_READ_FAILED: 'Unable to mark the notification read.',
  MARK_ALL_READ_FAILED: 'Unable to mark notifications read.',
  SESSION_EXPIRED: 'Session expired',
});


const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function sanitizeNotificationMessage(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) return fallback;
  if (trimmed.startsWith('Failed to load') || trimmed.includes('\n') || trimmed.includes(' at ')) {
    return fallback;
  }
  return trimmed;
}

export function isValidNotificationLimit(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_NOTIFICATION_LIMIT;
}

export function normalizeRequestedLimit(raw) {
  if (raw === undefined || raw === null) return DEFAULT_NOTIFICATION_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return null;
  if (value > MAX_NOTIFICATION_LIMIT) return MAX_NOTIFICATION_LIMIT;
  return value;
}

export function buildNotificationsPath(limit = DEFAULT_NOTIFICATION_LIMIT) {
  const normalized = normalizeRequestedLimit(limit);
  if (normalized === null) return null;
  return `${NOTIFICATIONS_PATH}?limit=${normalized}`;
}

export function buildUnreadCountPath() {
  return `${NOTIFICATIONS_PATH}/unread-count`;
}

export function buildMarkReadPath(notificationId) {
  if (typeof notificationId !== 'string' || !notificationId.trim() || notificationId.length > 64) {
    return null;
  }
  return `${NOTIFICATIONS_PATH}/${encodeURIComponent(notificationId)}/read`;
}

export function buildMarkAllReadPath() {
  return `${NOTIFICATIONS_PATH}/read-all`;
}

const ACTOR_FIELDS = Object.freeze(['_id', 'name', 'avatar']);

function projectActor(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    return value.trim() && value.length <= 64 ? value : undefined;
  }
  if (!isPlainObject(value)) return undefined;

  const actor = {};
  if (value._id !== undefined) {
    if (typeof value._id !== 'string' || !value._id.trim() || value._id.length > 64) return undefined;
    actor._id = value._id;
  }
  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.length > 120) return undefined;
    actor.name = value.name;
  }
  if (value.avatar !== undefined) {
    if (typeof value.avatar !== 'string' || value.avatar.length > 4096) return undefined;
    actor.avatar = value.avatar;
  }
  for (const key of Object.keys(value)) {
    if (!ACTOR_FIELDS.includes(key)) return undefined;
  }
  return actor;
}

function normalizeOptionalRef(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length <= 64 && value.trim() ? value : undefined;
  if (isPlainObject(value) && typeof value._id === 'string' && value._id.trim()) return value;
  return undefined;
}

export function normalizeNotification(raw) {
  if (!isPlainObject(raw)) return null;
  if (typeof raw._id !== 'string' || !raw._id.trim()) return null;
  if (typeof raw.type !== 'string' || !NOTIFICATION_TYPES.includes(raw.type)) return null;
  if (typeof raw.read !== 'boolean') return null;

  const actor = projectActor(raw.actor);
  const post = normalizeOptionalRef(raw.post);
  const friendRequest = normalizeOptionalRef(raw.friendRequest);
  const comment = normalizeOptionalRef(raw.comment);
  if (actor === undefined || post === undefined || friendRequest === undefined || comment === undefined) {
    return null;
  }

  return {
    _id: raw._id,
    type: raw.type,
    read: raw.read,
    actor,
    post,
    friendRequest,
    comment,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
  };
}

export function normalizeNotificationsResponse(payload) {
  if (!isPlainObject(payload) || payload.success !== true) return null;
  if (!Array.isArray(payload.notifications)) return null;
  if (payload.count !== undefined && payload.count !== payload.notifications.length) return null;

  const notifications = payload.notifications.map(normalizeNotification);
  if (notifications.some((item) => item === null)) return null;

  return {
    notifications,
    count: notifications.length,
    limit: isValidNotificationLimit(payload.limit) ? payload.limit : DEFAULT_NOTIFICATION_LIMIT,
  };
}

export function normalizeUnreadCountResponse(payload) {
  if (!isPlainObject(payload) || payload.success !== true) return null;
  if (!Number.isInteger(payload.count) || payload.count < 0) return null;
  return { count: payload.count };
}

export function normalizeMarkReadResponse(payload) {
  if (!isPlainObject(payload) || payload.success !== true) return null;
  const notification = normalizeNotification(payload.notification);
  if (!notification) return null;
  return { notification };
}

export function normalizeMarkAllReadResponse(payload) {
  if (!isPlainObject(payload) || payload.success !== true) return null;
  const modified = Number.isInteger(payload.modified) && payload.modified >= 0 ? payload.modified : 0;
  return { modified };
}

function resolveClient(apiClient) {
  if (apiClient) return apiClient;
  return null;
}

export async function fetchNotifications({ limit = DEFAULT_NOTIFICATION_LIMIT, apiClient } = {}) {
  const client = resolveClient(apiClient);
  const path = buildNotificationsPath(limit);
  if (!client || !path) {
    return { ok: false, error: NOTIFICATION_MESSAGES.PAYLOAD_INVALID, notifications: [], count: 0, limit };
  }

  const payload = await client.get(path);
  const normalized = normalizeNotificationsResponse(payload);
  if (!normalized) {
    return {
      ok: false,
      error: sanitizeNotificationMessage(payload && payload.error, NOTIFICATION_MESSAGES.REQUEST_FAILED),
      notifications: [],
      count: 0,
      limit,
    };
  }
  return { ok: true, error: null, ...normalized };
}

export async function fetchUnreadCount({ apiClient } = {}) {
  const client = resolveClient(apiClient);
  if (!client) return { ok: false, error: NOTIFICATION_MESSAGES.REQUEST_FAILED, count: 0 };

  const payload = await client.get(buildUnreadCountPath());
  const normalized = normalizeUnreadCountResponse(payload);
  if (!normalized) {
    return {
      ok: false,
      error: sanitizeNotificationMessage(payload && payload.error, NOTIFICATION_MESSAGES.REQUEST_FAILED),
      count: 0,
    };
  }
  return { ok: true, error: null, count: normalized.count };
}

export async function markNotificationRead(notificationId, { apiClient } = {}) {
  const client = resolveClient(apiClient);
  const path = buildMarkReadPath(notificationId);
  if (!client || !path) {
    return { ok: false, error: NOTIFICATION_MESSAGES.MARK_READ_FAILED, notification: null };
  }

  const payload = await client.patch(path, {});
  const normalized = normalizeMarkReadResponse(payload);
  if (!normalized) {
    return {
      ok: false,
      error: sanitizeNotificationMessage(payload && payload.error, NOTIFICATION_MESSAGES.MARK_READ_FAILED),
      notification: null,
    };
  }
  return { ok: true, error: null, notification: normalized.notification };
}

export async function markAllNotificationsRead({ apiClient } = {}) {
  const client = resolveClient(apiClient);
  if (!client) return { ok: false, error: NOTIFICATION_MESSAGES.MARK_ALL_READ_FAILED, modified: 0 };

  const payload = await client.patch(buildMarkAllReadPath(), {});
  const normalized = normalizeMarkAllReadResponse(payload);
  if (!normalized) {
    return {
      ok: false,
      error: sanitizeNotificationMessage(payload && payload.error, NOTIFICATION_MESSAGES.MARK_ALL_READ_FAILED),
      modified: 0,
    };
  }
  return { ok: true, error: null, modified: normalized.modified };
}
