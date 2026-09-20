// Auth context — manages JWT access/refresh, user profile, and auth flows.
//
// Access token lives in localStorage('grvt-grid-token'); refresh in
// 'grvt-grid-refresh'. On mount we validate via GET /auth/me. A 401
// first tries /auth/refresh; if that fails we clear session and go
// to /login. The api-client retries expired access tokens the same way.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  clearSessionTokens,
  loadStoredSession,
  setAuthToken,
} from './api-client';
import { wsClient } from './ws-client';

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
  hasGrvtCreds: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (idToken: string, extras?: {
    acceptedTerms?: boolean;
    tosLang?: 'es' | 'en';
  }) => Promise<void>;
  signup: (email: string, password: string, tosLang?: 'es' | 'en') => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStoredSession();
  const [token, setToken] = useState<string | null>(stored.access);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(!!stored.access);

  const applyAccessToken = useCallback((t: string) => {
    setAuthToken(t);
    setToken(t);
    wsClient.disconnect();
    wsClient.connect();
  }, []);

  const logout = useCallback(() => {
    const refresh = loadStoredSession().refresh;
    void api.logoutSession(refresh);
    clearSessionTokens();
    wsClient.disconnect();
    setToken(null);
    setUser(null);
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const data = await api.getMe();
      setUser({
        id: data.id,
        email: data.email,
        isAdmin: data.isAdmin,
        hasGrvtCreds: data.hasGrvtCreds,
        createdAt: data.createdAt,
        lastLoginAt: data.lastLoginAt,
      });
    } catch {
      logout();
    }
  }, [logout]);

  useEffect(() => {
    if (token) {
      setAuthToken(token);
      refreshMe().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    applyAccessToken(res.token);
    setUser({
      id: res.userId,
      email,
      isAdmin: res.isAdmin,
      hasGrvtCreds: res.hasGrvtCreds,
      createdAt: 0,
      lastLoginAt: null,
    });
  }, [applyAccessToken]);

  const loginWithGoogle = useCallback(async (
    idToken: string,
    extras: { acceptedTerms?: boolean; tosLang?: 'es' | 'en' } = {}
  ) => {
    const res = await api.loginWithGoogle(idToken, extras);
    applyAccessToken(res.token);
    setUser({
      id: res.userId,
      email: '',
      isAdmin: res.isAdmin,
      hasGrvtCreds: res.hasGrvtCreds,
      createdAt: extras.acceptedTerms ? Date.now() : 0,
      lastLoginAt: null,
    });
    await refreshMe();
  }, [applyAccessToken, refreshMe]);

  const signup = useCallback(async (
    email: string,
    password: string,
    tosLang: 'es' | 'en' = 'en'
  ) => {
    const res = await api.signup(email, password, tosLang);
    applyAccessToken(res.token);
    setUser({
      id: res.userId,
      email,
      isAdmin: res.isAdmin,
      hasGrvtCreds: false,
      createdAt: Date.now(),
      lastLoginAt: null,
    });
  }, [applyAccessToken]);

  const value = useMemo<AuthCtx>(
    () => ({ user, token, loading, login, loginWithGoogle, signup, logout, refreshMe }),
    [user, token, loading, login, loginWithGoogle, signup, logout, refreshMe]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
