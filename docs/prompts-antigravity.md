# Prompts para ejecutar el plan de 8 fases en Antigravity

Cómo usarlos:

- Una conversación del Agent Manager **por fase**. Pega un solo bloque, el de la fase.
- Cada bloque empieza con `/lecta-plan-produccion`: carga la skill que lee
  `docs/plan-8-fases.md` y fija las reglas. Si tu versión no reconoce el comando, borra esa
  línea; el resto del bloque repite lo esencial.
- No pegues dos fases juntas. La 1 tiene puerta de autorización; la 3 y la 7 piden revisión
  visual; la 4 pide razonamiento sobre datos.
- La referencia de cada criterio es el documento: si un bloque y el documento discrepan, manda
  el documento y avísame.

> La **Fase 0 ya está ejecutada** (2026-10-22), incluido `pnpm gate`. Empieza por la Fase 3 o la
> 4 si aún no hay credenciales de Cloudflare, o por la 1 si ya las hay.

## Guardarraíl (pegar cuando el agente se desvíe)

```
Recordatorio: una fase a la vez; no hagas commit, push ni deploy salvo que el prompt lo pida
explícitamente; no subas el presupuesto de 215 kB ni --max-warnings; no leas .env ni imprimas
secretos; no uses git checkout/reset/clean; no toques las tablas lexicon_* de lecta_dev.
Un criterio de aceptación solo cuenta con el comando y su salida real.
```

## Cierre de fase (pegar al terminar cualquier fase)

```
Cierra la fase con docs/plan-8-fases.md §0.2:
1. Ejecuta pnpm gate y pégame la salida completa.
2. Rellena la tabla de criterios de la fase: criterio | comando | salida | [x]/[ ].
3. Si algún criterio no se puede verificar con un comando, dilo en vez de marcarlo.
4. Propón el mensaje de commit (tipo(fase-N): …) sin ejecutarlo.
5. Enumera los archivos tocados y qué documentación actualizaste (AGENTS.md,
   docs/sistema-lecta.md) o por qué no hacía falta.
```

---

## Fase 1 — Producción (tiene puerta)

```
/lecta-plan-produccion

FASE 1 — Producción. Es la única fase irreversible. No imprimas el contenido de .env ni
ninguna cadena de conexión.

Paso A (solo lectura):
1. Ejecuta `pnpm exec wrangler whoami`. Si no hay sesión, dilo y detente: sin eso el deploy
   falla y la fase no empieza.
2. Ejecuta el bloque de §4.2 del plan (consulta a lecta_schema_migrations) y pégame la salida.
   Espero 10 filas, de 001 a 010.
3. Comprueba si existe db/migrations/014_*.sql (la Fase 4 puede haberse adelantado).
4. Muéstrame los comandos exactos de §4.3–§4.6 y qué esperas de cada uno.

Detente aquí. No migres ni despliegues hasta que yo escriba la frase exacta:
Autorizo migrar lecta y desplegar a producción.

Paso B (con la autorización):
5. pnpm db:migrate --prod. Si 012/013 exceden el tiempo, LECTA_MIGRATE_TIMEOUT_MS=300000.
   Si salta schema_locked, detente y dime qué tabla desbloquear.
6. Verifica que lecta_schema_migrations termina en 013 (o 014 si existe).
7. pnpm run deploy y luego `pnpm exec wrangler deployments list | head -5`.
8. Smoke según §4.5. Aviso: pnpm smoke:auth CREA dos cuentas reales en producción, sube un
   EPUB falso a R2 y escribe vocab. Córrelo una vez y anota los dos correos que creó.
9. wrangler tail 10 minutos con timeout (§4.6) y dime si hay errores 5xx.

Prohibido: db:setup contra prod, editar .env, desplegar antes de migrar, correr smoke:auth en
bucle. Entrega el checklist de §4.7 con [x]/[ ] y la evidencia de cada línea.
```

---

## Fase 2 — Kitten TTS versionado

