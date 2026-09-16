# Toro

Bot grid de [LauElToro](https://github.com/LauElToro) para futuros perpetuos de [GRVT](https://grvt.io/?ref=5LBBEMJ). Autohospedable, con dashboard en tiempo real, alertas por Telegram y credenciales API cifradas por usuario.

Si todavía no tenés cuenta en GRVT, creala con mi referido: **[grvt.io/?ref=5LBBEMJ](https://grvt.io/?ref=5LBBEMJ)**

## Uso

```bash
git clone https://github.com/LauElToro/bot-trading.git
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

Datos en SQLite (`data/grid_bot.db`). Passwords con bcrypt; credenciales GRVT cifradas con AES-256-GCM. Ver [SECURITY.md](SECURITY.md).

## Seguridad

No abras issues públicos para vulnerabilidades. Escribí a la pestaña Security del repo: [LauElToro/bot-trading](https://github.com/LauElToro/bot-trading).
