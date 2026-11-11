import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, getStoredToken, setStoredToken } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [cartCount, setCartCount] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);

  const refreshCounts = useCallback(async () => {
    try {
      const [cart, notifs] = await Promise.all([
        apiFetch('/cart'),
        apiFetch('/notifications?limit=5')
      ]);
      const qty = (cart?.items || []).reduce((sum, it) => sum + (it.quantity || 0), 0);
      setCartCount(qty);
      setUnreadCount(notifs?.unread_count || 0);
    } catch {
      /* ignore background count refresh errors */
    }
  }, []);

  const refreshMe = useCallback(async () => {
    setAuthLoading(true);
    try {
      const data = await apiFetch('/auth/me');
      setUser(data.user);
      await refreshCounts();
      return data.user;
    } catch (err) {
      if (err.status === 401) {
        setStoredToken(null);
        setUser(null);
        setCartCount(0);
        setUnreadCount(0);
      }
      return null;
    } finally {
      setAuthLoading(false);
    }
  }, [refreshCounts]);

  useEffect(() => {
    // Check session via cookie or stored token on boot (survives refresh)
    refreshMe();
  }, [refreshMe]);

  const login = async (phone, password) => {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: { phone, password }
    });
    if (res.token) setStoredToken(res.token);
    setUser(res.user);
    await refreshCounts();
    return res;
  };

  const register = async ({ phone, full_name, password, email }) => {
    const res = await apiFetch('/auth/register', {
      method: 'POST',
      body: { phone, full_name, password, email: email || undefined }
    });
    if (res.token) setStoredToken(res.token);
    setUser(res.user);
    await refreshCounts();
    return res;
  };

  const requestOtp = async (phone) => {
    return apiFetch('/auth/otp/request', {
      method: 'POST',
      body: { phone }
    });
  };

  const verifyOtp = async (phone, code) => {
    const res = await apiFetch('/auth/otp/verify', {
      method: 'POST',
      body: { phone, code }
    });
    if (res.token) setStoredToken(res.token);
    setUser(res.user);
    await refreshCounts();
    return res;
  };

  const logout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      /* session may already be expired */
    } finally {
      setStoredToken(null);
      setUser(null);
      setCartCount(0);
      setUnreadCount(0);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      authLoading,
      cartCount,
      unreadCount,
      hasTokenHint: Boolean(getStoredToken()),
      login,
      register,
      requestOtp,
      verifyOtp,
      logout,
      refreshMe,
      refreshCounts
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
