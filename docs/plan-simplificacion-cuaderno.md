# Plan de simplificación del Cuaderno — v2 (reabierto el 2026-11-10)

La v1 de este documento (commit `db15483`, 2026-11-08) declaraba las Fases 1–5
como **completadas**. La auditoría del 2026-11-10 sobre
`src/client/components/Vocabulary.tsx` encontró que las fases 1 a 3 no están en
el código y, además, nueve fallos de comportamiento que el plan no cubría. Este
documento sustituye a la v1: registra el estado real y el plan de trabajo
ajustado.

La auditoría se hizo leyendo el archivo completo, sus módulos vecinos
(`lib/learn.ts`, `lib/practice.ts`, `lib/idb.ts`, `GamePanel.tsx`) y el
historial de git. **No se ejecutó la app ni `pnpm gate`.** Los números de línea
son de `Vocabulary.tsx` al 2026-11-10 (4 085 líneas) y se moverán.

## 1. Estado real del plan v1

| Fase v1 | Qué decía | Qué hay en el código | Estado |
|---|---|---|---|
| 1 — Superficie | Modos libres y racha colapsados en `<details>`; jerga reducida | Rejilla de 6 modos a la vista en el héroe y 8 más tras «Más ejercicios», añadidos el 2026-11-09 (`:2458–2595`). Los únicos `<details>` del archivo son «Más filtros» y «Exportar». | **No hecha** |
| 2 — Gamificación ambiental | XP/Combo fuera del flujo principal | Barra «Energía Léxica» con Combo y puntos en el héroe, sin cambios desde el 2026-10-13 (`:2369–2398`); el cierre del repaso muestra «⭐ XP / Nivel» (`:3426–3457`). | **No hecha** |
| 3 — Sesión única | Cierre «Terminado por hoy.» con próxima fecha y racha | La frase no existe en `src/` ni en el historial. El cierre dice «Repaso terminado.» sin racha; «Terminar por hoy» sale sin pantalla de cierre (`:4047`). | **No hecha** |
| 4 — Contexto primero | Ya existía | `PracticeContext` va antes de revelar. | Correcta |
| 5 — Medir y cerrar | Gate verde, medición delegada | El commit del plan solo añadió el documento; no hay cambio de código asociado. | No verificable |

Por qué pasó sin alarma: `scripts/audit-cuaderno.mjs` no tiene afirmaciones
sobre estas fases. Los commits del 2026-11-09 (`142954c` «taller IA a la
vista», `e420b84` con «Más ejercicios») van en sentido contrario a la Fase 1.

## 2. Hallazgos de la auditoría

### 2.1 Comportamiento

| # | Hallazgo | Dónde |
|---|---|---|
| B1 | **El repaso queda bloqueado por el aprendizaje.** El botón principal ofrece «Aprender» mientras quede una palabra nueva; la sesión adaptativa de vencidas no tiene entrada y los repasos se atrasan. | `:2411–2444` |
| B2 | **«Aprender N palabras nuevas» promete todas y abre una tanda de 5.** El botón de repasar sí usa la cifra real. | `:2422` contra `:1351` |
| B3 | **La pista del gato ignora «Usar IA»** (solo pide sesión), el repaso se registra siempre con `hints: 0` y una pista tardía puede pintarse sobre la tarjeta siguiente. | `:3482`, `:1647`, `:1922–1949` |
| B4 | **El rescate tras fallar manda a «elegir palabra» sin comprobar que haya oración.** Sin oración es adivinar entre cuatro. | `:3593`, `:3636`, `:3678` |
| B5 | **Calificar puede borrar un significado recién rellenado.** `grade` guarda la copia de la palabra tomada al armar la cola y `updateSavedWord` escribe sin comparar; si `backfillWordMeanings` termina después, se pierde. | `:1637`, `:897` |
| B6 | **Tarjeta en blanco**: «Partida rápida» y «Chequeo 30 días» caen al modo «Palabra» aunque no haya significado. | `:1265–1269`, `:1322–1326` |
| B7 | **Parejas con una sola palabra restante** se resuelve sola y cuenta como acierto. | `:2131`, `:1827` |
| B8 | **Los distractores son siempre los mismos**: `pickDistractors` ordena por clave y toma los primeros. | `lib/practice.ts:130–147` |
| B9 | **«Pasar por ahora» no avanza nada**: las palabras sin significado vuelven al frente de cada tanda. | `:3386`, `:1347–1351` |

### 2.2 Cifras, texto y accesibilidad

