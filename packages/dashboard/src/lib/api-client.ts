// REST client for the v2 dashboard API.
//
// In dev, VITE_API_BASE_URL is empty/"" so requests go to "/api/v2/..." and
// the Vite proxy in vite.config.ts forwards to the backend. In prod build,
// the same paths are served from the same origin (no proxy needed).
// To point at a remote backend (e.g. for staging UI hitting prod data),
// set VITE_API_BASE_URL to a full origin like "https://grvt-grid.example.com".

import {
  ApiError,
  type BotSummary,
  type Candle,
  type CandleInterval,
  type DailySnapshot,
  type FillRow,
  type FundingRow,
  type GridState,
  type HealthV2,
  type BacktestInput,
  type BacktestResult,
  type OrderRow,
  type PortfolioEquityPoint,
  type PortfolioSummary,
  type RangeUpdatePlan,
  type RealizedSummary,
  type RebateSummary,
  type Roundtrip,
  type Trade,
  type ValidateBotInput,
  type ValidateBotResult,
  type NotificationPrefs,
  type PublicTraderProfile,
  type TraderProfile,
} from './api-types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export const ACCESS_TOKEN_KEY = 'grvt-grid-token';
export const REFRESH_TOKEN_KEY = 'grvt-grid-refresh';

// JWT token set by AuthProvider via setAuthToken(). Stored in a module
// var so the request() helper reads the current value on every call
// without needing React context.
let jwtToken: string | null = null;
let refreshToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;

export function setAuthToken(token: string) { jwtToken = token; }
export function clearAuthToken() {
  jwtToken = null;
  refreshToken = null;
}
export function getAuthToken(): string | null { return jwtToken; }

export function setSessionTokens(access: string, refresh: string) {
  jwtToken = access;
  refreshToken = refresh;
  localStorage.setItem(ACCESS_TOKEN_KEY, access);
  localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
}

