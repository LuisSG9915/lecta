# Track 7: Kindle & E-Ink Adaptive Pre-Chapter Vocabulary Priming & Zero-Scroll Pure Paging

## Objective
Extend the scientific pre-chapter vocabulary priming space and zero-scroll pure paging to the Kindle / E-Ink web reader (`src/worker/kindle/`) in 4 clean phases, respecting E-Ink hardware constraints (zero CSS animations/transitions, high-contrast monochrome, 44px+ tap targets, progressive enhancement with HTML forms) and `.agents/rules/lecta-zero-friction.md`.

## Phase Breakdown for gemini-3.8-flash

### Phase 1: Erradicación de Ruido al Pie y Filtro Zipf en Antesala (`views.ts`, `routes.ts`, `epub-reader.ts`)
- **Eliminación de `.cat-notes-box` en lectura regular**: `gloss = false` por defecto en `renderReaderView`, retirando la inyección del bloque de notas al pie y deprecando/eliminando reglas CSS de `.cat-notes-box` (~350-450 px verticales).
- **Desactivación de extracción léxica por página**: En `GET /k/read/:hash`, se desactiva `extractPageWords` y el bucle de consultas de notas al pie en páginas regulares, ahorrando CPU y consultas de red.
- **Endurecimiento del selector de Antesala con filtro Zipf**:
  - Compuerta de frecuencia léxica usando `public/lexicon/lemmas-freq-es.tsv.gz`.
  - Descarte estricto de cualquier lema o forma con $\text{Zipf} \ge 4.0$ (palabras cotidianas como *casa*, *hombre*, *puerta*, *dijo*, *noche*).
  - Priorización de candidatos en la Zona de Desarrollo Próximo (Rasch 1PL) con $\text{Zipf} < 4.0$, seleccionando de 3 a 5 palabras clave.
  - **Salto sin fricción**: Si se obtienen 0 palabras candidatas, se renderiza directamente el contenido del capítulo sin mostrar antesalas vacías.

### Phase 2: Paginación Estricta 1-Pantalla (Zero-Scroll) (`epub-reader.ts`, `routes.ts`, `views.ts`)
- **Presupuesto dinámico de caracteres en `paginateChapter`**:
  - `sm`: 620 caracteres (520 en `page === 0` por presencia de `.chapter-heading`).
  - `md` (default): 480 caracteres (390 en `page === 0`).
  - `lg`: 360 caracteres (280 en `page === 0`).
  - `xl`: 260 caracteres (190 en `page === 0`).
  - **Penalización por saltos de párrafo**: Descuento de 45 caracteres equivalentes por cada cierre de bloque (`</p>`, `</blockquote>`, `</li>`).
- **Layout CSS paged vs scroll**:
  - Modo `paged` (default): `.reader-container` con `height: 100vh; max-height: 100vh; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; padding: 8px 14px;`.
  - Cabecera `.reader-header` compacta y barra de modo colapsable ($\le 36\text{ px}$).
  - Franja inferior `.turn-page-bar` de una sola línea ($\le 36\text{ px}$).
  - Modo `scroll`: `overflow-y: auto; height: auto;` con presupuesto amplio de 1200 caracteres para lectura continua opcional.

### Phase 3: Interacción Léxica por Long-Press y Modo Consulta (`epub-reader.ts`, `views.ts`)
- **Reemplazo de etiquetas `<a>` por `<span class="w" data-w="...">` inertes**:
  - `wrapWordsWithLinks` genera `<span class="w" data-w="...">` en vez de enlaces `<a>`, suprimiendo navegaciones accidentales y popups no deseados en el navegador experimental de Kindle.
  - Estilos CSS sin decoración de hipervínculo en estado inactivo.
- **Script cliente ultraligero ES5 (< 1.2 kB)**:
  - Detección de pulsación larga (450 ms) sobre `.w` para consultar definición.
  - Cancelación de temporizador si ocurre `touchmove` (> 10 px) o `touchend` prematuro.
  - Fallback por selección nativa (`window.getSelection()`) tras `touchend`.
  - Interruptor `[ 🔍 Consultar ]` en la barra superior para alternar modo consulta directa con 1-toque.

### Phase 4: Zonas Táctiles (Tap Zones), Ergonomía y Gobernanza (`views.ts`, tests y reglas)
- **Zonas Táctiles (Tap Zones)** en `.epub-content`:
  - Toque en el 25% izquierdo: navegar a página anterior.
  - Toque en el 75% derecho/central: navegar a página siguiente.
  - No intercepta cuando el modo consulta está activo o cuando hay selección activa.
- **Barra inferior compacta `.turn-page-bar`**:
  - Una sola línea ($\le 36\text{ px}$): `[ ← Ant. ] Pág. X de Y · Cap. Z [ Sig. → ]`.
- **Regla Inquebrantable**:
  - Regla 7 en `.agents/rules/lecta-zero-friction.md` blindando la experiencia Zero-Scroll y Paging puro.
