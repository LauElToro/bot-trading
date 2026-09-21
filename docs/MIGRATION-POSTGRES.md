# Migración de SQLite a PostgreSQL

PostgreSQL es la única base de datos de runtime. La herramienta de importación
lee la base SQLite anterior en modo read-only, copia por lotes, conserva IDs y
transforma IDs de usuario enteros legacy a UUIDv4 estables.

## Preparación

1. Cree una base PostgreSQL vacía y guarde su URL TLS en `DATABASE_URL`.
2. Detenga bot y notifier. No migre mientras SQLite recibe escrituras.
3. Haga una copia fría de `grid_bot.db`, incluyendo `-wal` y `-shm` si existen.
4. Instale dependencias de desarrollo con `npm ci`.

Nunca pase la URL en logs o tickets. Use variables de entorno.

## Esquema y simulación

```bash
export DATABASE_URL='postgresql://...'
export SQLITE_PATH='/opt/grvt-grid-bot/data/grid_bot.db'

npm run migrate:postgres --workspace=@grvt-grid/bot -- --schema-only
npm run migrate:postgres --workspace=@grvt-grid/bot -- --dry-run
```

`--dry-run` no escribe datos ni checkpoints. Requiere que `--schema-only` haya
creado previamente el esquema.

## Copia reanudable

```bash
npm run migrate:postgres --workspace=@grvt-grid/bot
```

El progreso queda en `sqlite_migration_checkpoints`. Volver a ejecutar el
comando continúa desde el último lote confirmado. Para limitar una ejecución:

```bash
npm run migrate:postgres --workspace=@grvt-grid/bot -- --table=orders
```

Al terminar, la herramienta ajusta las secuencias y compara conteos y claves
foráneas. Los ciphertext de credenciales GRVT se copian sin descifrarlos ni
volverlos a cifrar.

## Verificación y cutover

```bash
npm run migrate:postgres --workspace=@grvt-grid/bot -- --verify-only
docker compose up -d bot
curl -fsS http://127.0.0.1:3848/api/health
docker compose up -d notifier
```

Compruebe login, listado de bots, estado de grilla y WebSocket antes de
reactivar operaciones. Configure `NOTIFIER_DATABASE_URL` con un rol que tenga
solo `CONNECT`, `USAGE` sobre el schema y `SELECT` sobre las tablas.

## Rollback

No modifique ni elimine el SQLite original durante el cutover. Si falla la
verificación:

1. Detenga los procesos.
2. Restaure la versión anterior del código y su configuración SQLite.
3. Investigue o vacíe la base PostgreSQL de destino.
4. Repita desde el backup; los checkpoints permiten reanudar solo cuando se
   conserva el mismo destino.

Después de que PostgreSQL opere estable y tenga backups `pg_dump` verificados,
archive el SQLite como evidencia histórica de solo lectura.
