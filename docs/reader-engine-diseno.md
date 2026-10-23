# Diseño — sacar la lógica del lector de `Reader.tsx`

Sesión de diseño del 2026-10-22, posterior al cierre de la Fase 7 (§10 de
`docs/plan-8-fases.md`, cerrada con desvío en 4 573 líneas). Este documento **no cambia código**:
fija la forma, el orden y las pruebas antes de tocar nada. La fase 7 terminó donde el plan manda
parar; esto es la línea de trabajo que haría falta para llegar a 3 500.

## 0. Objetivo y no-objetivos

**Objetivo (decidido el 2026-10-22).** Bajar `Reader.tsx` de 4 573 a **≤ 4 050 con los cuatro
cortes del §5**, y a **≤ 4 000** si entra el quinto (`updateSettings`), sin cambiar comportamiento
observable, con las mismas puertas (gate + e2e) y pruebas unitarias nuevas donde el e2e no llega.

La meta de ≤ 3 500 del §10.3 del plan **queda fuera de esta línea**: exigiría mover efectos
(oleada 2) y los callbacks restantes (oleada 3), donde el e2e es más ciego. Se reevalúa cuando el
archivo esté en 4 050.

**No-objetivos.** Reescribir el lector; cambiar props públicas (`ReaderProps`), exports
(`recordDominated`, `PRESET_LABELS`, `ReaderSettingsTab`) ni CSS; tocar `reader.css`; subir el
tope de 28 warnings; mover el efecto de inicialización del EPUB (ver R6).

## 1. Inventario medido (2026-10-22, tras el corte 7)

`Reader.tsx` = **4 573 líneas**: módulo 1–396 y componente 397–4 571 (**4 175** líneas), de las
que el JSX es 4 079–4 570 (**492**) y la lógica 397–4 078 (**3 683**).

Dentro de la lógica:

| Pieza | Líneas | Nota |
|---|---|---|
| 44 `useEffect` | 1 097 | el bloque más grande después de los callbacks |
| 30 `useCallback` | 1 011 | seis de ellos son las piezas de la tabla de abajo (629) |
| 64 `useState` | 95 | declaraciones de una línea |
| 78 `useRef` | 110 | idem |
| resto | ~1 370 | llamadas a hooks existentes, destructuring, return |

Las seis piezas candidatas, con sus dependencias **reales** (solo valores: sin tipos, sin nombres
de propiedades, sin globales), medidas con `scripts/find-free-vars.mjs` y clasificadas contra los
imports y el ámbito del componente:

| Pieza | Rango | Líneas | Deps | imports | estado | refs | callbacks | hooks | props |
|---|---|---|---|---|---|---|---|---|---|
| `openSelection` | 1413–1484 | 72 | 30 | 10 | 4 | 11 | 4 | 1 | 0 |
| `refreshProfile` | 1913–1996 | 84 | 15 | 8 | 0 | 7 | 0 | 0 | 0 |
| `loadSection` | 1998–2215 | 218 | 59 | 16 | 14 | 20 | 6 | 2 | 1 |
| `navigate` | 2221–2289 | 69 | 17 | 4 | 1 | 9 | 2 | 1 | 0 |
| `checkPassiveExposure` | 3017–3086 | 70 | 17 | 7 | 2 | 6 | 2 | 0 | 0 |
| `goPage` | 3091–3206 | 116 | 38 | 10 | 7 | 12 | 6 | 2 | 1 |
| **total** | | **629** | **176** | **55** | **28** | **65** | **20** | **6** | **2** |

Lectura de la tabla:

1. **55 de las 176 dependencias son imports**: no viajan, se importan en el módulo nuevo. Es la
   misma regla que ya usaron los siete cortes de la fase 7.
2. **65 son refs** y **28 son setters de estado**: eso es lo que hay que llevar al contexto.
3. **20 callbacks** incluyen tres de las propias piezas (`loadSection`, `navigate`,
   `checkPassiveExposure`), que dentro de un mismo módulo son llamadas internas, no campos.
4. La unión de nombres distintos es **85**: el contexto no es pequeño. Un `<ReaderEngine ctx={…} />`
   con 85 props sería peor que el statu quo; hay que empaquetarlo.

