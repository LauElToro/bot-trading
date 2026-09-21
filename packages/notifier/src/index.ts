// Toro notifier — main worker loop.
//
// Reads the bot's PostgreSQL database, detects new events, and emails
// important alerts to the bot owner. Cursor state lives in a JSON file
// in NOTIFIER_STATE_DIR so we don't re-send across restarts.
//
// Event sources (all polled every NOTIFIER_POLL_MS):
//   - paired_roundtrips      → batched fill notifications
//   - grid_bots.status       → status transitions
//   - aggregate equity vs HWM → drawdown alerts
//   - daily_snapshots        → once-a-day summary at DAILY_SUMMARY_HOUR_UTC
//
// Failure mode: any per-poll error is logged and swallowed; the loop keeps
// going. The bot is the source of truth — the notifier is a side-car.

import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotifierDb, type BotRow } from './db.js';
import { StateStore } from './state.js';
import { childLogger } from './logger.js';
import {
  dailySummaryTemplate,
  drawdownTemplate,
  fillsTemplate,
  liqProximityTemplate,
  statusChangeTemplate,
} from './templates.js';
import { WebhookClient } from './webhook.js';
import { EmailClient, subjectForAlert } from './email.js';

const log = childLogger('main');

export interface NotifierConfig {
  databaseUrl: string;
  pollMs: number;
  drawdownPct: number;
  fillBatch: number;
  liqProximityPct: number;       // F.2: global default for liq proximity alerts
  dailySummaryHour: number;
  stateDir: string;
  webhookUrl: string | undefined;
  webhookSecret: string | undefined;
  mutedHoursStart: number;
  mutedHoursEnd: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NotifierConfig {
  const databaseUrl = env.NOTIFIER_DATABASE_URL || env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('NOTIFIER_DATABASE_URL or DATABASE_URL is required');
  }
  return {
    databaseUrl,
    pollMs: parseInt(env.NOTIFIER_POLL_MS ?? '10000', 10),
    drawdownPct: parseFloat(env.NOTIFY_DRAWDOWN_PCT ?? '15'),
    fillBatch: parseInt(env.NOTIFY_FILL_BATCH ?? '5', 10),
    liqProximityPct: parseFloat(env.NOTIFY_LIQ_PROXIMITY_PCT ?? '15'),
    dailySummaryHour: parseInt(env.DAILY_SUMMARY_HOUR_UTC ?? '0', 10),
    stateDir: env.NOTIFIER_STATE_DIR ?? '/var/lib/grvt-grid-notifier',
    webhookUrl: env.WEBHOOK_URL,
    webhookSecret: env.WEBHOOK_SECRET,
    mutedHoursStart: parseInt(env.MUTED_HOURS_START_UTC ?? '-1', 10),
    mutedHoursEnd: parseInt(env.MUTED_HOURS_END_UTC ?? '-1', 10),
  };
}

export interface HealthReport {
  healthy: boolean;
  body: {
    status: 'ok' | 'starting' | 'stale' | 'db_error';
    lastTickAt: number | null;
    tickCount: number;
    elapsedMs: number | null;
    lastDbPingAt: number | null;
    dbPingOk: boolean | null;
    dbPingError: string | null;
    pollMs: number;
    uptime: number;
  };
}

export function getHealthReport(
  now: number,
  pollMs: number,
  lastTickAt: number,
  tickCount: number,
  lastDbPingAt: number,
  dbPingOk: boolean | null,
  dbPingError: string | null,
): HealthReport {
  const maxAge = pollMs * 3;
  const elapsed = lastTickAt ? now - lastTickAt : null;
  const tickFresh = elapsed === null || elapsed < maxAge;
  const pingElapsed = lastDbPingAt ? now - lastDbPingAt : null;
  const pingFresh = pingElapsed === null || pingElapsed < maxAge;
  const healthy = tickFresh && dbPingOk !== false && pingFresh;
  const status = !tickFresh || !pingFresh
    ? 'stale'
    : dbPingOk === false
      ? 'db_error'
      : dbPingOk === null
        ? 'starting'
        : 'ok';
  return {
    healthy,
    body: {
      status,
      lastTickAt: lastTickAt || null,
      tickCount,
      elapsedMs: elapsed,
      lastDbPingAt: lastDbPingAt || null,
      dbPingOk,
      dbPingError,
      pollMs,
      uptime: Math.floor(process.uptime()),
    },
  };
}

