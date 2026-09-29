import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADMIN_SESSION_TOKEN_KEY,
  AUTH_TOKEN_SOURCE,
  PERSISTENT_TOKEN_KEY,
  clearAuthSession,
  getActiveAuthToken,
  isRestorableSession,
  readActiveAuthSession,
  storeAuthSession,
} from './authToken.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '..');
const read = (...parts) => readFileSync(join(srcRoot, ...parts), 'utf8');

const APP_SOURCE = read('App.jsx');
const AUTH_SOURCE = read('context', 'AuthContext.jsx');
const API_SOURCE = read('api', 'client.js');
const LOGIN_SOURCE = read('pages', 'Login', 'Login.jsx');
const SIGNUP_SOURCE = read('pages', 'Signup', 'Signup.jsx');
const KARAOKE_SOURCE = read('pages', 'Admin', 'KaraokeForm.jsx');
const TOKEN_SOURCE = read('auth', 'authToken.js');

const makeStorage = (seed = {}) => {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
};

const makeStores = (seedSession = {}, seedLocal = {}) => ({
  session: makeStorage(seedSession),
  local: makeStorage(seedLocal),
});

const bodyOf = (source, header) => {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `expected ${header}`);
  const arrow = source.indexOf('=> {', start);
  const paren = source.indexOf(') {', start);
  const open = Math.min(arrow === -1 ? Number.POSITIVE_INFINITY : arrow + 3, paren === -1 ? Number.POSITIVE_INFINITY : paren + 2);
  assert.notEqual(open, Number.POSITIVE_INFINITY, `expected a body for ${header}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block for ${header}`);
};

// 1. normal user login persists using the existing persistent storage
test('normal user login persists in localStorage and stays persistent', () => {
  const stores = makeStores();
  storeAuthSession('user-token', 'user', stores);
  assert.equal(stores.local.getItem(PERSISTENT_TOKEN_KEY), 'user-token');
  assert.equal(stores.session.getItem(ADMIN_SESSION_TOKEN_KEY), null);
  const active = readActiveAuthSession(stores);
  assert.equal(active.token, 'user-token');
  assert.equal(active.source, AUTH_TOKEN_SOURCE.PERSISTENT);
  assert.equal(isRestorableSession(active.source, 'user'), true);
});

test('normal user persistence survives a fresh page load with the same storage', () => {
  const stores = makeStores({}, { [PERSISTENT_TOKEN_KEY]: 'user-token' });
  const active = readActiveAuthSession(stores);
  assert.equal(active.token, 'user-token');
  assert.equal(isRestorableSession(active.source, 'user'), true);
});

// 2. admin login uses session-scoped storage
test('admin login is written to sessionStorage only, never localStorage', () => {
  const stores = makeStores({}, { [PERSISTENT_TOKEN_KEY]: 'stale-user-token' });
  storeAuthSession('admin-token', 'admin', stores);
  assert.equal(stores.session.getItem(ADMIN_SESSION_TOKEN_KEY), 'admin-token');
  assert.equal(stores.local.getItem(PERSISTENT_TOKEN_KEY), null);
  const active = readActiveAuthSession(stores);
  assert.equal(active.token, 'admin-token');
  assert.equal(active.source, AUTH_TOKEN_SOURCE.ADMIN_SESSION);
});

test('admin login never leaves a dual-auth state behind', () => {
  const stores = makeStores({}, { [PERSISTENT_TOKEN_KEY]: 'user-token' });
  storeAuthSession('admin-token', 'admin', stores);
  assert.equal(stores.local.getItem(PERSISTENT_TOKEN_KEY), null);
  storeAuthSession('other-user-token', 'user', stores);
  assert.equal(stores.session.getItem(ADMIN_SESSION_TOKEN_KEY), null);
  assert.equal(stores.local.getItem(PERSISTENT_TOKEN_KEY), 'other-user-token');
});

// 3 + 4. login redirects
test('admin login redirects to the Admin Panel and normal login to the Dashboard', () => {
  assert.match(LOGIN_SOURCE, /navigate\(data\.user\.role === 'admin' \? '\/admin' : '\/dashboard'\)/);
  assert.equal(LOGIN_SOURCE.includes("navigate('/admin');"), false);
  assert.equal(LOGIN_SOURCE.includes("navigate('/dashboard');"), false);
  assert.match(SIGNUP_SOURCE, /navigate\('\/dashboard'\)/);
});

