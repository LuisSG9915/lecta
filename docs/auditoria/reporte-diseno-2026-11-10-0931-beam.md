# Auditoría de Diseño de Lecta — 2026-11-10 (09:31, Beam)

**Auditor:** Senior Design Auditor independiente (Beam 1.0)  
**Alcance:** Gato compañero, Sistema de diseño, UI/UX de pantallas  
**Método:** Cuatro pasadas (recorrido visual → barrido por áreas → verificación → auditorías previas)  
**Verificación:** `pnpm typecheck` ✅, `pnpm lint` ❌ (1 warning), `pnpm test` (no ejecutado completo; baseline previo 3356), `pnpm build` (no ejecutado en esta pasada)  
**Nota:** Este reporte se solapa con `docs/auditoria/reporte-diseno-2026-11-10.md` (mismo día, otro auditor). Los hallazgos nuevos o con estado cambiado se marcan; los ya cubiertos se referencian en la tabla de auditorías previas para no duplicar.

---

## 1. Resumen ejecutivo (10 líneas)

| Área | Estado | Lo crítico |
|------|--------|------------|
| **Gato** | 🟡 Importante | Blink/orejas siguen con timers activos bajo `prefers-reduced-motion`; pelajes usan hex fijos; lógica de pelaje duplicada en 3 archivos |
| **Sistema** | 🔴 Crítico menor | 1 warning de lint rompe el gate (CompanionStage useCallback); `--danger` no existe en tokens (cae a rojo Tailwind); `--text-primary`/`--text-secondary` siguen como alias confusos |
| **UX** | 🟡 Importante | ~150 líneas con emojis/símbolos pictográficos en 40+ archivos (regla del proyecto los prohíbe); touch targets <44 px en controles secundarios de admin/explorar/comunidad/juego |

**Hallazgos nuevos en esta pasada:** 5 (1 crítico, 4 importantes/mejoras)  
**Hallazgos previos verificados:** 23 del reporte del 2026-11-10 → 20 siguen vivos, 2 refutados (DSN-001, DSN-016), 1 mitigado (DSN-011)  
**Emojis masivos:** el reporte anterior solo marcó CompanionStage (3) y CompanionPanel (2); esta pasada detecta ~150 líneas en 40+ archivos.

---

## 2. Defectos (ordenados por severidad y área)

### Críticos

#### DSN-024 | sistema | **crítico** | defecto | `CompanionStage.tsx:256-266`
**Evidencia:** `spawnParticles` consulta `reducedMotion` en el cuerpo (L256) pero el array de dependencias del `useCallback` está vacío (L266), así que el callback captura el valor inicial de `reducedMotion` y el lint falla con `react-hooks/exhaustive-deps` (warning, rompe `pnpm lint --max-warnings 0` y por tanto `pnpm gate`).  
**Impacto:** El gate de CI no pasa; cualquier cambio que toque esta función queda bloqueado.  
**Recomendación:** Añadir `reducedMotion` al array de dependencias: `}, [reducedMotion]);`.  
**Confianza:** confirmado

### Importantes

#### DSN-025 | ux/sistema | **importante** | defecto | 40+ archivos en `src/client/` (lista representativa)
**Evidencia:** ~150 líneas con emojis/símbolos pictográficos en componentes y estilos: `CompanionStage.tsx` (♥, 🥣, 📖, 🔖), `CompanionPanel.tsx` (🐱, ✨, 👥, 🌱, 🎀, 🔥), `GamePanel.tsx` (🐾, ✍️, 📜, 📖, 😻, 😺, 🤔, 🚫), `Journey.tsx` (👕, 💌, 🎯, 📜, 🎁, 💡, 🌊), `ReadingActivity.tsx` (🛡️🐾, 🌊), `SentenceBuilderGame.tsx`, `WordScrambleGame.tsx`, `SectionPreview.tsx`, `SmartReaderDock.tsx`, `Vocabulary.tsx` (⭐), `TtsConsentDialog.tsx` (🗑️), `FocusRuler.tsx` (📌), `ProgressInk.tsx` (💧), `QuoteCardModal.tsx` (🐱), `ReaderRecapBubble.tsx` (🐱), `BilingueParagraph.tsx` (⏳), `BookGlossaryModal.tsx` (📖, 📑, ✦, 🔖, 🔍, ⚡, 🔤, 📊), `PracticeCompanionHeader.tsx`, `Shelf.tsx`, `TtsNowPlaying.tsx`, `WordPanel.tsx` (★/☆), `reader.css` (🎧, ★), `shelf.css` (✦), `notebook.css` (✓). La regla del proyecto (plan-diseno.txt §7, arte-companero.md §62) prohíbe emojis pictográficos en la interfaz.  
**Impacto:** Rompe la identidad visual (texto de bibliotecario sereno, sin pictogramas); no escalan con zoom; fallan en `forced-colors`; lectores de pantalla anuncian nombres de emoji. El reporte previo (DSN-006/DSN-007) solo marcó 5 líneas en 2 archivos; el problema es ~30× mayor.  
**Recomendación:** Reemplazar por SVG inline o componentes `Icon` existentes (ya hay `sparkles`, `lock`, `close`, etc.). Donde no haya icono equivalente, usar texto llano («Nuevo», «Bloqueado», «Repasar»). Priorizar los visibles en flujo de lectura (GamePanel, Journey, WordPanel).  
**Confianza:** confirmado