## 2. El grafo ya está resuelto

Ninguna pieza se llama entre sí salvo en una dirección:

```
refreshProfile ─┐
loadSection ────┼─→ navigate ─→ goPage
checkPassiveExposure ──────────┘
openSelection (hoja)
```

Es un **DAG**, y el orden del archivo ya lo respeta. No hay ciclos que romper con un provider: por
eso **no hace falta un `createContext` de React**. Basta pasar un objeto.

## 3. Dos tipos de pieza, dos destinos

La tabla del §1 separa las piezas por lo que necesitan:

**Tipo 1 — función sobre refs (sin React).** `refreshProfile` y `checkPassiveExposure` no tocan
setters de estado de la UI: leen y escriben refs y llaman a módulos de `lib/`. Van a
`src/client/lib/` como funciones normales, con el patrón que ya usa el repo
(`lib/deep-reading.ts`, `lib/profiles`-style) y pruebas sin jsdom.

**Tipo 2 — hook con estado compartido.** `openSelection` (4 setters), `loadSection` (14),
`navigate` (1) y `goPage` (7) cambian estado de React y se llaman desde JSX, efectos y otros
hooks. Van a `src/client/hooks/`, con la forma de los cinco hooks que ya existen
(`useReaderTts`, `useReaderPersistence`, …): **un objeto de parámetros, no 40 props sueltas**.

Meter el tipo 1 en un hook sería peor: añade un `useCallback` y una lista de dependencias allí
donde hoy no hay riesgo ninguno.

## 4. Forma propuesta

### 4.1 El contexto (tipo 2)

```ts
// src/client/hooks/reader-engine/context.ts
export interface ReaderEngineCtx {
  // Espejos que ya existen en Reader (settingsRef, layoutRef, stateRef…): se pasan tal cual.
  refs: {
    bookRef; containerRef; catalogRef; metricsRef; layoutRef; settingsRef; stateRef;
    pageRef; pageCountRef; sectionIndexRef; sectionTextRef; tocRowsRef; navIntentRef;
    ttsStopOnNavRef; activeScrollFragRef; consultedInPageRef; phrasesRef; analyzerRef;
    overlayReleaseRef; currentChapterLookups; /* … hasta 40 */
  };
  // Estado que el motor lee; se pasa el setter, no el valor (evita staleness en callbacks estables).
  setters: {
    setSelection; setSheet; setCharOffsetInChapter; setPage; setPageCount; setPrediction;
    setSectionIndex; setSectionTitle; setSectionWords; setScrollRatio; setState; /* … 28 */
  };
  // Helpers que hoy también son `useCallback` del lector y que el motor usa.
  helpers: { analysisFor; recordConsult; signalCompanion; trackEvent; setPageIdx; /* … */ };
  inputs: { language; sectionTotal; sectionWords; bookHash; onError };
}
```

### 4.2 Regla de identidad (la que decide si esto sale bien)

```ts
// en useReaderEngine
const ctxRef = useRef(ctx);
ctxRef.current = ctx;                       // se refresca en cada render
const navigate = useCallback(
  (intent, dest) => navigateImpl(ctxRef.current, intent, dest),
  [],                                       // identidad ESTABLE
);
```

Dos reglas:

1. **Las acciones del motor son estables.** Hoy `navigate` se recrea cuando cambian sus 13
   dependencias, y alimenta `useReaderTts` y `useReaderShortcutsAndGestures`; con `ctxRef` deja de
   hacerlo. Eso es una mejora, pero es un cambio de comportamiento de rendimiento: va en su propio
   commit y se mide.
2. **Nunca leer estado de React por cierre en una acción estable.** Todo lo que cambia va por
   `ctxRef`, o se lee de los refs espejo que el lector ya mantiene.

### 4.3 Ownership

| Dato | Dueño | Consumidores |
|---|---|---|
| Refs del motor (40) | `Reader` (como hoy) | motor + efectos que se quedan |
| Estado de lectura (página, sección, predicción…) | `Reader` (`useState`) | JSX + motor (vía setters) |
| Acciones (`navigate`, `goPage`, `loadSection`, `openSelection`) | motor | JSX, efectos, otros hooks |
| Props del lector (`bookHash`, `file`, `onError`…) | `App` | `Reader` y motor |

