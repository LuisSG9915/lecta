# Monetización de Lecta+: plan de trabajo por fases

Propuesta del 2026-11-25, pendiente de aprobación de Luis. Fuente: cuatro auditorías
(producto, gating, métricas, ideas Premium) contrastadas con el código el mismo día.
Plan para ejecutar con Sonnet, una fase por commit.

## 1. Resumen

1. Gratis ya incluye casi todo el hábito: voz neural y segundo plano, sync, FSRS, θ,
   Cuaderno, gato, subtítulos, Explora, Journey y glosario. Lecta+ solo suma IA en
   servidor (free: 3 al día), EPUB propios en R2, Kindle, la lista completa de Palabras
   previstas, pelajes y modos IA del Cuaderno. Desde dentro de la app ese valor no se ve.
2. La prueba inversa de 14 días arrancó hoy (`REVERSE_TRIAL_START`, `src/shared/plan.ts:46`).
   Las primeras pruebas vencen el **2026-12-09**. Todavía nadie ha terminado una.
3. No se mide la conversión. `retention:stats` cuenta la prueba como `free` y no hay eventos
   de paywall ni de checkout.
4. No hay aviso ni pantalla de fin de prueba. El Carné dice «vuelves a Gratis sin ningún
   cargo» (`ReaderCard.tsx:119`), así que la aversión a la pérdida queda desactivada.
5. Con 402, la IA de pago falla en silencio y cae a local (micro-cuento, evaluar oración).
   `/api/ai/character-recap` existe en el worker, pero ningún cliente lo llama.
6. Durante la prueba, toda cuenta free es Lecta+ con solo topes por hora
   (`ai-units.ts`, de 12 a 60 unidades por hora y scope): no hay tope diario.
7. Orden: medir, luego fin de prueba, luego hacer visible el valor. Sin quitar nada a Gratis.
8. Después, topes de costo y anti-abuso. Luego tres funciones Premium nuevas que acumulan
   valor durante la prueba, con costo cercano a 0.
9. El reempaquetado (pasar algo de Gratis a Lecta+) va al final, y cada caso es decisión de Luis.
10. Precio sin cambios hasta tener datos (lectura el 2026-12-23). Los experimentos quedan
    documentados, sin implementar.

## 2. Principios

- **Zero-Friction manda** (AGENTS.md, «Reglas Zero-Friction»):
  - Nada se interpone entre tocar un libro y leer.
  - Ningún modal bloquea la lectura.
  - Los avisos van en `ReaderNotices` (no bloqueante), en la estantería o en «Tú».
- **El hábito no se quita de Gratis**: Repasar (FSRS), diccionario local, sync de progreso
  y vocabulario, gato base y voz. Los accesorios ya ganados y los modos locales del
  Cuaderno tampoco.
- **Gating en servidor.** Toda función de valor nueva se protege con `requireLectaPlus` o
  `loadUserPlan` (`src/worker/plan-middleware.ts`, `plan-store.ts`). El cliente solo decide
  qué pintar.
- **Honestidad**: se muestra el uso real del usuario, nunca cifras inventadas. Cero
  urgencia falsa.
- **Bundle**: el tope es 205 kB gzip y quedan unos 5 kB. Toda pantalla nueva va en un chunk
  lazy (`React.lazy`, mismo patrón que `CompanionPanel`). `pnpm check:size` en cada fase.
- **Migraciones**: solo a `lecta_dev`. Aplicarlas en `lecta` (prod) exige autorización
  expresa de Luis. Siguiente número libre: **034**. Preferir siempre `lecta_ai_quota` (scope
  nuevo) o la allowlist de la 028 antes que una tabla nueva.
- **Cada fase**:
  - es un commit, sin mezclar cambios funcionales con refactor;
  - lleva pruebas Vitest nuevas que fallan sin el cambio;
  - cierra con `pnpm gate` en verde (lint 0 warnings).
- Regla de AGENTS para tocar `Reader.tsx`: no pasar `prettier --write`. Si la línea
  `applyPreviewKnownSignal(currentLang, beta)` se mueve, actualizar
  `docs/auditoria/claims.json` en el mismo commit.

## 3. Calendario duro

| Fecha | Qué |
|---|---|
| 2026-12-04 | F1–F3 y F5 (aviso de fin de prueba) en producción: el día 11 de las primeras pruebas es el 12-05 |
| 2026-12-08 | F6 (pantalla del día 15) en producción |
| 2026-12-09 00:00Z | Vencen las primeras pruebas (en CDMX: **8 de dic., 18:00**; toda fecha que vea el usuario se formatea en hora local desde el instante) |
| 2026-12-23 | Primera lectura de métricas (§6) |
| 2027-01-09 | Segunda lectura; se decide si se abre F21 (precio) |

## 4. Fases

Leyenda:
- **‖**: puede ir en paralelo con las fases que se indican (archivos disjuntos).
- **Dep.**: dependencias.

Toda referencia `archivo:línea` se verificó el 2026-11-25. Si no coincide, ubicarla con
grep del símbolo citado.

---

