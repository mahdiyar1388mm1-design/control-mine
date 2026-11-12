import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { apiFetch, getStoredToken, storeSessionTokens, clearSessionTokens, ensureCsrfToken } from '../lib/api';

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
        clearSessionTokens();
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
    // Second factor pending: no session yet, the UI must ask for the code.
    if (res.mfa_required) return res;
    storeSessionTokens(res);
    await ensureCsrfToken({ force: true });
    setUser(res.user);
    await refreshCounts();
    return res;
  };

  /** Completes a two-factor login with a TOTP code or a recovery code. */
  const verifyMfa = async ({ challengeToken, code, recoveryCode }) => {
    const res = await apiFetch('/auth/mfa/verify', {
      method: 'POST',
      body: recoveryCode
        ? { challenge_token: challengeToken, recovery_code: recoveryCode }
        : { challenge_token: challengeToken, code }
    });
    storeSessionTokens(res);
    await ensureCsrfToken({ force: true });
    setUser(res.user);
    await refreshCounts();
    return res;
  };

  const register = async ({ phone, full_name, password, email }) => {
    const res = await apiFetch('/auth/register', {
      method: 'POST',
      body: { phone, full_name, password, email: email || undefined }
    });
    storeSessionTokens(res);
    await ensureCsrfToken({ force: true });
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
    storeSessionTokens(res);
    await ensureCsrfToken({ force: true });
    setUser(res.user);
    await refreshCounts();
    return res;
  };

  /** Local teardown only — used when the session is already gone server-side. */
  const forgetSession = useCallback(() => {
    clearSessionTokens();
    setUser(null);
    setCartCount(0);
    setUnreadCount(0);
  }, []);

  const logout = async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      /* session may already be expired */
    } finally {
      // Always drop the bearer, the refresh token and the (often stale) CSRF copy,
      // otherwise the next visitor of this tab inherits a half-broken pair.
      forgetSession();
    }
  };

  /**
   * Closes every other device session and keeps the current one.
   * If the current session was one of the revoked ones (or expired), the local
   * state is torn down so the UI leaves the account area instead of looping 401s.
   */
  const logoutEverywhere = async () => {
    let res = null;
    let ok = false;
    try {
      res = await apiFetch('/auth/logout-all', { method: 'POST' });
      ok = true;
      return res;
    } finally {
      if (ok) {
        await refreshMe();
      } else {
        forgetSession();
      }
    }
  };

  /** Step-up authentication for sensitive admin actions. */
  const verifyIdentity = async (password, purpose = 'sensitive') =>
    apiFetch('/auth/verify-identity', { method: 'POST', body: { password, purpose } });

  return (
    <AuthContext.Provider value={{
      user,
      authLoading,
      cartCount,
      unreadCount,
      hasTokenHint: Boolean(getStoredToken()),
      login,
      verifyMfa,
      register,
      requestOtp,
      verifyOtp,
      logout,
      logoutEverywhere,
      forgetSession,
      verifyIdentity,
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
