# Plan de Modernización y Auditoría - Lecta

Este documento define la hoja de ruta para la modernización de UI, resolución de bugs de lectura y optimización del Edge para Devin con el modelo SWE-2 Max.

---

## 📋 Estado del Proyecto
- [x] Fase 1: Corrección de Guionado y Lectura Limpia
- [ ] Fase 2: Rediseño del Sistema de Opciones y Temas
- [ ] Fase 3: Integración de Animaciones y Micro-interacciones
- [ ] Fase 4: Optimización Cloudflare D1 & Workers AI
- [ ] Fase 5: QA, Pruebas y Limpieza de Código

---

## 🚀 FASE 1: Corrección de Guionado y Lectura Limpia
- **Objetivo:** Evitar que las palabras se corten con un guion (`-`) de forma arbitraria durante la lectura y añadir control al usuario.
- **Archivos a modificar:**
  - `src/client/styles/reader.css`
  - `src/client/lib/epub.ts`
  - `src/client/lib/settings.ts`
  - `src/client/components/Reader.tsx`
- **Tareas:**
  - [x] Añadir regla CSS `hyphens: none !important; -webkit-hyphens: none !important; overflow-wrap: break-word;` en el contenedor del lector.
  - [x] Implementar función en `src/client/lib/epub.ts` para limpiar guiones blandos invisibles (`\u00AD`) si la opción está activada.
  - [x] Añadir setting `enableHyphenation` (boolean, default: `false`) en `settings.ts`.
  - [x] Conectar la clase dinámica o estilo inyectado en `Reader.tsx` según el valor de `enableHyphenation`.
- **Criterio de Aceptación:**
  - El texto en el lector ya no se corta con guiones por defecto.
  - Los tests existentes en `Reader.test.ts` y `settings.test.ts` continúan pasando sin errores.

---

## 🎨 FASE 2: Rediseño del Sistema de Opciones y Temas
- **Objetivo:** Modernizar `ThemeMenu.tsx` y `Dialog.tsx` convirtiéndolos en un panel táctil y amigable estilo Apple Books.
- **Archivos a modificar:**
  - `src/client/components/ThemeMenu.tsx`
  - `src/client/styles/components.css`
  - `src/client/styles/tokens.css`
  - `src/client/lib/settings.ts`
- **Tareas:**
  - [ ] Reestructurar `ThemeMenu.tsx` en una Bottom Sheet moderna con efecto `backdrop-blur`.
  - [ ] Implementar selector visual con 4 paletas: Blanco Puro, Sepia Crema, Gris Carbón y Negro OLED.
  - [ ] Añadir controles deslizantes para: tamaño de fuente (px), interlineado (`line-height`) y márgenes laterales.
  - [ ] Añadir toggle para "Separación silábica (Guiones)".
  - [ ] Mover configuraciones de depuración y parámetros técnicos a un acordeón colapsable "Ajustes avanzados".
- **Criterio de Aceptación:**
  - Los cambios en fuentes, tamaños y colores se reflejan en tiempo real en la pantalla sin parpadeos.
  - `pnpm test` pasa satisfactoriamente.

---

## ✨ FASE 3: Integración de Animaciones y Micro-interacciones
- **Objetivo:** Dar fluidez visual al pasar de página, abrir libros e interactuar con el vocabulario.
- **Archivos a modificar:**
  - `src/client/components/Shelf.tsx`
  - `src/client/components/WordPanel.tsx`
  - `src/client/components/Sheet.tsx`
  - `src/client/styles/app.css`
- **Tareas:**
  - [ ] Integrar transiciones de cambio de página en `Reader.tsx` (desplazamiento sutil con curva bezier suave).
  - [ ] Añadir animación de entrada (`scale` + `fade`) en `WordPanel.tsx` al consultar una palabra.
  - [ ] Añadir soporte de gesto de arrastre para cerrar en `Sheet.tsx` (*swipe down to close*).
  - [ ] Incorporar feedback visual animado en el módulo de repaso de vocabulario (`Vocabulary.tsx` / FSRS).
- **Criterio de Aceptación:**
  - La interfaz se siente fluida a 60 fps en móvil y escritorio.
  - No hay desbordamientos de layout ni saltos bruscos (*layout shifts*).

---

## ⚡ FASE 4: Optimización Cloudflare D1 y Workers AI
- **Objetivo:** Prevenir bloqueos por límites de escritura de D1 y cuotas de Workers AI.
- **Archivos a modificar:**
  - `src/worker/db.ts`
  - `src/worker/ai.ts`
  - `src/worker/reading-data.ts`
- **Tareas:**
  - [ ] Implementar procesamiento por lotes (*batch chunking*) para inserciones masivas en D1 (máximo 150 operaciones por batch).
  - [ ] Implementar caché de respuestas para consultas de vocabulario frecuentes en Workers KV o memoria del Worker.
  - [ ] Manejar respuestas HTTP 429 de Workers AI con reintentos exponenciales y degradación elegante.
- **Criterio de Aceptación:**
  - Las sincronizaciones con D1 no lanzan errores de timeout ni de exceso de parámetros.
  - `pnpm run build` y los tests del worker compilan correctamente.

---

## 🧪 FASE 5: QA, Pruebas y Limpieza de Código
- **Objetivo:** Consolidar estilos, verificar tipado TypeScript y asegurar que la suite de tests pase completa.
- **Tareas:**
  - [ ] Depurar y remover estilos redundantes en `legacy.css`.
  - [ ] Ejecutar `pnpm run lint` y corregir cualquier advertencia.
  - [ ] Ejecutar `pnpm test` y verificar cobertura de los nuevos componentes.
  - [ ] Probar la PWA en modo offline desconectando la red en las DevTools.