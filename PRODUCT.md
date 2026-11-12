# Product

<!-- impeccable:product-schema 2 -->

## Platform

web (PWA local-first en React 19 + Vite sobre Cloudflare Workers con Hono, CockroachDB vía Hyperdrive y Cloudflare R2)

## Users

Lector bilingüe español/inglés en México y Latinoamérica: lee libros EPUB por
gusto en ambas lenguas y quiere ampliar su vocabulario mientras lee, tanto en
su lengua materna como en la segunda. Lee principalmente en celular (PWA en
vertical), también en escritorio y en Kindle e-ink.

## Product Purpose

Lecta es un lector de EPUB con aprendizaje de vocabulario integrado. La persona
lee; al tocar una palabra ve su significado al instante, la guarda en el
Cuaderno con la frase exacta del libro y la repasa después con repetición
espaciada (FSRS). Antes de cada capítulo, la app predice qué palabras
probablemente no conoce y ofrece prepararlas.

Éxito: la persona sigue leyendo sin interrupciones y su vocabulario crece como
consecuencia natural de leer, no de estudiar aparte.

## Positioning

- **El vocabulario nace del libro.** Cada palabra se guarda leyendo, con su
  frase original, y el repaso enseña antes de examinar: nunca se pregunta una
  palabra que la persona no ha visto presentada.
- **Inteligencia invisible.** La predicción de palabras difíciles y la
  programación del repaso trabajan sin jerga ni pasos previos: tocar un libro
  abre el lector directo y las acciones clave son de un toque.
- **Lee donde sea.** El mismo progreso (posición exacta dentro del párrafo,
  Cuaderno, repasos) viaja entre celular, escritorio y Kindle e-ink.

## Monetization, Tiers & Legacy Entitlements

La monetización sigue la metáfora de mecenazgo editorial: el plan Gratis nunca
interrumpe la lectura ni el hábito diario; Lecta+ vende anticipación,
ubicuidad de archivos y personalización.

- **Cuenta obligatoria con onboarding continuo**: La app requiere sesión activa
  (Better Auth). Al cruzar desde el landing (`/inicio/`), la app lee
  `?gato=<pelaje>` en la URL o la clave `lecta:gato` en `localStorage`
  (`CompanionCoatId = "tuxedo" | "latte" | "ginger" | "mist" | "calico"`) y
  asigna ese pelaje como `starter_coat` sin requisito de nivel. Si entra
  directo sin gato previo, elige 1 de los 5 pelajes en el onboarding inicial.
- **Mecenas Fundador (`founder_lifetime`)**: Todo usuario con cuenta registrada
  antes del corte de lanzamiento de pagos recibe la suscripción **Lecta+
  Vitalicia** sin costo en CockroachDB (`lecta_user_plan.plan =
  'founder_lifetime'`, migración 027; corte: cuentas creadas antes de
  2026-11-13T00:00:00Z), con el sello editorial «Mecenas de Primera Imprenta»
  en la vista `Tú` (`Account.tsx`) y acceso permanente a todas las funciones
  premium.
- **Plan Gratis (`free` — $0 MXN)**:
  - Lectura EPUB ilimitada con los 5 temas disponibles (`auto`, `blanco`,
    `papel`, `noche`, `oled`), siendo `papel` y `noche` los temas de referencia.
  - Diccionario offline automático por idioma (`es`, `en`) y guardado en 1 toque.
  - Cuaderno base: Herbario y cola diaria de repasos vencidos (FSRS).
  - Lectura en voz alta (TTS del sistema + 1 voz neural offline local).
  - 1 gato compañero elegido al inicio (`starter_coat`) que evoluciona por
    nivel en el Sendero de Tinta.
  - Posición, palabras y tus libros en todos tus dispositivos: sincronización
    en CockroachDB (vía Hyperdrive) de la posición exacta, el Cuaderno, los
    repasos y los metadatos de tus EPUB propios. El archivo `.epub` no viaja:
    en otro dispositivo se adjunta el mismo archivo (se empareja por SHA-256).
