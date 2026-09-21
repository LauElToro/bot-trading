# Toro — Self-host install guide

> **Audience**: people who want to run their own Toro bot on their own
> server, with their own GRVT account, with their own keys. **No SaaS.** Your
> trades, your keys, your liability.

Para usar Toro, registrate en GRVT con el referido requerido: [https://grvt.io/?ref=HCAQ5ES](https://grvt.io/?ref=HCAQ5ES)

## Prerequisites

| Requirement | Why |
|---|---|
| **A GRVT account** | Create it with the required referral: [grvt.io/?ref=HCAQ5ES](https://grvt.io/?ref=HCAQ5ES) |
| **A Linux server** (or Mac, or Windows with WSL2) with Docker Engine ≥ 24 and Docker Compose v2 | The whole stack is containerized. No host Node install needed. |
| **2 GB RAM** minimum, 1 vCPU is enough | The bot is ~110 MB, dashboard is static, notifier is tiny. |
| **External PostgreSQL 14+** with TLS | Required for bot state. Set its connection URL in `DATABASE_URL`. |
| **A GRVT API key + secret + sub-account id** | Generate from grvt.io → Account → API Keys |
| **SMTP / Gmail** | Required for OTP login and for trading alerts (drawdown, liquidation, status). |

Existing SQLite installations must complete
[the PostgreSQL migration runbook](MIGRATION-POSTGRES.md) before starting
this version.

## Install

```bash
git clone <URL_PRIVADA_DEL_REPOSITORIO>
cd bot-trading

# 1. Create .env from the template and fill in your credentials
cp .env.example .env
chmod 600 .env
# Edit .env with DATABASE_URL, your GRVT API keys, etc.

# 2. Build and start
docker compose build
docker compose up -d

# 3. Watch the logs until you see "✅ Active bots loaded"
docker compose logs -f bot

# 4. Open the dashboard
open http://localhost:3848/dashboard/
```

## Deployment profiles

`docker-compose.yml` includes the notifier in the default stack. It emails
drawdown, liquidation proximity, status changes, and the daily summary to
the bot owner. Configure the same SMTP / Gmail variables used for OTP.

## Stopping safely

The bot installs a SIGTERM handler that **does not cancel any open GRVT
orders** when it stops. So:

```bash
# Safe — preserves the 93 (or however many) limit orders on GRVT
docker compose stop bot

# Also safe — same thing then removes the container
docker compose down

# Also safe (full restart, keeps orders intact)
docker compose restart bot
```

What you should NOT do:

```bash
# DON'T — sends SIGKILL, no graceful shutdown. Orders are still on GRVT
# (the bot doesn't actively cancel them on signal anyway), but you lose
# any in-flight DB writes and the bot might miss the latest fills on next
# boot.
docker kill grvt-grid-bot
```

## Backups

Run `pg_dump` from a trusted host:

```bash
pg_dump --format=custom --file=grvt-$(date +%F).dump "$DATABASE_URL"
```

Use provider snapshots as a second backup layer and periodically test
`pg_restore` into a separate database.

## Updating

```bash
cd /opt/grvt-grid
git pull
docker compose build
docker compose up -d   # rolling restart, preserves data dir
```

PostgreSQL migrations run automatically on boot.

## Troubleshooting

### "Bot did not become healthy"

Check the logs:

```bash
docker compose logs -f bot
```

Common causes:
- **GRVT_API_KEY / SECRET wrong**: you'll see authentication errors in the
  logs. Re-check the values in `.env`.
- **GRVT account not funded**: the bot won't start trading on a zero balance,
  but health check should still pass. If not, check your sub-account id.
- **Port 3848 already in use**: change `BOT_PORT` in `.env`.
- **Database unavailable**: confirm `DATABASE_URL`, TLS mode and provider
  firewall rules. `/api/health` returns 503 while PostgreSQL is unavailable.

### Dashboard says "GRVT session expired"

Your API key was rotated on grvt.io. Update `GRVT_API_KEY` and
`GRVT_API_SECRET` in `.env`, then `docker compose restart bot`.

### Notifier sends a flood of historical fills on first start

Shouldn't happen — the notifier fast-forwards its cursor on bootstrap. If
it does, stop the notifier, delete its state volume:

```bash
docker compose stop notifier
docker volume rm grvt-grid_notifier-state
docker compose start notifier
```

## Security checklist

Before you point a domain at this and walk away:

- [ ] `.env` permissions are `600` (verify with `ls -la .env`)
- [ ] `DASHBOARD_API_KEY` is at least 32 chars
- [ ] Public deployments use an external HTTPS reverse proxy or VPN
- [ ] Your server's firewall blocks port 3848 from the public internet
- [ ] You've set up nightly `pg_dump` backups and provider snapshots
- [ ] Signup is disabled on private deploys (`SIGNUP_DISABLED=1`) unless
      you intend to host multiple tenants
- [ ] Your GRVT API key is scoped to the trading sub-account only — not the
      master account with withdrawal permissions

## Where things live

```
/opt/grvt-grid/
├── logs/
│   ├── bot/                      ← bot stdout
│   └── notifier/                 ← notifier stdout
├── .env                          ← your secrets
└── docker-compose.yml
```
