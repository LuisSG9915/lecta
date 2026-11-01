---
trigger: always_on
description: Reglas de oro de simplicidad, 1-toque y arquitectura de Kitten TTS para Lecta.
---
# Reglas Inquebrantables de Lecta (Zero-Friction UX)

1. **Inteligencia Invisible (1-Toque)**: Ninguna función psicómetrica (Theta, FSRS, análisis sintáctico) debe mostrar jerga técnica ni bloquear la lectura con modales previos.
2. **Lectura en 0 Segundos**: Tocar un libro en `Shelf.tsx` abre directamente `Reader.tsx`. Prohibido interceptar con `Calibration.tsx`, `BookStart.tsx` o `SectionPreview.tsx` a pantalla completa.
3. **Un Solo Dock Inferior**: En `Reader.tsx` jamás deben coexistir dos barras flotantes inferiores. El Dock único muta suavemente entre Modo Lectura y Modo Audio/TTS.
4. **Kitten TTS Opcional y 100% Funcional**:
   - Por defecto, el TTS usa voces naturales inmediatas (`ttsSpeech.ts`, 0 MB).
   - `kittenTtsEngine.ts` y `kitten-tts.worker.ts` SE MANTIENEN como opción descargable ("Voz Neural HD Offline") almacenada en IndexedDB/CacheStorage tras consentimiento del usuario.
   - Prohibido incluir archivos `.onnx` pesados en el bundle principal del Worker de Cloudflare (< 25 MiB).
   - Implementar pre-síntesis (lookahead buffer de la oración N+1) en `kitten-tts.worker.ts` para eliminar silencios entre frases.
5. **Verificación Continua**: Después de cada cambio en componentes o librerías, ejecuta `pnpm test` (Vitest) y verifica que no existan regresiones de tipos con TypeScript.
6. **Identidad Visible Limpia**: Nunca renderizar hashes, IDs o nombres de archivo técnicos como texto visible en cliente ni en Kindle; pasar siempre por `bookDisplayName` (en cliente) o fallbacks limpios en servidor (`isHashLikeIdentifier` / `humanizeFilename`).
7. **Kindle Zero-Scroll & Pure Paging**:
   - En modo paginado (`layout=paged`, por defecto), 1 página renderizada equivale exactamente a 1 pantalla física del Kindle (≤ 650 px) sin desplazamiento vertical (`scrollHeight <= clientHeight`).
   - Prohibido el scroll vertical en modo paginado en `/k/read`.
   - Prohibida la inyección de notas léxicas al pie de cada página (`.cat-notes-box`); el análisis léxico ocurre exclusivamente en la antesala al inicio del capítulo con filtro estricto Zipf < 4.0.
   - Prohibido envolver palabras en etiquetas `<a>` en el cuerpo del capítulo en `/k/read`; se representan como `<span class="w" data-w="...">` inertes, con interacción léxica vía pulsación larga (450 ms), selección nativa o interruptor `[ 🔍 Consultar ]`, delegando toques simples en zonas táctiles laterales (25% retroceso / 75% avance).
   - La estantería y «Seguir leyendo» nunca fijan `page=` al reanudar: el lector restaura por `anchor`/`ratio` guardados.
   - Ninguna lectura GET inserta una fila de actividad con duración fabricada: solo eventos puntuales veraces (`started_at = ended_at`); la bitácora es append-only por `id`.
   - Sin emoji ni pictogramas en las vistas e-ink (el navegador experimental los dibuja mal o en cajas): texto plano, con el vocabulario de Lecta.
   - Los recursos de léxico y datos no se leen con `node:fs` ni módulos Node en rutas del worker (rompen el bundle de Cloudflare): la frecuencia Zipf vive en `lecta_lexicon` y se consulta por SQL.
   - Las preferencias de lectura del Kindle tienen una única fuente de verdad: `src/shared/kindle-prefs.ts` (valores, normalización y etiquetas). `/k/ajustes`, la API y el panel del celular deben consumirla, nunca duplicar listas.
   - La vista previa del Kindle en el celular se sirve con el render real del servidor (`/k/preview` + `/k/preview/page`): prohibido mantener una maqueta aparte que se desincronice del lector.
   - Los cambios en sanitize, paginación o estructura del artefacto cacheado exigen subir `KINDLE_CHAPTER_CACHE_V` (las entradas viejas caducan solas por versión; no hay purga manual).
