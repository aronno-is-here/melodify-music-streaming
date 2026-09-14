import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = async () => {
    const token = localStorage.getItem('melodify_token');
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const data = await api.get('/api/auth/me');
      if (data.success) setUser(data.user);
      else localStorage.removeItem('melodify_token');
    } catch {
      localStorage.removeItem('melodify_token');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUser();
  }, []);

  const login = (token, userData) => {
    localStorage.setItem('melodify_token', token);
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('melodify_token');
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