### Bloque A: Medir (antes de todo)

#### F1. Eventos de plan en servidor (sin migración)

- **Objetivo**: contar el embudo de compra en el servidor, que es la fuente fiable.
- **Archivos**:
  - `src/worker/landing-events.ts` (allowlist `LANDING_EVENTS`, línea 18);
  - `src/worker/billing.ts` (`/api/billing/checkout`, línea 120; webhook, línea 183);
  - pruebas en `src/worker/landing-events.test.ts` y `src/worker/billing.test.ts`
    (crearlas o extenderlas).
- **Cambios**:
  - Añadir a `LANDING_EVENTS` los eventos con prefijo `app:`:
    - `app:plannote:<feature>`;
    - `app:paywall`;
    - `app:carne-open`;
    - `app:trial-warning:<dia>`;
    - `app:trial-end-view`;
    - `app:trial-end-cta`;
    - `app:recap-locked`.

    Validar `<feature>` contra una lista cerrada exportada, nunca texto libre.
  - En `billing.ts`, tras crear la sesión de Checkout, llamar
    `recordLandingEvent(env, "app:checkout-start:<monthly|yearly>", fuente)` dentro de
    `waitUntil`. En el webhook, registrar `app:checkout-complete:<period>` **solo** en la
    rama `checkout.session.completed` (`HANDLED`, línea 176; rama en la 203). No usar la
    rama de estado `active`/`trialing` (línea 84): cada renovación y cambio de plan
    contaría otra vez. Si falla, no rompe la respuesta (mismo patrón tolerante que
    `recordLandingEvent`).
  - La fuente distingue `trial` / `free` / `plus` según `loadUserPlan`. Va en el campo
    `source`. `normalizeLandingSource` (línea 42) acepta cualquier `[a-z0-9._-]+`, así que
    esos tres valores pasan; usar una constante compartida para no escribirlos a mano.
- **Límite conocido**: son contadores diarios anónimos (tabla 028
  `lecta_landing_daily`). Sirven para el embudo, no para cohortes por usuario. Las cohortes
  van en F19.
- **Verificación**:
  - prueba que `parseLandingEvent` acepta `app:plannote:wordpanel` y rechaza
    `app:plannote:<inventado>`;
  - prueba que el checkout llama `recordLandingEvent` con el periodo (mock);
  - prueba que el webhook registra `checkout-complete` una vez con
    `checkout.session.completed` y **ninguna** con un `customer.subscription.updated`
    activo posterior (renovación);
  - `pnpm gate`.
- **Riesgo**: bajo. Un fallo de escritura se traga.
- **Migración**: no.
- **‖** F3 y F4. **Dep.**: ninguna.

#### F2. Eventos de plan en cliente + `PlanNote` con `feature`

- **Objetivo**: saber qué nota de Lecta+ se ve y cuál lleva al Carné.
- **Archivos**:
  - nuevo `src/client/lib/plan-events.ts`;
  - `src/client/components/PlanNote.tsx` (firma `{ title, detail }`, línea 4);
  - los 8 `<PlanNote`: `App.tsx`, `SectionPreview.tsx`, `Account.tsx`, `Reader.tsx`,
    `WordPanel.tsx`, `reader/ReaderOverlays.tsx`, `reader/ReaderNotices.tsx`,
    `notebook/FreeModes.tsx`, `notebook/PracticeCard.tsx` (confirmar con
    `grep -rn "<PlanNote" src/client`);
  - `src/client/components/ReaderCard.tsx` (apertura del Carné).
- **Cambios**:
  - En `plan-events.ts`, `trackPlanEvent(event)`:
    - `navigator.sendBeacon` a `/api/landing-events`;
    - deduplica por sesión de pestaña con un `Set` en el módulo;
    - no hace nada sin `sendBeacon`.
  - `PlanNote` recibe la prop obligatoria `feature: PlanFeature`, con el tipo exportado de
    `plan-events.ts` y la lista idéntica a la del worker. Al montar emite
    `app:plannote:<feature>`. Al pulsar «Ver Lecta+» emite `app:paywall` antes del
    `lecta:open-carne`.
  - El Carné emite `app:carne-open` al abrirse.
- **Verificación**:
  - prueba de `PlanNote`: emite una vez al montar aunque se renderice dos veces, y emite
    `app:paywall` al pulsar;
  - prueba de que la lista de `PlanFeature` del cliente coincide con la del worker
    (importar ambas en un test de `src/shared` o mover la lista a `src/shared/plan.ts`;
    preferible esto último);
  - `pnpm gate` y `check:size` (+0,3 kB como máximo).
- **Riesgo**: bajo. Toca muchos archivos, pero de forma mecánica.
- **Migración**: no.
- **‖** F3 y F4. **Dep.**: F1 (la lista de features vive en `src/shared/plan.ts` y la crea
  F1).

#### F3. `retention:stats` separa prueba y pagado

- **Objetivo**: dejar de contar las cuentas en prueba como `free`.
- **Archivos**: `scripts/retention-stats.mjs` (consulta en la línea 107) y su prueba
  (`scripts/retention-stats.test.mjs`; crearla si no existe).
