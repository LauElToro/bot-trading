# Deploy del dashboard en Vercel

## Project Settings

- **Root Directory:** `packages/dashboard`
- **Framework Preset:** Other
- Los comandos y el directorio de salida se leen desde `vercel.json`.

## Variables de Vercel

Configurar para Production y Preview:

```env
VITE_API_BASE_URL=https://api.tu-dominio.com
VITE_GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
VITE_BASE_PATH=/
```

`VITE_API_BASE_URL` debe ser el origen público del bot, sin `/api/v2` y sin
barra final. El dashboard agrega `/api/v2` y `/ws` automáticamente.

## Variables del servidor del bot

```env
APP_BASE_URL=https://tu-dashboard.vercel.app
DASHBOARD_ORIGIN=https://tu-dashboard.vercel.app
GOOGLE_CLIENT_ID=tu-client-id.apps.googleusercontent.com
```

Para dominio propio, usar ese dominio en `APP_BASE_URL`,
`DASHBOARD_ORIGIN` y en los orígenes autorizados de Google OAuth.
`DASHBOARD_ORIGIN` acepta varios orígenes separados por coma.

SMTP también debe estar configurado: el registro y el login con contraseña
requieren el código OTP enviado por email.

## Rutas verificadas

- `/` — landing pública.
- `/dashboard/login` — login.
- `/dashboard/signup` — registro.
- `/dashboard/reset-password` — recuperación.
- `/dashboard/*` — SPA autenticada.
- `/assets/*` — assets versionados con cache inmutable.
