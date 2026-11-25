# Sonda de cambios para la sincronización

Elegido por Luis el 2026-11-24 (opción B frente al endpoint único `POST /api/sync`).

## Por qué

`runFullSync` lanza en paralelo unas 8 peticiones por ciclo (palabras, anotaciones,
actividad, repasos, compañero, conocimiento, posiciones, libros), aunque nada haya cambiado
en el servidor. Cada una abre conexión por Hyperdrive y consume RU en CockroachDB Basic.

## Diseño

- **`GET /api/sync/changes`** (worker, `vocab-sync.ts`): una sola sentencia devuelve el
  `max(synced_at)` de la cuenta por clave de cursor del cliente: `vocab:<idioma>` (palabras
  por idioma), `annotations`, `activity`, `reviews`, `positions` y `knowledge`. Sin filas, la
  clave no aparece (equivale a 0). Usa los índices `(user_id, …, synced_at)` de la 015.
- **Cliente**: `runFullSync` pide la sonda primero y la publica en `sync-changes.ts`. Cada
  pull consulta `canSkipPull(clave, cursor)`: salta la descarga solo si la sonda es fresca
  (≤ 30 s), el cursor es > 0 y el sello del servidor es ≤ cursor. El push de lo local no se
  salta nunca. Si la sonda falla, todo sigue como hoy.
- **Correcto por construcción**: el cursor de pull es `queryStart − 5 s` (o `serverTime`) y
  `synced_at` es reloj de servidor al escribir; cualquier fila escrita después del último pull
  tiene `synced_at` > cursor y obliga a descargar. Escrituras propias también disparan un pull
  (inofensivo).
- **Pushes en serie**: las colecciones de `runFullSync` corren una tras otra, no en paralelo,
  para que sus escrituras no compitan por el `SELECT … FOR UPDATE` de `withResetGuard`.
- **Fuera**: el compañero (`/api/companion`, tablas sin `synced_at`) y la cola de libros
  siguen igual.

## Riesgo principal

Saltar un pull no debe mover el cursor: cada función de sync conserva su cursor cuando no
hubo petición. Lo vigila una prueba por colección.
