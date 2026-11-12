# scripts/landing-art — imágenes de la landing

## Overview

Generador reproducible de las ilustraciones de la landing de marketing
(`marketing/landing/`). Empaqueta un «estudio» que monta el componente real
del gato de la app (`Companion`) con el CSS de la app, abre la página en
Chromium (Playwright) y fotografía cada escena a 2×.

```sh
node scripts/landing-art/render.mjs                 # todas las escenas
node scripts/landing-art/render.mjs hero-noche og   # solo esas
```

## Interface

- [`render.mjs`] CLI: compila `studio.tsx` con el `esbuild` que trae `vite`
  (`createRequire(require.resolve("vite"))("esbuild")`), escribe
  `artifacts/landing-art/studio.html` y fotografía las escenas de
  `SCENES`.
- [`studio.tsx:mountCats`] expuesto en `window.mountCats`; importa
  `Companion` de `src/client/components/Companion` y
  `src/client/styles/{fonts,tokens,game}.css`. No se importa desde la app.
- [`scenes.mjs:SCENES`] — lista `{ name, width, height, theme, css, html }`;
  agrega [`scenes-claras.mjs:CLARAS`] (ficha, herbario, pelajes,
  evolución; `LIGHT_CSS`), [`scenes-extra.mjs:EXTRA`] (hero de papel, voz,
  kindle) y [`scenes-recortes.mjs:RECORTES`] (gato por pelaje y etapa 0–4
  con fondo transparente).
- [`kit.mjs`]: `rng(seed)`, `lerp`, `f`, `bezier`, `cat(spec)`, `grain`,
  `vignette`, `filters`, `glyphField`, `QUIJOTE`.

## Invariants

- Las escenas son deterministas: todo azar sale de `rng(seed)` con semilla
  fija ([`kit.mjs:rng`]), para que el render sea reproducible byte a byte.
- El gato es siempre el componente real de la app (misma geometría y CSS),
  nunca una réplica.
- `esbuild` no es dependencia directa: se resuelve a través de `vite`.

## Side Effects

- Escribe `artifacts/landing-art/` (bundle + `studio.html`) y los PNG en
  `marketing/landing/<nombre>.png` ([`render.mjs:outDir`]).
- Lanza Chromium vía `@playwright/test`.
- Las versiones `.webp` de `marketing/landing/web/` que sirve la landing no
  las genera este script.

## Verification

- Run: `node scripts/landing-art/render.mjs <escena>` y revisar el PNG.
- Run: `pnpm test` (no hay pruebas propias de este directorio).
