---
name: lecta-ux-overhaul
description: Ejecuta el plan maestro de simplificación UX de Lecta (1-toque), motor Kitten TTS descargable opcional y funciones mágicas de IA con Gemini 3.8 Flash.
---
# Plan Maestro de Implementación: Lecta Zero-Friction + Kitten TTS DLC

Cuando el usuario invoque `/lecta-ux-overhaul`, ejecuta este plan paso a paso (o delega cada Track a un subagente usando `invoke_subagent`).
**IMPORTANTE PARA GEMINI 3.8 FLASH**: Trabaja un Track a la vez si estás en sesión única, o lanza los Tracks 1 a 5 en el Agent Manager. Al terminar cada Track, ejecuta `pnpm test` y usa el navegador integrado de Antigravity para verificar visualmente la UI antes de pasar al siguiente.

- **Track 1 (Onboarding 0s y Calibración Silenciosa)**: Ver @[Track 1](tracks/track-1-onboarding.md)
- **Track 2 (Dock Único, Lienzo Puro y 3 Modos Humanos)**: Ver @[Track 2](tracks/track-2-reader-dock.md)
- **Track 3 (Kitten TTS Funcional Descargable + Lookahead)**: Ver @[Track 3](tracks/track-3-kitten-tts.md)
- **Track 4 (WordPanel 1-Toque, Cuaderno Unificado y Rincón del Gato)**: Ver @[Track 4](tracks/track-4-vocab-cat.md)
- **Track 5 (4 Funciones Mágicas IA + Kindle 4-Letras)**: Ver @[Track 5](tracks/track-5-magic-features.md)
- **Track 6 (Pre-lectura Adaptativa y Multilingüe - Umbral del Capítulo)**: Ver @[Track 6](tracks/track-6-adaptive-chapter-priming.md)

