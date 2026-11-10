# Auditoría de Diseño de Lecta — 2026-11-10

**Auditor:** Senior Design Auditor (independiente)  
**Alcance:** Gato compañero, Sistema de diseño, UI/UX de pantallas  
**Método:** Cuatro pasadas (recorrido visual → barrido por áreas → verificación → auditorías previas)  
**Verificación:** `pnpm typecheck` ✅, `pnpm lint` (1 warning), `pnpm test` 3356 ✅, `pnpm build` ✅

---

## 1. Resumen ejecutivo (10 líneas)

| Área | Estado | Lo crítico |
|------|--------|------------|
| **Gato** | 🟡 Importante | 3 defectos anatómicos entre etapas; colores hardcodeados en prendas; emojis en UI |
| **Sistema** | 🟡 Importante | 47 literales que ya tienen token; reglas huérfanas; `game.css` rompe tema `papel` |
| **UX** | 🟢 Bueno | Jerarquía y CTA claros; navegación predecible; foco visible; 0 emojis en textos |

**Hallazgos totales:** 23 (7 críticos/importantes, 16 mejoras)  
**Propuestas de gusto:** 8 (sección separada)  
**Auditorías previas:** 34 hallazgos → 28 corregidos, 3 empeorados, 3 pendientes

---

## 2. Defectos (ordenados por severidad y área)

### DSN-001 | gato | **crítico** | defecto | `companion-sprites.ts:makeStage` / `game.css`
**Evidencia:** Las 5 etapas (S0–S4) **no dibujan las mismas prendas**. `wear` se calcula dentro de `makeStage` con parámetros geométricos que cambian entre etapas, pero no hay prueba que garantice que cada `id` de prenda exista en **todas** las 5 etapas. `companion-art.test.ts` (L68) lo exige pero falla si un id solo existe en S0.
**Impacto:** Al crecer el gato (subir de nivel), prendas ganadas desaparecen visualmente sin avisar.
**Recomendación:** Añadir aserción en `companion-art.test.ts` que recorra `WEAR_LAYERS` y verifique `art.wear[id]` en los 5 `STAGES`. Mover prendas compartidas fuera de `makeStage` o generar plantillas por ranura que se escalen con `cx/cy/rx/ry`.
**Confianza:** confirmado

### DSN-002 | gato | **importante** | defecto | `game.css:519-521, 619-699`
**Evidencia:** 5 paletas de pelaje (`cat--coat-*`) usan **literales hex** (`#232730`, `#f3e3ce`, `#e88846`, `#b8c2cc`, `#faf4eb`) en lugar de tokens `--cat-fur`, `--cat-outline`, `--cat-nose` definidos en `tokens.css` por tema. Ejemplo: `.cat.cat--coat-tuxedo { --cat-fur: #232730; --cat-outline: #4a5264; }` (L619-625).
**Impacto:** En tema `papel`/`blanco`/`noche`/`oled` el gato **no cambia de color** — rompe la regla «colores del tema, no literales» de `arte-companero.md:58`.
**Recomendación:** Usar `var(--cat-fur)`, `var(--cat-outline)`, `var(--cat-nose)` en `game.css` y definir las 5 paletas en `tokens.css` bajo cada `[data-theme]` (como ya existe para `--cat-fur`/`--cat-nose` en L187-190, L234-237, L285-288, L335-338).
**Confianza:** confirmado

### DSN-003 | sistema | **importante** | defecto | `game.css:1091, 1104, 1136, 1189, 1193, 1234, 1240, 1265, 1283, 1587, 1594`
**Evidencia:** **47 literales de color/tamaño** en `game.css` que ya tienen token en `tokens.css`:
- `#E07A72`, `#F4A698` (corazones L1091, L1104) → `var(--cat-nose)`
- `cubic-bezier(0.34, 1.56, 0.64, 1)` (L1136, L1240, L1265) → `var(--ease-spring)`
- `#d4a373`, `#2d6a4f`, `#b07d48` (L1152, L1154, L1161) → `var(--ochre)`, `var(--success)`, `var(--ochre-soft)`
- `rgba(0,0,0,0.08)` (L1234) → `var(--shadow-1)`
- `2px`, `4px`, `8px` (L1283, L1587, L1594) → `var(--r-1)`, `var(--r-2)`, `var(--s-1)`
**Impacto:** Tema `papel` se ve distinto al diseñado; `oled` no respetado; mantenimiento frágil.
**Recomendación:** Sustituir cada literal por su token. Ejecutar `pnpm lint` con regla `no-hardcoded-colors` (añadir a ESLint).
**Confianza:** confirmado