- **Cambios**:
  - Calcular el plan efectivo en SQL (la consulta ya lee `u."createdAt"`, columna de Better
    Auth en camelCase y entre comillas):
    - si la fila es `free` o no existe, y
      `now < greatest(u."createdAt", '2026-11-25T00:00:00Z') + 14 días`, entonces `trial`;
    - si es `lecta_plus` con `stripe_subscription_id` no nulo (columna de la 027), entonces
      `plus_paid`;
    - `founder_lifetime` aparte.
  - El `.mjs` no puede importar `plan.ts`: duplicar las dos constantes con un comentario
    que apunte a `src/shared/plan.ts` y una prueba que lea `plan.ts` como texto y compare
    los valores.
  - Sumar la columna «prueba → pago» por cohorte: cuentas cuya prueba venció y hoy son
    `plus_paid`.
- **Verificación**:
  - prueba con filas sintéticas que clasifica prueba activa, prueba vencida, pagado y
    fundador;
  - prueba de constantes sincronizadas;
  - `pnpm gate`.
- **Riesgo**: bajo, porque solo lee.
- **Migración**: no.
- **‖** F1 y F2.

---

### Bloque B: Fin de prueba (fecha límite 12-04 / 12-08)

#### F4. `GET /api/account/trial-summary` y `trialEndedAt`

- **Objetivo**: dar al usuario los datos de su uso real durante la prueba, en una sola
  consulta.
- **Archivos**:
  - `src/worker/account.ts` (junto a `/api/account/state`, línea 21);
  - `src/shared/plan.ts` (helper `reverseTrialEndsAt`, línea 49);
  - `src/client/lib/account-plan.ts` (`planFromAccountState`, líneas 57–80);
  - pruebas de los tres.
- **Cambios**:
  - `/api/account/state` añade `trialEndedAt`: número si la cuenta tuvo prueba, ya venció
    y el plan efectivo es `free`; si no, `null`. Calcularlo con `reverseTrialEndsAt` y
    `user.createdAt`, que ya se leen en `getUserPlan`.
  - Ruta nueva `GET /api/account/trial-summary` (con sesión; sin prueba devuelve 404).
    Hace una consulta con subconsultas, todas acotadas a
    `[max(createdAt, REVERSE_TRIAL_START), trialEndsAt]`:
    - `aiUses` = `SUM(units_used)` de `lecta_ai_quota` **solo** en los scopes que dispara
      el usuario: `explain`, `page-recap`, `translate`, `evaluate`, `story`,
      `companion-note` (los de `ai-routes.ts`). Exportar esa lista como constante. Quedan
      fuera `free-courtesy` y el enriquecimiento de fondo (`ENRICH_UNITS_PER_HOUR`,
      `rate-limit.ts`), que el usuario no pidió. Cada llamada de `ai-routes.ts` cobra 1
      unidad (verificado), así que unidades = usos. Si `character-recap` cobra con otro
      scope, añadirlo.
    - `bucket_hour` está en horas (`floor(ms / 3 600 000)`): convertir los límites de la
      ventana antes de filtrar. Los scopes por hora se escriben también en prueba y se
      retienen 30 días (`index.ts:41`), así que alcanza para los 14 días.
    - `wordsSaved`: filas de `lecta_user_words` con `saved_at` (ms) dentro de la ventana y
      `deleted = false`. La tabla no tiene `created_at`.
    - `cloudBooks`: filas de `user_books` con archivo en R2 (`paper_only = false`).
    - `kindleLinked`: bool.
  - Palabras previstas: el conteo vive en el cliente. El servidor no lo da; la pantalla de
    F6 lo lee de IndexedDB si existe y, si no, lo omite.
- **Verificación**:
  - prueba con BD simulada: una cuenta en prueba da `trialEndedAt: null`, una vencida da el
    número, y la suma excluye `free-courtesy`;
  - `planFromAccountState` conserva `trialEndedAt`;
  - `pnpm gate`;
  - `EXPLAIN` en `lecta_dev`: sin full scan (los índices por `user_id` existen).
- **Riesgo**: bajo. Hay que evitar una consulta cara: es una sola fila por usuario y se
  llama una vez.
- **Migración**: no.
- **‖** F1–F3 (archivos disjuntos de F1). **Dep.**: ninguna.

#### F5. Aviso de fin de prueba, días 11 a 13 (no bloqueante)

- **Objetivo**: que el fin de la prueba no sorprenda y que el usuario sepa qué pierde.
- **Archivos**:
  - `src/client/components/reader/ReaderNotices.tsx` (y su `.test.ts`);
  - `src/client/components/Shelf.tsx` (zona de avisos de la estantería; ubicarla con
    `grep -n "notice\|aviso" src/client/components/Shelf.tsx`);
  - `src/client/components/ReaderCard.tsx:119` (texto del Carné);
  - lógica pura en `src/client/lib/trial-notice.ts` (nuevo).