| # | Hallazgo | Dónde |
|---|---|---|
| U1 | La píldora «Nuevas» cuenta también palabras ya repasadas con estabilidad < 2 días; no cuadra con «por aprender» del encabezado. | `:473–480`, `:2222` |
| U2 | La barra de progreso dice «asentadas / aprendiendo» y las píldoras «Dominadas / En Práctica». La etiqueta de cada fila va en plural («Nuevas», «Dominadas»). | `:2305–2319`, `:483–496` |
| U3 | El aviso de deshacer se pinta dos veces. | `:2192`, `:2817` |
| U4 | Borrar una cita no tiene deshacer y oculta el fallo de guardado. | `:2019–2024` |
| U5 | Los chips recientes son botones con `role="listitem"` (pierden la semántica de botón). | `:2622–2628` |
| U6 | El gato del héroe se pinta aunque el compañero esté desactivado, y su teclado no hace lo mismo que el clic. | `:2235–2263` |
| U7 | Tocar un chip reciente no hace nada visible si la palabra queda fuera del filtro o del límite de la lista. | `:935–953` |
| U8 | 13 estilos en línea y los glifos ⭐ ★ ✕ ▸ ▾. | varios |

### 2.3 Código

| # | Hallazgo | Dónde |
|---|---|---|
| K1 | `UnifiedNotebookView` no se usa en producción: `App.tsx` nunca pasa `words`. | `:160–309`, `:711–722` |
| K2 | Restos sin uso: pestaña `"today"`, `_onDeleteWord`, `MODES.needs`. | `:742`, `:725`, `:339` |
| K3 | Cada render recalcula `reviewQueue` y ~14 filtros de elegibilidad con regex; `filtered` no está memoizado, así que el `useMemo` de `flatWords` no ahorra nada y cada tecla del buscador lo repite todo. | `:1026`, `:2035`, `:2063`, `:2466–2572` |
| K4 | El archivo tiene 4 085 líneas (AGENTS.md dice 3 783) y el plan de refactor de «Deuda de complejidad» solo cubre `Reader.tsx`. | — |

## 3. Decisiones tomadas

- **Los modos libres se colapsan** (Luis, 2026-11-10), como pedía la v1. Esto
  deshace en parte `142954c`: el Taller con el Gato IA queda a un toque más.
- **Repasar primero (B1)** (Luis, 2026-11-10): el botón principal pasa a ser
  «Repasar» cuando hay vencidas y «Aprender» queda como segundo botón. Sin
  vencidas, «Aprender» vuelve a ser el principal.

## 4. Plan de trabajo

Regla general: cada fase cierra con `pnpm gate` y `pnpm audit:cuaderno` en
verde, en commit aislado. No se mezclan cambios funcionales con el refactor de
la Fase 5.

### Fase 0 — Poner el plan en hora · **hecha (2026-11-10)**

- Este documento.
- Tres afirmaciones nuevas en `scripts/audit-cuaderno.mjs`, tipo `defecto`
  (salen `CONFIRMADO` mientras el defecto siga): `C13-modos-libres-a-la-vista`,
  `C14-gamificacion-en-el-heroe`, `C15-no-hay-cierre-unico-de-sesion`.
  Cuando la Fase 2 arregle cada una, el arnés saldrá 1 (defecto «movido»): hay
  que pasarlas a tipo `corregido` con las comprobaciones invertidas (rejilla
  dentro de `<details>`, sin `nb-hero-energy`, con «Terminado por hoy.»), no
  borrarlas.
- Verificado: `node scripts/audit-cuaderno.mjs` → exit 0 (10/18 confirmadas,
  8 correcciones en pie, 0 regresiones) y `audit-cuaderno.test.mjs` 19/19.
  No se corrió `pnpm gate` completo.

### Fase 1 — Comportamiento (B1–B9) · **hecha (2026-11-10)**

Cada arreglo con su prueba en `Vocabulary.test.ts` (o `practice.test.ts` para B8).

- **B1** Botón principal «Repasar» con vencidas; «Aprender» como secundario.
- **B2** El botón de aprender dice el tamaño real de la tanda y cuántas quedan.
- **B3** La pista respeta `useAi`; el repaso registra las pistas usadas; la
  respuesta tardía se descarta si la tarjeta cambió (mismo patrón que
  `writeItemRef`).
- **B4** El rescate comprueba `isEligible(word, "choose")`; sin oración cae a
  «Significado» o no rescata.
- **B5** `grade` parte de la palabra vigente en `words`, no de la copia de la
  cola.
- **B6** Sin significado ni oración la palabra no entra en «Partida rápida» ni
  en el chequeo.
- **B7** Una tanda de parejas necesita al menos 2 palabras; la suelta va a otro
  modo elegible.
- **B8** Distractores variados con semilla por palabra (siguen siendo estables
  entre renders).
