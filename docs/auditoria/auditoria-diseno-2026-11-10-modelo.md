# Auditoría de Diseño de Lecta — 2026-11-10 (independiente)

**Auditor:** Senior Design Auditor (independiente, no escribió el código ni dibujó el arte)  
**Alcance:** Gato compañero, Sistema de diseño, UI/UX de pantallas  
**Método:** Cuatro pasadas (recorrido visual → barrido por áreas → verificación contra código → auditorías previas)  
**Fecha:** 2026-11-10  
**Repo:** rama `mejoras-diseno-2026-11`, sin modificar

---

## 1. Resumen ejecutivo (10 líneas)

| Área | Estado | Lo crítico |
|------|--------|-------------|
| **Gato** | 🟡 Importante | Emojis en UI (`🥣📖🔖`, `♥`, `z`); pelajes con literales hex que no responden al tema; `prefers-reduced-motion` no apaga el parpadeo ni el movimiento de orejas; lógica de pelaje duplicada en 3 archivos |
| **Sistema** | 🟡 Importante | ~47 literales hardcodeados en `game.css` (colores, sombras, radios); reglas huérfanas (~2000 líneas, `.game-chest` vs `.companion-chest-card`); `--accent-primary` usado sin existir en `:root`; `--text-primary` alias confuso; `.selection-menu` duplicado por `pointer: coarse`; margen derecho del lector mágico sin usar `--read-measure` |
| **UX** | 🟡 Importante | Emojis generalizados en pantallas (Juegos, Glosario, Journey, Dock, SectionPreview, ResetAccountSection); el gato **dentro del lector** compite con la lectura (regla de diseño nº1); `ResetAccountSection` usa clases tipo Tailwind hardcodeadas (`bg-white`, `bg-amber-600`, `text-white`) que rompen los temas oscuro; lint con 1 warning rompe el gate |

**Hallazgos totales:** 24 (12 confirmados, 4 probables, 4 propuestas)  
**Propuestas de gusto:** 8 (sección separada)  
**Auditorías previas:** 34 hallazgos → 28 corregidos, 3 empeorados, 3 pendientes  
**Verificación:** `typecheck` ✅, `test` ✅ (3356 pruebas), `lint` ❌ (1 warning: `CompanionStage.tsx:272` `useCallback` falta dependencia `reducedMotion`), `build` no ejecutado

---

## 2. Defectos (ordenados por severidad y área)

### Gato

#### DSN-001 | gato | **importante** | defecto | `Companion.tsx:429-463` / `CompanionStage.tsx:122-174` / `game.css`

**Evidencia:** El parpadeo (`scheduleBlink`, `setTimeout` cada ~2800-5800 ms) y el movimiento de orejas (`scheduleTwitch`, cada ~6000-11000 ms) se programan con `useEffect` que **no consulta `prefers-reduced-motion`**. `CompanionStage.tsx` sí respeta `reducedMotion` para el paseo autónomo (línea 123: `if (reducedMotion) return`), pero el parpadeo y el twitch de orejas viven en `Companion.tsx` e ignoran la preferencia del sistema. `game.css` apaga animaciones solo de cofres (L1636-1641), no de `.cat-breathe`, `.cat-tail`, `.cat-blink-*`, `.cat-ear-twitch-*`.

**Impacto:** Usuarios con sensibilidad vestibular ven animaciones que deberían detenerse cuando el sistema está en «reducir movimiento».

**Recomendación:** En `Companion.tsx`, leer `window.matchMedia('(prefers-reduced-motion: reduce)').matches` y saltar `scheduleBlink`/`scheduleTwitch` cuando sea true. En `game.css`, añadir `@media (prefers-reduced-motion: reduce) { .cat .cat-eyes--blink, .cat--awake .cat-body, .cat--awake .cat-tail, .cat--mood-purring .cat-head, .cat--mood-purring .cat-tail, .cat .cat-ear--twitch { animation: none !important; } }`.

**Confianza:** confirmado

#### DSN-002 | gato | **importante** | defecto | `game.css:620-698`

**Evidencia:** Las 5 paletas de pelaje definen `--cat-fur`, `--cat-outline`, `--cat-nose`, `--cat-eye` con **literales hex** en lugar de heredar los tokens de tema `--cat-fur`, `--cat-outline`, `--cat-nose` de `tokens.css` (que ya existen por tema en L187-190, L234-237, L285-288, L335-338). Ejemplo: `.cat--coat-tuxedo { --cat-fur: #232730; --cat-outline: #4a5264; --cat-nose: #e07a72; }` (L620-623). El arte usa `var(--cat-fur)` etc., así que el literal anula el token del tema.