```
/lecta-plan-produccion

FASE 2 — Modelo TTS: un binario, una versión, un hash.

1. Lee §5 del plan y los archivos implicados: src/client/lib/kittenTtsEngine.ts,
   src/worker/app.ts (ruta /models/:filename) y scripts/upload-model.mjs.
2. Antes de tocar nada, confirma con `wrangler r2 object get` que models/ está vacío (el
   2026-10-22 lo estaba) y dime las cuatro cosas que hoy permiten que el modelo servido, el
   cacheado y el fallback sean binarios distintos. Si encuentras una quinta, mejor.
3. Implementa §5.1 en un solo commit lógico:
   - nombre versionado kitten-tts-nano-0.8-int8-v1.onnx en los tres sitios a la vez;
   - KITTEN_CACHE_NAME versionado (lecta-kitten-tts-v2);
   - hash con crypto.subtle antes de cache.put, guardado como x-model-sha256, comparado en
     isModelDownloaded SIN recalcular el hash en cada arranque;
   - eliminar KITTEN_MODEL_FALLBACK_URLS y KITTEN_MODEL_CDN_URL (v0.1 fuera);
   - bucket.head() cuando el método es HEAD;
   - scripts/check-model.mjs nuevo, con tamaño 24 369 971 ±2 %, ETag y Cache-Control.
4. Sube el modelo con MODEL_FILENAME y MODEL_SHA256 de §5.2 y ejecuta check-model contra prod.
5. Añade pruebas: hash correcto cachea, hash alterado no cachea, HEAD no descarga cuerpo.
6. NO borres el objeto viejo de R2 en esta fase: dime el comando y lo ejecuto yo.

Ojo: public/_headers NO controla /models; esa ruta la sirve el worker. No pierdas tiempo ahí.
Entrega: salida de check-model, pnpm gate, y qué ve el usuario si el hash no coincide.
```

---

## Fase 3 — Peso inicial

```
/lecta-plan-produccion

FASE 3 — Bajar el arranque a ≤ 193.5 kB gzip (aviso al 90 %), sin cambiar comportamiento.

1. Lee §6 y confirma el punto de partida con `pnpm run build && pnpm check:size`.
2. Antes de editar, muéstrame el reparto por chunk que ves en dist/client/assets y cuántos
   modulepreload tiene dist/client/index.html. Contrasta con la tabla del plan; si no coincide,
   gana lo que midas tú.
3. Aplica los cambios en este orden, midiendo después de cada uno:
   a) CompanionPanel + CompanionCelebration a lazy dentro de CompanionProvider.tsx (líneas
      ~546 y ~565), con import() en idle;
   b) DiagnosticsModal y LegalNotice a lazy en App.tsx (líneas ~79-80, 1505, 1509);
   c) investiga reading-location (16.5 kB) y dime qué se puede diferir sin romper el primer
      render. No lo cambies sin explicarlo.
4. No toques react-vendor, idb ni Shelf.tsx.

Criterio de parada: si tras (a) y (b) ya estás ≤ 193.5 kB, para. No sigas optimizando.
Entrega: cifra antes/después por chunk, modulepreload antes/después, y pnpm gate + test:e2e.
```

---

## Fase 4 — Sync: cursor veraz

```
/lecta-plan-produccion

FASE 4 — El cursor de push no puede adelantar a un dato no enviado.

1. Lee §7 y localiza los SEIS carriles con Date.now() como cursor de push: vocab, knowledge,
   annotations, activity, reviews, positions. Dame archivo:línea de cada uno antes de editar.
2. Implementa:
   - advanceSyncCursor(userId, key, stamp) monótono en src/client/lib/sync-cursors.ts;
   - pushWordsToServer devuelve { ok, acceptedMax } con el máximo del ÚLTIMO lote confirmado;
   - fuera la rama "toPush vacío y lastPushedAt === 0 ⇒ Date.now()";
   - fuera los cursores globales (vocab, vocab:push, knowledge:push) y sus fallbacks;
   - migración 014_vocab_sync_order_index.sql, aplicada SOLO a lecta_dev.
3. Pruebas con estos nombres: cursor-no-usa-reloj, advance-es-monotono, carrera-guardar-durante-
   push, lote-parcial-conserva-maximo, sin-cursores-globales. Con Date.now fijado en un valor
   absurdo (9e15) para que un fallback al reloj sea imposible de esconder.
4. EXPLAIN del GET de vocab en lecta_dev: pega el plan y confirma que usa el índice nuevo.
5. Actualiza docs/sistema-lecta.md con el coste del primer re-sync.

Aviso: NO apliques 014 a producción. Si el repo ya no está en la ventana de la Fase 1, queda
pendiente y se anota en AGENTS.md.
Entrega: las cinco pruebas con nombre, el EXPLAIN, y pnpm gate.
```

