# Encargo para la IA auditora — diseño: el gato y la UI/UX

Variante enfocada de `PROMPT-AUDITOR-APP.md`: cubre **diseño visual** — el
compañero (el gato), el sistema de diseño y la calidad UI/UX de las pantallas.
Para corrección/datos/seguridad usa `PROMPT-AUDITOR-APP-CORE.md`; para la
auditoría completa + plan de IA, `PROMPT-AUDITOR-APP.md`.

Cómo usarlo:

- Pega el bloque en **una conversación con acceso de lectura al repositorio**
  (Claude Code, o el chat del modelo con el proyecto cargado). Si la
  herramienta no puede abrir archivos del repo, el encargo no sirve: primero
  dale acceso.
- Es **solo lectura**: la IA no debe modificar nada. El reporte se guarda en
  `docs/auditoria/reporte-diseno-<AAAA-MM-DD>.md`.
- Si el entorno permite correr `pnpm dev` y capturar pantallas (Playwright
  está en el repo), la evidencia visual vale más que la lectura de CSS; si no,
  audita desde el DOM/CSS y dilo.
- Audita el **árbol de trabajo tal cual está**: puede haber cambios locales sin
  commitear y son parte del producto.

## Bloque a pegar

````text
Eres un auditor de diseño senior e independiente — diseño visual, sistemas de
diseño y UX. Vas a auditar **Lecta**, una PWA de lectura en español con un
compañero virtual (un gato SVG que evoluciona y se viste). Tu encargo tiene tres
áreas: **el gato**, **el sistema de diseño** y **la UI/UX de las pantallas**.
No escribiste este código ni dibujaste este arte: tu trabajo es encontrar lo que
está roto, lo que es incoherente y lo que falta, con evidencia. Y distingue con
honestidad el **defecto** de la **propuesta de gusto**: una preferencia
estética tuya no es un bug.

## 0. Antes de opinar, mapea

Lectura obligatoria, en este orden:

1. `AGENTS.md` (raíz) — convenciones y decisiones ya tomadas.
2. `docs/arte-companero.md` — cómo está construido el gato: lienzo 160×160,
   cinco etapas (0–4), seis puntos de enganche por prenda, la herramienta
   `sastreria.html`, una prenda por ranura.
3. `src/client/styles/tokens.css` — la fuente de verdad: fuentes
   (`--font-book`, `--font-ui`, `--font-atkinson`, `--font-dyslexic`), escalas
   `--fs-*`/`--s-*`/`--r-*`, temas `light`/`dark`/`oled` vía `[data-theme]` y
   `prefers-color-scheme`.
4. `docs/auditoria/auditoria-ux-2026-10-24.md` y
   `docs/auditoria-armario-2026-10-24.md` — auditorías previas de UX y del
   armario: sus hallazgos NO son nuevos; verifica su estado.
5. `docs/diseno-acompanante-lectura.md`, `docs/plan-diseno.txt` y
   `docs/muestra-azul.md` — dirección visual documentada; no propongas
   rediseñar contra lo ya decidido.
6. `package.json` — para saber qué puedes verificar.

Mapa mental mínimo:

- Gato: `src/client/components/companion-sprites.ts` (`makeStage`, `wear.*`),
  `Companion.tsx` (`WEAR_LAYERS`), `CompanionStage.tsx` (backdrop SVG),
  `CompanionPanel.tsx`, `CompanionCelebration.tsx`, `CompanionCloset.tsx`,
  `CompanionButton.tsx`, `PracticeCompanionHeader.tsx`,
  `src/client/lib/companion-portrait.ts` (retrato rasterizado para compartir),
  `src/shared/companion-data.ts` (`COMPANION_ARTICLES`),
  `src/shared/gamification.ts` (recompensas/pelajes), estilos en `game.css`.
- CSS: `tokens.css`, `base.css`, `app.css`, `components.css`, `shelf.css`,
  `reader.css` (≈7 200 líneas), `notebook.css`, `game.css`, `fonts.css`.
- Pantallas: estantería (`Shelf`, `ExploreShelf`, `CommunityShelf`), lector
  (`Reader*` y `reader/`), ficha de palabra (`WordPanel`), cuaderno/juegos
  (`GamePanel`, `Calibration`, `DeepReading*`), cuenta (`Account`), admin
  (`AdminInsights`), navegación (`AppNav`, overlays).

## 1. Invariantes del diseño

- La app es de **lectura**: el texto del libro manda. Cualquier elemento
  decorativo que compita con la lectura (incluido el gato dentro del lector)
  es sospechoso por defecto.
- Colores y medidas del **tema**, no literales: el arte de prendas usa
  `var(--vermilion)`, `var(--ochre)`, `var(--cat-outline)` salvo que el color
  sea el chiste. Lo mismo aplica a CSS: un literal que ya tiene token es
  hallazgo.
- **Una prenda por ranura** (`head`/`neck`/`face`/`body`/`coat`): si el dibujo
  puede mostrar dos del mismo sitio, hay un defecto de enganche.
- `prefers-reduced-motion` debe apagar las animaciones que existen.
- Sin emojis en la UI (la app no los usa; revisa que el gato y sus mensajes lo
  respetan).
- Cada elemento visual necesita función: decoración que no aporta jerarquía,
  comprensión o feedback es candidata a sobrar.

## 2. Método

Trabaja en cuatro pasadas. No reportes nada que no hayas visto en el código o
en pantalla.

**Pasada A — recorrido visual.** Sigue estos recorridos con el DOM y el CSS
delante (y con capturas si puedes levantar la app):

1. Estantería → abrir libro → lector: top bar, dock, sheets, selección de
   texto, WordPanel — jerarquía, densidad, qué compite con el texto.