- **Cambios**:
  - `trialNoticeDay(trialEndsAt, now)` = `ceil((trialEndsAt - now) / día)` cuando ese valor
    es 3, 2 o 1; si no, `null`. Se define por tiempo restante, no por «día N de la prueba».
  - Un aviso por día, descartable, con la marca de descarte en `localStorage` por día y
    try/catch. El texto nombra lo concreto que se pierde («La IA en contexto, tus libros en
    la nube y la lista completa de palabras previstas vuelven a Lecta+ el {fecha}.») y
    lleva un botón «Seguir con Lecta+» que abre el Carné. La `{fecha}` se formatea en
    hora local desde el instante, como `dateLabel` de `ReaderCard.tsx:20`
    (`toLocaleDateString("es-MX")`). En CDMX la primera es «8 de diciembre», no el 9.
  - Emite `app:trial-warning:<n>`.
  - En `ReaderNotices`, solo entre secciones (nunca encima del texto al abrir el libro).
  - En el Carné, `ReaderCard.tsx:119` mantiene la honestidad pero sin «sin ningún cargo»
    como cierre. Texto propuesto: «El {fecha} vuelves a Gratis. Tus palabras, tu gato y tu
    progreso se quedan; la IA, la nube y el Kindle vuelven a Lecta+.» (Luis aprueba el
    texto).
- **Verificación**:
  - `trial-notice.test.ts` con instantes explícitos: `trialEndsAt = Date.UTC(2026,11,9)`;
    a 3 días y 1 ms → null; a exactamente 3 días → 3; a 1 h → 1; vencido → null;
  - prueba de `ReaderNotices`: no pinta el aviso sin `trialEndsAt` y lo oculta tras
    descartarlo;
  - `pnpm gate`.
- **Riesgo**: bajo. Hay que vigilar no apilarlo con otros avisos del lector.
- **Migración**: no.
- **‖** F4. **Dep.**: F2 (para `trackPlanEvent`).

#### F6. Pantalla del día 15: «Así usaste Lecta+»

- **Objetivo**: convertir en el momento de pérdida, con datos reales del usuario.
- **Archivos**:
  - nuevo `src/client/components/TrialEndSheet.tsx` (chunk lazy);
  - `src/client/components/Shelf.tsx` o `src/client/App.tsx` (punto de montaje en la
    estantería, nunca en el lector);
  - `src/client/lib/account-plan.ts`.
- **Cambios**:
  - Si `trialEndedAt` existe y no se ha visto (`localStorage` `lecta:trial-end-seen`), al
    entrar a la estantería se carga en lazy una hoja descartable que llama a
    `/api/account/trial-summary`.
  - Contenido:
    - «Usaste la IA N veces, guardaste M palabras, K libros viven en la nube»;
    - cada cifra se omite si es 0;
    - precio mensual y anual, con el anual como equivalente mensual (`$42/mes`);
    - CTA al checkout y «Seguir con Gratis».
  - Emite `app:trial-end-view` y `app:trial-end-cta`.
  - Nunca aparece al tocar un libro (regla 2 de Zero-Friction). Si el usuario entra por
    deep link `?abrir=`, se difiere a la próxima visita a la estantería.
  - Opcional, con decisión de Luis: oferta de salida de 72 h (primer año a $399 MXN), con
    un precio o cupón de Stripe aparte.
- **Verificación**:
  - prueba: no se monta sin `trialEndedAt` ni con la marca de visto, y no se monta si hay
    libro abierto;
  - prueba de render con cifras 0 (se omiten);
  - `check:size`: el chunk inicial crece menos de 0,3 kB.
- **Riesgo**: medio, porque es lo más visible. Revisar en `papel` y `noche` a 390 px y a
  1440 px.
- **Migración**: no.
- **Dep.**: F4, F2.

---

### Bloque C: Hacer visible el valor de Lecta+

#### F7. La IA que falla en silencio lo dice

- **Objetivo**: que el usuario free sepa que el micro-cuento y la evaluación que ve son la
  versión local.
- **Archivos**:
  - `src/client/lib/learn.ts`: `evaluateSentenceWithAi` en la línea 234 y sus fallbacks
    262/275/287; `generateMicroStoryWithAi` en la 348;
  - `src/client/components/GamePanel.tsx` (llamadas en las líneas 272 y 299);
  - pruebas de `learn.ts`.
- **Cambios**:
  - Ambas funciones devuelven además `source: "ai" | "local"` y `locked: boolean` (true si
    el fallback vino de un 402 `LECTA_PLUS_REQUIRED`).
  - `GamePanel`, con `locked`, pinta `PlanNote feature="microstory"` / `"evaluate"` con el
    texto «Este cuento lo armó el gato con tus palabras. Con Lecta+ lo escribe la IA con
    frases de tu libro.» Una vez por sesión.
- **Verificación**:
  - prueba: un 402 mockeado da `locked: true`, un 500 da `locked: false`, y el resultado
    local no cambia;
  - `pnpm gate`.
- **Riesgo**: bajo.
- **Migración**: no.
- **‖** F8, F9, F10. **Dep.**: F2.

#### F8. «¿Quién era…?» al reanudar (character-recap)

