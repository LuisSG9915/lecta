# Traspaso — Fase 7 (partir `Reader.tsx`)

Documento de continuidad para otra sesión. No repite el plan: lo complementa con el estado
exacto, el método que funciona y lo que queda.

- **Fecha:** 2026-10-22
- **Rama:** `main`, árbol limpio
- **Último commit relevante:** `08258c1`
- **Plan de referencia:** `docs/plan-8-fases.md` §10 (Fase 7)
- **Estado:** fase **abierta**. Seis cortes hechos, todos con gate y e2e verdes.

## 1. Dónde estamos

`Reader.tsx` pasó de **5 503 a 4 623 líneas** (−16 %). Lo extraído:

| Corte | Archivo | Líneas | Props |
|---|---|---|---|
| 1 | `src/client/components/reader/ReaderSettingsSheet.tsx` | 297 | 24 |
| 2 | `src/client/components/reader/ReaderContent.tsx` | 291 | 45 |
| 3 | `src/client/components/reader/ReaderNotices.tsx` | 116 | 19 |
| 4 | `src/client/components/reader/ReaderSelectionBar.tsx` | 133 | 11 |
| 5 | `src/client/components/reader/ReaderFocusLayers.tsx` | 71 | 12 |
| 6 | `src/client/components/reader/ReaderFloatingBars.tsx` | 93 | 12 |

Objetivo del plan: ≤ 3 500 (meta 3 000). **No alcanzado**: el JSX restante son ~266 líneas; el
resto del archivo es lógica que no se puede mover sin hooks.

## 2. Invariantes que no se pueden romper

- `export default Reader` con las mismas props.
- `export const recordDominated` y `export const PRESET_LABELS` (los importa `Reader.test.ts`).
- Las reglas CSS que verifican `Reader.test.ts:348` y `:367` siguen en
  `src/client/styles/reader.css`.
- `export type ReaderSettingsTab` y el re-export de `markSectionPreviewed` /
  `shouldAutoShowPreview` / `BilingueParagraph` siguen existiendo (los usa el resto de la app).
- Una extracción = un commit. Si el e2e falla, se revierte **esa** extracción; no se
  "arreglan" las pruebas bajando asserts.

## 3. El método que funciona (repetible)

Cada corte sigue los mismos pasos. No improvises otro camino: los seis cortes salieron así.

### 3.1 Localizar el bloque

Anclas actuales (las líneas cambian; busca el texto):

```bash
grep -n "<SmartReaderDock\|<ReaderOverlays\|const loadSection = useCallback\|const goPage = useCallback\|const openSelection = " src/client/components/Reader.tsx
```

### 3.2 Calcular las props con la herramienta del repo

```bash
node scripts/find-free-vars.mjs src/client/components/Reader.tsx <inicio> <fin>
```

Devuelve las variables libres (las que el bloque usa y no declara dentro). **El rango debe caer
dentro de un único nodo del AST**: si avisa de que usará un bloque mayor, ajusta las líneas al
elemento JSX o a la función exacta. Filtra a mano etiquetas HTML y globales (la herramienta ya
quita la mayoría).

### 3.3 Decidir qué es prop y qué es import

Antes de escribir la interfaz, mira cada nombre libre:

1. **Si es un import del propio `Reader.tsx`** (`Icon`, `FocusRuler`, `captureDbScope`,
   `saveSessionValue`, `triggerHaptic`, `tapZone`, `markSectionPreviewed`,
   `isFeatureFlagEnabled`, helpers de frases…): **impórtalo en el componente nuevo** y saca ese
   nombre de las props. En los seis cortes esto quitó entre 1 y 7 props por bloque.
2. **Si es estado, ref o callback del lector**: va como prop.
3. **Si es un tipo**: impórtalo con `import type` desde su módulo de origen.

### 3.4 Regla del compilador de React

Un ref pasado como prop **tiene que llamarse `…Ref`**, o `react-hooks/immutability` falla con
«This value cannot be modified». Ya pasó con `lastPoint` → `lastPointRef`.

### 3.5 Escribir el componente

- Copia el bloque **tal cual** y dedéntalo; no reescribas el JSX.
- Encabezado: comentario de qué es y de dónde salió (`Extraída de Reader.tsx (Fase 7)`).
- `export function X(props: XProps) { const { ... } = props; return (<>…</>); }`
  (o `return (…);` si el bloque es un solo elemento).
- Cierra el import de tipos contra el módulo correcto: `ReaderSettings` y `ThemeChoice` viven en
  `lib/settings`; `ReaderSettingsTab` se exporta desde `Reader.tsx` (import `type`, sin ciclo en
  runtime); `CompanionContextValue` desde `CompanionProvider`.

### 3.6 Sustituir en `Reader.tsx`

- Reemplaza el rango por `<X ...props />` y añade el import.
- **Borra los imports que quedan sin uso** (`tsc` los marca con TS6133; el lint también).

### 3.7 Verificar (obligatorio, en este orden)

