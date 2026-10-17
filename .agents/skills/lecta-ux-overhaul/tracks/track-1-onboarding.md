# Track 1: Lectura en 0 Segundos y Calibración Silenciosa

## Archivos Objetivo
- `src/client/App.tsx`
- `src/client/components/Reader.tsx`
- `src/client/components/SectionPreview.tsx`
- `src/client/lib/calibration.ts`
- `src/client/lib/knowledge.ts`

## Instrucciones de Implementación
1. **Eliminar los 3 peajes de entrada**:
   - En `App.tsx` y `Shelf.tsx`, al seleccionar un libro, navega directamente a `Reader.tsx` en 0 segundos.
   - Desactiva la intercepción obligatoria de `Calibration.tsx` y `BookStart.tsx`.
2. **Pórtico "Antes de leer" como Pastilla Discreta**:
   - Convierte `SectionPreview.tsx` en una pastilla (*pill*) discreta y no intrusiva arriba del título del capítulo dentro del lector: `"✨ X palabras clave en este capítulo · Ver"`. Solo si el usuario la toca, se despliega el detalle.
3. **Calibración Silenciosa e Invisible**:
   - Inicializa el nivel $\theta$ del usuario en un valor neutro en `calibration.ts` / `profile-models.ts`.
   - Alimenta el algoritmo automáticamente: cuando el usuario toca una palabra en `Reader.tsx` o la guarda en su cuaderno, actualiza su perfil con señal negativa (palabra desconocida); cuando avanza de página tras lectura normal sin consultar palabras difíciles de esa página, aplica actualización pasiva positiva en `knowledge.ts`.
4. **Verificación**: Actualiza `App.test.ts`, `Calibration.test.ts` y `SectionPreview.test.ts`. Ejecuta `pnpm test`.