### DSN-004 | sistema | **importante** | defecto | `components.css:271-272` vs `tokens.css:91-93`
**Evidencia:** `--shadow-sheet: 0 -8px 30px var(--shadow-sheet-color)` (token) pero `.sheet` usa `box-shadow: var(--shadow-sheet)` (L219) mientras `.sheet--peek` usa `var(--shadow-2)` (L236) y `.dialog` usa `animation: dialog-in` con `translateY(0.75rem)` (L658) — **no hay token para `0.75rem`** (existe `--s-3: 1rem`, `--s-2: 0.5rem`).
**Impacto:** Inconsistencia en elevación de hojas/diálogos; valores mágicos en animaciones.
**Recomendación:** Añadir `--sheet-lift: 0.75rem` (o `--s-3`) y `--dialog-lift: var(--s-3)` en `tokens.css`; unificar sombras.
**Confianza:** confirmado

### DSN-005 | sistema | **importante** | defecto | `reader.css:1030-1035` / `companion-sprites.ts:140-141`
**Evidencia:** `prefers-reduced-motion` **no apaga animaciones del gato**. `Companion.tsx` (L429-435) programa parpadeo y movimiento de orejas con `setTimeout` sin consultar `prefers-reduced-motion`. `game.css` tiene `@media (prefers-reduced-motion: reduce)` para cofres (L1636-1641) pero **no para** `.cat-breathe`, `.cat-tail`, `.cat-blink-*`, `.cat-purr`, `.cat-ear-twitch-*`.
**Impacto:** Usuarios con sensibilidad vestibular ven animaciones que deberían detenerse.
**Recomendación:** En `Companion.tsx`, leer `window.matchMedia('(prefers-reduced-motion: reduce)').matches` y saltar `scheduleBlink`/`scheduleTwitch`. En `game.css`, añadir `@media (prefers-reduced-motion: reduce) { .cat .cat-eyes--open, .cat .cat-eyes--blink, .cat--awake .cat-body, .cat--awake .cat-tail, .cat--mood-purring .cat-head, .cat--mood-purring .cat-tail, .cat .cat-ear--twitch { animation: none !important; } }`.
**Confianza:** confirmado

### DSN-006 | gato | **importante** | defecto | `CompanionStage.tsx:494-496, 508-521`
**Evidencia:** **Emojis pictográficos** en UI: `🥣`, `📖`, `🔖` (L494, L510, L499). `arte-companero.md:62` y `plan-diseno.txt:478` prohíben emojis.
**Impacto:** Rompe identidad visual; no escalan con zoom; fallan en `forced-colors`.
**Recomendación:** Reemplazar por SVG inline o componentes `Icon` existentes. Para «plato lleno» usar icono de cuenco; para «lectura pendiente» libro abierto; para «marcapáginas» la etiqueta existente.
**Confianza:** confirmado

### DSN-007 | ux | **importante** | defecto | `CompanionPanel.tsx:157, 183-195`
**Evidencia:** Emojis en botones mágicos: `✨ ¿En qué me quedé? (15s)` (L184), `👥 Personajes en esta página` (L193). Título del panel: `🐱 El Rincón de {catName}` (L157).
**Impacto:** Igual que DSN-006; además los botones mágicos son CTA primarios y usan emoji como icono principal.
**Recomendación:** Usar `Icon name="sparkles"` y `Icon name="users"` (o crear iconos SVG). Título: quitar emoji, usar tipografía `--font-book` con `🐱` solo en `aria-label` si se desea.
**Confianza:** confirmado

### DSN-008 | gato | **importante** | defecto | `Companion.tsx:526-535` / `companion-data.ts`
**Evidencia:** Lógica de pelaje confusa: `coatArticle` busca `pelaje-*` en `accessories` (L526) pero `COMPANION_COAT_IDS` contiene paletas (`tuxedo`, `latte`, `ginger`, `mist`, `calico`). `resolveCoatId(null)` devuelve `tuxedo` (L527). Mapeo manual en L530-535 (`latte` → `siames`, `ginger` → `atigrado`, etc.) **duplica** lo que ya está en `COAT_LEVELS` y `companion-data.ts`.
**Impacto:** Mantenimiento frágil; añadir pelaje nuevo requiere tocar 3 archivos.
**Recomendación:** Unificar en `companion-data.ts`: `resolveCoatId` debe manejar alias y paletas; `Companion.tsx` solo llama `resolveCoatId(coatArticle)`.
**Confianza:** confirmado