```bash
pnpm typecheck        # guía las props; itera hasta que salga limpio
pnpm lint             # tope duro: 28 warnings, 0 errores
pnpm test             # 173 archivos / 2 455 pruebas
pnpm test:e2e         # 12/12; ~1,5 min y reconstruye dist/
wc -l src/client/components/Reader.tsx
pnpm gate             # typecheck + lint + test + build + check:size
```

## 4. Lo que queda (medido)

### 4.1 Presentación — ~266 líneas

| Bloque | Líneas | Props | Notas |
|---|---|---|---|
| Dock + cableado de modos | ~94 | ~49 | `<SmartReaderDock` en `Reader.tsx`; estado de modo lectura/audio/lienzo. Props caras: valora si compensa. |
| Props de `<ReaderOverlays` | ~172 | — | Es solo el paso de props a un componente que **ya existe**. Moverlo no reduce acoplamiento; se puede dejar. |

Hacer el dock deja el archivo en ~4 530. **No llega a 3 500.**

### 4.2 Lógica — aquí está el salto real

| Pieza | Ancla | Líneas | Comentario |
|---|---|---|---|
| Cargador de sección | `const loadSection = useCallback(` (L2000) | ~223 | El núcleo: parsea sección, mide, aplica marcas, dispara predicción. Depende de ~25 refs/estado. |
| Paginación | `const goPage = useCallback(` (L3093) | ~120 | Más métricas y `navigate` (L2223). |
| Selección | `const openSelection = (` (L1415) | ~73 | Más el estado `selection`/`selButton` y el lookahead de palabras. |
| Perfil y exposición | `refreshProfile` (L1915), `checkPassiveExposure` (L3019) | ~159 | Más aislados. |

Para extraerlós hace falta un **objeto de contexto único** (`ReaderEngineContext`) que el hook
reciba y devuelva, o pasar a que los componentes extraídos compartan ese `ctx` (patrón que ya usa
`ReaderOverlays`). Decisión pendiente de diseño: **no empezar por aquí sin acordar la forma**,
porque un error de orden de efectos o de refs no lo caza el e2e.

## 5. Trampas encontradas (para no repetirlas)

1. `useReaderTts` **ya existía**: la extracción 1 del plan v2 era innecesaria.
2. `CompanionContextValue` estaba declarado sin `export`; se exportó en el corte 1.
3. `isFullscreenSupported` es **función** (`isFullscreenSupported()`), no booleano.
4. Los setters de React se pasan a props tipadas `boolean | ((prev: boolean) => boolean)`.
5. `pageAdvance` es una **función** `(boxW, gap) => number`, no un número.
6. `extractWordAtPoint` recibe `(clientX, clientY, root, language?)`, no un evento.
7. `DeepReadingState`, `CompanionState`, `SceneReturnRecap`, `PageLayout`, `WordHit` tienen cada
   uno su módulo; no los inventes.
8. Los helpers de formato (`formatRemainingTime`, `formatElapsedMinutes`) viven en
   `lib/deep-reading`, no en `lib/export`.

## 6. Prompt listo para pegar en la sesión nueva

```
/lecta-plan-produccion

Continúo la FASE 7 (partir Reader.tsx) donde la dejó la sesión anterior. Antes de tocar nada,
lee docs/fase-7-handoff.md y docs/plan-8-fases.md §10. Estado: Reader.tsx en 4 623 líneas, seis
extracciones hechas, gate y e2e verdes, árbol limpio en el commit 08258c1.

Tarea de esta sesión: extraer el bloque del dock (SmartReaderDock y su cableado de modos).

Método obligatorio (está en el handoff, no improvises otro):
1. Localiza el bloque con grep; apunta inicio y fin exactos.
2. Calcula las props con `node scripts/find-free-vars.mjs src/client/components/Reader.tsx <ini> <fin>`.
3. Los nombres que ya son imports de Reader.tsx se importan dentro del componente nuevo y NO
   viajan como props.
4. Ref como prop ⇒ sufijo `Ref` (regla del compilador de React).
5. Copia el JSX tal cual, dedentado, en src/client/components/reader/ReaderDockHost.tsx con un
   comentario que diga de dónde salió.
6. Sustituye el rango por <ReaderDockHost ...props /> y borra los imports que queden sin uso.
7. Verifica: pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e, y luego pnpm gate.
8. Un commit. Si el e2e falla, revierte ESA extracción y explica por qué; no toques las pruebas.

Prohibido: cambiar comportamiento, renombrar props del lector, tocar src/client/styles/reader.css,
subir el tope de 28 warnings, hacer commit de más de una extracción, o desplegar.

Entrega: líneas antes/después, props de la interfaz, salida real de gate y e2e, y qué queda para
llegar a 3 500 (que ya sabes que exige mover lógica a hooks).
```

## 7. Despliegue

Producción está en la Fase 8 (`7518d096`), **sin los refactors de la Fase 7**. Son cambios sin
comportamiento observable y con e2e verde; se pueden subir cuando se cierre la fase o antes, si
se quiere reducir la distancia entre `main` y producción. No hay migraciones ni secretos nuevos.
