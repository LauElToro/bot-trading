# Migrar Toro a otro Cursor / otro server

Fecha de este paquete: 2026-09-20.

## Qué incluye el zip

- Código del monorepo (bot, dashboard, notifier, docs, Docker).
- Historial Git (carpeta `.git`) si estaba presente al empaquetar.
- Skills de Cursor copiadas en `cursor-export/skills-cursor/`.
- Skill de proyecto en `.cursor/skills/toro-project/`.
- `.env.example` (plantillas). **No hay secretos reales.**

## Qué NO incluye (a propósito)

- `.env`, `.env.local` y cualquier credencial.
- `node_modules/`
- `dist/`
- Bases SQLite locales (`data/*.db`)
- Conversaciones completas del chat anterior

## Restaurar en el otro server

1. Descomprimir.
2. Instalar Node 22+.
3. Copiar `cursor-export/skills-cursor/` a `~/.cursor/skills-cursor/` (Windows: `%USERPROFILE%\.cursor\skills-cursor\`).
4. Abrir la carpeta del proyecto en Cursor.
5. `npm ci` en la raíz.
6. Copiar `.env.example` → `.env` y completar con los secretos reales del server (DB, JWT, SMTP, master key).
7. En el dashboard, si el SPA vive en otro origen que el bot:

```env
VITE_API_BASE_URL=https://api-o-dominio-del-bot
```

8. Arrancar:

```bash
npm run dev:bot
npm run dev:dashboard
```

O en cluster: build `packages/bot/Dockerfile`, 1 réplica, `DATABASE_URL`, health `/api/health`, puerto 3848.

## Estado al cortar

- Landing + dashboard bilingüe ES/EN.
- Auth OTP email + Google.
- TOS v7.
- Marca blanco/rojo + theme switch.
- Vercel actual (`bot-trading-dashboard-ochre.vercel.app`) solo tiene frontend; signup da 405 sin backend.
- Decisión pendiente de infra: Docker cluster (recomendado) vs Railway/Render. Vercel no corre el motor.

## Usuario / reglas

- Hablar en español.
- No commitear secretos.
- No push/commit salvo que lo pida.
- Código de referido: `HCAQ5ES`.
