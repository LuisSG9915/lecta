# Drift Report — 2026-11-12

Alcance: `src/` (cliente, `src/worker/`, `src/shared/`) contra `PRODUCT.md` y
`marketing/landing/index.html` (+ `marketing/landing/landing.js`). No existe un
directorio `workers/` en la raíz; el código del Worker vive en `src/worker/`.
Solo se listan divergencias.

## PRODUCT.md

### 1. Sistema de cuentas y captura de `?gato=<pelaje>`

- **`?gato=` no se lee en la app.** El único lector de query string al montar
  es `authLink` en `src/client/App.tsx:141-150`, que solo toma `token`, `error`
  y `cuenta`. Ningún archivo de `src/` busca `gato`; el pelaje elegido en el
  landing se pierde al cruzar.
- **`?semilla=<palabra>` no existe.** Cero coincidencias en `src/`; tampoco el
  landing lo emite (`landing.js:15` solo arma `?gato=`). La «primera palabra
  germinada» no está implementada en ningún lado.
- **El `localStorage` del landing no llega a la app.** `landing.js:22` guarda
  `lecta:gato`, pero el landing se sirve en `/inicio/` del mismo origen y la
  app nunca lee esa clave. Las dos piezas existen; falta el puente.
- **La cuenta no es obligatoria.** PRODUCT.md dice «Cuenta obligatoria con
  onboarding continuo». La app funciona en anónimo: IndexedDB `lecta` sin
  sesión (`src/client/lib/idb.ts`, base anónima) y llaves `sessionUserId ??
  "anon"` en `App.tsx:1764`, `1794`, `1940`. `docs/sistema-lecta.md` §1
  también documenta «sin cuenta (uso anónimo)».
- **No hay selector de pelaje al inicio.** PRODUCT.md (plan Gratis) dice
  «1 gato compañero elegido al inicio». El onboarding de `Shelf.tsx:765-772`
  es una lista de 3 pasos sin elección de pelaje. Los pelajes se desbloquean
  por nivel: `requiredLevel()` en `src/client/lib/companion-closet.ts:227,296`.
  Los ids sí coinciden con el landing: `CompanionCoatId = "tuxedo" | "latte" |
  "ginger" | "mist" | "calico"` (`src/shared/companion-data.ts:229`).
- **Sin campo `plan` en la cuenta.** No hay columna, tipo ni lectura de
  `plan`, `free`, `lecta_plus` ni `founder_lifetime` en `src/` ni en
  `db/migrations/`.
- **Base de datos D1 ≠ código.** PRODUCT.md dice «Sincronización ligera en D1»
  y que el webhook «actualiza el campo `plan` en D1». La sync va a
  Postgres/CockroachDB vía Hyperdrive (`src/worker/db.ts:getConnectionString`,
  bindings `HYPERDRIVE` / `HYPERDRIVE_CACHED`). `DB?: D1Database` en
  `WorkerEnv` (`db.ts:23`) es un tipo sin binding: `wrangler.jsonc` no declara
  `d1_databases`. La única lectura de `D1Database` está en
  `src/worker/kindle/routes.ts:356,415,545`, como parámetro opcional.

### 2. Separación Gratis vs Lecta+

- **No hay billing.** No existen `/api/billing/checkout`, `/api/billing/portal`
  ni `/api/billing/webhook` en `src/worker/`. No hay ninguna mención de
  `stripe` en `src/`.
- **No hay gating por plan.** Ninguna función premium consulta un plan; las
  barreras que existen son de sesión o de preferencia:
  - Explicación con IA: `canExplain` (sesión) + `useAi` en
    `src/client/components/WordPanel.tsx:93,144,217`. Cualquier cuenta Gratis
    la tiene.
  - Portal Kindle `/k`: solo `getSession(c)` en
    `src/worker/kindle/routes.ts:184,193`. Disponible en Gratis.
  - Palabras previstas / «Antes de leer»: `preparationMode` en ajustes del
    lector (`Reader.tsx:2378`), sin plan.
  - Biblioteca en R2: la sube `book-queue.ts` en cuanto hay sesión, sin plan.
  - Modos libres del Cuaderno: los decide `reviewQueue`/`isEligible`
    (`learn.ts`, `notebook-model.ts`), sin plan.
  - Cambio de pelaje y accesorios: se desbloquean por nivel
    (`companion-closet.ts:requiredLevel`), no por plan.
- **No hay Carné de Lector.** `Account.tsx` no contiene «Carné», «Mecenas» ni
  «Gratis» (0 coincidencias). No hay sello «Mecenas de Primera Imprenta» ni
  insignia de fundador.
- **No hay notas al margen de pago.** No existe el aviso tipográfico de
  2 líneas en la ficha, la antesala, la sección Kindle ni el guardarropa.
- **Temas.** PRODUCT.md limita Gratis a `papel` y `noche`. La app ofrece 5
  opciones sin barrera: `ThemeChoice = "auto" | "blanco" | "papel" | "noche" |
  "oled"` (`src/client/lib/settings.ts:3`), y `tokens.css:144,195,243,295`
  define los 4 temas con color.
