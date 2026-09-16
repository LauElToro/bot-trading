# Cuenta operador — solo trading, sin retiro

Yo **no puedo** crear tu API de GRVT: hace falta tu login en [app.grvt.io](https://app.grvt.io) y confirmar en la wallet. Lo que sí está listo es la cuenta local del bot y el modelo correcto de permisos.

El cliente del bot (`packages/bot/src/api/client.ts`) solo habla de: balance, posiciones, órdenes, fills, funding **histórico** (lectura) y leverage. **No hay** withdraw, internal transfer ni external transfer.

Permisos de una API key GRVT ([docs](https://api-docs.grvt.io/builder_codes/)):

| Permiso | ¿Para este bot? |
|---------|-----------------|
| **Trade** | Sí — único necesario |
| Admin | No |
| Internal Transfer | No |
| External Transfer | No |
| **Withdraw** | No |
| Vault Investor | No |

## 1. Cuenta local (ya creada)

| Campo | Valor |
|-------|--------|
| Dashboard | http://localhost:3848/dashboard/ |
| Email | `admin@localhost` |
| Password | `OWNER_INITIAL_PASSWORD` en `e:\GRVTBot\.env` |
| Modo | `MOCK_MODE=true` + `DRY_RUN=true` (sin órdenes reales) |

Después del primer login: cambiá la contraseña y borrá `OWNER_INITIAL_PASSWORD` del `.env`.

No pegues secretos de GRVT en el chat.

## 2. Cómo crear la API key en GRVT (vos)

Guía oficial: [How do I generate an API Key?](https://help.grvt.io/en/articles/9636561-how-do-i-generate-an-api-key)

1. Entrá a [app.grvt.io](https://app.grvt.io).
2. Creá o usá un **Trading Account / sub-account** de trading (no el vault / funding master).
3. Depositá ahí solo el capital que estés dispuesto a operar. El retiro lo hacés **vos a mano** desde la web, nunca el bot.
4. Arriba a la derecha → tu inicial → **Overview → API Keys** → **Create**.
5. Elegí **ese Trading Account** (no la cuenta funding).
6. Elegí **Generate** (que GRVT cree un par wallet-key **nuevo**). No uses tu SecureKey principal ni una wallet con fondos afuera.
7. Label: `grvtbot-trade-only`.
8. Si la UI muestra checkboxes de permisos, marcá **solo Trade**. Dejá destildados:
   - Withdraw
   - Internal Transfer
   - External Transfer
   - Admin
   - Vault Investor
9. Confirmá en la wallet. **Copiá ya** (se muestran una sola vez):
   - **API Key**
   - **Secret Private Key** (`0x` + 64 hex) → esto es `API Secret` en el bot
   - **Trading Address** (address `0x` de esa API key, 40 hex)
   - **Trading ID / Sub-Account ID** (el de esa fila)
   - **Account ID** (si la UI lo muestra aparte; si no, usá el mismo Trading ID)

Guardá eso en un password manager. Si perdés el secret, borrá la key y creá otra.

## 3. Dónde pegarlo (no en `.env` de funding)

En el dashboard, tras el login: **Conectar GRVT** (`/dashboard/onboarding/grvt`):

| Campo del wizard | Qué pegás |
|------------------|-----------|
| API Key | API Key |
| API Secret | Secret Private Key `0x…` (64 hex) |
| Trading Address | address `0x…` de esa key |
| Account ID | Account ID / Trading ID |
| Sub-Account ID | El mismo Trading ID si tenés una sola sub-cuenta |

**No completes** `GRVT_FUNDING_*` en `.env`. Eso es la cuenta vault; no hace falta para operar y no la queremos en el servidor.

Tampoco pongas una key del **master account** con withdraw.

## 4. Después de pegar las credenciales

1. Dejá `DRY_RUN=true`, pasá `MOCK_MODE=false`, `docker compose up -d`.
2. El wizard de grid lo completás **vos** (par, rango, N, inversión, leverage, SL/TP). Yo no elijo esos números.
3. Recién cuando el backtest del dashboard te cierre: `DRY_RUN=false` y start desde la UI.

## 5. Checklist rápido

- [ ] Key creada sobre **Trading Account**, no vault
- [ ] Permiso **Trade** solamente
- [ ] Withdraw / transfers / Admin / Vault **off**
- [ ] `GRVT_FUNDING_*` vacío
- [ ] Secret no commiteado ni enviado por chat
- [ ] Capital de trading separado del resto
