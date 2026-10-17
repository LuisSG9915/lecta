#!/usr/bin/env node
/**
 * Script de configuración de Plan de Trabajo para Google Antigravity (Gemini 3.8 Flash)
 * Uso: node scripts/setup-antigravity.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const mkdir = (dir) => fs.mkdirSync(path.join(root, dir), { recursive: true });
const write = (file, content) => {
  fs.writeFileSync(path.join(root, file), content.trim() + '\n', 'utf8');
  console.log(`✅ Generado: ${file}`);
};

// 1. Crear directorios nativos de Google Antigravity
mkdir('.agents/rules');
mkdir('.agents/skills/lecta-ux-overhaul');
mkdir('.agents/skills/lecta-ux-overhaul/tracks');

// 2. Regla modular de arquitectura en .agents/rules/
write('.agents/rules/lecta-zero-friction.md', `---
trigger: always_on
description: Reglas de oro de simplicidad, 1-toque y arquitectura de Kitten TTS para Lecta.
---
# Reglas Inquebrantables de Lecta (Zero-Friction UX)

1. **Inteligencia Invisible (1-Toque)**: Ninguna función psicómetrica (Theta, FSRS, análisis sintáctico) debe mostrar jerga técnica ni bloquear la lectura con modales previos.
2. **Lectura en 0 Segundos**: Tocar un libro en \`Shelf.tsx\` abre directamente \`Reader.tsx\`. Prohibido interceptar con \`Calibration.tsx\`, \`BookStart.tsx\` o \`SectionPreview.tsx\` a pantalla completa.
3. **Un Solo Dock Inferior**: En \`Reader.tsx\` jamás deben coexistir dos barras flotantes inferiores. El Dock único muta suavemente entre Modo Lectura y Modo Audio/TTS.
4. **Kitten TTS Opcional y 100% Funcional**:
   - Por defecto, el TTS usa voces naturales inmediatas (\`ttsSpeech.ts\`, 0 MB).
   - \`kittenTtsEngine.ts\` y \`kitten-tts.worker.ts\` SE MANTIENEN como opción descargable ("Voz Neural HD Offline") almacenada en IndexedDB/CacheStorage tras consentimiento del usuario.
   - Prohibido incluir archivos \`.onnx\` pesados en el bundle principal del Worker de Cloudflare (< 25 MiB).
   - Implementar pre-síntesis (lookahead buffer de la oración N+1) en \`kitten-tts.worker.ts\` para eliminar silencios entre frases.
5. **Verificación Continua**: Después de cada cambio en componentes o librerías, ejecuta \`pnpm test\` (Vitest) y verifica que no existan regresiones de tipos con TypeScript.
`);

// 3. Skill Principal para invocar con /lecta-ux-overhaul en Antigravity
write('.agents/skills/lecta-ux-overhaul/SKILL.md', `---
name: lecta-ux-overhaul
description: Ejecuta el plan maestro de simplificación UX de Lecta (1-toque), motor Kitten TTS descargable opcional y funciones mágicas de IA con Gemini 3.8 Flash.
---
# Plan Maestro de Implementación: Lecta Zero-Friction + Kitten TTS DLC

Cuando el usuario invoque \`/lecta-ux-overhaul\`, ejecuta este plan paso a paso (o delega cada Track a un subagente usando \`invoke_subagent\`).
**IMPORTANTE PARA GEMINI 3.8 FLASH**: Trabaja un Track a la vez si estás en sesión única, o lanza los Tracks 1 a 5 en el Agent Manager. Al terminar cada Track, ejecuta \`pnpm test\` y usa el navegador integrado de Antigravity para verificar visualmente la UI antes de pasar al siguiente.

- **Track 1 (Onboarding 0s y Calibración Silenciosa)**: Ver @[Track 1](tracks/track-1-onboarding.md)
- **Track 2 (Dock Único, Lienzo Puro y 3 Modos Humanos)**: Ver @[Track 2](tracks/track-2-reader-dock.md)
- **Track 3 (Kitten TTS Funcional Descargable + Lookahead)**: Ver @[Track 3](tracks/track-3-kitten-tts.md)
- **Track 4 (WordPanel 1-Toque, Cuaderno Unificado y Rincón del Gato)**: Ver @[Track 4](tracks/track-4-vocab-cat.md)
- **Track 5 (4 Funciones Mágicas IA + Kindle 4-Letras)**: Ver @[Track 5](tracks/track-5-magic-features.md)
`);

// 4. Track 1: Lectura en 0s y Calibración Silenciosa
write('.agents/skills/lecta-ux-overhaul/tracks/track-1-onboarding.md', `
# Track 1: Lectura en 0 Segundos y Calibración Silenciosa

## Archivos Objetivo
- \`src/client/App.tsx\`
- \`src/client/components/Reader.tsx\`
- \`src/client/components/SectionPreview.tsx\`
- \`src/client/lib/calibration.ts\`
- \`src/client/lib/knowledge.ts\`

## Instrucciones de Implementación
1. **Eliminar los 3 peajes de entrada**:
   - En \`App.tsx\` y \`Shelf.tsx\`, al seleccionar un libro, navega directamente a \`Reader.tsx\` en 0 segundos.
   - Desactiva la intercepción obligatoria de \`Calibration.tsx\` y \`BookStart.tsx\`.
2. **Pórtico "Antes de leer" como Pastilla Discreta**:
   - Convierte \`SectionPreview.tsx\` en una pastilla (*pill*) discreta y no intrusiva arriba del título del capítulo dentro del lector: \`"✨ X palabras clave en este capítulo · Ver"\`. Solo si el usuario la toca, se despliega el detalle.
3. **Calibración Silenciosa e Invisible**:
   - Inicializa el nivel $\\theta$ del usuario en un valor neutro en \`calibration.ts\` / \`profile-models.ts\`.
   - Alimenta el algoritmo automáticamente: cuando el usuario toca una palabra en \`Reader.tsx\` o la guarda en su cuaderno, actualiza su perfil con señal negativa (palabra desconocida); cuando avanza de página tras lectura normal sin consultar palabras difíciles de esa página, aplica actualización pasiva positiva en \`knowledge.ts\`.
4. **Verificación**: Actualiza \`App.test.ts\`, \`Calibration.test.ts\` y \`SectionPreview.test.ts\`. Ejecuta \`pnpm test\`.
`);

// 5. Track 2: Dock Inteligente, Lienzo Puro y 3 Modos
write('.agents/skills/lecta-ux-overhaul/tracks/track-2-reader-dock.md', `
# Track 2: Dock Inferior Único, Lienzo Puro y 3 Modos de Lectura

## Archivos Objetivo
- \`src/client/components/Reader.tsx\`
- \`src/client/components/ReaderMoreMenu.tsx\`
- \`src/client/components/TtsNowPlaying.tsx\`
- \`src/client/lib/settings.ts\`
- \`src/client/styles/reader.css\`

## Instrucciones de Implementación
1. **Unificar Barras en un Único "Dock Inteligente"**:
   - Elimina la superposición entre \`TtsNowPlaying.tsx\` y el dock de \`Reader.tsx\`.
   - Crea un único componente de Dock inferior con transición suave de estado:
     - **Estado Lectura**: \`Cap. X · ~Y min | Modo de Enfoque | 🐱 Gato\`.
     - **Estado Audio / Ritmo**: Se transforma en el mismo lugar para mostrar \`⏯ Play/Pausa | 1.0x | 🎙️ Voz | ✕ Volver a lectura\`.
2. **Modo "Lienzo Puro"**:
   - Un toque simple en una zona vacía de \`Reader.tsx\` (detectado limpiamente en \`use-page-gesture.ts\` sin interferir con selección de palabras ni doble toque) oculta la barra superior y el Dock inferior, dejando solo el texto y al gato miniatura en la esquina.
3. **3 Modos con Nombres Humanos (1 Clic)**:
   - En \`settings.ts\` y \`ReaderMoreMenu.tsx\`, reemplaza la lista de switches técnicos por 3 tarjetas/botones de 1 clic:
     1. \`📖 Lectura Limpia\` (Editorial clásico, todas las ayudas visuales apagadas).
     2. \`⚡ Enfoque TDAH\` (Activa foco de párrafo nítido + anclas sutiles).
     3. \`🌊 Ritmo Guiado\` (Activa líneas sintácticas + guía cromática de alto contraste).
   - Deja un botón secundario \`"Personalizar..."\` que despliegue los switches individuales para usuarios avanzados, evitando que dos modos incompatibles se oscurezcan entre sí en \`reader.css\`.
4. **Verificación**: Ejecuta los tests \`Reader.test.ts\`, \`ReaderMoreMenu.test.ts\` y \`TtsNowPlaying.test.ts\`.
`);

// 6. Track 3: Motor Kitten TTS Funcional y Descargable
write('.agents/skills/lecta-ux-overhaul/tracks/track-3-kitten-tts.md', `
# Track 3: Motor Kitten TTS 100% Funcional y Descargable (DLC Offline)

## Archivos Objetivo
- \`src/client/lib/kittenTtsEngine.ts\`
- \`src/client/lib/kittenVoicesData.ts\`
- \`src/client/workers/kitten-tts.worker.ts\`
- \`src/client/lib/ttsController.ts\`
- \`src/client/lib/ttsSpeech.ts\`
- \`src/client/components/TtsConsentDialog.tsx\`

## Instrucciones de Implementación
1. **Arquitectura Dual (Instantánea por defecto + Kitten Neural Opcional)**:
   - En \`ttsController.ts\`, usa \`ttsSpeech.ts\` (voces Natural/Neural del sistema) como motor por defecto (0 MB) para reproducción instantánea.
   - Conserva y perfecciona \`kittenTtsEngine.ts\` y \`kitten-tts.worker.ts\` como motor **"Voz Neural HD (Offline)"** opcional.
2. **Descarga Bajo Demanda con Progreso Real y Caché Persistente**:
   - El modelo ONNX (~24 MB) y los embeddings de \`kittenVoicesData.ts\` jamás deben bloquear la carga inicial ni superar el límite de 25 MiB del Worker.
   - En \`TtsConsentDialog.tsx\` (o desde el selector de voz del Dock), permite al usuario descargar el motor Kitten TTS mostrando porcentaje de descarga (\`ReadableStream\` progress), almacenándolo en \`CacheStorage\` / IndexedDB para uso 100% offline. Incluye opción de "Borrar datos de voz (24 MB)" en ajustes.
3. **Pre-síntesis Inteligente (Lookahead Buffer N+1)**:
   - En \`ttsController.ts\` y \`kitten-tts.worker.ts\`, mientras se reproduce la oración actual $N$, envía automáticamente la oración $N+1$ al Web Worker para pre-sintetizar su \`AudioBuffer\`. Esto elimina por completo los silencios metálicos o pausas entre oraciones.
   - Asegura limpieza de memoria WASM/ONNX cuando se detiene el reproductor.
4. **Verificación**: Ejecuta \`tts.test.ts\` y \`TtsConsentDialog.test.ts\`.
`);

// 7. Track 4: WordPanel 1-Toque, Cuaderno y Gato
write('.agents/skills/lecta-ux-overhaul/tracks/track-4-vocab-cat.md', `
# Track 4: WordPanel en 1 Paso, Cuaderno Unificado y Rincón del Gato

## Archivos Objetivo
- \`src/client/components/WordPanel.tsx\`
- \`src/client/components/Vocabulary.tsx\`
- \`src/client/components/CompanionPanel.tsx\`
- \`src/client/components/CompanionStage.tsx\`
- \`src/client/components/CompanionCloset.tsx\`

## Instrucciones de Implementación
1. **Tarjeta Única de Respuesta Inmediata (\`WordPanel.tsx\`)**:
   - Elimina la fragmentación de 4 clics ("Definir con IA" -> "Profundizar" -> "Explicar en este pasaje").
   - Al tocar una palabra (ES o EN), muestra inmediatamente en una sola tarjeta limpia:
     1) Significado corto + sinónimos del diccionario local (\`lexicon.ts\` / \`offline-dictionary.ts\`).
     2) Explicación contextual automática ("En esta frase significa...") solicitada en paralelo a \`/api/ai\` con caché local/D1.
2. **Cuaderno Unificado + "Repaso de 1 Minuto" (\`Vocabulary.tsx\`)**:
   - Simplifica las múltiples pestañas en una sola vista limpia con buscador instantáneo de palabras guardadas.
   - Coloca un CTA principal prominente: \`"🎮 Repaso rápido (5 palabras)"\` que seleccione automáticamente las 5 palabras prioritarias según \`fsrs.ts\` y lance la dinámica más amena (\`GamePanel.tsx\` / \`WordScrambleGame.tsx\` / \`SentenceBuilderGame.tsx\`).
3. **Simplificar "El Rincón de tu Gato" (\`CompanionPanel.tsx\`)**:
   - Al tocar al gato, abre un único panel amigable con solo 2 pestañas claras: **Mi Progreso** (integrando racha y recorrido) y **Personalizar Gato** (integrando \`CompanionCloset.tsx\` y \`CompanionStage.tsx\`).
4. **Verificación**: Ejecuta \`WordPanel.test.ts\`, \`Vocabulary.test.ts\` y \`CompanionPanel.test.ts\`.
`);

// 8. Track 5: 4 Funciones de Valor Agregado (IA + Kindle)
write('.agents/skills/lecta-ux-overhaul/tracks/track-5-magic-features.md', `
# Track 5: Las 4 Funciones Mágicas de Valor Agregado

## Archivos Objetivo
- \`src/client/lib/page-recap.ts\` y \`src/client/lib/reading-activity.ts\`
- \`src/client/lib/book-search.ts\`
- \`src/client/components/Reader.tsx\`
- \`src/worker/ai.ts\` y \`src/worker/app.ts\`
- \`src/worker/kindle/routes.ts\` y \`src/worker/kindle/views.ts\`

## Instrucciones de Implementación
1. **🐱 "¿En qué me quedé?" (Resumen de Regreso sin Spoilers en 1 toque)**:
   - Si el usuario abre un libro después de $>6$ horas de inactividad (\`reading-activity.ts\`), muestra una burbuja discreta del gato arriba: \`"🐱 ¿Te recuerdo en 15 segundos qué estaba pasando?"\`.
   - Al tocarla, usa \`page-recap.ts\` leyendo exclusivamente las últimas 3 páginas ya leídas y muestra 3 viñetas cortas generadas por IA.
2. **👥 "¿Quién está en esta página?" (Tarjetas de Personajes anti-spoilers)**:
   - Agrega el botón rápido \`"👥 Personajes en esta página"\` en el menú rápido del gato dentro del lector.
   - Extrae los nombres propios (capitalizados) de la página visible, busca sus menciones **únicamente en páginas/capítulos anteriores al actual** usando \`book-search.ts\` (bloqueo estricto anti-spoilers) y genera una lista de 1 línea por personaje/lugar.
3. **🌍 "Doble Toque para Traducir Párrafo" (Lectura Bilingüe Fluida)**:
   - Cuando el idioma del libro sea inglés (\`language === 'en'\`), hacer doble toque sobre cualquier párrafo inyecta o despliega justo debajo la traducción natural al español en cursiva suave, sin abrir modales ni perder la posición de lectura.
4. **📲 Vinculación Instantánea con Kindle mediante Código de 4 Letras**:
   - En \`src/worker/kindle/routes.ts\` y \`views.ts\`, al entrar a \`/kindle\` sin sesión, genera y muestra un código grande de 4 caracteres alfanuméricos claros (ej. \`K7M4\`).
   - En \`Account.tsx\` (en el móvil/PC con sesión activa), añade un botón \`"Conectar mi Kindle"\` donde el usuario ingresa las 4 letras, vinculando la sesión del Kindle automáticamente y redirigiéndolo a la página exacta de su libro actual.
5. **Verificación**: Ejecuta \`page-recap.test.ts\`, \`book-search.test.ts\`, \`ai.test.ts\` y \`src/worker/kindle/routes.test.ts\`.
`);

console.log('\\n🚀 Configuración para Google Antigravity completada con éxito.');