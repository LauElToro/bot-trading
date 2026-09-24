import { Router, type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { childLogger } from './logger.js';
import { cache } from './cache.js';
import type { GridBotDB } from '../database/db.js';
import type { QueryExecutor, RunResult } from '../database/postgres.js';
import { hashPassword, passwordIssue, verifyPassword, verifyPasswordOrDummy } from '../auth/passwords.js';
import {
  signTokenPair,
  verifyToken,
  verifyRefreshToken,
  hashRefreshToken,
  refreshTtlSeconds,
} from '../auth/jwt.js';
import { encryptCredentialFields } from '../auth/crypto.js';
import {
  sendPasswordResetEmail,
  sendAuthenticationCode,
  sendWelcomeEmail,
  isMailerConfigured,
} from '../mail/mailer.js';
import { verifyGoogleIdToken, isGoogleAuthConfigured } from '../auth/google.js';
import { GRVTClient, type GrvtClientCreds } from '../api/client.js';
import {
  invalidateGrvtClient,
  getGrvtClientForUser,
  getGrvtClientForBot,
} from '../api/grvt-client-factory.js';
import { TEST_OPERATOR_USER_ID, isUserId, parseUserId, type UserId } from '../auth/user-id.js';
import {
  deleteBlob,
  fetchBlobBytes,
  imageContentType,
  uploadAvatar,
} from './blob-store.js';
import {
  getPublishedBot,
  getPublishedBySource,
  listLeaders,
  parseMarkPrice,
  publicName,
  publishStoppedBots,
  recenterRange,
  recordCopy,
  toLeaderCard,
} from './community.js';
import { parseNotificationPatch, prefsFromUserRow } from './notification-prefs.js';
import { livePnlSql } from './live-pnl.js';
import { loadTraderEquityCurve, loadTraderProfile } from './profile-stats.js';
import {
  followUser,
  getFollowState,
  listAutoCopiers,
  listFollowing,
  mirrorLeaderStart,
  notifyFollowers,
  setAutoCopy,
  unfollowUser,
} from './follows.js';
import { mirrorsOn } from './follow-rules.js';
import { fetchUserAccountSlices, loadAccountPerformance } from './account-performance.js';
import { searchTraders } from './trader-search.js';
import {
  collectTags,
  ensureUserTags,
  listUserTags,
  setUserTags,
  suggestUserTag,
  TagTakenError,
} from './profile-tags.js';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: UserId;
  }
}

const log = childLogger('v2-router');

// ─── Types ─────────────────────────────────────────────────────────────
interface RawFill {
  event_time?: string;
  is_buyer?: boolean | number;
  price?: string;
  size?: string;
  fee?: string;
}

interface GrvtClient {
  getInstruments(): Promise<unknown[]>;
  getBalance(): Promise<unknown>;
  getTicker(instrument: string): Promise<unknown>;
  getPosition(instrument: string): Promise<unknown>;
  getOpenOrders(instrument?: string): Promise<unknown[]>;
  getKlines(instrument: string, interval?: string, limit?: number): Promise<unknown[]>;
  getFillHistory(limit: number, instrument?: string, endTimeNs?: string): Promise<RawFill[]>;
}

// Structural type for the engine operations the router needs.
// We don't import GridEngine directly to keep this layer free of cycles.
interface EngineOps {
  createBot(config: {
    userId: UserId;
    pair: string;
    direction: 'long' | 'short';
    leverage: number;
    lowerPrice: number;
    upperPrice: number;
    numGrids: number;
    investmentUSDT: number;
    virtualEnabled?: boolean;
    activeWindowSize?: number;
    // H.5: optional sub-account routing. NULL = use default creds.
    grvtSubAccountId?: number | null;
    copiedFromBotId?: number | null;
  }): Promise<number>;
  startBot(botId: number): Promise<void>;
  pauseBot(botId: number): Promise<void>;
  closeBot(botId: number): Promise<number>;
  updateBotRange(botId: number, lowerPrice: number, upperPrice: number): Promise<void>;
  updateBotInvestment?(
    botId: number,
    investmentUsdt: number,
  ): Promise<{
    investmentUsdt: number;
    quantityPerLevel: number;
    previousInvestment: number;
    resizedLevels: number;
  }>;
  previewBotRangeUpdate(
    botId: number,
    lowerPrice: number,
    upperPrice: number
  ): Promise<unknown>;
  // C.3 + H.5: invalidate the cached GRVT client + refresh the injected
  // client on every running bot. With subAccountId omitted the engine
  // refreshes ALL bots owned by the user (default-creds rotation).
  // With subAccountId provided it only refreshes bots routed through
  // that specific sub-account.
  rebindGrvtClient?(userId: UserId, subAccountId?: number | null): Promise<void>;
}

type BotFieldIssue = {
  field: string;
  code: string;
  mark?: number;
  min?: number;
  max?: number;
  pair?: string;
  direction?: string;
};

function coreBotConfigIssues(input: {
  pair: string;
  lower: number;
  upper: number;
  grids: number;
  investment: number;
  leverage: number;
  virtualEnabled: boolean;
  activeWindowSize: number;
}): BotFieldIssue[] {
  const issues: BotFieldIssue[] = [];
  const maxGrids = input.virtualEnabled ? 500 : 95;
  if (!input.pair) issues.push({ field: 'pair', code: 'pair_required' });
  if (!Number.isFinite(input.lower) || input.lower <= 0) {
    issues.push({ field: 'lower_price', code: 'lower_invalid' });
  }
  if (!Number.isFinite(input.upper) || input.upper <= 0) {
    issues.push({ field: 'upper_price', code: 'upper_invalid' });
  }
  if (
    Number.isFinite(input.lower) &&
    Number.isFinite(input.upper) &&
    input.lower > 0 &&
    input.upper > 0 &&
    input.lower >= input.upper
  ) {
    issues.push({ field: 'lower_price', code: 'lower_gte_upper' });
  }
  if (!Number.isInteger(input.grids) || input.grids < 2 || input.grids > maxGrids) {
    issues.push({ field: 'num_grids', code: 'grids_range', min: 2, max: maxGrids });
  }
  if (input.virtualEnabled) {
    if (!Number.isInteger(input.activeWindowSize) || input.activeWindowSize < 20 || input.activeWindowSize > 80) {
      issues.push({ field: 'active_window_size', code: 'window_range', min: 20, max: 80 });
    }
  }
  if (!Number.isFinite(input.investment) || input.investment <= 0) {
    issues.push({ field: 'investment_usdt', code: 'investment_invalid' });
  }
  if (!Number.isFinite(input.leverage) || input.leverage < 1 || input.leverage > 50) {
    issues.push({ field: 'leverage', code: 'leverage_range', min: 1, max: 50 });
  }
  return issues;
}

export interface V2RouterDeps {
  db: QueryExecutor;
  // Multi-tenant: high-level wrapper for user/credential/terms CRUD.
  gridBotDb: GridBotDB;
  grvtClient: GrvtClient;
  engineOps: EngineOps;
  // Legacy single-tenant API key. Still accepted for backward compat
  // (admin tools, scripts) but new clients should use JWT via /auth.
  apiKey: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────
function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

async function dbAll<T = unknown>(
  db: QueryExecutor,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return db.all(sql, params) as Promise<T[]>;
}

async function dbGet<T = unknown>(
  db: QueryExecutor,
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  return db.get(sql, params) as Promise<T | undefined>;
}

async function dbRun(
  db: QueryExecutor,
  sql: string,
  params: unknown[] = []
): Promise<RunResult> {
  return db.run(sql, params);
}

// ─── Auth middleware ───────────────────────────────────────────────────
// Multi-tenant: prefers JWT in Authorization header. Falls back to
// the legacy X-Api-Key header (first admin UUIDv4) when allowed.
function allowLegacyApiKey(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.ALLOW_LEGACY_API_KEY === '1';
}

function makeAuthMiddleware(apiKey: string, gridBotDb: GridBotDB) {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      const authHeader = req.header('authorization') || '';
      const m = /^Bearer (.+)$/.exec(authHeader);
      if (m) {
        const payload = verifyToken(m[1]!);
        if (payload) {
          const user = await gridBotDb.getUserById(payload.userId);
          if (!user || (user.token_version ?? 1) !== payload.tv) {
            log.warn({ ip: req.ip, path: req.path }, 'rejected v2 request: token version mismatch');
            return res.status(401).json({ error: 'invalid or expired token' });
          }
          req.userId = payload.userId;
          return next();
        }
        log.warn({ ip: req.ip, path: req.path }, 'rejected v2 request: invalid/expired JWT');
        return res.status(401).json({ error: 'invalid or expired token' });
      }

      const provided = req.header('x-api-key');
      if (allowLegacyApiKey() && provided && provided === apiKey) {
        const adminId = await gridBotDb.getFirstAdminUserId?.();
        if (adminId) {
          req.userId = adminId;
          return next();
        }
        if (process.env.NODE_ENV === 'test') {
          req.userId = TEST_OPERATOR_USER_ID;
          return next();
        }
        log.warn({ ip: req.ip, path: req.path }, 'rejected X-Api-Key: no admin user');
        return res.status(401).json({ error: 'unauthorized' });
      }

      log.warn({ ip: req.ip, path: req.path }, 'rejected unauthenticated v2 request');
      return res.status(401).json({
        error: 'unauthorized',
        hint: 'send Authorization: Bearer <jwt>',
      });
    })().catch(next);
  };
}

// Bot ownership guard. Throws (caught by asyncHandler) if the bot
// doesn't exist or belongs to a different user. Returns the bot row
// for downstream use so handlers don't have to re-fetch.
async function requireBotOwnership(
  db: QueryExecutor,
  botId: number,
  userId: UserId
): Promise<{ id: number; user_id: UserId | null; pair: string; status: string }> {
  const row = await dbGet<{ id: number; user_id: UserId | null; pair: string; status: string }>(
    db,
    `SELECT id, user_id, pair, status FROM grid_bots WHERE id = ?`,
    [botId]
  );
  if (!row) {
    const e = new Error('bot not found') as Error & { status?: number };
    e.status = 404;
    throw e;
  }
  if (row.user_id == null || row.user_id !== userId) {
    const e = new Error('forbidden') as Error & { status?: number };
    e.status = 403;
    throw e;
  }
  return row;
}

// Admin guard for /admin/* endpoints. Reads is_admin from users.
function makeAdminGuard(gridBotDb: GridBotDB) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.userId) return res.status(401).json({ error: 'unauthorized' });
    const u = await gridBotDb.getUserById(req.userId);
    if (!u || !u.is_admin) {
      return res.status(403).json({ error: 'admin required' });
    }
    return next();
  };
}

// ─── Error wrapper ─────────────────────────────────────────────────────
// Catches thrown errors and converts them to clean JSON responses.
// Errors with a numeric `status` property (e.g. from requireBotOwnership)
// produce that status code; everything else is a 500.
type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;
function asyncHandler(fn: AsyncHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch((err: Error & { status?: number }) => {
      if (res.headersSent) return next(err);
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      res.status(status).json(
        status === 500
          ? { error: 'internal_error' }
          : { error: err.message || 'request failed' },
      );
    });
  };
}

// ─── Lifecycle error helper ─────────────────────────────────────────────
// Bot lifecycle endpoints (start / pause / close / range) bubble errors
// from the engine — most of them surface as raw text in the dashboard's
// toast. The dominant user-facing case is "GRVT login failed for user N":
// the user's credentials worked at signup but the GRVT API key was later
// rotated/revoked on grvt.io and never re-saved here. Surface that as a
// structured 422 with code `grvt_credentials_invalid` so the dashboard
// can show a friendly message + a button that links to Settings, and
// also flip `grvt_credentials.last_test_ok = 0` so the user sees a
// persistent warning until they re-validate.
function respondLifecycleError(
  res: Response,
  err: unknown,
  defaultErrorCode: string,
  gridBotDb: GridBotDB,
  userId: UserId,
): void {
  const message = err instanceof Error ? err.message : String(err);
  if (/GRVT login failed/i.test(message)) {
    // Mark stale so the dashboard surfaces a warning. Fire-and-forget —
    // a DB blip on this side shouldn't block the response.
    Promise.resolve(
      gridBotDb.markGrvtCredentialsTestResult?.(userId, false, message),
    ).catch((dbErr: unknown) => {
      log.warn(
        { userId, err: dbErr instanceof Error ? dbErr.message : String(dbErr) },
        'failed to mark grvt_credentials.last_test_ok=0',
      );
    });
    res.status(422).json({
      error: 'grvt_credentials_invalid',
      code: 'grvt_credentials_invalid',
    });
    return;
  }
  res.status(500).json({ error: defaultErrorCode });
}

const REFRESH_COOKIE = 'toro_refresh';

function clientIp(req: Request): string | null {
  return req.ip || null;
}

