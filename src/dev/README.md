# Development tools (`src/dev`)

## Overview

Developer-only pages that are not part of the production bundle. Currently one
tool: the companion "Sastrería" (cat tailoring workbench) used to author new
companion art. It renders the large cat, anatomical guides measured from the real
SVG (`getBBox`), toggleable wear layers and a live `d`-path test bench, then copies
a snippet listing the places to update. Entry HTML is `/sastreria.html` at the
repository root (`<script type="module" src="/src/dev/sastreria.tsx">`), opened with
`pnpm dev` at `http://localhost:5173/sastreria.html`.

## Interface

- `[sastreria.tsx:Sastreria]` — React component (module-private), mounted with
  `createRoot` on `#sastreria-root`. No exports.
- `[sastreria.tsx:readGuides]` — reads guide boxes from the rendered SVG.
- Consumes `Companion`, `WEAR_LAYERS` (`src/client/components/Companion`),
  `CAT_BOX`, `STAGES` (`src/client/components/companion-sprites`),
  `ARTICLE_LABELS`, `ARTICLE_STORIES` (`src/client/lib/companion-closet`) and
  `COMPANION_ARTICLES`, `COMPANION_COATS`, `COMPANION_COAT_IDS`, `resolveCoatId`
  from [`../shared/companion-data.ts`](../shared/README.md).

## Invariants

- Not shipped: `vite build` only compiles `index.html` (comment in
  `sastreria.tsx` and `sastreria.html`). Nothing in `src/client` or `src/worker`
  imports this directory.
- `companion-art.test.ts` (client) guards that new art updates every required
  site; this tool only produces the snippet.

## Side Effects

- Browser only: writes the generated snippet to the clipboard
  (`navigator.clipboard.writeText`). No network, storage or database access.

## Verification

- Run: `pnpm test` (indirectly, via the companion tests in `src/client`)
- Manual: `pnpm dev`, open `/sastreria.html`