export function clearSessionTokens() {
  jwtToken = null;
  refreshToken = null;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

export function loadStoredSession(): { access: string | null; refresh: string | null } {
  const access = localStorage.getItem(ACCESS_TOKEN_KEY);
  const refresh = localStorage.getItem(REFRESH_TOKEN_KEY);
  jwtToken = access;
  refreshToken = refresh;
  return { access, refresh };
}

interface AuthSession {
  token: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  userId: string;
  isAdmin: boolean;
  hasGrvtCreds: boolean;
}

export interface OtpChallenge {
  requiresOtp: true;
  challengeId: string;
  emailHint: string;
  expiresIn: number;
}

async function persistSession(session: AuthSession): Promise<AuthSession> {
  const access = session.accessToken || session.token;
  if (session.refreshToken) {
    setSessionTokens(access, session.refreshToken);
  } else {
    setAuthToken(access);
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
  }
  return { ...session, token: access, accessToken: access };
}

async function tryRefreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const stored = refreshToken || localStorage.getItem(REFRESH_TOKEN_KEY);
  if (!stored) return false;
  refreshInFlight = (async () => {
    try {
      const next = await publicRequest<AuthSession>('/auth/refresh', {
        refreshToken: stored,
      });
      await persistSession(next);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${BASE_URL}/api/v2${path}`;
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');

  if (jwtToken) {
    headers.set('Authorization', `Bearer ${jwtToken}`);
  }

  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (cause) {
    throw new ApiError(0, null, `network error: ${(cause as Error).message}`);
  }

  let payload: unknown = null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    payload = await response.json().catch(() => null);
  }

  if (!response.ok) {
    // On 401, try a single refresh-token rotation before logging out.
    if (response.status === 401 && jwtToken && headers.get('x-retry') !== '1') {
      const refreshed = await tryRefreshSession();
      if (refreshed) {
        const retryHeaders = new Headers(headers);
        retryHeaders.set('Authorization', `Bearer ${jwtToken}`);
        retryHeaders.set('x-retry', '1');
        return request<T>(path, { ...init, headers: retryHeaders });
      }
    }
    if (response.status === 401 && jwtToken) {
      window.dispatchEvent(new Event('auth:logout'));
    }
    const message =
      (payload as { error?: string; message?: string } | null)?.message ??
      (payload as { error?: string } | null)?.error ??
      `HTTP ${response.status}`;
    throw new ApiError(response.status, payload, message);
  }

  return payload as T;
}

// ── Public auth requests (no token needed) ────────────────────────────
async function publicRequest<T>(path: string, body: object): Promise<T> {
  const url = `${BASE_URL}/api/v2${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const msg = (payload as { message?: string; error?: string } | null)?.message
      ?? (payload as { error?: string } | null)?.error
      ?? `HTTP ${response.status}`;
    throw new ApiError(response.status, payload, msg);
  }
  return payload as T;
}

// ── Endpoints ───────────────────────────────────────────────────────────

export const api = {
  getHealth: () => request<HealthV2>('/health'),

  getBots: () => request<{ bots: BotSummary[] }>('/bots'),
  getBot: (id: number) =>
    request<{ bot: BotSummary; publishedId?: number | null; activeCopyCount?: number }>(`/bots/${id}`),
  getGridState: (id: number) => request<GridState>(`/bots/${id}/grid-state`),

  getInstruments: () => request<{ instruments: unknown[] }>('/instruments'),
  getBalance: () => request<{ balance: unknown }>('/balance'),

  getTrades: (id: number, opts: { limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ trades: Trade[] }>(`/bots/${id}/trades${suffix}`);
  },

  getSnapshots: (id: number) =>
    request<{ snapshots: DailySnapshot[] }>(`/bots/${id}/snapshots`),

  getRoundtrips: (id: number) =>
    request<{ roundtrips: Roundtrip[]; count: number; totalProfit: number }>(
      `/bots/${id}/roundtrips`
    ),

  // Real fills from the actively-populated fills_archive table. Source
  // is GRVT fill_history — every fee is what the exchange actually
  // charged or refunded on this account.
  getFills: (id: number, opts: { limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ fills: FillRow[] }>(`/bots/${id}/fills${suffix}`);
  },

  getRebateSummary: (id: number) =>
    request<RebateSummary>(`/bots/${id}/rebate-summary`),

  // H.7: portfolio-level aggregates across all user bots.
  getPortfolioSummary: () =>
    request<PortfolioSummary>('/portfolio-summary'),

  getTraderProfile: () =>
    request<TraderProfile>('/profile'),

  getPublicTrader: (userId: string) =>
    request<PublicTraderProfile>(`/community/traders/${userId}`),

  followTrader: (userId: string) =>
    request<import('./api-types').FollowState>(`/community/traders/${userId}/follow`, { method: 'POST' }),

  unfollowTrader: (userId: string) =>
    request<import('./api-types').FollowState>(`/community/traders/${userId}/follow`, { method: 'DELETE' }),

  setFollowCopy: (userId: string, body: { autoCopy: boolean; investmentUsdt?: number }) =>
    request<import('./api-types').FollowState>(`/community/traders/${userId}/follow`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  searchTraders: (query: string) =>
    request<{ traders: import('./api-types').TraderSearchHit[] }>(
      `/community/search?q=${encodeURIComponent(query)}`,
    ),

  getPortfolioEquityCurve: (days = 90) =>
    request<{ points: PortfolioEquityPoint[] }>(
      `/portfolio-equity-curve?days=${days}`
    ),

  // H.6: pure simulation against historical GRVT candles. The result's
  // equityCurve is already thinned server-side to ~200 points.
  runBacktest: (input: BacktestInput) =>
    request<BacktestResult>('/backtest', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  getRealizedSummary: (id: number) =>
    request<RealizedSummary>(`/bots/${id}/realized-summary`),

  getOrders: (
    id: number,
    opts: { status?: 'all' | 'pending' | 'filled' | 'cancelled' | 'rejected'; limit?: number } = {}
  ) => {
    const qs = new URLSearchParams();
    if (opts.status) qs.set('status', opts.status);
    if (opts.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ orders: OrderRow[]; degraded?: boolean; hint?: string }>(
      `/bots/${id}/orders${suffix}`
    );
  },

  getFunding: (id: number, opts: { limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{
      funding: FundingRow[];
      count: number;
      totalPaymentUsdt: number;
    }>(`/bots/${id}/funding${suffix}`);
  },

  validateBot: (input: ValidateBotInput) =>
    request<ValidateBotResult>('/bots/validate', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Mutations — these touch real money. The wizard "Create" button calls
  // createBot (status='paused'); the user must explicitly start it from
  // the bot detail page after reviewing the bot in the UI.
  createBot: (input: ValidateBotInput) =>
    request<{ id: number; status: 'paused' }>('/bots', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  startBot: (id: number) =>
    request<{ id: number; status: 'running' }>(`/bots/${id}/start`, {
      method: 'POST',
    }),

  pauseBot: (id: number) =>
    request<{ id: number; status: 'paused' }>(`/bots/${id}/pause`, {
      method: 'POST',
    }),

  // Final stop. Cancels every open order AND market-closes the open
  // position with a 0.5% aggressive GTC limit. Bot status flips to
  // 'stopped' — it stays in the DB for history but no longer counts
  // as an active bot. Differs from pauseBot which only cancels orders
  // and leaves the position open for later resume.
  closeBot: (id: number) =>
    request<{ id: number; status: 'stopped'; closedCopies?: number }>(`/bots/${id}/close`, {
      method: 'POST',
    }),

  // Read-only dry-run of a range update. Returns the full plan
  // (orders to cancel, levels to create, ETH to auto-buy with cost
  // estimate, warnings, safety violations) WITHOUT executing anything.
  // The dialog calls this on every input change for live preview.
  previewBotRangeUpdate: (
    id: number,
    body: { lowerPrice: number; upperPrice: number }
  ) =>
    request<{ plan: RangeUpdatePlan }>(`/bots/${id}/range/preview`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Commit a range update. The engine re-runs the same plan-builder
  // server-side, so the user is committing exactly what they saw in
  // preview. Refuses on safety violations; short-circuits on no-op.
  // Atomic: per-bot mutex held for the duration so monitor() cannot
  // race against the mutation.
  updateBotInvestment: (id: number, investmentUsdt: number) =>
    request<{
      id: number;
      investmentUsdt: number;
      quantityPerLevel: number;
      previousInvestment: number;
      resizedLevels: number;
    }>(`/bots/${id}/investment`, {
      method: 'POST',
      body: JSON.stringify({ investmentUsdt }),
    }),

  updateBotRange: (
    id: number,
    body: { lowerPrice: number; upperPrice: number }
  ) =>
    request<{
      id: number;
      lowerPrice: number;
      upperPrice: number;
      numGrids: number;
    }>(`/bots/${id}/range`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateRisk: (
    id: number,
    body: { sl_pct?: number | null; tp_pct?: number | null }
  ) =>
    request<{ id: number; sl_pct?: number | null; tp_pct?: number | null }>(
      `/bots/${id}/risk`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      }
    ),

  updateCompound: (
    id: number,
    body: {
      compound_pct: number;
      compound_threshold_usdt?: number;
      compound_interval_hours?: number;
    }
  ) =>
    request<{ id: number; compound_pct: number }>(`/bots/${id}/compound`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  getCandles: (
    pair: string,
    interval: CandleInterval = 'CI_1_H',
    limit = 500
  ) => {
    const qs = new URLSearchParams({
      pair,
      interval,
      limit: String(limit),
    });
    return request<{ pair: string; interval: string; candles: Candle[] }>(
      `/candles?${qs.toString()}`
    );
  },

  // ── Auth endpoints ──────────────────────────────────────────────

  signup: (
    email: string,
    password: string,
    tosLang: 'es' | 'en' = 'en',
    referralCode = ''
  ) =>
    publicRequest<OtpChallenge>('/auth/signup', {
      email,
      password,
      terms_lang: tosLang,
      referral_code: referralCode,
    }),

  login: (email: string, password: string, lang: 'es' | 'en' = 'en') =>
    publicRequest<OtpChallenge>('/auth/login', { email, password, lang }),

  verifyOtp: (challengeId: string, code: string, lang: 'es' | 'en' = 'es') =>
    publicRequest<AuthSession>('/auth/verify-otp', { challengeId, code, lang })
      .then(persistSession),

  resendOtp: (challengeId: string, lang: 'es' | 'en' = 'en') =>
    publicRequest<{ ok: true; emailHint: string; expiresIn: number }>(
      '/auth/resend-otp',
      { challengeId, lang }
    ),

  loginWithGoogle: (idToken: string, extras: {
    acceptedTerms?: boolean;
    tosLang?: 'es' | 'en';
    referralCode?: string;
  } = {}) =>
    publicRequest<AuthSession>('/auth/google', {
      idToken,
      accepted_terms: extras.acceptedTerms === true,
      terms_lang: extras.tosLang ?? 'en',
      referral_code: extras.referralCode ?? '',
    }).then(persistSession),

  logoutSession: (storedRefresh?: string | null) =>
    publicRequest<{ ok: true }>('/auth/logout', {
      refreshToken: storedRefresh || refreshToken || '',
    }).catch(() => ({ ok: true as const })),

  forgotPassword: (email: string, lang: 'es' | 'en' = 'en') =>
    publicRequest<{ ok: true }>('/auth/forgot-password', { email, lang }),

  resetPassword: (token: string, newPassword: string) =>
    publicRequest<{ ok: true }>('/auth/reset-password', {
      token,
      new_password: newPassword,
    }),

  getMe: () =>
    request<{
      id: string;
      email: string;
      isAdmin: boolean;
      hasGrvtCreds: boolean;
      createdAt: number;
      lastLoginAt: number | null;
      displayName?: string | null;
      bio?: string | null;
      hasAvatar?: boolean;
      avatarUpdatedAt?: number | null;
      tags?: string[];
      notifications?: NotificationPrefs;
    }>('/auth/me'),

  updateNotifications: (body: NotificationPrefs) =>
    request<{ ok: true; notifications: NotificationPrefs }>('/auth/notifications', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  updateProfile: (body: { displayName: string; bio: string; tags?: string[] }) =>
    request<{ ok: true; displayName: string | null; bio: string | null; tags: string[] }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  suggestTag: (name?: string) =>
    request<{ tag: string }>(
      `/auth/tag-suggestion${name ? `?name=${encodeURIComponent(name)}` : ''}`,
    ),

  uploadAvatar: (mimeType: string, data: string) =>
    request<{ ok: true; hasAvatar: true; avatarUpdatedAt: number }>('/auth/avatar', {
      method: 'POST',
      body: JSON.stringify({ mimeType, data }),
    }),

  deleteAvatar: () =>
    request<{ ok: true; hasAvatar: false }>('/auth/avatar', {
      method: 'DELETE',
    }),

  getLeaders: () =>
    request<{ bots: import('./api-types').CommunityBot[] }>('/community/leaders'),

  publishBot: (id: number, title?: string) =>
    request<{ id: number; updated: boolean }>(`/bots/${id}/publish`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  copyLeaderBot: (id: number) =>
    request<{
      bot: import('./api-types').CommunityBot;
      copiesCount: number;
      alreadyCopied: boolean;
      markPrice: number | null;
      rangeAdapted: boolean;
      originalRange: { lower: number; upper: number };
    }>(`/community/bots/${id}/copy`, {
      method: 'POST',
    }),

  getAuthConfig: () =>
    request<{
      googleAuthEnabled: boolean;
      googleClientId: string | null;
    }>('/auth/config'),

  getTos: async () => {
    type TosResponse = {
      version: string;
      text: string;
      texts?: { en: string; es: string };
    };
    try {
      const remote = await request<TosResponse>('/auth/tos');
      // A frontend-only Vercel rewrite can answer this API URL with index.html
      // and HTTP 200. request() then yields null, so validate the shape too.
      if (
        remote &&
        typeof remote.version === 'string' &&
        typeof remote.text === 'string' &&
        (!remote.texts ||
          (typeof remote.texts.en === 'string' && typeof remote.texts.es === 'string'))
      ) {
        return remote;
      }
    } catch {
      // The exact server terms are embedded at build time as a safe fallback.
    }
    return __TORO_SIGNUP_TOS__;
  },

  saveGrvtCredentials: (body: {
    apiKey: string;
    apiSecret: string;
    tradingAddress: string;
    accountId: string;
    // Optional: when empty the server defaults to accountId.
    subAccountId?: string;
  }) =>
    request<{ ok: true }>('/auth/grvt-credentials', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  deleteGrvtCredentials: () =>
    request<{ ok: true }>('/auth/grvt-credentials', {
      method: 'DELETE',
    }),

  // H.5: GRVT sub-accounts. The default credentials live elsewhere
  // (saveGrvtCredentials above); these manage extras with a label.
  listSubAccounts: () =>
    request<Array<{
      id: number;
      label: string;
      isDefault: boolean;
      lastTestOk: boolean | null;
      createdAt: number;
    }>>('/auth/grvt-sub-accounts'),

  createSubAccount: (body: {
    label: string;
    apiKey: string;
    apiSecret: string;
    tradingAddress: string;
    accountId: string;
    // Optional: when empty the server defaults to accountId.
    subAccountId?: string;
    isDefault?: boolean;
  }) =>
    request<{
      id: number;
      label: string;
      isDefault: boolean;
      equity: string | null;
    }>('/auth/grvt-sub-accounts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSubAccount: (
    id: number,
    body: { label?: string; isDefault?: boolean }
  ) =>
    request<{ ok: true }>(`/auth/grvt-sub-accounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteSubAccount: (id: number) =>
    request<{ ok: true }>(`/auth/grvt-sub-accounts/${id}`, {
      method: 'DELETE',
    }),
};
