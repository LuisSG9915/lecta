# Track 2: Dock Inferior Único, Lienzo Puro y 3 Modos de Lectura

## Archivos Objetivo
- `src/client/components/Reader.tsx`
- `src/client/components/ReaderMoreMenu.tsx`
- `src/client/components/TtsNowPlaying.tsx`
- `src/client/lib/settings.ts`
- `src/client/styles/reader.css`

## Instrucciones de Implementación
1. **Unificar Barras en un Único "Dock Inteligente"**:
   - Elimina la superposición entre `TtsNowPlaying.tsx` y el dock de `Reader.tsx`.
   - Crea un único componente de Dock inferior con transición suave de estado:
     - **Estado Lectura**: `Cap. X · ~Y min | Modo de Enfoque | 🐱 Gato`.
     - **Estado Audio / Ritmo**: Se transforma en el mismo lugar para mostrar `⏯ Play/Pausa | 1.0x | 🎙️ Voz | ✕ Volver a lectura`.
2. **Modo "Lienzo Puro"**:
   - Un toque simple en una zona vacía de `Reader.tsx` (detectado limpiamente en `use-page-gesture.ts` sin interferir con selección de palabras ni doble toque) oculta la barra superior y el Dock inferior, dejando solo el texto y al gato miniatura en la esquina.
3. **3 Modos con Nombres Humanos (1 Clic)**:
   - En `settings.ts` y `ReaderMoreMenu.tsx`, reemplaza la lista de switches técnicos por 3 tarjetas/botones de 1 clic:
     1. `📖 Lectura Limpia` (Editorial clásico, todas las ayudas visuales apagadas).
     2. `⚡ Enfoque TDAH` (Activa foco de párrafo nítido + anclas sutiles).
     3. `🌊 Ritmo Guiado` (Activa líneas sintácticas + guía cromática de alto contraste).
   - Deja un botón secundario `"Personalizar..."` que despliegue los switches individuales para usuarios avanzados, evitando que dos modos incompatibles se oscurezcan entre sí en `reader.css`.
4. **Verificación**: Ejecuta los tests `Reader.test.ts`, `ReaderMoreMenu.test.ts` y `TtsNowPlaying.test.ts`.