export class Notifier {
  private readonly cfg: NotifierConfig;
  private readonly db: NotifierDb;
  private readonly state: StateStore;
  private timer: NodeJS.Timeout | null = null;
  private stopping = false;
  private lastTickAt: number = 0;
  private tickCount: number = 0;
  private lastDbPingAt: number = 0;
  private dbPingOk: boolean | null = null;
  private dbPingError: string | null = null;
  private dbPingInFlight: Promise<void> | null = null;
  private healthServer: Server | null = null;

  private readonly webhook: WebhookClient;
  private readonly email: EmailClient;

  constructor(cfg: NotifierConfig) {
    this.cfg = cfg;
    this.db = new NotifierDb(cfg.databaseUrl);
    this.webhook = new WebhookClient(cfg.webhookUrl, cfg.webhookSecret);
    this.email = new EmailClient();
    this.state = new StateStore(cfg.stateDir);
  }

  /**
   * F.4: Check if current UTC hour falls within the muted window.
   * When muted, non-critical alerts (fills, daily summary) are suppressed.
   * Critical alerts (drawdown, liq proximity) always fire.
   */
  private isMuted(): boolean {
    const { mutedHoursStart: start, mutedHoursEnd: end } = this.cfg;
    if (start < 0 || end < 0) return false;
    const hour = new Date().getUTCHours();
    if (start <= end) return hour >= start && hour < end;
    // Wraps midnight: e.g. 22-06
    return hour >= start || hour < end;
  }

  /**
   * Persist the alert, optionally POST the webhook, and email the owner.
   * Every event is tagged with userId so /api/v2/alerts stays per-user.
   */
  private async notify(
    text: string,
    event: {
      type: string;
      userId: string;
      botId?: number;
      pair?: string;
      data?: Record<string, unknown>;
    }
  ): Promise<void> {
    this.state.appendAlert({
      ts: Date.now(),
      type: event.type,
      userId: event.userId,
      botId: event.botId,
      pair: event.pair,
      message: text,
      data: event.data,
    });

    await Promise.allSettled([
      this.webhook.send({ ...event, message: text }),
      this.db.getUserEmail(event.userId).then((to) => {
        if (!to) {
          log.warn({ userId: event.userId, type: event.type }, 'no email for alert owner');
          return;
        }
        return this.email.send(to, subjectForAlert(event.type), text, event.type);
      }),
    ]);
  }

  private ownerOf(bot: BotRow): string | null {
    return bot.user_id ?? null;
  }

  async start(): Promise<void> {
    log.info(
      {
        pollMs: this.cfg.pollMs,
        drawdownPct: this.cfg.drawdownPct,
        fillBatch: this.cfg.fillBatch,
        dailySummaryHour: this.cfg.dailySummaryHour,
      },
      'notifier starting'
    );

    // Bootstrap: on first run (no per-user cursor yet), set cursors so
    // we don't spam every historical roundtrip on startup. Done per
    // user — each owner gets their own starting point.
    const cursors = this.state.get().lastRoundtripIdByUser;
    if (Object.keys(cursors).length === 0) {
      const recent = await this.db.getRoundtripsSince(0, 100_000);
      const bots = await this.db.getAllBots();
      const newCursors: Record<string, number> = {};
      // Initialize a cursor for every known user (operator + any signed-up users)
      for (const b of bots) {
        const uid = this.ownerOf(b);
        if (!uid) continue;
        newCursors[uid] = 0;
      }
      for (const rt of recent) {
        if (!rt.user_id) continue;
        const uid = String(rt.user_id);
        const prev = newCursors[uid] ?? 0;
        if (rt.id > prev) newCursors[uid] = rt.id;
      }
      const newHwm: Record<string, number> = {};
      for (const b of bots) {
        const uid = this.ownerOf(b);
        if (!uid) continue;
        newHwm[uid] = (newHwm[uid] ?? 0) + (b.investment_usdt + b.total_pnl_usdt);
      }
      this.state.update({
        lastRoundtripIdByUser: newCursors,
        equityHwmByUser: newHwm,
      });
      log.info({ cursors: newCursors, hwm: newHwm }, 'bootstrap state (per-user)');
    }

    // The request handler only reads cached tick/ping state; it never waits
    // for PostgreSQL and remains responsive during a database outage.
    const healthPort = parseInt(process.env.NOTIFIER_HEALTH_PORT ?? '3849', 10);
    this.healthServer = createServer((_req, res) => {
      const report = getHealthReport(
        Date.now(),
        this.cfg.pollMs,
        this.lastTickAt,
        this.tickCount,
        this.lastDbPingAt,
        this.dbPingOk,
        this.dbPingError,
      );
      res.writeHead(report.healthy ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(report.body));
    });
    this.healthServer.listen(healthPort, () => {
      log.info({ port: healthPort }, 'health endpoint listening');
    });
    void this.refreshDbHealth();

    this.scheduleNext();
    log.info({ pollMs: this.cfg.pollMs }, 'first tick scheduled — entering loop');
  }

