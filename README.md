# Toro

Bot grid privado de LauElToro para futuros perpetuos de [GRVT](https://grvt.io/?ref=HCAQ5ES), con dashboard en tiempo real, alertas por Telegram y credenciales API cifradas por usuario.

Para usar Toro, creá tu cuenta GRVT con el referido requerido: **[grvt.io/?ref=HCAQ5ES](https://grvt.io/?ref=HCAQ5ES)**

## Uso

```bash
git clone <URL_PRIVADA_DEL_REPOSITORIO>
cd bot-trading
npm install
npm run build
```

En Windows, el flujo local está en [SETUP.md](SETUP.md). Instalación en servidor: [docs/INSTALL.md](docs/INSTALL.md).

## Qué hace

- **Grid trading**: rango, N niveles, reemplazo de fills, compounding, SL/TP, auto-shift y backtest.
- **Grilla virtual**: rango más ancho que el tope de ~80 órdenes de GRVT; el bot mueve una ventana activa alrededor del precio.
- **Multi-usuario**: cada cuenta usa sus propias credenciales GRVT y sus propios bots.
- **Dashboard**: equity, stats, fills, posición, PnL. Updates por WebSocket.
- **Telegram** (opcional): fills, drawdown, proximidad de liquidación, resumen diario.

## Arquitectura

```
packages/
  bot/        Motor + API REST + WebSocket
  dashboard/  SPA (Vite + React + Tailwind)
  notifier/   Alertas Telegram
```

Datos en PostgreSQL externo mediante `DATABASE_URL`. Passwords con bcrypt;
credenciales GRVT cifradas con AES-256-GCM. Para instalaciones anteriores,
ver [migración desde SQLite](docs/MIGRATION-POSTGRES.md) y
[SECURITY.md](SECURITY.md).

## Seguridad

No publiques vulnerabilidades. Contactá directamente al operador de Toro.