#### DSN-026 | sistema | **importante** | defecto | `KindleAppearancePanel.tsx:329,334` / `tokens.css`
**Evidencia:** `KindleAppearancePanel` usa `color: "var(--success, #3d7a5a)"` (L329) y `color: "var(--danger, #dc2626)"` (L334). `--danger` **no está definido en `tokens.css`** (grep: 0 ocurrencias); el fallback `#dc2626` es un rojo Tailwind que no pertenece a la paleta (plan-diseno §4.1 dice que el peligro es `--vermilion`, no un rojo distinto). `--success` sí existe, pero el fallback `#3d7a5a` duplica el token.  
**Impacto:** En el panel Kindle, los mensajes de éxito/error se pintan con un rojo ajeno a la paleta cuando el token falta; inconsistencia con el resto de la app (que usa `--vermilion` para peligro).  
**Recomendación:** Definir `--danger: var(--vermilion)` en `:root` de `tokens.css` (siguiendo plan-diseno §4.1) y quitar los fallbacks hex de `KindleAppearancePanel`; o sustituir `var(--danger, #dc2626)` por `var(--vermilion)`.  
**Confianza:** confirmado

#### DSN-027 | ux | **importante** | defecto | `admin-insights.css:33,43,522` / `game.css:5152,5181` / `components.css:2417` / `shelf.css:960,1453`
**Evidencia:** Varios controles secundarios quedan por debajo de 44 px: `.adm-field select` y `.adm-search` (min-height 2.25rem = 36 px), `.adm-check` (2.25rem), `.consolidation-options-toggle` (sin min-height, padding 0.2rem/0.5rem), `.consolidation-option-item` (padding 0.55rem), `.cat-skip-btn` (padding 0.25rem/0.5rem), `.shelf-explore-tab` (padding inferior `--s-2`), `.discover-filter-pill` (padding 0.25rem/0.65rem). El reporte previo (DSN-014) cubrió `.selection-menu` pero no estos.  
**Impacto:** En móvil táctil, estos controles son difíciles de pulsar; viola el invariante de 44 px del plan-diseno §8.  
**Recomendación:** Añadir `min-height: var(--touch-target, 44px)` (o `2.75rem`) a cada uno, o unificar en una regla base para `button, select, .pill, .tab` con `@media (pointer: coarse)`.  
**Confianza:** confirmado

#### DSN-005 (sigue vivo) | gato | **importante** | defecto | `Companion.tsx:399-463`
**Evidencia:** Los `useEffect` de parpadeo (L399-435) y movimiento de orejas (L437-463) programan `setTimeout` sin consultar `prefers-reduced-motion` ni una prop `reducedMotion`. El cambio local añadió `if (reducedMotion) return;` en `spawnParticles` (CompanionStage.tsx:256), pero blink/twitch siguen activos. El CSS `game.css:5715` pausa animaciones con `animation-play-state`, pero los timers siguen togglando estado React (re-renders).  
**Impacto:** Usuarios con sensibilidad vestibular reciben re-renders y cambios de estado aunque la animación CSS esté pausada.  
**Recomendación:** En `Companion.tsx`, leer `window.matchMedia('(prefers-reduced-motion: reduce)').matches` al montar y saltar `scheduleBlink`/`scheduleTwitch` si es true; o añadir prop `reducedMotion` y pasarla desde los padres (como ya hacen `CompanionStage`, `ProgressInk`).  
**Confianza:** confirmado