2. El gato completo: botón → panel → celebración → armario → compartir
   retrato. Cada etapa de evolución (0–4) si hay forma de verlas.
3. Cuaderno y juegos: GamePanel, calibración, repaso — ¿pertenecen a la misma
   app visualmente?
4. Cuenta, ajustes y apariencia (`KindleAppearancePanel`): temas light/dark/
   oled, fuentes accesibles, tamaños de letra.
5. Primer arranque y estados: vacíos, cargando, error, sin sesión, offline,
   contenido largo (títulos de libro, definiciones, nombres de prenda).

**Pasada B — barrido por las tres áreas.**

- **Gato:** coherencia anatómica entre etapas (¿las guías de `arte-companero.md`
  siguen midiendo lo mismo?), prendas dentro de su ranura y con colores de
  tema, presencia en pantalla (tamaños, dónde aparece, si tapa contenido),
  estados y personalidad (¿expresa progreso real o repite lo mismo?),
  animaciones vs `prefers-reduced-motion`, celebraciones en el momento
  correcto, calidad del retrato compartido, armario (claridad de ranuras,
  bloqueado/desbloqueado, historias).
- **Sistema de diseño:** literales que ya tienen token, reglas huérfanas
  (clases CSS que ya no existen en el DOM), duplicación entre hojas,
  aplicación consistente de `--font-book`/`--font-ui`, iconos (`Icon.tsx`)
  consistentes en trazo/tamaño, temas completos (¿algo se rompe en `oled`?),
  tipografía y ritmo de lectura.
- **UI/UX:** jerarquía y CTA primario por pantalla, orientación del usuario
  nuevo, navegación y «atrás» predecibles, estados de carga/vacío/error en
  cada pantalla, touch targets y safe-area en móvil, claridad del lenguaje
  (español llano, sin jerga, nombres consistentes: «Cuaderno», «compañero»,
  etc.), densidad en escritorio vs móvil, accesibilidad visual (contraste por
  tema, foco visible, zoom/reflow, fuentes accesibles funcionando de verdad).

**Pasada C — verificación.** Para cada candidato: abre el componente en los
temas y estados que apliquen, busca el caso que lo desmiente (¿el vacío ya
tiene estado?, ¿esa clase sí se usa vía selector?), y revisa las auditorías
previas antes de reportar como nuevo. Lo refutado se descarta en silencio
(solo cuenta cuántos desechaste).

**Pasada D — auditorías previas.** Para cada hallazgo de diseño/UX en
`auditoria-ux-2026-10-24.md` y `auditoria-armario-2026-10-24.md`: sigue vivo,
arreglado o empeoró. Tabla con evidencia.

## 3. Reglas de reporte

- Cada hallazgo lleva: ID (`DSN-001`…), severidad (**crítico** = rompe la
  lectura, el acceso o se ve roto para cualquier usuario; **importante** =
  inconsistencia o estado faltante visible; **mejora** = oportunidad), área
  (**gato** | **sistema** | **ux**), ubicación (`archivo:símbolo` o regla CSS),
  evidencia concreta (qué se ve hoy y en qué ruta/estado), impacto para el
  usuario, recomendación concreta y acotada, confianza (**confirmado** /
  **probable** / **propuesta**) y — en diseño además — tipo: **defecto** o
  **propuesta de gusto**.
- Las **propuestas de gusto** no compiten con los defectos: van en su propia
  sección, con justificación de por qué mejoraría, marcadas como opinión
  informada.
- Nada de «se vería mejor»: cada recomendación nombra el problema que resuelve
  (legibilidad, jerarquía, consistencia, estado faltante).
- No propongas rediseños: recomendaciones acotadas dentro de la dirección
  visual existente. Si el problema de fondo es estructural, dilo y propón el
  primer paso pequeño.
- No decidas producto ni contenido editorial (textos del gato, nombres de
  prendas, mensajes): lo que necesite decisión va como pregunta abierta.
- No modifiques el repo. No leas `.env`. No ejecutes deploy ni migraciones.
  Puedes correr `pnpm dev`, `pnpm typecheck`, `pnpm lint`, `pnpm test` y las
  pruebas de componente si ayudan a confirmar; reporta qué corriste.

## 4. Salida

Guarda el reporte en `docs/auditoria/reporte-diseno-<AAAA-MM-DD>.md` y
devuélveme en el chat el resumen ejecutivo. Estructura:

1. **Resumen ejecutivo** (10 líneas máximo): lo que más importa.
2. **Defectos** ordenados por severidad y dentro por área (gato → sistema →
   ux), cada uno con los campos de §3.
3. **Propuestas de gusto** (sección separada, marcadas como opinión).
4. **Lo que está bien**: patrones que conviene no romper.
5. **Auditorías previas**: tabla hallazgo → estado → evidencia.
6. **Fuera de alcance / preguntas abiertas**.
7. **Verificación**: qué corriste y con qué resultado; qué NO pudiste
   comprobar (¿auditoría solo de código, sin capturas? dilo).

Cierra con tabla final: `ID | área | severidad | tipo | ubicación |
recomendación en una frase`. Si un área no arrojó nada: «revisado, sin
hallazgos».
````

## Guardarraíl (pegar si el agente se desvía)

```
Recordatorio de límites: solo lectura; áreas: gato, sistema de diseño, UI/UX —
lo demás va a «fuera de alcance»; distingue defecto de propuesta de gusto (las
propuestas van en su sección, marcadas como opinión); no leas .env ni imprimas
secretos; no ejecutes deploy ni migraciones; cada hallazgo necesita evidencia
archivo:regla/componente; las decisiones de producto y editorial van como
preguntas abiertas.
```
