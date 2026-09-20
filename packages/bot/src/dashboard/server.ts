import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';
import { createServer } from 'node:http';
import { grvtClient } from '../api/client.js';
import { db } from '../database/db.js';
import { gridEngine } from '../bot/grid-engine.js';
import { mountV2 } from '../server/v2-bootstrap.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.DASHBOARD_PORT || 3848;

app.set('trust proxy', 'loopback, linklocal, uniquelocal');

async function initializeServices() {
  try {
    await db.initialize();

    const ownerEmail = process.env.OWNER_EMAIL;
    const ownerPassword = process.env.OWNER_INITIAL_PASSWORD;
    if (ownerEmail && ownerPassword) {
      try {
        const { hashPassword } = await import('../auth/passwords.js');
        const hash = await hashPassword(ownerPassword);
        const result = await db.ownerBootstrap({
          email: ownerEmail.toLowerCase().trim(),
          password_hash: hash,
        });
        if (result.created) {
          console.log(`Owner user created: ${ownerEmail} (id=${result.userId})`);
          console.log('REMOVE OWNER_INITIAL_PASSWORD from .env after first boot');
        } else {
          console.log(`Owner bootstrap skipped (users already exist; owner=${result.userId})`);
        }

        const grvtApiKey = process.env.GRVT_API_KEY;
        const grvtApiSecret = process.env.GRVT_API_SECRET;
        const grvtTradingAddress = process.env.GRVT_TRADING_ADDRESS;
        const grvtAccountId = process.env.GRVT_ACCOUNT_ID || '';
        const grvtSubAccountId = process.env.GRVT_TRADING_ACCOUNT_ID || '';
        const hasDbCreds = await db.hasGrvtCredentials(result.userId);
        if (grvtApiKey && grvtApiSecret && grvtTradingAddress && grvtSubAccountId && !hasDbCreds) {
          try {
            const { encryptCredentialFields } = await import('../auth/crypto.js');
            const encrypted = encryptCredentialFields({
              apiKey: grvtApiKey,
              apiSecret: grvtApiSecret,
              tradingAddress: grvtTradingAddress,
              accountId: grvtAccountId,
              subAccountId: grvtSubAccountId,
            });
            await db.upsertGrvtCredentials({
              user_id: result.userId,
              ...encrypted,
              last_test_ok: true,
              last_test_error: null,
            });
            console.log('Owner GRVT credentials encrypted and stored from env');
          } catch (cryptoErr) {
            console.warn('Failed to encrypt owner GRVT creds:', cryptoErr);
          }
        }
      } catch (err) {
        console.error('Owner bootstrap failed:', err);
      }
    } else {
      console.log('OWNER_EMAIL/OWNER_INITIAL_PASSWORD not set — skipping owner bootstrap');
    }

    await gridEngine.start();
    console.log('Grid Engine started');
  } catch (error) {
    console.error('Error initializing services:', error);
    process.exit(1);
  }
}

const dashboardOrigins = (process.env.DASHBOARD_ORIGIN ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const crossOriginDashboard = dashboardOrigins.length > 0;

app.use(
  helmet({
    contentSecurityPolicy: process.env.ENABLE_CSP === '0'
      ? false
      : {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://accounts.google.com'],
            frameSrc: ["'self'", 'https://accounts.google.com'],
            connectSrc: ["'self'", 'https://accounts.google.com', 'wss:', 'ws:'],
            imgSrc: ["'self'", 'data:', 'https://accounts.google.com'],
            styleSrc: ["'self'", "'unsafe-inline'"],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
          },
        },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: crossOriginDashboard
      ? { policy: 'cross-origin' }
      : undefined,
    crossOriginOpenerPolicy: crossOriginDashboard
      ? { policy: 'same-origin-allow-popups' }
      : undefined,
  })
);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && dashboardOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization, Content-Type, X-Api-Key'
    );
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PATCH,PUT,DELETE,OPTIONS'
    );
  }
  if (req.method === 'OPTIONS' && origin && dashboardOrigins.includes(origin)) {
    res.status(204).end();
    return;
  }
  next();
});
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
  });
});

app.get('/', (_req, res) => {
  res.redirect('/dashboard/');
});

const dashV2Candidates = [
  process.env.DASHBOARD_V2_DIST,
  '/opt/grvt-grid-bot/dashboard-dist',
  path.join(__dirname, '..', '..', 'dashboard-dist'),
].filter((p): p is string => !!p);
const dashV2Path = dashV2Candidates.find((p) => {
  try { return fs.existsSync(path.join(p, 'index.html')); } catch { return false; }
});
if (dashV2Path) {
  app.use('/dashboard', express.static(dashV2Path, {
    setHeaders: (res, filePath) => {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate');
      }
    },
  }));
  app.get(/^\/dashboard(\/.*)?$/, (req, res, next) => {
    if (path.extname(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.sendFile(path.join(dashV2Path, 'index.html'), (err) => {
      if (err) next(err);
    });
  });
  console.log(`Serving dashboard from: ${dashV2Path}`);
} else {
  console.log('Dashboard not deployed (no dashboard-dist found)');
}

let v2RouterRef: express.Router | null = null;
export function setV2Router(router: express.Router): void {
  v2RouterRef = router;
}
app.use('/api/v2', (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (v2RouterRef) {
    v2RouterRef(req, res, next);
  } else {
    res.status(503).json({ error: 'v2 surface not configured', hint: 'set DASHBOARD_API_KEY' });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Dashboard error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

process.on('SIGINT', async () => {
  try {
    await gridEngine.stop();
    await db.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  try {
    await gridEngine.stop({ preserveOrders: true });
  } catch (stopErr) {
    console.error('Error stopping engine during SIGTERM:', stopErr);
  }
  await db.close();
  process.exit(0);
});

async function startServer() {
  try {
    await initializeServices();

    const httpServer = createServer(app);
    const apiKey = process.env.DASHBOARD_API_KEY;
    if (apiKey && apiKey.length >= 16) {
      mountV2({
        setRouter: setV2Router,
        httpServer,
        db: db.getRawDb(),
        gridBotDb: db,
        grvtClient,
        engine: gridEngine,
        apiKey
      });
      console.log('v2 surface mounted: REST /api/v2/* + WebSocket /ws');
    } else {
      console.log('v2 surface DISABLED (set DASHBOARD_API_KEY to a 16+ char string to enable)');
    }

    httpServer.listen(PORT, () => {
      console.log(`Toro dashboard http://localhost:${PORT}`);
      console.log('Grid Engine: started');
    });
  } catch (error) {
    console.error('Failed to start dashboard server:', error);
    process.exit(1);
  }
}

startServer();
