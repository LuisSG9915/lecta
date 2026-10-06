# 📖 PLAN DE TRABAJO REAL - LECTA (SWE-2 Max)

Este archivo es la única fuente de verdad para Devin.
Reglas de operación:
1. Respetar las reglas de `.devin/rules/lecta-workflow.md` y `AGENTS.md`.
2. Completar una fase a la vez de forma secuencial y verificar mediante comandos de terminal.
3. Actualizar los checkboxes `[x]` y hacer un git commit atómico al cerrar cada fase.

---

## 📊 Progreso General
- [x] Fase 1: Verificación de Línea Base y Consolidación del Guionado
- [ ] Fase 2: Rediseño Moderno de ThemeMenu y Sistema de Opciones
- [ ] Fase 3: Animaciones y Micro-interacciones (60 FPS)
- [ ] Fase 4: Optimización Backend (CockroachDB/Hyperdrive y DeepSeek AI Gateway)
- [ ] Fase 5: Funcionalidades de Alto Valor Agregado (Explicación Contextual y Exportación)
- [ ] Fase 6: QA Final, Limpieza de CSS y Verificación PWA

---

## 🔤 FASE 1: Verificación de Línea Base y Consolidación del Guionado
- **Objetivo:** Validar los cambios locales existentes (guionado), pasar la suite de pruebas completa y fijar la línea base limpia en git.
- **Archivos involucrados:**
  - `src/client/styles/reader.css`
  - `src/client/lib/settings.ts`
  - `src/client/lib/settings.test.ts`
  - `src/client/lib/epub.ts`
  - `src/client/lib/epub.test.ts`
  - `src/client/components/Reader.tsx`
  - `src/client/components/Vocabulary.test.ts`
- **Tareas:**
  - [x] 1.1 Ejecutar `pnpm vitest run src/client/lib/settings.test.ts src/client/lib/epub.test.ts src/client/components/Reader.test.ts`.
  - [x] 1.2 Ejecutar la suite completa `pnpm test` para asegurar que ningún test preexistente esté roto.
  - [x] 1.3 Verificar que `pnpm run build` compila limpiamente sin errores de TypeScript.
  - [x] 1.4 Hacer commit atómico con los cambios locales de la desactivación de guionado y sanitización de `\u00AD`.
- **Criterio de Aceptación:**
  - Tests en verde y working tree limpio en git.
  - Mensaje de commit: `fix(reader): prevent arbitrary hyphen cuts and add hyphenation setting`

---

## 🎨 FASE 2: Rediseño Moderno de ThemeMenu y Sistema de Opciones
- **Objetivo:** Transformar `ThemeMenu.tsx` en una Bottom Sheet táctil, limpia e intuitiva inspirada en Apple Books.
- **Archivos a intervenir:**
  - `src/client/components/ThemeMenu.tsx`
  - `src/client/components/Sheet.tsx`
  - `src/client/styles/components.css`
  - `src/client/styles/tokens.css`
  - `src/client/lib/settings.ts`
- **Tareas:**
  - [ ] 2.1 Reestructurar `ThemeMenu.tsx` como un panel inferior moderno con esquinas redondeadas, fondo translúcido (`backdrop-blur-md`) y jerarquía visual clara.
  - [ ] 2.2 Implementar selector visual de 4 paletas con muestras circulares:
        - Día Limpio (`#FFFFFF`, texto oscuro)
        - Papel Sepia (`#F8F1E3`, texto cálido)
        - Carbón/Pizarra (`#1F2022`, texto suave)
        - OLED Negro (`#000000`, texto nítido)
  - [ ] 2.3 Controles de lectura de primer nivel:
        - Botones amplios `A-` / `A+` para tamaño de letra.
        - Selector visual de tipografías con vista previa.
        - Deslizadores o toggles para Interlineado (Estrecho, Normal, Amplio) y Márgenes.
        - Switch para el modo de lectura (Paginado horizontal vs. Scroll vertical).
        - Toggle directo para "Permitir separación silábica (Guiones)".
  - [ ] 2.4 Agrupar parámetros técnicos, calibración y depuración en una sección colapsable "Ajustes Avanzados".
- **Criterio de Aceptación:**
  - Las opciones se aplican en tiempo real al lector sin recargas bruscas ni saltos de maquetación.
  - `pnpm run build` compila sin errores.
  - Mensaje de commit: `feat(ui): redesign ThemeMenu into a modern bottom-sheet with tactile controls`

---

## ✨ FASE 3: Animaciones y Micro-interacciones (60 FPS)
- **Objetivo:** Brindar fluidez nativa a las transiciones principales mediante aceleración por GPU (`transform`, `opacity`).
- **Archivos a intervenir:**
  - `src/client/components/Reader.tsx`
  - `src/client/components/WordPanel.tsx`
  - `src/client/components/Sheet.tsx`
  - `src/client/components/Shelf.tsx`
  - `src/client/styles/app.css`
  - `src/client/styles/reader.css`
