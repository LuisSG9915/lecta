# Track 5: Las 4 Funciones Mágicas de Valor Agregado

## Archivos Objetivo
- `src/client/lib/page-recap.ts` y `src/client/lib/reading-activity.ts`
- `src/client/lib/book-search.ts`
- `src/client/components/Reader.tsx`
- `src/worker/ai.ts` y `src/worker/app.ts`
- `src/worker/kindle/routes.ts` y `src/worker/kindle/views.ts`

## Instrucciones de Implementación
1. **🐱 "¿En qué me quedé?" (Resumen de Regreso sin Spoilers en 1 toque)**:
   - Si el usuario abre un libro después de $>6$ horas de inactividad (`reading-activity.ts`), muestra una burbuja discreta del gato arriba: `"🐱 ¿Te recuerdo en 15 segundos qué estaba pasando?"`.
   - Al tocarla, usa `page-recap.ts` leyendo exclusivamente las últimas 3 páginas ya leídas y muestra 3 viñetas cortas generadas por IA.
2. **👥 "¿Quién está en esta página?" (Tarjetas de Personajes anti-spoilers)**:
   - Agrega el botón rápido `"👥 Personajes en esta página"` en el menú rápido del gato dentro del lector.
   - Extrae los nombres propios (capitalizados) de la página visible, busca sus menciones **únicamente en páginas/capítulos anteriores al actual** usando `book-search.ts` (bloqueo estricto anti-spoilers) y genera una lista de 1 línea por personaje/lugar.
3. **🌍 "Doble Toque para Traducir Párrafo" (Lectura Bilingüe Fluida)**:
   - Cuando el idioma del libro sea inglés (`language === 'en'`), hacer doble toque sobre cualquier párrafo inyecta o despliega justo debajo la traducción natural al español en cursiva suave, sin abrir modales ni perder la posición de lectura.
4. **📲 Vinculación Instantánea con Kindle mediante Código de 4 Letras**:
   - En `src/worker/kindle/routes.ts` y `views.ts`, al entrar a `/kindle` sin sesión, genera y muestra un código grande de 4 caracteres alfanuméricos claros (ej. `K7M4`).
   - En `Account.tsx` (en el móvil/PC con sesión activa), añade un botón `"Conectar mi Kindle"` donde el usuario ingresa las 4 letras, vinculando la sesión del Kindle automáticamente y redirigiéndolo a la página exacta de su libro actual.
5. **Verificación**: Ejecuta `page-recap.test.ts`, `book-search.test.ts`, `ai.test.ts` y `src/worker/kindle/routes.test.ts`.