Se mantiene el dueño actual de cada ref/estado: el motor no se queda con estado propio. Así el
corte es reversible pieza a pieza y no hay dos fuentes de verdad.

## 5. Plan por cortes

Orden por riesgo creciente, no por tamaño. **Un corte = un commit**, con `pnpm gate` +
`pnpm test:e2e` + pruebas nuevas.

| # | Corte | Qué sale | Líneas fuera | Líneas dentro | Neto | Total |
|---|---|---|---|---|---|---|
| 1 | `lib/reader-evidence.ts` | `refreshProfile` + `checkPassiveExposure` | 154 | ~6 | −148 | 4 425 |
| 2 | `hooks/useReaderSelection.ts` | `openSelection` + `closeSelection` | 77 | ~20 | −57 | 4 368 |
| 3 | `hooks/useReaderNavigation.ts` | `navigate` + `goPage` | 185 | ~41 | −144 | 4 224 |
| 4 | `hooks/useReaderSectionLoader.ts` | `loadSection` | 218 | ~43 | −175 | 4 049 |
| 5 | `hooks/useReaderSettings.ts` | `updateSettings` (solo si el 4 deja > 4 000) | 53 | ~15 | −38 | 4 011 |

**Estado de ejecución (2026-10-22):**

| Corte | Estado | `Reader.tsx` | Pruebas nuevas |
|---|---|---|---|
| 1 · `lib/reader-evidence.ts` | hecho | 4 573 → 4 422 (−151; se proyectaba −148) | 11, sin jsdom |
| 2 · `hooks/useReaderSelection.ts` | hecho | 4 422 → 4 354 (−68; se proyectaba −57) | 7, jsdom + `act` |
| 3 · `hooks/useReaderNavigation.ts` | hecho | 4 354 → 4 211 (−143; se proyectaba −144) | 12, jsdom + `act` |
| 4 · `hooks/useReaderSectionLoader.ts` | hecho | 4 211 → 4 032 (−179; se proyectaba −175) | 8, jsdom + `act` |
| 5 · `hooks/useReaderSettings.ts` | hecho | 4 032 → **3 982** (−50; se proyectaba −53) | 7, jsdom + `act` |

**Objetivo cumplido:** 3 982, por debajo de los dos umbrales de la línea (≤ 4 050 con cuatro cortes,
≤ 4 000 con el quinto). `Reader.tsx` pasó de **4 573 a 3 982 líneas** (−591, −13 %) con cinco
commits, cada uno con gate y e2e verdes.

Dos notas del corte 2:

- **El lint bajó de 28 a 23 warnings** con el tope igual en 28: al salir el bloque que mutaba el
  parámetro `hit`, el análisis del React Compiler dejó de bailar el componente y se fueron 5
  `react-hooks/preserve-manual-memoization`. No se tocó la configuración. `AGENTS.md` y §12 de
  este plan quedan actualizados.
- **El e2e falló una vez** en el Recorrido 9 (`.shelf-welcome-hero` no visible al arranque, ~5 s).
  El mismo test pasó en aislamiento y la suite completa pasó 12/12 en las dos corridas
  siguientes con el mismo código: es un fallo de arranque, no de la extracción.

Notas del corte 3:

- **Salieron dos hooks, no uno**: `navigate` tiene que existir antes de montar la voz
  (`useReaderTts` lo recibe en el render, línea ~2164) y `goPage` necesita
  `checkPassiveExposure` (~2860). Por eso el archivo exporta `useReaderNavigation` y
  `useReaderPagination` y el lector los llama en dos puntos distintos.
- El lint bajó otra vez, de 23 a **21 warnings** (otras dos
  `preserve-manual-memoization` que dejaron de bailar). Tope igual en 28.

Notas del corte 4:

- El cargador era el bloque más acoplado, como decía el inventario: 43 entradas (14 setters,
  20 refs, 6 helpers, 2 salidas de hooks y `onError`). Pasó sin cambios de comportamiento y con
  el cuerpo (194 líneas) idéntico byte a byte.
