# Auditoría Técnica por Módulos — Lecta (v0.2.12)

**Fecha:** 2026-10-29  
**Objetivo:** Inspección exhaustiva, modular y verificable de la arquitectura y el código de Lecta para identificar huecos (gaps, vulnerabilidades, desbordamientos, fugas de memoria o inconsistencias de estado) y ejecutar las correcciones correspondientes.

---

## 1. Resumen Ejecutivo de la Auditoría

| Módulo | Archivos Principales | Huecos Detectados | Severidad Máxima | Estado |
|---|---|---|---|---|
| **M1: Kindle & E-ink** | `src/worker/kindle/epub-reader.ts`, `routes.ts`, `views.ts` | 3 | **Alta** (Fuga DOM por etiquetas inline desbalanceadas) | En corrección |
| **M2: Lector Web & Persistencia** | `src/client/hooks/useReaderPersistence.ts`, `src/client/lib/reading-location.ts` | 2 | **Media** (Reflujo tardío por imágenes asíncronas) | Verificado |
| **M3: Vocabulario & FSRS** | `src/client/components/Vocabulary.tsx`, `src/client/lib/fsrs.ts` | 2 | **Media** (Fallo de resalte episódico en flexiones) | En corrección |
| **M4: Sync & Offline** | `public/sw.js`, `src/client/lib/sw-register.ts`, `positions-sync.ts` | 1 | **Baja** (Manejo de cursores ante cortes abruptos) | Verificado |
| **M5: Audio & Kitten TTS** | `src/client/lib/kittenModel.ts`, `kitten-tts.worker.ts`, `ttsSpeech.ts` | 1 | **Media** (Inferencia vacía con strings de puntuación) | Verificado |
| **M6: Worker Edge & Seguridad** | `src/worker/kindle/routes.ts`, `client-errors.ts`, `app.ts` | 2 | **Media** (Data-URIs SVG no filtradas en sanitización) | En corrección |

---

## 2. Detalle de Módulos y Huecos Identificados

### MÓDULO 1: Subsistema Kindle & E-ink
- **Hueco 1.1 — Corrupción de etiquetas HTML inline al dividir párrafos largos**
  - **Ubicación:** `src/worker/kindle/epub-reader.ts:509-563` (`splitLongParagraph`).
  - **Mecanismo:** Al dividir oraciones en párrafos extensos mediante límites de puntuación (`(?<=[.!?;:])\s+`), las etiquetas inline abiertas en la primera parte (`<em>`, `<strong>`, `<span>`, `<i>`, `<b>`, `<cite>`) no se cerraban antes de `</p>`. La segunda parte comenzaba con etiquetas huérfanas de cierre (ej. `</em></p>`).
  - **Impacto:** En el navegador experimental de Kindle, las etiquetas no balanceadas provocan que la cursiva o negrita se propague al resto del documento y a la barra de paginación, o rompan el cálculo de altura de línea.
  - **Corrección:** Implementación de un balanceador de etiquetas inline en `splitLongParagraph` que rastrea la pila de etiquetas abiertas (`extractTagStack`), cierra las etiquetas al final de cada fragmento y las reabre con sus atributos exactos al inicio del siguiente.

- **Hueco 1.2 — Ausencia de partición para bloques no-`<p>` (`blockquote`, `div`, `li`)**
  - **Ubicación:** `src/worker/kindle/epub-reader.ts:510`.
  - **Mecanismo:** `splitLongParagraph` verificaba estrictamente `blockHtml.match(/^<p\b.../i)`. Bloques de citas extensas (`<blockquote>...</blockquote>` de 2000+ caracteres comunes en novelas epistolares) se omitían de la partición y se volcaban como un solo bloque.
  - **Impacto:** Desbordamiento vertical de pantalla en Kindle (`scrollHeight > clientHeight`), violando la regla inquebrantable de Zero-Scroll (≤ 650 px).
  - **Corrección:** Generalizar el selector para soportar bloques semánticos de texto (`p`, `blockquote`, `div`, `li`) y fragmentarlos respetando su etiqueta contenedora.

- **Hueco 1.3 — Vector de bypass en data-URIs en sanitización HTML de Kindle**
  - **Ubicación:** `src/worker/kindle/epub-reader.ts:343` (`sanitizeKindleHtml`).
  - **Mecanismo:** La expresión de sanitización solo neutralizaba `data:text/html`. Tipos como `data:image/svg+xml` o `data:application/xhtml+xml` podían colarse en atributos `src` o `href`.
  - **Impacto:** Como `KINDLE_HTML_CSP` permite `img-src 'self' data:;`, un SVG embebido con payload malicioso podía ser interpretado por navegadores vulnerables.
  - **Corrección:** Restringir estrictamente las URIs `data:` a imágenes rasterizadas seguras: `data:image/(jpeg|png|gif|webp|avif)`. Cualquier otro prefijo `data:` se neutraliza a `="#"`.

