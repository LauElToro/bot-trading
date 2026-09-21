---
name: toro-project
description: >-
  Contexto operativo de Toro (GRVT grid bot). Usar al continuar desarrollo,
  deploy, auth, TOS, marca, Vercel o Docker.
---

# Toro — contexto de migración

Producto: **Toro**, bot de grid trading para futuros perpetuos de GRVT.
No es open source. No hay links a GitHub en la UI.

## Arquitectura

- Monorepo npm workspaces: `packages/bot`, `packages/dashboard`, `packages/notifier` (alertas por email).
- Frontend: React + Vite en `packages/dashboard`. Landing `/`, app `/dashboard`.
- Backend: Express + WebSocket + grid engine en `packages/bot`. Puerto `3848`.
- DB: PostgreSQL externo (`DATABASE_URL`). Ya existe; no recrear.
- Auth: email+password + OTP por SMTP, Google Sign-In, JWT.
- Referido obligatorio: `HCAQ5ES`. URL GRVT: `https://grvt.io/?ref=HCAQ5ES`.
- TOS vigentes: `2026-09-20-v7` en `packages/bot/src/server/v2-router.ts`.
  El dashboard embebe una copia en build (`vite.config.ts` lee ese archivo).

## Marca

- Fondo claro blanco por defecto. Switch claro/oscuro persistente (`toro-ui`).
- Color de marca: rojo (`#dc2626` / `#ef4444` en dark).
- No usar verde ni dorado como acento de marca.

## Deploy

- Vercel solo sirve el SPA estático. **No** ejecuta el bot ni WebSockets.
- El `405` en `/api/v2/auth/signup` ocurre si el frontend pega a Vercel sin `VITE_API_BASE_URL`.
- Un Docker cluster **sí** alcanza si corre `packages/bot/Dockerfile` con **1 réplica**,
  PostgreSQL, healthcheck `/api/health`, puerto `3848`, HTTPS y env completas.
- Antes de build Docker, la etapa `dashboard-builder` debe copiar
  `packages/bot/src/server/v2-router.ts` porque Vite extrae los TOS de ahí.

## Google

Client ID público por defecto:

`418588773651-rm0lf2p90h6slvp4rpr0utgsluerensh.apps.googleusercontent.com`

Orígenes autorizados deben incluir el dominio real (Vercel o el del cluster).
El botón no debe ocultarse: si falta config, mostrar estado.

## Registro

- Código de referido fijo, no es un input editable.
- El backend valida `referral_code === HCAQ5ES`.
- TOS se pueden aceptar aunque falle `GET /auth/tos` (fallback embebido).
- SMTP es obligatorio para signup/login por email (OTP).

## Seguridad / TOS

Toro no custodia fondos. Operación solo en GRVT. No usar Withdraw/Transfer.
Limitación de responsabilidad en la máxima medida permitida por ley.

## Reglas de trabajo

- Responder en español.
- No commitear `.env` ni secretos.
- No crear commits ni PRs salvo pedido explícito.
- Verificar UI en browser cuando cambie comportamiento visible.