- **Plan Lecta+ (`lecta_plus` — $59 MXN/mes o $499 MXN/año)**:
  - **Palabras previstas (`preparationMode`)**: preparación psicométrica antes
    de cada capítulo.
  - **Explicación literaria con IA**: matices y sentido exacto en el contexto
    de la frase dentro de `WordPanel.tsx` (bajo petición).
  - **Biblioteca en la nube (Cloudflare R2 `BOOKS`)**: tus EPUB en la nube,
    sin volver a subirlos: respaldo y descarga automática de los binarios
    `.epub` completos entre dispositivos.
  - **Portal Kindle e-ink (`/k`)**: vinculación activa por código de 4 letras.
  - **Modos libres en Cuaderno**: práctica intensiva fuera de la cola vencida.
  - **Santuario de gatos y guardarropa (`companion-closet.ts`)**: cambio libre
    entre los 5 pelajes sin bloqueo de plan y acceso a accesorios editoriales.

## Billing Architecture (Stripe Zero-Bundle)

- **Cero SDK en el cliente**: Prohibido añadir `@stripe/stripe-js` al bundle
  principal para proteger el límite de 215 kB gzip de JS.
- **Flujo en `src/worker/` (Hono + CockroachDB)**:
  - `POST /api/billing/checkout`: crea sesión de Stripe Checkout en MXN ($59/mes
    o $499/año) vía API REST de Stripe.
  - `POST /api/billing/portal`: abre Stripe Customer Portal para gestionar o
    cancelar suscripción.
  - `POST /api/billing/webhook`: procesa eventos de Stripe y actualiza `plan`,
    `stripe_customer_id`, `stripe_subscription_id` y `plan_expires_at` en
    CockroachDB (`lecta_user_plan`) usando `withClient` (`src/worker/db.ts`).
- **Alineación con Landing**: Al activarse las rutas `/api/billing/*`,
  `marketing/landing/index.html` retira la leyenda «Muy pronto / Todavía no se
  puede pagar» para reflejar el cobro activo.
- **Ubicación en UI**:
  1. **Carné de Lector en la vista `Tú` (`src/client/components/Account.tsx`)**:
     cabecera con estética de ficha bibliotecaria clásica que muestra el estado
     del plan (`Lector de Cuaderno Abierto`, `Suscriptor Lecta+` o sello
     `Mecenas de Primera Imprenta`), selector Mensual/Anual y acceso a Stripe.
  2. **Notas al margen (Inline Triggers)**: avisos tipográficos de 2 líneas
     dentro de `WordPanel.tsx` (al pedir IA), antesala de capítulo en
     `Reader.tsx`, sección Kindle y guardarropa del gato. Prohibidos los
     modales de pago a pantalla completa.

## Operating Context & Constraints

- Sesiones de lectura largas en celular, local-first (`IndexedDB` por cuenta +
  sincronización por merge `updatedAt` hacia CockroachDB vía Hyperdrive y
  archivos EPUB en R2 `BOOKS`).
- Vistas principales en `src/client/components/`: Biblioteca (`Shelf.tsx`),
  Lector (`Reader.tsx`), ficha de palabra (`WordPanel.tsx`), Cuaderno
  (`Notebook.tsx`: Herbario, Aprender, Repasar, modos libres), Tu recorrido
  (`Journey.tsx`), Explora y Tú (`Account.tsx`).
- Reglas de producto inquebrantables:
  - Tocar un libro abre el lector de inmediato (`App.tsx:openBook`); nada a
    pantalla completa se interpone.
  - Ninguna función psicométrica muestra jerga técnica ni bloquea la lectura.
  - En el lector existe un solo dock inferior (`SmartReaderDock`), que alterna
    entre lectura y audio.
  - Nunca se muestran hashes, ids ni nombres de archivo técnicos (todo título
    visible pasa por `bookDisplayName` en `src/shared/epub-meta.ts`).
  - El Cuaderno solo examina palabras vencidas ya presentadas; con vencidas,
    «Repasar» es la acción principal.
  - En la ficha de palabra el significado va primero; la explicación con IA
    aparece solo al pedirla y el mismo texto nunca se pinta dos veces.
  - Presupuesto de peso del cliente (`scripts/check-bundle-budget.mjs`): máximo
    **215 kB gzip en JS** y **55 kB gzip en CSS** (`pnpm gate`).
  - Escritorio a partir de `64rem`; el orden del contenido en móvil es el orden
    lógico de referencia.

---
version: 2
slug: "app-editorial-unification"
primary_target: "src/client/components/**"
related_targets:
  - "src/client/styles/**"
  - "src/worker/**"
  - "marketing/landing/index.html"
---

# Sistema Visual de la App Lecta (Réplica del Mundo del Landing)

