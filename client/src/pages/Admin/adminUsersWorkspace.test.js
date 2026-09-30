import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_USERS_MESSAGES,
  ADMIN_USER_ROLE_FILTERS,
  filterAdminUsers,
  formatAdminDate,
  selectAdminUsersView,
  selectUserRoleLabel,
  selectUserRoleTone,
} from './adminOperationsWorkspacesUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminSource = readFileSync(join(__dirname, 'Admin.jsx'), 'utf8');
const adminCss = readFileSync(join(__dirname, 'Admin.css'), 'utf8').replace(/\r\n/g, '\n');

const usersBlock = adminSource.slice(
  adminSource.indexOf("section === 'users'"),
  adminSource.indexOf("section === 'music'"),
);

test('1: User Management header and workspace wrapper exist', () => {
  assert.match(adminSource, /<div id="users" className="admin-page">/);
  assert.match(usersBlock, /<h2>User Management<\/h2>/);
  assert.match(usersBlock, /admin-page-header/);
  assert.match(usersBlock, /admin-page-subtitle/);
  assert.equal(
    ADMIN_USERS_MESSAGES.PAGE_SUBTITLE,
    'Manage Melodify user accounts, roles, and account status.',
  );
  assert.match(usersBlock, /\{ADMIN_USERS_MESSAGES\.PAGE_SUBTITLE\}/);
  assert.match(usersBlock, /onClick=\{\(\) => loadAll\(true\)\} disabled=\{refreshing\}/);
});

