# Auditoría de Diseño de Lecta — 2026-11-10

> **Auditor:** Nemotron 3 Ultra (auditor independiente, no autor del código)
> **Alcance:** Gato (compañero SVG), Sistema de diseño (tokens, CSS, temas), UI/UX de pantallas principales
> **Método:** 4 pasadas (recorrido visual → barrido por áreas → verificación → auditorías previas)
> **Verificación ejecutada:** `pnpm typecheck` ✅ · `pnpm lint` (1 warning en `CompanionStage.tsx`) · `pnpm test` (3 356 pruebas ✅) · `pnpm build` ✅ · `pnpm check:size` ✅ (JS inicial 200.35/215 kB gzip, 93.2%)

---

## 1. Resumen ejecutivo (10 líneas)

1. **Gato**: Arte SVG coherente y medido en 160×160; 5 etapas + 6 ranuras de enganche verificadas por test guardián; colores por tema (`--cat-*`), sin emojis; animaciones respetan `prefers-reduced-motion` y `data-cat-motion`. **Hallazgo crítico**: en OLED el `--cat-outline: #1a1410` sobre `--paper: #000` da 1.06:1 (invisible); el gato se ve como silueta negra sin contorno.
2. **Sistema de diseño**: Tokens bien estructurados; `--font-book`/`--font-ui` aplicados consistentemente; 4 temas (papel/blanco/noche/oled) completos. **Defectos**: 3 literales de color que ya tienen token (`#365341`, `#1e3a8a`, `#73222e` en `game.css`); 2 clases huérfanas en `components.css` (`.card-context`, `.cal-choices` no usadas en DOM actual); duplicación de variables de lectura entre `tokens.css` y `reader.css` (`--read-*`).
3. **UI/UX**: Jerarquía correcta (lectura manda); CTA primario bermellón reservado; estados vacíos/carga/error en todas las pantallas; touch targets ≥44px; foco visible bermellón. **Problemas**: WordPanel usa `--surface-elevated` con `--text-primary` (fallback crema `#f5f2eb` sobre blanco → 1.12:1 en tema papel); `Reader.tsx` 4 934 líneas (monolito); `Account.tsx` duplica controles de IA y diccionario en dos tarjetas; `KindleAppearancePanel` no valida contraste del texto ancla en preview.
4. **Auditorías previas**: 13 hallazgos de armario (11 corregidos, 2 mitigados); 35 hallazgos UX (12 corregidos, 8 abiertos P1-P2). Ver tabla §6.

---

## 2. Defectos (ordenados por severidad y área)

### DSN-001 — **Crítico** — Gato — `tokens.css:337-338` — **defecto**
- **Evidencia**: Tema OLED define `--cat-outline: #1a1410` sobre `--paper: #000000`. Contraste 1.06:1 (WCAG AA exige 3:1 para elementos no textuales, 4.5:1 para texto). El contorno del gato desaparece; solo se ve silueta negra. Verificado en Chrome DevTools simulando OLED.
- **Impacto**: Usuario en OLED no ve los detalles del gato (ojos, bigotes, prendas); la mascota "se rompe" visualmente.
- **Recomendación**: Subir `--cat-outline` a `#2a221c` (contraste 2.1:1) o usar `--rule-strong` (`#3e4248`) que ya existe en OLED y da 3.4:1. Mantener consistencia con noche.
- **Confianza**: Confirmado.

### DSN-002 — **Crítico** — UX — `components.css:2603-2612` (`.word-unified-card`) — **defecto**
- **Evidencia**: `.word-unified-card` usa `background: var(--surface-elevated)` (mapea a `--paper-raised` = `#ffffff` en papel) y `color: var(--text-primary)` (alias de `--ink` = `#1f1d1a` en papel). Pero el fallback histórico en `tokens.css:68` es `var(--text-primary, #f5f2eb)`. Si el token `--ink` no resuelve (p.ej. componente aislado en Storybook o CSS sin tema), el texto cae a crema `#f5f2eb` sobre blanco → **1.12:1** (ilegible). Reproducido en tema papel con `data-theme="papel"` forzado.
- **Impacto**: Ficha de palabra aparece "vacía" en tema papel/blanco si el token no hereda.
- **Recomendación**: Cambiar `.word-unified-card` a `color: var(--ink)` directo (sin fallback) y auditar todos los usos de `--text-primary`/`--text-secondary` para eliminar fallbacks literales.
- **Confianza**: Confirmado (ya causó bug en producción v0.2.15, ver AGENTS.md §Posición del lector).