Scope: Unificar las 7 vistas de la PWA (`src/client/components/**` y
`src/client/styles/**`) con la dirección de arte aprobada en
`marketing/landing/index.html` («El sendero del gato»), manteniendo
accesibilidad AA/AAA (`axe`), soporte completo en los temas de referencia
`papel` y `noche`, y 0 kB de imágenes raster adicionales en el bundle.

## Direction contract

THESIS: La app entera es un libro impreso vivo. Al cruzar del landing a la app,
la persona no siente que entró a un panel administrativo SaaS: sigue caminando
por el mismo Sendero de Tinta acompañado por el gato que eligió.

OWN-WORLD TOKENS (`src/client/styles/tokens.css`):
- **Tipografía dual estricta**: `--font-book` (`Literata Variable`) para todo
  texto de lectura, entradas de diccionario, frases de libros y titulares
  editoriales; `--font-ui` (`Alegreya Sans`) para controles táctiles,
  navegación, etiquetas y métricas.
- **Geometría de imprenta**: esquinas de `2px` a `4px` (`border-radius: 3px`),
  filetes finos (`1px solid var(--rule)` con `14%` de opacidad) en lugar de
  sombras difusas (`box-shadow`). Las píldoras (`999px`) se reservan
  exclusivamente a chips, filtros e interruptores (nunca en docks ni paneles).
- **Cero colores hex fijos fuera de `tokens.css`**: toda regla en `reader.css`,
  `notebook.css`, `shelf.css`, `components.css`, `game.css` y `app.css` consume
  variables semánticas e incorpora del landing `--night`, `--night-2`,
  `--night-ink`, `--night-soft`, `--moon`, `--mist` y `--ease-spring`.
- **Grano táctil**: textura de papel `--grain` con SVG noise inline sobre el
  lienzo base.
- **Campos cromáticos por contexto**:
  1. `Papel / Noche base`: Biblioteca, Lector y Explora.
  2. `Lavado Ocre (--ochre-wash)`: superficie completa del Cuaderno y Herbario
     en `notebook.css` (no solo en chips).
  3. `Pizarra Noche (--night / --night-2)`: superficie del dock del lector
     cuando está en modo Voz (TTS) y del bloque de vinculación Kindle e-ink
     (`.kindle-panel`).
  4. `Bermellón`: reservado estrictamente a **una sola acción primaria por
     vista** («Seguir leyendo», «Repasar vencidas», «Guardar palabra» o
     «Suscribirme a Lecta+» en el Carné de Lector).

VIEW-BY-VIEW EXECUTION:
- **Biblioteca (`Shelf.tsx` / `shelf.css`)**: El libro activo destaca arriba con
  el gato compañero posado sobre el filete separador; el resto de libros
  descansa sobre repisas editoriales trazadas con filetes horizontales
  continuos.
- **Lector y Ficha de Palabra (`Reader.tsx` / `WordPanel.tsx` / `components.css`)**:
  La ficha `.sheet` emerge como papeleta encartada con doble filete superior.
  Al guardar una palabra (`★ Guardar`), el icono del Herbario confirma con un
  micro-brote botánico (apagado si `prefers-reduced-motion`).
- **Cuaderno y Herbario (`Notebook.tsx` / `notebook.css`)**: Fondo lavado ocre
  (`--ochre-wash`); cada palabra se presenta como espécimen recolectado con su
  cita literaria en `Literata` cursiva.
- **Tu Recorrido (`Journey.tsx`)**: El Sendero de Tinta se dibuja verticalmente
  mostrando la etapa actual del gato (de «recién llegado» a «bibliotecario» con
  sol bermellón al fondo en el nivel máximo) e integra el acceso al Guardarropa
  (`companion-closet.ts`).
- **Tú (`Account.tsx` — Carné de Lector)**: Diseño de ficha de biblioteca
  clásica en la cabecera con el estado del plan (`Gratis`, `Lecta+` o sello
  `Mecenas de Primera Imprenta`), conexión a Stripe Checkout/Portal y el puente
  de 4 letras hacia Kindle `/k` sobre superficie pizarra noche.

FINISH: `pnpm gate` en verde (0 warnings, JS < 215 kB gzip, CSS < 55 kB gzip),
contraste verificado en `papel` y `noche`, pruebas E2E `@smoke` y `axe`
aprobadas, y cero regresiones en la apertura inmediata del lector.