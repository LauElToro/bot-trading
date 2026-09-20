# Security Policy

Para quien corre esta instancia (Toro) o un self-host propio.

## Qué guarda el software

Cuando creás una cuenta y conectás GRVT, el bot almacena:

- Tu email.
- Un hash **bcrypt** (cost 12) de tu contraseña. El plaintext no se escribe a disco.
- API key, secret, trading address, account ID y sub-account ID de GRVT, **cifrados en reposo con AES-256-GCM**. Cada fila tiene un IV aleatorio de 12 bytes.

La clave maestra de 32 bytes vive en disco en `/etc/grvt-grid/master.key` (o `$MASTER_KEY_PATH`), permisos `0600`.

## Qué cubre el cifrado

- Robo de la DB sin `master.key`.
- Backups (solo ciphertext).
- Lectura casual con `sqlite3`.
- Tampering silencioso del ciphertext (tag GCM).

## Qué NO cubre

- Un operador o atacante con root en el servidor: puede leer `master.key` y descifrar credenciales.
- Compromiso total del host.

Si no querés que nadie más tenga acceso técnico a tus claves, corré tu propia instancia.

## Reporting

No abras un issue público. Usá **Report a vulnerability** en [LauElToro/bot-trading](https://github.com/LauElToro/bot-trading/security).

## Fuera de alcance

- Acceso físico al servidor.
- Extensiones de browser maliciosas.
- DoS a capa de aplicación.
- Fallos de GRVT, SMTP o el hosting.

## Notas de código (fixes ya incluidos)

- Auth del dashboard: JWT en el browser. `X-Api-Key` solo si `ALLOW_LEGACY_API_KEY=1` (o `NODE_ENV=test`).
- WebSocket autentica con el primer frame `{ type: "auth", token }`, no con query string.
- `/api/v2/balance` y `grid-state` usan el cliente GRVT del usuario, no el del operador.
- Signup se puede cerrar con `SIGNUP_DISABLED=1`.
- `pause` / `close` cancelan siempre vía el cliente GRVT del dueño, aunque el bot no esté en memoria, y el close reintenta el cierre de posición.