- **Objetivo**: conectar la función de Lecta+ que ya existe en el servidor
  (`ai-routes.ts:592`, con `requireLectaPlus`) y no tiene llamador.
- **Archivos**:
  - `src/client/components/ResumeSessionOverlay.tsx`;
  - `src/client/lib/lexicon.ts:648` (`requestCharacterRecap`);
  - prueba del overlay.
- **Cambios**:
  - En el overlay de reanudar, un enlace discreto «¿Quién era…?» lista los nombres propios
    del pasaje (reutilizar la detección de nombres que ya alimenta el overlay; ubicarla con
    grep `capitalOnly|properNoun`).
  - Al tocarlo llama `requestCharacterRecap`. Si responde 402, `PlanNote
    feature="character-recap"` y el evento `app:recap-locked`.
  - Sin llamada automática: solo al tocar.
- **Verificación**:
  - prueba: no llama a la red al montar; al tocar llama una vez; un 402 pinta `PlanNote`;
  - `pnpm gate`.
- **Riesgo**: bajo. Hay que revisar el costo del prompt (`CHARACTER_RECAP_PROMPT_VERSION`,
  `ai.ts:15`) y que tenga caché.
- **Migración**: no.
- **‖** F7, F9, F10.

#### F9. Momentos de valor: nube y fin de capítulo

- **Objetivo**: mostrar Lecta+ donde el usuario siente la carencia, no en un menú.
- **Archivos**:
  - `src/client/components/AttachBookSheet.tsx` (segundo dispositivo sin archivo);
  - `src/client/components/DeepReadingSummaryModal.tsx` (cierre de capítulo; ubicar el
    pie con grep `onClose`);
  - textos de importación de EPUB propio (ubicar con grep `paper_only|cloudSync` en
    `Shelf.tsx`).
- **Cambios**:
  - Al importar el primer EPUB propio en free, una línea: «Este libro vive solo en este
    dispositivo. Con Lecta+ te sigue al celular y al Kindle.»
  - En `AttachBookSheet`, en free, `PlanNote feature="cloud"`.
  - En el resumen de capítulo, si el usuario free agotó la cortesía ese día, una línea
    con lo que la IA habría hecho en ese capítulo (sin llamar a la IA).
  - Copy unificado «Biblioteca en la nube» (idea E7) en el Carné y en la landing
    (`marketing/landing/`), y en el hero el anual como «$42/mes».
- **Verificación**:
  - pruebas de render por plan (free muestra la nota; plus y founder no);
  - `pnpm gate`.
- **Riesgo**: bajo.
- **Migración**: no.
- **‖** F7, F8, F10.

#### F10. Pelaje y racha: vista previa de lo bloqueado

- **Objetivo**: hacer deseable lo cosmético de Lecta+ sin quitar nada ganado.
- **Archivos**:
  - `src/client/components/CompanionCloset.tsx` (estado `locked`, líneas 443–500);
  - `src/client/components/CompanionCelebration.tsx` (hitos de racha de 7 y 30 días).
- **Cambios**:
  - Tocar un pelaje bloqueado lo prueba en el gato durante la vista del armario (sin
    guardar) y muestra `PlanNote feature="coat"`.
  - En el hito de racha de 7 o 30 días, en free, una línea opcional con el pelaje de
    Lecta+ que celebraría ese hito.
  - Los accesorios ya ganados no cambian.
- **Verificación**:
  - prueba: la vista previa no persiste el pelaje y el equipado no cambia al cerrar;
  - `pnpm gate`.
- **Riesgo**: bajo.
- **Migración**: no.
- **‖** F7–F9.

> Ya existe, no repetir: el contador «Te quedan N usos de IA de cortesía hoy»
> (`WordPanel.tsx:1401`). Solo cabe sugerir «Traducir» cuando queda 1 uso, en
> `src/client/hooks/useReaderTranslateHint.ts`. Si se hace, va dentro de F7.

---

### Bloque D: Costo y abuso (antes de sumar IA nueva)

#### F11. Tope diario invisible de IA para Lecta+ y prueba

- **Objetivo**: acotar el costo en el peor caso. Hoy solo hay topes por hora y scope
  (`src/worker/ai-units.ts`), y durante la prueba toda cuenta nueva es Lecta+.
- **Archivos**:
  - `src/shared/plan.ts` (nuevo `PLAN_LIMITS`);
  - `src/worker/rate-limit.ts` (`consumeRateUnits`, línea 11);
  - `src/worker/ai-routes.ts` (cada `consumeRateUnits`: líneas 42, 124, 282, 417, 478,
    545, 629);
  - `src/worker/account.ts`;
  - pruebas.
- **Cambios**:
  - `PLAN_LIMITS = { plusDailyAiUnits, trialDailyAiUnits }`. Valores propuestos: 300 y 150
    unidades al día; Luis decide.
  - `guardDailyAi(env, userId, plan, units)` usa `lecta_ai_quota` con scope `ai-daily` y
    bucket de día. Se llama después del tope por hora. Si se excede, 429 con el mismo
    texto amable del tope por hora, sin hablar de planes.
  - Si la IA falla, se reintegra igual que `guardAiCourtesy` (`ai-routes.ts:204`), con el
    mismo instante.
  - Si el tope por hora ya consumió su unidad y el diario rechaza, reintegrar la unidad
    por hora (o comprobar el diario antes del de hora).
  - `/api/account/state` no expone este tope: es invisible.
