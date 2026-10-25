# Medir la apertura con una cuenta real

La medición responde una sola pregunta: **¿cuánto tarda el libro en estar
legible cuando la red de posiciones tarda 2.6 segundos?**

El script abre el libro desde la estantería, frena únicamente
`GET /api/positions`, mide el clic hasta que `.book-content` existe y después
comprueba si la posición remota se aplicó sin prompt.

## Requisitos

- Una cuenta de prueba con un EPUB ya subido. No uses la cuenta personal.
- El EPUB descargado al menos una vez en ese navegador; la pasada de
  calentamiento lo descarga y no se mide.
- Chrome instalado (`channel: "chrome"`).
- La posición remota más nueva que la local, para comprobar el salto.

## Autenticación

La forma más rápida es pegar la cookie en el `.env` de la raíz, al final:

```bash
LECTA_COOKIE='__Secure-better-auth.session_token=...'
```

El script carga `.env` y luego `.env.measure`; una cookie real en `.env` tiene
prioridad. También puedes exportarla en la terminal:

```bash
export LECTA_COOKIE='better-auth.session_token=...'
```

También acepta `LECTA_STATE=auth.json` (storageState de Playwright) o
`LECTA_EMAIL` + `LECTA_PASSWORD` (login por API).

## Preparar el escenario

1. Entra en **otro navegador o perfil** (dispositivo B) con la misma cuenta.
2. Abre el libro, avanza al capítulo 2 y espera el sello de sincronización.
3. Vuelve al dispositivo A, que conserva una posición anterior en IndexedDB.
4. No abras el libro todavía: la medición debe ser la primera apertura tras
   la actualización remota.

La posición remota también se puede sembrar con `PUT /api/positions`, pero
escribe en la cuenta; para la prueba manual basta con el dispositivo B.

## Ejecutar

```bash
BASE_URL=https://lecta.luis-sg9915.workers.dev \
LECTA_COOKIE='better-auth.session_token=...' \
BOOK_TITLE='Don Quijote' \
DELAY_MS=2600 \
RUNS=5 \
pnpm measure:open
```

El script imprime:

```json
{
  "delayMs": 2600,
  "warmUpMs": 420,
  "medianOpenMs": 480,
  "samples": [
    {
      "openMs": 476,
      "firstChapter": "Capítulo uno",
      "positionsStatus": 200,
      "afterSync": "Capítulo dos",
      "prompt": 0,
      "remoteApplied": true
    }
  ],
  "errors": []
}
```

## Criterios

- `medianOpenMs < 1000`: la red no bloquea la primera página.
- `firstChapter` puede ser el inicio local; lo importante es que
  `afterSync` cambie cuando la respuesta llega.
- `prompt === 0`: una posición remota más nueva no abre un conflicto.
- `errors` vacío: sin excepciones de página.
- `warmUpMs` se descarta: incluye la descarga del EPUB si era remoto.

## Qué significa cada número

- **`openMs`**: clic en la tarjeta → `.book-content` adjunto al DOM. No espera
  a `syncPositions`.
- **`afterSync`**: título de la barra superior después de la respuesta
  frenada; si cambió, el lector aplicó la posición remota sin remontarse.
- **`prompt`**: capas de diálogo abiertas al terminar; debe ser 0.

## Si falla

- `openMs` alto y `warmUpMs` alto: el libro se está descargando de R2; ábrelo
  una vez y repite.
- `positionsStatus: 401`: la cookie caducó; renueva `LECTA_COOKIE`.
- `afterSync` no cambia: la posición remota no era más nueva, o el `PUT` del
  dispositivo B no llegó. Revisa el sello de sincronización antes de medir.
- `prompt > 0`: el conflicto sigue interceptando; revisa
  `showPositionPrompt` en `App.tsx`.

## Seguridad

La medición abre libros y puede empujar la posición actual al servidor. Usa
una cuenta de prueba y no la ejecutes contra producción con datos personales.

## Resultado de la primera medición real (2026-10-24)

Cuenta real, `/api/positions` frenado 2.6 s, 5 repeticiones:

| Build | Mediana | Calentamiento | Prompt | Errores |
|---|---:|---:|---:|---:|
| Producción desplegada (anterior) | **3396 ms** | 1466 ms | 0 | ViewTransition |
| Build nuevo servido en local con proxy a la API real | **851 ms** | 1930 ms | 0 | 0 |
| Producción con el build nuevo desplegado | **895 ms** | 1091 ms | 0 | 0 |

El build nuevo cumple `medianOpenMs < 1000`. La producción ya sirve el bundle
nuevo (versión `50ea6a92-5ace-4567-8d41-99fd8b32f90d`) y mide **895 ms** de
mediana con 7 muestras; los cinco endpoints de sync responden 200.

`remoteApplied` quedó en `false` porque la posición remota ya era el capítulo 2,
el mismo lugar donde abrió el libro. El salto remoto se comprobó antes con
sesión simulada; falta sembrar un capítulo distinto en la cuenta real.

## Nota de esquema

La migración se aplicó por partes para esquivar el `SCHEMA CHANGE GC` de
CockroachDB. Estado final verificado:

- `synced_at` existe en las seis tablas, con `NOT NULL` y default de servidor.
- Los seis índices `idx_user_*_synced_at` están creados.
- Las filas viejas se rellenaron desde `updated_at`, `created_at` o `ended_at`.
- `015_server_synced_at.sql` quedó registrada en `lecta_schema_migrations`.

Validación en producción del salto remoto: se sembró una posición local vieja
en el capítulo 1 y se subió una remota al capítulo 2. Al abrir con 2.6 s de
latencia apareció el aviso de conflicto sobre el libro abierto; «Continuar desde
ahí» aplicó la posición (el progreso pasó de `~174m` a `~159m`) sin recargar y
sin errores de página.
