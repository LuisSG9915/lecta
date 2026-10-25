# Auditoría UX de Lecta — 2026-10-24

## Objetivo

Encontrar la fricción real que separa a Lecta de la promesa «abrir y leer sin
interrupciones», corrigiendo primero lo que rompe la lectura y dejando medido lo
que falta. La auditoría se hizo sobre el build local, con navegador real, en
escritorio y móvil.

## Método

- Build de producción (`pnpm build`) servido con `vite preview` en `:5178`.
- Chrome real vía Playwright, dos viewports: **1280×800** y **390×844** (táctil).
- Medición de geometría DOM (rects, `getComputedStyle`, colisiones por área),
  `axe-core` para reglas A/AA y capturas antes/después.
- EPUB de prueba: `fixtures/minimal.epub`.
- No se tocó producción ni la base de datos.

## Corregido en esta pasada

| # | Hallazgo | Evidencia | Corrección |
|---|----------|-----------|------------|
| 1 | **Popover de Modos ilegible**: títulos blancos sobre papel blanco. Usaba `--text-main`, `--text-muted`, `--bg-elevated`, tokens que solo existen en el tema oscuro. | Captura móvil: las tarjetas 2 y 3 mostraban solo la descripción; «Enfoque TDAH» y «Ritmo Guiado» desaparecían. | `src/client/styles/reader.css:5129` usa superficie y tinta del tema (`--paper-raised`, `--ink`, `--rule-strong`); tarjetas con `--paper`/`--ink` y estado activo en `--vermilion`. |
| 2 | **Objetivos táctiles por debajo de 44 px** en el dock móvil (30–36 px). | Auditoría: botones de 30×36, cobertura 112×32, cápsula 351×48. | `reader.css:5099`: acciones a 44×44 mínimo, cobertura compacta a «100%», cápsula de 56 px. Resultado medido: 324×56 con todos los objetivos ≥44 px. |
| 3 | **Tres avisos flotantes en la misma franja**: toast de estado, pista de pulsación larga y tarjeta de palabra se solapaban entre sí y con el dock. | Solape medido de ~3 700 px²; el toast de estado tapaba el pie del popover de modos. | `reader.css:1270-1324`: franja única sobre el dock (`6rem` + safe-area); los avisos se ocultan cuando el popover de modos está abierto. `Reader.tsx:3942` no muestra la pista si hay un toast activo. |
| 4 | **El gato se posaba encima del marcapasos** cuando «Ritmo Guiado» estaba activo. | Captura con pacer: el gato cubría el extremo derecho de la barra de ritmo. | `reader.css`: con `.reader__pacer-bar` presente, el asiento del gato se retira y el párrafo bilingüe sube un carril. |
| 5 | **Importador de EPUB minúsculo en móvil**: 96 px de ancho, texto apretado y «Descubre» fuera de pantalla. | Captura móvil: hueco enorme y CTA partido en 4 líneas. | `shelf.css:1038` estira `.shelf-empty`; `shelf.css:1603` excluye `--wide` del tamaño de tarjeta móvil. Resultado: importador de 350 px y «Descubre» visible sobre el pliegue. |
| 6 | **Anuncio duplicado para lectores de pantalla**: el estado se pintaba en `Notice` global y en el toast del lector. | Dos regiones vivas con el mismo texto al abrir un libro. | `App.tsx:1639`: con el lector abierto, `Notice` no pinta mensajes de estado; el lector es la única capa. |
| 7 | **Abrir esperaba a la red sin límite** cuando la cuenta tenía posiciones remotas. | `openStoredBook` hacía `await syncPositions()` antes de `openBook`. | `App.tsx`: abre desde IndexedDB y el sync corre detrás; si trae avance remoto, el lector salta sin remontarse y, si hay conflicto, el aviso llega sobre el libro ya abierto. |
| 8 | **Seis capas flotantes coordinadas a mano** (`bottom` distintos para toast, pista, pacer y bilingüe). | En móvil, pista y pacer compartían franja; el párrafo bilingüe también. | `ReaderFloatingLane` + `.reader-floating-lane`: columna única sobre el dock; los hijos ya no se posicionan con `bottom`. |
| 9 | **El ritual de tres pasos reaparecía** en cada visita aunque ya hubiera lecturas. | `showOnboarding` se activaba con cualquier paso pendiente. | `Shelf.tsx`: solo antes de la primera lectura (`isBrandNew`) o al completar el ritual. |
| 10 | **«Abriendo libro…» seguía visible con el libro ya listo** y el gato se posaba sobre la pista de pulsación. | El toast solo se limpiaba a los 3 s y la rama sin catálogo (`ask`) salía sin emitir estado vacío; el gato solo se ocultaba con el marcapasos. | `Reader.tsx`: un estado vacío retira el toast y la rama `ask` lo emite; `reader.css`: el gato se retira con pista o toast visible. |
| 11 | **La cápsula de palabra era un `fixed` que competía con el dock** y el menú de selección podía caer sobre la franja. | Cápsula con `bottom: 1rem + 48px` fuera de `ReaderFloatingLane`; el menú solo reservaba 64 px. | `WordPanel` monta la cápsula por portal en `.reader-floating-capsule-slot`; dentro de la franja es `static`, orden 0. El menú reserva 190 px táctiles / 96 px de puntero. |
| 12 | **Dos barras «Volver» fuera de la franja**, una de enlaces internos y otra de notas, con el mismo `bottom` que la cápsula y el dock. | `ReaderSelectionBar` y `Reader.tsx` pintaban `.reader-return` fijo; podía convivir con la cápsula. | Ambas se pintan dentro de `ReaderFloatingLane` con `order: 6` y `position: static`; el gato ya no compite con ellas. |