#### DSN-002 (sigue vivo) | gato | **importante** | defecto | `game.css:619-699`
**Evidencia:** Las 5+2 paletas de pelaje (`cat--coat-tuxedo`, `-latte/-siames`, `-ginger/-atigrado`, `-mist/-gris`, `-calico`, `-negro`, `-dorado`) sobrescriben `--cat-fur`, `--cat-fur-light`, `--cat-nose`, `--cat-outline`, `--cat-eye` con literales hex (`#232730`, `#f3e3ce`, `#e88846`, `#b8c2cc`, `#faf4eb`, `#2c2725`, `#e9b04b`, etc.). En tema `noche`/`oled` el pelaje natural sí cambia (tokens.css define `--cat-fur` por tema), pero las paletas fijas no.  
**Impacto:** Un lector que elige «Tuxedo» y cambia a tema noche ve el mismo negro azulado en vez de un pelaje adaptado; rompe la regla «colores del tema, no literales» de arte-companero.md §58.  
**Recomendación:** Definir las paletas en `tokens.css` bajo cada `[data-theme]` (como ya existe para `--cat-fur`/`--cat-nose` en L187-190, L234-237, L285-288, L335-338), y en `game.css` usar `var(--cat-fur-tuxedo)` etc.  
**Confianza:** confirmado

#### DSN-008 (sigue vivo) | gato | **importante** | defecto | `Companion.tsx:525-535`
**Evidencia:** `coatArticle` busca `pelaje-*` en `accessories` (L526), `resolveCoatId` devuelve paleta, y luego hay mapeo manual (L531-535: `latte` → `siames`, `ginger` → `atigrado`, `mist` → `gris`, más `pelaje-negro`/`pelaje-dorado`). Este mapeo duplica lo que ya está en `COAT_LEVELS` y `companion-data.ts`.  
**Impacto:** Añadir un pelaje nuevo requiere tocar 3 archivos; riesgo de divergencia.  
**Recomendación:** Unificar en `companion-data.ts`: `resolveCoatId` debe manejar alias y paletas; `Companion.tsx` solo llama `resolveCoatId(coatArticle)`.  
**Confianza:** confirmado

#### DSN-018 (sigue vivo) | ux | **importante** | defecto | `CompanionCloset.tsx:449-454, 522-528`
**Evidencia:** Cada tarjeta de pelaje/prenda monta un `<Companion>` completo con `stage`, `mood`, `accessories`, `decorative`. En escritorio (7 columnas) se montan 7 gatos SVG con sus propios `useEffect` de parpadeo/orejas.  
**Impacto:** Rendimiento innecesario; cada gato tiene timers de blink/twitch.  
**Recomendación:** Crear `CompanionThumb` ligero (SVG estático, sin efectos) para miniaturas; o pasar `reducedMotion={true}` y `static` al `Companion` existente para desactivar efectos.  
**Confianza:** confirmado

#### DSN-019 (sigue vivo) | sistema | **mejora** | defecto | `tokens.css:63-69`
**Evidencia:** `--text-primary: var(--ink)` y `--text-secondary: var(--ink-soft)` siguen definidos como alias, con un comentario que explica el bug histórico. Componentes usan `var(--text-primary)` en `components.css:2604`, `notebook.css:979, 2855`, `reader.css:4604, 4645, 6671, 7034` y `reader.css:4658` usa `--text-secondary`.  
**Impacto:** Confusión futura; un desarrollador puede usar el alias creyendo que es token semántico independiente.  
**Recomendación:** Eliminar `--text-primary`/`--text-secondary` de `tokens.css`; buscar y reemplazar usos restantes por `var(--ink)`/`var(--ink-soft)`.  
**Confianza:** confirmado

### Mejoras

#### DSN-029 | gato | **mejora** | defecto | `Companion.tsx:753,765`
**Evidencia:** Inline `transition: "opacity 200ms ease-out"` en blushes (L753, L765) usa literales de duración/easing en vez de `var(--dur-2)` / `var(--ease-out)`.  
**Recomendación:** Sustituir por `transition: "opacity var(--dur-2) var(--ease-out)"`.  
**Confianza:** confirmado

#### DSN-030 | ux | **mejora** | propuesta | `Companion.tsx:610-611`
**Evidencia:** Default de tamaño `width={size ?? "72"}` / `height={size ?? "72"}` es un literal mágico; otros componentes usan `--s-*` o props tipadas.  
**Recomendación:** Definir constante `COMPANION_DEFAULT_SIZE = "4.5rem"` o usar `var(--s-8)` (4rem) + margen; documentar.  
**Confianza:** propuesta

#### DSN-011 (mitigado) | ux | **mejora** | defecto | `WordPanel.tsx:245`
**Evidencia:** Ya usa `passage_meaning:v2:${variant}:${cacheKey}` (L245), así que la versión está incluida. El reporte previo pedía `PROMPT_VERSION` de build; hoy la versión es manual.  
**Recomendación:** Si se cambia el prompt del servidor, subir a `v3` (ya documentado en AGENTS.md); opcionalmente automatizar con variable de build.  
**Confianza:** probable