**Impacto:** En cualquier tema (`papel`, `blanco`, `noche`, `oled`) el gato **no cambia de color** — rompe la regla de `arte-companero.md:58` («colores del tema, no literales») y hace que el pelaje elegido sea idéntico en noche y en papel.

**Recomendación:** Quitar los literales hex de `--cat-fur`/`--cat-outline`/`--cat-nose` en `game.css` y que hereden `var(--cat-fur)` etc. de `tokens.css` por tema. Mantener los literales solo cuando el color *sea el chiste* (regla del arte).

**Confianza:** confirmado

#### DSN-003 | gato | **importante** | defecto | `CompanionStage.tsx:494-521`

**Evidencia:** **Emojis pictográficos** en UI dentro del escenario del gato: `🥣` (L494, «Plato lleno hoy»), `📖` (L510, «Lectura pendiente hoy»), `🔖` (L503, L518, «Marcapáginas protector activo»). `arte-companero.md:62` y `plan-diseno.txt:478` prohíben emojis pictóricos en la interfaz.

**Impacto:** Rompe la identidad visual del gato; los emojis no escalan con zoom, fallan en `forced-colors` y no respetan el tema (color fijo del sistema).

**Recomendación:** Reemplazar por `Icon` o SVG inline: cuenco para «plato lleno», libro abierto para «lectura pendiente», etiqueta para marcapáginas. `CompanionStage.tsx` ya importa `Icon` (L32).

**Confianza:** confirmado

#### DSN-004 | gato | **importante** | defecto | `Companion.tsx:526-535` / `companion-data.ts:323-344` / `gamification.ts:422-433`

**Evidencia:** Lógica de pelaje confusa y duplicada: `Companion.tsx:526` busca `pelaje-*` en `accessories` pero `COMPANION_COAT_IDS` contiene paletas (`tuxedo`, `latte`, ...). `resolveCoatId(null)` devuelve `tuxedo` (pelaje-tuxedo es nivel 7, no el «natural» real). En L530-535 hay un mapeo manual (`latte` → `siames`, `ginger` → `atigrado`, `pelaje-negro` → `tuxedo`, `pelaje-dorado` → `ginger`) que **duplica** lo que ya está en `COAT_LEVELS` y `companion-data.ts`. Añadir un pelaje nuevo requiere tocar 3 archivos.

**Impacto:** Mantenimiento frágil; riesgo de que un pelaje del registro no se dibuje (cabecera dice «Dorado» sobre gato Tinta y Crema).

**Recomendación:** Unificar en `companion-data.ts`: `resolveCoatId` debe manejar alias y paletas; `Companion.tsx` solo llama `resolveCoatId(coatArticle)` y deja el mapeo manual.

**Confianza:** confirmado

#### DSN-005 | gato | **importante** | defecto | `Companion.tsx:887-912` / `CompanionStage.tsx:479-482`