---

## Fase 5 — Errores de cliente

```
/lecta-plan-produccion

FASE 5 — Saber qué rompe en el navegador sin tocar la base de datos.

1. Lee §8. Antes de escribir código, responde: ¿dónde se registra la ruta para que quede ANTES
   de las rutas de auth y no pase por withClient?
2. Implementa POST /api/client-errors:
   - sin sesión, sin base de datos, sin withClient;
   - cuerpo ≤ 2 kB, allowlist name/code/route/version/message;
   - route solo pathname y solo si empieza por ruta conocida;
   - message solo si el usuario activó "incluir mensaje";
   - rechazo silencioso con 204 ante cualquier cosa rara;
   - tope por CF-Connecting-IP en memoria del isolate: 30/min, 300/hora, comentado como tope
     por isolate y NO como medida de seguridad;
   - console.error(JSON.stringify({ event: "client_error", … })).
3. Cliente: dedupe por name|code|route, una vez por sesión, máximo 5 por carga,
   fetch con keepalive, errores ignorados.
4. Interruptores en FeatureFlags de src/client/lib/settings.ts (shareClientErrors activado,
   includeErrorMessage desactivado) y su UI en DiagnosticsModal.
5. Pruebas con app.request de Hono (no contra prod): válido → 204 y log; route con query → se
   sanea; campo extra o mensaje de 10 kB → 204 y sin log; 40 peticiones → ≤30; withClient
   espiado → 0 llamadas.

Entrega: las cinco pruebas, pnpm gate y qué se ve en wrangler tail con un error provocado.
```

---

## Fase 6 — Cobertura y MCP

```
/lecta-plan-produccion

FASE 6 — Cerrar los huecos de cobertura y probar el MCP.

1. Lee §9. Ejecuta `pnpm test:coverage` y pégame el % actual de use-page-gesture.ts,
   page-gesture.ts y mcp/src/tools.ts.
2. Sube use-page-gesture.ts a ≥85 % de sentencias y page-gesture.ts a ≥60 % de ramas con casos
   que prueben comportamiento (no líneas ejecutadas).
3. Umbrales por archivo en vitest.config.ts según la tabla de §9.1. No bajes los globales.
4. mcp/src/tools.ts: recorre las 12 herramientas registradas y da a cada una un caso feliz con
   fetch mockeado y un error HTTP. Nada de red real.
5. Añade mcp/src/**/*.ts a coverage.include.
6. Auditoría axe de las pantallas tocadas en Fases 3 y 5.

Prohibido: escribir en tablas lexicon_* desde un test (el catálogo de lecta_dev lo lee
producción); bajar umbrales para pasar; probar el MCP contra la API real.
Entrega: tabla herramienta → casos, cobertura antes/después, pnpm test:coverage y test:e2e.
```

---

## Fase 7 — Partir `Reader.tsx`