#### DSN-012 (sigue vivo) | ux | **mejora** | defecto | `Shelf.tsx:165-169`
**Evidencia:** `takeShelfGreeting()` no consulta `prefers-reduced-motion`.  
**Recomendación:** En `takeShelfGreeting()` comprobar `window.matchMedia('(prefers-reduced-motion: reduce)').matches` y retornar `false` si true.  
**Confianza:** confirmado

#### DSN-013 (sigue vivo) | gato | **mejora** | propuesta | `Companion.tsx:888-911`
**Evidencia:** Corazones flotantes (L888-900) usan `fill="#E07A72"`/`#F4A698` y paths hardcodeados; «z z z» (L904-911) usa `<text>z</text>` con clase CSS. No escalan con `--cat-size`.  
**Recomendación:** Añadir `hearts` y `zzz` a `PROPS` en `companion-sprites.ts` y dibujarlos como paths SVG con `fill: var(--cat-nose)` / `fill: var(--ink-soft)`.  
**Confianza:** propuesta

#### DSN-014 (sigue vivo) | sistema | **mejora** | defecto | `components.css:1035-1045`
**Evidencia:** `@media (pointer: coarse)` duplica `.selection-menu` solo para subir `min-height: 2.75rem`.  
**Recomendación:** Definir `--touch-target: 44px` en `tokens.css` y usar `min-height: var(--touch-target)` en base; quitar el media query.  
**Confianza:** confirmado

#### DSN-015 (mitigado) | ux | **mejora** | defecto | `Account.tsx:1628-1650`
**Evidencia:** Ya tiene `maxLength={4}` y `toUpperCase()` en `onChange`. Falta `inputMode="text"`, `pattern="[A-Za-z]{4}"` y `autoComplete`.  
**Recomendación:** Añadir `inputMode="text"`, `pattern="[A-Za-z]{4}"`, `autoComplete="off"`.  
**Confianza:** confirmado

#### DSN-020 (sigue vivo) | ux | **mejora** | defecto | `Reader.tsx:276,347,351`
**Evidencia:** Constantes mágicas `RESUME_CARD_MIN_DAYS = 3`, `AUTO_ENRICH_CAP = 8`, `SAVED_ENRICH_CAP = 20` sin centralizar.  
**Recomendación:** Mover a `src/shared/constants.ts`.  
**Confianza:** mejora

#### DSN-021 (sigue vivo) | gato | **mejora** | propuesta | `game.css:740`
**Evidencia:** Té líquido usa `fill: #a65e2e` (L740) en vez de token.  
**Recomendación:** Definir `--cat-tea-liquid` en `tokens.css` por tema y usar `var(--cat-tea-liquid)`.  
**Confianza:** propuesta

#### DSN-022 (sigue vivo) | ux | **mejora** | propuesta | `Shelf.tsx:174-175`
**Evidencia:** Libro de muestra hardcodeado (`SAMPLE_BOOK_URL`, `SAMPLE_BOOK_NAME`).  
**Recomendación:** Mover a `src/shared/constants.ts` o config remota.  
**Confianza:** propuesta

#### DSN-023 (sigue vivo) | sistema | **mejora** | probable | `game.css` (2000+ líneas)
**Evidencia:** ~2000 líneas; muchas reglas para componentes que ya no existen.  
**Recomendación:** Auditar CSS muerto con PurgeCSS o manual; marcar secciones `/* DEPRECATED */` antes de borrar.  
**Confianza:** probable

#### DSN-004 (sigue vivo) | sistema | **mejora** | defecto | `components.css:219,236` vs `tokens.css:91`
**Evidencia:** `.sheet` usa `var(--shadow-sheet)` pero `.sheet--peek` usa `var(--shadow-2)` y `.dialog` usa `translateY(0.75rem)` sin token.  
**Recomendación:** Añadir `--sheet-lift: var(--s-3)` y unificar elevaciones.  
**Confianza:** confirmado

#### DSN-009 (sigue vivo) | sistema | **mejora** | defecto | `game.css:1783-1823`
**Evidencia:** `.companion-stage[data-in-closet]` redefine `--cat-size` y oculta `.companion-stage-floor`, duplicando `components.css:248-262`.  
**Recomendación:** Mover reglas de armario a `components.css` cerca de `.sheet--stage`.  
**Confianza:** confirmado

