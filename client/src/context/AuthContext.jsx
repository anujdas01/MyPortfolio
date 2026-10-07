import React, { createContext, useContext, useEffect, useState } from 'react';
import api, {
  MAIN_BASE,
  DEMO_BASE,
  setApiBase,
  setAccessToken,
  clearAccessToken,
  refreshSession,
} from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  // The access token is memory-only, so a page load starts with none and has to
  // re-mint one from the httpOnly refresh cookie before it can call anything.
  // The shared refreshSession() promise deduplicates concurrent boots (React
  // StrictMode in dev runs this effect twice) so only a single /auth/refresh
  // hits the server — otherwise the two requests would rotate the same refresh
  // token and the loser would be treated as a logged-out 401.
  useEffect(() => {
    refreshSession()
      .then((r) => {
        setAccessToken(r.data.accessToken);
        setUser(r.data.user);
      })
      .catch(() => {
        clearAccessToken();
        setUser(null);
      })
      .finally(() => setBooting(false));
  }, []);

  const login = async (username, password) => {
    setApiBase(MAIN_BASE);
    const { data } = await api.post('/auth/login', { username, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const loginDemo = async () => {
    setApiBase(DEMO_BASE);
    try {
      const { data } = await api.post('/auth/demo-login');
      setAccessToken(data.accessToken);
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
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    clearAccessToken();
    setApiBase(MAIN_BASE);
    setUser(null);
  };

  // Self-service profile edit. Returns the change flags, since credential
  // changes also re-issue the session and hand back a fresh access token.
  // Changing the login name requires the current password (server-enforced).
  const updateProfile = async ({ displayName, username, currentPassword, newPassword }) => {
    const payload = {};
    if (displayName !== undefined) payload.displayName = displayName;
    if (username !== undefined) payload.username = username;
    if (newPassword || username !== undefined) {
      payload.currentPassword = currentPassword;
      if (newPassword) payload.newPassword = newPassword;
    }
    const { data } = await api.patch('/auth/me', payload);
    if (data.accessToken) setAccessToken(data.accessToken);
    if (data.user) setUser(data.user);
    return data;
  };

  // Re-read the current user (e.g. after an admin renamed this account).
  const refreshUser = async () => {
    const { data } = await api.get('/auth/me');
    if (data.user) setUser(data.user);
    return data.user;
  };

  return (
    <AuthContext.Provider value={{ user, booting, login, loginDemo, setup, logout, updateProfile, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}