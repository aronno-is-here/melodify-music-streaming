export const NOTIFICATION_EMPTY_MESSAGE = 'No notifications yet.';
export const NOTIFICATION_ERROR_MESSAGE = 'Unable to load notifications.';
export const NOTIFICATION_UNREAD_ZERO_LABEL = 'No unread notifications';

const FRIEND_TYPES = Object.freeze(['friend_request', 'friend_accepted']);
const POST_TYPES = Object.freeze(['post_like', 'post_comment', 'post_share']);

function actorOf(notification) {
  const actor = notification ? notification.actor : null;
  if (actor && typeof actor === 'object' && !Array.isArray(actor)) return actor;
  if (typeof actor === 'string' && actor.trim()) return { _id: actor, name: '' };
  return null;
}

export function getNotificationActorName(notification) {
  const actor = actorOf(notification);
  if (actor && typeof actor.name === 'string' && actor.name.trim()) return actor.name.trim();
  return 'Someone';
}

export function getNotificationActorId(notification) {
  const actor = actorOf(notification);
  if (actor && typeof actor._id === 'string' && actor._id.trim()) return actor._id;
  return null;
}

export function describeNotification(notification) {
  if (!notification || typeof notification !== 'object') return '';
  const name = getNotificationActorName(notification);

  switch (notification.type) {
    case 'friend_request':
      return `${name} sent you a friend request`;
    case 'friend_accepted':
      return `${name} accepted your friend request`;
    case 'post_like':
      return `${name} liked your post`;
    case 'post_comment':
      return `${name} commented on your post`;
    case 'post_share':
      return `${name} shared your post`;
    default:
      return `${name} interacted with your post`;
  }
}

export function getNotificationTarget(notification) {
  if (!notification || typeof notification !== 'object') return '/feed';
  const type = notification.type;

  if (FRIEND_TYPES.includes(type)) {
    const actorId = getNotificationActorId(notification);
    if (actorId) return `/user/${actorId}`;
    return '/feed';
  }

  if (POST_TYPES.includes(type)) return '/feed';
  return '/feed';
}

export function getFriendActionRequestId(notification) {
  if (!notification || notification.type !== 'friend_request') return null;
  const request = notification.friendRequest;
  if (typeof request === 'string' && request.trim()) return request;
  if (request && typeof request === 'object' && typeof request._id === 'string') return request._id;
  return null;
}

export function hasFriendActions(notification) {
  return Boolean(getFriendActionRequestId(notification));
}

export function getUnreadBadge(count) {
  if (!Number.isInteger(count) || count <= 0) {
    return { show: false, text: '', ariaLabel: NOTIFICATION_UNREAD_ZERO_LABEL };
  }
  return {
    show: true,
    text: count > 99 ? '99+' : String(count),
    ariaLabel: `${count} unread notification${count === 1 ? '' : 's'}`,
  };
}

export function getNotificationAvatar(notification) {
  const actor = actorOf(notification);
  if (actor && typeof actor.avatar === 'string' && actor.avatar.trim()) return actor.avatar;
  return '';
}

export function getNotificationInitial(notification) {
  const name = getNotificationActorName(notification);
  return name ? name.charAt(0).toUpperCase() : '?';
}

export function buildNotificationItems(notifications) {
  if (!Array.isArray(notifications)) return [];
  return notifications
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      _id: item._id,
      text: describeNotification(item),
      target: getNotificationTarget(item),
      read: Boolean(item.read),
      requestId: getFriendActionRequestId(item),
      showFriendActions: item.type === 'friend_request' && hasFriendActions(item),
      createdAt: item.createdAt || null,
      actorName: getNotificationActorName(item),
      initial: getNotificationInitial(item),
      avatarSrc: getNotificationAvatar(item),
    }));
}

export function clampUnreadCount(count) {
  return Number.isInteger(count) && count > 0 ? count : 0;
}