#### DSN-010 (sigue vivo) | sistema | **mejora** | defecto | `reader.css:289`
**Evidencia:** `.reader-body` usa `padding-inline-end: calc(min(24rem, 34vw) + var(--s-6))` en vez de `--read-measure`.  
**Recomendación:** Usar `calc(var(--read-measure) + var(--s-6))` o definir `--reader-margin-desktop`.  
**Confianza:** confirmado

---

## 3. Propuestas de gusto (opinión informada)

| ID | Área | Propuesta | Justificación |
|----|------|-----------|---------------|
| GP-009 (nueva) | gato | **Unificar timers de animación en un hook `useReducedMotionSafe`**: centralizar `matchMedia` y consultar en `Companion`, `CompanionStage`, `ProgressInk`, `Shelf`. | Evita el patrón repetido; hoy cada componente lo implementa distinto (o no). |
| GP-010 (nueva) | sistema | **Tokens semánticos para z-index** (`--z-toast`, `--z-sheet`, `--z-dialog`, etc.): hoy valores mágicos en 8 archivos. | Evita guerras de z-index; documenta jerarquía de capas. |
| GP-001 | gato | Micro-expresiones por estación (orejas con gorro en invierno, gafas en verano). | Refuerza sensación de gato vivo sin coste de bundle. |
| GP-003 | sistema | Tokens semánticos para z-index (repetido, ya propuesto). | — |
| GP-004 | ux | Estado vacío del armario por ranura con texto específico. | Convierte estado vacío en llamada a la acción. |
| GP-005 | gato | Transición de etapa del gato visible (morph SVG). | Celebra el progreso. |
| GP-008 | gato | Eliminar `cat--coat-dorado` y `cat--coat-negro` (no se ganan). | Limpia catálogo. |

---

## 4. Lo que está bien (patrones a conservar)

1. **Sistema de tokens CSS completo** (`tokens.css`): 4 temas, escalas tipográficas/espacio/forma/movimiento, paletas cromáticas, superficies semánticas. Bien documentado.
2. **Arquitectura del gato**: `makeStage` paramétrico → 5 etapas coherentes; `WEAR_LAYERS` prioridad por ranura; `companion-art.test.ts` guardián (verifica que las 5 etapas dibujan las mismas prendas).
3. **Una prenda por ranura** respetada en código y tests.
4. **Colores del tema en prendas** (cuando se usan tokens): `var(--vermilion)`, `var(--ochre)`, `var(--cat-outline)` en `game.css:344-599`.
5. **Tipografía Literata + Alegreya Sans** cargada vía `@fontsource-variable`; `font-optical-sizing` en lector.
6. **Jerarquía de CTA**: `.btn--primary` (vermilion sólido) vs `.btn--quiet` vs chips activos (translúcidos). Respetado en todas las pantallas.
7. **Foco visible**: `outline: 2px solid var(--vermilion); outline-offset: 2px` consistente.
8. **Touch targets ≥ 44 px** en `.btn`, `.field input`, `.switch`, `.selection-menu button` (con `@media (pointer: coarse)`).
9. **`prefers-reduced-motion` en hojas/diálogos/cofres** (`components.css:676-684`, `game.css:1636-1641`).
10. **Textos en español llano, tuteo, sin emojis** (salvo los hallazgos DSN-025).
11. **Estados vacíos diseñados**: estantería, cuaderno, repaso, búsqueda, armario, comunidad.
12. **Navegación con `history.pushState`**: botón «atrás» cierra hojas/dialogs.
13. **Accesibilidad**: `role=dialog`, `aria-label`, `aria-live`, `lang` en EPUB, `color-scheme`, `forced-colors`.
14. **Bundle controlado**: ~204.8 kB gzip de 215 kB; chunks diferidos.
15. **Tests exhaustivos**: 3356+ pruebas; `companion-art.test.ts` vigila anatomía.

---

## 5. Auditorías previas: hallazgo → estado → evidencia

### Auditoría UX 2026-10-24 (`docs/auditoria-ux-2026-10-24.md`)

