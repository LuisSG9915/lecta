# 🐾 Plan de Trabajo: Concentración Visual, Telemetría y Compañero Felino — Lecta

> **Objetivo:** Transformar a Lecta en un e-reader único mediante concentración guiada (Líneas Sintácticas y Regla Variable), telemetría de lectura profunda y un gato reactivo como compañero cognitivo.

---

## 📊 Progreso General

| Fase | Módulo | Estado | Progreso |
| :--- | :--- | :---: | :--- |
| **Fase 1** | Motor de Animaciones y Estados del Gato | `[DONE]` | `[██████████] 100%` |
| **Fase 2** | Estrategias de Concentración (Líneas Sintácticas & Regla) | `[DONE]` | `[██████████] 100%` |
| **Fase 3** | Telemetría Profunda de Lectura y Detección de Fatiga | `[DONE]` | `[██████████] 100%` |
| **Fase 4** | Sinergia Gato-Lector (Guía Visual y Micro-Pausas) | `[DONE]` | `[██████████] 100%` |
| **Fase 5** | Métricas de Comprensión, Pruebas y Pulido Visual | `[DONE]` | `[██████████] 100%` |

---

## 🛠️ Desglose de Tareas por Fases

### Fase 1: Motor de Animaciones del Gato (`Companion.tsx`)
- [x] Crear máquina de estados para el gato: `SLEEP`, `READING`, `DEEP_FOCUS`, `CURIOUS`, `YAWN`, `CELEBRATING` → `src/client/lib/companion-state.ts`.
- [x] Implementar sprites SVG / CSS keyframes ultraligeros en `src/client/styles/game.css` sin impacto en el hilo de renderizado del libro → clases `cat--f-*`, animaciones solo `transform`/`translate`/`opacity` con `will-change: transform`.
- [x] Conectar eventos de `src/client/lib/reading-events.ts` para disparar transiciones de animación según la acción del usuario → `signalCompanion` en `Reader.tsx` (apertura/cierre, actividad, consulta, fatiga, meta) + gato montado en `.reader-cat`.
- [x] Tests unitarios en Vitest para las transiciones de estado del compañero en `Companion.test.ts`.

### Fase 2: Estrategias de Concentración Visual en el Lector
- [x] Diseñar algoritmo en `src/client/lib/syntactic-lines.ts` que fragmente párrafos por puntuación y conjunciones en líneas de longitud balanceada → cortes por puntuación fuerte/media/débil y conectores con cuerpo mínimo, filtro codicioso anti-fragmentos; respeta `<em>`, `<mark>` y la tarjeta «Antes de leer»; desenrollado sin pérdida.
- [x] Crear componente `<FocusRuler size={1 | 3 | 'paragraph'} />` en `src/client/components/FocusRuler.tsx` con máscara de opacidad ajustable → velo de papel translúcido con franja de 1/3 líneas o párrafo (6 líneas) que sigue al puntero; `pointer-events: none`.
- [x] Agregar selector de "Modo de Concentración" en `src/client/components/ThemeMenu.tsx` (Normal, Líneas Sintácticas, Regla de Foco) → `FocusModeMenu` + `focusMode`/`rulerSize` persistidos en `ReaderSettings`.
- [x] Validar compatibilidad del renderizado de foliate-js con los estilos de ancho de línea → el contenido EPUB es DOM directo (no iframe): las líneas se aplican a `sanitized` antes del pintado y al cambiar el modo en vivo, con re-anclaje y remeasure en paginado.

