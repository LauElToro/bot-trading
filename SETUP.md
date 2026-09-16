# GRVTBot — self-host local (Windows)

Instancia clonada en `e:\GRVTBot`. El motor es un **grid mecánico**: vos definís rango, niveles, inversión y riesgo. La IA **no elige** par, precios, leverage ni SL/TP.

Documentación upstream: [README](https://github.com/kmanus88/GRVTBot), [INSTALL](docs/INSTALL.md), [SECURITY](SECURITY.md).

Parches locales (solo para que Docker arranque en Windows; **no cambian el grid**):

- `packages/dashboard/src/vite-env.d.ts` — tipos de Vite para que compile el SPA.
- `packages/bot/Dockerfile` — `npm rebuild sqlite3 --build-from-source` (el prebuild de npm pedía glibc 2.38; Bookworm tiene 2.36).
- `docker-compose.yml` — monta `secrets/master.key` de solo lectura.

## Estado actual del arranque

Verificado en esta máquina: contenedor `grvt-grid-bot` **healthy**, `GET /api/health` → 200, SPA en `/dashboard/` con título `GRVT Grid`. 0 bots activos (vos creás el primero).

| Ítem | Valor |
|------|--------|
| Dashboard | http://localhost:3848/dashboard/ |
| Health | http://localhost:3848/api/health |
| `MOCK_MODE` | `true` — no autentica contra GRVT |
| `DRY_RUN` | `true` — si hay sesión GRVT, **no envía órdenes** |
| Master key | `secrets/master.key` (32 bytes), montada en el contenedor en `/etc/grvt-grid/master.key` |
| DB | `data/grid_bot.db` (aparece al primer boot) |
| Primer usuario | `OWNER_EMAIL` / `OWNER_INITIAL_PASSWORD` en `.env` |

`.env` y `secrets/` están en `.gitignore`. No los commitees.

## Comandos

```powershell
cd e:\GRVTBot

# Levantar (primera vez construye la imagen; tarda)
docker compose up -d --build

# Logs
docker compose logs -f bot

# Parar SIN cancelar órdenes en GRVT (intencional)
docker compose stop bot

# Bajar contenedores (órdenes en GRVT siguen vivas)
docker compose down
```

## Primer login

1. Abrí http://localhost:3848/dashboard/
2. Entrá con `OWNER_EMAIL` y `OWNER_INITIAL_PASSWORD` de tu `.env` (hoy: `admin@localhost` + la clave generada).
3. Cambiá la contraseña en la UI.
4. **Borrá** `OWNER_INITIAL_PASSWORD` del `.env` y recreá el contenedor: `docker compose up -d`.

## Cuenta operador (trade-only)

Paso a paso para la API de GRVT **sin withdraw**: [`CUENTA-OPERADOR.md`](CUENTA-OPERADOR.md).

## Cómo pasar a GRVT de verdad (vos, no la IA)

El wizard pide **tus** números. No hay defaults de trading inventados acá.

1. Creá la API como en [`CUENTA-OPERADOR.md`](CUENTA-OPERADOR.md): Trading Account + permiso **Trade** solamente.
2. Pegá `GRVT_API_KEY`, `GRVT_API_SECRET`, `GRVT_TRADING_ACCOUNT_ID`, `GRVT_TRADING_ADDRESS` en `.env` **o** en la pantalla de credenciales del dashboard.
3. Dejá `DRY_RUN=true` y pasá `MOCK_MODE=false`. Recreá: `docker compose up -d`.
4. En el dashboard: crear bot **pausado**. Completá vos:
   - Par
   - Dirección long / short
   - Precio inferior / superior
   - Cantidad de grillas
   - Inversión
   - Apalancamiento
   - SL / TP (`sl_pct` / `tp_pct` sobre la inversión)
   - Auto-shift: **off** al principio
   - Grillas virtuales + ventana activa (el exchange topea ~80 órdenes reales)
5. Usá la página de **backtest** del dashboard con **tus** números antes de capital real.
6. Recién cuando estés conforme: `DRY_RUN=false` en `.env`, `docker compose up -d`, y **start** del bot desde la UI.

## Qué no hace este setup

- No elige ni “optimiza” rango, N, leverage ni inversión.
- No toca el bot Bybit en `e:\trade 2.0`.
- No cancela órdenes de GRVT al parar el contenedor. Cerrar posición/órdenes es desde el dashboard (`pause` / `close`).

## Backups

Guardá fuera de esta PC, juntos:

- `data/` (SQLite + WAL)
- `secrets/master.key`

Sin la master key, las credenciales GRVT cifradas en la DB no se pueden descifrar.

## Telegram / HTTPS (después)

- Alertas: `docker compose --profile with-notifier up -d` + `TELEGRAM_*` en `.env`.
- 24/7 en un VPS: mismo `docker-compose.yml`, perfil `with-tls` y dominio en `Caddyfile`.