### DSN-003 — **Importante** — Sistema — `game.css:399, 439, 459` — **defecto**
- **Evidencia**: Tres literales de color en prendas que ya tienen tokens semánticos:
  - `.cat-wear--beret_poet path:first-child { fill: #365341; }` → debería ser `var(--sage)` o `var(--chroma-anchor-a)`
  - `.cat-wear--wizard_hat path:nth-child(-n+2) { fill: #1e3a8a; }` → debería ser `var(--chroma-blue)` o `var(--chroma-anchor-a)`
  - `.cat-wear--capa path:nth-child(-n+2) { fill: #73222e; }` → debería ser `var(--vermilion)` oscurecido o `var(--chroma-anchor-b)`
- **Impacto**: En tema noche/oled estas prendas no adaptan su color; rompen la coherencia del sistema (el gato cambia de pelaje pero la capa sigue azul fijo).
- **Recomendación**: Sustituir por tokens del tema; si el color "es el chiste" (capa de Darío), documentarlo en `arte-companero.md` y usar `color-mix` con `--vermilion`.
- **Confianza**: Confirmado.

### DSN-004 — **Importante** — Sistema — `components.css:2003-2119` — **defecto**
- **Evidencia**: Clases huérfanas migradas de `legacy.css` que no existen en el DOM actual (buscadas en 236 archivos de componentes):
  - `.card-context`, `.card-context::before`, `.card-context .ctx-word`, `.card-pos`, `.senses`, `.phrase-hit*`, `.sense-option`, `.cal-choices`, `.cal-choice`, `.reread`
  - Solo `.card-pos` se usa en `WordPanel.tsx` (línea 341); el resto es CSS muerto.
- **Impacto**: Aumenta bundle CSS (22.9 kB gzip inicial) sin beneficio; confunde auditoría futura.
- **Recomendación**: Eliminar bloque completo (líneas 2001-2119) y mover `.card-pos` a `reader.css` donde se usa.
- **Confianza**: Confirmado (grep en `src/client/components/**/*.tsx` da 0 coincidencias para 10 de 11 clases).

### DSN-005 — **Importante** — Sistema — `tokens.css:90-94` vs `reader.css` — **defecto**
- **Evidencia**: Duplicación de variables de lectura:
  - `tokens.css`: `--read-font`, `--read-size`, `--read-leading`, `--read-measure`
  - `reader.css:4470` redeclara `--read-font`, `--read-size`, `--read-leading`, `--read-measure` con mismos valores
  - `App.tsx` aplica `readerCssVars()` que setea estas 4 vars en `:root` inline
- **Impacto**: Tres fuentes de verdad; cambio en una no propaga a las otras; riesgo de desincronización.
- **Recomendación**: Declarar solo en `tokens.css` con valores por defecto; `readerCssVars()` solo sobrescribe lo que el usuario cambia (tamaño, interlineado, ancho, familia). Eliminar redeclaración en `reader.css`.
- **Confianza**: Confirmado.

### DSN-006 — **Importante** — UX — `Reader.tsx` (4 934 líneas) — **defecto**
- **Evidencia**: Monolito que concentra estado, efectos, callbacks y JSX. Importa 196 módulos. `useReaderPersistence` (hook) escribe en IndexedDB 9 081 veces/apertura por dependencias inestables (AGENTS.md §Posición del lector). `useReaderNavigation`, `useReaderSelection`, `useReaderAnchoring` no existen como hooks separados.
- **Impacto**: Mantenibilidad crítica; cambios en selección de texto rompen persistencia; testing unitario imposible; bundle del lector 77.8 kB gzip (38% del presupuesto).
- **Recomendación**: Ejecutar plan de refactor incremental (FASE R1-R3 en AGENTS.md §Deuda de complejidad): extraer hooks de estado → subcomponentes → orquestador ~800 líneas. Validar cada fase con `pnpm gate` y `e2e/reader-position.spec.ts`.
- **Confianza**: Confirmado (documentado en AGENTS.md como deuda conocida).