- Su tipo de restauración reutiliza `ReaderNavRestore` del corte 3 en vez de duplicarlo.

Notas del corte 5:

- `updateSettings` eran 54 líneas con solo tres dependencias (el updater de `setSettings`,
  `saveReaderSettings` y `bookHash`). Su cuerpo (46 líneas) es idéntico byte a byte; lo único
  nuevo es que ahora la acción es estable, así que los componentes que la reciben por prop dejan
  de re-renderizarse por identidad.

**Qué queda para 3 500:** lo de la §5, oleada de efectos (508 líneas en 14 bloques) más la
oleada 3 de callbacks. La decisión del 2026-10-22 es no hacerlo en esta línea: se reevalúa con
estas cifras delante.

Ese es el techo del tipo 1 + tipo 2: **~4 050**, todavía lejos de 3 500. Lo que falta no son
callbacks sino **efectos** (1 097 líneas en 44 bloques):

| Oleada | Bloques | Líneas | Destino |
|---|---|---|---|
| Medición y enfoque | 29–34 | 177 | `useReaderMeasurement` |
| Sesión: progreso, checkpoint, sonido, pacer | 39–44 | 207 | `useReaderSession` |
| Presencia del gato, zen y visibilidad | 4, 7, 9, 10, 13, 14, 15, 16 | 124 | `useReaderPresence` (extender el existente) |
| Espejos de refs | 2, 17–20, 34–36, 38 | 27 | se disuelven en `ctxRef` |

Con la oleada de efectos (508 líneas fuera, ~30 de plumbing: −478) el archivo queda en **~3 570**;
para cruzar 3 500 hace falta además la oleada 3 (callbacks restantes: `updateSettings` 53,
`maybeAutoEnrich` 52,
`handleRecapClick` 52, `handleTriggerReturnRecap` 45, `handleTtsCaptureWord` 42,
`finishDeepReading` 41 y ~96 más), que lo deja en **~3 270**.

**Conclusión honesta:** 3 500 no se alcanza con el tipo 1 + tipo 2 (`~4 050`), ni con esos más los
efectos (`~3 570`). Se cruza recién al final de la oleada 3. Si el objetivo se queda en 3 500 por
escrito, la línea de trabajo es de tres oleadas y ~6 commits.

## 6. Corte 1 en detalle (el que validaría el patrón)

`refreshProfile` (1913–1996) y `checkPassiveExposure` (3017–3086) son funciones puras sobre refs:

```ts
// src/client/lib/reader-evidence.ts
export interface EvidenceRefs {
  savedForms; evidenceRef; pendingKnowledgeRef; knowledgeMapRef;
  adjustRef; baseThresholdRef; profileRef; bookRef;
  consultedInPageRef; pageCountRef; pageEnteredAtRef; sectionIndexRef;
}
export async function refreshProfile(refs: EvidenceRefs, lang: string, scope?: DbScope): Promise<void>
export function checkPassiveExposure(refs: EvidenceRefs, input: { language: string; sectionWords: number;
  applyKnowledgeRow: (row: KnowledgeRow) => void }): void
```

- `Reader.tsx` queda con una llamada de 1–3 líneas en cada uno de los 2 usos.
- Cero hooks nuevos, cero dep arrays nuevos, cero cambio de identidad: el riesgo es el mínimo del
  inventario.
- Pruebas en `src/client/lib/reader-evidence.test.ts` (sin jsdom, como `lib/`):
  1. sin evidencia creíble no hay `batchLookup` y el perfil queda en el umbral base;
  2. `isCredibleKnowledge` filtra el `inferred` sin palabra guardada (el caso que el comentario de
     1910 documenta);
  3. la segunda ronda de bases clíticas solo pide bases verificables;
  4. lo pendiente de esta sesión (`pendingKnowledgeRef`) sobrevive aunque el catálogo no lo traiga;
  5. `checkPassiveExposure` no escribe nada si no se cumplió el `dwell` requerido.

