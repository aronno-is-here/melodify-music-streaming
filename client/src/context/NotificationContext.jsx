import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  DEFAULT_NOTIFICATION_LIMIT,
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../services/notifications.js';
import {
  NOTIFICATION_ERROR_MESSAGE,
  buildNotificationItems,
  clampUnreadCount,
} from '../components/app/notificationUi.js';
import { useAuth } from './AuthContext.jsx';

const NotificationContext = createContext(null);

/**
 * Shared, backend-authoritative notification read state.
 *
 * Every bell (homepage and dashboard shell) reads from this one context, so
 * marking notifications read anywhere immediately updates the badge everywhere
 * - there is no per-bell counter that can drift.
 *
 * Fetching rules (no polling, no timers):
 *  - unread count refreshes when the authenticated user becomes available and
 *    on explicit `refreshUnread()` calls (bell mount),
 *  - the list loads when a bell is opened (`loadList`),
 *  - a successful list load marks everything read, because opening the panel is
 *    the acknowledgement gesture,
 *  - a failed list load NEVER clears the badge: only the server can.
 */
export function NotificationProvider({ children }) {
  const { user, loading: authLoading } = useAuth();

  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generationRef = useRef(0);
  const refreshInFlightRef = useRef(null);

  const refreshUnread = useCallback(async () => {
    if (!user) {
      setUnread(0);
      return { ok: false };
    }
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const request = fetchUnreadCount({ apiClient: api }).then((result) => {
      if (result.ok) setUnread(clampUnreadCount(result.count));
      return result;
    });
    refreshInFlightRef.current = request;
    try {
      return await request;
    } finally {
      refreshInFlightRef.current = null;
    }
  }, [user]);

  const loadList = useCallback(async () => {
    if (!user) return { ok: false };

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    setLoading(true);
    setError('');

    const result = await fetchNotifications({ limit: DEFAULT_NOTIFICATION_LIMIT, apiClient: api });
    if (generationRef.current !== generation) return { ok: false };

    if (!result.ok) {
      // Load failed: keep the existing badge, it is still what the server said.
      setError(result.error || NOTIFICATION_ERROR_MESSAGE);
      setLoading(false);
      return result;
    }

    const loaded = buildNotificationItems(result.notifications);

    const markResult = await markAllNotificationsRead({ apiClient: api });
    if (generationRef.current !== generation) return { ok: false };

    if (markResult.ok) {
      setItems(loaded.map((row) => ({ ...row, read: true })));
      setUnread(0);
    } else {
      // The list is fresh, but the server still reports these as unread, so
      // keep the badge instead of pretending the write succeeded.
      setItems(loaded);
    }
    setLoading(false);
    return result;
  }, [user]);

  const markRead = useCallback(async (notificationId) => {
    const result = await markNotificationRead(notificationId, { apiClient: api });
    if (result.ok) {
      setItems((prev) => prev.map((row) => (row._id === notificationId ? { ...row, read: true } : row)));
      setUnread((prev) => Math.max(0, prev - 1));
    }
    return result;
  }, []);

  const markAllRead = useCallback(async () => {
    const result = await markAllNotificationsRead({ apiClient: api });
    if (result.ok) {
      setItems((prev) => prev.map((row) => ({ ...row, read: true })));
      setUnread(0);
    }
    return result;
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      generationRef.current += 1;
      setItems([]);
      setUnread(0);
      setError('');
      setLoading(false);
      return;
    }
    refreshUnread();
  }, [authLoading, user, refreshUnread]);

  const value = useMemo(() => ({
    items,
    unread,
    loading,
    error,
    refreshUnread,
    loadList,
    markRead,
    markAllRead,
  }), [items, unread, loading, error, refreshUnread, loadList, markRead, markAllRead]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}

export function useNotifications() {
  return useContext(NotificationContext);
}