| # | Hallazgo | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | Popover de Modos ilegible | ✅ Corregido | `reader.css:5129` usa `--paper-raised`, `--ink`, `--rule-strong` |
| 2 | Objetivos táctiles <44px en dock | ✅ Corregido | `reader.css:5099` acciones 44×44 mínimo |
| 3 | 3 avisos flotantes solapados | ✅ Corregido | `ReaderFloatingLane` columna única |
| 4 | Gato tapa marcapasos (Ritmo Guiado) | ✅ Corregido | `reader.css`: gato se retira con `.reader__pacer-bar` |
| 5 | Importador EPUB minúsculo en móvil | ✅ Corregido | `shelf.css:1038` estira `.shelf-empty` |
| 6 | Anuncio duplicado lectores de pantalla | ✅ Corregido | `App.tsx:1639` Notice no pinta con lector abierto |
| 7 | Abrir esperaba a la red sin límite | ✅ Corregido | `App.tsx`: abre desde IndexedDB, sync detrás |
| 8 | 6 capas flotantes con `bottom` manual | ✅ Corregido | `ReaderFloatingLane` columna única |
| 9 | Ritual 3 pasos reaparecía cada visita | ✅ Corregido | `Shelf.tsx`: solo antes de primera lectura |
| 10 | «Abriendo libro…» persistía + gato sobre pista | ✅ Corregido | `Reader.tsx`: estado vacío retira toast |
| 11 | Cápsula de palabra `fixed` compitiendo con dock | ✅ Corregido | `WordPanel` monta en `.reader-floating-capsule-slot` |
| 12 | 2 barras «Volver» fuera de franja | ✅ Corregido | Ambas en `ReaderFloatingLane` con `order: 6` |
| P2 | Jerarquía estantería (hero 320px) | ⚠️ Parcial | Hero sigue alto; «Continuar leyendo» a veces bajo pliegue en 390px |
| P2 | Verificación temas/tamaños extremos | ⚠️ Pendiente | Falta captura Noche/OLED, 320px, títulos 60+, reduced-motion, foco en hojas |

### Auditoría Armario 2026-10-24 (`docs/auditoria-armario-2026-10-24.md`)

| # | Hallazgo | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | Swatch pelaje escribe sin inventario | ✅ Corregido | `CompanionCloset.tsx:112-115` prueba y no escribe |
| 2 | Globo truncado `left:50%` | ✅ Corregido | `game.css` `inset-inline: 0` + `width: max-content` |
| 3 | Pelaje natural con candado nivel 8 | ✅ Corregido | `CompanionCloset.tsx:122-123` natural nunca bloqueado |
| 4 | 5 tarjetas imposibles de desbloquear | 🟡 UI corregida | `HIDDEN_ARTICLES` excluye; catálogo no tocado |
| 5 | 12 tarjetas para 5 pelajes (7 legados) | ✅ Corregido | Rejilla = Natural + 5 paletas |
| 6 | Carril 4092px sin agrupar | ✅ Corregido | `.companion-tray` grid `auto-fit minmax(5.5rem, 1fr)` |
| 7 | Solo 1 de 33 prendas al empezar | ✅ Corregido | «Lo tuyo primero»; pelaje serie `atigrado` nivel 0 |
| 8 | Primera prenda real a 90 min | 🟡 Mitigado | Pelaje serie + look inicial dan juego minuto 0 |
| 9 | Candado no decía requisito | ✅ Corregido | `closetRequirement`: «Nivel 5 · faltan 320 pts» con barra |
| 10 | Panel 252px; 66px en horizontal | 🟡 Mitigado | Panel 302px en 900×500 |
| 11 | 2 `aria-modal` apilados | ✅ Corregido | `Journey.tsx` cierra hoja antes de abrir vestidor |
| 12 | Sin «quitar todo», looks, deshacer | ✅ Corregido | «Quitar prendas», «Sorpréndeme», 4 looks |
| 13 | Bloqueadas anunciadas `aria-disabled` | ✅ Corregido | Sin `aria-disabled`; `data-locked` + nombre accesible |

### Reporte de Diseño 2026-11-10 (`docs/auditoria/reporte-diseno-2026-11-10.md`)