function refreshCookie(token: string, maxAgeSeconds: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${REFRESH_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/v2/auth; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearRefreshCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${REFRESH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/v2/auth; Max-Age=0${secure}`;
}

function readRefreshCookie(req: Request): string {
  const raw = req.header('cookie') ?? '';
  for (const part of raw.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return '';
}

function tokensEqual(provided: string, required: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(required);
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

async function issueSession(
  gridBotDb: GridBotDB,
  res: Response,
  userId: UserId,
  isAdmin: boolean,
  hasGrvtCreds: boolean
) {
  const user = await gridBotDb.getUserById(userId);
  const pair = signTokenPair(userId, user?.token_version ?? 1);
  await gridBotDb.insertRefreshToken({
    user_id: userId,
    token_hash: hashRefreshToken(pair.refreshToken),
    expires_at: Date.now() + refreshTtlSeconds() * 1000,
    family_id: randomUUID(),
  });
  res.setHeader('Set-Cookie', refreshCookie(pair.refreshToken, refreshTtlSeconds()));
  return {
    token: pair.accessToken,
    accessToken: pair.accessToken,
    expiresIn: pair.expiresIn,
    userId,
    isAdmin,
    hasGrvtCreds,
  };
}

// ─── Rate limiters (H-6) ───────────────────────────────────────────────
// Protect auth endpoints from credential-stuffing / brute-force / email-
// bombing. Limits are deliberately generous so a single user fat-fingering
// their password 3 times doesn't get locked out — the goal is to make
// automated abuse uneconomical, not to be a CAPTCHA.
//
// Test environments disable the limit entirely (NODE_ENV=test or
// DISABLE_RATE_LIMIT=1) so the integration tests can hammer endpoints
// without flake. Production behavior is what matters.
function makeAuthLimiter(maxPerWindow: number, windowMs: number) {
  return rateLimit({
    windowMs,
    limit: maxPerWindow,
    standardHeaders: 'draft-7', // RateLimit-* headers per RFC draft
    legacyHeaders: false,
    // Read env vars per-request, not at construction time — tests need
    // to toggle the flag dynamically. In production this is a single
    // boolean check per request, negligible cost.
    skip: () =>
      process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === '1',
    handler: (req, res) => {
      log.warn(
        { ip: req.ip, path: req.path },
        'rate limit exceeded on auth endpoint'
      );
      res.status(429).json({
        error: 'too_many_requests',
        message: 'Too many attempts from this IP. Try again in a few minutes.',
      });
    },
  });
}

// 5 attempts per 15 min — covers normal "I fat-fingered my password 3 times"
// without locking out, but a 1000-password dictionary attack needs ~50 hours.
const LOGIN_LIMITER = makeAuthLimiter(5, 15 * 60 * 1000);
const EMAIL_LOGIN_LIMITER = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === '1',
  keyGenerator: (req) => {
    const email = String((req.body as { email?: unknown } | undefined)?.email ?? '')
      .trim()
      .toLowerCase();
    return `email:${email || 'missing'}`;
  },
  validate: { keyGeneratorIpFallback: false },
  handler: (req, res) => {
    log.warn({ ip: req.ip, path: req.path }, 'rate limit exceeded on auth endpoint');
    res.status(429).json({
      error: 'too_many_requests',
      message: 'Too many attempts from this IP. Try again in a few minutes.',
    });
  },
});
// Signup: 3 per hour. Stops a single IP from spinning up dozens of accounts.
const SIGNUP_LIMITER = makeAuthLimiter(3, 60 * 60 * 1000);
// Password reset: 3 per hour. Stops email-bombing a known address. Stricter
// than login because each call triggers an outbound email + DB write.
const RESET_LIMITER = makeAuthLimiter(3, 60 * 60 * 1000);
// OTP issuance/resend sends email and is intentionally stricter than verification.
const OTP_SEND_LIMITER = makeAuthLimiter(5, 60 * 60 * 1000);
const OTP_VERIFY_LIMITER = makeAuthLimiter(10, 15 * 60 * 1000);

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const REQUIRED_GRVT_REFERRAL_CODE = 'HCAQ5ES';

// ─── The router ────────────────────────────────────────────────────────
export function createV2Router(deps: V2RouterDeps): Router {
  const { db, gridBotDb, grvtClient, engineOps, apiKey } = deps;
  const router = Router();

  const maskEmail = (email: string): string => {
    const [local = '', domain = ''] = email.split('@');
    const visible = local.slice(0, 2);
    return `${visible}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
  };

  function announceBot(
    ownerId: string,
    kind: 'bot_created' | 'bot_started' | 'bot_paused' | 'bot_closed' | 'bot_action',
    botId: number,
    detail?: string,
  ): void {
    void (async () => {
      const bot = await dbGet<{ pair: string; user_id: string | null }>(
        db,
        `SELECT pair, user_id FROM grid_bots WHERE id = ?`,
        [botId],
      );
      const followeeId = bot?.user_id ?? ownerId;
      notifyFollowers(db, followeeId, kind, `bot:${botId}:${kind}:${Date.now()}`, {
        pair: bot?.pair ?? null,
        detail: detail ?? null,
      });
      if (mirrorsOn(kind)) mirrorLeaderStart(db, engineOps, botId);
    })().catch((err) => {
      log.error({ err: (err as Error).message, botId, kind }, 'follow announce failed');
    });
  }

  async function issueEmailOtp(params: {
    userId: UserId;
    email: string;
    purpose: 'signup' | 'login';
    lang: 'es' | 'en';
    req: Request;
  }) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challengeId = randomBytes(24).toString('hex');
    const codeHash = await hashPassword(code);
    const expiresAt = Date.now() + OTP_TTL_MS;
    const ipAddress = clientIp(params.req);
    await gridBotDb.createEmailOtpChallenge({
      id: challengeId,
      user_id: params.userId,
      purpose: params.purpose,
      code_hash: codeHash,
      expires_at: expiresAt,
      ip_address: ipAddress,
    });
    const mailed = await sendAuthenticationCode({
      to: params.email,
      code,
      purpose: params.purpose,
      lang: params.lang,
      expiresInMinutes: OTP_TTL_MINUTES,
    });
    if (!mailed) {
      const error = new Error('email delivery is not configured') as Error & { status?: number };
      error.status = 503;
      throw error;
    }
    return {
      requiresOtp: true as const,
      challengeId,
      emailHint: maskEmail(params.email),
      expiresIn: OTP_TTL_MS / 1000,
    };
  }

  // ─── Public auth endpoints (NO middleware) ──────────────────────
  // Register these BEFORE the auth middleware so signup/login don't
  // require a token. Order matters: anything declared after the
  // router.use() below is protected.

  // Hard-coded TOS shown at signup. Versioned so we can audit which
  // version each user accepted. When you change the text, bump the
  // version string. The dashboard fetches this exact text from the
  // public terms endpoint so the acceptance hash matches what was shown.
  //
  // Bilingual: the dashboard offers an EN/ES toggle. The selected
  // language is sent as `terms_lang` in the signup body and stored as
  // part of `terms_version` (e.g. "2026-05-26-v3-es") so audit logs
  // record exactly which translation the user agreed to. Both
  // translations are legally equivalent for the operator's purposes.
  const SIGNUP_TOS_VERSION = '2026-09-20-v7';
  const SIGNUP_TOS_TEXT_EN = `Terms of Use — please read carefully before creating an account.

1. WHAT THIS SERVICE IS
This is a grid trading platform for the GRVT perpetual futures exchange. By signing up, you authorize the bot to place, modify, and cancel orders on your GRVT sub-account using API credentials you provide.

2. WHAT THIS SERVICE IS NOT
The operator is not a broker, custodian, financial advisor, fiduciary, exchange, or registered investment professional. No part of this service constitutes investment, legal, tax, or financial advice. The operator never holds your funds — your funds stay on your GRVT account at all times.

2A. NO DEPOSITS, CUSTODY, OR MONEY TRANSFERS TO TORO
Toro does not require, request, receive, safeguard, administer, or custody money, cryptocurrency, collateral, or any other asset from you. You must never send funds to Toro, the operator, an employee, a contributor, or any address presented as belonging to Toro. All capital remains deposited directly with GRVT and is subject exclusively to GRVT's custody, solvency, security, withdrawal, settlement, and account rules. Toro is only a software interface that sends trading instructions to GRVT. If anyone asks you to transfer funds to activate Toro, treat the request as fraudulent and contact the operator through an official channel.

3. YOUR RESPONSIBILITY
You alone are responsible for: (a) every trade the bot executes under your account, (b) the configuration you choose (price range, leverage, grid count, investment size, safeguards), (c) the security of your GRVT account and API credentials, (d) any tax reporting on profits or losses, and (e) verifying that automated trading is legal in your jurisdiction.

3A. EXPRESS AUTHORIZATION TO TRADE; NO RESPONSIBILITY FOR TRANSACTIONS
By starting a bot, you expressly instruct and authorize the software to submit, replace, and cancel grid-trading orders on your GRVT sub-account according to the parameters you selected. GRVT — not Toro — receives, validates, matches, rejects, settles, and records every order and transaction. You remain the sole principal to every transaction. The operator does not approve individual trades, determine whether a trade is suitable, supervise your account, or assume responsibility for order execution, fills, prices, slippage, fees, funding, liquidation, rejected orders, partial fills, duplicated instructions, stale information, or any other transaction outcome.

3B. API KEY PERMISSIONS — WITHDRAWAL AND TRANSFER MUST BE DISABLED
You must create a dedicated GRVT API key with only the minimum permissions required for reading account data and trading. DO NOT enable Withdraw, Transfer, or any equivalent fund-movement permission. Toro's grid bot is designed solely for account reads and grid trading; it has no product feature that requests withdrawals or transfers and it does not intentionally use such permissions even if you provide a broader key. A key with unnecessary permissions materially increases the consequences of credential theft, server compromise, exchange changes, or human error. If your key currently has Withdraw or Transfer enabled, you must revoke it and create a trade-only key before connecting it. You accept all risk arising from granting permissions broader than requested.

4. TRADING RISK — YOU CAN LOSE EVERYTHING
Leveraged perpetual futures trading is extremely risky. You can lose up to 100% of the capital you allocate, and on leverage you can lose more than your initial position via liquidation, funding payments, or sudden market moves. The bot does not eliminate this risk — it automates execution of a strategy you choose. No profit is guaranteed, expected, or implied. Past performance of any sample, backtest, or other user's bot is not a predictor of your results.

4A. SPECIFIC RISKS YOU ACCEPT
Without limitation, you accept the risks of leverage and liquidation; one-directional markets in which a grid accumulates a losing position; gaps and extreme volatility; insufficient margin; negative or changing funding; maker/taker fees and rebates; slippage; minimum-order and precision rules; stale, delayed, incorrect, or missing market data; API latency, rate limits, outages, authentication failures, schema changes, and rejected requests; partial, duplicate, out-of-order, or missed fills; synchronization failures between Toro and GRVT; automatic range shifts, compounding, stop-loss, take-profit, and safeguard behavior; browser, server, database, network, DNS, cloud, dependency, or power failures; compromised credentials; smart-contract, oracle, blockchain, custody, and counterparty risk; regulatory or tax changes; and force majeure. Any safeguard may trigger late, fail to trigger, or behave differently under fast markets. A backtest is a simplified historical simulation and cannot reproduce liquidity, latency, slippage, funding, outages, or future conditions.

5. SOFTWARE PROVIDED "AS IS"
The software is provided "as is" and "as available", without warranty of any kind — express, implied, statutory, or otherwise — including any warranty of merchantability, fitness for a particular purpose, accuracy, completeness, non-infringement, or uninterrupted operation. Bugs, mis-configurations, edge cases, race conditions, dependency vulnerabilities, and undocumented behavior may exist and may cause partial or total loss of funds.

6. NO SERVICE LEVEL — DOWNTIME IS EXPECTED
The operator makes no uptime commitment. The service may be paused, degraded, or shut down at any time, with or without notice, for maintenance, cost reasons, legal reasons, exchange outages, infrastructure failure, or no reason at all. During downtime your bots may stop trading, miss fills, fail to react to price moves, or leave open positions un-managed — any of which may cause loss.

6A. NO DUTY TO MONITOR, INTERVENE, OR RESCUE
The operator has no duty to continuously monitor your bots, positions, margin, liquidation price, exchange status, API connectivity, or account security; to contact you before or after an adverse event; to manually close positions; to recover losses; or to keep the service available. You must independently monitor your GRVT account, maintain sufficient margin, keep direct access to GRVT, and be prepared to cancel orders, close positions, or revoke API keys without relying on Toro.

7. THIRD-PARTY DEPENDENCIES
This service depends on: GRVT (exchange, API, matching engine, custody), the underlying blockchain network, internet infrastructure, the cloud provider hosting this server, the operating system, runtime libraries, and email delivery providers. The operator has no control over and accepts no responsibility for any failure, outage, change in terms, downtime, hack, exploit, slippage, or malicious behavior of any of these third parties. Risks include but are not limited to: GRVT outages, GRVT API rate limits or changes, exchange insolvency, smart contract bugs, network congestion, oracle failure, and DNS or TLS provider compromise.

8. DATA HANDLING + ENCRYPTION
The bot stores your email, a bcrypt hash of your password, and your GRVT API credentials encrypted at rest with AES-256-GCM. The master encryption key lives on the server's disk so the bot can decrypt credentials to place orders. THIS MEANS the server operator has technical access to decrypt your credentials, and any party who compromises the server (attacker, employee, hosting provider, law enforcement) may also gain that access. By using this instance you accept this exposure.

9. SECURITY INCIDENTS
In the event of a server compromise, data breach, credential theft, fund loss, or any other security incident — whether caused by an attacker, by a bug, by the operator, by an upstream provider, or by force majeure — you waive any claim against the operator for direct, indirect, incidental, consequential, special, punitive, or exemplary damages, including but not limited to lost funds, lost profits, lost opportunity, missed trades, liquidations, unwanted positions, regulatory fines, or reputational harm. You acknowledge that the operator's only obligation following an incident is to attempt timely notification — there is no compensation, refund, or insurance.

10. LIMITATION OF LIABILITY
To the maximum extent permitted by applicable law, in no event will the operator, contributors, or any affiliated party be liable to you or any third party for any claim, loss, damage, cost, or expense of any kind arising out of or related to your use of this service. This limitation applies regardless of the legal theory of liability (contract, tort, negligence, strict liability, or otherwise), regardless of whether the operator was advised of the possibility of such loss, and even if a remedy is found to have failed of its essential purpose. If any portion of this limitation is held unenforceable, the operator's total aggregate liability to you is capped at USD 1 (one US dollar).

10A. RELEASE, WAIVER OF CLAIMS, AND COVENANT NOT TO SUE
To the maximum extent permitted by applicable law, you knowingly and voluntarily release and forever discharge the operator, owners, employees, contractors, contributors, affiliates, and infrastructure providers from claims arising from or related to trading losses, liquidation, fees, funding, order execution, downtime, bugs, data loss, security incidents, unauthorized access, exchange conduct, or use or inability to use Toro. To that same extent, you waive the right to bring, join, finance, or maintain a lawsuit, collective action, class action, arbitration claim, or other proceeding seeking compensation for those events, and covenant not to sue the released parties. Nothing in these terms excludes liability that applicable law does not permit to be excluded; any non-waivable statutory right remains limited to the minimum remedy required by law.

11. INDEMNIFICATION
You agree to indemnify, defend, and hold harmless the operator and all contributors from any claim, demand, loss, liability, cost, or expense (including reasonable attorney fees) brought by any third party arising out of your use of the service, your violation of these terms, your violation of any law, or your infringement of any third party's rights.

12. NO REVERSAL, NO REFUND
There is no chargeback, refund, or rollback mechanism. Trades executed by the bot are final and settled on GRVT. The operator cannot reverse a trade, unwind a liquidation, recover stolen funds, or restore a lost API key.

12A. FREE ACCESS AND REFERRAL DISCLOSURE
Toro does not charge a subscription or require a payment or deposit for access at this time. Access may require that your GRVT account was created with referral code HCAQ5ES. GRVT may pay the operator referral rewards under GRVT's own program without deducting a separate Toro fee from your account. GRVT alone determines attribution, eligibility, calculation, payment, modification, and cancellation of referral rewards. This commercial relationship does not create a fiduciary duty, guarantee service availability, or make the operator responsible for your transactions.

13. CHANGES TO THESE TERMS
The operator may update these terms at any time. Continued use after an update constitutes acceptance of the new terms. Material changes will be surfaced on next login.

14. TERMINATION
The operator may suspend or terminate your account at any time, with or without cause, with or without notice. You may stop using the service and revoke your GRVT API keys at any time.

15. ACCEPTANCE
By clicking "I have read and accept the terms above" and creating an account, you confirm that you have read, understood, and agree to be bound by every clause above; that you are at least 18 years old and legally able to enter this agreement; that you are using only funds you own and can afford to lose completely; that nobody promised you profits or asked you to deposit money with Toro; that your GRVT account was created with the required HCAQ5ES referral; that your API key does not grant Withdraw or Transfer permission; and that you knowingly accept sole responsibility for every trading and investment risk described above.`;

  const SIGNUP_TOS_TEXT_ES = `Términos de Uso — leé con atención antes de crear una cuenta.

1. QUÉ ES ESTE SERVICIO
Esto es una plataforma de grid trading para la exchange de futuros perpetuos GRVT. Al registrarte, autorizás al bot a colocar, modificar y cancelar órdenes en tu sub-cuenta de GRVT usando las credenciales API que vos provees.

2. QUÉ NO ES ESTE SERVICIO
El operador no es un broker, custodio, asesor financiero, fiduciario, exchange ni profesional registrado en inversiones. Ninguna parte de este servicio constituye asesoramiento de inversión, legal, impositivo o financiero. El operador nunca tiene tus fondos — tus fondos quedan siempre en tu cuenta de GRVT.

2A. TORO NO RECIBE DEPÓSITOS, NO CUSTODIA Y NO TRANSFIERE DINERO
Toro no te exige, solicita, recibe, resguarda, administra ni custodia dinero, criptomonedas, colateral ni ningún otro activo. Nunca debés enviar fondos a Toro, al operador, a empleados, contribuidores ni a una dirección presentada como perteneciente a Toro. Todo el capital permanece depositado directamente en GRVT y queda sujeto exclusivamente a las reglas de custodia, solvencia, seguridad, retiro, liquidación y cuenta de GRVT. Toro es únicamente una interfaz de software que envía instrucciones de trading a GRVT. Si alguien te pide transferir fondos para activar Toro, considerá la solicitud fraudulenta y contactá al operador por un canal oficial.

3. TU RESPONSABILIDAD
Vos sos el único responsable por: (a) cada trade que el bot ejecute en tu cuenta, (b) la configuración que elijas (rango de precios, apalancamiento, cantidad de niveles, tamaño de inversión, safeguards), (c) la seguridad de tu cuenta de GRVT y de tus credenciales API, (d) cualquier reporte impositivo sobre ganancias o pérdidas, y (e) verificar que el trading automatizado sea legal en tu jurisdicción.

3A. AUTORIZACIÓN EXPRESA PARA OPERAR; SIN RESPONSABILIDAD POR TRANSACCIONES
Al iniciar un bot, instruís y autorizás expresamente al software a enviar, reemplazar y cancelar órdenes de grid trading en tu subcuenta GRVT conforme a los parámetros que seleccionaste. GRVT — no Toro — recibe, valida, cruza, rechaza, liquida y registra cada orden y transacción. Vos sos el único principal de cada transacción. El operador no aprueba trades individuales, no determina si un trade es adecuado para vos, no supervisa tu cuenta y no asume responsabilidad por ejecución, fills, precios, slippage, fees, funding, liquidaciones, órdenes rechazadas, fills parciales, instrucciones duplicadas, información desactualizada ni ningún otro resultado transaccional.

3B. PERMISOS DE LA API KEY — WITHDRAW Y TRANSFER DEBEN ESTAR DESACTIVADOS
Debés crear una API key dedicada de GRVT con únicamente los permisos mínimos necesarios para leer datos de cuenta y operar. NO habilites Withdraw, Transfer ni ningún permiso equivalente para mover fondos. El bot grid de Toro está diseñado exclusivamente para lecturas de cuenta y grid trading; no tiene una función de producto que solicite retiros o transferencias y no utiliza intencionalmente esos permisos aunque entregues una clave más amplia. Una clave con permisos innecesarios aumenta sustancialmente las consecuencias de un robo de credenciales, compromiso del servidor, cambio de la exchange o error humano. Si tu clave actual permite Withdraw o Transfer, debés revocarla y crear una clave solo con permiso Trade antes de conectarla. Aceptás todo riesgo derivado de otorgar permisos más amplios que los solicitados.

4. RIESGO DE TRADING — PODÉS PERDER TODO
El trading de futuros perpetuos con apalancamiento es extremadamente riesgoso. Podés perder hasta el 100% del capital que asignes, y con apalancamiento podés perder más que tu posición inicial por liquidación, pagos de funding o movimientos bruscos del mercado. El bot no elimina este riesgo — automatiza la ejecución de una estrategia que vos elegís. No hay ganancia garantizada, esperada ni implícita. La performance pasada de cualquier muestra, backtest o bot de otro usuario no predice tus resultados.

4A. RIESGOS ESPECÍFICOS QUE ACEPTÁS
Sin limitar otros riesgos, aceptás: apalancamiento y liquidación; mercados unidireccionales donde la grilla acumula una posición perdedora; gaps y volatilidad extrema; margen insuficiente; funding negativo o cambiante; fees y rebates maker/taker; slippage; tamaños mínimos y reglas de precisión; datos de mercado desactualizados, demorados, incorrectos o ausentes; latencia, rate limits, caídas, fallas de autenticación, cambios de esquema y rechazos de la API; fills parciales, duplicados, desordenados o perdidos; fallas de sincronización entre Toro y GRVT; funcionamiento de auto-shift, reinversión, stop-loss, take-profit y safeguards; fallas de navegador, servidor, base de datos, red, DNS, cloud, dependencias o energía; credenciales comprometidas; riesgo de smart contracts, oráculos, blockchain, custodia y contraparte; cambios regulatorios o impositivos; y fuerza mayor. Cualquier safeguard puede activarse tarde, no activarse o comportarse distinto en mercados rápidos. Un backtest es una simulación histórica simplificada y no puede reproducir liquidez, latencia, slippage, funding, caídas ni condiciones futuras.

5. SOFTWARE PROVISTO "TAL CUAL"
El software se provee "tal cual" y "según disponibilidad", sin garantía de ningún tipo — expresa, implícita, estatutaria o de cualquier otra forma — incluyendo cualquier garantía de comerciabilidad, idoneidad para un propósito particular, exactitud, integridad, no infracción u operación ininterrumpida. Pueden existir bugs, malas configuraciones, casos límite, race conditions, vulnerabilidades en dependencias y comportamientos no documentados que pueden causar pérdida parcial o total de fondos.

6. SIN NIVEL DE SERVICIO — EL DOWNTIME ES ESPERABLE
El operador no se compromete a ningún uptime. El servicio puede ser pausado, degradado o apagado en cualquier momento, con o sin aviso, por mantenimiento, razones de costo, razones legales, caídas de exchange, fallas de infraestructura o sin motivo. Durante el downtime tus bots pueden dejar de tradear, perder fills, no reaccionar a movimientos de precio o dejar posiciones abiertas sin gestionar — cualquiera de estas situaciones puede causar pérdidas.

6A. SIN DEBER DE MONITOREAR, INTERVENIR O RESCATAR
El operador no tiene obligación de monitorear continuamente tus bots, posiciones, margen, precio de liquidación, estado de la exchange, conectividad API ni seguridad de tu cuenta; de contactarte antes o después de un evento adverso; de cerrar posiciones manualmente; de recuperar pérdidas; ni de mantener disponible el servicio. Debés monitorear tu cuenta GRVT de forma independiente, mantener margen suficiente, conservar acceso directo a GRVT y estar preparado para cancelar órdenes, cerrar posiciones o revocar API keys sin depender de Toro.

7. DEPENDENCIAS DE TERCEROS
Este servicio depende de: GRVT (exchange, API, motor de matching, custodia), la red blockchain subyacente, infraestructura de internet, el proveedor de cloud que aloja este servidor, el sistema operativo, librerías de runtime y proveedores de envío de email. El operador no tiene control y no acepta responsabilidad por ninguna falla, caída, cambio en términos, downtime, hackeo, exploit, slippage o comportamiento malicioso de ninguno de estos terceros. Los riesgos incluyen, sin limitarse a: caídas de GRVT, límites o cambios en su API, insolvencia del exchange, bugs en smart contracts, congestión de red, fallas de oráculos y compromiso del proveedor de DNS o TLS.

8. MANEJO DE DATOS + CIFRADO
El bot guarda tu email, un hash bcrypt de tu contraseña, y tus credenciales API de GRVT cifradas en reposo con AES-256-GCM. La clave maestra de cifrado vive en el disco del servidor para que el bot pueda descifrar las credenciales al colocar órdenes. ESTO SIGNIFICA que el operador del servidor tiene acceso técnico para descifrar tus credenciales, y cualquier parte que comprometa el servidor (atacante, empleado, proveedor de hosting, autoridad gubernamental) también puede obtener ese acceso. Al usar esta instancia aceptás esta exposición.

9. INCIDENTES DE SEGURIDAD
En caso de compromiso del servidor, brecha de datos, robo de credenciales, pérdida de fondos o cualquier otro incidente de seguridad — sea causado por un atacante, por un bug, por el operador, por un proveedor upstream o por fuerza mayor — vos renunciás a cualquier reclamo contra el operador por daños directos, indirectos, incidentales, consecuentes, especiales, punitivos o ejemplares, incluyendo, sin limitarse a, fondos perdidos, ganancias perdidas, oportunidades perdidas, trades perdidos, liquidaciones, posiciones no deseadas, multas regulatorias o daño reputacional. Reconocés que la única obligación del operador tras un incidente es intentar notificar oportunamente — no hay compensación, reembolso ni seguro.

10. LIMITACIÓN DE RESPONSABILIDAD
En la máxima medida permitida por la ley aplicable, en ningún caso el operador, los contribuidores o cualquier parte afiliada serán responsables ante vos o ante cualquier tercero por ningún reclamo, pérdida, daño, costo o gasto de ninguna naturaleza que surja de o se relacione con tu uso de este servicio. Esta limitación aplica sin importar la teoría legal de responsabilidad (contrato, daño extracontractual, negligencia, responsabilidad objetiva u otra), sin importar si el operador fue advertido de la posibilidad de tal pérdida, e incluso si una solución se considera fallida en su propósito esencial. Si alguna parte de esta limitación se considera inaplicable, la responsabilidad total agregada del operador hacia vos queda capeada en USD 1 (un dólar estadounidense).

10A. LIBERACIÓN, RENUNCIA A RECLAMOS Y COMPROMISO DE NO DEMANDAR
En la máxima medida permitida por la ley aplicable, liberás de manera consciente y voluntaria, y mantenés liberados en forma permanente, al operador, propietarios, empleados, contratistas, contribuidores, afiliados y proveedores de infraestructura frente a reclamos que surjan de o se relacionen con pérdidas de trading, liquidaciones, fees, funding, ejecución de órdenes, downtime, bugs, pérdida de datos, incidentes de seguridad, accesos no autorizados, conducta de la exchange o uso o imposibilidad de uso de Toro. En esa misma medida, renunciás al derecho de iniciar, integrar, financiar o mantener una demanda, acción colectiva, acción de clase, reclamo arbitral u otro procedimiento que procure compensación por esos eventos, y te comprometés a no demandar a las partes liberadas. Nada de estos términos excluye una responsabilidad que la ley aplicable no permita excluir; cualquier derecho legal irrenunciable queda limitado al remedio mínimo exigido por ley.

11. INDEMNIZACIÓN
Vos te comprometés a indemnizar, defender y mantener indemne al operador y a todos los contribuidores frente a cualquier reclamo, demanda, pérdida, responsabilidad, costo o gasto (incluyendo honorarios razonables de abogados) iniciado por cualquier tercero como consecuencia de tu uso del servicio, tu violación de estos términos, tu violación de cualquier ley o tu infracción de derechos de terceros.

12. SIN REVERSIÓN, SIN REEMBOLSO
No existe mecanismo de chargeback, reembolso o rollback. Los trades ejecutados por el bot son finales y se liquidan en GRVT. El operador no puede revertir un trade, deshacer una liquidación, recuperar fondos robados ni restaurar una API key perdida.

12A. ACCESO SIN CARGO Y DIVULGACIÓN DEL REFERIDO
Toro actualmente no cobra suscripción ni exige pagos o depósitos para acceder. El acceso puede requerir que tu cuenta GRVT haya sido creada con el código de referido HCAQ5ES. GRVT puede pagar al operador recompensas de referido conforme a su propio programa, sin descontar de tu cuenta una comisión separada de Toro. GRVT decide exclusivamente la atribución, elegibilidad, cálculo, pago, modificación y cancelación de recompensas. Esta relación comercial no crea un deber fiduciario, no garantiza disponibilidad del servicio y no hace al operador responsable por tus transacciones.

13. CAMBIOS EN ESTOS TÉRMINOS
El operador puede actualizar estos términos en cualquier momento. El uso continuado luego de una actualización constituye aceptación de los nuevos términos. Los cambios materiales serán visibles en el próximo login.

14. TERMINACIÓN
El operador puede suspender o terminar tu cuenta en cualquier momento, con o sin causa, con o sin aviso. Vos podés dejar de usar el servicio y revocar tus API keys de GRVT en cualquier momento.

15. ACEPTACIÓN
Al hacer click en "Leí y acepto los términos de arriba" y crear una cuenta, confirmás que leíste, comprendiste y aceptás estar obligado por cada cláusula anterior; que tenés al menos 18 años y capacidad legal para celebrar este acuerdo; que usás únicamente fondos propios que podés permitirte perder por completo; que nadie te prometió ganancias ni te pidió depositar dinero en Toro; que tu cuenta GRVT fue creada con el referido requerido HCAQ5ES; que tu API key no otorga permisos Withdraw ni Transfer; y que aceptás consciente y exclusivamente cada riesgo de trading e inversión descrito arriba.`;

  const SIGNUP_TOS_TEXTS = {
    en: SIGNUP_TOS_TEXT_EN,
    es: SIGNUP_TOS_TEXT_ES,
  } as const;
  type TosLang = keyof typeof SIGNUP_TOS_TEXTS;
  function pickTosLang(raw: unknown): TosLang {
    return String(raw ?? '').toLowerCase() === 'es' ? 'es' : 'en';
  }

  router.post('/auth/signup', SIGNUP_LIMITER, asyncHandler(async (req, res) => {
    if (process.env.SIGNUP_DISABLED === '1') {
      return res.status(403).json({ error: 'signup_disabled' });
    }
    const body = (req.body ?? {}) as {
      email?: unknown;
      password?: unknown;
      terms_lang?: unknown;
      referral_code?: unknown;
    };
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const tosLang = pickTosLang(body.terms_lang);
    const tosText = SIGNUP_TOS_TEXTS[tosLang];
    const referralCode = String(body.referral_code ?? '').trim().toUpperCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'invalid email' });
    }
    const passwordProblem = passwordIssue(password);
    if (passwordProblem === 'too_short') {
      return res.status(400).json({ error: 'password too short (min 8 chars)' });
    }
    if (passwordProblem === 'too_long') {
      return res.status(400).json({ error: 'password too long (max 72 bytes)' });
    }
    if (referralCode !== REQUIRED_GRVT_REFERRAL_CODE) {
      return res.status(400).json({
        error: 'referral_code_required',
        requiredCode: REQUIRED_GRVT_REFERRAL_CODE,
      });
    }
    if (!isMailerConfigured()) {
      return res.status(503).json({ error: 'email_delivery_unavailable' });
    }
    const existing = await gridBotDb.getUserByEmail(email);
    if (existing) {
      const passwordMatches = await verifyPasswordOrDummy(password, existing.password_hash);
      if (existing.email_verified || !passwordMatches) {
        res.json({
          requiresOtp: true,
          challengeId: randomBytes(24).toString('hex'),
          emailHint: maskEmail(email),
          expiresIn: OTP_TTL_MS / 1000,
        });
        return;
      }
      res.json(await issueEmailOtp({
        userId: existing.id,
        email: existing.email,
        purpose: 'signup',
        lang: tosLang,
        req,
      }));
      return;
    }
    const password_hash = await hashPassword(password);
    // SECURITY (H-5): admin status is granted ONLY to the email that
    // matches ADMIN_EMAIL env var. The previous "first user becomes
    // admin" rule had two failure modes:
    //   1. Race — two concurrent signups could both see countUsers() === 0
    //      and both walk away with admin.
    //   2. Hijack — if signups opened before the operator created their
    //      own account, an attacker who learned the URL first would be
    //      promoted to admin.
    // Requiring an explicit email match closes both. If ADMIN_EMAIL is
    // unset, no user is auto-promoted; promotion happens manually via
    // the DB or a future /admin/promote-user endpoint.
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    const isAdmin =
      adminEmail !== undefined && adminEmail !== '' && adminEmail === email;
    const userId = await gridBotDb.createUser({
      email,
      password_hash,
      is_admin: isAdmin,
      email_verified: false,
      accepted_referral_link: true,
    });
    const ipAddress = clientIp(req);
    const userAgent = req.header('user-agent') || null;
    await gridBotDb.insertTermsAcceptance({
      user_id: userId,
      context: 'signup',
      context_ref: null,
      ip_address: ipAddress,
      user_agent: userAgent,
      terms_version: `${SIGNUP_TOS_VERSION}-${tosLang}`,
      terms_text: tosText,
      terms_text_hash: createHash('sha256').update(tosText).digest('hex'),
    });
    log.info({ userId, email, isAdmin }, 'user signed up');
    res.json(await issueEmailOtp({
      userId,
      email,
      purpose: 'signup',
      lang: tosLang,
      req,
    }));
    return;
  }));

  // POST /api/v2/auth/login — public.
  router.post('/auth/login', LOGIN_LIMITER, EMAIL_LOGIN_LIMITER, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as {
      email?: unknown;
      password?: unknown;
      lang?: unknown;
    };
    const email = String(body.email ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    const user = await gridBotDb.getUserByEmail(email);
    const ok = await verifyPasswordOrDummy(password, user?.password_hash);
    if (!user || !ok) {
      return res.status(401).json({ error: 'invalid email or password' });
    }
    if (!isMailerConfigured()) {
      return res.status(503).json({ error: 'email_delivery_unavailable' });
    }
    const lang = body.lang === 'es' ? 'es' : 'en';
    log.info({ userId: user.id, email }, 'login password accepted; OTP issued');
    res.json(await issueEmailOtp({
      userId: user.id,
      email: user.email,
      purpose: user.email_verified ? 'login' : 'signup',
      lang,
      req,
    }));
    return;
  }));

  router.post('/auth/verify-otp', OTP_VERIFY_LIMITER, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { challengeId?: unknown; code?: unknown; lang?: unknown };
    const challengeId = String(body.challengeId ?? '').trim();
    const code = String(body.code ?? '').replace(/\s+/g, '');
    if (!/^[a-f0-9]{48}$/.test(challengeId) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: 'invalid_or_expired_code' });
    }
    const challenge = await gridBotDb.getEmailOtpChallenge(challengeId);
    if (
      !challenge ||
      challenge.consumed_at ||
      challenge.expires_at <= Date.now() ||
      challenge.attempts >= OTP_MAX_ATTEMPTS
    ) {
      return res.status(400).json({ error: 'invalid_or_expired_code' });
    }
    const valid = await verifyPassword(code, challenge.code_hash);
    if (!valid) {
      await gridBotDb.incrementEmailOtpAttempts(challenge.id);
      return res.status(400).json({
        error: 'invalid_or_expired_code',
        attemptsRemaining: Math.max(0, OTP_MAX_ATTEMPTS - challenge.attempts - 1),
      });
    }
    const consumed = await gridBotDb.consumeEmailOtpChallenge(challenge.id);
    if (!consumed) {
      return res.status(400).json({ error: 'invalid_or_expired_code' });
    }
    const user = await gridBotDb.getUserById(challenge.user_id);
    if (!user) {
      return res.status(400).json({ error: 'invalid_or_expired_code' });
    }
    await gridBotDb.markUserEmailVerified(user.id);
    await gridBotDb.updateUserLastLogin(user.id);
    const hasGrvtCreds = await gridBotDb.hasGrvtCredentials(user.id);
    if (challenge.purpose === 'signup') {
      const welcomeLang = body.lang === 'en' ? 'en' : 'es';
      sendWelcomeEmail(user.email, welcomeLang).catch((err) => {
        log.warn({ err, userId: user.id }, 'welcome email failed');
      });
    }
    log.info({ userId: user.id, purpose: challenge.purpose }, 'email OTP verified');
    res.json(await issueSession(gridBotDb, res, user.id, !!user.is_admin, hasGrvtCreds));
    return;
  }));

  router.post('/auth/resend-otp', OTP_SEND_LIMITER, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { challengeId?: unknown; lang?: unknown };
    const challengeId = String(body.challengeId ?? '').trim();
    if (!/^[a-f0-9]{48}$/.test(challengeId)) {
      return res.status(400).json({ error: 'invalid_or_expired_challenge' });
    }
    const challenge = await gridBotDb.getEmailOtpChallenge(challengeId);
    if (!challenge || challenge.consumed_at) {
      return res.status(400).json({ error: 'invalid_or_expired_challenge' });
    }
    const user = await gridBotDb.getUserById(challenge.user_id);
    if (!user) {
      return res.status(400).json({ error: 'invalid_or_expired_challenge' });
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = await hashPassword(code);
    await gridBotDb.rotateEmailOtpChallenge(
      challenge.id,
      codeHash,
      Date.now() + OTP_TTL_MS
    );
    const mailed = await sendAuthenticationCode({
      to: user.email,
      code,
      purpose: challenge.purpose,
      lang: body.lang === 'es' ? 'es' : 'en',
      expiresInMinutes: OTP_TTL_MINUTES,
    });
    if (!mailed) {
      return res.status(503).json({ error: 'email_delivery_unavailable' });
    }
    res.json({
      ok: true,
      emailHint: maskEmail(user.email),
      expiresIn: OTP_TTL_MS / 1000,
    });
    return;
  }));

  // POST /api/v2/auth/google — public. Body: { idToken, accepted_terms?, terms_lang? }
  // Existing users log in. New users require accepted_terms (same TOS
  // gate as email signup) so a login-page click cannot skip the form.
  router.post('/auth/google', LOGIN_LIMITER, asyncHandler(async (req, res) => {
    if (!isGoogleAuthConfigured()) {
      return res.status(503).json({ error: 'google_auth_disabled' });
    }
    const body = (req.body ?? {}) as {
      idToken?: unknown;
      accepted_terms?: unknown;
      terms_lang?: unknown;
      referral_code?: unknown;
    };
    const idToken = String(body.idToken ?? '').trim();
    if (!idToken) {
      return res.status(400).json({ error: 'missing idToken' });
    }
    let identity;
    try {
      identity = await verifyGoogleIdToken(idToken);
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'google token rejected');
      return res.status(401).json({ error: 'invalid google token' });
    }

    let user = await gridBotDb.getUserByGoogleSub(identity.sub);
    if (!user) {
      const byEmail = await gridBotDb.getUserByEmail(identity.email);
      if (byEmail && !byEmail.email_verified) {
        await gridBotDb.deleteUnverifiedUser(byEmail.id);
      } else if (byEmail?.email_verified) {
        await gridBotDb.linkGoogleSub(byEmail.id, identity.sub);
        await gridBotDb.bumpTokenVersion(byEmail.id);
        user = await gridBotDb.getUserById(byEmail.id);
      }
    }

    if (!user) {
      if (process.env.SIGNUP_DISABLED === '1') {
        return res.status(403).json({ error: 'signup_disabled' });
      }
      const accepted = body.accepted_terms === true || body.accepted_terms === 'true';
      if (!accepted) {
        return res.status(409).json({
          error: 'signup_required',
          email: identity.email,
        });
      }
      const referralCode = String(body.referral_code ?? '').trim().toUpperCase();
      if (referralCode !== REQUIRED_GRVT_REFERRAL_CODE) {
        return res.status(400).json({
          error: 'referral_code_required',
          requiredCode: REQUIRED_GRVT_REFERRAL_CODE,
        });
      }
      const tosLang = body.terms_lang === 'es' ? 'es' : 'en';
      const tosText = SIGNUP_TOS_TEXTS[tosLang];
      const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
      const isAdmin =
        adminEmail !== undefined && adminEmail !== '' && adminEmail === identity.email;
      const userId = await gridBotDb.createUser({
        email: identity.email,
        password_hash: '',
        is_admin: isAdmin,
        google_sub: identity.sub,
        email_verified: true,
        accepted_referral_link: true,
      });
      const ipAddress = clientIp(req);
      const userAgent = req.header('user-agent') || null;
      await gridBotDb.insertTermsAcceptance({
        user_id: userId,
        context: 'signup',
        context_ref: null,
        ip_address: ipAddress,
        user_agent: userAgent,
        terms_version: `${SIGNUP_TOS_VERSION}-${tosLang}`,
        terms_text: tosText,
        terms_text_hash: createHash('sha256').update(tosText).digest('hex'),
      });
      log.info({ userId, email: identity.email, isAdmin }, 'user signed up via google');
      sendWelcomeEmail(identity.email, tosLang).catch((err) => {
        log.warn({ err, userId }, 'welcome email failed');
      });
      res.json(await issueSession(gridBotDb, res, userId, isAdmin, false));
      return;
    }

    await gridBotDb.updateUserLastLogin(user.id);
    const hasGrvtCreds = await gridBotDb.hasGrvtCredentials(user.id);
    log.info({ userId: user.id, email: user.email }, 'user logged in via google');
    res.json(await issueSession(gridBotDb, res, user.id, !!user.is_admin, hasGrvtCreds));
    return;
  }));

  // POST /api/v2/auth/refresh — public. Rotates the refresh cookie.
  router.post('/auth/refresh', LOGIN_LIMITER, asyncHandler(async (req, res) => {
    const refreshToken = readRefreshCookie(req);
    const payload = refreshToken ? verifyRefreshToken(refreshToken) : null;
    if (!payload) {
      return res.status(401).json({ error: 'invalid or expired refresh token' });
    }
    const user = await gridBotDb.getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: 'invalid or expired refresh token' });
    }
    const pair = signTokenPair(user.id, user.token_version ?? 1);
    const rotated = await gridBotDb.rotateRefreshToken({
      old_hash: hashRefreshToken(refreshToken),
      new_hash: hashRefreshToken(pair.refreshToken),
      user_id: payload.userId,
      expires_at: Date.now() + refreshTtlSeconds() * 1000,
    });
    if (rotated !== 'ok') {
      res.setHeader('Set-Cookie', clearRefreshCookie());
      return res.status(401).json({ error: 'invalid or expired refresh token' });
    }
    const hasGrvtCreds = await gridBotDb.hasGrvtCredentials(user.id);
    res.setHeader('Set-Cookie', refreshCookie(pair.refreshToken, refreshTtlSeconds()));
    res.json({
      token: pair.accessToken,
      accessToken: pair.accessToken,
      expiresIn: pair.expiresIn,
      userId: user.id,
      isAdmin: !!user.is_admin,
      hasGrvtCreds,
    });
    return;
  }));

  // POST /api/v2/auth/logout — public (best-effort revoke). Accepts
  // refreshToken in the body. Missing/invalid tokens still return 200
  // so the client can always clear local state.
  router.post('/auth/logout', asyncHandler(async (req, res) => {
    const refreshToken = readRefreshCookie(req);
    if (refreshToken) {
      const payload = verifyRefreshToken(refreshToken);
      if (payload) await gridBotDb.bumpTokenVersion(payload.userId);
      else await gridBotDb.revokeRefreshToken(hashRefreshToken(refreshToken));
    }
    res.setHeader('Set-Cookie', clearRefreshCookie());
    res.json({ ok: true });
    return;
  }));

  // GET /api/v2/auth/tos — public, lets the dashboard fetch the
  // current TOS text + version so signup form shows the same string
  // we'll hash on the server side.
  router.get('/auth/tos', (_req, res) => {
    res.json({
      version: SIGNUP_TOS_VERSION,
      // Backwards-compat: old dashboards expecting `text` get EN.
      text: SIGNUP_TOS_TEXTS.en,
      texts: SIGNUP_TOS_TEXTS,
    });
  });

  // Public runtime configuration. OAuth client IDs are public identifiers,
  // not secrets; exposing this lets a separately deployed dashboard enable
  // Google Sign-In without baking the ID into its Vercel build.
  router.get('/auth/config', (_req, res) => {
    const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || null;
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({
      googleAuthEnabled: !!googleClientId,
      googleClientId,
    });
  });

  // Public avatar proxy. Objects live on local disk, or on private Vercel Blob.
  // `:version` is only a cache key (avatarUpdatedAt). The bytes always come
  // from the user's current object, so an old query-string URL and the bare
  // podium URL stay interchangeable.
  const sendCommunityAvatar = asyncHandler(async (req, res) => {
    const userId = String(req.params.userId ?? '').trim();
    if (!isUserId(userId)) return res.status(404).end();
    const user = await gridBotDb.getUserById(userId);
    if (!user?.avatar_url) return res.status(404).end();
    const blob = await fetchBlobBytes(user.avatar_url);
    if (!blob) return res.status(404).end();
    const contentType = imageContentType(blob.contentType, blob.body);
    if (!contentType.startsWith('image/')) return res.status(404).end();
    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(blob.body);
    return;
  });
  router.get('/community/avatar/:userId', sendCommunityAvatar);
  router.get('/community/avatar/:userId/:version', sendCommunityAvatar);

  // E.9 — Password reset.
  //
  // Two endpoints, both PUBLIC (must work without a JWT):
  //   POST /auth/forgot-password   { email }                -> always 200
  //   POST /auth/reset-password    { token, new_password }  -> 200 / 400
  //
  // forgot-password never reveals whether the email exists (no enum).
  // We always answer with `{ ok: true, mailed: bool }`. `mailed` is true
  // only when SMTP is configured AND the email matched a user — but the
  // distinction between "no user" and "user but smtp off" is not exposed
  // to attackers because we always check `mailed === true` server-side
  // only.
  //
  // Token storage: SHA-256 hashed in DB, raw value sent by email. 1h TTL,
  // single-use, and any new request invalidates previous open tokens.
  const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
  const RESET_TOKEN_TTL_MIN = 60;

  router.post('/auth/forgot-password', RESET_LIMITER, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { email?: unknown; lang?: unknown };
    const email = String(body.email ?? '').trim().toLowerCase();
    // Cheap shape check — do not bail with detailed error since that
    // would be an enumeration channel. Just respond 200.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.json({ ok: true });
      return;
    }
    const user = await gridBotDb.getUserByEmail(email);
    if (!user) {
      // Don't reveal that the email is unknown.
      log.info({ email }, 'forgot-password requested for unknown email');
      res.json({ ok: true });
      return;
    }
    // Invalidate any previous open token so only the latest is valid.
    await gridBotDb.invalidateOpenPasswordResetTokensForUser(user.id);
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
    const ipAddress = clientIp(req);
    // SECURITY: never derive the reset URL from the request's Host header.
    // An attacker can spoof Host and trick the email link into pointing at
    // their server, leaking the raw token when the victim clicks. Require
    // APP_BASE_URL to be explicitly configured by the operator.
    const baseUrl = process.env.APP_BASE_URL?.trim().replace(/\/$/, '');
    if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
      log.error(
        { userId: user.id, hasAppBaseUrl: !!process.env.APP_BASE_URL },
        'password reset requested but APP_BASE_URL is not configured (or invalid). Refusing to derive from Host header.'
      );
      // Stay enumeration-safe — same 200 the unknown-email path returns.
      res.json({ ok: true });
      return;
    }
    await gridBotDb.insertPasswordResetToken({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      ip_address: ipAddress,
    });
    const resetUrl = `${baseUrl}/dashboard/reset-password`;
    try {
      await sendPasswordResetEmail({
        to: user.email,
        resetUrl,
        resetCode: rawToken,
        expiresInMinutes: RESET_TOKEN_TTL_MIN,
        lang: body.lang === 'es' ? 'es' : 'en',
      });
    } catch (err) {
      // Don't fail the request — user already sees a generic OK and
      // the token row is in the DB. Log with the URL so an admin can
      // recover by hand if the SMTP transport is broken.
      log.error({ err, userId: user.id }, 'password reset email failed');
    }
    log.info({ userId: user.id, mailerConfigured: isMailerConfigured() }, 'password reset issued');
    res.json({ ok: true });
    return;
  }));

  router.post('/auth/reset-password', RESET_LIMITER, asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as { token?: unknown; new_password?: unknown };
    const token = String(body.token ?? '').trim();
    const newPassword = String(body.new_password ?? '');
    if (!token || token.length < 32) {
      return res.status(400).json({ error: 'invalid token' });
    }
    const passwordProblem = passwordIssue(newPassword);
    if (passwordProblem === 'too_short') {
      return res.status(400).json({ error: 'password too short (min 8 chars)' });
    }
    if (passwordProblem === 'too_long') {
      return res.status(400).json({ error: 'password too long (max 72 bytes)' });
    }
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const row = await gridBotDb.findValidPasswordResetToken(tokenHash);
    if (!row) {
      return res.status(400).json({ error: 'token expired or already used' });
    }
    const password_hash = await hashPassword(newPassword);
    await gridBotDb.updateUserPassword(row.user_id, password_hash);
    // Mark this token used AND invalidate any other open tokens for the
    // same user (defense-in-depth — only one reset per request).
    await gridBotDb.markPasswordResetTokenUsed(row.id);
    await gridBotDb.invalidateOpenPasswordResetTokensForUser(row.user_id);
    log.info({ userId: row.user_id }, 'password reset completed');
    res.json({ ok: true });
    return;
  }));

  router.get('/metrics', (req: Request, res: Response, next: NextFunction) => {
    const required = process.env.METRICS_TOKEN?.trim() ?? '';
    const header = req.header('authorization') || '';
    const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1] ?? '';
    if (required.length >= 32 && tokensEqual(bearer, required)) return next();
    log.warn({ ip: req.ip, path: req.path }, 'rejected /metrics request');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }, asyncHandler(async (_req, res) => {
    const bots = await dbAll<{
      id: number; status: string; pair: string;
      investment_usdt: number; total_pnl_usdt: number;
      grid_profit_usdt: number; trend_pnl_usdt: number;
      position_size: number;
    }>(db, `SELECT id, status, pair, investment_usdt, total_pnl_usdt,
            grid_profit_usdt, trend_pnl_usdt, position_size FROM grid_bots`);

    const fillCount = await dbGet<{ c: number }>(
      db, `SELECT COUNT(*) as c FROM fills_archive`
    );

    const lines: string[] = [
      '# HELP grvt_bot_count Number of bots by status',
      '# TYPE grvt_bot_count gauge',
    ];

    const statusCounts: Record<string, number> = {};
    for (const b of bots) {
      statusCounts[b.status] = (statusCounts[b.status] ?? 0) + 1;
    }
    for (const [status, count] of Object.entries(statusCounts)) {
      lines.push(`grvt_bot_count{status="${status}"} ${count}`);
    }

    lines.push(
      '# HELP grvt_bot_equity_usdt Bot equity in USDT',
      '# TYPE grvt_bot_equity_usdt gauge',
      '# HELP grvt_bot_realized_usdt Realized grid profit',
      '# TYPE grvt_bot_realized_usdt gauge',
      '# HELP grvt_bot_unrealized_usdt Unrealized PnL',
      '# TYPE grvt_bot_unrealized_usdt gauge',
      '# HELP grvt_bot_position_size Current position size',
      '# TYPE grvt_bot_position_size gauge',
    );

    for (const b of bots) {
      const labels = `bot_id="${b.id}",pair="${b.pair}"`;
      const equity = b.investment_usdt + b.total_pnl_usdt;
      lines.push(`grvt_bot_equity_usdt{${labels}} ${equity.toFixed(2)}`);
      lines.push(`grvt_bot_realized_usdt{${labels}} ${b.grid_profit_usdt.toFixed(2)}`);
      lines.push(`grvt_bot_unrealized_usdt{${labels}} ${b.trend_pnl_usdt.toFixed(2)}`);
      lines.push(`grvt_bot_position_size{${labels}} ${b.position_size}`);
    }

    lines.push(
      '# HELP grvt_fills_total Total fills archived',
      '# TYPE grvt_fills_total counter',
      `grvt_fills_total ${fillCount?.c ?? 0}`,
      '# HELP grvt_process_uptime_seconds Process uptime',
      '# TYPE grvt_process_uptime_seconds gauge',
      `grvt_process_uptime_seconds ${Math.floor(process.uptime())}`,
      '# HELP grvt_process_memory_rss_bytes Resident set size',
      '# TYPE grvt_process_memory_rss_bytes gauge',
      `grvt_process_memory_rss_bytes ${process.memoryUsage().rss}`,
      '# HELP grvt_process_memory_heap_bytes Heap used',
      '# TYPE grvt_process_memory_heap_bytes gauge',
      `grvt_process_memory_heap_bytes ${process.memoryUsage().heapUsed}`,
    );

    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(lines.join('\n') + '\n');
    return;
  }));

  // ─── Protected endpoints below this line ───────────────────────
  // All endpoints below require either Bearer JWT (preferred) or
  // legacy X-Api-Key header (admin/scripts).
  router.use(makeAuthMiddleware(apiKey, gridBotDb));

  // ── GET /api/v2/auth/me ────────────────────────────────────────
  // Returns the authenticated user's profile + whether they have
  // GRVT credentials configured (so the dashboard can decide if it
  // should redirect to onboarding).
  router.get('/auth/me', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const user = await gridBotDb.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const hasGrvtCreds = await gridBotDb.hasGrvtCredentials(userId);
    const tags = await ensureUserTags(db, userId);
    res.json({
      id: user.id,
      email: user.email,
      isAdmin: !!user.is_admin,
      hasGrvtCreds,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      displayName: user.display_name ?? null,
      bio: user.bio ?? null,
      hasAvatar: Boolean(user.avatar_url),
      avatarUpdatedAt: user.avatar_updated_at ?? null,
      tags,
      notifications: prefsFromUserRow(user),
    });
    return;
  }));

  router.get('/profile', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const [profile, account, user, tags] = await Promise.all([
      loadTraderProfile(db, userId),
      loadAccountPerformance(db, userId, () => fetchUserAccountSlices(userId, gridBotDb)),
      gridBotDb.getUserById(userId),
      ensureUserTags(db, userId),
    ]);
    const following = await listFollowing(db, userId);
    res.json({
      ...profile,
      account,
      displayName: user?.display_name ?? null,
      bio: user?.bio?.trim() || null,
      tags,
      following,
    });
    return;
  }));

  router.patch('/auth/notifications', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const prefs = parseNotificationPatch(req.body);
    await gridBotDb.updateUserNotificationPrefs(userId, prefs);
    res.json({ ok: true, notifications: prefs });
    return;
  }));

  router.get('/auth/tag-suggestion', asyncHandler(async (req, res) => {
    const name = String(req.query.name ?? '').trim().slice(0, 40);
    res.json({ tag: await suggestUserTag(db, name) });
    return;
  }));

  router.patch('/auth/profile', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as { displayName?: unknown; bio?: unknown; tags?: unknown };
    const displayName = String(body.displayName ?? '').trim().slice(0, 40);
    const bio = String(body.bio ?? '').trim().slice(0, 160);
    if (displayName && !/^[\p{L}\p{N} ._\-]+$/u.test(displayName)) {
      return res.status(400).json({ error: 'display name has invalid characters' });
    }
    let requested: string[] | undefined;
    if (body.tags !== undefined) {
      const parsed = collectTags(body.tags);
      if ('error' in parsed) {
        return res.status(400).json({ error: parsed.error === 'too_many' ? 'too_many_tags' : 'invalid_tag' });
      }
      requested = parsed.tags;
    }
    // Name and bio commit on their own. A taken tag must not roll them back,
    // or the public profile keeps the email and an empty bio.
    await gridBotDb.updateUserProfile(userId, {
      display_name: displayName || null,
      bio: bio || null,
    });
    let tags: string[];
    try {
      const next = requested ?? await listUserTags(db, userId);
      tags = await setUserTags(db, userId, next);
    } catch (error) {
      if (error instanceof TagTakenError) {
        const user = await gridBotDb.getUserById(userId);
        return res.status(409).json({
          error: 'tag_taken',
          tag: error.tag,
          handle: error.handle,
          displayName: user?.display_name ?? null,
          bio: user?.bio ?? null,
        });
      }
      throw error;
    }
    const user = await gridBotDb.getUserById(userId);
    res.json({
      ok: true,
      displayName: user?.display_name ?? null,
      bio: user?.bio ?? null,
      tags,
    });
    return;
  }));

  router.post('/auth/avatar', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as { mimeType?: unknown; data?: unknown };
    const mimeType = String(body.mimeType ?? '').trim().toLowerCase();
    const data = String(body.data ?? '').replace(/^data:[^;]+;base64,/, '');
    if (!data) return res.status(400).json({ error: 'image data is required' });
    let bytes: Buffer;
    try {
      bytes = Buffer.from(data, 'base64');
    } catch {
      return res.status(400).json({ error: 'invalid image data' });
    }
    const current = await gridBotDb.getUserById(userId);
    const uploaded = await uploadAvatar(userId, mimeType, bytes);
    await gridBotDb.updateUserAvatar(userId, {
      avatar_url: uploaded.url,
      avatar_pathname: uploaded.pathname,
    });
    if (current?.avatar_url && current.avatar_url !== uploaded.url) {
      void deleteBlob(current.avatar_url);
    }
    res.json({
      ok: true,
      hasAvatar: true,
      avatarUpdatedAt: Date.now(),
    });
    return;
  }));

  router.delete('/auth/avatar', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const current = await gridBotDb.getUserById(userId);
    await gridBotDb.updateUserAvatar(userId, { avatar_url: null, avatar_pathname: null });
    if (current?.avatar_url) void deleteBlob(current.avatar_url);
    res.json({ ok: true, hasAvatar: false });
    return;
  }));

  // ── POST /api/v2/auth/grvt-credentials ─────────────────────────
  // Save (or update) the user's GRVT credentials. Encrypts each
  // field with AES-256-GCM before persisting.
  //
  // C.2: before saving, the credentials are verified against the real
  // GRVT API with a transient client: login() + getBalance(). Only on
  // success the row is written with last_test_ok=1. On failure the
  // row is NOT saved — the user sees the exact GRVT error instead of
  // the previous "save now, fail later with cryptic message at bot
  // creation" flow.
  router.post('/auth/grvt-credentials', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as {
      apiKey?: unknown;
      apiSecret?: unknown;
      tradingAddress?: unknown;
      accountId?: unknown;
      subAccountId?: unknown;
    };
    const apiKey = String(body.apiKey ?? '').trim();
    const apiSecret = String(body.apiSecret ?? '').trim();
    const tradingAddress = String(body.tradingAddress ?? '').trim();
    const accountId = String(body.accountId ?? '').trim();
    // Sub-account is optional in the UI: when omitted, default to the
    // account id. Most GRVT users only have one sub-account whose id
    // equals the account id, so this removes a confusing field for
    // 90%+ of signups while still letting power users target a
    // specific sub-account when they have several.
    const subAccountId = String(body.subAccountId ?? '').trim() || accountId;

    const errors: string[] = [];
    if (!apiKey) errors.push('apiKey is required');
    if (!apiSecret) errors.push('apiSecret is required');
    if (!/^0x[0-9a-fA-F]{64}$/.test(apiSecret)) {
      errors.push('apiSecret must be a 0x-prefixed 32-byte hex string');
    }
    if (!tradingAddress || !/^0x[0-9a-fA-F]{40}$/.test(tradingAddress)) {
      errors.push('tradingAddress must be a 0x-prefixed Ethereum address');
    }
    if (!accountId) errors.push('accountId is required');
    if (errors.length > 0) {
      return res.status(400).json({ error: 'validation_failed', errors });
    }

    // C.2: verify credentials against GRVT before persisting.
    const plainCreds: GrvtClientCreds = {
      apiKey,
      apiSecret,
      tradingAddress,
      accountId,
      subAccountId,
    };
    let testEquity: string | null = null;
    try {
      const testClient = new GRVTClient(plainCreds);
      const loggedIn = await testClient.login();
      if (!loggedIn) {
        log.warn({ userId }, 'GRVT credential test: login returned false');
        return res.status(400).json({
          error: 'credential_test_failed',
          stage: 'login',
        });
      }
      // Authenticated round-trip — validates accountId/subAccountId too.
      const balance = await testClient.getBalance();
      testEquity = balance.total_equity ?? null;
      log.info({ userId, equity: testEquity }, 'GRVT credential test: ok');
    } catch (testErr) {
      const msg = (testErr as Error).message || 'unknown error';
      log.warn({ userId, err: msg }, 'GRVT credential test: failed');
      return res.status(400).json({
        error: 'credential_test_failed',
        stage: 'account_summary',
      });
    }

    try {
      const encrypted = encryptCredentialFields({
        apiKey,
        apiSecret,
        tradingAddress,
        accountId,
        subAccountId,
      });
      await gridBotDb.upsertGrvtCredentials({
        user_id: userId,
        ...encrypted,
        last_test_ok: true,
        last_test_error: null,
      });
      // If the user is rotating keys, the factory cache holds a stale
      // client bound to the old creds. Drop it so subsequent requests
      // pick up the new ones. Also rebind the client on any running
      // bots owned by this user so their next tick authenticates
      // with the fresh keys instead of a stale cookie session.
      invalidateGrvtClient(userId);
      if (engineOps.rebindGrvtClient) {
        try {
          await engineOps.rebindGrvtClient(userId);
        } catch (rebindErr) {
          log.warn(
            { userId, err: (rebindErr as Error).message },
            'rebindGrvtClient failed after credential save; running bots will use stale client until next restart'
          );
        }
      }
      log.info({ userId }, 'GRVT credentials saved (tested ok)');
      res.json({ ok: true, equity: testEquity });
    } catch (err) {
      log.error({ userId, err: (err as Error).message }, 'failed to save GRVT credentials');
      res.status(500).json({ error: 'save_failed' });
    }
    return;
  }));

  // ── DELETE /api/v2/auth/grvt-credentials ───────────────────────
  // Refuses if the user has running or paused bots — they must be
  // closed first to avoid orphaning bots without credentials.
  router.delete('/auth/grvt-credentials', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const active = await gridBotDb.countActiveBotsForUser(userId);
    if (active > 0) {
      return res.status(409).json({
        error: 'has_active_bots',
        message: `Close all ${active} active bots before disconnecting GRVT credentials`,
      });
    }
    await gridBotDb.deleteGrvtCredentials(userId);
    log.info({ userId }, 'GRVT credentials deleted');
    res.json({ ok: true });
    return;
  }));

  // ─── H.5: GRVT sub-accounts ───────────────────────────────────────
  // Power users can connect multiple GRVT sub-accounts (one row each in
  // grvt_sub_accounts) so different bots run isolated risk-wise. The
  // existing `/auth/grvt-credentials` flow handles their default; these
  // routes manage the extras.

  // ── GET /api/v2/auth/grvt-sub-accounts ────────────────────────────
  // List the user's sub-accounts. NEVER returns encrypted blobs — only
  // metadata safe to render in the dashboard.
  router.get('/auth/grvt-sub-accounts', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const rows = await gridBotDb.listGrvtSubAccounts(userId);
    res.json(
      rows.map((r) => ({
        id: r.id,
        label: r.label,
        isDefault: !!r.is_default,
        lastTestOk: r.last_test_ok == null ? null : !!r.last_test_ok,
        createdAt: r.created_at,
      }))
    );
    return;
  }));

  // ── POST /api/v2/auth/grvt-sub-accounts ───────────────────────────
  // Add a new sub-account for the authenticated user. Same validation
  // and live login+balance test as the default-credentials flow above
  // (lines 549-596) — we never persist credentials that GRVT itself
  // refuses, so users hit the real error in the UI immediately instead
  // of a confusing failure at first bot creation.
  router.post('/auth/grvt-sub-accounts', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const body = (req.body ?? {}) as {
      label?: unknown;
      apiKey?: unknown;
      apiSecret?: unknown;
      tradingAddress?: unknown;
      accountId?: unknown;
      subAccountId?: unknown;
      isDefault?: unknown;
    };
    const label = String(body.label ?? '').trim();
    const apiKey = String(body.apiKey ?? '').trim();
    const apiSecret = String(body.apiSecret ?? '').trim();
    const tradingAddress = String(body.tradingAddress ?? '').trim();
    const accountId = String(body.accountId ?? '').trim();
    // Sub-account optional — defaults to accountId. See note in the
    // default-credentials endpoint above for rationale.
    const subAccountId = String(body.subAccountId ?? '').trim() || accountId;
    const isDefault = body.isDefault === true;

    const errors: string[] = [];
    if (!label || label.length > 64) errors.push('label is required (max 64 chars)');
    if (!apiKey) errors.push('apiKey is required');
    if (!apiSecret) errors.push('apiSecret is required');
    if (!/^0x[0-9a-fA-F]{64}$/.test(apiSecret)) {
      errors.push('apiSecret must be a 0x-prefixed 32-byte hex string');
    }
    if (!tradingAddress || !/^0x[0-9a-fA-F]{40}$/.test(tradingAddress)) {
      errors.push('tradingAddress must be a 0x-prefixed Ethereum address');
    }
    if (!accountId) errors.push('accountId is required');
    if (errors.length > 0) {
      return res.status(400).json({ error: 'validation_failed', errors });
    }

    // Live test: the same login + getBalance round trip the default
    // creds endpoint does. Only persist on success.
    const plainCreds: GrvtClientCreds = {
      apiKey, apiSecret, tradingAddress, accountId, subAccountId,
    };
    let testEquity: string | null = null;
    try {
      const testClient = new GRVTClient(plainCreds);
      const loggedIn = await testClient.login();
      if (!loggedIn) {
        return res.status(400).json({
          error: 'credential_test_failed',
          stage: 'login',
        });
      }
      const balance = await testClient.getBalance() as { total_equity?: string };
      testEquity = balance.total_equity ?? null;
    } catch (testErr) {
      const msg = (testErr as Error).message || 'unknown error';
      log.warn({ userId, err: msg }, 'GRVT sub-account credential test failed');
      return res.status(400).json({
        error: 'credential_test_failed',
        stage: 'account_summary',
      });
    }

    try {
      const encrypted = encryptCredentialFields({
        apiKey, apiSecret, tradingAddress, accountId, subAccountId,
      });
      const id = await gridBotDb.createGrvtSubAccount({
        user_id: userId,
        label,
        ...encrypted,
        is_default: isDefault,
        last_test_ok: true,
      });
      log.info({ userId, subAccountRowId: id, label }, 'GRVT sub-account created');
      res.status(201).json({ id, label, isDefault, equity: testEquity });
    } catch (err) {
      log.error(
        { userId, err: (err as Error).message },
        'failed to save GRVT sub-account'
      );
      res.status(500).json({ error: 'save_failed' });
    }
    return;
  }));

  // ── PATCH /api/v2/auth/grvt-sub-accounts/:id ──────────────────────
  // Edit the label or flip the default flag. Credential rotation is
  // intentionally out of scope here — to rotate keys, delete + recreate
  // (this avoids needing another live login test in the PATCH path).
  router.patch('/auth/grvt-sub-accounts/:id', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const sub = await gridBotDb.getGrvtSubAccountRaw(id);
    if (!sub || sub.user_id !== userId) {
      return res.status(404).json({ error: 'not_found' });
    }
    const body = (req.body ?? {}) as { label?: unknown; isDefault?: unknown };
    const patch: { label?: string; is_default?: boolean } = {};
    if (body.label !== undefined) {
      const label = String(body.label ?? '').trim();
      if (!label || label.length > 64) {
        return res.status(400).json({ error: 'invalid_label' });
      }
      patch.label = label;
    }
    if (body.isDefault !== undefined) {
      patch.is_default = body.isDefault === true;
    }
    if (patch.label === undefined && patch.is_default === undefined) {
      return res.status(400).json({ error: 'nothing_to_update' });
    }
    await gridBotDb.updateGrvtSubAccountMeta(id, userId, patch);
    log.info({ userId, subAccountRowId: id, patch }, 'GRVT sub-account updated');
    res.json({ ok: true });
    return;
  }));

  // ── DELETE /api/v2/auth/grvt-sub-accounts/:id ─────────────────────
  // Refuses while any bot still references this sub-account. Forces the
  // user to either move bots or close them before tearing the creds
  // away — same protection the default-creds DELETE has.
  router.delete('/auth/grvt-sub-accounts/:id', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid id' });
    const sub = await gridBotDb.getGrvtSubAccountRaw(id);
    if (!sub || sub.user_id !== userId) {
      return res.status(404).json({ error: 'not_found' });
    }
    const usedBy = await gridBotDb.countBotsUsingSubAccount(id);
    if (usedBy > 0) {
      return res.status(409).json({
        error: 'has_active_bots',
        message: `${usedBy} bot(s) still use this sub-account. Close or reassign them first.`,
      });
    }
    await gridBotDb.deleteGrvtSubAccount(id, userId);
    invalidateGrvtClient(userId, id);
    log.info({ userId, subAccountRowId: id }, 'GRVT sub-account deleted');
    res.json({ ok: true });
    return;
  }));

  // ── GET /api/v2/bots ──────────────────────────────────────────────
  // List all bots with the fields the dashboard cares about.
  router.get('/bots', asyncHandler(async (req, res) => {
    // Multi-tenant: list only the bots owned by this user. NULL
    // user_id rows are unowned and stay hidden.
    const userId = req.userId!;
    const rows = await dbAll(db, `
      SELECT id, pair, direction, leverage, lower_price, upper_price, num_grids,
             investment_usdt, grid_profit_usdt, trend_pnl_usdt, total_pnl_usdt,
             status, position_size, avg_entry_price, liquidation_price,
             created_at, updated_at,
             compound_pct, compound_threshold_usdt, compound_interval_hours,
             last_compound_at, total_reinvested, original_investment_usdt,
             quantity_per_level,
             safeguard_enabled, safeguard_threshold_pct, safeguard_action,
             grvt_sub_account_id
      FROM grid_bots
      WHERE user_id = ?
      ORDER BY created_at DESC
    `, [userId]);
    res.json({ bots: rows });
    return;
  }));

  // ── GET /api/v2/bots/:id ──────────────────────────────────────────
  router.get('/bots/:id', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    const bot = await dbGet(db, `SELECT * FROM grid_bots WHERE id = ?`, [id]);
    if (!bot) return res.status(404).json({ error: 'bot not found' });
    const published = await getPublishedBySource(db, req.userId!, id);
    const activeCopies = await dbGet<{ c: number }>(
      db,
      `SELECT COUNT(*) as c FROM grid_bots
       WHERE copied_from_bot_id = ?
         AND status IN ('running', 'paused')`,
      [id],
    );
    res.json({
      bot,
      publishedId: published?.id ?? null,
      activeCopyCount: activeCopies?.c ?? 0,
    });
    return;
  }));

  router.get('/community/leaders', asyncHandler(async (_req, res) => {
    const rows = await listLeaders(db, 40);
    res.json({ bots: rows.map((row, index) => toLeaderCard(row, index + 1)) });
    return;
  }));

  router.get('/community/search', asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '');
    const traders = await searchTraders(db, q);
    res.json({ traders });
    return;
  }));

  router.get('/community/traders/:userId', asyncHandler(async (req, res) => {
    const userId = parseUserId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'invalid user' });
    const user = await gridBotDb.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'user not found' });
    const [profile, tags] = await Promise.all([
      loadTraderProfile(db, userId),
      ensureUserTags(db, userId),
    ]);
    const follow = req.userId ? await getFollowState(db, req.userId, userId) : {
      following: false,
      autoCopy: false,
      copyInvestmentUsdt: null,
    };
    res.json({
      ...profile,
      id: user.id,
      hasAvatar: Boolean(user.avatar_url),
      avatarUpdatedAt: user.avatar_updated_at ?? null,
      memberSince: user.created_at,
      tags,
      name: publicName(user.display_name, user.id),
      bio: user.bio?.trim() || null,
      follow,
    });
    return;
  }));

  router.post('/community/traders/:userId/follow', asyncHandler(async (req, res) => {
    const followeeId = parseUserId(req.params.userId);
    if (!followeeId) return res.status(400).json({ error: 'invalid user' });
    const result = await followUser(db, req.userId!, followeeId);
    if ('error' in result && result.error === 'self') {
      return res.status(400).json({ error: 'cannot_follow_self' });
    }
    if ('error' in result) return res.status(404).json({ error: 'user not found' });
    res.status(201).json(await getFollowState(db, req.userId!, followeeId));
    return;
  }));

  router.delete('/community/traders/:userId/follow', asyncHandler(async (req, res) => {
    const followeeId = parseUserId(req.params.userId);
    if (!followeeId) return res.status(400).json({ error: 'invalid user' });
    await unfollowUser(db, req.userId!, followeeId);
    res.json({ following: false, autoCopy: false, copyInvestmentUsdt: null });
    return;
  }));

  router.patch('/community/traders/:userId/follow', asyncHandler(async (req, res) => {
    const followeeId = parseUserId(req.params.userId);
    if (!followeeId) return res.status(400).json({ error: 'invalid user' });
    const body = (req.body ?? {}) as { autoCopy?: unknown; investmentUsdt?: unknown };
    const result = await setAutoCopy(db, req.userId!, followeeId, body.autoCopy === true, body.investmentUsdt);
    if ('error' in result && result.error === 'missing') {
      return res.status(404).json({ error: 'not_following' });
    }
    if ('error' in result) {
      return res.status(400).json({
        error: 'validation_failed',
        issues: [{ field: 'investment_usdt', code: result.error }],
      });
    }
    res.json(result.state);
    return;
  }));

  router.get('/profile/auto-copiers', asyncHandler(async (req, res) => {
    const page = Number(req.query.page ?? 1);
    res.json(await listAutoCopiers(db, req.userId!, page));
    return;
  }));

  router.post('/bots/:id/publish', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    const bot = await dbGet<{
      id: number;
      pair: string;
      direction: 'long' | 'short';
      leverage: number;
      lower_price: number;
      upper_price: number;
      num_grids: number;
      investment_usdt: number;
      total_pnl_usdt: number;
      virtual_enabled: number | null;
      active_window_size: number | null;
      sl_pct: number | null;
      tp_pct: number | null;
      auto_shift_enabled: number | null;
      auto_shift_pct: number | null;
      compound_pct: number | null;
      safeguard_enabled: number | null;
      safeguard_threshold_pct: number | null;
      safeguard_action: string | null;
    }>(db, `SELECT * FROM grid_bots WHERE id = ?`, [id]);
    if (!bot) return res.status(404).json({ error: 'bot not found' });
    const body = (req.body ?? {}) as { title?: unknown };
    const title = String(body.title ?? bot.pair).trim().slice(0, 80) || bot.pair;
    const now = Date.now();
    const pnlPct = bot.investment_usdt > 0 ? (bot.total_pnl_usdt / bot.investment_usdt) * 100 : 0;
    const existing = await getPublishedBySource(db, req.userId!, id);
    if (existing) {
      await dbRun(db, `
        UPDATE published_bots SET
          title = ?, pair = ?, direction = ?, leverage = ?,
          lower_price = ?, upper_price = ?, num_grids = ?, investment_usdt = ?,
          virtual_enabled = ?, active_window_size = ?, sl_pct = ?, tp_pct = ?,
          auto_shift_enabled = ?, auto_shift_pct = ?, compound_pct = ?,
          safeguard_enabled = ?, safeguard_threshold_pct = ?, safeguard_action = ?,
          pnl_usdt = ?, pnl_pct = ?, updated_at = ?
        WHERE id = ?
      `, [
        title, bot.pair, bot.direction, bot.leverage,
        bot.lower_price, bot.upper_price, bot.num_grids, bot.investment_usdt,
        bot.virtual_enabled ? 1 : 0, bot.active_window_size ?? null, bot.sl_pct ?? null, bot.tp_pct ?? null,
        bot.auto_shift_enabled ? 1 : 0, bot.auto_shift_pct ?? null, bot.compound_pct ?? null,
        bot.safeguard_enabled ? 1 : 0, bot.safeguard_threshold_pct ?? null, bot.safeguard_action ?? null,
        bot.total_pnl_usdt, pnlPct, now, existing.id,
      ]);
      res.json({ id: existing.id, updated: true });
      return;
    }
    const inserted = await dbRun(db, `
      INSERT INTO published_bots (
        user_id, source_bot_id, title, pair, direction, leverage,
        lower_price, upper_price, num_grids, investment_usdt,
        virtual_enabled, active_window_size, sl_pct, tp_pct,
        auto_shift_enabled, auto_shift_pct, compound_pct,
        safeguard_enabled, safeguard_threshold_pct, safeguard_action,
        pnl_usdt, pnl_pct, copies_count, published_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      RETURNING id
    `, [
      req.userId!, id, title, bot.pair, bot.direction, bot.leverage,
      bot.lower_price, bot.upper_price, bot.num_grids, bot.investment_usdt,
      bot.virtual_enabled ? 1 : 0, bot.active_window_size ?? null, bot.sl_pct ?? null, bot.tp_pct ?? null,
      bot.auto_shift_enabled ? 1 : 0, bot.auto_shift_pct ?? null, bot.compound_pct ?? null,
      bot.safeguard_enabled ? 1 : 0, bot.safeguard_threshold_pct ?? null, bot.safeguard_action ?? null,
      bot.total_pnl_usdt, pnlPct, now, now,
    ]);
    const created = await getPublishedBySource(db, req.userId!, id);
    res.json({ id: created?.id ?? inserted.lastID, updated: false });
    return;
  }));

  router.post('/community/bots/:id/copy', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid published bot id' });
    const published = await getPublishedBot(db, id);
    if (!published) return res.status(404).json({ error: 'published bot not found' });
    if (published.seed_key === 'featured-author-total') {
      return res.status(400).json({ error: 'author_total_not_copyable' });
    }
    const copy = await recordCopy(db, id, req.userId!);
    let markPrice: number | null = null;
    try {
      const ticker = await cache.getOrFetch(
        `ticker:public:${published.pair}`,
        5_000,
        () => grvtClient.getTicker(published.pair),
      );
      markPrice = parseMarkPrice(ticker);
    } catch {
      markPrice = null;
    }
    const adapted = markPrice
      ? recenterRange(published.lower_price, published.upper_price, markPrice)
      : { lower: published.lower_price, upper: published.upper_price };
    const card = toLeaderCard({
      ...published,
      lower_price: adapted.lower,
      upper_price: adapted.upper,
    }, 0);
    res.json({
      bot: card,
      copiesCount: copy.copiesCount,
      alreadyCopied: copy.alreadyCopied,
      markPrice,
      rangeAdapted: Boolean(markPrice),
      originalRange: {
        lower: published.lower_price,
        upper: published.upper_price,
      },
    });
    return;
  }));

  // ── GET /api/v2/bots/:id/grid-state ───────────────────────────────
  // The combined payload the GridChart needs in one round-trip:
  // grid levels + active orders + current price + position. Saves the
  // dashboard from making 4 separate requests on every refresh.
  router.get('/bots/:id/grid-state', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);

    const bot = await dbGet<{ pair: string; status: string; grvt_sub_account_id: number | null }>(
      db,
      `SELECT pair, status, grvt_sub_account_id FROM grid_bots WHERE id = ?`,
      [id]
    );
    if (!bot) return res.status(404).json({ error: 'bot not found' });

    const levels = await dbAll(db, `
      SELECT id, level_index, price, side, quantity, is_filled, pending_replace, order_id, state
      FROM grid_levels
      WHERE bot_id = ?
      ORDER BY level_index
    `, [id]);

    const sub = bot.grvt_sub_account_id ?? null;
    const userClient = await getGrvtClientForBot(req.userId!, sub, gridBotDb);
    const scope = `${req.userId}:${sub ?? 'default'}:${bot.pair}`;
    const [ticker, position, openOrders] = await Promise.all([
      cache.getOrFetch(`ticker:${scope}`, 2_000, () => userClient.getTicker(bot.pair)),
      cache.getOrFetch(`position:${scope}`, 2_000, () => userClient.getPosition(bot.pair)),
      cache.getOrFetch(`openOrders:${scope}`, 2_000, () => userClient.getOpenOrders(bot.pair))
    ]);

    res.json({
      botId: id,
      pair: bot.pair,
      status: bot.status,
      levels,
      ticker,
      position,
      openOrders,
      ts: Date.now()
    });
    return;
  }));

  // ── GET /api/v2/instruments ───────────────────────────────────────
  // Cached 60s — instruments don't change minute-to-minute.
  router.get('/instruments', asyncHandler(async (_req, res) => {
    const data = await cache.getOrFetch('instruments', 60_000, () => grvtClient.getInstruments());
    res.json({ instruments: data });
    return;
  }));

  // ── GET /api/v2/candles ───────────────────────────────────────────
  // Proxy to GRVT klines for the GridChart.
  // Query params:
  //   pair      - instrument name (default: ETH_USDT_Perp)
  //   interval  - GRVT enum (default: CI_1_H). Whitelisted to a few common ones.
  //   limit     - max candles, capped at 1000
  // Cached 30s for 1H+, 5s for sub-hour intervals.
  // Returns ascending (oldest first) — the GRVT API returns newest first;
  // we reverse so Lightweight Charts can append in order.
  router.get('/candles', asyncHandler(async (req, res) => {
    const pair = String(req.query.pair ?? 'ETH_USDT_Perp');
    const interval = String(req.query.interval ?? 'CI_1_H');
    const limitRaw = parseInt(String(req.query.limit ?? '500'), 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 500, 10), 1000);

    // Whitelist intervals — anything else is rejected to keep the cache key
    // space bounded and prevent typos from spawning a new cache entry per req.
    const VALID_INTERVALS = new Set([
      'CI_1_M', 'CI_3_M', 'CI_5_M', 'CI_15_M', 'CI_30_M',
      'CI_1_H', 'CI_2_H', 'CI_4_H', 'CI_6_H', 'CI_8_H', 'CI_12_H',
      'CI_1_D', 'CI_3_D', 'CI_1_W'
    ]);
    if (!VALID_INTERVALS.has(interval)) {
      return res.status(400).json({
        error: 'invalid_interval',
        hint: 'use CI_1_M / CI_5_M / CI_15_M / CI_1_H / CI_4_H / CI_1_D etc.'
      });
    }

    // Sub-hour intervals refresh more often, so cache them shorter.
    const ttl = interval.endsWith('_M') ? 5_000 : 30_000;
    const cacheKey = `candles:${pair}:${interval}:${limit}`;
    const candles = await cache.getOrFetch(cacheKey, ttl, async () => {
      const rows = await grvtClient.getKlines(pair, interval, limit);
      // Reverse to ascending order for the chart (GRVT returns newest first).
      return rows.slice().reverse();
    });

    res.json({ pair, interval, candles });
    return;
  }));

  // ── GET /api/v2/balance ───────────────────────────────────────────
  // Cached 2s.
  router.get('/balance', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    let userClient;
    try {
      userClient = await getGrvtClientForUser(userId, gridBotDb);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('no GRVT credentials')) {
        return res.status(409).json({ error: 'grvt_credentials_missing' });
      }
      throw err;
    }
    const data = await cache.getOrFetch(`balance:${userId}`, 2_000, () => userClient.getBalance());
    res.json({ balance: data });
    return;
  }));

  // ── GET /api/v2/bots/:id/trades ───────────────────────────────────
  router.get('/bots/:id/trades', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 1000);
    const trades = await dbAll(db, `
      SELECT id, side, quantity, price, fee, round_trip_profit, created_at
      FROM trades
      WHERE bot_id = ?
      ORDER BY id DESC
      LIMIT ?
    `, [id, limit]);
    res.json({ trades });
    return;
  }));

  // ── GET /api/v2/bots/:id/snapshots ────────────────────────────────
  router.get('/bots/:id/snapshots', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    const limit = Math.min(parseInt(String(req.query.limit ?? '365'), 10) || 365, 1000);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const snapshots = await dbAll<Record<string, unknown>>(db, `
      SELECT * FROM daily_snapshots WHERE bot_id = ? ORDER BY date DESC LIMIT ? OFFSET ?
    `, [id, limit, offset]);
    const live = await dbGet<{
      status: string;
      investment_usdt: number;
      equity: number;
    }>(db, `
      SELECT status, investment_usdt, investment_usdt + ${livePnlSql()} AS equity
      FROM grid_bots WHERE id = ?
    `, [id]);
    const today = new Date().toISOString().slice(0, 10);
    const stamped = (snapshots ?? []).map((row) => {
      const date = String(row.date ?? '').slice(0, 10);
      if (!live || live.status === 'stopped' || date !== today) return row;
      return { ...row, date, equity: live.equity, equity_usdt: live.equity };
    });
    res.json({ snapshots: stamped });
    return;
  }));

  // ── GET /api/v2/bots/:id/roundtrips ───────────────────────────────
  // Used for the win-rate stat and the fills feed.
  router.get('/bots/:id/roundtrips', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    // Multi-tenant: filter by user_id. NULL user_id rows are unowned.
    const userId = req.userId!;
    const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1000);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);
    const roundtrips = await dbAll(db, `
      SELECT id, buy_fill_id, sell_fill_id, buy_price, sell_price, size, profit, created_at
      FROM paired_roundtrips
      WHERE bot_id = ?
      ORDER BY id DESC
      LIMIT ? OFFSET ?
    `, [id, limit, offset]);
    const total = await dbGet<{ c: number; sum: number }>(db, `
      SELECT COUNT(*) as c, COALESCE(SUM(profit), 0) as sum
      FROM paired_roundtrips
      WHERE bot_id = ?
    `, [id]);
    // Net profit = gross - fees (consistent with header "Realized")
    const feeRow = await dbGet<{ f: number }>(db, `
      SELECT COALESCE(SUM(fee), 0) as f FROM fills_archive WHERE bot_id = ?
    `, [id]);
    const netProfit = (total?.sum ?? 0) - (feeRow?.f ?? 0);
    res.json({ roundtrips, count: total?.c ?? 0, totalProfit: netProfit });
    return;
  }));

  // ── GET /api/v2/bots/:id/fills ────────────────────────────────────
  // Reads from fills_archive (which is now actively populated by the
  // engine's pollFillArchive loop). Replaces the legacy /trades endpoint
  // for the dashboard's Fills tab — the trades table was frozen since
  // 2026-03-10 and the dashboard was showing stale fees=$0.00 numbers.
  //
  // EVERY field in the response comes from the live GRVT fill_history
  // record. The fee is what GRVT actually charged or refunded for that
  // fill on this account at this volume tier — no fee schedule
  // assumptions, no formulas.
  router.get('/bots/:id/fills', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1000);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

    const fills = await dbAll<{
      id: number;
      fill_id: string;
      event_time: string;
      is_buyer: number;
      price: number;
      size: number;
      fee: number;
      created_at: string;
    }>(db, `
      SELECT id, fill_id, event_time, is_buyer, price, size, fee, created_at
      FROM fills_archive
      WHERE bot_id = ?
      ORDER BY event_time DESC
      LIMIT ? OFFSET ?
    `, [id, limit, offset]);

    res.json({ fills });
    return;
  }));

  // ── GET /api/v2/bots/:id/rebate-summary ───────────────────────────
  // Aggregate fee stats over the entire fills_archive. Used by the
  // StatsPanel to show the maker rebate total.
  //
  // SUM(fee) is signed: negative means net rebate (you earned that
  // much from being a maker), positive means net fees paid. The
  // dashboard renders the sign with a + or - prefix and a green/red
  // color so the user always knows which way it's going. The bot is
  // fee-agnostic — what GRVT charges depends on the user's tier and
  // can be a rebate or a fee or both at different times.
  router.get('/bots/:id/rebate-summary', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);

    const row = await dbGet<{
      count: number;
      sum_fee: number | null;
      min_fee: number | null;
      max_fee: number | null;
    }>(db, `
      SELECT COUNT(*) AS count,
             COALESCE(SUM(fee), 0) AS sum_fee,
             MIN(fee) AS min_fee,
             MAX(fee) AS max_fee
      FROM fills_archive
      WHERE bot_id = ?
    `, [id]);

    const sumFee = row?.sum_fee ?? 0;
    const count = row?.count ?? 0;

    res.json({
      count,
      sumFee,                            // signed; negative = rebate earned
      netRebateUsdt: -sumFee,            // positive when user earned, for UI
      avgFee: count > 0 ? sumFee / count : 0,
      minFee: row?.min_fee ?? 0,
      maxFee: row?.max_fee ?? 0,
    });
    return;
  }));

  // ── GET /api/v2/bots/:id/realized-summary ─────────────────────────
  // Real grid_profit, computed by FIFO matching every fill in
  // fills_archive. This REPLACES the legacy bot.grid_profit_usdt
  // column (which was populated from a frozen `paired_roundtrips`
  // table that hasn't been updated since March). Every value is
  // derived from real GRVT fills — no estimation, no heuristic
  // grid-level pairing.
  //
  // Convention:
  //   realizedPnl = Σ (sell_price - buy_price) * matched_size
  //   totalFees   = Σ fee  (signed; negative = net rebate earned)
  //   netPnl      = realizedPnl - totalFees
  //                 (subtracting because positive fee = paid; negative
  //                  fee = earned, which INCREASES net PnL)
  //   roundTrips  = number of FIFO matches (a single SELL can split
  //                 across multiple BUY lots and count as multiple
  //                 round trips)
  //   openSize    = base-currency size still in unmatched BUY lots
  //                 (the currently-open position)
  //   openCost    = USDT spent on those open lots (avg = openCost/openSize)
  //
  // The cost of FIFO over ~1k fills is microseconds — fine to compute
  // on every request, but the dashboard caches with TanStack Query
  // staleTime so it does not hammer the endpoint.
  router.get('/bots/:id/realized-summary', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);

    // SOURCE OF TRUTH: paired_roundtrips scoped by bot_id.
    // Fee data from fills_archive (also scoped by bot_id).
    const rtStats = await dbGet<{ profit: number; count: number; earliest: string; latest: string }>(db, `
      SELECT COALESCE(SUM(profit), 0) as profit,
             COUNT(*) as count,
             MIN(created_at) as earliest,
             MAX(created_at) as latest
      FROM paired_roundtrips
      WHERE bot_id = ?
    `, [id]);

    const feeStats = await dbGet<{ totalFees: number; fillCount: number }>(db, `
      SELECT COALESCE(SUM(fee), 0) as totalFees,
             COUNT(*) as fillCount
      FROM fills_archive
      WHERE bot_id = ?
    `, [id]);

    const gridProfit = rtStats?.profit ?? 0;
    const totalFees = feeStats?.totalFees ?? 0;
    const pairs = rtStats?.count ?? 0;

    res.json({
      gridProfit,                              // gross trade-pair profit
      totalFees,                               // signed; negative = rebate
      netGridProfit: gridProfit - totalFees,   // grid profit AFTER fees
      pairs,                                   // matched grid round trips
      avgPerPair: pairs > 0 ? gridProfit / pairs : 0,
      fillCount: feeStats?.fillCount ?? 0,
      unpairedBuys: 0,                         // not computed from roundtrips
      unpairedSells: 0,
      firstFillAt: rtStats?.earliest ?? null,
      lastFillAt: rtStats?.latest ?? null,
    });
    return;
  }));


  // ── POST /api/v2/admin/backfill-fills?botId=N ─────────────────────
  // One-shot backfill for a specific bot. Pages getFillHistory backwards
  // using end_time until either GRVT returns nothing, the loop hits
  // maxBatches, or it observes a stall (same oldest fill twice in a row,
  // which means GRVT is ignoring end_time and we'd loop forever).
  //
  // Multi-bot: requires botId so each row can be attributed correctly.
  // Looks up the bot's pair from grid_bots and uses that as the GRVT
  // instrument filter. Idempotent via ON CONFLICT on fill_id.
  //
  // Returns counts for the operator to verify how much new data was
  // recovered. Triggered manually via curl with X-Api-Key.
  router.post('/admin/backfill-fills', asyncHandler(async (req, res) => {
    // Admin only.
    const me = await gridBotDb.getUserById(req.userId!);
    if (!me?.is_admin) {
      return res.status(403).json({ error: 'admin required' });
    }
    const botId = parseInt(String(req.query.botId ?? '0'), 10);
    if (!Number.isFinite(botId) || botId <= 0) {
      return res.status(400).json({ error: 'botId query param required' });
    }

    const bot = await dbGet<{ id: number; pair: string }>(db, `
      SELECT id, pair FROM grid_bots WHERE id = ?
    `, [botId]);
    if (!bot) return res.status(404).json({ error: 'bot not found' });

    const maxBatches = Math.min(
      parseInt(String(req.query.maxBatches ?? '20'), 10) || 20,
      50
    );
    const instrument = bot.pair;
    const t0 = Date.now();

    let totalFetched = 0;
    let totalInserted = 0;
    let batches = 0;
    let endTime: string | undefined = undefined;
    let lastOldest: string | null = null;
    let stalled = false;

    while (batches < maxBatches) {
      const batch = await grvtClient.getFillHistory(1000, instrument, endTime);
      batches++;
      if (batch.length === 0) break;

      const oldest = batch[batch.length - 1];
      if (!oldest) break;

      if (lastOldest !== null && lastOldest === String(oldest.event_time)) {
        stalled = true;
        break;
      }
      lastOldest = String(oldest.event_time);

      for (const f of batch) {
        const eventTime = String(f.event_time ?? '');
        if (!eventTime) continue;
        totalFetched++;
        const result = await dbRun(db, `
          INSERT INTO fills_archive
            (fill_id, event_time, is_buyer, price, size, fee, created_at, bot_id, instrument)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (fill_id) DO NOTHING
        `, [
          eventTime,
          eventTime,
          f.is_buyer ? 1 : 0,
          parseFloat(f.price ?? '0'),
          parseFloat(f.size ?? '0'),
          parseFloat(f.fee ?? '0'),
          new Date(Number(eventTime) / 1_000_000).toISOString(),
          botId,
          instrument,
        ]);
        if ((result?.changes ?? 0) > 0) totalInserted++;
      }

      // Subtract 1 ns so the next batch is strictly older.
      // We do NOT break on `batch.length < 1000` because GRVT's
      // fill_history endpoint silently caps each call at ~430 fills
      // even when limit=1000. We rely on the empty-batch and stall
      // detection to terminate instead.
      const oldestEventTime = String(oldest.event_time ?? '');
      if (!oldestEventTime) break;
      endTime = (BigInt(oldestEventTime) - 1n).toString();
    }

    const after = await dbGet<{
      count: number;
      sum_fee: number;
      min_fee: number;
      max_fee: number;
    }>(db, `
      SELECT COUNT(*) AS count,
             COALESCE(SUM(fee), 0) AS sum_fee,
             MIN(fee) AS min_fee,
             MAX(fee) AS max_fee
      FROM fills_archive
      WHERE bot_id = ?
    `, [botId]);
    res.json({
      ok: true,
      botId,
      instrument,
      batches,
      maxBatches,
      stalled,
      totalFetched,
      totalInserted,
      durationMs: Date.now() - t0,
      fillArchiveAfter: after,
    });
    return;
  }));

  // ── GET /api/v2/bots/:id/orders ───────────────────────────────────
  // Local DB orders (the GRVT live open orders are surfaced via grid-state).
  // Query failures degrade gracefully so the dashboard still loads.
  router.get('/bots/:id/orders', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    const status = String(req.query.status ?? 'all');
    const limit = Math.min(parseInt(String(req.query.limit ?? '200'), 10) || 200, 1000);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

    try {
      const where = status === 'all' ? '' : 'AND status = ?';
      const params: unknown[] = [id];
      if (status !== 'all') params.push(status);
      params.push(limit, offset);
      const orders = await dbAll(db, `
        SELECT id, order_id, side, type, quantity, price, status,
               grid_level_id, created_at, updated_at
        FROM orders
        WHERE bot_id = ? ${where}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `, params);
      res.json({ orders });
      return;
    } catch (err) {
      // Missing/corrupt legacy schema — return empty
      // instead of 500 so the tab can render an empty state.
      log.warn({ err: (err as Error).message }, 'orders query failed');
      res.json({ orders: [], degraded: true, hint: (err as Error).message });
      return;
    }
  }));

  // ── GET /api/v2/bots/:id/funding ──────────────────────────────────
  router.get('/bots/:id/funding', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    const limit = Math.min(parseInt(String(req.query.limit ?? '500'), 10) || 500, 5000);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10) || 0, 0);

    const funding = await dbAll(db, `
      SELECT id, instrument, funding_rate, payment_usdt, position_size,
             funding_time, created_at
      FROM funding_history
      WHERE bot_id = ?
      ORDER BY funding_time DESC
      LIMIT ? OFFSET ?
    `, [id, limit, offset]);

    const totals = await dbGet<{ count: number; total: number }>(db, `
      SELECT COUNT(*) as count, COALESCE(SUM(payment_usdt), 0) as total
      FROM funding_history
      WHERE bot_id = ?
    `, [id]);

    res.json({
      funding,
      count: totals?.count ?? 0,
      totalPaymentUsdt: totals?.total ?? 0,
    });
    return;
  }));

  // ── POST /api/v2/bots/validate ────────────────────────────────────
  // DRY-RUN endpoint for the Create Bot Wizard. Validates the proposed
  // config and returns the computed grid parameters (spacing, qty/level,
  // estimated profit per round-trip, liquidation distance) WITHOUT
  // actually creating a bot or placing any orders. The wizard uses this
  // for the live preview in steps 3 and 4.
  //
  // The actual bot creation flow goes via a separate POST /bots endpoint
  // that lands in B.5.1 — kept off the v0 surface to protect the live
  // bot from accidental sibling-bot creation during dashboard development.
  router.post('/bots/validate', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<{
      pair: string;
      direction: 'long' | 'short';
      lower_price: number;
      upper_price: number;
      num_grids: number;
      investment_usdt: number;
      leverage: number;
    }>;

    const pair = String(body.pair ?? '').trim();
    const direction = body.direction === 'short' ? 'short' : 'long';
    const lower = Number(body.lower_price);
    const upper = Number(body.upper_price);
    const grids = Number(body.num_grids);
    const investment = Number(body.investment_usdt);
    const leverage = Number(body.leverage);

    // H.8: virtual grids unlock num_grids up to 500 (vs 95 cap for legacy).
    const virtualEnabledVal = (body as any).virtual_enabled === true;
    const activeWindowSizeVal = Number((body as any).active_window_size);
    const issues = coreBotConfigIssues({
      pair,
      lower,
      upper,
      grids,
      investment,
      leverage,
      virtualEnabled: virtualEnabledVal,
      activeWindowSize: activeWindowSizeVal,
    });

    let oppositeSideActive = false;
    if (!issues.some((issue) => issue.field === 'lower_price' || issue.field === 'upper_price' || issue.field === 'pair')) {
      try {
        const ticker = await grvtClient.getTicker(pair);
        const mark = parseFloat(String((ticker as { mark_price?: string; last_price?: string }).mark_price
          ?? (ticker as { last_price?: string }).last_price
          ?? ''));
        if (Number.isFinite(mark) && mark > 0 && (mark <= lower || mark >= upper)) {
          issues.push({
            field: 'lower_price',
            code: 'price_outside_range',
            mark,
            min: lower,
            max: upper,
            pair,
          });
        }
      } catch {
        // Ticker outage should not block the preview; create maps the
        // engine error if the price is still outside at commit time.
      }
    }

    if (req.userId && pair && !issues.some((issue) => issue.code === 'duplicate_direction')) {
      const rawSub = (body as { grvt_sub_account_id?: number | null }).grvt_sub_account_id;
      const subId = rawSub == null ? null : Number(rawSub);
      const sameSide = await dbGet<{ c: number }>(
        db,
        `SELECT COUNT(*) as c FROM grid_bots
         WHERE user_id = ?
           AND pair = ?
           AND direction = ?
           AND COALESCE(grvt_sub_account_id, -1) = COALESCE(?, -1)
           AND status IN ('running', 'paused')`,
        [req.userId, pair, direction, Number.isInteger(subId) ? subId : null],
      );
      if ((sameSide?.c ?? 0) > 0) {
        issues.push({ field: 'direction', code: 'duplicate_direction', pair, direction });
      } else {
        const otherSide = await dbGet<{ c: number }>(
          db,
          `SELECT COUNT(*) as c FROM grid_bots
           WHERE user_id = ?
             AND pair = ?
             AND direction <> ?
             AND COALESCE(grvt_sub_account_id, -1) = COALESCE(?, -1)
             AND status IN ('running', 'paused')`,
          [req.userId, pair, direction, Number.isInteger(subId) ? subId : null],
        );
        oppositeSideActive = (otherSide?.c ?? 0) > 0;
      }
    }

    if (issues.length > 0) {
      return res.status(400).json({
        error: 'validation_failed',
        errors: issues.map((issue) => issue.code),
        issues,
      });
    }

    // Computed parameters — must EXACTLY mirror grid-engine.ts +
    // db.createBot() so the wizard preview matches what gets stored
    // and what actually trades. We had three different formulas at
    // one point (validate, calculateGridLevels, db.createBot) and
    // they disagreed: bot 43 hit it on 2026-04-08 — the wizard said
    // 0.0084 ETH/level but the bot ran with 0.05/0.06, drifting the
    // position by 0.17 ETH on a 6-min run. Single source of truth now.
    const spacing = (upper - lower) / (grids - 1);
    const notional = investment * leverage;
    const ORDER_ALLOC = 0.75;
    const midPrice = (upper + lower) / 2;
    const effCap = investment * leverage * ORDER_ALLOC;
    const minSize = pair === 'ETH_USDT_Perp' ? 0.01 : 0.001;
    let qtyPerLevel = Math.max(
      Math.ceil((effCap / grids / midPrice) * 100) / 100,
      0.03
    );
    // Floor on min notional at the lower price (safety net; usually no-op).
    const minNotional = pair === 'ETH_USDT_Perp' ? 20 : 100;
    while (qtyPerLevel * lower < minNotional) {
      qtyPerLevel += minSize;
    }
    qtyPerLevel = Math.round(qtyPerLevel * 100) / 100;
    const profitPerRoundTrip = qtyPerLevel * spacing;

    // Estimated liquidation: simplified — actual depends on funding/fees.
    // For LONG: liq ≈ avg_entry * (1 - 1/leverage * 0.95)
    const liquidationEstimate =
      direction === 'long'
        ? midPrice * (1 - (1 / leverage) * 0.95)
        : midPrice * (1 + (1 / leverage) * 0.95);
    const liqDistancePct = ((midPrice - liquidationEstimate) / midPrice) * 100;

    // GRVT caps at 80 open orders per instrument. Without virtual grids, the
    // bot can't exceed that. With virtual grids, only M ≤ 80 are active at once.
    const overOrderCap = grids > 95 && !virtualEnabledVal;

    res.json({
      valid: true,
      pair,
      direction,
      input: { lower, upper, grids, investment, leverage },
      computed: {
        spacing: round(spacing, 4),
        spacingPct: round((spacing / midPrice) * 100, 3),
        qtyPerLevel: round(qtyPerLevel, 6),
        notional: round(notional, 2),
        profitPerRoundTrip: round(profitPerRoundTrip, 4),
        midPrice: round(midPrice, 2),
        liquidationEstimate: round(liquidationEstimate, 2),
        liqDistancePct: round(liqDistancePct, 2),
      },
      warnings: [
        ...(oppositeSideActive ? ['opposite_side_active'] : []),
        ...(overOrderCap ? ['num_grids over GRVT Tier 1 cap (95)'] : []),
        ...(leverage > 20 ? ['leverage > 20x: liquidation risk is high'] : []),
      ],
    });
    return;
  }));

  // ── POST /api/v2/bots ─────────────────────────────────────────────
  // Create a new grid bot. The bot is always created in 'paused' state —
  // no orders are placed on GRVT until the user explicitly starts it via
  // POST /api/v2/bots/:id/start. This decouples "configure" from "trade"
  // so a bad config can never accidentally launch real orders.
  //
  // Re-validates the input server-side (the wizard already calls
  // /bots/validate but never trust the client).
  router.post('/bots', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Partial<{
      pair: string;
      direction: 'long' | 'short';
      lower_price: number;
      upper_price: number;
      num_grids: number;
      investment_usdt: number;
      leverage: number;
      acceptedTermsText: string;
      termsVersion: string;
      safeguard_enabled: boolean;
      safeguard_threshold_pct: number;
      safeguard_action: 'pause' | 'pause_close';
      virtual_enabled: boolean;
      active_window_size: number;
      // H.5: optional sub-account routing. Null/missing = default creds.
      grvt_sub_account_id: number | null;
      copied_from_bot_id: number | null;
    }>;

    const pair = String(body.pair ?? '').trim();
    const direction = body.direction === 'short' ? 'short' : 'long';
    const lower = Number(body.lower_price);
    const upper = Number(body.upper_price);
    const grids = Number(body.num_grids);
    const investment = Number(body.investment_usdt);
    const leverage = Number(body.leverage);

    // H.8: virtual grids
    const virtualEnabled = body.virtual_enabled === true;
    const activeWindowSize = Number(body.active_window_size);
    const issues = coreBotConfigIssues({
      pair,
      lower,
      upper,
      grids,
      investment,
      leverage,
      virtualEnabled,
      activeWindowSize,
    });

    // C.4: liquidation proximity safeguard (optional per-bot). If the user
    // opts in, both threshold_pct and action are required. Validation is
    // strict so downstream code can trust the persisted values.
    const safeguardEnabled = body.safeguard_enabled === true;
    let safeguardThresholdPct: number | null = null;
    let safeguardAction: 'pause' | 'pause_close' | null = null;
    if (safeguardEnabled) {
      safeguardThresholdPct = Number(body.safeguard_threshold_pct);
      if (!Number.isFinite(safeguardThresholdPct) || safeguardThresholdPct <= 0 || safeguardThresholdPct > 50) {
        issues.push({ field: 'safeguard_threshold_pct', code: 'safeguard_threshold', min: 1, max: 50 });
      }
      if (body.safeguard_action !== 'pause' && body.safeguard_action !== 'pause_close') {
        issues.push({ field: 'safeguard_action', code: 'safeguard_action' });
      } else {
        safeguardAction = body.safeguard_action;
      }
    }

    if (issues.length > 0) {
      return res.status(400).json({
        error: 'validation_failed',
        errors: issues.map((issue) => issue.code),
        issues,
      });
    }

    try {
      const userId = req.userId!;

      // H.5: validate the sub-account FK if provided. The bot can only
      // route through a row that belongs to this user — even with a
      // crafted body, the engine would refuse at run time, but failing
      // here gives the user a clean 400 instead of an opaque 500.
      let grvtSubAccountId: number | null = null;
      if (body.grvt_sub_account_id != null) {
        const id = Number(body.grvt_sub_account_id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({
            error: 'validation_failed',
            errors: ['sub_account_invalid'],
            issues: [{ field: 'sub_account', code: 'sub_account_invalid' }],
          });
        }
        const sub = await gridBotDb.getGrvtSubAccountRaw(id);
        if (!sub || sub.user_id !== userId) {
          return res.status(400).json({
            error: 'invalid_sub_account',
            message: 'Sub-account not found',
            issues: [{ field: 'sub_account', code: 'sub_account_invalid' }],
          });
        }
        grvtSubAccountId = id;
      }

      let copiedFromBotId: number | null = null;
      if (body.copied_from_bot_id != null) {
        const sourceId = Number(body.copied_from_bot_id);
        if (!Number.isInteger(sourceId) || sourceId <= 0) {
          return res.status(400).json({
            error: 'validation_failed',
            errors: ['copied_from_invalid'],
            issues: [{ field: 'pair', code: 'copied_from_invalid' }],
          });
        }
        const publishedSource = await dbGet<{ id: number }>(
          db,
          `SELECT id FROM published_bots WHERE source_bot_id = ? LIMIT 1`,
          [sourceId],
        );
        if (!publishedSource) {
          return res.status(400).json({
            error: 'validation_failed',
            errors: ['copied_from_invalid'],
            issues: [{ field: 'pair', code: 'copied_from_invalid' }],
          });
        }
        copiedFromBotId = sourceId;
      }

      // Same pair + same direction + same sub-account cannot have two
      // active bots. The opposite direction is a different bot: a long
      // can stay paused while a short is open, and the other way around.
      // A different sub-account is also a different book.
      const existing = await dbGet<{ c: number }>(
        db,
        `SELECT COUNT(*) as c FROM grid_bots
         WHERE user_id = ?
           AND pair = ?
           AND direction = ?
           AND COALESCE(grvt_sub_account_id, -1) = COALESCE(?, -1)
           AND status IN ('running', 'paused')`,
        [userId, pair, direction, grvtSubAccountId]
      );
      if (existing && existing.c > 0) {
        return res.status(409).json({
          error: 'duplicate_instrument',
          message: `You already have an active ${direction} bot on ${pair} for this sub-account.`,
          issues: [{ field: 'direction', code: 'duplicate_direction', pair, direction }],
        });
      }

      const botId = await engineOps.createBot({
        userId,
        pair,
        direction,
        leverage,
        lowerPrice: lower,
        upperPrice: upper,
        numGrids: grids,
        investmentUSDT: investment,
        virtualEnabled,
        activeWindowSize: virtualEnabled ? activeWindowSize : undefined,
        grvtSubAccountId,
        copiedFromBotId,
      });
      log.info({ botId, userId, pair, direction, leverage, grids }, 'bot created (paused)');

      // Persist per-bot risk acceptance if the dashboard sent the
      // exact text + version it showed. The text is hashed and the
      // request IP/UA are stored as audit trail.
      const acceptedTerms = (req.body as { accepted_terms?: unknown })?.accepted_terms === true;
      if (acceptedTerms) {
        const tosLang = pickTosLang((req.body as { terms_lang?: unknown })?.terms_lang);
        const termsText = SIGNUP_TOS_TEXTS[tosLang];
        const userAgent = req.header('user-agent') || null;
        await gridBotDb.insertTermsAcceptance({
          user_id: userId,
          context: 'create_bot',
          context_ref: botId,
          ip_address: clientIp(req),
          user_agent: userAgent,
          terms_version: `${SIGNUP_TOS_VERSION}-${tosLang}`,
          terms_text: termsText,
          terms_text_hash: createHash('sha256').update(termsText).digest('hex'),
        });
      }

      // Save compound settings if provided
      const compoundPct = Number((req.body as any)?.compound_pct);
      if (Number.isFinite(compoundPct) && compoundPct > 0 && compoundPct <= 100) {
        await dbRun(db, `UPDATE grid_bots SET compound_pct = ? WHERE id = ?`, [compoundPct, botId]);
      }

      // C.4: persist safeguard config if the user opted in. Validation
      // already happened above, so we trust the values here.
      if (safeguardEnabled && safeguardThresholdPct != null && safeguardAction != null) {
        await dbRun(
          db,
          `UPDATE grid_bots
             SET safeguard_enabled = 1,
                 safeguard_threshold_pct = ?,
                 safeguard_action = ?
           WHERE id = ?`,
          [safeguardThresholdPct, safeguardAction, botId]
        );
        log.info(
          { botId, safeguardThresholdPct, safeguardAction },
          'safeguard configured at bot creation'
        );
      }

      // H.3: stop-loss / take-profit (optional per-bot)
      const slPct = Number((req.body as any)?.sl_pct);
      const tpPct = Number((req.body as any)?.tp_pct);
      const slTpUpdates: string[] = [];
      const slTpParams: unknown[] = [];
      if (Number.isFinite(slPct) && slPct > 0 && slPct <= 100) {
        slTpUpdates.push('sl_pct = ?');
        slTpParams.push(slPct);
      }
      if (Number.isFinite(tpPct) && tpPct > 0 && tpPct <= 1000) {
        slTpUpdates.push('tp_pct = ?');
        slTpParams.push(tpPct);
      }
      // H.2: auto-shift
      const autoShift = (req.body as any)?.auto_shift_enabled === true;
      const autoShiftPct = Number((req.body as any)?.auto_shift_pct);
      if (autoShift && Number.isFinite(autoShiftPct) && autoShiftPct > 0) {
        slTpUpdates.push('auto_shift_enabled = 1', 'auto_shift_pct = ?');
        slTpParams.push(autoShiftPct);
      }
      if (slTpUpdates.length > 0) {
        slTpParams.push(botId);
        await dbRun(db, `UPDATE grid_bots SET ${slTpUpdates.join(', ')} WHERE id = ?`, slTpParams);
      }

      cache.invalidatePrefix('bots');
      announceBot(userId, 'bot_created', botId);
      res.status(201).json({ id: botId, status: 'paused' });
    } catch (err) {
      const message = (err as Error).message;
      log.error({ err: message }, 'bot creation failed');
      const markMatch = message.match(/(\d+(?:\.\d+)?)/);
      if (/fuera del rango|outside/i.test(message)) {
        res.status(400).json({
          error: 'validation_failed',
          message,
          issues: [{
            field: 'lower_price',
            code: 'price_outside_range',
            mark: markMatch ? Number(markMatch[1]) : undefined,
            pair,
          }],
        });
        return;
      }
      res.status(500).json({
        error: 'create_failed',
        issues: [{ field: 'form', code: 'generic' }],
      });
    }
    return;
  }));

  // ── POST /api/v2/bots/:id/start ───────────────────────────────────
  // Start a paused bot. The engine's startBot() detects existing GRVT
  // state (orders + position) and either RESUMES (rebinds without new
  // orders) or FRESH-STARTS (places initial orders). The reentrant guard
  // shipped in commit 1936367 prevents accidental double-bootstrap.
  router.post('/bots/:id/start', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    const owned = await requireBotOwnership(db, id, req.userId!);
    const meta = await dbGet<{
      direction: 'long' | 'short';
      grvt_sub_account_id: number | null;
    }>(
      db,
      `SELECT direction, grvt_sub_account_id FROM grid_bots WHERE id = ?`,
      [id],
    );
    if (meta?.direction === 'long' || meta?.direction === 'short') {
      const opposite = await dbGet<{ c: number }>(
        db,
        `SELECT COUNT(*) as c FROM grid_bots
         WHERE user_id = ?
           AND pair = ?
           AND direction <> ?
           AND id <> ?
           AND COALESCE(grvt_sub_account_id, -1) = COALESCE(?, -1)
           AND status = 'running'`,
        [req.userId, owned.pair, meta.direction, id, meta.grvt_sub_account_id],
      );
      if ((opposite?.c ?? 0) > 0) {
        return res.status(409).json({
          error: 'opposite_side_running',
          message: `The other side of ${owned.pair} is already running. Pause it before starting this one.`,
          issues: [{
            field: 'direction',
            code: 'opposite_side_running',
            pair: owned.pair,
            direction: meta.direction,
          }],
        });
      }
    }
    try {
      await engineOps.startBot(id);
      log.info({ botId: id }, 'bot started via API');
      cache.invalidatePrefix('bots');
      announceBot(req.userId!, 'bot_started', id);
      res.json({ id, status: 'running' });
    } catch (err) {
      log.error({ botId: id, err: (err as Error).message }, 'bot start failed');
      respondLifecycleError(res, err, 'start_failed', gridBotDb, req.userId!);
    }
    return;
  }));

  // ── POST /api/v2/bots/:id/pause ───────────────────────────────────
  // Pause a running bot. The engine's pauseBot() cancels all open orders
  // on GRVT before flipping the DB status — call this when you want to
  // STOP trading but keep the bot's history. Use it before any config
  // change.
  router.post('/bots/:id/pause', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    try {
      await engineOps.pauseBot(id);
      log.info({ botId: id }, 'bot paused via API');
      cache.invalidatePrefix('bots');
      announceBot(req.userId!, 'bot_paused', id);
      res.json({ id, status: 'paused' });
    } catch (err) {
      log.error({ botId: id, err: (err as Error).message }, 'bot pause failed');
      respondLifecycleError(res, err, 'pause_failed', gridBotDb, req.userId!);
    }
    return;
  }));

  // ── POST /api/v2/bots/:id/close ───────────────────────────────────
  // FULL stop. Cancels every open order on GRVT, then market-closes the
  // remaining position with a 0.5% aggressive GTC limit (so it crosses
  // the book and fills immediately). Bot status flips to 'stopped' —
  // it stays in the DB for history but no longer counts as an active
  // bot in the overview. Use this when you're done with a bot.
  //
  // Differs from /pause: pause only cancels orders and leaves the
  // position open so you can later /start and resume. /close is final.
  router.post('/bots/:id/close', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    try {
      const closedCopies = Number(await engineOps.closeBot(id)) || 0;
      await publishStoppedBots(db);
      log.info({ botId: id, closedCopies }, 'bot closed via API');
      cache.invalidatePrefix('bots');
      announceBot(req.userId!, 'bot_closed', id);
      res.json({ id, status: 'stopped', closedCopies });
    } catch (err) {
      log.error({ botId: id, err: (err as Error).message }, 'bot close failed');
      respondLifecycleError(res, err, 'close_failed', gridBotDb, req.userId!);
    }
    return;
  }));

  // ── PATCH /api/v2/bots/:id/compound ─────────────────────────────────
  // Update compound rebalance settings for a bot. compound_pct=0 disables.
  router.patch('/bots/:id/compound', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);

    const { compound_pct, compound_threshold_usdt, compound_interval_hours } = req.body ?? {};

    // Validate compound_pct (required, 0-100)
    if (compound_pct == null || typeof compound_pct !== 'number' || compound_pct < 0 || compound_pct > 100) {
      return res.status(400).json({ error: 'compound_pct must be a number between 0 and 100' });
    }

    const updates: Record<string, number> = { compound_pct };
    if (compound_threshold_usdt != null) {
      if (typeof compound_threshold_usdt !== 'number' || compound_threshold_usdt <= 0) {
        return res.status(400).json({ error: 'compound_threshold_usdt must be > 0' });
      }
      updates.compound_threshold_usdt = compound_threshold_usdt;
    }
    if (compound_interval_hours != null) {
      if (typeof compound_interval_hours !== 'number' || compound_interval_hours < 1) {
        return res.status(400).json({ error: 'compound_interval_hours must be >= 1' });
      }
      updates.compound_interval_hours = compound_interval_hours;
    }

    await dbRun(db, `
      UPDATE grid_bots
      SET ${Object.keys(updates).map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [...Object.values(updates), id]);

    cache.invalidatePrefix('bots');
    log.info({ botId: id, ...updates }, 'compound settings updated');
    announceBot(req.userId!, 'bot_action', id, 'compound');
    res.json({ id, ...updates });
    return;
  }));

  // ── PATCH /api/v2/bots/:id/risk ───────────────────────────────────
  // H.3: edit-in-place SL/TP. The fields are nullable on purpose — a
  // user may have set sl_pct=10 at create time and want to remove it
  // later without recreating the bot. The engine refreshes the bot row
  // at the top of every monitor tick so changes take effect within ~5s.
  router.patch('/bots/:id/risk', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);

    const body = (req.body ?? {}) as { sl_pct?: number | null; tp_pct?: number | null };
    const updates: Record<string, number | null> = {};

    if ('sl_pct' in body) {
      const v = body.sl_pct;
      if (v == null || v === 0) {
        updates.sl_pct = null;
      } else if (typeof v !== 'number' || v <= 0 || v > 100) {
        return res.status(400).json({ error: 'sl_pct must be 0/null (disable) or between 0 and 100' });
      } else {
        updates.sl_pct = v;
      }
    }
    if ('tp_pct' in body) {
      const v = body.tp_pct;
      if (v == null || v === 0) {
        updates.tp_pct = null;
      } else if (typeof v !== 'number' || v <= 0 || v > 1000) {
        return res.status(400).json({ error: 'tp_pct must be 0/null (disable) or between 0 and 1000' });
      } else {
        updates.tp_pct = v;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no fields to update' });
    }

    await dbRun(db, `
      UPDATE grid_bots
      SET ${Object.keys(updates).map(k => `${k} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [...Object.values(updates), id]);

    cache.invalidatePrefix('bots');
    log.info({ botId: id, ...updates }, 'risk settings updated');
    announceBot(req.userId!, 'bot_action', id, 'risk');
    res.json({ id, ...updates });
    return;
  }));

  // ── POST /api/v2/bots/:id/range/preview ───────────────────────────
  // Read-only dry-run of a range update. Returns the full RangeUpdatePlan
  // (orders to cancel, levels to create, ETH to auto-buy, slippage cost,
  // safety violations) WITHOUT executing anything. The dashboard calls
  // this on every input change to live-update the impact preview.
  //
  // Safety violations (e.g. current price outside new range, deficit
  // exceeds 2 ETH cap) are returned in the plan but the request still
  // succeeds with HTTP 200 — the dashboard surfaces them inline so the
  // user can correct before clicking commit.
  router.post('/bots/:id/range/preview', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);

    const body = (req.body ?? {}) as { lowerPrice?: unknown; upperPrice?: unknown };
    const lowerPrice = parseFloat(String(body.lowerPrice ?? ''));
    const upperPrice = parseFloat(String(body.upperPrice ?? ''));

    if (!Number.isFinite(lowerPrice) || !Number.isFinite(upperPrice)) {
      return res.status(400).json({
        error: 'invalid_range',
        message: 'lowerPrice and upperPrice must be finite numbers',
      });
    }

    try {
      const plan = await engineOps.previewBotRangeUpdate(id, lowerPrice, upperPrice);
      res.json({ plan });
    } catch (err) {
      log.error(
        { botId: id, lowerPrice, upperPrice, err: (err as Error).message },
        'range preview failed'
      );
      respondLifecycleError(res, err, 'preview_failed', gridBotDb, req.userId!);
    }
    return;
  }));

  // ── POST /api/v2/bots/:id/range ───────────────────────────────────
  // Move/expand/contract the grid range. The engine handles everything:
  //   - validates current price is within the new range (otherwise the
  //     grid has no anchor)
  //   - cancels orders outside the new range
  //   - if more SELL levels are needed than current ETH position, buys
  //     the deficit at market BEFORE placing new sell orders (otherwise
  //     they'd reject for insufficient asset)
  //   - creates new grid_levels for the new range
  //   - places limit orders for them
  //   - updates bot.lower_price / upper_price in DB
  //
  // This is the operator's escape hatch when price drifts out of the
  // current grid: instead of pausing+closing+recreating, they shift
  // the range to wherever price went and resume earning.
  router.post('/bots/:id/range', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);

    const body = (req.body ?? {}) as { lowerPrice?: unknown; upperPrice?: unknown };
    const lowerPrice = parseFloat(String(body.lowerPrice ?? ''));
    const upperPrice = parseFloat(String(body.upperPrice ?? ''));

    if (!Number.isFinite(lowerPrice) || !Number.isFinite(upperPrice)) {
      return res.status(400).json({
        error: 'invalid_range',
        message: 'lowerPrice and upperPrice must be finite numbers',
      });
    }
    if (lowerPrice <= 0 || upperPrice <= 0) {
      return res.status(400).json({
        error: 'invalid_range',
        message: 'prices must be positive',
      });
    }
    if (lowerPrice >= upperPrice) {
      return res.status(400).json({
        error: 'invalid_range',
        message: 'lowerPrice must be strictly less than upperPrice',
      });
    }

    try {
      await engineOps.updateBotRange(id, lowerPrice, upperPrice);
      log.info({ botId: id, lowerPrice, upperPrice }, 'bot range updated via API');
      cache.invalidatePrefix('bots');
      announceBot(req.userId!, 'bot_action', id, 'range');
      const updated = await dbGet<{
        lower_price: number;
        upper_price: number;
        num_grids: number;
      }>(db, `SELECT lower_price, upper_price, num_grids FROM grid_bots WHERE id = ?`, [id]);
      res.json({
        id,
        lowerPrice: updated?.lower_price ?? lowerPrice,
        upperPrice: updated?.upper_price ?? upperPrice,
        numGrids: updated?.num_grids ?? 0,
      });
    } catch (err) {
      log.error(
        { botId: id, lowerPrice, upperPrice, err: (err as Error).message },
        'bot range update failed'
      );
      respondLifecycleError(res, err, 'range_update_failed', gridBotDb, req.userId!);
    }
    return;
  }));

  // ── POST /api/v2/bots/:id/investment ──────────────────────────────
  // Change the capital assigned to a live or paused bot. Recalculates
  // quantity_per_level and resizes levels that do not have a live order.
  // Open orders keep their size until they fill.
  router.post('/bots/:id/investment', asyncHandler(async (req, res) => {
    const id = parseInt(String(req.params.id ?? ''), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid bot id' });
    await requireBotOwnership(db, id, req.userId!);
    const investmentUsdt = Number((req.body as { investmentUsdt?: unknown } | null)?.investmentUsdt);
    if (!Number.isFinite(investmentUsdt) || investmentUsdt <= 0) {
      return res.status(400).json({
        error: 'validation_failed',
        issues: [{ field: 'investment_usdt', code: 'investment_invalid' }],
      });
    }
    if (!engineOps.updateBotInvestment) {
      return res.status(501).json({ error: 'not_supported' });
    }
    try {
      const result = await engineOps.updateBotInvestment(id, investmentUsdt);
      cache.invalidatePrefix('bots');
      log.info({ botId: id, ...result }, 'bot investment updated');
      announceBot(req.userId!, 'bot_action', id, 'investment');
      res.json({ id, ...result });
    } catch (err) {
      const message = (err as Error).message;
      log.error({ botId: id, err: message }, 'bot investment update failed');
      if (/stopped bot|investment must/i.test(message)) {
        return res.status(400).json({
          error: 'validation_failed',
          message,
          issues: [{ field: 'investment_usdt', code: 'investment_invalid', message }],
        });
      }
      respondLifecycleError(res, err, 'investment_update_failed', gridBotDb, req.userId!);
    }
    return;
  }));

  // ── POST /api/v2/backtest ──────────────────────────────────────────
  // H.6: simulate a grid bot on historical candles. Pure computation —
  // no real orders, no DB writes. Returns profit, drawdown, roundtrips,
  // and an equity curve for charting. Charges per-side fees on every
  // round trip (default 0.05% = 5 bps maker on GRVT).
  interface BacktestBody {
    pair?: string;
    direction?: 'long' | 'short';
    leverage?: number;
    lower_price?: number;
    upper_price?: number;
    num_grids?: number;
    investment_usdt?: number;
    fee_pct?: number;
    interval?: string;
    limit?: number;
    sl_pct?: number;
    tp_pct?: number;
    auto_shift_enabled?: boolean;
    auto_shift_pct?: number;
    compound_pct?: number;
    virtual_enabled?: boolean;
    active_window_size?: number;
    funding_rate_pct?: number;
    days?: number;
  }

  router.post('/backtest', asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as BacktestBody;
    const {
      pair, direction, leverage, lower_price, upper_price, num_grids,
      investment_usdt, fee_pct, interval, limit: candleLimit,
      sl_pct, tp_pct, auto_shift_enabled, auto_shift_pct, compound_pct,
      virtual_enabled, active_window_size, funding_rate_pct, days,
    } = body;

    const errors: string[] = [];
    if (!pair) errors.push('pair is required');
    if (!Number.isFinite(lower_price) || (lower_price ?? 0) <= 0) errors.push('lower_price > 0');
    if (!Number.isFinite(upper_price) || (upper_price ?? 0) <= 0) errors.push('upper_price > 0');
    if ((lower_price ?? 0) >= (upper_price ?? 0)) errors.push('lower < upper');
    if (!Number.isInteger(num_grids) || (num_grids ?? 0) < 2) errors.push('num_grids >= 2');
    if (!Number.isFinite(investment_usdt) || (investment_usdt ?? 0) <= 0) errors.push('investment > 0');
    if (!Number.isFinite(leverage) || (leverage ?? 0) < 1) errors.push('leverage >= 1');
    if (fee_pct != null && (!Number.isFinite(fee_pct) || fee_pct < 0 || fee_pct > 1)) {
      errors.push('fee_pct in [0, 1]');
    }
    if (sl_pct != null && (!Number.isFinite(sl_pct) || sl_pct < 0 || sl_pct > 100)) {
      errors.push('sl_pct in [0, 100]');
    }
    if (tp_pct != null && (!Number.isFinite(tp_pct) || tp_pct < 0 || tp_pct > 1000)) {
      errors.push('tp_pct in [0, 1000]');
    }
    if (auto_shift_enabled && (!Number.isFinite(auto_shift_pct) || (auto_shift_pct ?? 0) <= 0 || (auto_shift_pct ?? 0) > 100)) {
      errors.push('auto_shift_pct in (0, 100]');
    }
    if (compound_pct != null && (!Number.isFinite(compound_pct) || compound_pct < 0 || compound_pct > 100)) {
      errors.push('compound_pct in [0, 100]');
    }
    if (virtual_enabled && (!Number.isInteger(active_window_size) || (active_window_size ?? 0) < 1 || (active_window_size ?? 0) > 80)) {
      errors.push('active_window_size in [1, 80]');
    }
    if (funding_rate_pct != null && (!Number.isFinite(funding_rate_pct) || funding_rate_pct < -5 || funding_rate_pct > 5)) {
      errors.push('funding_rate_pct in [-5, 5]');
    }
    if (days != null && (!Number.isFinite(days) || days < 1 || days > 120)) {
      errors.push('days in [1, 120]');
    }
    if (errors.length) return res.status(400).json({ error: 'validation_failed', errors });

    try {
      // Local GrvtClient interface (line 46) types getKlines as
      // Promise<unknown[]>. Cast to the real shape from the
      // implementation so the .map below stays type-safe.
      const spanDays = days != null ? Math.round(days) : null;
      let candleInterval = interval ?? 'CI_1_H';
      let candleCount = Math.min(candleLimit ?? 500, 1000);
      if (spanDays != null) {
        if (spanDays * 96 <= 1000) {
          candleInterval = 'CI_15_M';
          candleCount = spanDays * 96;
        } else if (spanDays * 24 <= 1000) {
          candleInterval = 'CI_1_H';
          candleCount = spanDays * 24;
        } else {
          candleInterval = 'CI_4_H';
          candleCount = Math.min(1000, spanDays * 6);
        }
      }
      const klines = (await grvtClient.getKlines(
        pair!,
        candleInterval,
        candleCount
      )) as Array<{
        openTime: number;
        open: number;
        high: number;
        low: number;
        close: number;
      }>;

      const candles = klines.map((k) => ({
        time: k.openTime / 1000,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      })).reverse(); // oldest first

      const { runBacktest } = await import('../bot/backtester.js');
      const result = runBacktest(
        {
          pair: pair!,
          direction: direction ?? 'long',
          leverage: leverage!,
          lowerPrice: lower_price!,
          upperPrice: upper_price!,
          numGrids: num_grids!,
          investmentUSDT: investment_usdt!,
          feePct: fee_pct,
          slPct: sl_pct,
          tpPct: tp_pct,
          autoShiftEnabled: auto_shift_enabled === true,
          autoShiftPct: auto_shift_pct,
          compoundPct: compound_pct,
          virtualEnabled: virtual_enabled === true,
          activeWindowSize: active_window_size,
          fundingRatePct: funding_rate_pct,
        },
        candles
      );

      // Thin equity curve for response. Always keep first + last point so
      // the chart shows the actual start and end equity even if the
      // sampling stride misses the final candle.
      const curve = result.equityCurve;
      const step = Math.max(1, Math.floor(curve.length / 200));
      const thinCurve: typeof curve = [];
      for (let i = 0; i < curve.length; i += step) thinCurve.push(curve[i]!);
      const last = curve[curve.length - 1];
      if (last && thinCurve[thinCurve.length - 1] !== last) thinCurve.push(last);

      const frames = result.frames;
      const frameStep = Math.max(1, Math.floor(frames.length / 400));
      const thinFrames: typeof frames = [];
      for (let i = 0; i < frames.length; i += frameStep) thinFrames.push(frames[i]!);
      const lastFrame = frames[frames.length - 1];
      if (lastFrame && thinFrames[thinFrames.length - 1] !== lastFrame) thinFrames.push(lastFrame);

      res.json({
        ...result,
        equityCurve: thinCurve,
        frames: thinFrames,
        interval: candleInterval,
        days: spanDays ?? result.daysInMarket,
      });
    } catch (err) {
      res.status(500).json({ error: 'backtest_failed' });
    }
    return;
  }));

  // ── GET /api/v2/portfolio-summary ───────────────────────────────────
  // H.7: aggregate risk metrics across all user bots.
  // Equity / PnL are rebuilt from `grid_profit_usdt + trend_pnl_usdt`
  // (NOT `total_pnl_usdt`, which is stale — written at insert time and
  // not refreshed by the engine on every tick).
  router.get('/portfolio-summary', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const bots = await dbAll<{
      id: number; pair: string; status: string; leverage: number;
      investment_usdt: number;
      grid_profit_usdt: number; trend_pnl_usdt: number;
      pnl_usdt: number;
      position_size: number; avg_entry_price: number;
    }>(db, `
      SELECT id, pair, status, leverage, investment_usdt,
             grid_profit_usdt, trend_pnl_usdt,
             ${livePnlSql()} AS pnl_usdt,
             position_size, avg_entry_price
      FROM grid_bots
      WHERE user_id = ? AND status != 'stopped'
    `, [userId]);

    let totalInvested = 0;
    let totalEquity = 0;
    let totalRealized = 0;
    let totalUnrealized = 0;
    let totalPositionUsdt = 0;
    let weightedLeverage = 0;
    const pairExposure: Record<string, number> = {};

    for (const b of bots) {
      const botPnl = b.pnl_usdt;
      const equity = b.investment_usdt + botPnl;
      const positionUsdt = b.position_size * b.avg_entry_price;
      totalInvested += b.investment_usdt;
      totalEquity += equity;
      totalRealized += botPnl - b.trend_pnl_usdt;
      totalUnrealized += b.trend_pnl_usdt;
      totalPositionUsdt += positionUsdt;
      weightedLeverage += b.leverage * b.investment_usdt;
      pairExposure[b.pair] = (pairExposure[b.pair] ?? 0) + positionUsdt;
    }

    const avgLeverage = totalInvested > 0 ? weightedLeverage / totalInvested : 0;

    res.json({
      botCount: bots.length,
      runningCount: bots.filter(b => b.status === 'running').length,
      totalInvested: round(totalInvested, 2),
      totalEquity: round(totalEquity, 2),
      totalRealized: round(totalRealized, 2),
      totalUnrealized: round(totalUnrealized, 2),
      totalPnl: round(totalRealized + totalUnrealized, 2),
      totalPnlPct: totalInvested > 0 ? round(((totalRealized + totalUnrealized) / totalInvested) * 100, 2) : 0,
      totalPositionUsdt: round(totalPositionUsdt, 2),
      avgLeverage: round(avgLeverage, 1),
      pairExposure,
    });
    return;
  }));

  // ── GET /api/v2/portfolio-equity-curve ──────────────────────────────
  // H.7: aggregate equity across the user's bots, grouped by date.
  // Sums daily_snapshots.equity per (date) for all non-stopped bots
  // owned by the user. Bots without a snapshot for a given day don't
  // contribute on that day — there is no carry-forward, so early days
  // (when fewer bots existed) read as a smaller portfolio.
  router.get('/portfolio-equity-curve', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const days = Math.min(parseInt(String(req.query.days ?? '90'), 10) || 90, 365);
    const points = await loadTraderEquityCurve(db, userId, days);
    res.json({ points });
    return;
  }));

  // ── GET /api/v2/alerts ─────────────────────────────────────────────
  // F.6: Read the notifier's alert history file. The notifier writes
  // this as a JSON array in its state directory; we read it from the
  // shared data path. Returns newest-first, with optional ?limit.
  //
  // SECURITY: filtered by userId. Alerts without a UUID owner are skipped.
  router.get('/alerts', asyncHandler(async (req, res) => {
    const userId = req.userId!;
    const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 500);
    try {
      const fs = await import('node:fs');
      const stateDir = process.env.NOTIFIER_STATE_DIR ?? '/var/lib/grvt-grid-notifier';
      const historyPath = `${stateDir}/alert-history.json`;
      if (!fs.existsSync(historyPath)) {
        res.json({ alerts: [] });
        return;
      }
      const raw = fs.readFileSync(historyPath, 'utf8');
      const all = JSON.parse(raw) as Array<{ userId?: string } & Record<string, unknown>>;
      const mine = all.filter((a) => a.userId === userId);
      const recent = mine.slice(-limit).reverse(); // newest first
      res.json({ alerts: recent });
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'alert history read failed');
      res.json({ alerts: [], degraded: true });
    }
    return;
  }));

  // ── GET /api/v2/health ────────────────────────────────────────────
  // C.6: real health check — verifies DB read + GRVT API reachability.
  // Returns ok / degraded / down with per-component latency. Docker
  // HEALTHCHECK and external monitors can act on the HTTP status code
  // (200 = ok or degraded, 503 = down).
  router.get('/health', asyncHandler(async (_req, res) => {
    const checks: Record<string, { ok: boolean; ms: number }> = {};

    const dbStart = Date.now();
    try {
      await dbGet<{ c: number }>(db, `SELECT 1 as c`);
      checks.db = { ok: true, ms: Date.now() - dbStart };
    } catch {
      checks.db = { ok: false, ms: Date.now() - dbStart };
    }

    const grvtStart = Date.now();
    try {
      await grvtClient.getTicker('BTC_USDT_Perp');
      checks.grvt = { ok: true, ms: Date.now() - grvtStart };
    } catch {
      checks.grvt = { ok: false, ms: Date.now() - grvtStart };
    }

    const allOk = Object.values(checks).every(c => c.ok);
    const status = allOk ? 'ok' : checks.db?.ok ? 'degraded' : 'down';
    const httpCode = allOk ? 200 : checks.db?.ok ? 200 : 503;

    res.status(httpCode).json({ status, checks });
    return;
  }));

  // Error handler — turn anything thrown by an asyncHandler into JSON
  router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error({ err: err.message, stack: err.stack }, 'v2 endpoint error');
    res.status(500).json({ error: 'internal_error' });
  });

  return router;
}