## Abierto, por prioridad

### P0 — Abrir un libro no debe esperar a la red (hecho)

`openStoredBook` abre desde IndexedDB en el mismo gesto y lanza el sync por
detrás. Si la nube trae una posición más nueva, `Reader` la aplica sin
remontarse (solo si la persona sigue al principio); si hay conflicto, el aviso
aparece sobre el libro ya abierto y «Continuar desde ahí» salta a la posición
fusionada. Medido con sesión simulada y **2.6 s de latencia** en `/api/positions`:
el libro abre en **489 ms** y salta a «Capítulo dos» al llegar la posición remota.
Falta repetirlo con una cuenta real.

### P1 — Una sola franja flotante (hecho)

Toast, pista, pacer, palabra capturada, párrafo bilingüe, cápsula de palabra y
las dos barras «Volver» viven en `ReaderFloatingLane`, una columna con orden
explícito y sin `bottom` por capa. La cápsula entra por portal (`capsuleHost`) y
se vuelve `static`. El menú de selección se queda anclado al texto —moverlo
rompería la relación espacial— pero reserva la altura de la franja para no caer
encima.

### P1 — Primeros pasos (mitigado)

La tarjeta de tres pasos ya no reaparece en cada visita: solo se muestra antes
de la primera lectura o para celebrar que se completó. Sigue pendiente medir
tiempo hasta la primera página y decidir si el hero de primera visita debe
ceder el primer lugar a «Continuar leyendo» en cuentas con historial.

### P1 — Densidad del dock móvil (parcial)

En **320 px** se ocultan el progreso textual y la cobertura para no dejar
«Cap…» truncado ni un «100%» ambiguo; quedan modo, audio y hilo con 44 px. En
390 px sigue la cobertura. Falta decidir si «Hilo» pasa al menú del gato y
validarlo con prueba de tarea, no solo con inspección.

### P2 — Jerarquía de la estantería

El hero ocupa ~320 px de los 844 px móviles. Para una cuenta con libros, la
primera fila útil (continuar leyendo) debería estar sobre el pliegue. El hero de
primera visita puede quedarse, pero no en cada entrada.

### P2 — Verificación pendiente de temas y tamaños extremos

- Popover y tarjetas en tema **Noche/OLED**: los tokens ya son del tema, falta
  captura y contraste manual.
- **320 px** de ancho: etiquetas del dock y título del capítulo.
- Títulos largos (60+ caracteres) en la barra superior.
- `prefers-reduced-motion` en la animación del popover y el marcapasos.
- Foco y trampa de foco en hojas (Índice, Apariencia) con teclado y lector.

## Checklist zero-friction

- [x] Tocar un libro abre el lector sin pantallas intermedias.
- [x] Un solo dock inferior que muta entre lectura y audio.
- [x] Avisos de estado sin jerga técnica.
- [x] Objetivos táctiles de 44 px en el dock móvil.
- [x] El popover de modos se lee en cualquier tema.
- [x] Apertura desde IndexedDB; el sync no bloquea la primera página y la posición remota se aplica sin recargar.
- [x] Avisos flotantes en una sola cola.
- [x] El ritual de tres pasos no reaparece en cada visita.
- [x] Apertura medida con latencia simulada de 2.6 s: 489 ms.
- [x] Cápsula de palabra y barras «Volver» dentro de la franja; menú con reserva.
- [ ] Repetir la medición de apertura con una cuenta real.

## Verificación

`pnpm gate` en verde (segunda pasada, tras el corte final):

- `typecheck` cliente + worker + MCP.
- `lint` sin warnings (tope 0).
- **183 archivos / 2 576 pruebas**.
- Build y presupuesto: **178.49 kB gzip** de 215 kB (JS inicial) y 20.09 kB de
  55 kB (CSS).

Publicado después:

- Commit `0ba7c3f` (`feat(auditoria-ux)`) en `main`, con la migración
  `015_server_synced_at.sql` y el arnés de auditoría.
- Migración 015 aplicada en `lecta` (2026-10-24, tabla por tabla) y en
  `lecta_dev` (2026-10-24, sentencia por sentencia: `pnpm db:migrate` se queda
  corto con el `statement_timeout` de 120 s porque cada DDL dispara un
  `SCHEMA CHANGE GC`).
- Deploy `5822f097-e648-4cd7-93ee-9a6195a49747` con verificación en caliente:
  `/api/health` 200 con `db: connected`, `/` 200, 401 sin sesión, ONNX de R2
  intacto (`check-model`).
- `smoke:auth` completo contra producción (cuentas `a-…@smoke.test` y
  `b-…@smoke.test` del 2026-10-24) y `smoke:sync` en local contra `lecta_dev`:
  el pull incremental devuelve `syncedAt`, respeta el cursor y ya no pierde
  filas escritas por relojes atrasados.

## Reproducir

```bash
pnpm build
pnpm exec vite preview --port 5178
# abrir http://localhost:5178/ y soltar fixtures/minimal.epub
```

Tras cada build hay que reiniciar `vite preview`: conserva el `index.html`
anterior y sirve assets nuevos con MIME incorrecto.
