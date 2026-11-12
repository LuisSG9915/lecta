# marketing/landing — landing estática en `/inicio/`

## Overview

Página de marketing autocontenida (HTML + CSS en línea + `landing.js`),
publicada en `/inicio/` por el plugin `landingPage()` de `vite.config.ts`.
No pasa por el bundler de la app, no entra al precaché del service worker y
no cuenta para `check:size`. Los PNG de esta carpeta son originales que
renderiza `scripts/landing-art/render.mjs`; la página usa las versiones
`.webp` de `web/`.

## Interface

- `index.html` (`lang="es-MX"`): demo de ficha de palabra (`.w[data-w]`,
  `#ficha`), selector de gato (`input[name="gato"]`), Herbario (`#plants`),
  repaso (`#reveal`, `#card`), Sendero (`#sendero`, `.stage`), precios
  (`.toggle button[data-period]`) y CTAs `a[data-cta]`. Carga
  `<script src="landing.js" defer>`.
- `landing.js`: IIFE sin exportaciones. Funciones internas:
  `setCoat`, `openFicha`, `closeFicha`, `syncSave`, `plantSVG`, `addPlant`,
  `layoutInk`, `drawInk`, `setStage`. Datos fijos: `DICT` (membrillo,
  perenne, terco), `BUBBLES`, `COLORS`, `PRICES` (`anual` $499 MXN,
  `mes` $59 MXN).
- `fonts/` (Literata, Alegreya Sans) y `web/` (imágenes `.webp`,
  `og.jpg`, `icon-192.png`; los `.json` son notas de procedencia).

## Invariants

- El JS va en archivo aparte porque la CSP del sitio (`script-src 'self'`)
  bloquea scripts en línea; no añadir `<script>` en línea ni handlers
  `on*`.
- Todos los CTA apuntan a `https://lecta.luis-sg9915.workers.dev/?gato=<pelaje>`
  (`landing.js:APP`, `setCoat`); pelaje por defecto `ginger`.
- Respeta `prefers-reduced-motion` (`reduce`): sin animación de vuelo ni
  dibujo progresivo de tinta.
- `landingPage()` copia solo `index.html`, `landing.js`, `fonts/` y `web/`
  (sin `*.json`); los PNG de la raíz no se publican.
- La página es demostración: ficha, herbario y repaso usan datos fijos y no
  llaman a la API.

## Side Effects

- `localStorage["lecta:gato"]`: lee y escribe el pelaje elegido (errores
  tragados si no hay almacenamiento).
- DOM: clases `is-*`, `body.is-night`, `IntersectionObserver`,
  `ResizeObserver` y listeners de `scroll`/`resize`/`load`.
- Sin red propia más allá de cargar imágenes y fuentes.

## Verification

- Run: `pnpm build` y abrir `dist/client/inicio/index.html` vía
  `vite preview` en `/inicio/`.
- Run: `pnpm test` (no hay pruebas propias de la landing).