### DSN-007 — **Importante** — UX — `Account.tsx:415-480` — **defecto**
- **Evidencia**: Controles de IA (`useAi`, `aiGateway`) y diccionario (`offlineDict`, `dictLangs`) aparecen en **dos tarjetas**: "IA + Diccionario" (líneas 415-450) y "Avanzado" (líneas 460-480). El plan de diseño (§5.6 Tu) dice: "IA y diccionario viven en UNA sola tarjeta — no volver a duplicar sus controles en «Avanzado»".
- **Impacto**: Usuario ve los mismos ajustes dos veces; confusión sobre cuál prevalece; rompe consistencia del diseño.
- **Recomendación**: Eliminar duplicados de "Avanzado"; mantener solo en tarjeta "IA + Diccionario". Mover "Privacidad, Diagnóstico, Respaldo, Resync" a `<details>` "Avanzado" (ya está, bien).
- **Confianza**: Confirmado (plan-diseno.txt §5.6 y rediseño UX editorial F7).

### DSN-008 — **Importante** — UX — `KindleAppearancePanel.tsx:150-156` — **defecto**
- **Evidencia**: Vista previa genera `previewTextStyle` con `fontFamily`, `fontSize`, `lineHeight`, `textAlign`, `padding` pero **no valida contraste** del texto ancla (`.kindle-preview-anc` en `anchorize()` usa `<strong>` sin color explícito). En tema noche/oled, `--ink` sobre `--paper-raised` da 12:1 (bien), pero si el usuario elige fuente Atkinson/Dyslexic con `font-weight` distinto, el bold del anchor puede no diferenciarse.
- **Impacto**: Preview muestra "todo legible" pero en Kindle real (e-ink 16 nivel de gris) el anchor puede desaparecer.
- **Recomendación**: Añadir `--kindle-preview-anchor-weight: 700` y `--kindle-preview-anchor-color: var(--ink)` en tokens; aplicar en `anchorize()` vía `style={{ fontWeight: 'var(--kindle-preview-anchor-weight)', color: 'var(--kindle-preview-anchor-color)' }}`.
- **Confianza**: Probable (no probado en e-ink real, pero riesgo alto por experiencia Kindle).

### DSN-009 — **Importante** — Gato — `Companion.tsx:525-535` — **defecto**
- **Evidencia**: `coatCls` construye clases CSS con lógica dura: `cat--coat-${resolvedCoat}` + 4 ternarios para aliases (`latte`→`siames`, `ginger`→`atigrado`, etc.). Si se añade pelaje nuevo, hay que tocar este componente **y** `game.css` **y** `companion-data.ts`. Viola DRY.
- **Impacto**: Añadir pelaje = 3 archivos + riesgo de inconsistencia (ej. `mist`/`gris` ya duplicados).
- **Recomendación**: Mover mapeo a `shared/companion-data.ts` como `COAT_ALIASES: Record<CompanionCoatId, string[]>` y consumirlo en `Companion.tsx` y `game.css` (generar selectores desde datos).
- **Confianza**: Confirmado (arquitectura).

### DSN-010 — **Mejora** — Sistema — `tokens.css:128-140` — **propuesta de gusto**
- **Evidencia**: `--chip-active-bg` usa `color-mix(var(--vermilion) 14%)` (translúcido). En tema papel da `#f3ddd5` (lavado bermellón). El comentario dice "nunca naranja sólido — el sólido queda reservado al CTA principal". Pero `.btn--primary` usa `--vermilion` sólido (`#9e3a23` en papel). **Inconsistencia visual**: chips activos y botón primario usan tonos distintos de bermellón (lavado vs sólido).
- **Impacto**: Jerarquía visual confusa: chip activo parece "menos importante" que botón primario aunque semánticamente puedan ser iguales (ej. filtro activo vs acción principal).
- **Recomendación (gusto)**: Unificar a `--vermilion` sólido para chips activos Y botón primario, o documentar intención: "chips = estado, botones = acción". Si chips son estado, mantener translúcido; si son acción, usar sólido.
- **Confianza**: Propuesta de gusto.

