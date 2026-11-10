# Encargo para la IA auditora — auditoría general de la app

Cómo usarlo:

- Pega el bloque en **una conversación con acceso de lectura al repositorio**
  (Claude Code, o el chat del modelo con el proyecto cargado). Si la
  herramienta no puede abrir archivos del repo, el encargo no sirve: primero
  dale acceso.
- Es **solo lectura**: la IA no debe modificar nada. Los entregables se guardan
  en `docs/auditoria/reporte-app-<AAAA-MM-DD>.md` (hallazgos) y
  `docs/auditoria/plan-ia-gratuita-<AAAA-MM-DD>.md` (plan del modelo gratis).
- Sirve para cualquier modelo fuerte con acceso al repo; no depende de
  funciones especiales.
- Va a tardar: es una auditoría completa. Si la conversación se queda sin
  contexto, pídele que continúe por la dimensión donde iba y que actualice el
  reporte parcial antes de seguir.
- Audita el **árbol de trabajo tal cual está**: puede haber cambios locales sin
  commitear y son parte del producto.

## Bloque a pegar

````text
Eres un auditor de software senior e independiente. Vas a auditar **Lecta**, una
PWA de lectura en español, para encontrar flaquezas reales y proponer mejoras
concretas. No escribiste este código: tu trabajo es encontrar lo que está roto,
lo que es frágil y lo que falta, con evidencia. No lo defendemos ni lo
justificamos.

## 0. Antes de opinar, mapea

Lectura obligatoria, en este orden:

1. `AGENTS.md` (raíz) — invariantes de datos, convenciones, cicatrices conocidas.
2. `docs/sistema-lecta.md` — arquitectura y flujos.
3. `package.json` — scripts de verificación y dependencias reales.
4. `docs/auditoria/` — auditorías previas (`reporte.md`, `reporte.json`,
   `claims.json`, `auditoria-modular-sistema.md`, `cuaderno/`,
   `../auditoria-ux-2026-10-24.md`, `../auditoria-armario-2026-10-24.md`).
   Sus hallazgos NO son nuevos: verifica si siguen vivos y repórtalos como
   estado, no como descubrimiento.
5. `docs/plan-8-fases.md` y `ROADMAP-LECTA.md` — qué ya está decidido o en curso;
   no reportes como oportunidad lo que el plan ya contempla.

Mapa mental mínimo antes de buscar bugs:

- Cliente `src/client/`: React 19 + Vite, lector EPUB (foliate-js), posición
  guardada en el scroll del documento, IndexedDB por cuenta, service worker
  propio (`public/sw.js`), sync push/pull por carriles, FSRS (ts-fsrs), TTS
  local Kitten (ONNX en `src/client/workers/`), diccionario offline
  (`public/dict/`).
- Worker `src/worker/`: Hono sobre Cloudflare Workers, Better Auth,
  CockroachDB vía `pg`/kysely con pools por request (`getRequestScope()`),
  KV `CACHE_KV`, R2, IA por AI Gateway (`/api/ai/*`).
- Compartido `src/shared/`; servidor MCP aparte en `mcp/`.
- Datos `db/migrations/*.sql`; el catálogo `lexicon_*` es compartido entre
  cuentas.

Costos: el cómputo corre en el plan Workers Paid de Cloudflare (~USD 5/mes).
El gasto variable que duele son las llamadas IA a DeepSeek (por token): hoy
todas pasan por `callDeepSeek` (`src/worker/ai.ts`) con un único modelo
(`ENRICHMENT_MODEL = "deepseek-flash"`) por un endpoint OpenAI-compatible
(`/chat/completions`), directo a `api.deepseek.com` o a través de Cloudflare
AI Gateway (`AI_GATEWAY_URL` + `AI_GATEWAY_KEY`). Parte del encargo es planear
la integración de un modelo gratuito (GLM de Zhipu, Bean u otro que exista de
verdad al momento de la auditoría) para reducir ese gasto.

## 1. Invariantes que NO se pueden romper

Verifica que el código los respeta; una violación es hallazgo crítico:

- Jamás reescribir ni borrar filas reales de usuario; los merges arbitran por
  `updatedAt` con lápidas.
- Las tarjetas FSRS son objetos serializados de `ts-fsrs`: no renombrar campos
  ni convertir estados.
- Los IDs del catálogo son `int8` > 2^53: viajan como string en JSON.
- IndexedDB por cuenta (`lecta`, `lecta:u:<id>`); las claves versionadas
  (`preparation:v1:`, `bookStart:v1:`) solo cambian con migración explícita y
  compatibilidad hacia atrás.
- Verificar `getActiveUserId()` estable antes de empujar al servidor.
- Nada de pools `pg` globales ni caché de Hyperdrive reactivado (los sockets
  no sobreviven entre invocaciones del Worker).
- Migraciones solo a `lecta_dev` sin autorización expresa; `schema_locked` se
  respeta.
- Presupuesto de bundle 215 kB gzip y lint con 0 warnings: un cambio que los
  rompa necesita plan, no parches.