// 5. restored admin session resolves to admin UI
test('restored admin session resolves to the admin interface', () => {
  const stores = makeStores({ [ADMIN_SESSION_TOKEN_KEY]: 'admin-token' });
  const active = readActiveAuthSession(stores);
  assert.equal(active.token, 'admin-token');
  assert.equal(active.source, AUTH_TOKEN_SOURCE.ADMIN_SESSION);
  assert.equal(isRestorableSession(active.source, 'admin'), true);
  assert.match(AUTH_SOURCE, /isRestorableSession\(session\.source, data\.user && data\.user\.role\)/);
  assert.match(APP_SOURCE, /if \(user\.role === 'admin'\) return <Navigate to="\/admin" replace \/>;/);
});

test('an admin identity is never restored from the persistent store', () => {
  assert.equal(isRestorableSession(AUTH_TOKEN_SOURCE.PERSISTENT, 'admin'), false);
  assert.equal(isRestorableSession(null, 'admin'), false);
  assert.equal(isRestorableSession(AUTH_TOKEN_SOURCE.ADMIN_SESSION, 'admin'), true);
  assert.equal(isRestorableSession(AUTH_TOKEN_SOURCE.PERSISTENT, 'user'), true);
  assert.match(AUTH_SOURCE, /clearAuthSession\(\);\s*\n\s*setUser\(null\);/);
});