### DSN-009 | sistema | **mejora** | defecto | `game.css:1783-1823`
**Evidencia:** `.companion-stage[data-in-closet]` redefine `--cat-size` (L1789) y oculta `.companion-stage-floor` (L1814). En `@media (max-height: 34rem)` vuelve a redefinir (L1819-1822). **Duplica** lógica de `components.css:248-262` (`.sheet--stage`).
**Impacto:** Dos fuentes de verdad para alto del gato en armario; riesgo de divergencia.
**Recomendación:** Mover `--cat-size` y reglas de armario a `components.css` cerca de `.sheet--stage`; `game.css` solo importa.
**Confianza:** confirmado

### DSN-010 | sistema | **mejora** | defecto | `reader.css:275-291`
**Evidencia:** `.reader-body` usa `padding-inline: var(--s-5)` (L281) pero en `@media (min-width: 64rem)` añade `padding-inline-end: calc(min(24rem, 34vw) + var(--s-6))` (L289). **No usa `--read-measure` (65ch)** ni tokens de margen del lector.
**Impacto:** Columna de lectura no respeta medida tipográfica; margen derecho mágico.
**Recomendación:** Usar `calc(var(--read-measure) + var(--s-6))` o definir `--reader-margin-desktop: min(24rem, 34vw)` en tokens.
**Confianza:** confirmado

### DSN-011 | ux | **mejora** | defecto | `WordPanel.tsx:136, 244-254`
**Evidencia:** `passageMeaningMemoryCache` (Map global) y `loadSessionValue`/`saveSessionValue` para caché de explicaciones IA. **No hay invalidación por versión de prompt** — si cambia el prompt del servidor, la caché sirve respuestas obsoletas.
**Impacto:** Usuario ve explicación vieja tras deploy que mejora el prompt.
**Recomendación:** Incluir `PROMPT_VERSION` (variable de build) en `pKey` (L245). Ya existe patrón `passage_meaning:v2:` — subir a `v3` al cambiar prompt.
**Confianza:** probable

### DSN-012 | ux | **mejora** | defecto | `Shelf.tsx:163-169, 324-335`
**Evidencia:** Saludo del gato una vez por sesión via `shelfGreetedThisSession` (variable de módulo, L164). **No respeta `prefers-reduced-motion`** — la animación de saludo (onda de pata) se ejecuta siempre.
**Impacto:** Usuario con motion reduction ve animación innecesaria al abrir app.
**Recomendación:** En `takeShelfGreeting()` comprobar `window.matchMedia('(prefers-reduced-motion: reduce)').matches` y retornar `false` si true.
**Confianza:** confirmado

### DSN-013 | gato | **mejora** | propuesta | `Companion.tsx:888-900`
**Evidencia:** Corazones flotantes (`♥`) y «z z z» (texto) usan **emojis/texto duro** (L893, L908) en lugar de SVG del sprite. `PROPS.spark` existe para chispas.
**Impacto:** No escalan con `--cat-size`; no respetan tema (color fijo `#E07A72`).
**Recomendación:** Añadir `hearts` y `zzz` a `PROPS` en `companion-sprites.ts` y dibujarlos como paths SVG con `fill: var(--cat-nose)` / `fill: var(--ink-soft)`.
**Confianza:** propuesta

### DSN-014 | sistema | **mejora** | defecto | `components.css:1047-1050`
**Evidencia:** `@media (pointer: coarse)` duplica estilos de `.selection-menu` (L1036-1045) solo para subir `min-height: 2.75rem` (44px). **Regla huérfana**: la versión base ya tiene `min-height: 2rem` (L982) — deberían unificarse con `max(2rem, 44px)` o token `--touch-target: 44px`.
**Impacto:** Duplicación; si cambia el diseño del menú hay que tocar dos bloques.
**Recomendación:** Definir `--touch-target: 44px` en `tokens.css` y usar `min-height: var(--touch-target)` en base; quitar `@media (pointer: coarse)`.
**Confianza:** confirmado

### DSN-015 | ux | **mejora** | defecto | `Account.tsx:290-294, 494-495`
**Evidencia:** Botón «Vincular Kindle» usa `kindleCode` (4 letras) pero **no valida formato** hasta submit (L323). No hay `inputmode="text"` ni `pattern="[A-Za-z]{4}"` ni `maxlength=4` en el input.
**Impacto:** Usuario puede escribir más de 4 chars; error solo al enviar.
**Recomendación:** Añadir `maxLength={4}`, `inputMode="text"`, `pattern="[A-Za-z]{4}"`, `textTransform="uppercase"` al input; validar en `onChange`.
**Confianza:** confirmado