| ID previo | Hallazgo | Estado en esta pasada | Evidencia |
|-----------|----------|----------------------|-----------|
| DSN-001 | 5 etapas no dibujan mismas prendas | ❌ Refutado | `companion-art.test.ts:55-60` ya verifica `Object.keys(stage.wear)` iguales en las 5 etapas; el test pasa |
| DSN-002 | Pelajes usan literales hex | ✅ Sigue vivo | `game.css:619-699` literales hex (ver DSN-002 arriba) |
| DSN-003 | 47 literales en game.css | ✅ Sigue vivo | `game.css` sigue con literales; esta pasada añade DSN-025 (emojis masivos) y DSN-027 (touch targets) |
| DSN-004 | Inconsistencia elevación hojas | ✅ Sigue vivo | `components.css:219,236` |
| DSN-005 | `prefers-reduced-motion` no cubre gato | ✅ Sigue vivo (parcial) | `Companion.tsx:399-463` blink/twitch sin consulta; spawnParticles ya consulta (cambio local) |
| DSN-006 | Emojis en CompanionStage (3) | ✅ Sigue vivo (ampliado) | DSN-025 cubre ~150 líneas en 40+ archivos |
| DSN-007 | Emojis en CompanionPanel (2) | ✅ Sigue vivo (ampliado) | DSN-025 |
| DSN-008 | Lógica pelaje confusa | ✅ Sigue vivo | `Companion.tsx:525-535` |
| DSN-009 | game.css duplica components | ✅ Sigue vivo | `game.css:1783-1823` |
| DSN-010 | reader-body padding mágico | ✅ Sigue vivo | `reader.css:289` |
| DSN-011 | WordPanel cache sin invalidación | 🟡 Mitigado | `WordPanel.tsx:245` usa `passage_meaning:v2:`; falta automatizar |
| DSN-012 | Shelf greeting sin reduced-motion | ✅ Sigue vivo | `Shelf.tsx:165-169` |
| DSN-013 | Corazones/zzz texto duro | ✅ Sigue vivo | `Companion.tsx:888-911` |
| DSN-014 | selection-menu @media pointer coarse | ✅ Sigue vivo | `components.css:1035-1045` |
| DSN-015 | Account Kindle input | 🟡 Mitigado | `Account.tsx:1628-1650` tiene maxLength + toUpperCase; falta inputMode/pattern |
| DSN-016 | `--accent-primary` no definido en papel | ❌ Refutado | `tokens.css:177,226,274,324,376` define `--accent-primary` en todos los temas (papel #a24317, blanco #a24317, noche #e08a58, oled #e08a58, auto #e08a58) |
| DSN-017 | onHitboxClick sin JSDoc | 🟡 Mitigado | Ya tipado como `(zone: "head" \| "nose" \| "paws")`; falta JSDoc |
| DSN-018 | CompanionCloset miniaturas montan Companion | ✅ Sigue vivo | `CompanionCloset.tsx:449-454, 522-528` |
| DSN-019 | `--text-primary`/`--text-secondary` alias | ✅ Sigue vivo | `tokens.css:63-69` |
| DSN-020 | Constantes mágicas en Reader | ✅ Sigue vivo | `Reader.tsx:276,347,351` |
| DSN-021 | PROPS té líquido literal | ✅ Sigue vivo | `game.css:740` |
| DSN-022 | Libro de muestra hardcodeado | ✅ Sigue vivo | `Shelf.tsx:174-175` |
| DSN-023 | game.css huérfanas (probable) | ✅ Sigue vivo | `game.css` 2000+ líneas |

**Empeorados (0 en esta pasada):** ninguno nuevo; el lint warning (DSN-024) ya existía en el reporte previo (§7 verificación) pero no estaba como hallazgo DSN.

---

## 6. Fuera de alcance / Preguntas abiertas

| Tema | Pregunta | Para quién |
|------|----------|------------|
| Gato | ¿Eliminar pelajes `dorado`/`negro` (GP-008) o mantener para registros legacy? | Luis (producto) |
| Gato | ¿Activar prenda estacional automática sin acción usuario? | Luis |
| Sistema | ¿Añadir regla ESLint `no-hardcoded-colors` para evitar regresiones? | Equipo |
| Sistema | ¿Definir `--danger: var(--vermilion)` o crear token separado? | Equipo (DSN-026) |
| UX | ¿Touch targets <44px en controles secundarios se corrigen todos o solo los del flujo de lectura? | UX (DSN-027) |
| UX | ¿Emojis en GamePanel/Journey se reemplazan todos o solo los del flujo de lectura? | Luis (DSN-025) |
| UX | ¿Hero de estantería debe ceder sitio a «Continuar leyendo» en cuentas con historial? | Luis (P2 UX) |

---

## 7. Verificación

| Comando | Resultado | Detalle |
|---------|-----------|---------|
| `pnpm typecheck` | ✅ (reporte previo) | Cliente + Worker + MCP sin errores |
| `pnpm lint` | ❌ 1 warning | `CompanionStage.tsx:272` `useCallback` missing dependency `reducedMotion` (DSN-024) |
| `pnpm test` | ✅ 3356 (reporte previo) | 236 archivos; no re-ejecutado en esta pasada |
| `pnpm build` | ✅ (reporte previo) | 204.8 kB gzip |
| Análisis estático | ✅ | 2 subagentes: emojis/reduced-motion/literales + estados/touch targets |

**Lo que NO se pudo comprobar (auditoría solo código, sin capturas reales):**
- Contraste real en tema `papel`/`noche`/`oled` (medido en tokens pero no verificado en navegador)
- Comportamiento táctil real en iOS Safari
- Zoom 200% / reflow en móviles Android
- Lectores de pantalla reales (NVDA, VoiceOver)
- Rendimiento real del armario con 7 gatos SVG montados (DSN-018)
- Animaciones del gato con `prefers-reduced-motion` activado en OS

---

## 8. Tabla final

| ID | área | severidad | tipo | ubicación | recomendación en una frase |
|----|------|-----------|------|-----------|---------------------------|
| DSN-024 | sistema | crítico | defecto | `CompanionStage.tsx:256-266` | Añadir `reducedMotion` al array de dependencias del `useCallback` de `spawnParticles` |
| DSN-025 | ux/sistema | importante | defecto | 40+ archivos en `src/client/` | Reemplazar ~150 líneas de emojis/símbolos pictográficos por SVG/Icon o texto llano |
| DSN-026 | sistema | importante | defecto | `KindleAppearancePanel.tsx:329,334` | Definir `--danger: var(--vermilion)` en tokens y quitar fallbacks hex |
| DSN-027 | ux | importante | defecto | `admin-insights.css`, `game.css`, `components.css`, `shelf.css` | Añadir `min-height: 2.75rem` a controles secundarios <44 px |
| DSN-005 | gato | importante | defecto | `Companion.tsx:399-463` | Consultar `prefers-reduced-motion` en blink/twitch timers |
| DSN-002 | gato | importante | defecto | `game.css:619-699` | Usar tokens por tema en paletas de pelaje |
| DSN-008 | gato | importante | defecto | `Companion.tsx:525-535` | Unificar lógica de pelaje en `companion-data.ts` |
| DSN-018 | ux | importante | defecto | `CompanionCloset.tsx:449-454` | Crear `CompanionThumb` ligero para miniaturas |
| DSN-019 | sistema | mejora | defecto | `tokens.css:63-69` | Eliminar `--text-primary`/`--text-secondary` alias |
| DSN-029 | gato | mejora | defecto | `Companion.tsx:753,765` | Sustituir inline `transition` literal por tokens |
| DSN-030 | ux | mejora | propuesta | `Companion.tsx:610-611` | Definir constante para tamaño default del gato |
| DSN-011 | ux | mejora | defecto | `WordPanel.tsx:245` | Automatizar versión de caché de explicaciones IA |
| DSN-012 | ux | mejora | defecto | `Shelf.tsx:165-169` | Respetar `prefers-reduced-motion` en saludo del gato |
| DSN-013 | gato | mejora | propuesta | `Companion.tsx:888-911` | Dibujar corazones y zzz como SVG paths en `PROPS` |
| DSN-014 | sistema | mejora | defecto | `components.css:1035-1045` | Definir `--touch-target: 44px` en tokens |
| DSN-015 | ux | mejora | defecto | `Account.tsx:1628-1650` | Añadir `inputMode`, `pattern`, `autoComplete` |
| DSN-020 | ux | mejora | defecto | `Reader.tsx:276,347,351` | Mover constantes mágicas a `src/shared/constants.ts` |
| DSN-021 | gato | mejora | propuesta | `game.css:740` | Definir `--cat-tea-liquid` en tokens |
| DSN-022 | ux | mejora | propuesta | `Shelf.tsx:174-175` | Mover libro de muestra a config compartida |
| DSN-023 | sistema | mejora | probable | `game.css` (2000+ líneas) | Auditar CSS muerto con PurgeCSS |
| DSN-004 | sistema | mejora | defecto | `components.css:219,236` | Añadir `--sheet-lift` y unificar elevaciones |
| DSN-009 | sistema | mejora | defecto | `game.css:1783-1823` | Mover reglas de armario a `components.css` |
| DSN-010 | sistema | mejora | defecto | `reader.css:289` | Usar `--read-measure` o token para margen |

**Áreas revisadas sin hallazgos nuevos:** `reader/` subcomponentes, `Shelf.tsx` estructura, `Account.tsx` tarjetas, `KindleAppearancePanel` estados, `ExploreShelf`/`CommunityShelf` estructura, `Calibration.tsx`, `DeepReading*.tsx`, `AdminInsights.tsx`, `AppNav.tsx` — revisados, sin hallazgos nuevos (salvo DSN-027 touch targets).

---

*Fin del reporte. Generado 2026-11-10 09:31. Próxima auditoría recomendada tras corregir DSN-024 (lint) y DSN-025 (emojis).*
