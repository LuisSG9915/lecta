# Track 3: Motor Kitten TTS 100% Funcional y Descargable (DLC Offline)

## Archivos Objetivo
- `src/client/lib/kittenTtsEngine.ts`
- `src/client/lib/kittenVoicesData.ts`
- `src/client/workers/kitten-tts.worker.ts`
- `src/client/lib/ttsController.ts`
- `src/client/lib/ttsSpeech.ts`
- `src/client/components/TtsConsentDialog.tsx`

## Instrucciones de Implementación
1. **Arquitectura Dual (Instantánea por defecto + Kitten Neural Opcional)**:
   - En `ttsController.ts`, usa `ttsSpeech.ts` (voces Natural/Neural del sistema) como motor por defecto (0 MB) para reproducción instantánea.
   - Conserva y perfecciona `kittenTtsEngine.ts` y `kitten-tts.worker.ts` como motor **"Voz Neural HD (Offline)"** opcional.
2. **Descarga Bajo Demanda con Progreso Real y Caché Persistente**:
   - El modelo ONNX (~24 MB) y los embeddings de `kittenVoicesData.ts` jamás deben bloquear la carga inicial ni superar el límite de 25 MiB del Worker.
   - En `TtsConsentDialog.tsx` (o desde el selector de voz del Dock), permite al usuario descargar el motor Kitten TTS mostrando porcentaje de descarga (`ReadableStream` progress), almacenándolo en `CacheStorage` / IndexedDB para uso 100% offline. Incluye opción de "Borrar datos de voz (24 MB)" en ajustes.
3. **Pre-síntesis Inteligente (Lookahead Buffer N+1)**:
   - En `ttsController.ts` y `kitten-tts.worker.ts`, mientras se reproduce la oración actual $N$, envía automáticamente la oración $N+1$ al Web Worker para pre-sintetizar su `AudioBuffer`. Esto elimina por completo los silencios metálicos o pausas entre oraciones.
   - Asegura limpieza de memoria WASM/ONNX cuando se detiene el reproductor.
4. **Verificación**: Ejecuta `tts.test.ts` y `TtsConsentDialog.test.ts`.
