# Track 4: WordPanel en 1 Paso, Cuaderno Unificado y Rincón del Gato

## Archivos Objetivo
- `src/client/components/WordPanel.tsx`
- `src/client/components/Vocabulary.tsx`
- `src/client/components/CompanionPanel.tsx`
- `src/client/components/CompanionStage.tsx`
- `src/client/components/CompanionCloset.tsx`

## Instrucciones de Implementación
1. **Tarjeta Única de Respuesta Inmediata (`WordPanel.tsx`)**:
   - Elimina la fragmentación de 4 clics ("Definir con IA" -> "Profundizar" -> "Explicar en este pasaje").
   - Al tocar una palabra (ES o EN), muestra inmediatamente en una sola tarjeta limpia:
     1) Significado corto + sinónimos del diccionario local (`lexicon.ts` / `offline-dictionary.ts`).
     2) Explicación contextual automática ("En esta frase significa...") solicitada en paralelo a `/api/ai` con caché local/D1.
2. **Cuaderno Unificado + "Repaso de 1 Minuto" (`Vocabulary.tsx`)**:
   - Simplifica las múltiples pestañas en una sola vista limpia con buscador instantáneo de palabras guardadas.
   - Coloca un CTA principal prominente: `"🎮 Repaso rápido (5 palabras)"` que seleccione automáticamente las 5 palabras prioritarias según `fsrs.ts` y lance la dinámica más amena (`GamePanel.tsx` / `WordScrambleGame.tsx` / `SentenceBuilderGame.tsx`).
3. **Simplificar "El Rincón de tu Gato" (`CompanionPanel.tsx`)**:
   - Al tocar al gato, abre un único panel amigable con solo 2 pestañas claras: **Mi Progreso** (integrando racha y recorrido) y **Personalizar Gato** (integrando `CompanionCloset.tsx` y `CompanionStage.tsx`).
4. **Verificación**: Ejecuta `WordPanel.test.ts`, `Vocabulary.test.ts` y `CompanionPanel.test.ts`.