// 6. browser session end drops the admin session
test('absent admin session after browser close means the admin is not restored', () => {
  const beforeClose = makeStores();
  storeAuthSession('admin-token', 'admin', beforeClose);
  assert.equal(getActiveAuthToken(beforeClose), 'admin-token');

  const afterClose = makeStores();
  assert.equal(getActiveAuthToken(afterClose), null);
  const active = readActiveAuthSession(afterClose);
  assert.equal(active.token, null);
  assert.equal(active.source, null);
  assert.match(AUTH_SOURCE, /if \(!session\.token\) \{/);
  assert.match(AUTH_SOURCE, /setLoading\(false\);\s*\n\s*return;/);
});

test('session storage only survives navigation inside the same open session', () => {
  const stores = makeStores({ [ADMIN_SESSION_TOKEN_KEY]: 'admin-token' });
  assert.equal(getActiveAuthToken(stores), 'admin-token');
  stores.session.clear();
  assert.equal(getActiveAuthToken(stores), null);
});

// 7. admin cannot stay on the normal Dashboard
test('admin navigating to /dashboard is redirected to the admin panel', () => {
  const protectedBody = bodyOf(APP_SOURCE, 'function Protected');
  const adminIndex = protectedBody.indexOf("user.role === 'admin'");
  const loginIndex = protectedBody.indexOf('if (!user)');
  const childrenIndex = protectedBody.indexOf('return children');
  assert.notEqual(adminIndex, -1);
  assert.ok(loginIndex !== -1 && adminIndex > loginIndex, 'admin check follows the unauthenticated check');
  assert.ok(childrenIndex > adminIndex, 'admin redirect precedes rendering children');
  assert.match(protectedBody, /if \(user\.role === 'admin'\) return <Navigate to="\/admin" replace \/>;/);
  assert.equal(protectedBody.includes('to="/dashboard"'), false);
});

test('the authenticated shell never renders for an admin', () => {
  const shellMatch = /<Route\s+element=\{/.exec(APP_SOURCE);
  assert.ok(shellMatch, 'authenticated shell route group exists');
  const shellStart = shellMatch.index;
  const shellEnd = APP_SOURCE.indexOf('path="/liked"');
  assert.ok(shellEnd > shellStart, 'authenticated shell route group is bounded');
  const shellBlock = APP_SOURCE.slice(shellStart, shellEnd);
  assert.ok(shellBlock.includes('<Protected>'), 'shell routes stay behind Protected');
  assert.equal(shellBlock.includes('<AdminProtected>'), false);
  assert.ok(shellBlock.includes('<Route path="/dashboard" element={<Dashboard />} />'));
  assert.equal(/<Route path="\/dashboard"[^>]*<AdminProtected>/.test(APP_SOURCE), false);
  const adminBlock = APP_SOURCE.slice(APP_SOURCE.indexOf('path="/admin"'), APP_SOURCE.indexOf('path="/admin/ai-recommendation"'));
  assert.ok(adminBlock.includes('<AdminProtected>'));
  assert.equal(adminBlock.includes('<Protected>'), false);
});

// 8. normal user cannot access /admin
test('normal user cannot access /admin', () => {
  const adminProtectedBody = bodyOf(APP_SOURCE, 'function AdminProtected');
  assert.match(adminProtectedBody, /if \(user\.role !== 'admin'\) return <Navigate to="\/dashboard" replace \/>;/);
  assert.ok(adminProtectedBody.includes('return children;'));
  assert.equal((APP_SOURCE.match(/<AdminProtected>/g) || []).length, 2);
});

// 9. logout clears the correct storage
test('logout clears every auth storage so no stale role can be restored', () => {
  const stores = makeStores({ [ADMIN_SESSION_TOKEN_KEY]: 'admin-token' }, { [PERSISTENT_TOKEN_KEY]: 'stale-user-token' });
  clearAuthSession(stores);
  assert.equal(stores.session.getItem(ADMIN_SESSION_TOKEN_KEY), null);
  assert.equal(stores.local.getItem(PERSISTENT_TOKEN_KEY), null);
  assert.equal(getActiveAuthToken(stores), null);

  const loginBody = bodyOf(AUTH_SOURCE, 'const logout =');
  assert.match(loginBody, /clearAuthSession\(\)/);
  assert.equal(loginBody.includes('localStorage'), false);
  assert.equal(loginBody.includes('sessionStorage'), false);
});

// 10. 401 clears active credentials
test('401 clears the active credentials and cannot leave an admin-looking session', () => {
  const unauthorizedBranch = API_SOURCE.slice(API_SOURCE.indexOf('if (res.status === 401)'), API_SOURCE.indexOf('let data;'));
  assert.match(unauthorizedBranch, /clearAuthSession\(\)/);
  assert.match(unauthorizedBranch, /window\.location\.pathname !== '\/login'/);
  assert.match(unauthorizedBranch, /window\.location\.href = '\/login'/);
  assert.equal(unauthorizedBranch.includes('setItem'), false);

  const stores = makeStores({ [ADMIN_SESSION_TOKEN_KEY]: 'admin-token' }, { [PERSISTENT_TOKEN_KEY]: 'user-token' });
  clearAuthSession(stores);
  assert.equal(getActiveAuthToken(stores), null);
});

test('the API client resolves the token through the single shared helper', () => {
  assert.match(API_SOURCE, /import \{ clearAuthSession, getActiveAuthToken \} from '\.\.\/auth\/authToken\.js';/);
  assert.match(API_SOURCE, /const token = getActiveAuthToken\(\);/);
  assert.equal(API_SOURCE.includes("localStorage.getItem('melodify_token')"), false);
  assert.equal(API_SOURCE.includes('localStorage.removeItem'), false);
  const tokenReaders = [API_SOURCE, AUTH_SOURCE, KARAOKE_SOURCE].filter((source) => source.includes('localStorage.getItem'));
  assert.equal(tokenReaders.length, 0);
  assert.match(AUTH_SOURCE, /storeAuthSession\(token, userData && userData\.role\)/);
});

// 11. no redirect loop between login, admin and dashboard
test('redirect graph between login, admin and dashboard has no loop', () => {
  const publicEntryBody = bodyOf(APP_SOURCE, 'function PublicEntry');
  assert.match(publicEntryBody, /if \(user && user\.role === 'admin'\) return <Navigate to="\/admin" replace \/>;/);
  assert.equal(publicEntryBody.includes('"/login"'), false, 'public entry never bounces visitors to /login');
  assert.equal(publicEntryBody.includes('loading'), false, 'public entry never blanks the public page');

  const protectedBody = bodyOf(APP_SOURCE, 'function Protected');
  assert.match(protectedBody, /if \(!user\) return <Navigate to="\/login" replace \/>;/);
  assert.ok(protectedBody.includes('to="/admin"'));

  const adminProtectedBody = bodyOf(APP_SOURCE, 'function AdminProtected');
  assert.equal(adminProtectedBody.includes('to="/admin"'), false);

  assert.match(APP_SOURCE, /<Route path="\/login" element=\{<PublicEntry><Login \/><\/PublicEntry>\} \/>/);
  assert.equal(/<Route path="\/admin"[\s\S]{0,200}<Protected>/.test(APP_SOURCE), false);
  assert.equal((APP_SOURCE.match(/function \w*Protected/g) || []).join('|'), 'function Protected|function AdminProtected');
});

test('no role parsing, password storage, or JWT inspection is added client-side', () => {
  for (const source of [APP_SOURCE, AUTH_SOURCE, API_SOURCE, TOKEN_SOURCE, KARAOKE_SOURCE]) {
    assert.equal(/atob\(|jwt|token_use/.test(source), false, source.slice(0, 40));
  }
  assert.equal(/password/i.test(TOKEN_SOURCE), false);
  assert.equal(/localStorage|sessionStorage/.test(APP_SOURCE), false);
  assert.equal(/isAdmin\s*\(/.test(APP_SOURCE), false);
  assert.equal(AUTH_SOURCE.includes("localStorage.setItem('melodify_token', token)"), false);
  assert.equal(AUTH_SOURCE.includes('JSON.parse('), false);
});