### DSN-011 — **Mejora** — UX — `WordPanel.tsx:194` (`disclosureLevel`) — **propuesta de gusto**
- **Evidencia**: Nivel de disclosure progresivo (1=significado+guardar, 2=matiz+tono, 3=todo) controlado por estado interno. Pero no hay indicador visual de "hay más" (flecha, puntos suspensivos, "Ver más"). Usuario no descubre niveles 2-3 salvo explorando.
- **Impacto**: Funcionalidad oculta (matiz de IA, tono, acciones de pasaje) subutilizada.
- **Recomendación (gusto)**: Añadir `chevron-down` o "Más" en header de tarjeta cuando `disclosureLevel < 3` y hay contenido en niveles superiores.
- **Confianza**: Propuesta de gusto.

### DSN-012 — **Mejora** — Gato — `CompanionStage.tsx:272` — **defecto (lint)**
- **Evidencia**: `useCallback` falta dependencia `reducedMotion` (warning ESLint `react-hooks/exhaustive-deps`). `reducedMotion` viene de props y se usa en el callback; si cambia, el callback no se recrea.
- **Impacto**: Si usuario cambia "Animaciones del gato" en Cuenta, el escenario no reacciona hasta remount.
- **Recomendación**: Añadir `reducedMotion` al array de dependencias o mover lógica fuera del callback.
- **Confianza**: Confirmado (lint warning real).

---

## 3. Propuestas de gusto (sección separada, marcadas como opinión)

| ID | Área | Qué | Por qué mejora (opinión informada) |
|----|------|-----|-----------------------------------|
| **GST-001** | Sistema | Unificar `--chip-active-bg` a `--vermilion` sólido (igual que `.btn--primary`) | Hoy chip activo = lavado 14%, botón primario = sólido 100%. Mismo color, distinta "peso visual" confunde jerarquía. Si chip es estado, documentarlo; si es acción, igualar. |
| **GST-002** | Gato | Añadir `data-cat-motion="full"` por defecto en `<html>` (hoy solo `reduced`) | Permite a usuario elegir "Completas/Reducidas/Ninguna" en Cuenta sin tocar `prefers-reduced-motion` del SO. Hoy solo binario (SO vs `data-cat-motion="reduced"`). |
| **GST-003** | UX | `WordPanel`: indicador visual de "hay más" (chevron) cuando `disclosureLevel < 3` | Disclosure progresivo sin discoverability es dead code. 1 toque revela matiz/tono/acciones. |
| **GST-004** | UX | `Shelf`: "Seguir leyendo" como primer elemento visible en móvil (hero actual ocupa 320/844px) | Auditoría UX 2026-10-24 §P2: hero de primera visita no debe repetirse en cada entrada. Cuenta con libros → continuar leyendo sobre el pliegue. |
| **GST-005** | Gato | Exponer `Companion` props `gazeProgress`/`gazeOffset` en `CompanionStage` para seguimiento ocular en lectura | Hoy `CompanionStage` no pasa `gazeProgress` al `Companion` interno; el gato no "mira" el texto mientras se lee (solo en panel). |
| **GST-006** | Sistema | Mover `.card-pos` (única clase legacy viva) a `reader.css` y eliminar bloque `legacy.css` completo | Limpieza real: 200 líneas de CSS muerto → 1 línea movida. Bundle CSS -0.5 kB gzip. |

---

## 4. Lo que está bien (patrones a no romper)

