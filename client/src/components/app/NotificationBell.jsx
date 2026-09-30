import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import {
  DEFAULT_NOTIFICATION_LIMIT,
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../services/notifications.js';
import { acceptFriendRequest, rejectFriendRequest } from '../../services/friendRequests.js';
import {
  NOTIFICATION_EMPTY_MESSAGE,
  NOTIFICATION_ERROR_MESSAGE,
  buildNotificationItems,
  clampUnreadCount,
  getUnreadBadge,
} from './notificationUi.js';

function formatNotificationTime(value) {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export default function NotificationBell({ variant = 'shell' }) {
  const navigate = useNavigate();
  const wrapperRef = useRef(null);
  const generationRef = useRef(0);
  const isHomeVariant = variant === 'home';

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState({});

  const badge = getUnreadBadge(unread);

  const refreshUnread = useCallback(async () => {
    const result = await fetchUnreadCount({ apiClient: api });
    if (result.ok) setUnread(clampUnreadCount(result.count));
    return result;
  }, []);

  const loadList = useCallback(async () => {
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setLoading(true);
    setError('');

    const result = await fetchNotifications({ limit: DEFAULT_NOTIFICATION_LIMIT, apiClient: api });
    if (generationRef.current !== generation) return;

    if (!result.ok) {
      setError(result.error || NOTIFICATION_ERROR_MESSAGE);
      setLoading(false);
      return;
    }

    setItems(buildNotificationItems(result.notifications));
    setLoading(false);

    const unreadCount = result.notifications.filter((item) => !item.read).length;
    if (unreadCount > 0) {
      const countResult = await fetchUnreadCount({ apiClient: api });
      if (generationRef.current === generation && countResult.ok) {
        setUnread(clampUnreadCount(countResult.count));
      }
    }
  }, []);

  useEffect(() => {
    refreshUnread();
  }, [refreshUnread]);

  useEffect(() => {
    if (!open) return undefined;
    loadList();
    return undefined;
  }, [open, loadList]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const setBusyFlag = useCallback((key, isBusy) => {
    setBusy((prev) => {
      const next = { ...prev };
      if (isBusy) next[key] = true;
      else delete next[key];
      return next;
    });
  }, []);

  const openItem = useCallback(async (item) => {
    if (!item) return;
    if (!item.read) {
      const result = await markNotificationRead(item._id, { apiClient: api });
      if (result.ok) {
        setItems((prev) => prev.map((row) => (row._id === item._id ? { ...row, read: true } : row)));
        setUnread((prev) => Math.max(0, prev - 1));
      }
    }
    setOpen(false);
    navigate(item.target);
  }, [navigate]);

  const handleMarkRead = useCallback(async (item) => {
    if (!item || item.read || busy[item._id]) return;
    setBusyFlag(item._id, true);
    const result = await markNotificationRead(item._id, { apiClient: api });
    setBusyFlag(item._id, false);
    if (!result.ok) {
      setError(result.error || NOTIFICATION_ERROR_MESSAGE);
      return;
    }
    setItems((prev) => prev.map((row) => (row._id === item._id ? { ...row, read: true } : row)));
    setUnread((prev) => Math.max(0, prev - 1));
  }, [busy, setBusyFlag]);

  const handleMarkAll = useCallback(async () => {
    if (busy.__markAll) return;
    setBusyFlag('__markAll', true);
    const result = await markAllNotificationsRead({ apiClient: api });
    setBusyFlag('__markAll', false);
    if (!result.ok) {
      setError(result.error || NOTIFICATION_ERROR_MESSAGE);
      return;
    }
    setItems((prev) => prev.map((row) => ({ ...row, read: true })));
    setUnread(0);
  }, [busy, setBusyFlag]);

  const handleFriendAction = useCallback(async (item, action) => {
    if (!item || !item.requestId || busy[item.requestId]) return;
    setBusyFlag(item.requestId, true);

    const result = action === 'accept'
      ? await acceptFriendRequest(item.requestId, { apiClient: api })
      : await rejectFriendRequest(item.requestId, { apiClient: api });

    setBusyFlag(item.requestId, false);

    if (!result.ok) {
      setError(result.error || NOTIFICATION_ERROR_MESSAGE);
      return;
    }

    setItems((prev) => prev.filter((row) => row._id !== item._id));
    if (!item.read) setUnread((prev) => Math.max(0, prev - 1));
    refreshUnread();
  }, [busy, setBusyFlag, refreshUnread]);

  return (
    <div className="app-notifications" ref={wrapperRef}>
      <button
        type="button"
        className={isHomeVariant ? 'home-icon-btn app-bell-btn' : 'app-icon-btn app-bell-btn'}
        aria-label={badge.ariaLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        {isHomeVariant ? (
          <svg width="22" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <path d="M5 17h14l-2-3V9a5 5 0 0 0-4-5V2h-2v2a5 5 0 0 0-4 5v5z" strokeLinejoin="round" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
        ) : (
          <i className="fa-solid fa-bell" aria-hidden="true"></i>
        )}
        {badge.show ? (
          <span className="app-bell-badge" aria-hidden="true">{badge.text}</span>
        ) : null}
      </button>

      {open ? (
        <div className="app-notification-panel" role="dialog" aria-label="Notifications">
          <div className="app-notification-head">
            <strong>Notifications</strong>
            <button
              type="button"
              className="app-notification-mark-all"
              onClick={handleMarkAll}
              disabled={Boolean(busy.__markAll) || (items.length > 0 && items.every((item) => item.read))}
            >
              {busy.__markAll ? 'Marking...' : 'Mark all read'}
            </button>
          </div>

          {loading ? (
            <p className="app-notification-state" role="status">Loading notifications...</p>
          ) : null}

          {!loading && error ? (
            <div className="app-notification-state-block">
              <p className="app-notification-state app-notification-state-error" role="alert">
                {error}
              </p>
              <button type="button" className="app-notification-retry" onClick={loadList}>
                Retry
              </button>
            </div>
          ) : null}

          {!loading && !error && items.length === 0 ? (
            <p className="app-notification-state" role="status">{NOTIFICATION_EMPTY_MESSAGE}</p>
          ) : null}

          {!loading && !error && items.length > 0 ? (
            <ul className="app-notification-list" aria-label="Recent notifications">
              {items.map((item) => (
                <li
                  key={item._id}
                  className={`app-notification-item${item.read ? '' : ' is-unread'}`}
                >
                  <button
                    type="button"
                    className="app-notification-open"
                    onClick={() => openItem(item)}
                  >
                    <span className="app-notification-avatar" aria-hidden="true">
                      {item.avatarSrc ? <img src={item.avatarSrc} alt="" /> : null}
                      <span>{item.initial}</span>
                    </span>
                    <span className="app-notification-copy">
                      <span className="app-notification-text">{item.text}</span>
                      <small className="app-notification-time">{formatNotificationTime(item.createdAt)}</small>
                    </span>
                  </button>

                  {!item.read ? (
                    <button
                      type="button"
                      className="app-notification-read"
                      onClick={() => handleMarkRead(item)}
                      disabled={Boolean(busy[item._id])}
                      aria-label="Mark notification as read"
                    >
                      <i className="fa-solid fa-check" aria-hidden="true"></i>
                    </button>
                  ) : null}

                  {item.showFriendActions ? (
                    <div className="app-notification-actions">
                      <button
                        type="button"
                        className="app-notification-action app-notification-accept"
                        onClick={() => handleFriendAction(item, 'accept')}
                        disabled={Boolean(busy[item.requestId])}
                      >
                        {busy[item.requestId] ? 'Working...' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        className="app-notification-action app-notification-reject"
                        onClick={() => handleFriendAction(item, 'reject')}
                        disabled={Boolean(busy[item.requestId])}
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