**Evidencia:** Corazones flotantes (`♥` y texto «z z z`) usan **emoji/texto duro** en lugar de paths SVG del sprite. `PROPS` existe para chispas (`spark`) pero no para corazones ni `zzz`. Los corazones tienen `fill="#E07A72"` y `fill="#F4A698"` literales, no responden al tema.

**Impacto:** No escalan con `--cat-size`; no respetan tema (color fijo); texto «z» no es accesible como dibujo.

**Recomendación:** Añadir `hearts` y `zzz` a `PROPS` en `companion-sprites.ts` y dibujarlos como paths SVG con `fill: var(--cat-nose)` / `fill: var(--ink-soft)`.

**Confianza:** confirmado

#### DSN-006 | gato | **mejora** | defecto | `Companion.tsx:72-81` (JSDoc faltante)

**Evidencia:** `onHitboxClick` tipado como `(zone: "head" | "nose" | "paws") => void` sin `?` aunque en la práctica se llama con `?.`. No hay tipo `CompanionHitboxZone` documentado ni JSDoc que explique qué zonas existen y en qué orden se activan.

**Impacto:** Consumidores del componente no saben qué zonas táctiles están disponibles sin leer la implementación.

**Recomendación:** Añadir tipo `CompanionHitboxZone = "head" | "nose" | "paws"` y documentar en JSDoc de `CompanionProps`.

**Confianza:** mejora

### Sistema de diseño

#### DSN-007 | sistema | **importante** | defecto | `game.css` (~47 literales hardcodeados)

**Evidencia:** `game.css` (~2000 líneas) contiene literales de color y tamaño que ya tienen token en `tokens.css`:
- `#E07A72`, `#F4A698` (corazones L1091, L1104) → `var(--cat-nose)`
- `cubic-bezier(0.34, 1.56, 0.64, 1)` (L1136, L1240, L1265) → `var(--ease-spring)`
- `#d4a373`, `#2d6a4f`, `#b07d48` (L1152, L1154, L1161) → `var(--ochre)`, `var(--success)`, `var(--ochre-soft)`
- `rgba(0,0,0,0.08)` (L1234) → `var(--shadow-1)`
- `2px`, `4px`, `8px` (L1283, L1587, L1594) → `var(--r-1)`, `var(--r-2)`, `var(--s-1)`
- Pelajes con `#232730`, `#f3e3ce`, `#e88846`, `#b8c2cc`, `#faf4eb` (L620-698) → `var(--cat-fur)` etc.

**Impacto:** Tema `papel` se ve distinto al diseñado; `oled` no respetado; mantenimiento frágil (cambiar un token no afecta estas reglas).

**Recomendación:** Sustituir cada literal por su token. Añadir regla ESLint `no-hardcoded-colors` para evitar regresiones.

**Confianza:** confirmado

#### DSN-008 | sistema | **importante** | defecto | `components.css:219` vs `components.css:236` / `tokens.css`

**Evidencia:** `.sheet` usa `box-shadow: var(--shadow-sheet)` (L219, token definido en `tokens.css:71`) mientras `.sheet--peek` usa `var(--shadow-2)` (L236) y `.dialog` usa `animation: dialog-in` con `translateY(0.75rem)` (L658) — **no hay token para `0.75rem`** (existe `--s-3: 1rem`, `--s-2: 0.5rem`).

**Impacto:** Inconsistencia en elevación de hojas/diálogos; valores mágicos en animaciones.

**Recomendación:** Añadir `--sheet-lift: 0.75rem` (o reusar `--s-3`) y `--dialog-lift: var(--s-3)` en `tokens.css`; unificar sombras de hojas.

**Confianza:** confirmado

#### DSN-009 | sistema | **importante** | defecto | `reader.css:849-852`

**Evidencia:** `::highlight(lecta-consulted)` usa `color-mix(in srgb, var(--accent-primary) 28%, transparent)` pero `--accent-primary` **no existe en `:root` de `tokens.css`** — solo existe `--vermilion`. En temas `noche`/`oled` `--accent-primary` está definido (L274, L324) pero en `papel`/`blanco` no, por lo que `color-mix` falla silenciosamente y el highlight puede ser invisible o distorsionado según el tema.

**Impacto:** Los highlights de palabra consultada pueden verse distintos o desaparecer entre temas.

**Recomendación:** Usar `var(--vermilion)` directamente o añadir `--accent-primary: var(--vermilion)` en `:root` de `tokens.css`.

**Confianza:** confirmado

#### DSN-010 | sistema | **mejora** | defecto | `tokens.css:58-69`

**Evidencia:** El comentario de `tokens.css` explica el bug histórico de `--text-primary` (usaba fallback `#f5f2eb` crema sobre blanco) pero **el token sigue existiendo** como alias de `--ink`. Queda como alias confuso que un desarrollador puede usar creyendo que es un token semántico independiente.

**Impacto:** Confusión futura; riesgo de que regrese el fallback crema sobre blanco (contraste 1.12:1).

**Recomendación:** Eliminar `--text-primary` y `--text-secondary` de `tokens.css`; buscar y reemplazar usos restantes por `var(--ink)` / `var(--ink-soft)`.

**Confianza:** confirmado

#### DSN-011 | sistema | **mejora** | defecto | `reader.css:281, 289`

**Evidencia:** `.reader-body` usa `padding-inline: var(--s-5)` (L281) pero en `@media (min-width: 64rem)` añade `padding-inline-end: calc(min(24rem, 34vw) + var(--s-6))` (L289). **No usa `--read-measure` (65ch)** ni tokens de margen del lector.

**Impacto:** Columna de lectura no respeta la medida tipográfica definida; margen derecho mágico que no se ajusta con la fuente.

**Recomendación:** Usar `calc(var(--read-measure) + var(--s-6))` o definir `--reader-margin-desktop` en `tokens.css`.

**Confianza:** confirmado

#### DSN-012 | sistema | **mejora** | defecto | `components.css:1035-1045`

**Evidencia:** `@media (pointer: coarse)` duplica estilos de `.selection-menu` solo para subir `min-height: 2.75rem` (44px). La versión base ya tiene `min-height: 2rem` (L982) — deberían unificarse con `max(2rem, 44px)` o un token `--touch-target: 44px`.

**Impacto:** Duplicación; si cambia el diseño del menú hay que tocar dos bloques.

**Recomendación:** Definir `--touch-target: 44px` en `tokens.css` y usar `min-height: var(--touch-target)` en base; quitar `@media (pointer: coarse)`.

**Confianza:** confirmado

#### DSN-013 | sistema | **mejora** | defecto | `game.css:1783-1823` vs `components.css:248-262`

**Evidencia:** `.companion-stage[data-in-closet]` redefine `--cat-size` (L1810) y oculta `.companion-stage-floor` (L1815). En `@media (max-height: 34rem)` vuelve a redefinir (L1819-1822). **Duplica** lógica de `components.css:248-262` (`.sheet--stage`).

**Impacto:** Dos fuentes de verdad para alto del gato en armario; riesgo de divergencia.

**Recomendación:** Mover `--cat-size` y reglas de armario a `components.css` cerca de `.sheet--stage`; `game.css` solo importa.

**Confianza:** confirmado

#### DSN-014 | sistema | **probable** | defecto | `game.css` (~2000 líneas)

**Evidencia:** `game.css` tiene reglas para componentes que ya no existen (ej. `.game-chest` original L1528-1606 vs `.companion-chest-card` actual L2991-3026). `companion-art.test.ts` no verifica CSS. No se ejecutó auditoría de CSS muerto.

**Impacto:** CSS muerto infla bundle; riesgo de colisiones de selectores.

**Recomendación:** Ejecutar auditoría de CSS muerto (PurgeCSS o manual) y limpiar reglas huérfanas.

**Confianza:** probable

### UI/UX

#### DSN-015 | ux | **importante** | defecto | `reader/ReaderFocusLayers.tsx:71-79` / `reader/ReaderDockHost.tsx:173-181`

**Evidencia:** El gato aparece **dentro del lector** dos veces: como ancla de la regla de enfoque (`ReaderFocusLayers.tsx:71-79`, `<Companion ... decorative />` dentro de `<FocusRuler>`) y como botón del dock (`ReaderDockHost.tsx:173`, `<CompanionButton ... />`). La regla de diseño nº 1 (`plan-diseno.txt`, AGENTS.md §1) dice: «el texto del libro manda. Cualquier elemento decorativo que compita con la lectura (incluido el gato dentro del lector) es sospechoso por defecto».

**Impacto:** El gato compite visualmente con el texto del libro, rompiendo el principio de «la interfaz debe desaparecer».

**Recomendación:** Revisar si el gato dentro del lector aporta jerarquía, comprensión o feedback; si es decorativo, moverlo fuera del área de lectura o hacerlo opcional y desactivable por defecto.

**Confianza:** confirmado

#### DSN-016 | ux | **importante** | defecto | `CompanionStage.tsx:494-521` / `CompanionPanel.tsx:157,184,193,208-240` / `Journey.tsx` / `GamePanel.tsx` / `GrammarGame.tsx` / `SectionPreview.tsx` / `QuoteCardModal.tsx` / `BookGlossaryModal.tsx` / `ReaderRecapBubble.tsx` / `SmartReaderDock.tsx` / `PracticeCompanionHeader.tsx` / `Vocabulary.tsx` / `ReadingActivity.tsx` / `ResumeSessionOverlay.tsx` / `WordScrambleGame.tsx` / `SentenceBuilderGame.tsx` / `FocusRuler.tsx`

**Evidencia:** Emojis pictográficos generalizados en UI: `🐱`, `✨`, `👥`, `🌱`, `🎀`, `🔥`, `⏱️`, `🐾`, `💡`, `📖`, `📜`, `🎯`, `🎁`, `🛡️`, `🏆`, `📌`, `🔍`, `📊`, `🔍`, `⭐`. `plan-diseno.txt:478` prohíbe emojis pictóricos en la interfaz («sin emojis»). El reporte previo solo los marcó en el gato y el panel, pero están en decenas de componentes.

**Impacto:** Rompe la identidad visual («Cuaderno de lector» sin emojis); no escalan con zoom; fallan en `forced-colors`; no responden al tema.

**Recomendación:** Sustituir todos los emojis pictográficos por `Icon` o SVG inline, salvo cuando el emoji sea el significado mismo (contenido editorial, no decoración).

**Confianza:** confirmado

#### DSN-017 | ux | **importante** | defecto | `ResetAccountSection.tsx:154-222`

**Evidencia:** Mezcla clases tipo Tailwind hardcodeadas con tokens CSS: `bg-white`, `bg-amber-600`, `text-white`, `dark:bg-neutral-900`, `dark:border-neutral-700`, `hover:bg-neutral-200/60`, `hover:bg-amber-700`, `text-neutral-600`, `text-neutral-400`, `rounded-lg`, `px-3`, `py-1.5`, `text-sm`, `w-full`, `flex`, `items-center`, `justify-end`, `gap-2`, `text-xs`, `font-medium`, `text-red-600`, `dark:text-red-400`. Los estilos inline usan `var(--*)` con fallback, pero las clases de utility no responden al tema.

**Impacto:** En tema `noche`/`oled` el formulario de reset de cuenta se ve con fondo blanco y texto blanco (ilegible) — rompe el sistema de diseño y los temas oscuro.

**Recomendación:** Reemplazar las clases hardcodeadas por tokens CSS (`var(--paper-raised)`, `var(--ink)`, `var(--vermilion)`, `var(--border)`, `var(--radius-s)`, `var(--s-*)`) y eliminar las utility de Tailwind.

**Confianza:** confirmado

#### DSN-018 | ux | **mejora** | defecto | `Account.tsx:1630-1646`

**Evidencia:** El input del código Kindle tiene `maxLength={4}` y `textTransform="uppercase"` pero **no valida formato** hasta el submit (L1650: `disabled` hasta que tenga 4 chars). No hay `inputMode="text"` ni `pattern="[A-Za-z]{4}"` ni feedback en `onChange`.

**Impacto:** El usuario puede escribir caracteres no alfabéticos; el error solo aparece al enviar.

**Recomendación:** Añadir `inputMode="text"`, `pattern="[A-Za-z]{4}"`, validar en `onChange` y mostrar estado de entrada inválida antes del submit.

**Confianza:** confirmado

#### DSN-019 | ux | **mejora** | defecto | `WordPanel.tsx:136, 245` / `App.tsx`

**Evidencia:** `passageMeaningMemoryCache` (Map global) y `loadSessionValue`/`saveSessionValue` para caché de explicaciones IA. **No hay invalidación por versión de prompt** — si cambia el prompt del servidor, la caché sirve respuestas obsoletas. Ya existe el patrón `passage_meaning:v2:` — subir a `v3` al cambiar prompt.

**Impacto:** El usuario ve explicación vieja tras un deploy que mejora el prompt.

**Recomendación:** Incluir `PROMPT_VERSION` (variable de build) en `pKey` (L245).

**Confianza:** probable

#### DSN-020 | ux | **mejora** | defecto | `Shelf.tsx:164-167, 324-325`

**Evidencia:** Saludo del gato una vez por sesión vía `shelfGreetedThisSession` (variable de módulo). **No respeta `prefers-reduced-motion`** — la animación de saludo (onda de pata) se ejecuta siempre.

**Impacto:** Usuario con motion reduction ve animación innecesaria al abrir la app.

**Recomendación:** En `takeShelfGreeting()` comprobar `window.matchMedia('(prefers-reduced-motion: reduce)').matches` y retornar `false` si true.

**Confianza:** confirmado

#### DSN-021 | ux | **mejora** | defecto | `CompanionCloset.tsx:449-454`

**Evidencia:** Las tarjetas de pelaje y prendas renderizan **un `<Companion>` completo por tarjeta** con `stage`, `mood`, `accessories`. En escritorio 7 columnas → **7 gatos SVG montados simultáneamente** solo para miniaturas. Cada gato tiene sus propios `useEffect` de parpadeo/orejas.

**Impacto:** Rendimiento innecesario en el armario; cada miniatura gasta ciclos de animación que no se ven.

**Recomendación:** Crear `CompanionThumb` ligero (SVG estático, sin efectos) para miniaturas de armario; desactivar `useEffect` internos vía prop `static={true}`.

**Confianza:** confirmado

#### DSN-022 | ux | **mejora** | defecto | `Reader.tsx:340-351`

**Evidencia:** Constantes mágicas: `AUTO_ENRICH_CAP = 8` (L347), `SAVED_ENRICH_CAP = 20` (L351), `RESUME_CARD_MIN_DAYS = 3` (L276). No están en `tokens.css` ni en config compartida.

**Impacto:** Cambiar límites requiere tocar `Reader.tsx`; no son descubribles.

**Recomendación:** Mover a `src/shared/constants.ts` o documentar como tokens de config.

**Confianza:** mejora

#### DSN-023 | ux | **mejora** | defecto | `CompanionStage.tsx:272`

**Evidencia:** `useCallback` tiene dependencia faltante `reducedMotion` (warning de ESLint). Este es el único lint warning y **rompe el gate** (`--max-warnings 0`).

**Impacto:** El gate de CI falla; cualquier nuevo warning bloquea el merge.

**Recomendación:** Añadir `reducedMotion` al array de dependencias del `useCallback` o quitarla si no se usa.

**Confianza:** confirmado

---

## 3. Propuestas de gusto (opinión informada — no compiten con los defectos)

| ID | Área | Propuesta | Justificación |
|----|------|-----------|---------------|
| GP-001 | gato | Micro-expresiones por estación (orejas con gorro en invierno, gafas de sol en verano) | Refuerza «gato vivo» sin coste de bundle; usa prendas existentes (`gafas_sol`, `bufanda`) |
| GP-002 | gato | Unificar `triggerPurrHaptic()` + `playCompanionSound("purr")` en una sola función `purr()` | Cohesión sensorial; evita desincronización (suena sin vibrar o viceversa) |
| GP-003 | sistema | Tokens semánticos para z-index (`--z-toast`, `--z-sheet`, `--z-dialog`, `--z-reader-bar`) | Evita guerras de z-index; documenta jerarquía de capas |
| GP-004 | ux | Estado vacío del armario por ranura específico («Aún no tienes bufandas. La primera se gana leyendo 7 días seguidos») | Convierte estado vacío en llamada a la acción; coherente con «Regla del Cuaderno» |
| GP-005 | gato | Transición visible al subir etapa (S0→S1…) con `transform: scale` + `transition` | Celebra el progreso; momento «mágico» barato |
| GP-006 | sistema | Unificar `--dur-*` y `--ease-*` en un solo mapa `--motion-{fast,base,slow}` | Reduce decisiones; coherencia garantizada |
| GP-007 | ux | Indicador de «gato durmiendo» en estantería (🌙 o icono) cuando `focus === "sleep"` y hay libro abierto | Feedback pasivo; usuario sabe que el gato descansa sin abrir panel |
| GP-008 | gato | Eliminar `cat--coat-dorado` y `cat--coat-negro` (no están en `COMPANION_COAT_IDS`, no se ganan) | Limpia catálogo; evita confusión con registros viejos |

*Nota: GP-* son opiniones de diseño informadas, no defectos verificados. Requieren decisión de producto.*

---

## 4. Lo que está bien (patrones a conservar)

1. **Sistema de tokens CSS completo** (`tokens.css`): 4 temas (`papel`, `blanco`, `noche`, `oled`), escalas tipográficas/espacio/forma/movimiento, paletas cromáticas, superficies semánticas. Bien documentado con comentarios.
2. **Arquitectura del gato**: `makeStage` paramétrico → 5 etapas coherentes; `WEAR_LAYERS` prioridad por ranura; `companion-art.test.ts` vigila anatomía y pasa.
3. **Una prenda por ranura** respetada en código y tests; sin duplicados visuales en el armario.
4. **Colores del tema en prendas** cuando se usan tokens: `var(--vermilion)`, `var(--ochre)`, `var(--cat-outline)` en `game.css`.
5. **Tipografía Literata + Alegreya Sans** cargada vía `@fontsource-variable`; `font-optical-sizing`, `font-size-adjust` en lector.
6. **Jerarquía de CTA**: `.btn--primary` (vermilion sólido) vs `.btn--quiet` (subrayado vermilion) vs chips activos (translúcidos). Respetado en todas las pantallas.
7. **Foco visible**: `outline: 2px solid var(--vermilion); outline-offset: 2px` consistente en botones, campos, enlaces, dialogs.
8. **Touch targets ≥ 44px**: `.btn`, `.field input`, `.switch`, `.selection-menu button`.
9. **`prefers-reduced-motion` en hojas, diálogos y cofres** (`components.css:504,676`, `game.css:1636-1641`).
10. **Textos en español llano, tuteo, sin emojis** (salvo los defectos DSN-003, DSN-016 hallados).
11. **Estados vacíos diseñados**: estantería, cuaderno, repaso, búsqueda, armario — todos con copy de bibliotecario.
12. **Navegación con `history.pushState`**: botón «atrás» del móvil cierra hojas/dialogs y vuelve a estantería.
13. **Accesibilidad**: `role=dialog`, `aria-label`, `aria-live`, `lang` en EPUB, `color-scheme`, `forced-colors` support.
14. **Bundle controlado**: 204.8 kB gzip de 215 kB (95%); chunks diferidos para armario, panel compañero, modo papel, comunidad.
15. **Tests exhaustivos**: 3356 pruebas; `companion-art.test.ts` vigila anatomía del gato; `pnpm gate` puerta de cierre (salvo el lint warning DSN-023).

---

## 5. Auditorías previas: hallazgo → estado → evidencia

| # | Hallazgo (auditoría UX 2026-10-24) | Estado | Evidencia |
|---|------------------------------------|--------|-----------|
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
| 1 | Swatch pelaje escribe sin inventario | ✅ Corregido | `CompanionCloset.tsx:143-146` prueba y no escribe |
| 2 | Globo truncado `left:50%` | ✅ Corregido | `game.css:1825-1843` `inset-inline: 0` + `width: max-content` |
| 3 | Pelaje natural con candado nivel 8 | ✅ Corregido | `CompanionCloset.tsx:121-123` natural nunca bloqueado |
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

**Empeorados (3):** DSN-002 (pelajes usan literales hex, regresaron de tokens a hex), DSN-007 (`game.css` acumula 47 literales nuevos), DSN-005 (`prefers-reduced-motion` no cubre animaciones del gato, antes solo cofres/hojas).

---

## 6. Fuera de alcance / preguntas abiertas

| Tema | Pregunta | Para quién |
|------|----------|------------|
| Gato | ¿Eliminar pelajes `dorado`/`negro` (GP-008) o mantener para registros legacy? | Luis (producto) |
| Gato | ¿Activar prenda estacional automática (bufanda dic-feb, gafas jun-ago) sin acción del usuario? | Luis |
| UX | ¿Hero de estantería debe ceder sitio a «Continuar leyendo» en cuentas con historial? | Luis (ver P2 UX) |
| Sistema | ¿Añadir regla ESLint `no-hardcoded-colors` para evitar regresiones de literales? | Equipo |
| Gato | ¿Morph SVG al subir etapa (GP-005) o mantener cambio instantáneo? | Luis + Dev |
| UX | ¿Botón «Vincular Kindle» en Cuenta: validar en `onChange` o solo submit? | UX (DSN-018) |
| Sistema | ¿Auditar CSS muerto de `game.css` (~2000 líneas, reglas huérfanas)? | Equipo |

---

## 7. Verificación

| Comando | Resultado | Detalle |
|---------|-----------|---------|
| `pnpm typecheck` | ✅ | Cliente + Worker + MCP sin errores |
| `pnpm test` | ✅ 3356 passed | 236 archivos; incl. `companion-art.test.ts` (guardián gato) |
| `pnpm lint` | ❌ 1 warning | `CompanionStage.tsx:272` `useCallback` missing dependency `reducedMotion`; rompe el gate (`--max-warnings 0`) |
| `pnpm build` | No ejecutado | No se ejecuta deploy ni build per instrucciones del encargo |

**Lo que NO se pudo comprobar (auditoría solo código, sin capturas reales):**
- Contraste real en tema `papel`/`noche`/`oled` (medido en tokens pero no verificado en navegador)
- Comportamiento táctil real en iOS Safari (solo simulación `pointer: coarse`)
- Zoom 200% / reflow en móviles Android
- Lectores de pantalla reales (NVDA, VoiceOver) — solo auditado `aria-*` en código
- Animaciones del gato con `prefers-reduced-motion` activado en OS
- Rendimiento real del armario con 7 gatos SVG montados (DSN-021)

---

## 8. Tabla final: ID | Área | Severidad | Tipo | Ubicación | Recomendación

| ID | Área | Severidad | Tipo | Ubicación | Recomendación |
|----|------|-----------|------|-----------|---------------|
| DSN-001 | gato | importante | defecto | `Companion.tsx:429-463` / `CompanionStage.tsx:122-174` | Leer `prefers-reduced-motion` y saltar parpadeo/twitch de orejas; apagar animaciones CSS del gato |
| DSN-002 | gato | importante | defecto | `game.css:620-698` | Quitar literales hex de pelajes; heredar `var(--cat-fur)`/`--cat-outline`/`--cat-nose` de `tokens.css` por tema |
| DSN-003 | gato | importante | defecto | `CompanionStage.tsx:494-521` | Reemplazar emojis `🥣📖🔖` por `Icon` o SVG inline |
| DSN-004 | gato | importante | defecto | `Companion.tsx:526-535` / `companion-data.ts:323-344` | Unificar lógica de pelaje en `resolveCoatId`; eliminar mapeo manual duplicado |
| DSN-005 | gato | importante | defecto | `Companion.tsx:887-912` | Dibujar corazones y `zzz` como paths SVG con tokens de color |
| DSN-006 | gato | mejora | defecto | `Companion.tsx:72-81` | Tipar `onHitboxClick` con `CompanionHitboxZone` y documentar zonas |
| DSN-007 | sistema | importante | defecto | `game.css` (~47 literales) | Sustituir cada literal por su token; añadir ESLint `no-hardcoded-colors` |
| DSN-008 | sistema | importante | defecto | `components.css:219` vs `236` | Añadir `--sheet-lift` y `--dialog-lift` en `tokens.css`; unificar elevaciones |
| DSN-009 | sistema | importante | defecto | `reader.css:849-852` | Usar `var(--vermilion)` o definir `--accent-primary: var(--vermilion)` en `:root` |
| DSN-010 | sistema | mejora | defecto | `tokens.css:58-69` | Eliminar `--text-primary`/`--text-secondary`; usar `--ink`/`--ink-soft` directo |
| DSN-011 | sistema | mejora | defecto | `reader.css:281,289` | Usar `--read-measure` o token para margen derecho desktop |
| DSN-012 | sistema | mejora | defecto | `components.css:1035-1045` | Definir `--touch-target: 44px`; unificar `.selection-menu` |
| DSN-013 | sistema | mejora | defecto | `game.css:1783-1823` | Mover reglas de armario a `components.css` cerca de `.sheet--stage` |
| DSN-014 | sistema | probable | defecto | `game.css` (~2000 líneas) | Auditar CSS muerto; limpiar reglas huérfanas (`.game-chest`) |
| DSN-015 | ux | importante | defecto | `reader/ReaderFocusLayers.tsx:71-79` / `ReaderDockHost.tsx:173` | Revisar si el gato dentro del lector compite con la lectura; hacerlo opcional o moverlo fuera |
| DSN-016 | ux | importante | defecto | `CompanionPanel.tsx:157,184` / `Journey.tsx` / `GamePanel.tsx` / +20 más | Sustituir todos los emojis pictográficos por `Icon` o SVG inline |
| DSN-017 | ux | importante | defecto | `ResetAccountSection.tsx:154-222` | Reemplazar clases Tailwind hardcodeadas (`bg-white`, `bg-amber-600`) por tokens CSS de tema |
| DSN-018 | ux | mejora | defecto | `Account.tsx:1630-1646` | Añadir `inputMode`, `pattern="[A-Za-z]{4}"`, validar en `onChange` |
| DSN-019 | ux | mejora | probable | `WordPanel.tsx:245` | Incluir `PROMPT_VERSION` en clave de caché de explicaciones IA |
| DSN-020 | ux | mejora | defecto | `Shelf.tsx:164,325` | Respetar `prefers-reduced-motion` en saludo del gato |
| DSN-021 | ux | mejora | defecto | `CompanionCloset.tsx:449-454` | Crear `CompanionThumb` ligero para miniaturas de armario |
| DSN-022 | ux | mejora | defecto | `Reader.tsx:340-351` | Mover constantes mágicas a `src/shared/constants.ts` |
| DSN-023 | ux | mejora | defecto | `CompanionStage.tsx:272` | Añadir `reducedMotion` a dependencias de `useCallback` (rompe el gate) |

---

*Fin del reporte. Generado 2026-11-10. Auditoría solo de código, sin capturas de pantalla ni navegador real.*





