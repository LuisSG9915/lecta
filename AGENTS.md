# Lecta — notas del proyecto

## Verificación

- `pnpm typecheck` (cliente + worker), `pnpm lint`, `pnpm test`, `pnpm build`.
- `pnpm smoke:auth` corre contra un server vivo; `SMOKE_URL=<url>` para producción.
- `pnpm db:setup` / `pnpm db:auth` aplican esquema y tablas de Better Auth (usan `DATABASE_URL` de `.env`).

## Producción

- URL: `https://lecta.luis-sg9915.workers.dev` — deploy con `pnpm run deploy`.
- **Hyperdrive `lecta-db` (id `0b4288d9…`) tiene el cache DESACTIVADO a propósito.**
  Con cache activado, una verificación de existencia (`findUserByEmail`) quedó
  servida en stale ~60 s y `request-password-reset` no creaba el token para un
  usuario recién registrado. Además una sesión revocada podía seguir válida
  desde el cache. No reactivar el caching sin aislar auth de las lecturas.
- Secrets en el worker: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `DEEPSEEK_API_KEY`,
  `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `AI_GATEWAY_KEY`, `AI_GATEWAY_URL`.
  `secrets.required` en `wrangler.jsonc` controla cuáles llegan al `env` en dev
  — si una var no está ahí, el worker no la ve (bug ya corregido con Resend).
- AI Gateway `lecta` (`gateway.ai.cloudflare.com/v1/<account>/lecta/deepseek`):
  sin auth propia (cada request lleva `DEEPSEEK_API_KEY`), `byok_only` para no
  tocar facturación unificada, cache apagado y rate limit solo como tope de
  emergencia. El `cfut_` de `AI_GATEWAY_KEY` quedó huérfano de un gateway que no
  existe y hoy es decorativo — si se activa `authentication` en el gateway hay
  que generar un token nuevo desde el dashboard. `AI_GATEWAY_URL` vacío cae a
  `api.deepseek.com` directo.
- `RESEND_FROM_EMAIL` usa `onboarding@resend.dev`: Resend solo entrega al
  correo dueño de la cuenta hasta verificar un dominio propio.
- `BETTER_AUTH_URL` no se fija en prod: el código cae al origen de la petición.

## Cuentas y correo

- Magic link (10 min), correo+contraseña, "olvidé contraseña" y borrado de
  cuenta con verificación por correo. El enlace de borrado **exige la misma
  sesión** que lo pidió (Better Auth valida token contra sesión activa).
- `beforeDelete` purga `books/<userId>/` de R2; `lecta_user_words` y
  `lecta_rate_log` caen por `ON DELETE CASCADE`.
- IndexedDB separado por cuenta (`lecta` anónimo, `lecta:u:<id>` por usuario);
  al entrar sesión migra lo anónimo a la cuenta.

## Datos

- Bases separadas: **prod usa `lecta`** (vía Hyperdrive) y **dev usa `lecta_dev`**.
  `.env` apunta `DATABASE_URL` a `lecta_dev` y define
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` — sin esa var, el
  binding de Hyperdrive en dev túnelaba a la base de producción.
  `pnpm dev` debe reiniciarse tras cambiar `.env` (las vars se leen al arrancar).
- `lecta_dev` arrancó con esquema + auth + seed, sin usuarios: en dev hay que
  registrarse de nuevo (el correo es el mismo dominio, es solo otra base).
- `defaultdb` pertenece a otro proyecto (POS): no tocar sus tablas.
- EPUBs de prueba con copyright están en `.gitignore` (`/src/*.epub`,
  `/fixtures/*.epub` salvo `minimal.epub`).