- **Tareas:**
  - [ ] 3.1 Transición de paso de página en `Reader.tsx`: desplazamiento horizontal suave con curva `cubic-bezier(0.2, 0.8, 0.2, 1)` (160–180 ms) que elimine el salto abrupto de página.
  - [ ] 3.2 Popover flotante en `WordPanel.tsx`: entrada animada (`scale(0.96) -> scale(1)` con opacidad `0 -> 1`) anclada directamente sobre la palabra seleccionada.
  - [ ] 3.3 Soporte de gesto de arrastre en `Sheet.tsx`: implementar cierre por deslizamiento táctil hacia abajo (*swipe to close*).
  - [ ] 3.4 Micro-interacción en `Shelf.tsx`: elevación y suave transición al abrir un libro desde la biblioteca.
- **Criterio de Aceptación:**
  - Transiciones fluidas sin degradación de fotogramas ni desbordamientos horizontales.
  - Mensaje de commit: `feat(animations): add smooth page turns, popovers and swipe-to-dismiss sheet`

---

## ⚡ FASE 4: Optimización Backend (CockroachDB/Hyperdrive y DeepSeek AI Gateway)
- **Objetivo:** Evitar bloqueos de conexión y latencia en Hyperdrive ante sincronizaciones masivas, y blindar llamadas a DeepSeek.
- **Archivos a intervenir:**
  - `src/worker/db.ts`
  - `src/worker/ai.ts`
  - `src/worker/reading-data.ts`
  - `src/worker/ai.test.ts`
- **Tareas:**
  - [ ] 4.1 En `src/worker/db.ts` y endpoints de sincronización, asegurar que las inserciones/actualizaciones masivas de posiciones y palabras se realicen en lotes fragmentados (*chunking* de 100-150 registros) para optimizar el pool de conexiones de Hyperdrive hacia CockroachDB.
  - [ ] 4.2 En `src/worker/ai.ts`, implementar caché de significados frecuentes para evitar llamadas repetidas a DeepSeek.
  - [ ] 4.3 Manejo de timeouts y errores en DeepSeek (AI Gateway): implementar timeout de 8 segundos y reintentos con retraso exponencial; si la IA no responde o devuelve 429/504, degradar limpiamente hacia la definición del catálogo léxico local (`src/worker/lexicon.ts`).
- **Criterio de Aceptación:**
  - `pnpm vitest run src/worker/ai.test.ts` pasa sin errores.
  - La sincronización masiva se ejecuta sin agotar conexiones.
  - Mensaje de commit: `perf(worker): optimize Hyperdrive batching and DeepSeek AI fallback handling`

---

## 💎 FASE 5: Funcionalidades de Alto Valor Agregado
- **Objetivo:** Integrar explicación contextual con IA y exportación hacia Anki y Obsidian/Notion.
- **Archivos a intervenir:**
  - `src/client/components/WordPanel.tsx`
  - `src/client/lib/export.ts`
  - `src/client/lib/export.test.ts`
  - `src/client/components/Vocabulary.tsx`
  - `src/worker/ai.ts`
- **Tareas:**
  - [ ] 5.1 En `WordPanel.tsx`, añadir la acción "Explicar en contexto" que envíe el lema junto con la oración circundante al endpoint de IA para obtener una explicación clara de modismos, figuras retóricas o términos arcaicos.
  - [ ] 5.2 En `src/client/lib/export.ts`, añadir exportación de vocabulario guardado a formato **Anki (.csv)** con campos: `Palabra`, `Definición`, `Contexto (Oración del libro)`.
  - [ ] 5.3 En `src/client/lib/export.ts`, añadir exportación de notas y citas en **Markdown (.md)** estructurado para Obsidian y Notion.
  - [ ] 5.4 En `Vocabulary.tsx`, habilitar modo de repaso FSRS con tarjeta tipo Cloze (oración original con el término oculto).
- **Criterio de Aceptación:**
  - `pnpm vitest run src/client/lib/export.test.ts` pasa con los nuevos formatos probados.
  - La explicación contextual se muestra de forma concisa sin alterar el diseño de `WordPanel`.
  - Mensaje de commit: `feat(value-add): add AI context explanation, Anki/Markdown export, and cloze review`

---

## 🧪 FASE 6: QA Final, Limpieza de CSS y Verificación PWA
- **Objetivo:** Consolidar estilos, resolver advertencias de linting y verificar el funcionamiento offline.
- **Archivos a intervenir:**
  - `src/client/styles/legacy.css`
  - `src/client/styles/app.css`
- **Tareas:**
  - [ ] 6.1 Purgar reglas duplicadas y selectores obsoletos de `legacy.css`.
  - [ ] 6.2 Ejecutar `pnpm lint` y corregir cualquier advertencia.
  - [ ] 6.3 Correr la suite de pruebas completa: `pnpm test`.
  - [ ] 6.4 Validar la compilación para producción con `pnpm run build`.
- **Criterio de Aceptación:**
  - 100% de las pruebas pasando en verde.
  - Compilación de producción limpia sin errores de bundling.
  - Mensaje de commit: `chore: complete quality audit, clean legacy CSS, and finalize PLAN2.md`