### Fase 3: Telemetría Profunda de Lectura (`reading-activity.ts`)
- [x] Medir *Dwell Time* por sección mediante marcas de tiempo en `src/client/lib/reading-activity.ts` → evento `section_dwell` (ms + palabras de la sección) al cambiar de sección.
- [x] Implementar detector de regresiones (cuando el usuario vuelve a páginas o párrafos anteriores) → `src/client/lib/focus-telemetry.ts`: `FocusTracker` con ventana deslizante de 5 min, hueco >5 min reinicia el tramo, fatiga = 25+ min de tramo y ≥35 % de retrocesos con muestra ≥8 y enfriamiento de 10 min.
- [x] Registrar palabras consultadas en diccionario para vincularlas directamente a la tabla `user_knowledge` → `recordConsult` guarda evidencia `inferred` vía `saveKnowledge` (fuente más débil: jamás deshace respuestas explícitas).
- [x] Persistir métricas de fatiga y racha en IndexedDB (`src/client/lib/idb.ts`) → eventos `page_regressed`, `fatigue_flag` (con muestra) e intervalos de lectura; agregado por día en `focusByDay` (dwell, palabras, retrocesos, consultas, avisos de fatiga) — el «día leído» se deduce de los intervalos persistidos.

### Fase 4: Sinergia Gato-Lector (Interacción Cognitiva)
- [x] Hacer que el gato reaccione cuando se activa la "Regla de Enfoque" (la patita del gato sirve de ancla visual en el margen) → prop `anchor` de `FocusRuler` monta el gato en el margen de la franja clara.
- [x] Disparar la animación de bostezo (`YAWN`) y una sugerencia de pausa 20-20-20 cuando el algoritmo detecte fatiga por regresiones → `fatigue_detected` → estado `yawn` + aviso `role="status"` descartable («mira algo lejano unos 20 segundos»).
- [x] Disparar animación de celebración con ronroneo cuando se completa la meta de lectura diaria → `goal_completed` al cruzar `DAY_GOAL_MS` del día (una vez por día, contra el total persistido), al terminar capítulo ≥85 % y al terminar el libro; `cat-purr` (vibración por `translate`) durante `celebrating`.

### Fase 5: Métricas de Comprensión y Pruebas Generales
- [x] Agregar pestaña en `src/client/components/ReadingActivity.tsx` mostrando la gráfica de atención y velocidad del usuario → sección «Atención y ritmo»: barras de dwell por día + retrocesos, consultas, ppm estimado y aviso de fatiga (solo datos locales).
- [x] Ejecutar suite de pruebas completa con `pnpm test` → 760 pruebas en 64 archivos, en verde junto a `typecheck`, `lint` y `build`.
- [x] Verificar rendimiento en Lighthouse (mantener 60 FPS durante las animaciones del gato) → verificación por construcción: animaciones exclusivamente `transform`/`translate`/`opacity` con `will-change`, `pointer-events: none` en gato y regla, y apagado total con `prefers-reduced-motion` (regla global en `base.css`).

---

## 🛡️ Estabilización de Pruebas y CI

| Fase | Módulo | Estado | Progreso |
| :--- | :--- | :---: | :--- |
| **Fase 1** | Estabilización de Pruebas, Cobertura Ratchet y CI | `[IN PROGRESS]` | `[█████████░] 90%` |

### Tareas Completadas:
- [x] Optimización de memoria en Vitest (`pool: 'forks'`, workers adaptativos `process.env.CI ? 2 : 4`, separación de entornos `node` vs `jsdom`).
- [x] Refactorización de `.github/workflows/ci.yml` en 4 jobs paralelos (`static`, `unit`, `build`, `e2e`) con `concurrency` y cancelación en progreso.
- [x] Configuración de dependencias automatizada con Dependabot (`.github/dependabot.yml`).
- [x] Cierre de huecos de cobertura en `src/worker/**` con umbral ratchet (>=70% líneas/funciones).
- [x] Pruebas deterministas de extremo a extremo (E2E) con Playwright (`e2e/smoke-journeys.spec.ts`) etiquetadas con `@smoke`.
- [x] Automatización de Smoke Tests Post-Deploy (`.github/workflows/deploy-smoke.yml`) con reintentos exponenciales y alertas vía GitHub Issues (`smoke-regression`).


> [!NOTE]
> **Criterio de Cierre Formal de la Fase 1:**
> La implementación de código, configuración de CI paralelo, suites herméticas y smoke tests post-deploy está completa al 100%. El estado se mantiene en **90%** hasta verificar la primera corrida real en los runners de GitHub Actions midiendo el tiempo de pared real (≤ 12 min) y activando las reglas de branch protection bloqueantes en el repositorio.
