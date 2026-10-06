# 📖 PLAN DE TRABAJO REAL - LECTA (SWE-2 Max)

Este archivo es la única fuente de verdad para Devin.
Reglas de operación:
1. Respetar las reglas de `.devin/rules/lecta-workflow.md` y `AGENTS.md`.
2. Completar una fase a la vez de forma secuencial y verificar mediante comandos de terminal.
3. Actualizar los checkboxes `[x]` y hacer un git commit atómico al cerrar cada fase.

---

## 📊 Progreso General
- [ ] Fase 1: Verificación de Línea Base y Consolidación del Guionado
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
  - [ ] 1.1 Ejecutar `pnpm vitest run src/client/lib/settings.test.ts src/client/lib/epub.test.ts src/client/components/Reader.test.ts`.
  - [ ] 1.2 Ejecutar la suite completa `pnpm test` para asegurar que ningún test preexistente esté roto.
  - [ ] 1.3 Verificar que `pnpm run build` compila limpiamente sin errores de TypeScript.
  - [ ] 1.4 Hacer commit atómico con los cambios locales de la desactivación de guionado y sanitización de `\u00AD`.
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
  - [ ] 3.4 Micro-interacción en `Shelf.tsx`: elev