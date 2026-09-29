import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import {
  clearAuthSession,
  isRestorableSession,
  readActiveAuthSession,
  storeAuthSession,
} from '../auth/authToken.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    const session = readActiveAuthSession();
    if (!session.token) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.get('/api/auth/me');
      if (data.success) {
        if (isRestorableSession(session.source, data.user && data.user.role)) {
          setUser(data.user);
        } else {
          clearAuthSession();
          setUser(null);
        }
      } else {
        clearAuthSession();
      }
    } catch {
      clearAuthSession();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const login = (token, userData) => {
    storeAuthSession(token, userData && userData.role);
    setUser(userData);
  };

  const logout = () => {
    clearAuthSession();
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const data = await api.get('/api/auth/me');
      if (data.success) setUser(data.user);
      else logout();
    } catch {
      logout();
    }
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