- **Verificación**:
  - prueba: la unidad 301 del día da 429 y la 300 no;
  - prueba de reintegro: un fallo de la IA devuelve la unidad al bucket del día del
    consumo, también cruzando la medianoche UTC;
  - `pnpm gate`.
- **Riesgo**: medio. Un tope bajo molesta a usuarios intensos; empezar alto y leer
  `lecta_ai_quota`.
- **Migración**: no (scope nuevo en una tabla existente).
- **‖** F12. **Dep.**: ninguna; conviene antes de F14–F17.

#### F12. Abuso de la prueba: alias y correos desechables

- **Objetivo**: que una misma persona no encadene pruebas de 14 días.
- **Archivos**:
  - `src/worker/auth.ts` (hooks de Better Auth; `CAPTCHA_ENDPOINTS`, línea 108;
    `databaseHooks`);
  - nuevo `src/shared/email-normalize.ts` con su lista;
  - pruebas.
- **Cambios**:
  - `normalizeEmail`: minúsculas; quitar `+etiqueta`; en `gmail.com` y `googlemail.com`,
    quitar puntos.
  - En el alta con contraseña o enlace mágico, si el correo es de un dominio desechable de
    la lista (corta, versionada en el repo, unas 200 entradas), responder 400 con un
    mensaje claro.
  - Si la forma normalizada ya existe con otra cuenta, la cuenta nueva nace **sin prueba**.
    Esto no se puede expresar sin estado: hace falta una columna
    (`trial_eligible BOOLEAN`) o una fila en `lecta_user_plan` con `plan = 'free'` y una
    marca. Ver migración.
- **Verificación**:
  - pruebas de `normalizeEmail`;
  - prueba de alta rechazada con dominio desechable;
  - prueba de que la segunda alta normalizada no recibe `trialEndsAt`;
  - `pnpm gate`.
- **Riesgo**: medio. Rechazar un dominio legítimo hay que evitarlo: la lista va solo con
  dominios conocidos de correo temporal.
- **Migración**: **sí** (034, `lecta_user_plan.trial_opt_out` o similar, solo en
  `lecta_dev`; prod con autorización). Alternativa sin migración: hacer solo el bloqueo de
  desechables y dejar los alias para después.
- **‖** F11.

#### F13. Reinicio de la cortesía a medianoche de CDMX (decisión de Luis)

- **Objetivo**: hoy la cortesía se reinicia a las 18:00 de CDMX, a media sesión nocturna.
- **Archivos**:
  - `src/shared/plan.ts` (`courtesyBucketHour`, línea 67);
  - `src/worker/free-courtesy.ts`;
  - `src/worker/ai-routes.ts` (`guardAiCourtesy`);
  - pruebas de `plan.test.ts` y `free-courtesy`.
- **Cambios**: el bucket se desplaza a UTC−6. México no aplica horario de verano desde 2022;
  confirmarlo antes de fijar la constante.
- **Verificación**:
  - prueba de frontera: un consumo a las 05:59Z y otro a las 06:01Z caen en buckets
    distintos;
  - prueba del día de transición: documentar si da usos de más o de menos y aceptarlo;
  - el reintegro usa el mismo bucket que el consumo.
- **Riesgo**: bajo. El día del deploy puede haber hasta 3 usos extra; es aceptable.
- **Migración**: no.
- **Dep.**: ninguna.

#### F14. Orden de eventos de Stripe

- **Objetivo**: que un `customer.subscription.updated` viejo que llega tarde no pise un
  `deleted` más nuevo.
- **Archivos**:
  - `src/worker/billing.ts` (webhook, líneas 183 y siguientes; `event.type`, línea 196);
  - `src/worker/plan-store.ts`.
- **Cambios**:
  - Primero, leer cómo se escribe hoy la fila del plan.
  - Si no compara `event.created`, guardar el último `event.created` aplicado por
    suscripción e ignorar los anteriores. Puede ir en `lecta_stripe_events` si ya guarda
    el instante; si no, necesita columna (034).
- **Verificación**: prueba con `updated` (t=2) y luego `deleted` (t=3) en orden invertido;
  el estado final es cancelado.
- **Riesgo**: bajo.
- **Migración**: posible. Si hace falta, se agrupa con la de F12 en la misma 034.
- **‖** F11–F13.

---

### Bloque E: Funciones Premium nuevas (acumulan valor durante la prueba)

Todas se protegen en el servidor y se ven durante la prueba, así que el día 15 hay algo
propio que perder.

#### F15. Coach semanal

- **Objetivo**: una nota semanal personal hecha por la IA (correo y tarjeta en «Tu
  recorrido»), una llamada por usuario y semana.
