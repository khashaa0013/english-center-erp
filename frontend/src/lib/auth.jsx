// Нэвтэрсэн хэрэглэгчийн context
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  const refresh = useCallback(async () => {
    if (!getToken()) return setUser(null);
    try {
      setUser(await api('/auth/me'));
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (username, password) => {
    const { token } = await api('/auth/login', { method: 'POST', body: { username, password } });
    setToken(token);
    await refresh();
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const isStaff = (u) => ['SUPER_ADMIN', 'BRANCH_ADMIN'].includes(u?.role);
export const isOffice = (u) => ['SUPER_ADMIN', 'BRANCH_ADMIN', 'FINANCE'].includes(u?.role);