- **B9** Las palabras pasadas sin significado van al final de la cola de
  aprender.

Hecha en `Vocabulary.tsx` y `practice.ts`, con 15 pruebas nuevas
(`Vocabulary.test.ts`, bloque «Fase 1») y 5 afirmaciones nuevas en
`audit-cuaderno` (C16–C20; C1, C7 y C9 reescritas). `pnpm gate` verde
(3 381 pruebas, bundle 202,08/215 kB). Notas:
- **B1**: con vencidas, «Repasar» primero y el título del héroe también
  prioriza lo vencido. C1 deja de decir «aprender antes de examinar».
- **B3**: la pista cuenta al pedirse (también si la IA falla y cae al texto
  de reserva). El rescate no cuenta como pista.
- **B4**: sin oración el rescate baja a «Significado»; el texto del gato en
  ese caso es genérico.
- **B6**: el aviso de «Partida rápida» y del chequeo sale por la línea de
  estado de la lista (`saveError`), porque la nota de práctica vive en el
  héroe, fuera de la vista.
- **B8**: solo `pickDistractors`. `pickLevelDistractors` (distractores del
  rescate) sigue ordenando por clave; no se ve en la interfaz, queda para la
  Fase 4 si hace falta.
- Anclajes de `docs/auditoria/claims.json` (H6, H8) movidos a las líneas
  nuevas de `Vocabulary.tsx`.

Límite: no se toca FSRS, Rasch, ZPD, `isLearnPending` ni `reviewQueue`. B8
cambia `pickDistractors` en `practice.ts`, que es presentación del ejercicio,
no agenda.

### Fase 2 — Superficie (fases 1–3 de la v1)

- **Un solo plegable**: `<details>` «Más formas de practicar», cerrado por
  defecto, debajo del botón principal del héroe.
- **Dentro**: los cinco modos actuales, el Taller con el Gato IA y los ocho de
  «Más ejercicios» en una misma rejilla. Desaparecen el botón «Más ejercicios»
  y el estado `moreModesOpen`.
- **Avisos** («Los modos libres usan palabras que ya viste…» y la nota de
  práctica) dentro del plegable.
- **Racha y XP**: «Energía Léxica», Combo y racha salen del héroe; la racha
  aparece solo en el cierre de sesión. El bloque «⭐ XP / Nivel» sale del cierre.
- **Cierre único** «Terminado por hoy.» con próxima fecha y racha; «Terminar
  por hoy» y «Terminar por ahora» pasan por él.
- Al abrir el taller desde el plegable se conserva el desplazamiento hasta él.
- Capturas a 1440 y 390 px en `papel` y `noche`.

### Fase 3 — Cifras, texto y accesibilidad (U1–U8)

- Una sola cuenta para «Nuevas» y «por aprender»; etiquetas unificadas entre
  barra, píldoras, filtros y filas (en singular en la fila).
- Un solo aviso de deshacer; deshacer también en citas, con error visible.
- Chips recientes como lista de botones con roles correctos; el chip limpia el
  filtro si la palabra no está a la vista.
- El héroe respeta el compañero desactivado y su teclado iguala al clic.
- Glifos a `Icon` y estilos en línea a `notebook.css`, coordinado con la
  tanda 3 de `docs/auditoria/plan-fase4-emojis.md`.

### Fase 4 — Limpieza y rendimiento (K1–K3)

- Borrar `UnifiedNotebookView`, la pestaña `"today"`, `_onDeleteWord` y
  `MODES.needs` (y las pruebas o CSS que solo ellos usen).
- Memoizar la cola de repaso por minuto, los conteos de elegibilidad por modo
  y `filtered`; el buscador no debe recalcular las colas.
- Medir antes y después con un cuaderno de 300+ palabras.

### Fase 5 — Partir `Vocabulary.tsx` (K4)

Mismo esquema que Reader, sin cambios funcionales, un commit por paso:

- **V1 — hooks**: `useNotebookData` (carga, filtros, conteos),
  `useLearnSession` (ficha de primera exposición), `useReviewSession` (cola,
  calificación, parejas, escribir).
- **V2 — componentes**: héroe, lista del herbario, ficha de aprender, tarjeta
  de repaso, pestaña de citas.
- **V3 — compositor**: `Vocabulary.tsx` queda como orquestador.
- Actualizar «Deuda de complejidad» en `AGENTS.md` y los anclajes de
  `audit-cuaderno`.

## 5. Orden y dependencias

Fase 0 → 1 → 2 → 3 → 4 → 5. No quedan decisiones de producto abiertas. La
Fase 5 va al final para no partir código que las fases
anteriores van a borrar o mover.
