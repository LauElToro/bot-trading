# Toro — self-host local (Windows)

El motor es un **grid mecánico**: vos definís rango, niveles, inversión y riesgo. La IA **no elige** par, precios, leverage ni SL/TP.

Para usar Toro necesitás una cuenta GRVT creada con el referido requerido: [grvt.io/?ref=HCAQ5ES](https://grvt.io/?ref=HCAQ5ES)

Docs: [README](README.md), [INSTALL](docs/INSTALL.md), [SECURITY](SECURITY.md).

Ajustes locales para Docker en Windows:

- `packages/dashboard/src/vite-env.d.ts` — tipos de Vite para que compile el SPA.
- `DATABASE_URL` — conexión TLS a un PostgreSQL externo.
- `CREDENTIAL_MASTER_KEY` — clave AES-256 codificada en base64.

## Estado del arranque

| Ítem | Valor |
|------|--------|
| Dashboard | http://localhost:3848/dashboard/ |
| Health | http://localhost:3848/api/health |
| `DRY_RUN` | `true` — si hay sesión GRVT, **no envía órdenes** |
| Master key | `CREDENTIAL_MASTER_KEY` en `.env` |
| DB | PostgreSQL externo (`DATABASE_URL`) |
| Primer usuario | `OWNER_EMAIL` / `OWNER_INITIAL_PASSWORD` en `.env` |

`.env` está en `.gitignore`. No lo commitees.

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
2. Entrá con `OWNER_EMAIL` y `OWNER_INITIAL_PASSWORD` de tu `.env`.
3. Cambiá la contraseña en la UI.
4. **Borrá** `OWNER_INITIAL_PASSWORD` del `.env` y recreá el contenedor: `docker compose up -d`.

## Cuenta operador (trade-only)

Paso a paso para la API de GRVT **sin withdraw**: [`CUENTA-OPERADOR.md`](CUENTA-OPERADOR.md).

## Cómo pasar a GRVT de verdad

El wizard pide **tus** números. No hay defaults de trading inventados acá.

1. Creá la API como en [`CUENTA-OPERADOR.md`](CUENTA-OPERADOR.md): Trading Account + permiso **Trade** solamente.
2. Pegá las credenciales en el dashboard (Conectar GRVT).
3. Dejá `DRY_RUN=true`. Recreá: `docker compose up -d`.
4. En el dashboard: crear bot **pausado**. Completá vos rango, N, inversión, leverage, SL/TP.
5. Usá el **backtest** con tus números antes de capital real.
6. Recién cuando estés conforme: `DRY_RUN=false`, `docker compose up -d`, y **start** desde la UI.

## Qué no hace este setup

- No elige ni “optimiza” rango, N, leverage ni inversión.
- No cancela órdenes de GRVT al parar el contenedor. Cerrar posición/órdenes es desde el dashboard (`pause` / `close`).

## Backups

Guardá fuera de esta PC:

- dumps PostgreSQL generados con `pg_dump`
- `CREDENTIAL_MASTER_KEY` en un password manager

Sin la master key, las credenciales GRVT cifradas en la DB no se pueden descifrar.

## Alertas por email

- El notifier usa las mismas variables SMTP / Gmail que el bot.
- Drawdown, liquidación, cambios de estado y el resumen diario llegan al email de la cuenta.