- **Archivos**:
  - `src/worker/weekly-digest.ts` (`buildUserDigest`, línea 25; ruta a demanda, línea 201);
  - `src/worker/index.ts` (cron, línea 85);
  - `src/worker/ai.ts` (prompt nuevo con versión);
  - `src/client/lib/journey-insights.ts`, `src/client/lib/coverage.ts`;
  - tarjeta en `src/client/components/JourneyInsights.tsx` (chunk lazy si pesa).
- **Cambios**:
  - Con `hasLectaPlus` (por `loadUserPlan`), el digest añade un párrafo «Tu coach» generado
    a partir de los datos agregados del digest: días leídos, palabras nuevas, vencidas,
    libro actual. Nunca texto del libro.
  - Texto cacheado en R2 (`coach/v1/<userId>/<semana ISO>.json`) para no regenerar. El
    límite de 1 llamada a la semana se cuenta en `lecta_ai_quota` (scope `coach`), que
    solo guarda contadores. Purgar el prefijo en `beforeDelete`.
  - Ruta `GET /api/coach/weekly` con `requireLectaPlus` para la tarjeta.
  - En free, la tarjeta muestra el titular y `PlanNote feature="coach"`.
- **Verificación**:
  - prueba: free no llama a la IA; plus llama una vez por semana (la segunda petición va a
    caché);
  - prueba de que el prompt no incluye texto del pasaje;
  - `pnpm gate`.
- **Riesgo**: medio (costo y calidad del texto). Se limita a 1 llamada por usuario y semana.
- **Migración**: no.
- **Dep.**: F11.

#### F16. Plan de estudio adaptativo

- **Objetivo**: qué leer y repasar esta semana según el hábito real y las vencidas.
- **Archivos**:
  - `src/client/lib/preparation.ts` (línea 204);
  - `src/client/lib/coverage.ts` (línea 236);
  - `src/client/lib/habitWindow.ts` (línea 68);
  - `src/client/lib/localNotificationScheduler.ts` (línea 62);
  - ruta nueva en el worker (por ejemplo `src/worker/study-plan.ts`, montada en `app.ts`).
- **Cambios**:
  - `GET /api/study-plan` (con `requireLectaPlus`) calcula en el servidor, con
    `lecta_user_words`, posiciones y actividad: vencidas por día, minutos sugeridos y el
    siguiente capítulo con su cobertura.
  - El cliente lo pinta en «Tu recorrido» (lazy) y lo usa para programar la notificación
    local en la ventana habitual (`habitWindow`).
  - Sin IA.
  - En free: el titular y `PlanNote feature="study-plan"`.
- **Verificación**:
  - pruebas puras del cálculo (vencidas reparten días, sin hábito usa la ventana por
    defecto);
  - prueba de ruta 402 en free;
  - `pnpm gate`.
- **Riesgo**: medio. No debe duplicar la lógica de `coverage.ts`: extraer lo compartido a
  `src/shared` si hace falta.
- **Migración**: no.
- **‖** F15.

#### F17. «Tu nivel y predicción de fluidez»

- **Objetivo**: estimar cuándo el usuario leerá con un 95 % de cobertura un libro típico
  de su idioma.
- **Archivos**:
  - `src/client/lib/journey.ts` (líneas 93 y 451 según la auditoría; verificar con grep);
  - θ en `lecta:user_language_profile:v1`;
  - cálculo en el servidor si se protege (ver «Cambios»).
- **Prerrequisito H8, verificado el 2026-11-25**: `useReviewSession.ts` ya marca
  `missedRef` en `tryRescue` (línea 744) y la calificación tras el rescate es Again (línea
  175). No es bloqueante. Antes de empezar, confirmar con una prueba que un fallo seguido
  de rescate da Again.
- **Cambios**:
  - Proyección con la tasa semanal de palabras consolidadas y la curva de cobertura por
    zipf.
  - Endpoint con `requireLectaPlus` que devuelve la fecha estimada y el intervalo.
  - En free: nivel actual visible (como hoy) y la predicción con `PlanNote`.
- **Verificación**:
  - pruebas puras de la proyección (sin progreso → «aún sin datos», nunca una fecha
    inventada);
  - `pnpm gate`.
- **Riesgo**: medio. Una predicción mala daña la confianza: mostrar el intervalo y «con tu
  ritmo actual».
- **Migración**: no.
- **Dep.**: ninguna fuerte; después de F15–F16 por prioridad.

---

### Bloque F: Reempaquetado (solo con datos y aprobación de Luis)

#### F18. «Tu análisis» profundo y estadísticas del glosario a Lecta+

- **Objetivo**: mover a Lecta+ lo de bajo uso y alto valor percibido.
- **Archivos**:
  - `src/client/components/JourneyInsights.tsx` («Cuándo lees», «Tu año de lectura»);
  - componente de estadísticas y filtros del glosario (ubicar con grep `glosario|glossary`);
  - endpoint de datos si el cálculo es del servidor.
- **Cambios**:
  - En free, los bloques se muestran con el titular y una cifra de muestra real del usuario
    más `PlanNote feature="insights"`.
  - Si los datos vienen del servidor, se protegen allí.
  - No se toca Repasar, FSRS, el Cuaderno local ni la racha.