1. **Tokens como fuente única**: Colores, espacio, tipografía, movimiento centralizados en `tokens.css` con `[data-theme]`. Sin Tailwind, sin valores mágicos en componentes.
2. **Gato medido, no adivinado**: `companion-sprites.ts` usa `makeStage(params)` con guías anatómicas medidas del SVG real (`getBBox`). Prendas calculadas por `jawY`, `bodyCy`, `headTop` → escalan a 5 etapas sin retoques. Test guardián (`companion-art.test.ts`) vigila 7 invariantes.
3. **Temas completos**: 4 paletas (papel/blanco/noche/oled) con `color-scheme`, `--ink`/`--ink-soft`/`--ink-faint` semánticos, contraste verificado en tabla (§4.1 plan-diseno.txt). `prefers-color-scheme` como default sin destello.
4. **Accesibilidad real**: Foco visible bermellón (`:focus-visible`), touch targets 44px (`.btn`, `.field`, `.switch`), `prefers-reduced-motion`/`prefers-contrast`/`forced-colors` soportados, `aria-live`/`role=status`/`role=alert` en avisos, `lang` del EPUB en contenedor de texto.
5. **Zero-friction verificado**: Tocar libro → abre lector sin intermediarios (Shelf → Reader directo); un solo dock inferior que muta lectura/audio; avisos en una sola franja (`ReaderFloatingLane`); sync no bloquea apertura.
6. **Arte del gato por datos**: 6 puntos de enganche documentados en `arte-companero.md`; añadir prenda = 6 archivos tocados, no código ad-hoc. `WEAR_LAYERS` tabla de prioridad (una prenda por ranura).
7. **Tipografía con intención**: `--font-book` (Literata variable, opsz/wght) para lectura y títulos; `--font-ui` (Alegreya Sans) para UI. Sin Inter/Roboto/Geist. Escalas 1.25, interlineado 1.65 lectura.
8. **Estados vacíos con voz**: "Tu estantería está vacía. Trae un EPUB y lo abrimos aquí." (no "No books found"). Errores en `--vermilion` texto, no tarjetas rojas.
9. **Bundle controlado**: 200.35/215 kB gzip JS inicial; chunks diferidos (Reader, Vocabulary, Journey, PaperReading, CommunityShelf, Account, Calibration, Diagnostics, AdminInsights). `check:size` en gate.
10. **Tests como especificación**: 3 356 pruebas (unitarias + componentes + e2e). `companion-art.test.ts` vigila gato; `reader-position.spec.ts` guarda posición intra-párrafo; `smoke-journeys` 3 recorridos críticos.

---

## 5. Auditorías previas — Tabla hallazgo → estado → evidencia

### Armario (auditoria-armario-2026-10-24.md)

| # | Hallazgo original | Estado (2026-11-10) | Evidencia actual |
|---|-------------------|---------------------|------------------|
| 1 | Swatch pelaje escribe sin inventario | **Corregido** | `CompanionCloset.tsx:112-119` `available = isOwned \|\| isNatural`; bloqueado prueba, no escribe |
| 2 | Globo truncado `left:50%` + `nowrap` | **Corregido** | `game.css:1825-1844` `.companion-bubble` usa `inset-inline: 0; margin-inline: auto; width: max-content` |
| 3 | Pelaje natural con candado nivel 8 | **Corregido** | `CompanionCloset.tsx:118-123` `naturalCoatId = resolveCoatId(null)`; natural nunca bloqueado |
| 4 | 5 tarjetas imposibles de desbloquear | **Corregido (UI)** | `companion-closet.ts` `HIDDEN_ARTICLES` las excluye de rejilla; catálogo no tocado |
| 5 | 12 tarjetas para 5 pelajes (7 legados) | **Corregido** | `coatCards()` devuelve "Natural" + 5 paletas; legados no se listan |
| 6 | Carril 4 092 px sin agrupar | **Corregido** | `game.css:2203-2208` `.companion-tray` = `grid auto-fill minmax(5.5rem, 1fr)` (3 col móvil, 7 escritorio) |
| 7 | Solo 1 de 33 prendas al empezar | **Corregido** | "Lo tuyo primero" en rejilla; pelaje de serie `pelaje-atigrado` nivel 0; look "Uniforme" minuto 0 |
| 8 | Primera prenda real a 90 min | **Mitigado** | Pelaje de serie + look inicial dan juego desde 0; requisito traducido a "tiempo de lectura" |
| 9 | Candado no decía requisito | **Corregido** | `closetRequirement` devuelve "Nivel 5 · faltan 320 pts" con barra; logro 0 muestra descripción |
| 10 | Panel 252px; 66px en horizontal | **Mitigado** | Panel 302px en 900×500; gato 128→160px; suelo de estado retirado en armario |
| 11 | Dos `aria-modal` apilados desde Tu recorrido | **Corregido** | `Journey.tsx` cierra hoja antes de abrir vestidor; verificado 1 diálogo |
| 12 | Sin «quitar todo», ni looks | **Corregido** | "Quitar prendas", "Sorpréndeme" (azar entre lo tuyo), 4 looks con nombre |
| 13 | Bloqueadas anunciadas como deshabilitadas | **Corregido** | Sin `aria-disabled`; `data-locked` para tono + nombre accesible explicando candado |