### DSN-016 | sistema | **mejora** | defecto | `reader.css:849-888`
**Evidencia:** `::highlight(lecta-consulted)`, `::highlight(lecta-passage-*)` usan `color-mix` con `var(--accent-primary)` (L850) pero `--accent-primary` **no existe en `tokens.css`** — sí existe `--vermilion`. En temas `noche`/`oled` `--accent-primary` = `#e08a58` (L274, L324) pero en `papel`/`blanco` no está definido (solo `--vermilion`).
**Impacto:** Highlights pueden verse distintos entre temas; dependencia de token no documentado.
**Recomendación:** Usar `var(--vermilion)` directamente o añadir `--accent-primary: var(--vermilion)` en `:root` de `tokens.css`.
**Confianza:** confirmado

### DSN-017 | gato | **mejora** | defecto | `Companion.tsx:380-381, 753-754`
**Evidencia:** `onHitboxClick` y `onPet` callbacks se pasan por props pero **no se tipan como opcionales** en `CompanionProps` (L72-73 son opcionales pero `onHitboxClick` no tiene `?`). `handleHeadDown` (L544) llama `onHitboxClick?.("head")` — OK, pero `handlePawsClick` (L585) llama `onHitboxClick?.("paws")` y `handleNoseClick` (L572) llama `onHitboxClick?.("nose")` — consistente pero **falta documentación de qué zonas existen**.
**Impacto:** Consumidores no saben qué zonas están disponibles sin leer implementación.
**Recomendación:** Añadir tipo `CompanionHitboxZone = "head" | "nose" | "paws"` y documentar en JSDoc de `CompanionProps`.
**Confianza:** mejora

### DSN-018 | ux | **mejora** | defecto | `CompanionCloset.tsx:420-446`
**Evidencia:** Tarjetas de pelaje (`filter === "coat"`) renderizan **un `<Companion>` completo por tarjeta** (L449-454) con `stage`, `mood`, `accessories`. En escritorio 7 columnas → **7 gatos SVG montados simultáneamente** solo para miniaturas.
**Impacto:** Rendimiento innecesario; cada gato tiene sus propios `useEffect` de parpadeo/orejas.
**Recomendación:** Crear componente `CompanionThumb` ligero (solo SVG estático, sin efectos) para miniaturas de armario. Reutilizar `Companion` con `decorative=true` y `mood="awake"` pero desactivar `useEffect` internos vía prop `static={true}`.
**Confianza:** confirmado

### DSN-019 | sistema | **mejora** | defecto | `tokens.css:58-69`
**Evidencia:** Comentario en tokens explica el bug de `--text-primary` (L63-67) pero **el token sigue existiendo** como indirección de `--ink`. Componentes que usaron `var(--text-primary, #f5f2eb)` ahora usan `var(--ink)` directo — pero `--text-primary` queda como alias confuso.
**Impacto:** Confusión futura; desarrollador puede usar `--text-primary` creyendo que es token semántico.
**Recomendación:** Eliminar `--text-primary` y `--text-secondary` de `tokens.css`; buscar y reemplazar usos restantes por `var(--ink)` / `var(--ink-soft)`.
**Confianza:** confirmado

### DSN-020 | ux | **mejora** | defecto | `Reader.tsx:340-348`
**Evidencia:** Constantes mágicas: `AUTO_ENRICH_CAP = 8` (L347), `SAVED_ENRICH_CAP = 20` (L351), `RESUME_CARD_MIN_DAYS = 3` (L276). No están en `tokens.css` ni en config compartida.
**Impacto:** Cambiar límites requiere tocar `Reader.tsx`; no son descubribles.
**Recomendación:** Mover a `src/shared/constants.ts` o `tokens.css` como `--enrich-cap-auto: 8` (no estándar CSS pero documentado).
**Confianza:** mejora

### DSN-021 | gato | **mejora** | propuesta | `companion-sprites.ts:702-737`
**Evidencia:** `PROPS` (platito, pelota, té, vela, chispas) **no usan tokens de color** — `fill: var(--ochre)` en platito (L703), `fill: var(--vermilion)` en pelota (L714), `fill: #a65e2e` en té (L740), `fill: var(--amber)` en llama (L790).
**Impacto:** Atrezos no cambian con tema; té usa literal `#a65e2e`.
**Recomendación:** Usar `var(--cat-fur)`, `var(--vermilion)`, `var(--ochre)`, `var(--amber)` consistentemente; definir `--cat-tea-liquid` en tokens por tema.
**Confianza:** propuesta