```
/lecta-plan-produccion

FASE 7 — De 5 503 líneas a ≤3 500 (objetivo 3 000) sin cambiar comportamiento.

1. Lee §10 y el estado real: src/client/components/reader/ ya tiene ReaderOverlays.tsx,
   ReaderTopBar.tsx y ReaderSearchAndTocSheet.tsx; SmartReaderDock.tsx ya está fuera. Dime qué
   queda dentro de Reader.tsx que no sea render.
2. Confirma los invariantes: export default Reader con las mismas props, exports nombrados
   recordDominated y PRESET_LABELS (Reader.test.ts:6 y :119), y las reglas CSS que verifican
   Reader.test.ts:348 y :367 en src/client/styles/reader.css.
3. Extrae UNA cosa por commit, en este orden: useReaderTts.ts → ReaderChrome.tsx →
   ReaderContent.tsx → ReaderDockHost.tsx. Tras cada una: pnpm gate + pnpm test:e2e.
4. Si una extracción rompe el e2e, revierte ESA extracción y explícame por qué. No arregles la
   prueba bajando asserts.
5. Para cuando estés ≤3 500 líneas (objetivo 3 000). Si te quedas en 3 800, documenta qué queda
   acoplado y para.

Prohibido: helper en Reader.test.ts para concatenar .tsx (ninguna prueba lee Reader.tsx como
texto); dos extracciones en un commit; renombrar props de paso.
Entrega: wc -l antes/después por commit, pnpm gate + test:e2e de cada uno, y check:size igual.
```

---

## Fase 8 — ODbL

```
/lecta-plan-produccion

FASE 8 — Que la promesa de descarga del aviso legal sea verdadera.

1. Lee §11. Confirma el estado: LegalNotice.tsx apunta a github.com/lecta-app/lecta-lexicon-data,
   que da 404; data/lexicon/es-forms.tsv existe en local (14 423 009 bytes) y public/lexicon/ ya
   existe con locuciones.es.json.
2. Genera public/lexicon/forms-es.tsv.gz con gzip -9 y dime el tamaño exacto.
3. Escribe public/lexicon/README.md: autoría, ODbL 1.0, fecha y método de derivación (§4.3/§4.6).
4. Añade el bloque /lexicon/forms-es.tsv.gz a public/_headers con Content-Type application/gzip
   y Content-Disposition attachment. Verifica con curl -I local que gana la regla específica;
   si no gana, propón unificarla con /lexicon/*.
5. Cambia el texto y el href de LegalNotice.tsx a /lexicon/forms-es.tsv.gz y ".csv" por ".tsv".
6. Añade a LegalNotice.test.ts la comprobación de que el archivo existe en public/ (fs.existsSync),
   para que no vuelva a prometerse algo inexistente.
7. Actualiza docs/licencias-lexico.md.

Ojo: no cambies el enlace antes de que exista el archivo; sería otro 404.
Entrega: ls -l del .gz, curl -I, pnpm gate, y confirmación de que no se tocó el bundle.
```

---

## Prompts de apoyo

### Si el agente se desvía del alcance

```
Alto. Estás fuera del alcance de la fase. Enumera lo que tocaste que no está en los archivos
del plan, revierte solo eso y vuelve al último criterio de aceptación pendiente. No sigas
avanzando hasta que el gate esté verde otra vez.
```

### Si una fase falla

```
Detente y diagnostica sin cambiar de enfoque:
1. Comando ejecutado, salida literal y código de salida.
2. ¿Falla el gate, un criterio de aceptación o el entorno (credenciales, red, cuota)?
3. ¿Es un fallo del plan (premisa falsa) o de la implementación?
4. Si es del plan: propón la corrección del documento antes de tocar código.
No improvises una solución que cambie el alcance de la fase.
```

### Revisión adversarial antes del commit

```
Revisa tu propio diff como si fuera de otra persona:
- ¿Qué criterio de aceptación NO demuestra este diff?
- ¿Qué prueba pasarías si el bug estuviera presente? Si no se te ocurre ninguna, falta prueba.
- ¿Algún import nuevo entra estático y sube el JS inicial?
- ¿Algún test escribe en lexicon_* o llama a red real?
- ¿Quedó un console.log, un TODO o un archivo temporal?
Devuelve la lista de problemas ordenada por gravedad. No lo arregles todavía.
```

### Verificación final de la fase

```
Verifica con evidencia, no con opinión:
1. pnpm gate (salida completa).
2. Gate extra de la fase (§1 del plan).
3. Tabla criterio | comando | salida | [x]/[ ] de la fase.
4. git diff --stat: ¿solo los archivos del alcance?
Reporta cualquier criterio que no puedas demostrar como [ ] y explica por qué.
```
