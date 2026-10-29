# Observabilidad de errores — apartado propio y librerías OSS

Fecha: 2026-10-29. Estado: **aplicado el 2026-10-29** — el diseño de abajo es el que quedó en el
código, con los tres ajustes pedidos (ruta normalizada antes de hashear, muestra de 3 frames +
mensaje + versión, y purga de 30 días en el cron). Ver §5 para el inventario final y las
diferencias respecto a la propuesta.

Resumen: el proyecto ya tiene captura de errores de punta a punta (cliente, React y worker),
pero **no tiene agrupación, histórico ni detección automática**: todo cae en Workers Logs
(retención de días, sin contadores) y en un `localStorage` de 5 entradas. "Poner un apartado"
significa añadir huella + contador + vista + aviso, no añadir otra captura.

---

## 1. Lo que ya existe (no reinventar)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Reporter de cliente | `src/client/lib/client-errors.ts:45` (`reportClientError`) | Allowlist `name`/`code`/`route`/`version` (+`message` si el flag está activo), 1 huella por sesión, ≤5 envíos por carga |
| Enganche global | `src/client/lib/client-errors.ts:103` (`installClientErrorReporting`) | `window.error` + `unhandledrejection` |
| Captura React | `src/client/components/ErrorBoundary.tsx:14` (`logErrorToStorage`) | `localStorage` `lecta_error_log_v1`, máx. 5 (`:5`), con stack |
| Endpoint | `src/worker/app.ts:235` `POST /api/client-errors` | Sin sesión y sin base de datos; saneado en `src/worker/client-errors.ts:55` (`sanitizeRoute`), tope por isolate en `:140` (`allowClientError`: 30/min, 300/h) |
| Errores de servidor | `src/worker/app.ts:120` `app.onError` | `console.error("[worker-error] …", {name, code, message})` → Workers Logs |
| UI | `src/client/components/DiagnosticsModal.tsx:364` | «Registro de errores recientes (n)» — **solo este dispositivo**, 5 entradas, sin agrupar ni contar |
| Cron diario | `src/worker/index.ts:9` `scheduled` | Ya existe: sirve para el aviso automático |

Huecos concretos: (1) no hay huella estable → el mismo bug aparece como N errores distintos;
(2) nada persiste el conteo; (3) el usuario solo ve su dispositivo; (4) nadie avisa cuando algo
empieza a fallar; (5) el worker no tiene stack ni contexto más allá de 3 campos.

---

## 2. Librerías OSS, con veredicto para este proyecto

| Proyecto | Licencia | Aporta | Coste real | Veredicto |
|---|---|---|---|---|
| **Bugsink** | BSD-3 | Backend compatible con Sentry (recibe envelopes), agrupa por huella, UI propia | 1 contenedor + SQLite, ~200 MB RAM | **Mejor opción self-hosted**: setup en minutos, sin Postgres/Redis extra |
| **GlitchTip** | MIT | Backend compatible con Sentry, proyectos, alertas por correo, más maduro | web + worker + Postgres + Redis, ~1 GB RAM | Alternativa si quieres multi-proyecto y alertas ya hechas |
| `@sentry/cloudflare` (SDK) | MIT | Instrumentación del worker: stack, breadcrumbs, traza ligera | ~0 kB en el bundle del cliente; suma al worker | **Sí**, con DSN opcional: si falta el secret, no inicializa |
| `@sentry/browser` (SDK) | MIT | Errores de navegador llave en mano | ~30 kB gzip al bundle inicial | **No**: el margen es `201.27 / 215 kB` (`scripts/check-bundle-budget.mjs:9`). El reporter propio ya hace el 90 % |
| Sentry self-hosted | FSL (ya no OSS) | Suite completa | ClickHouse + Kafka + Relay | No |
| `highlight.io` | Apache-2.0 | Sesiones + errores + trazas | ClickHouse + Kafka | No: demasiado para 1 worker |
| OpenTelemetry + Tempo/Loki | Apache-2.0 | Estándar, exportable a cualquier backend | Montaje serio | No por ahora |