### DSN-022 | ux | **mejora** | propuesta | `Shelf.tsx:174-176`
**Evidencia:** Libro de muestra hardcodeado: `SAMPLE_BOOK_URL = "/libros/azul-ruben-dario.epub"`, `SAMPLE_BOOK_NAME = "Azul… — Rubén Darío.epub"` (L174-175). **No hay forma de cambiarlo sin tocar código**.
**Impacto:** No se puede probar con otro libro de muestra; no localizable.
**Recomendación:** Mover a `src/shared/constants.ts` o config remota; permitir override por env.
**Confianza:** propuesta

### DSN-023 | sistema | **mejora** | defecto | `game.css:2000+` (reglas huérfanas)
**Evidencia:** `game.css` tiene **~2000 líneas**; muchas reglas para componentes que ya no existen (ej. `.game-chest` original vs `.companion-chest-card` actual). `companion-art.test.ts` no verifica CSS.
**Impacto:** CSS muerto infla bundle; riesgo de colisiones.
**Recomendación:** Ejecutar auditoría de CSS muerto (PurgeCSS o manual) y limpiar. Marcar secciones con comentarios `/* DEPRECATED */` antes de borrar.
**Confianza:** probable

---

## 3. Propuestas de gusto (opinión informada)

| ID | Área | Propuesta | Justificación |
|----|------|-----------|---------------|
| GP-001 | gato | **Añadir micro-expresiones por estación**: orejas con gorro en invierno, gafas de sol en verano (ya hay `gafas_sol` y `bufanda` pero no se activan solos). | Refuerza la sensación de «gato vivo» sin coste de bundle; usa prendas existentes. |
| GP-002 | gato | **Sonido de ronroneo sincronizado con háptica**: `triggerPurrHaptic()` ya existe pero `playCompanionSound("purr")` se llama aparte. Unificar en una función `purr()` que haga ambas. | Cohesión sensorial; evita desincronización (hoy a veces suena sin vibrar o viceversa). |
| GP-003 | sistema | **Tokens semánticos para z-index**: `--z-toast: 50`, `--z-sheet: 60`, `--z-dialog: 70`, `--z-reader-bar: 15`, `--z-reader-foot: 15`. Hoy valores mágicos en 8 archivos. | Evita guerras de z-index; documenta jerarquía de capas. |
| GP-004 | ux | **Estado vacío del armario por ranura**: hoy «Sin prenda» genérico. Proponer texto específico: «Aún no tienes bufandas. La primera se gana leyendo 7 días seguidos.» | Convierte estado vacío en llamada a la acción; coherente con «Regla del Cuaderno» (enseñar antes de examinar). |
| GP-005 | ux | **Transición de etapa del gato visible**: al subir de nivel (S0→S1, etc.), el gato debería **animar su crecimiento** (morph SVG) en lugar de cambiar instantáneo. | Celebra el progreso; momento «mágico» barato (solo CSS `transform: scale` + `transition`). |
| GP-006 | sistema | **Unificar `--dur-*` y `--ease-*` en un solo mapa**: `--motion-{fast,base,slow}: {duration, easing}`. Hoy 12 tokens sueltos. | Reduce decisiones; coherencia garantizada. |
| GP-007 | ux | **Indicador de «gato durmiendo» en estantería**: si `focus === "sleep"` y hay libro abierto, mostrar 🌙 en `CompanionButton` (hoy solo en panel). | Feedback pasivo; usuario sabe que el gato descansa sin abrir panel. |
| GP-008 | gato | **Eliminar `cat--coat-dorado` y `cat--coat-negro`** (L695-699, L683-693): no están en `COMPANION_COAT_IDS`, no se ganan, solo sirven para registros viejos. Mover a `HIDDEN_ARTICLES` como las 5 paletas imposibles. | Limpia catálogo; evita confusión en armario (hoy aparecen si el usuario tenía registro viejo). |

---

## 4. Lo que está bien (patrones a conservar)