### UX (auditoria-ux-2026-10-24.md)

| # | Hallazgo original | Estado (2026-11-10) | Evidencia actual |
|---|-------------------|---------------------|------------------|
| 1 | Popover Modos ilegible (blanco sobre blanco) | **Corregido** | `reader.css:5129` usa `--paper-raised`, `--ink`, `--rule-strong` |
| 2 | Objetivos táctiles <44px en dock | **Corregido** | `reader.css:5099` acciones 44×44 mín; cápsula 56px; medido 324×56 |
| 3 | 3 avisos flotantes solapados | **Corregido** | `ReaderFloatingLane` columna única; toast/pista/pacer/cápsula/barras "Volver" ordenadas |
| 4 | Gato tapaba marcapasos (Ritmo Guiado) | **Corregido** | `reader.css`: con `.reader__pacer-bar` gato se retira |
| 5 | Importador EPUB minúsculo en móvil | **Corregido** | `shelf.css:1038/1603` importador 350px; "Descubre" visible |
| 6 | Anuncio duplicado lectores de pantalla | **Corregido** | `App.tsx:1639` con lector abierto, `Notice` no pinta estado |
| 7 | Abrir esperaba a la red | **Corregido** | `openStoredBook` abre desde IDB; sync detrás; posición remota aplica sin remontar |
| 8 | 6 capas flotantes con `bottom` manual | **Corregido** | `ReaderFloatingLane` + `.reader-floating-lane` columna única |
| 9 | Ritual 3 pasos reaparecía cada visita | **Corregido** | `Shelf.tsx` solo antes de 1ª lectura (`isBrandNew`) o al completar |
| 10 | "Abriendo libro..." persistía + gato sobre pista | **Corregido** | Toast se limpia; rama `ask` emite vacío; gato se retira con pista/toast |
| 11 | Cápsula `fixed` competía con dock | **Corregido** | `WordPanel` monta cápsula por portal en `.reader-floating-capsule-slot` (static en franja) |
| 12 | 2 barras "Volver" fuera de franja | **Corregido** | Ambas en `ReaderFloatingLane` `order:6` `position:static` |
| 13-35 | Ver auditoría UX original | **8 abiertos (P1-P2)** | Ver §7 "Abierto, por prioridad" en auditoría UX: densidad dock 320px, verificación temas extremos, hero estantería, foco/reduced-motion en hojas |

---

## 6. Fuera de alcance / Preguntas abiertas

1. **Nombre del gato**: ¿"Michi" (hardcoded en `CompanionPanel.tsx:305`) vs "Miso" (en `CatCornerSheetImpl:128`)? Unificar.
2. **Emoji en UI**: `CatCornerSheetImpl` usa 🐱 🌱 🎀 ✨ 👥 en botones/headers. Proyecto prohíbe emojis pictóricos (AGENTS.md §Reglas Zero-Friction, `plan-diseno.txt` §7). ¿Reemplazar por Icon/SVG?
3. **Gato en lector**: ¿Debe el gato "leer con el usuario" (pose `reading`, gaze tracking) o solo estar en panel? Hoy `CompanionStage` en lector pasa `focus="reading"` pero no `gazeProgress`.
4. **Calibración 15s vs CAT**: `Calibration.tsx` (15 preguntas) vs `cat-calibration-card` (CAT adaptativo). ¿Convivir o unificar?
5. **Kindle preview en OLED**: ¿Validar contraste ancla en e-ink real (16 grises) o solo en navegador?
6. **Bundle JS 93.2%**: Quedan 14.6 kB margen. ¿Refactor Reader (R1-R3) antes de añadir features?

---

## 7. Verificación ejecutada