Nota de honestidad técnica: con `@sentry/cloudflare` los stacks del cliente siguen llegando
minificados; lo que los hace legibles es subir sourcemaps al backend (Bugsink/GlitchTip los
acepta). Sin sourcemaps, la huella sigue sirviendo para **agrupar y contar**, no para leer el código.

---

## 3. Diseño recomendado (3 piezas, 1 día)

1. **Huella en servidor** (`name|code|route|frame` → SHA-256 truncado) y UPSERT de contadores:
   es lo que convierte «un lío de logs» en «412 fallos de esta firma en v0.2.6».
2. **Apartado en el producto**: bloque «Salud de la aplicación» en Diagnóstico, con las huellas
   de los últimos N días, primera/última vez, versión y ruta. Sirve también con la sesión del
   dueño, así que se ve desde el móvil sin abrir el dashboard de Cloudflare.
3. **Aviso automático** desde el cron de las 05:00 que ya existe: si una huella **nueva** cruza
   el umbral, correo por Resend (infra ya cableada). Eso es «detectar errores automáticamente».

### 3.1 Migración `db/migrations/018_error_signatures.sql`

```sql
CREATE TABLE IF NOT EXISTS lecta_error_signatures (
  bucket_day DATE        NOT NULL,
  signature  STRING      NOT NULL,
  route      STRING      NOT NULL,
  name       STRING      NOT NULL,
  code       STRING      NOT NULL DEFAULT '',
  version    STRING      NOT NULL DEFAULT '',
  hits       INT8        NOT NULL DEFAULT 0,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT lecta_error_signatures_pk PRIMARY KEY (bucket_day, signature)
);

-- Una fila por (día, huella): el coste lo fija el número de huellas distintas,
-- no el número de errores. El UPSERT del endpoint está topado a 30/min/isolate.
```

Aplicar con el procedimiento habitual **solo en `lecta_dev`** (`LECTA_MIGRATE_TARGET`,
`AGENTS.md`); recordar que cada DDL dispara un `SCHEMA CHANGE GC` y CockroachDB serializa
cambios de esquema — si se cuelga, `SHOW JOBS` antes de tocar nada. Bloquear la tabla al final
(`ALTER TABLE lecta_error_signatures SET (schema_locked = true)`).

### 3.2 `src/worker/error-signatures.ts` (nuevo)

```ts
import { withClient, type WorkerEnv } from "./db";

export const ERROR_SIGNATURE_MAX_DAYS = 30;

export interface ErrorSignatureInput {
  name: string;
  code: string;
  route: string;
  version: string;
  frame?: string;
}

export interface ErrorSignatureRow {
  signature: string;
  day: string;
  route: string;
  name: string;
  code: string;
  version: string;
  hits: number;
  firstSeen: string;
  lastSeen: string;
}

/** Huella estable: mismo bug ⇒ misma cadena, aunque cambie el mensaje. */
export async function fingerprint(input: ErrorSignatureInput): Promise<string> {
  const seed = [input.name, input.code, input.route, input.frame ?? ""].join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return [...new Uint8Array(digest).slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function recordErrorSignature(
  env: WorkerEnv,
  input: ErrorSignatureInput,
  now = new Date(),
): Promise<void> {
  const signature = await fingerprint(input);
  const day = now.toISOString().slice(0, 10);
  await withClient(env, (client) =>
    client.query(
      `INSERT INTO lecta_error_signatures
         (bucket_day, signature, route, name, code, version, hits, first_seen, last_seen)
       VALUES ($1::DATE, $2, $3, $4, $5, $6, 1, now(), now())
       ON CONFLICT (bucket_day, signature) DO UPDATE SET
         hits       = lecta_error_signatures.hits + 1,
         last_seen  = now(),
         version    = excluded.version,
         route      = excluded.route`,
      [day, signature, input.route, input.name, input.code, input.version],
    ),
  );
}

export async function listErrorSignatures(
  env: WorkerEnv,
  days = 7,
): Promise<ErrorSignatureRow[]> {
  const window = Math.min(Math.max(days, 1), ERROR_SIGNATURE_MAX_DAYS);
  return withClient(env, async (client) => {
    const result = await client.query(
      `SELECT signature,
              max(bucket_day)::STRING AS day,
              max(route)    AS route,
              max(name)     AS name,
              max(code)     AS code,
              max(version)  AS version,
              sum(hits)::INT8 AS hits,
              min(first_seen)::STRING AS first_seen,
              max(last_seen)::STRING  AS last_seen
         FROM lecta_error_signatures
        WHERE bucket_day >= current_date - $1::INT8
        GROUP BY signature
        ORDER BY hits DESC
        LIMIT 100`,
      [window],
    );
    return result.rows.map((row) => ({
      signature: String(row.signature),
      day: String(row.day),
      route: String(row.route),
      name: String(row.name),
      code: String(row.code ?? ""),
      version: String(row.version ?? ""),
      hits: Number(row.hits),
      firstSeen: String(row.first_seen),
      lastSeen: String(row.last_seen),
    }));
  });
}
```