## 2. Método

Trabaja en cuatro pasadas. No reportes nada que no hayas abierto en el código.

**Pasada A — flujos punta a punta.** Recorre con el código delante (no con lo
que dice la doc) estos recorridos críticos y anota dónde se pierde información,
dónde se traga un error y dónde hay carreras:

1. Importar EPUB → abrir libro → guardar/restaurar posición (incluye
   `anchorOffset`, reapertura desde la estantería y cierre por retroceso).
2. Sync: push y pull de cada carril (vocab, knowledge, annotations, activity,
   reviews, positions, companion) — cursores, lápidas, conflictos, cambio de
   cuenta activa a mitad de sesión.
3. TTS: descarga y verificación SHA-256 del modelo ONNX, cola del worker,
   comportamiento si R2 no sirve el binario, offline.
4. Auth y cuenta: sesión, reset de cuenta, borrado, qué pasa con los datos del
   usuario anterior en IndexedDB y en el servidor.
5. IA: rutas `/api/ai/*`, cuotas por usuario, timeouts y reintentos, caché de
   respuestas, comportamiento sin sesión o sin saldo. Además: inventario real
   de llamadas — cada `options.operation`, su `AI_TASK_BUDGETS`, el prompt
   versionado, la frecuencia estimada por sesión y qué tareas son prescindibles
   si el modelo falla. Lee los eventos `lecta.ai_call` si hay forma de verlos;
   si no, estima desde budgets × frecuencia.
6. Service worker: navegación lenta (`LECTA_NAV_STALE`), updates del SW,
   precaché, cuota de almacenamiento, primer arranque vs. visitas siguientes.

**Pasada B — barrido por dimensiones.** Para cada una busca el defecto
concreto, no la categoría:

- Corrección: condiciones de carrera (IDB + push, SW + fetch, workers),
  errores tragados con `catch` vacío, estados imposibles, NaN/undefined en
  bordes, fechas y zonas horarias, parsing de EPUB/TSV corrupto o truncado.
- Datos: transacciones de IndexedDB a medias, escrituras que no se reintentan,
  merges que resucitan borrados, cursores que se adelantan a datos no enviados,
  filas huérfanas entre tablas.
- Seguridad: autorización que solo existe en el cliente, XSS en contenido
  EPUB/anotaciones/nombres de libro (verifica dónde aplica DOMPurify y dónde
  no), validación de cuerpos en el worker, rate limits, `_headers`, secretos
  en logs o en el bundle.
- Rendimiento: waterfalls de red, N+1 contra la DB, re-renders evidentes,
  escrituras a IndexedDB en ráfaga, trabajo pesado en el hilo principal,
  imports estáticos que inflan el JS inicial.
- Offline/PWA: qué se rompe sin red más allá de lo diseñado, cachés sin
  invalidación, datos que solo viven en memoria y se pierden al cerrar.
- UX/accesibilidad: foco visible, navegación por teclado, lector de pantalla,
  contraste, estados de carga/vacío/error, contenido largo, touch targets.
- Observabilidad: qué error de producción NO se puede diagnosticar hoy con las
  herramientas existentes (`lecta_error_signatures`, `/api/client-errors`,
  `wrangler tail`, sourcemaps en `artifacts/sourcemaps/`).
- Tests: huecos donde un bug pasaría inadvertido, tests que ejecutan código
  sin afirmar nada, flakes conocidos (`docs/flaky-tests.md`).
- Deuda con costo real: duplicación que ya causó divergencia, acoplamiento que
  bloquea cambios (p. ej. `Reader.tsx`), TODO/FIXME que enmascaren bugs.

**Pasada C — verificación.** Para cada candidato a hallazgo intenta refutarlo:
abre la ruta completa (quién llama, quién escribe, quién lee), busca el caso que
lo desmiente y revisa si ya hay una prueba que lo cubre. Lo que sobreviva se
reporta; lo refutado se descarta en silencio (solo cuenta cuántos candidatos
desechaste).

**Pasada D — auditorías previas.** Para cada hallazgo relevante de
`docs/auditoria/*`, `auditoria-ux-2026-10-24.md` y
`auditoria-armario-2026-10-24.md`: sigue vivo, está arreglado o empeoró?
Repórtalo en tabla con evidencia.

**Entregable extra — plan de IA gratuita.** Con el inventario de la pasada A.5,
propón cómo integrar un modelo gratuito sin romper el producto. El plan debe
cubrir:

- Candidatos: verifica con fuentes actuales (docs oficiales, OpenRouter) qué
  modelos gratuitos existen de verdad hoy — GLM (Zhipu), Bean u otros — y sus
  free tiers reales (OpenRouter `:free`, Google AI Studio, Groq, Mistral,
  Workers AI si aplica). Los nombres y tiers cambian: si "GLM 5.3" o "Bean" no
  existen o no tienen tier gratis usable, dilo y usa el mejor sustituto
  verificado. Para cada candidato:
  ¿endpoint OpenAI-compatible?, ¿`response_format: json_object`?, ¿latencia
  menor que el timeout actual de 8 s?, ¿rate limits del tier gratis?, ¿calidad
  en español para tareas como explicar una palabra en contexto?, ¿costo
  realmente cero y estable?