  private scheduleNext(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.tick().catch((err) => {
        log.error({ err: (err as Error).message }, 'tick errored');
      });
    }, this.cfg.pollMs);
    // NB: do NOT unref the timer. The notifier is loop-driven — there's no
    // HTTP server or other long-lived handle keeping the event loop alive.
    // If we unref, Node decides "nothing left to do" and exits cleanly
    // ~1s after main() returns, before the first tick ever fires.
    // (Bug discovered in production deploy 2026-04-07: process exited 0
    //  immediately after `bootstrap state` log. systemd kept restart-looping it.)
  }

  private refreshDbHealth(): Promise<void> {
    if (this.dbPingInFlight) return this.dbPingInFlight;
    this.dbPingInFlight = this.db.ping().then(
      () => {
        this.lastDbPingAt = Date.now();
        this.dbPingOk = true;
        this.dbPingError = null;
      },
      (error: unknown) => {
        this.lastDbPingAt = Date.now();
        this.dbPingOk = false;
        this.dbPingError = error instanceof Error ? error.message : String(error);
        log.warn({ err: this.dbPingError }, 'database health ping failed');
      },
    ).finally(() => {
      this.dbPingInFlight = null;
    });
    return this.dbPingInFlight;
  }

  private async tick(): Promise<void> {
    try {
      this.lastTickAt = Date.now();
      this.tickCount++;
      await this.refreshDbHealth();
      const bots = await this.db.getAllBots();
      const muted = this.isMuted();

      // Critical alerts — always fire regardless of muted hours
      await this.checkStatusTransitions(bots);
      await this.checkDrawdown(bots);
      await this.checkLiqProximity(bots); // F.2

      // Non-critical — suppressed during muted hours (F.4)
      if (!muted) {
        await this.checkRoundtrips(bots);
        await this.checkDailySummary(bots);
      }
    } finally {
      this.scheduleNext();
    }
  }

  // ── Roundtrip / fill detection ─────────────────────────────────────
  // SECURITY: batches and cursors are per-user. The previous global
  // cursor + global batch leaked another user's fill counts into the
  // operator's inbox and held cursor advancement hostage to whoever
  // had the fewest fills.
  private async checkRoundtrips(_bots: BotRow[]): Promise<void> {
    const cursors = { ...this.state.get().lastRoundtripIdByUser };
    // Read from min cursor across users so a slow-tracking user doesn't
    // get permanently skipped. Per-row user attribution gates the rest.
    const minCursor = Object.keys(cursors).length === 0
      ? 0
      : Math.min(...Object.values(cursors));
    const candidates = await this.db.getRoundtripsSince(minCursor, 500);
    if (candidates.length === 0) return;

    // Group by owning user, dropping anything already past that user's cursor.
    const byUser = new Map<string, typeof candidates>();
    for (const rt of candidates) {
      if (!rt.user_id) continue;
      const uid = String(rt.user_id);
      const userCursor = cursors[uid] ?? 0;
      if (rt.id <= userCursor) continue;
      const arr = byUser.get(uid) ?? [];
      arr.push(rt);
      byUser.set(uid, arr);
    }

    const threshold = this.cfg.fillBatch;
    let mutated = false;
    for (const [uid, rts] of byUser) {
      if (rts.length < threshold) {
        log.debug({ uid, count: rts.length }, 'below batch threshold, holding');
        continue;
      }
      const text = fillsTemplate(rts);
      await this.notify(text, {
        type: 'fills',
        userId: uid,
        data: { count: rts.length, totalProfit: rts.reduce((s, r) => s + r.profit, 0) },
      });
      cursors[uid] = rts[rts.length - 1]!.id;
      mutated = true;
      log.info({ uid, count: rts.length, cursor: cursors[uid] }, 'sent fill batch');
    }
    if (mutated) this.state.update({ lastRoundtripIdByUser: cursors });
  }

  // ── Status transitions ─────────────────────────────────────────────
  private async checkStatusTransitions(bots: BotRow[]): Promise<void> {
    const lastStatus = { ...this.state.get().lastBotStatus };
    let changed = false;
    for (const bot of bots) {
      const previous = lastStatus[String(bot.id)];
      if (previous && previous !== bot.status) {
        const owner = this.ownerOf(bot);
        if (!owner) continue;
        const text = statusChangeTemplate(bot, previous, bot.status);
        await this.notify(text, {
          type: 'status_change',
          userId: owner,
          botId: bot.id,
          pair: bot.pair,
          data: { from: previous, to: bot.status },
        });
        log.info(
          { bot: bot.id, from: previous, to: bot.status },
          'status transition'
        );
      }
      if (lastStatus[String(bot.id)] !== bot.status) {
        lastStatus[String(bot.id)] = bot.status;
        changed = true;
      }
    }
    if (changed) this.state.update({ lastBotStatus: lastStatus });
  }

  // ── Drawdown (per-user) ─────────────────────────────────────────────
  // SECURITY: drawdown is computed PER USER. The previous global HWM
  // mixed every user's equity together, so a $1M drop on user B would
  // alert user A with B's number visible in the email batch via the
  // shared notifier and via the shared alert-history.json file.
  private async checkDrawdown(bots: BotRow[]): Promise<void> {
    if (bots.length === 0) return;

    // Aggregate equity per owning user.
    const equityByUser = new Map<string, number>();
    const botsByUser = new Map<string, BotRow[]>();
    for (const b of bots) {
      const uid = this.ownerOf(b);
      if (!uid) continue;
      equityByUser.set(uid, (equityByUser.get(uid) ?? 0) + (b.investment_usdt + b.total_pnl_usdt));
      const arr = botsByUser.get(uid) ?? [];
      arr.push(b);
      botsByUser.set(uid, arr);
    }

    const hwmMap = { ...this.state.get().equityHwmByUser };
    const errorMap = { ...this.state.get().lastErrorHashByUser };
    let hwmChanged = false;
    let errorChanged = false;

    for (const [uid, equity] of equityByUser) {
      const hwm = hwmMap[uid] ?? equity;
      if (equity > hwm) {
        hwmMap[uid] = equity;
        hwmChanged = true;
        continue;
      }
      // F.1: per-bot drawdown override only applies when the user has a
      // single bot (otherwise multiple thresholds would compete).
      const userBots = botsByUser.get(uid) ?? [];
      const threshold = userBots.length === 1 && userBots[0]!.alert_drawdown_pct != null
        ? userBots[0]!.alert_drawdown_pct!
        : this.cfg.drawdownPct;

      const dropPct = hwm > 0 ? ((hwm - equity) / hwm) * 100 : 0;
      if (dropPct >= threshold) {
        const bucket = Math.floor(dropPct / threshold);
        const hash = `dd:${hwm.toFixed(0)}:${bucket}`;
        if (errorMap[uid] === hash) continue;
        const text = drawdownTemplate(equity, hwm, threshold);
        await this.notify(text, {
          type: 'drawdown',
          userId: uid,
          data: { equity, hwm, dropPct, threshold },
        });
        errorMap[uid] = hash;
        errorChanged = true;
        log.warn({ uid, equity, hwm, dropPct }, 'drawdown alert sent');
      }
    }

    if (hwmChanged || errorChanged) {
      this.state.update({
        ...(hwmChanged ? { equityHwmByUser: hwmMap } : {}),
        ...(errorChanged ? { lastErrorHashByUser: errorMap } : {}),
      });
    }
  }

  // ── F.2: Liquidation proximity ─────────────────────────────────────
  private async checkLiqProximity(bots: BotRow[]): Promise<void> {
    const errorMap = { ...this.state.get().lastErrorHashByUser };
    let changed = false;
    for (const bot of bots) {
      if (bot.status !== 'running') continue;
      if (!bot.liquidation_price || bot.liquidation_price <= 0) continue;
      if (!bot.avg_entry_price || bot.avg_entry_price <= 0) continue;

      const markPrice = await this.db.getLastFillPrice(bot.id);
      if (!markPrice) continue;

      // F.1: per-bot threshold overrides global
      const threshold = bot.alert_liq_proximity_pct ?? this.cfg.liqProximityPct;

      const distancePct = bot.direction === 'long'
        ? ((markPrice - bot.liquidation_price) / markPrice) * 100
        : ((bot.liquidation_price - markPrice) / markPrice) * 100;

      if (distancePct <= threshold && distancePct > 0) {
        const owner = this.ownerOf(bot);
        if (!owner) continue;
        const uid = owner;
        // Dedup: per-user, bot+bucket so the alert re-fires if it gets worse
        const bucket = Math.floor(distancePct / 5);
        const hash = `liq:${bot.id}:${bucket}`;
        if (errorMap[uid] === hash) continue;

        const text = liqProximityTemplate(bot, markPrice, bot.liquidation_price, distancePct);
        await this.notify(text, {
          type: 'liq_proximity',
          userId: owner,
          botId: bot.id,
          pair: bot.pair,
          data: { markPrice, liqPrice: bot.liquidation_price, distancePct },
        });
        errorMap[uid] = hash;
        changed = true;
        log.warn({ botId: bot.id, distancePct }, 'liq proximity alert sent');
      }
    }
    if (changed) this.state.update({ lastErrorHashByUser: errorMap });
  }

  // ── Daily summary ──────────────────────────────────────────────────
  private async checkDailySummary(bots: BotRow[]): Promise<void> {
    if (this.cfg.dailySummaryHour < 0 || this.cfg.dailySummaryHour > 23) return;

    const now = new Date();
    if (now.getUTCHours() !== this.cfg.dailySummaryHour) return;

    const today = now.toISOString().slice(0, 10); // YYYY-MM-DD
    if (this.state.get().lastSummaryDate === today) return;

    // Only summarize running bots. Stopped/paused/error bots don't
    // belong in the daily digest: stopped ones already fired their
    // status_change notification when they closed and the user
    // explicitly took them out of rotation, so re-summarizing them
    // every morning is noise.
    const activeBots = bots.filter((b) => b.status === 'running');

    for (const bot of activeBots) {
      const owner = this.ownerOf(bot);
      if (!owner) continue;
      const snapshot = await this.db.getLatestSnapshot(bot.id);
      const yesterday: number | null = snapshot?.equity ?? null;
      await this.notify(dailySummaryTemplate(bot, snapshot, yesterday), {
        type: 'daily_summary',
        userId: owner,
        botId: bot.id,
        pair: bot.pair,
      });
    }
    this.state.update({ lastSummaryDate: today });
    log.info({ today, count: activeBots.length, totalBots: bots.length }, 'daily summary sent');
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.healthServer) {
      const server = this.healthServer;
      this.healthServer = null;
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
    await this.dbPingInFlight;
    await this.db.close();
    log.info('notifier stopped');
  }
}

// ── Entry point ─────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const cfg = loadConfig();
  const notifier = new Notifier(cfg);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutdown signal');
    await notifier.stop();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    log.fatal({ err: err.message, stack: err.stack }, 'uncaught exception');
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log.fatal(
      { reason: reason instanceof Error ? reason.message : String(reason) },
      'unhandled promise rejection'
    );
    process.exit(1);
  });
  process.on('exit', (code) => {
    log.info({ code }, 'process exiting');
  });

  await notifier.start();
}

const isMain = process.argv[1]
  ? fileURLToPath(import.meta.url) === resolve(process.argv[1])
  : false;

if (isMain) {
  main().catch((err) => {
    log.fatal(
      { err: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
      'main() failed during boot'
    );
    process.exit(1);
  });
}