- **Verificación**:
  - prueba de render por plan;
  - `pnpm audit:cuaderno` sigue igual;
  - `pnpm gate`.
- **Riesgo**: medio (percepción de «me quitaron algo»). Avisarlo en las notas de versión.
- **Migración**: no.
- **Dep.**: lectura de métricas del 12-23 (F1–F3).

#### F19. Cohortes por usuario: `lecta_plan_events` (opcional)

- **Objetivo**: medir la conversión por cohorte y función (quién vio qué antes de pagar).
- **Archivos**:
  - `db/migrations/034_plan_events.sql` (o 035 si F12 o F14 usan la 034);
  - `src/worker/landing-events.ts`;
  - `scripts/retention-stats.mjs`.
- **Cambios**:
  - Tabla `(user_id, day, event, hits)` con FK `ON DELETE CASCADE`.
  - Los eventos `app:` con sesión escriben también aquí.
  - Retención de 180 días en el cron.
- **Verificación**: pruebas de escritura tolerante a tabla ausente (como 028) y del reporte.
- **Riesgo**: bajo. Es dato personal: mencionarlo en el aviso de privacidad.
- **Migración**: **sí** (solo `lecta_dev`; prod con autorización).
- **Dep.**: F1.

---

### Opciones no incluidas por defecto

- **F20. Voz neural y segundo plano a Lecta+.** Riesgo medio-alto: la voz es parte del
  hábito y el costo marginal es 0 (se ejecuta en el dispositivo). Solo si Luis lo decide
  con datos.
- **F21. Experimentos de precio (después del 2026-12-09, condicionados a §6). No
  implementar.**
  - A: cortesía free de 10 a la semana y precio en USD para cuentas en inglés.
  - B: pase de 3 meses por $149 MXN, pago único (Checkout `mode=payment`, plan
    `lecta_plus` con `plan_expires_at`).
  - C: fundador vitalicio $1,499, estudiante $299 al año, familiar $799 al año.

  Cada uno necesita su propio diseño, precio en Stripe y una métrica de corte antes de
  empezar.

### Paralelismo y dependencias (resumen)

| Grupo | Fases | Notas |
|---|---|---|
| 1 | F1 ‖ F3 ‖ F4 | arranque inmediato |
| 2 | F2 | después de F1 (comparte la lista de features) |
| 3 | F5 | después de F2; antes del 12-04 |
| 4 | F6 | después de F2 y F4; antes del 12-08 |
| 5 | F7 ‖ F8 ‖ F9 ‖ F10 | después de F2 |
| 6 | F11 ‖ F12 ‖ F13 ‖ F14 | independientes; F11 antes de F15 |
| 7 | F15 ‖ F16, luego F17 | — |
| 8 | F18, F19 | después de la lectura del 12-23 |

## 5. Decisiones que requiere Luis

1. Texto del Carné (F5) y de la pantalla del día 15 (F6).
2. Oferta de salida de 72 h (primer año a $399): sí o no, y si se crea el precio o cupón en
   Stripe.
3. Topes diarios invisibles de IA (F11): valores para Lecta+ y para la prueba.
4. Alias y desechables (F12): cuentas duplicadas sin prueba (necesita la 034) o solo
   bloqueo de desechables.
5. Reinicio de la cortesía a medianoche de CDMX (F13).
6. Aplicar en prod las migraciones 034/035 (F12, F14, F19).
7. Qué pasa a Lecta+ en F18. Voz neural (F20): por defecto no.
8. Cuál experimento de precio (F21) se abre y cuándo.

## 6. Métricas de éxito y fechas de lectura

- **Lecturas**: **2026-12-23** (dos semanas después de las primeras pruebas vencidas) y
  **2027-01-09**. Fuentes: `pnpm landing:stats --days 30`, `pnpm retention:stats` (con
  F3) y el panel de Stripe.

| Métrica | Fuente | Meta |
|---|---|---|
| Conversión prueba → pago a 7 días del vencimiento | `retention:stats` (F3) | ≥ 4 % (referencia de prueba inversa sin tarjeta: 2–8 %) |
| Vista de la pantalla del día 15 / pruebas vencidas | `app:trial-end-view` / F3 | ≥ 60 % |
| CTA de la pantalla del día 15 / vistas | `app:trial-end-cta` | ≥ 15 % |
| `app:paywall` / `app:plannote:*` por feature | F1–F2 | identificar las 3 features que más llevan al Carné |
| `checkout-start` → `checkout-complete` | F1 | ≥ 50 % |
| Retención S1 de las cohortes en prueba frente a las anteriores | `retention:stats` | no baja (los avisos no espantan) |
| Costo de IA por cuenta en prueba al día | `lecta_ai_quota` | por debajo del tope de F11, con un p95 conocido |

Si la conversión a 7 días es menor del 2 % el 12-23, se prioriza F15–F16 (más valor
propio) antes que cualquier reempaquetado. Si es de 4 % o más, F21 puede abrirse el
2027-01-09.
