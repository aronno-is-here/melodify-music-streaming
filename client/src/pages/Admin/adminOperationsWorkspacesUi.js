export const ADMIN_USERS_MESSAGES = Object.freeze({
  PAGE_SUBTITLE: 'Manage Melodify user accounts, roles, and account status.',
  SEARCH_PLACEHOLDER: 'Search users...',
  FILTER_ROLE: 'Filter by role',
  LOADING: 'Loading users...',
  EMPTY: 'No users found.',
  NO_MATCHES: 'No users match your search.',
  ERROR: 'Unable to load users.',
  REFRESH_FAILED: 'Unable to refresh users.',
  RETRY: 'Retry',
});

export const ADMIN_USER_ROLE_FILTERS = Object.freeze([
  { value: 'all', label: 'All roles' },
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
]);

export const ADMIN_MODERATION_MESSAGES = Object.freeze({
  PAGE_SUBTITLE: 'Review and resolve reports from the Melodify community.',
  SEARCH_PLACEHOLDER: 'Search reports...',
  FILTER_STATUS: 'Filter by status',
  LOADING: 'Loading moderation queue...',
  EMPTY: 'No pending moderation items.',
  NO_MATCHES: 'No reports match the current filter.',
  ERROR: 'Unable to load moderation items.',
  REFRESH_FAILED: 'Unable to refresh moderation items.',
  RETRY: 'Retry',
});

export const ADMIN_REPORT_STATUS_FILTERS = Object.freeze([
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
]);

export const ADMIN_SUBSCRIPTION_MESSAGES = Object.freeze({
  PAGE_SUBTITLE: 'Monitor and manage Melodify subscription records.',
  SEARCH_PLACEHOLDER: 'Search subscriptions...',
  FILTER_STATUS: 'Filter by status',
  LOADING: 'Loading subscriptions...',
  EMPTY: 'No subscriptions found.',
  NO_MATCHES: 'No subscriptions match the current filter.',
  ERROR: 'Unable to load subscriptions.',
  REFRESH_FAILED: 'Unable to refresh subscriptions.',
  RETRY: 'Retry',
});

export const ADMIN_SUBSCRIPTION_STATUS_FILTERS = Object.freeze([
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
]);

const toText = (value) => (typeof value === 'string' ? value : '');

const matchesQuery = (fields, query) => {
  if (!query) return true;
  return fields.some(
    (field) => typeof field === 'string' && field.toLowerCase().includes(query),
  );
};

export function filterAdminUsers(users, options = {}) {
  const list = Array.isArray(users) ? users : [];
  const query = toText(options.query).trim().toLowerCase();
  const role = options.role || 'all';

  return list.filter((user) => {
    if (!user || typeof user !== 'object') return false;
    if (role !== 'all' && user.role !== role) return false;
    return matchesQuery([user.name, user.email], query);
  });
}

export function filterAdminReports(reports, options = {}) {
  const list = Array.isArray(reports) ? reports : [];
  const query = toText(options.query).trim().toLowerCase();
  const status = options.status || 'all';

  return list.filter((report) => {
    if (!report || typeof report !== 'object') return false;
    if (status !== 'all' && report.status !== status) return false;
    return matchesQuery(
      [report.type, report.user_email, report.reason, report.content_id],
      query,
    );
  });
}

export function filterAdminSubscriptions(subscriptions, options = {}) {
  const list = Array.isArray(subscriptions) ? subscriptions : [];
  const query = toText(options.query).trim().toLowerCase();
  const status = options.status || 'all';

  return list.filter((subscription) => {
    if (!subscription || typeof subscription !== 'object') return false;
    if (status !== 'all' && subscription.status !== status) return false;
    return matchesQuery([subscription.user_email, subscription.plan], query);
  });
}

export function selectAdminUsersView(options = {}) {
  const status = options.status;
  const totalUsers = options.totalUsers || 0;
  const matchCount = options.matchCount || 0;

  if (status === 'loading') return 'loading';
  if (status === 'error' && totalUsers === 0) return 'error';
  if (totalUsers === 0) return 'empty';
  if (matchCount === 0) return 'no-matches';
  return 'ready';
}

export function selectAdminModerationView(options = {}) {
  const status = options.status;
  const totalReports = options.totalReports || 0;
  const matchCount = options.matchCount || 0;

  if (status === 'loading') return 'loading';
  if (status === 'error' && totalReports === 0) return 'error';
  if (totalReports === 0) return 'empty';
  if (matchCount === 0) return 'no-matches';
  return 'ready';
}

export function selectAdminSubscriptionsView(options = {}) {
  const status = options.status;
  const totalSubscriptions = options.totalSubscriptions || 0;
  const matchCount = options.matchCount || 0;

  if (status === 'loading') return 'loading';
  if (status === 'error' && totalSubscriptions === 0) return 'error';
  if (totalSubscriptions === 0) return 'empty';
  if (matchCount === 0) return 'no-matches';
  return 'ready';
}

export function selectUserRoleLabel(role) {
  if (role === 'admin') return 'Admin';
  if (role === 'user') return 'User';
  return toText(role) || 'Unknown';
}

export function selectUserRoleTone(role) {
  if (role === 'admin') return 'info';
  return 'muted';
}

export function selectReportStatusLabel(status) {
  if (status === 'pending') return 'Pending';
  if (status === 'resolved') return 'Resolved';
  if (status === 'dismissed') return 'Dismissed';
  return toText(status) || 'Unknown';
}

export function selectReportStatusTone(status) {
  if (status === 'pending') return 'warn';
  if (status === 'resolved') return 'ok';
  if (status === 'dismissed') return 'muted';
  return 'muted';
}

export function selectSubscriptionStatusLabel(status) {
  if (status === 'active') return 'Active';
  if (status === 'expired') return 'Expired';
  return toText(status) || 'Unknown';
}

export function selectSubscriptionStatusTone(status) {
  if (status === 'active') return 'ok';
  if (status === 'expired') return 'muted';
  return 'muted';
}

export function buildSubscriptionSummary(subscriptions) {
  const list = Array.isArray(subscriptions) ? subscriptions : [];
  const active = list.filter((item) => item && item.status === 'active').length;
  const expired = list.filter((item) => item && item.status === 'expired').length;

  return [
    { key: 'total', label: 'Total Subscriptions', value: list.length, icon: 'fa-credit-card' },
    { key: 'active', label: 'Active', value: active, icon: 'fa-circle-check' },
    { key: 'expired', label: 'Expired', value: expired, icon: 'fa-clock' },
  ];
}

export function formatAdminDate(value) {
  if (typeof value !== 'string' || value.trim() === '') return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parsed);
  } catch {
    return '—';
  }
}