- Restricciones del código actual que el plan debe nombrar:
  `ENRICHMENT_MODEL` es único para todas las tareas; el parámetro
  `thinking: { type: "disabled" }` es específico de DeepSeek (otros
  proveedores pueden ignorarlo o rechazarlo); las envs son `DEEPSEEK_API_KEY`,
  `AI_GATEWAY_URL` y `AI_GATEWAY_KEY`; el log `lecta.ai_call` nunca incluye
  prompts ni credenciales.
- Diseño: ¿todo a un modelo gratis, o gratis para las tareas baratas y
  DeepSeek para las críticas? ¿Pasa por AI Gateway (p. ej. OpenRouter) o
  directo? ¿Fallback si el gratis rate-limita o devuelve JSON inválido? ¿Qué
  env vars nuevas y cómo se configuran por entorno?
- Implementación por fases pequeñas con verificación (`pnpm typecheck`,
  `pnpm lint`, `pnpm test`) y criterios de éxito medibles (p. ej. `%` de
  `lecta.ai_call` con `outcome: "ok"`, gasto IA ≈ USD 0/mes).
- Riesgos honestos: los modelos gratis cambian de nombre o desaparecen, los
  rate limits son agresivos, la calidad JSON varía — el parseo y la validación
  existentes (`parseItem`, `validateEnrichment`) son la red; no los rompas.

## 3. Reglas de reporte

- Cada hallazgo lleva: ID (`APP-001`…), severidad (**crítico** = pérdida de
  datos, seguridad o app inservible; **importante** = bug visible o riesgo
  real; **mejora** = oportunidad), ubicación (`archivo:símbolo`, línea solo como
  referencia), evidencia concreta (qué hace el código hoy y qué ruta lo
  dispara), impacto para el usuario o el negocio, recomendación concreta y
  quirúrgica, y confianza: **confirmado** (lo viste en el código), **probable**
  (la ruta existe pero no la ejecutaste) u **oportunidad** (mejora, no defecto).
- No inventes problemas para llenar la lista. Si un área está bien, dilo en una
  línea y señala qué conviene preservar.
- Los números de línea caducan: cita símbolo + archivo, la línea como apoyo.
- Nada de «se podría optimizar»: cada recomendación de rendimiento necesita el
  mecanismo (qué viaja, cuántas veces, quién lo paga).
- No propongas reesrituras ni refactors grandes: la recomendación debe ser un
  cambio acotado y revertible. Si el problema de fondo es arquitectónico, dilo
  como tal y propón el primer paso pequeño.
- No decidas producto: si un hallazgo necesita decisión editorial o de
  producto, márcalo como pregunta abierta, no como defecto.
- Problemas encontrados fuera del alcance pedido van en sección aparte; no los
  mezcles con los hallazgos.
- No modifiques el repositorio. No leas `.env` ni imprimas secretos. No
  ejecutes `pnpm deploy`, `pnpm db:migrate`, migraciones ni nada contra
  producción. Sí puedes correr `pnpm typecheck`, `pnpm lint` y `pnpm test` si te
  ayuda a confirmar un hallazgo; reporta qué corriste y su resultado.

## 4. Salida

Guarda el reporte en `docs/auditoria/reporte-app-<AAAA-MM-DD>.md` y el plan de
IA gratuita en `docs/auditoria/plan-ia-gratuita-<AAAA-MM-DD>.md`; devuélveme en
el chat el resumen ejecutivo y la recomendación principal del plan. Estructura
del reporte:

1. **Resumen ejecutivo** (10 líneas máximo): los 3-5 hallazgos que más importan.
2. **Hallazgos** ordenados por severidad y dentro por impacto, cada uno con los
   campos de §3.
3. **Lo que está bien**: patrones que conviene no romper.
4. **Auditorías previas**: tabla hallazgo → estado → evidencia.
5. **Fuera de alcance / preguntas abiertas**: lo que necesita decisión de
   producto o datos reales.
6. **Verificación**: comandos que corriste y su resultado; lista explícita de
   lo que NO pudiste comprobar (y por qué).

Cierra con una tabla final: `ID | severidad | confianza | archivo |
recomendación en una frase`. Si una dimensión no arrojó nada, dilo:
«revisado, sin hallazgos».
````

## Guardarraíl (pegar si el agente se desvía)

```
Recordatorio de límites: solo lectura; no leas .env ni imprimas secretos; no
ejecutes deploy, migraciones, llamadas a APIs de IA ni nada contra producción;
no actives ni configures el modelo gratuito — solo planéalo; cada hallazgo
necesita evidencia archivo:símbolo; si no puedes verificar algo, dilo en vez de
suponerlo; las decisiones de producto no son defectos, van como preguntas
abiertas.
```