---

### MÓDULO 2: Lector Web React & Persistencia de Posición
- **Hueco 2.1 — Reflujo tardío por imágenes asíncronas lentas**
  - **Ubicación:** `src/client/lib/reading-location.ts` (`keepAnchorStable`).
  - **Mecanismo:** El observador de estabilidad vigila durante 2.500 ms tras el montaje. Si una imagen pesada termina de cargar en el segundo 3.5 en conexiones 3G/móviles, el reflujo empuja el texto hacia abajo.
  - **Mitigación:** Registrar listeners `load` en elementos `<img>` dentro del contenedor del lector para disparar una micro-reestabilización de ancla solo si el usuario no ha tocado la pantalla.

- **Hueco 2.2 — Pérdida de fracción intra-párrafo en dispositivos cruzados**
  - **Ubicación:** `src/client/lib/positions-sync.ts:209-214`.
  - **Diagnóstico:** El servidor solo almacena el identificador del ancla textual (`anchor`). El cliente local conserva `anchorOffset` cuando la posición remota coincide en `anchor`. Se verifica que si `anchor` cambia, el offset no se aplique a ciegas a un párrafo diferente.

---

### MÓDULO 3: Motor Psicometría, Vocabulario & Cuaderno FSRS
- **Hueco 3.1 — Fallo de resalte en la cita episódica por flexión morfológica**
  - **Ubicación:** `src/client/components/Vocabulary.tsx:369-385` (`renderHighlightedContext`).
  - **Mecanismo:** Búsqueda mediante `lowerContext.indexOf(lowerTarget)`. Si el lema guardado era "correr" y en la novela aparecía la forma conjugada "corrían", o si la forma guardada tenía signos adyacentes, la búsqueda devolvía `-1` y la cita se renderizaba sin ningún resalte visual.
  - **Impacto:** Pérdida de la conexión entre el estudio de la tarjeta y el recuerdo episódico de la lectura.
  - **Corrección:** Incorporar un buscador de raíz morfológica (lexical stem matcher) que, ante fallo de coincidencia exacta, localiza la raíz de la palabra y resalta el token flexionado completo en el pasaje.

- **Hueco 3.2 — Manejo defensivo de estabilidad FSRS en segmentos visuales**
  - **Ubicación:** `src/client/components/Vocabulary.tsx:360-366` (`getStabilitySegments`).
  - **Mecanismo:** Si `s` recibía `NaN`, valores negativos o tipos no numéricos en tarjetas importadas, el cálculo no estaba protegido explícitamente.
  - **Corrección:** Validación de tipo y rango numérico garantizando retorno seguro de 0 segmentos.

---

### MÓDULO 4: Sincronización, Offline & Service Worker
- **Hueco 4.1 — Prevención de tormenta de recargas ante desajuste de assets**
  - **Ubicación:** `src/client/lib/sw-register.ts:13-46` (`shouldAllowReload`).
  - **Diagnóstico:** Se audita el cerrojo de recarga `RELOAD_DEBOUNCE_MS = 15_000` y la clave de sesión `CONTROLLER_RELOAD_KEY`. Se constata que la regla de no recargar en la primera visita (`hadController`) funciona correctamente y no interrumpe la experiencia de usuario inicial.

---

### MÓDULO 5: Motor de Audio & Kitten TTS Neural
- **Hueco 5.1 — Segmentos de audio vacíos con signos tipográficos aislados**
  - **Ubicación:** `src/client/hooks/useReaderTts.ts` y `src/client/workers/kitten-tts.worker.ts`.
  - **Diagnóstico:** Oraciones compuestas únicamente por símbolos (`—`, `«...»`, `[1]`) no deben enviarse al worker ONNX de Kitten TTS para prevenir inferencias de tensor cero.
  - **Verificación:** El segmentador filtra tokens con longitud léxica > 0 antes de encolar en el buffer lookahead N+1.

---

### MÓDULO 6: Backend Worker, Autenticación & Cloudflare Workers Edge
- **Hueco 6.1 — Cabeceras de seguridad complementarias en Kindle / E-ink**
  - **Ubicación:** `src/worker/kindle/routes.ts:836-843`.
  - **Diagnóstico:** Las respuestas HTML incluían `Cache-Control`, `Pragma`, `Expires`, `Content-Security-Policy` y `X-Content-Type-Options: nosniff`.
  - **Corrección:** Añadir `Referrer-Policy: strict-origin-when-cross-origin` para impedir cualquier fuga de cabecera de referencia hacia el exterior en navegadores embebidos.
