export const PERSISTENT_TOKEN_KEY = 'melodify_token';
export const ADMIN_SESSION_TOKEN_KEY = 'melodify_admin_token';

export const AUTH_TOKEN_SOURCE = Object.freeze({
  ADMIN_SESSION: 'admin-session',
  PERSISTENT: 'persistent',
});

const storageFor = (kind, stores) => {
  if (stores && stores[kind] != null) return stores[kind];
  if (typeof window === 'undefined') return null;
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

const readKey = (store, key) => {
  try {
    return store ? store.getItem(key) : null;
  } catch {
    return null;
  }
};

const writeKey = (store, key, value) => {
  try {
    if (store) store.setItem(key, value);
  } catch {
    // storage unavailable - ignore
  }
};

const dropKey = (store, key) => {
  try {
    if (store) store.removeItem(key);
  } catch {
    // storage unavailable - ignore
  }
};

export function readActiveAuthSession(stores) {
  const adminSessionToken = readKey(storageFor('session', stores), ADMIN_SESSION_TOKEN_KEY);
  if (adminSessionToken) {
    return { token: adminSessionToken, source: AUTH_TOKEN_SOURCE.ADMIN_SESSION };
  }
  const persistentToken = readKey(storageFor('local', stores), PERSISTENT_TOKEN_KEY);
  if (persistentToken) {
    return { token: persistentToken, source: AUTH_TOKEN_SOURCE.PERSISTENT };
  }
  return { token: null, source: null };
}

export function getActiveAuthToken(stores) {
  return readActiveAuthSession(stores).token;
}

export function storeAuthSession(token, role, stores) {
  const sessionStore = storageFor('session', stores);
  const localStore = storageFor('local', stores);
  if (role === 'admin') {
    dropKey(localStore, PERSISTENT_TOKEN_KEY);
    writeKey(sessionStore, ADMIN_SESSION_TOKEN_KEY, token);
    return;
  }
  dropKey(sessionStore, ADMIN_SESSION_TOKEN_KEY);
  writeKey(localStore, PERSISTENT_TOKEN_KEY, token);
}

export function clearAuthSession(stores) {
  dropKey(storageFor('session', stores), ADMIN_SESSION_TOKEN_KEY);
  dropKey(storageFor('local', stores), PERSISTENT_TOKEN_KEY);
}

export function isRestorableSession(source, role) {
  if (role !== 'admin') return true;
  return source === AUTH_TOKEN_SOURCE.ADMIN_SESSION;
}
