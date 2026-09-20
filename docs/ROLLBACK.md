# Deploy & Rollback

## Deploy procedure

```bash
# 1. Build locally
npm run build --workspace=@grvt-grid/bot
npm run build --workspace=@grvt-grid/dashboard

# 2. Create tarball
tar czf deploy.tar.gz packages/bot/dist/ packages/bot/src/ packages/dashboard/dist/

# 3. Upload to VPS
scp deploy.tar.gz root@YOUR_VPS:/tmp/

# 4. On VPS: backup current → extract new → restart
ssh root@YOUR_VPS
cd /opt/grvt-grid-bot
cp -r dist/ .rollback-dist-$(date +%s)
cp -r src/ .rollback-src-$(date +%s)
systemctl stop grvt-grid-bot
tar xzf /tmp/deploy.tar.gz --strip-components=2 -C . packages/bot/dist packages/bot/src
chown -R grvtbot:grvtbot dist/ src/
systemctl start grvt-grid-bot
systemctl is-active grvt-grid-bot
```

## Rollback procedure

If a deploy breaks the bot:

```bash
ssh root@YOUR_VPS
cd /opt/grvt-grid-bot

# Find the latest backup
ls -lt .rollback-dist-* | head -1
# Example: .rollback-dist-1776012341

# Restore
systemctl stop grvt-grid-bot
rm -rf dist/ src/
cp -r .rollback-dist-1776012341 dist/
cp -r .rollback-src-1776012341 src/
chown -R grvtbot:grvtbot dist/ src/
systemctl start grvt-grid-bot
```

## Verify after deploy

```bash
# Check service
systemctl is-active grvt-grid-bot

# Check logs (last 20 lines)
tail -20 /var/log/grvt-grid-bot/server.log

# Check health
curl -s http://localhost:3848/api/v2/metrics | head -5

# Check bot 44 is running
curl -s -H "X-Api-Key: YOUR_KEY" http://localhost:3848/api/v2/bots | python3 -m json.tool | grep status
```

## Database backup before risky deploys

Always backup the DB before deploying schema changes:

```bash
export DATABASE_URL='postgresql://...'
pg_dump --format=custom --no-owner --no-acl \
  --file="/var/backups/grvt-grid-bot/pre-deploy-$(date +%s).dump" \
  "$DATABASE_URL"
```

Restore into a separate PostgreSQL database first and verify it before
changing `DATABASE_URL`. During the SQLite-to-PostgreSQL cutover, follow
[`MIGRATION-POSTGRES.md`](MIGRATION-POSTGRES.md).
