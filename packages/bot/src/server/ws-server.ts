import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { childLogger } from './logger.js';
import { wsBus, type WsMessage } from './ws-bus.js';
import { randomUUID } from 'node:crypto';

const log = childLogger('ws-server');

const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_BAD_REQUEST = 4400;
const AUTH_TIMEOUT_MS = 2_000;

interface ClientState {
  id: string;
  ws: WebSocket;
  userId: string | null;
  unsubscribers: Map<string, () => void>;
  isAlive: boolean;
}

export interface WsServerOptions {
  apiKey: string;
  verifyToken?: (token: string) => { userId: string } | null;
  authorizeChannel?: (userId: string, channel: string) => Promise<boolean>;
}

function allowLegacyApiKey(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.ALLOW_LEGACY_API_KEY === '1';
}

export class GrvtWebSocketServer {
  private wss: WebSocketServer;
  private clients = new Map<WebSocket, ClientState>();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly apiKey: string;
  private readonly verifyToken?: (token: string) => { userId: string } | null;
  private readonly authorizeChannel?: (userId: string, channel: string) => Promise<boolean>;

  constructor(httpServer: HttpServer, optsOrApiKey: WsServerOptions | string) {
    const opts: WsServerOptions =
      typeof optsOrApiKey === 'string' ? { apiKey: optsOrApiKey } : optsOrApiKey;
    if (!opts.apiKey || opts.apiKey.length < 16) {
      throw new Error('DASHBOARD_API_KEY must be at least 16 chars');
    }
    this.apiKey = opts.apiKey;
    this.verifyToken = opts.verifyToken;
    this.authorizeChannel = opts.authorizeChannel;

    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws'
    });

    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
    this.wss.on('error', (err) => log.error({ err }, 'wss error'));

    this.heartbeatInterval = setInterval(() => this.heartbeat(), 30_000);
    this.heartbeatInterval.unref?.();

    log.info('WebSocket server mounted at /ws');
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? '/ws', `http://${req.headers.host}`);
    if (url.searchParams.has('token') || url.searchParams.has('api_key')) {
      log.warn({ ip: req.socket.remoteAddress }, 'rejected WS connection: credentials in query string');
      ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      log.warn({ ip: req.socket.remoteAddress }, 'rejected WS connection: auth timeout');
      ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
    }, AUTH_TIMEOUT_MS);
    timer.unref?.();

    const onAuth = (raw: RawData) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.off('message', onAuth);

      let msg: { type?: string; token?: string; apiKey?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(CLOSE_BAD_REQUEST, 'invalid JSON');
        return;
      }

      if (msg.type !== 'auth') {
        log.warn({ ip: req.socket.remoteAddress }, 'rejected WS connection: first frame was not auth');
        ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }

      let userId: string | null = null;
      if (msg.token && this.verifyToken) {
        const payload = this.verifyToken(msg.token);
        if (!payload) {
          log.warn({ ip: req.socket.remoteAddress }, 'rejected WS connection: invalid/expired JWT');
          ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
          return;
        }
        userId = payload.userId;
      } else if (
        allowLegacyApiKey() &&
        msg.apiKey &&
        msg.apiKey === this.apiKey
      ) {
        userId = null;
      } else {
        log.warn({ ip: req.socket.remoteAddress }, 'rejected unauthenticated WS connection');
        ws.close(CLOSE_UNAUTHORIZED, 'unauthorized');
        return;
      }

      this.completeConnection(ws, userId);
    };

    ws.on('message', onAuth);
    ws.on('close', () => {
      settled = true;
      clearTimeout(timer);
    });
  }

  private completeConnection(ws: WebSocket, userId: string | null): void {
    const id = randomUUID();
    const state: ClientState = {
      id,
      ws,
      userId,
      unsubscribers: new Map(),
      isAlive: true
    };
    this.clients.set(ws, state);

    log.info({ clientId: id, userId, total: this.clients.size }, 'client connected');

    ws.on('message', (raw) => this.onMessage(state, raw));
    ws.on('pong', () => { state.isAlive = true; });
    ws.on('close', (code, reason) => this.onClose(state, code, reason.toString()));
    ws.on('error', (err) => log.error({ err, clientId: id }, 'client ws error'));

    this.send(ws, {
      type: 'hello',
      channel: 'system',
      data: {
        clientId: id,
        serverVersion: '0.1.0',
        protocolVersion: 1
      },
      timestamp: Date.now()
    });
  }

  private onMessage(state: ClientState, raw: RawData): void {
    let msg: { type?: string; channel?: string; channels?: string[] };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      log.warn({ clientId: state.id }, 'received non-JSON message');
      state.ws.close(CLOSE_BAD_REQUEST, 'invalid JSON');
      return;
    }

    switch (msg.type) {
      case 'auth':
        break;
      case 'subscribe': {
        const channels = Array.isArray(msg.channels) ? msg.channels : [];
        void (async () => {
          const accepted: string[] = [];
          const rejected: string[] = [];
          for (const channel of channels) {
            if (typeof channel !== 'string') continue;
            if (state.unsubscribers.has(channel)) {
              accepted.push(channel);
              continue;
            }
            if (state.userId !== null && this.authorizeChannel) {
              const ok = await this.authorizeChannel(state.userId, channel).catch((err) => {
                log.error({ err, channel, userId: state.userId }, 'authorizeChannel threw');
                return false;
              });
              if (!ok) {
                rejected.push(channel);
                continue;
              }
            }
            const teardown = wsBus.subscribe(channel, (busMsg) => {
              this.send(state.ws, busMsg);
            });
            state.unsubscribers.set(channel, teardown);
            accepted.push(channel);
          }
          if (rejected.length > 0) {
            log.warn(
              { clientId: state.id, userId: state.userId, rejected },
              'rejected channel subscriptions (not owned by user)'
            );
          }
          log.debug({ clientId: state.id, accepted, rejected }, 'subscribed');
          this.send(state.ws, {
            type: 'subscribed',
            channel: 'system',
            data: {
              channels: Array.from(state.unsubscribers.keys()),
              ...(rejected.length > 0 ? { rejected } : {}),
            },
            timestamp: Date.now()
          });
        })();
        break;
      }

      case 'unsubscribe': {
        const channels = Array.isArray(msg.channels) ? msg.channels : [];
        for (const channel of channels) {
          const teardown = state.unsubscribers.get(channel);
          if (teardown) {
            teardown();
            state.unsubscribers.delete(channel);
          }
        }
        break;
      }

      case 'ping':
        this.send(state.ws, {
          type: 'pong',
          channel: 'system',
          data: null,
          timestamp: Date.now()
        });
        break;

      default:
        log.warn({ clientId: state.id, type: msg.type }, 'unknown message type');
    }
  }

  private onClose(state: ClientState, code: number, reason: string): void {
    log.info({ clientId: state.id, code, reason, total: this.clients.size - 1 }, 'client disconnected');
    for (const teardown of state.unsubscribers.values()) teardown();
    state.unsubscribers.clear();
    this.clients.delete(state.ws);
  }

  private send(ws: WebSocket, msg: WsMessage): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      log.error({ err }, 'failed to send to client');
    }
  }

  private heartbeat(): void {
    for (const [ws, state] of this.clients) {
      if (!state.isAlive) {
        log.info({ clientId: state.id }, 'terminating stale client');
        ws.terminate();
        continue;
      }
      state.isAlive = false;
      try {
        ws.ping();
      } catch (err) {
        log.warn({ err, clientId: state.id }, 'ping failed');
      }
    }
  }

  clientCount(): number {
    return this.clients.size;
  }

  async close(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const ws of this.clients.keys()) {
      try {
        ws.close(1001, 'server shutdown');
      } catch { /* ignore */ }
    }
    this.clients.clear();
    return new Promise((resolve) => {
      this.wss.close(() => resolve());
    });
  }
}