- **Contradicción interna de las fuentes.** PRODUCT.md describe el cobro con
  Stripe como si existiera; el landing dice «Lecta+ Muy pronto… Todavía no se
  puede pagar» y promete «te avisamos en la app». En `src/` no hay lista de
  espera ni aviso (`waitlist` / «Avísame»: 0 coincidencias).

### 3. Tokens visuales del landing en las 7 vistas

Lo que **sí** está: `--font-book` (Literata Variable) y `--font-ui` (Alegreya
Sans) en `tokens.css:9-10`, autoalojadas en `fonts.css`; `--grain` (SVG noise
inline) en `body` (`base.css:33`) y en `.notebook` (`notebook.css:4-7`).
Divergencias:

- **El lavado ocre no es superficie del Cuaderno.** `.notebook` usa
  `var(--paper)` + grano (`notebook.css:5`) y `.notebook--page` es
  `transparent` (`notebook.css:25`). `--ochre-wash` / `--ochre-soft` solo
  aparecen en chips y bordes (`notebook.css:414,795-802`).
- **La pizarra noche no existe como token.** El landing define `--night`,
  `--night-2`, `--night-ink`, `--night-soft`, `--moon` y `--mist`; ninguno
  existe en `tokens.css`. El dock del lector pinta un zinc fijo
  `rgba(24, 24, 27, 0.92)` con sombra `0 10px 30px -5px rgba(0,0,0,0.5)` en
  `.reader-smart-dock` (`reader.css:5155+`) en todos los modos, no solo en
  audio, y sin token. El bloque Kindle (`.kindle-panel`, `app.css:665-671`)
  es papel con `border-top`, sin pizarra.
- **Sombras en lugar de filetes.** PRODUCT.md pide filetes de 1 px «en lugar
  de sombras difusas». `box-shadow` aparece 200 veces: `reader.css` 61,
  `notebook.css` 42, `game.css` 38, `components.css` 25, `shelf.css` 20,
  `app.css` 14. El `.reader-dock` lleva `0 4px 20px -2px` (`reader.css:3101+`).
- **Esquinas fuera de 2–4 px.** PRODUCT.md fija «`border-radius: 3px`».
  Hay 51 radios en px ≥ 5 (`reader.css` 23, `game.css` 16, `notebook.css` 8,
  `components.css` 3, `shelf.css` 1) y 169 píldoras (`999px`/`r-full`/`r-pill`),
  entre ellas los docks (`reader.css:3101`, `5155`). DESIGN.md limita la
  píldora a fichas, filtros e interruptores.
- **Colores fijos fuera de `tokens.css`.** 512 literales hex en hojas de
  componente: `game.css` 193, `reader.css` 127, `shelf.css` 64,
  `components.css` 60, `notebook.css` 58, `app.css` 10. También hay respaldos
  hex dentro de `var()` (`notebook.css:796` → `#fed7aa`, `802` → `#fde68a`,
  que no son el ocre del landing). Rompe la «regla del tema vivo».
- **Biblioteca.** El gato se monta como `CompanionButton` / `CompanionStage`
  (`Shelf.tsx:967,1227`), sin posarse sobre un filete separador. No hay
  repisas trazadas con filetes horizontales continuos.
- **Ficha de palabra.** `.sheet` (`components.css:202`) no tiene doble filete
  superior. No existe el micro-brote del Herbario al guardar: 0 coincidencias
  de `brote`/`sprout` en estilos.
- **Tu recorrido.** `Journey.tsx` no tiene acceso al Guardarropa (`closet`) ni
  sol bermellón de nivel máximo.
- **Tú.** No hay ficha de biblioteca clásica (Carné) en la cabecera de
  `Account.tsx` (ver §2).
- **Explora.** No se encontró un tratamiento propio del landing; usa las
  mismas sombras y píldoras de `shelf.css`.
- **`primary_target: "src/views/**"`** (bloque al final de PRODUCT.md) no
  existe; las vistas viven en `src/client/components/`.

## marketing/landing/index.html

- **Promesa del CTA rota.** Todos los `a[data-cta]` apuntan a
  `https://lecta.luis-sg9915.workers.dev/?gato=<pelaje>` (`landing.js:8,15`),
  pero la app ignora el parámetro (ver PRODUCT.md §1).
- **«Un gato a elegir entre cinco» en Gratis.** La app no ofrece esa
  elección: los pelajes se desbloquean por nivel
  (`companion-closet.ts:requiredLevel`).
- **«Te avisamos en la app» (Lecta+).** No hay aviso, lista de espera ni
  campo de interés en `src/`.
- **«¿Necesito crear una cuenta? Sí.»** La app permite leer y guardar sin
  cuenta (ver PRODUCT.md §1).
- **Lecta+ marcada «Muy pronto», pero con todo abierto.** Kindle, explicación
  con IA, palabras previstas, nube y cambio de gato por nivel ya están
  disponibles para cualquier cuenta Gratis, sin barrera de plan (ver
  PRODUCT.md §2). El texto del landing describe esas funciones como
  exclusivas de Lecta+.
- **Tokens del landing que no están en la app:** `--night`, `--night-2`,
  `--night-ink`, `--night-soft`, `--moon`, `--mist` y `--ease-spring`. El
  landing usa `--rule` con 14 % de opacidad; la app usa 12 % (DESIGN.md).