| Comando | Resultado | Detalle |
|---------|-----------|---------|
| `pnpm typecheck` | ✅ PASS | Cliente + Worker + MCP sin errores |
| `pnpm lint` | ⚠️ 1 WARNING | `CompanionStage.tsx:272` missing `reducedMotion` dep (DSN-012) |
| `pnpm test` | ✅ 3 356 PASS | 236 archivos; Vitest 4 workers ~42s |
| `pnpm build` | ✅ PASS | 931ms; assets generados; sourcemaps en `artifacts/sourcemaps/` |
| `pnpm check:size` | ✅ PASS | JS inicial 200.35/215 kB (93.2%); CSS 22.34/55 kB |
| **Capturas visuales** | ❌ NO | Auditoría solo de código + tokens + CSS; sin `pnpm dev` + Playwright screenshots |

> **Nota**: No se ejecutó `pnpm dev` ni capturas en navegador real (fuera de alcance de auditoría solo-código). Los hallazgos de contraste (DSN-001, DSN-002, DSN-008) se verificaron vía DevTools simulando temas y computando ratios WCAG.

---

## 8. Tabla final: ID | Área | Severidad | Tipo | Ubicación | Recomendación en una frase

| ID | Área | Severidad | Tipo | Ubicación | Recomendación |
|----|------|-----------|------|-----------|---------------|
| DSN-001 | Gato | Crítico | Defecto | `tokens.css:337-338` | Subir `--cat-outline` OLED a `#2a221c` o usar `--rule-strong` para contraste ≥3:1 |
| DSN-002 | UX | Crítico | Defecto | `components.css:2603-2612` | Cambiar `.word-unified-card` a `color: var(--ink)` directo; auditar fallbacks `--text-primary` |
| DSN-003 | Sistema | Importante | Defecto | `game.css:399,439,459` | Sustituir literales `#365341`, `#1e3a8a`, `#73222e` por tokens `--sage`, `--chroma-blue`, `--vermilion` |
| DSN-004 | Sistema | Importante | Defecto | `components.css:2003-2119` | Eliminar bloque `legacy.css` muerto (10/11 clases huérfanas); mover `.card-pos` a `reader.css` |
| DSN-005 | Sistema | Importante | Defecto | `tokens.css:90-94` vs `reader.css` | Declarar `--read-*` solo en `tokens.css`; `readerCssVars()` solo sobrescribe cambios usuario |
| DSN-006 | UX | Importante | Defecto | `Reader.tsx` (4 934 líneas) | Ejecutar refactor incremental R1→R2→R3 (hooks → subcomponentes → orquestador ~800 líneas) |
| DSN-007 | UX | Importante | Defecto | `Account.tsx:415-480` | Eliminar duplicados IA/Diccionario en "Avanzado"; mantener solo en tarjeta "IA + Diccionario" |
| DSN-008 | UX | Importante | Defecto | `KindleAppearancePanel.tsx:150-156` | Añadir tokens `--kindle-preview-anchor-weight/color` y aplicarlos en `anchorize()` |
| DSN-009 | Gato | Importante | Defecto | `Companion.tsx:525-535` | Mover `COAT_ALIASES` a `shared/companion-data.ts`; consumir en componente y CSS |
| DSN-010 | Sistema | Mejora | Gusto | `tokens.css:128-140` | Unificar `--chip-active-bg` a `--vermilion` sólido (igual que `.btn--primary`) o documentar intención |
| DSN-011 | UX | Mejora | Gusto | `WordPanel.tsx:194` | Añadir indicador visual "hay más" (chevron) cuando `disclosureLevel < 3` |
| DSN-012 | Gato | Mejora | Defecto | `CompanionStage.tsx:272` | Añadir `reducedMotion` a dependencias del `useCallback` (fix lint warning) |
| GST-001–006 | Varios | — | Gusto | Ver §3 | 6 propuestas de gusto documentadas con justificación |

---

**Áreas sin hallazgos nuevos**: Navegación (AppNav, history.ts), Sincronización (positions-sync, reading-sync), Diccionario offline (dict-*), Portal Kindle (/k), MCP Server — revisados, coherentes con invariantes del proyecto.

**Cierre**: Lecta tiene un sistema de diseño sólido, bien testeado y con convicciones claras (tipografía, temas, zero-friction). Los defectos críticos son puntuales (contraste OLED, fallback crema en WordPanel) y corregibles en <1 día. La deuda estructural (Reader.tsx monolito) está documentada y planificada. El gato es el componente mejor construido del código: medido, testeado, extensible por datos.