### 3.3 Endpoint en `src/worker/app.ts` (junto al de `client-errors`, `:260`)

```ts
// Solo el dueño: el agregado es global, no por usuario.
app.get("/api/error-reports", async (context) => {
  const user = await getSessionUser(context).catch(() => null);
  const owner = context.env?.LECTA_OWNER_EMAIL?.toLowerCase();
  if (!user || !owner || user.email?.toLowerCase() !== owner) {
    return context.body(null, 404); // 404 y no 403: no se anuncia la ruta
  }
  const days = Number(context.req.query("days") ?? 7) || 7;
  return context.json({ days, rows: await listErrorSignatures(context.env, days) });
});
```

`LECTA_OWNER_EMAIL` es un secret nuevo (hoy no existe): hay que añadirlo a `secrets.required`
de `wrangler.jsonc` **y** a `.env`, o el worker no lo verá en dev (el bug de Resend descrito en
`AGENTS.md`). Sin ese secret la ruta responde 404 y el apartado queda oculto: falla cerrado.

Y dentro del `POST /api/client-errors` existente, **después** del `console.error(JSON.stringify(report))`
de `src/worker/app.ts:258`, sin tocar el contrato 204:
```ts
context.executionCtx.waitUntil(
  recordErrorSignature(context.env, {
    name: report.name,
    code: report.code,
    route: report.route,
    version: report.version,
    frame: report.frame, // ver 3.4
  }).catch(() => undefined),
);
```

Los límites no cambian: sigue siendo rechazo silencioso con 204 y el tope por isolate acota las
escrituras a 30/min por isolate. Si `withClient` falla, se traga el error: reportar nunca rompe la app.

### 3.4 Cliente: un campo más, cero librerías

En `src/worker/client-errors.ts` añadir `frame` a `ClientErrorReport` (máx. 80, opcional) y en
`src/client/lib/client-errors.ts` calcularlo desde el stack antes de enviar:

```ts
function topFrame(stack?: string): string | undefined {
  if (!stack) return undefined;
  const line = stack.split("\n").find((entry) => /\.(js|tsx?):/.test(entry));
  const match = line?.match(/([^/\\()\s]+\.(?:js|tsx?)):(\d+)/);
  return match ? `${match[1]}:${match[2]}` : undefined;
}
```

Sin esto la huella se queda en `name|code|route` y dos bugs distintos de `/reader` se fusionan.
Con sourcemaps en el backend (Bugsink/GlitchTip) además se lee el frame real.

### 3.5 Apartado en Diagnóstico (`src/client/components/DiagnosticsModal.tsx:363`)

