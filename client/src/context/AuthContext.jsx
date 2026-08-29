import React, { createContext, useContext, useEffect, useState } from 'react';
import api, { TOKEN_KEY, MAIN_BASE, DEMO_BASE, setApiBase } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    api
      .get('/auth/me')
      .then((r) => setUser(r.data.user))
      .catch(() => setUser(null))
      .finally(() => setBooting(false));
  }, []);

  const login = async (username, password) => {
    setApiBase(MAIN_BASE);
    const { data } = await api.post('/auth/login', { username, password });
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const loginDemo = async () => {
    setApiBase(DEMO_BASE);
    try {
      const { data } = await api.post('/auth/demo-login');
      localStorage.setItem(TOKEN_KEY, data.accessToken);
      setUser(data.user);
      return data.user;
    } catch (err) {
      setApiBase(MAIN_BASE);
      throw err;
    }
  };

  const setup = async (username, password, displayName) => {
    setApiBase(MAIN_BASE);
    const { data } = await api.post('/auth/setup', { username, password, displayName });
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    localStorage.removeItem(TOKEN_KEY);
    setApiBase(MAIN_BASE);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, booting, login, loginDemo, setup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