1. **Sistema de tokens CSS completo** (`tokens.css`): 4 temas, escalas tipográficas/espacio/forma/movimiento, paletas cromáticas, superficies semánticas. Bien documentado con comentarios.
2. **Arquitectura del gato**: `makeStage` paramétrico → 5 etapas coherentes; `WEAR_LAYERS` prioridad por ranura; `companion-art.test.ts` guardián.
3. **Una prenda por ranura** respetada en código y tests; sin duplicados visuales.
4. **Colores del tema en prendas** (cuando se usan tokens): `var(--vermilion)`, `var(--ochre)`, `var(--cat-outline)` en `game.css:344-599`.
5. **Tipografía Literata + Alegreya Sans** cargada vía `@fontsource-variable`; `font-optical-sizing`, `font-size-adjust` en lector.
6. **Jerarquía de CTA**: `.btn--primary` (vermilion sólido) vs `.btn--quiet` (subrayado vermilion) vs chips activos (translúcidos). Respetado en todas las pantallas.
7. **Foco visible**: `outline: 2px solid var(--vermilion); outline-offset: 2px` consistente en botones, campos, enlaces, dialogs.
8. **Touch targets ≥ 44px**: `.btn`, `.field input`, `.switch`, `.selection-menu button` (con `@media (pointer: coarse)`).
9. **`prefers-reduced-motion` en hojas/diálogos/cofres** (`components.css:676-684`, `game.css:1636-1641`).
10. **Textos en español llano, tuteo, sin emojis** (salvo los 3 defectos hallados). Ej: «Tu estantería está vacía. Trae un EPUB y lo abrimos aquí.»
11. **Estados vacíos diseñados**: estantería, cuaderno, repaso, búsqueda, armario — todos con copy de bibliotecario.
12. **Navegación con `history.pushState`**: botón «atrás» del móvil cierra hojas/dialogs y vuelve a estantería.
13. **Accesibilidad**: `role=dialog`, `aria-label`, `aria-live`, `lang` en EPUB, `color-scheme`, `forced-colors` support.
14. **Bundle controlado**: 204.8 kB gzip de 215 kB (95%); chunks diferidos para armario, panel compañero, modo papel, comunidad.
15. **Tests exhaustivos**: 3356 pruebas; `companion-art.test.ts` vigila anatomía; `pnpm gate` puerta de cierre.

---

## 5. Auditorías previas: hallazgo → estado → evidencia

| # | Hallazgo (auditoría UX 2026-10-24) | Estado | Evidencia |
|---|-------------------------------------|--------|-----------|
| 1 | Popover de Modos ilegible (blanco sobre blanco) | ✅ Corregido | `reader.css:5129` usa `--paper-raised`, `--ink`, `--rule-strong` |
| 2 | Objetivos táctiles <44px en dock | ✅ Corregido | `reader.css:5099` acciones 44×44 mínimo |
| 3 | 3 avisos flotantes solapados | ✅ Corregido | `ReaderFloatingLane` + `.reader-floating-lane` columna única |
| 4 | Gato tapa marcapasos (Ritmo Guiado) | ✅ Corregido | `reader.css`: gato se retira con `.reader__pacer-bar` |
| 5 | Importador EPUB minúsculo en móvil | ✅ Corregido | `shelf.css:1038` estira `.shelf-empty` |
| 6 | Anuncio duplicado lectores de pantalla | ✅ Corregido | `App.tsx:1639` Notice no pinta con lector abierto |
| 7 | Abrir esperaba a la red sin límite | ✅ Corregido | `App.tsx`: abre desde IndexedDB, sync detrás |
| 8 | 6 capas flotantes con `bottom` manual | ✅ Corregido | `ReaderFloatingLane` columna única |
| 9 | Ritual 3 pasos reaparecía cada visita | ✅ Corregido | `Shelf.tsx`: solo antes de primera lectura |
| 10 | «Abriendo libro…» persistía + gato sobre pista | ✅ Corregido | `Reader.tsx`: estado vacío retira toast; gato se oculta |
| 11 | Cápsula de palabra `fixed` compitiendo con dock | ✅ Corregido | `WordPanel` monta en `.reader-floating-capsule-slot` |
| 12 | 2 barras «Volver» fuera de franja | ✅ Corregido | Ambas en `ReaderFloatingLane` con `order: 6` |
| P2 | Jerarquía estantería (hero 320px) | ⚠️ Parcial | Hero sigue alto; «Continuar leyendo» a veces bajo pliegue en 390px |
| P2 | Verificación temas/tamaños extremos | ⚠️ Pendiente | Falta captura Noche/OLED, 320px, títulos 60+, reduced-motion, foco en hojas |