Reemplazar el bloque «Registro de errores recientes» por dos pestañas, manteniendo el registro
local como pestaña «Este dispositivo»:

- **Este dispositivo** — lo actual (`getStoredErrorLogs`, 5 entradas).
- **Servidor (7 días)** — `GET /api/error-reports?days=7`, tabla: huella, nombre, ruta, versión,
  veces, primera/última. Si responde 404 (no es el dueño), la pestaña no se muestra.

```tsx
const [serverErrors, setServerErrors] = useState<ErrorSignatureRow[] | null>(null);
useEffect(() => {
  let alive = true;
  void fetch("/api/error-reports?days=7")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => { if (alive) setServerErrors(data?.rows ?? []); })
    .catch(() => { if (alive) setServerErrors([]); });
  return () => { alive = false; };
}, []);
```

### 3.6 Aviso automático (lo que hace que sea «detección»)

En `src/worker/index.ts:9`, tras la limpieza actual, dentro del mismo `waitUntil`:

```ts
const nuevas = await client.query(
  `SELECT signature, name, route, version, sum(hits)::INT8 AS hits
     FROM lecta_error_signatures
    WHERE bucket_day = current_date - 1
    GROUP BY signature, name, route, version
   HAVING sum(hits) >= $1
      AND min(first_seen) >= now() - INTERVAL '2 days'`,
  [ALERT_MIN_HITS], // 5
);
if (nuevas.rows.length > 0) await sendErrorDigest(env, nuevas.rows); // Resend ya cableado
```

Plus: purga de filas viejas en el mismo cron (`DELETE … WHERE bucket_day < current_date - 30`).

---

## 4. Coste y verificación

- **RUs**: 1 UPSERT por reporte aceptado (≤30/min/isolate, en la práctica decenas/día) y una
  lectura por apertura de Diagnóstico. Una fila por día y huella; con 30 días de retención son
  cientos de filas. Nada frente a `lexicon_*`.
- **Bundle**: 0 kB nuevos en el cliente (la tabla se pinta con `style` inline, como el resto del
  modal). `@sentry/cloudflare` solo afecta al worker.
- **Puerta**: `pnpm gate` (typecheck + lint 0 warnings + test + build + `check:size`).
- **Pruebas nuevas** (herméticas, sin red):
  `src/worker/error-signatures.test.ts` — `fingerprint` estable y distinto por frame; `recordErrorSignature`
  arma el SQL correcto (cliente falso); `listErrorSignatures` ordena por hits y topa `days`.
  `src/client/lib/client-errors.test.ts` — `topFrame` extrae `app.js:42` y devuelve `undefined` sin stack.
  `src/worker/app.test.ts` — `GET /api/error-reports` sin sesión ⇒ 404; con sesión no-dueño ⇒ 404;
  el `POST` sigue devolviendo 204 aunque la escritura falle.
- **Si se prefiere el camino con librería**: `pnpm add -w @sentry/cloudflare`, envolver
  `app.fetch` en `withSentry`, secret `SENTRY_DSN` → Bugsink propio
  (`docker run -p 8000:8000 bugsink/bugsink`), y `LECTA_OWNER_EMAIL` sigue gobernando el apartado
  propio. Se puede tener todo: SDK en el worker **y** la tabla de huellas para la vista del producto.

---

## 5. Lo que quedó aplicado (2026-10-29)

### 5.1 Diferencias con la propuesta

- **Almacenamiento**: CockroachDB por Hyperdrive (`withClient`, `src/worker/db.ts:58`), no D1. El
  proyecto no tiene binding `d1_databases`; `env.DB` solo sobrevive como respaldo legacy en
  `src/worker/kindle/routes.ts`. Se reutiliza la base que ya se paga, sin segundo motor de datos.
