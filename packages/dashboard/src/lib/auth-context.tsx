// Auth context — manages JWT access/refresh, user profile, and auth flows.
//
// Access token lives in memory. Refresh is an httpOnly cookie. On mount we
// call /auth/refresh, then GET /auth/me. A 401 retries refresh once.

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
  type OtpChallenge,
} from './api-client';
import { DEFAULT_NOTIFICATION_PREFS, type NotificationPrefs } from './api-types';
import { wsClient } from './ws-client';

export interface AuthUser {
  id: string;
  email: string;
  isAdmin: boolean;
  hasGrvtCreds: boolean;
  createdAt: number;
  lastLoginAt: number | null;
  displayName: string | null;
  bio: string | null;
  hasAvatar: boolean;
  avatarUpdatedAt: number | null;
  tags: string[];
  notifications: NotificationPrefs;
}

interface AuthCtx {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, lang?: 'es' | 'en') => Promise<OtpChallenge>;
  loginWithGoogle: (idToken: string, extras?: {
    acceptedTerms?: boolean;
    tosLang?: 'es' | 'en';
    referralCode?: string;
  }) => Promise<void>;
  signup: (
    email: string,
    password: string,
    tosLang?: 'es' | 'en',
    referralCode?: string
  ) => Promise<OtpChallenge>;
  verifyOtp: (challengeId: string, code: string, email: string, lang?: 'es' | 'en') => Promise<void>;
  resendOtp: (challengeId: string, lang?: 'es' | 'en') => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
  patchUser: (patch: Partial<Pick<AuthUser, 'displayName' | 'bio' | 'tags'>>) => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStoredSession();
  const [token, setToken] = useState<string | null>(stored.access);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

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

  const patchUser = useCallback((patch: Partial<Pick<AuthUser, 'displayName' | 'bio' | 'tags'>>) => {
    setUser((current) => (current ? { ...current, ...patch } : current));
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
        displayName: data.displayName ?? null,
        bio: data.bio ?? null,
        hasAvatar: data.hasAvatar === true,
        avatarUpdatedAt: data.avatarUpdatedAt ?? null,
        tags: data.tags ?? [],
        notifications: data.notifications ?? DEFAULT_NOTIFICATION_PREFS,
      });
    } catch {
      logout();
    }
  }, [logout]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const session = await api.refreshSession();
        if (cancelled) return;
        applyAccessToken(session.token);
        await refreshMe();
      } catch {
        if (!cancelled) {
          clearSessionTokens();
          setToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Boot once. refreshMe is stable enough for the first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('auth:logout', handler);
    return () => window.removeEventListener('auth:logout', handler);
  }, [logout]);

  const login = useCallback(async (
    email: string,
    password: string,
    lang: 'es' | 'en' = 'en'
  ) => {
    return api.login(email, password, lang);
  }, []);

  const verifyOtp = useCallback(async (
    challengeId: string,
    code: string,
    _email: string,
    lang: 'es' | 'en' = 'es',
  ) => {
    const res = await api.verifyOtp(challengeId, code, lang);
    applyAccessToken(res.token);
    // The OTP response has no profile. A local stub with hasAvatar=false
    // stayed on screen for the whole session, so header, settings and the
    // own profile hid the photo while the podium (community API) showed it.
    await refreshMe();
  }, [applyAccessToken, refreshMe]);

  const resendOtp = useCallback(async (
    challengeId: string,
    lang: 'es' | 'en' = 'en'
  ) => {
    await api.resendOtp(challengeId, lang);
  }, []);

  const loginWithGoogle = useCallback(async (
    idToken: string,
    extras: {
      acceptedTerms?: boolean;
      tosLang?: 'es' | 'en';
      referralCode?: string;
    } = {}
  ) => {
    const res = await api.loginWithGoogle(idToken, extras);
    applyAccessToken(res.token);
    await refreshMe();
  }, [applyAccessToken, refreshMe]);

  const signup = useCallback(async (
    email: string,
    password: string,
    tosLang: 'es' | 'en' = 'en',
    referralCode = ''
  ) => {
    return api.signup(email, password, tosLang, referralCode);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      token,
      loading,
      login,
      loginWithGoogle,
      signup,
      verifyOtp,
      resendOtp,
      logout,
      refreshMe,
      patchUser,
    }),
    [
      user,
      token,
      loading,
      login,
      loginWithGoogle,
      signup,
      verifyOtp,
      resendOtp,
      logout,
      refreshMe,
      patchUser,
    ]
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