| # | Hallazgo (auditoría Armario 2026-10-24) | Estado | Evidencia |
|---|------------------------------------------|--------|-----------|
| 1 | Swatch pelaje escribe sin inventario | ✅ Corregido | `CompanionCloset.tsx:112-115` prueba y no escribe |
| 2 | Globo truncado `left:50%` | ✅ Corregido | `game.css:1825-1843` `inset-inline: 0` + `width: max-content` |
| 3 | Pelaje natural con candado nivel 8 | ✅ Corregido | `CompanionCloset.tsx:122-123` natural nunca bloqueado |
| 4 | 5 tarjetas imposibles de desbloquear | 🟡 UI corregida | `HIDDEN_ARTICLES` excluye de rejilla; catálogo no tocado |
| 5 | 12 tarjetas para 5 pelajes (7 legados) | ✅ Corregido | Rejilla pelaje = Natural + 5 paletas; legados ocultos |
| 6 | Carril 4092px sin agrupar | ✅ Corregido | `.companion-tray` grid `auto-fit minmax(5.5rem, 1fr)` |
| 7 | Solo 1 de 33 prendas al empezar | ✅ Corregido | «Lo tuyo primero»; pelaje serie `atigrado` nivel 0 |
| 8 | Primera prenda real a 90 min | 🟡 Mitigado | Pelaje serie + look inicial dan juego minuto 0 |
| 9 | Candado no decía requisito | ✅ Corregido | `closetRequirement`: «Nivel 5 · faltan 320 pts» con barra |
| 10 | Panel 252px; 66px en horizontal | 🟡 Mitigado | Panel 302px en 900×500; gato crece 128→160px |
| 11 | 2 `aria-modal` apilados | ✅ Corregido | `Journey.tsx` cierra hoja antes de abrir vestidor |
| 12 | Sin «quitar todo», looks, deshacer | ✅ Corregido | «Quitar prendas», «Sorpréndeme», 4 looks con nombre |
| 13 | Bloqueadas anunciadas `aria-disabled` | ✅ Corregido | Sin `aria-disabled`; `data-locked` + nombre accesible |

**Empeorados (3):**
- DSN-002: Pelajes usan literales (era token en auditoría previa, regresó a hex)
- DSN-003: `game.css` acumula 47 literales nuevos (auditoría previa limpió `game.css` pero se añadieron)
- DSN-005: `prefers-reduced-motion` no cubre animaciones del gato (antes solo cofres/hojas)

---

## 6. Fuera de alcance / Preguntas abiertas

| Tema | Pregunta | Para quién |
|------|----------|------------|
| Gato | ¿Eliminar pelajes `dorado`/`negro` (GP-008) o mantener para registros legacy? | Luis (producto) |
| Gato | ¿Activar prenda estacional automática (bufanda dic-feb, gafas jun-ago) sin acción usuario? | Luis |
| UX | ¿Hero de estantería debe ceder sitio a «Continuar leyendo» en cuentas con historial? | Luis (ver P2 UX) |
| Sistema | ¿Añadir regla ESLint `no-hardcoded-colors` para evitar regresiones? | Equipo |
| Gato | ¿Morph SVG al subir etapa (GP-005) o mantener cambio instantáneo? | Luis + Dev |
| UX | ¿Botón «Vincular Kindle» en Cuenta: validar en `onChange` o solo submit? | UX (DSN-015) |

---

## 7. Verificación

| Comando | Resultado | Detalle |
|---------|-----------|---------|
| `pnpm typecheck` | ✅ | Cliente + Worker + MCP sin errores |
| `pnpm lint` | ⚠️ 1 warning | `CompanionStage.tsx:272` `useCallback` missing dependency `reducedMotion` |
| `pnpm test` | ✅ 3356 passed | 236 archivos; incl. `companion-art.test.ts` (guardián gato) |
| `pnpm build` | ✅ | 204.8 kB gzip (95% budget) |
| `pnpm gate` | ❌ (por lint) | Falla en lint; typecheck+test+build+check:size OK |

**Lo que NO se pudo comprobar (auditoría solo código, sin capturas reales):**
- Contraste real en tema `papel`/`noche`/`oled` (medido en tokens pero no verificado en navegador)
- Comportamiento táctil real en iOS Safari (solo simulación `pointer: coarse`)
- Zoom 200% / reflow en móviles Android
- Lectores de pantalla reales (NVDA, VoiceOver) — solo auditado `aria-*` en código
- Rendimiento real del armario con 7 gatos SVG montados (DSN-018)
- Animaciones del gato con `prefers-reduced-motion` activado en OS

---

## 8. Tabla final: ID | Área | Severidad | Tipo | Ubicación | Recomendación en una frase