- **Retención 30 días** en vez de 90 (`ERROR_SIGNATURE_KEEP_DAYS` en `src/worker/error-signatures.ts`).
- **La ruta se normaliza antes del hash** con `normalizeRouteForSignature`
  (`src/worker/client-errors.ts`): UUID, números de 4+ dígitos, hashes largos y sufijos tipo
  `book-98123` se vuelven `:id`. Es la segunda red, porque `sanitizeRoute` ya colapsa
  `/algo/<id>` a `/algo/*` antes.
- **La huella usa solo el primer frame**, pero la fila guarda `sample_frames` (hasta 3 frames
  limpios unidos por ` -> `, 200 caracteres), `last_message` (solo si el usuario activó
  «incluir mensaje del error») y `version`.

### 5.2 Inventario

| Pieza | Dónde |
|---|---|
| Tabla | `db/migrations/018_error_signatures.sql` — PK `(bucket_day, signature)`, `hits` por UPSERT |
| Huella + escritura + lectura + purga + digest | `src/worker/error-signatures.ts` (`fingerprint`, `recordErrorSignature`, `listErrorSignatures`, `purgeErrorSignatures`, `collectErrorDigest`, `sendErrorDigest`) |
| Saneado de frames y ruta | `src/worker/client-errors.ts` (`sanitizeFrame`, `normalizeRouteForSignature`, `CLIENT_ERROR_MAX_FRAMES = 3`) |
| Endpoint de lectura | `src/worker/app.ts` `GET /api/error-reports?days=N` — 404 si `LECTA_OWNER_EMAIL` no está o la sesión no es la del dueño; tope de 100 filas |
| Escritura | `src/worker/app.ts` `POST /api/client-errors` — el 204 no cambia; la escritura va en `waitUntil` y sus errores se ignoran |
| Cron 05:00 | `src/worker/index.ts` — purga 30 días + `sendErrorDigest` con Resend si alguna firma supera `ERROR_DIGEST_MIN_HITS = 5` |
| Cliente | `src/client/lib/client-errors.ts` (`topFrames`, frames en el payload, huella con `frame0`) |
| UI | `src/client/components/DiagnosticsModal.tsx` — bloque «Salud de la aplicación (servidor)» |
| Secret nuevo | `LECTA_OWNER_EMAIL` (opcional: sin él, la ruta responde 404 y no hay digest) |

### 5.3 Cómo se usa

1. `pnpm db:migrate` (en `lecta_dev`) para crear la tabla.
2. Definir `LECTA_OWNER_EMAIL` en `wrangler.jsonc` (`vars` o `secrets.required` según el entorno).
3. Abrir Diagnóstico con la cuenta del dueño: la tabla aparece bajo «Salud de la aplicación».
4. El cron de las 05:00 poda y, si algo cruzó el umbral, manda el correo.

### 5.4 Pruebas

- `src/worker/error-signatures.test.ts`: huella estable entre ids distintos, distinta por frame o
  nombre; UPSERT con día, ruta normalizada y muestra de frames; `listErrorSignatures` topa la
  ventana; `purgeErrorSignatures` devuelve filas borradas; `sendErrorDigest` no envía sin clave,
  sin dueño o sin filas y sí envía con ellos.
- `src/worker/client-errors.test.ts`: `sanitizeFrame` (sin rutas del dispositivo),
  `normalizeRouteForSignature` (idempotente), frames en `parseClientErrorReport` (máximo 3, sin
  duplicados, un frame ilegible no tira el reporte).
- `src/worker/app.test.ts`: el POST suma a la tabla, un fallo de escritura no cambia el 204, y
  `GET /api/error-reports` responde 404 sin dueño/no-dueño y 200 con el agregado al dueño.
- `src/client/lib/client-errors.test.ts`: `topFrames` (3 primeros, sin origen) y dos bugs distintos
  en la misma ruta se reportan por separado.
- `src/client/components/DiagnosticsModal.test.ts`: sección del servidor con filas y mensaje de
  «solo el dueño» cuando la ruta responde 404.