test('2: toolbar exposes search and the supported role filter', () => {
  assert.equal(ADMIN_USERS_MESSAGES.SEARCH_PLACEHOLDER, 'Search users...');
  assert.equal(ADMIN_USERS_MESSAGES.FILTER_ROLE, 'Filter by role');
  assert.match(usersBlock, /className="admin-toolbar"/);
  assert.match(usersBlock, /className="admin-toolbar-input"/);
  assert.match(usersBlock, /placeholder=\{ADMIN_USERS_MESSAGES\.SEARCH_PLACEHOLDER\}/);
  assert.match(usersBlock, /aria-label="Search users"/);
  assert.match(usersBlock, /value=\{userSearch\}/);
  assert.match(usersBlock, /onChange=\{\(event\) => setUserSearch\(event\.target\.value\)\}/);
  assert.match(usersBlock, /value=\{userRoleFilter\}/);
  assert.match(usersBlock, /onChange=\{\(event\) => setUserRoleFilter\(event\.target\.value\)\}/);
  assert.deepEqual(
    ADMIN_USER_ROLE_FILTERS.map((option) => option.value),
    ['all', 'user', 'admin'],
  );
  assert.match(usersBlock, /\{ADMIN_USER_ROLE_FILTERS\.map\(/);
  assert.equal(usersBlock.includes('style={{'), false, 'no legacy inline input styling');
});

test('3: table keeps user rows with avatar, name, email, role, joined', () => {
  for (const header of ['User', 'Email', 'Role', 'Joined', 'Actions']) {
    assert.ok(usersBlock.includes(`<th>${header}</th>`), header);
  }
  assert.equal(usersBlock.includes('<th>Status</th>'), false, 'no fabricated status column');
  assert.match(usersBlock, /\{filteredUsers\.map\(\(u\) => \(/);
  assert.match(usersBlock, /key=\{u\._id\}/);
  assert.match(usersBlock, /u\.avatar \? \(/);
  assert.match(usersBlock, /className="admin-user-avatar"/);
  assert.match(usersBlock, /\{u\.name\}/);
  assert.match(usersBlock, /title=\{u\.email\}/);
  assert.match(usersBlock, /\{u\.email\}/);
  assert.match(usersBlock, /\{formatAdminDate\(u\.createdAt\)\}/);
});

test('4: real role badges render from the role field only', () => {
  assert.equal(selectUserRoleLabel('admin'), 'Admin');
  assert.equal(selectUserRoleLabel('user'), 'User');
  assert.equal(selectUserRoleTone('admin'), 'info');
  assert.equal(selectUserRoleTone('user'), 'muted');
  assert.equal(selectUserRoleTone('anything-else'), 'muted');
  assert.match(usersBlock, /selectUserRoleTone\(u\.role\)/);
  assert.match(usersBlock, /selectUserRoleLabel\(u\.role\)/);
  assert.match(usersBlock, /admin-badge \$\{selectUserRoleTone\(u\.role\)\}/);
});

test('5: existing role edit and delete actions are preserved', () => {
  assert.match(usersBlock, /editingUser === u\._id/);
  assert.match(usersBlock, /onChange=\{\(event\) => updateUserRole\(u\._id, event\.target\.value\)\}/);
  assert.ok(usersBlock.includes('<option value="user">User</option>'));
  assert.ok(usersBlock.includes('<option value="admin">Admin</option>'));
  assert.match(usersBlock, /onClick=\{\(\) => setEditingUser\(u\._id\)\}>Edit</);
  assert.match(usersBlock, /onClick=\{\(\) => deleteUser\(u\._id\)\}>Delete</);
  assert.match(usersBlock, /aria-label=\{`Role for \$\{u\.name\}`\}/);
  const handlers = adminSource.slice(
    adminSource.indexOf('const deleteUser'),
    adminSource.indexOf('const deleteSong'),
  );
  assert.match(handlers, /confirm\('Are you sure you want to delete this user\?'\)/);
  assert.match(handlers, /api\.del\(`\/api\/admin\/users\/\$\{id\}`\)/);
  const roleHandler = adminSource.slice(
    adminSource.indexOf('const updateUserRole'),
    adminSource.indexOf('const deleteSong'),
  );
  assert.match(roleHandler, /api\.put\(`\/api\/admin\/users\/\$\{id\}`, \{ role \}\)/);
});

test('6: loading, empty, no-match, and error states use the exact messages', () => {
  assert.equal(ADMIN_USERS_MESSAGES.LOADING, 'Loading users...');
  assert.equal(ADMIN_USERS_MESSAGES.EMPTY, 'No users found.');
  assert.equal(ADMIN_USERS_MESSAGES.NO_MATCHES, 'No users match your search.');
  assert.equal(ADMIN_USERS_MESSAGES.ERROR, 'Unable to load users.');
  assert.equal(ADMIN_USERS_MESSAGES.RETRY, 'Retry');
  assert.match(usersBlock, /usersView === 'loading'/);
  assert.match(usersBlock, /usersView === 'error'/);
  assert.match(usersBlock, /usersView === 'empty'/);
  assert.match(usersBlock, /usersView === 'no-matches'/);
  assert.match(usersBlock, /admin-error-state" role="alert"/);
  assert.match(usersBlock, /role="status"/);
  assert.match(usersBlock, /\{ADMIN_USERS_MESSAGES\.RETRY\}/);
  assert.match(usersBlock, /onClick=\{\(\) => loadAll\(true\)\}/);
  assert.match(usersBlock, /ADMIN_USERS_MESSAGES\.REFRESH_FAILED/);
});

test('7: no unsupported admin actions are introduced', () => {
  for (const token of ['Suspend', 'Unsuspend', 'Ban', 'Block', 'Reset Password', 'Impersonate']) {
    assert.equal(usersBlock.includes(token), false, token);
  }
  assert.equal(usersBlock.includes('api.post'), false);
  assert.equal(usersBlock.includes('api.put'), false);
  assert.equal(usersBlock.includes('api.del'), false);
});

test('8: filter helper performs bounded client-side search and role filtering', () => {
  const users = [
    { _id: '1', name: 'Aronno', email: 'aronno@mail.test', role: 'admin' },
    { _id: '2', name: 'Mimi', email: 'mimi@mail.test', role: 'user' },
    { _id: '3', name: 'Ehsanul', email: 'ehsanul@mail.test', role: 'user' },
  ];
  assert.deepEqual(
    filterAdminUsers(users, { query: 'ARONNO' }).map((u) => u._id),
    ['1'],
  );
  assert.deepEqual(
    filterAdminUsers(users, { query: 'mail.test', role: 'user' }).map((u) => u._id),
    ['2', '3'],
  );
  assert.equal(filterAdminUsers(users, { query: 'zzz' }).length, 0);
  assert.equal(filterAdminUsers(users, {}).length, 3);
  assert.deepEqual(filterAdminUsers(null, {}), []);
  assert.deepEqual(filterAdminUsers([null, 'bad'], { query: 'a' }), []);
});

test('9: view selector distinguishes loading, error, empty, no-matches, ready', () => {
  assert.equal(selectAdminUsersView({ status: 'loading' }), 'loading');
  assert.equal(selectAdminUsersView({ status: 'error', totalUsers: 0 }), 'error');
  assert.equal(selectAdminUsersView({ status: 'ready', totalUsers: 0 }), 'empty');
  assert.equal(
    selectAdminUsersView({ status: 'ready', totalUsers: 5, matchCount: 0 }),
    'no-matches',
  );
  assert.equal(
    selectAdminUsersView({ status: 'ready', totalUsers: 5, matchCount: 2 }),
    'ready',
  );
  assert.equal(
    selectAdminUsersView({ status: 'error', totalUsers: 5, matchCount: 2 }),
    'ready',
    'a failed refresh keeps already loaded rows visible',
  );
});

test('10: joined dates format from real timestamps only', () => {
  assert.equal(formatAdminDate('2026-08-01T00:00:00.000Z').length > 0, true);
  assert.equal(formatAdminDate('not-a-date'), '—');
  assert.equal(formatAdminDate(undefined), '—');
});

test('11: workspace reuses the shared admin visual system', () => {
  for (const className of [
    'admin-page',
    'admin-page-header',
    'admin-toolbar',
    'admin-table-scroll',
    'admin-badge',
    'admin-state-block',
    'admin-error-state',
    'admin-inline-notice',
  ]) {
    assert.ok(adminCss.includes(`.${className}`), className);
  }
  assert.match(adminCss, /\.admin-user-cell/);
  assert.match(adminCss, /\.admin-user-avatar/);
  assert.match(adminCss, /\.admin-cell-truncate/);
});