## 7. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Cambiar la identidad de `navigate`/`goPage` altera cuándo se re-suscriben `useReaderTts` y los atajos | primero mover **tal cual** (mismas deps); estabilizar con `ctxRef` en un commit aparte |
| R2 | Leer estado viejo al pasar de cierre a refs | solo refs espejo que ya existen; test de "lee el último valor" por hook |
| R3 | `react-hooks/exhaustive-deps` nuevo rompe el gate (28/28) | deps completas desde el primer commit; un warning nuevo se arregla, no se sube el tope |
| R4 | El e2e no ve errores de orden de efectos ni de refs | prueba unitaria por corte + revisión de los 6 efectos que dependen de las acciones movidas |
| R5 | El presupuesto de JS se mueve | todo esto ya es el chunk diferido `Reader-*.js`; verificar con `pnpm check:size` en cada corte |
| R6 | Mover el efecto de init del EPUB (2339–2573, 235 líneas) | **fuera de alcance**: es el único bloque que el e2e no cubre de verdad. Si algún día se mueve, va solo, con prueba dedicada |

**Criterio de parada de un corte:** si la interfaz del módulo nuevo supera el doble de las líneas
movidas, la pieza está más acoplada de lo medido: se revierte ese corte y se replantea (§R6).

## 8. Pruebas: el arnés que ya existe

No hay `@testing-library/react` en el repo y no hace falta: `useReaderPersistence.test.ts` (y
`useReaderChapterPrep`, `useReaderShortcutsAndGestures`, `useReaderAnnotationsAndSearch`) montan
el hook con `jsdom` + `createRoot` + `act` y leen su retorno desde un objeto mutable. Ese es el
molde para el tipo 2; el tipo 1 se prueba como cualquier módulo de `lib/`.

Qué se prueba en cada hook, en este orden:

1. **Identidad estable**: dos renders seguidos devuelven exactamente las mismas funciones (`toBe`).
2. **Última versión**: cambiar un ref entre renders y llamar a la acción ve el valor nuevo.
3. **Contrato**: los casos límite de la pieza (bordes de página, última sección, selección vacía,
   capítulo sin analizar) con las mismas expectativas que hoy tiene el lector.
4. **Sin efectos colaterales nuevos**: los setters se llaman una vez y con el valor esperado.

Lo que **no** se prueba: duplicar los 9 recorridos del e2e. El e2e sigue siendo la red de
integración; estas pruebas cubren justo lo que el e2e no ve (orden e identidad).

## 9. Decisiones tomadas (2026-10-22)

| Pregunta | Decisión | Consecuencia |
|---|---|---|
| Objetivo de líneas | **≤ 4 050** con los cuatro cortes; **≤ 4 000** con el quinto | se corta aquí la línea; 3 500 se reevalúa después, no es la puerta |
| Forma | **Cuatro hooks pequeños** + un módulo de `lib/`, no un `useReaderEngine` de 85 campos | cada corte con su interfaz, su prueba y su rollback |
| Efecto de init del EPUB | **No se mueve** | el archivo no baja de ~4 050 por esta vía; R6 se mantiene |

Queda anotado lo que **no** se hace en esta línea y por qué: ni la oleada de efectos (§5) ni el
efecto de init. Si más adelante se quiere 3 500, la decisión se reabre con estas cifras delante.

## 10. Anexo — reproducir las mediciones

```bash
wc -l src/client/components/Reader.tsx          # 4 573
node scripts/find-free-vars.mjs src/client/components/Reader.tsx 1913 1996
node scripts/find-free-vars.mjs src/client/components/Reader.tsx 1998 2215
node scripts/find-free-vars.mjs src/client/components/Reader.tsx 2221 2289
node scripts/find-free-vars.mjs src/client/components/Reader.tsx 3017 3086
node scripts/find-free-vars.mjs src/client/components/Reader.tsx 3091 3206
node scripts/find-free-vars.mjs src/client/components/Reader.tsx 1413 1484
```

`find-free-vars` devuelve las libres **incluyendo nombres de tipos** (los literales de tipo no se
filtran) y, según el nodo que elija, puede dejar fuera la lista de parámetros. Los números de la
tabla del §1 son los de un filtro adicional que descarta nodos de tipo y clasifica cada nombre
contra los imports y el ámbito del componente; ese script no se commiteó — si se quiere repetible,
va a `scripts/` en el primer corte.