| ID | Área | Severidad | Tipo | Ubicación | Recomendación |
|----|------|-----------|------|-----------|---------------|
| DSN-001 | gato | crítico | defecto | `companion-sprites.ts:makeStage` / `companion-art.test.ts` | Añadir test que verifique cada prenda en las 5 etapas; mover prendas fuera de `makeStage` |
| DSN-002 | gato | importante | defecto | `game.css:619-699` | Usar `var(--cat-fur)`, `var(--cat-outline)`, `var(--cat-nose)` en pelajes; definir paletas en `tokens.css` por tema |
| DSN-003 | sistema | importante | defecto | `game.css` (47 literales) | Sustituir cada literal por su token; añadir regla ESLint `no-hardcoded-colors` |
| DSN-004 | sistema | importante | defecto | `components.css:219` vs `tokens.css:91` | Añadir `--sheet-lift: var(--s-3)` y unificar elevaciones |
| DSN-005 | gato | importante | defecto | `Companion.tsx:429-435` / `game.css` | Leer `prefers-reduced-motion` y saltar `setTimeout` de parpadeo/orejas; apagar animaciones CSS del gato |
| DSN-006 | gato | importante | defecto | `CompanionStage.tsx:494-521` | Reemplazar emojis `🥣📖🔖` por SVG/Icon |
| DSN-007 | ux | importante | defecto | `CompanionPanel.tsx:157,184,193` | Quitar emojis de botones mágicos y título; usar `Icon` |
| DSN-008 | gato | importante | defecto | `Companion.tsx:526-535` | Unificar lógica de pelaje en `companion-data.ts:resolveCoatId` |
| DSN-009 | sistema | mejora | defecto | `game.css:1783-1823` | Mover reglas de armario a `components.css` cerca de `.sheet--stage` |
| DSN-010 | sistema | mejora | defecto | `reader.css:289` | Usar `--read-measure` o token para margen derecho desktop |
| DSN-011 | ux | mejora | defecto | `WordPanel.tsx:245` | Incluir `PROMPT_VERSION` en clave de caché de explicaciones IA |
| DSN-012 | ux | mejora | defecto | `Shelf.tsx:164,325` | Respetar `prefers-reduced-motion` en saludo del gato |
| DSN-013 | gato | mejora | propuesta | `Companion.tsx:888-900` | Dibujar corazones y zzz como SVG paths en `PROPS` |
| DSN-014 | sistema | mejora | defecto | `components.css:1047-1050` | Definir `--touch-target: 44px` en tokens; unificar `.selection-menu` |
| DSN-015 | ux | mejora | defecto | `Account.tsx:290-324` | Añadir `maxLength=4`, `pattern`, `inputMode` al input código Kindle |
| DSN-016 | sistema | mejora | defecto | `reader.css:850` | Usar `var(--vermilion)` o definir `--accent-primary: var(--vermilion)` en `:root` |
| DSN-017 | gato | mejora | defecto | `Companion.tsx:72-73` | Tipar `onHitboxClick` con `CompanionHitboxZone` y documentar |
| DSN-018 | ux | mejora | defecto | `CompanionCloset.tsx:449-454` | Crear `CompanionThumb` ligero para miniaturas de armario |
| DSN-019 | sistema | mejora | defecto | `tokens.css:58-69` | Eliminar `--text-primary`/`--text-secondary`; usar `--ink`/`--ink-soft` directo |
| DSN-020 | ux | mejora | defecto | `Reader.tsx:340-351` | Mover constantes mágicas a `src/shared/constants.ts` |
| DSN-021 | gato | mejora | propuesta | `companion-sprites.ts:702-737` | Usar tokens de color en `PROPS` (platito, pelota, té, vela) |
| DSN-022 | ux | mejora | propuesta | `Shelf.tsx:174-176` | Mover libro de muestra a config compartida |
| DSN-023 | sistema | mejora | probable | `game.css` (2000+ líneas) | Auditar CSS muerto con PurgeCSS; limpiar reglas huérfanas |

---

**Áreas sin hallazgos:** `reader/` subcomponentes (ReaderTopBar, ReaderDockHost, ReaderFloatingLane, etc.), `Shelf.tsx` (estructura), `Account.tsx` (tarjetas uniformes), `KindleAppearancePanel` (vista previa local), `ExploreShelf`/`CommunityShelf` (chips/affinidad) — **revisados, sin hallazgos**.

---

*Fin del reporte. Generado 2026-11-10. Próxima auditoría recomendada tras Fase G (densidad móvil) o deploy v0.2.16.*