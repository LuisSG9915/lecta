# Correo de regreso a los 7 días

Decidido con Luis el 2026-11-24.

## Por qué

Quien deja de leer una semana suele no volver. Un recordatorio con su libro y sus palabras
pendientes es el disparador externo que hoy falta (el resumen semanal es opt-in y casi nadie
lo activa).

## Decisiones de Luis

- **Opt-out**: llega a toda cuenta verificada salvo que se dé de baja con un clic. Se menciona
  en el aviso de privacidad.
- **Frecuencia**: uno por ausencia y como máximo uno cada 30 días.
- **Contenido**: el libro y su progreso, y cuántas palabras del Cuaderno toca repasar.

## Diseño

- **Migración 033** en `lecta_user_plan`: `reengage_opt_out BOOL NOT NULL DEFAULT false` y
  `reengage_sent_at INT8`. Sin la columna el cron no envía nada (tolera 42703).
- **Última actividad** = `max(synced_at)` de posiciones, palabras, repasos, intervalos,
  anotaciones y conocimiento: reloj de servidor, con los índices de la 015.
- **Elegible** (cron diario de las 05:00 UTC): correo verificado y no de prueba (`@smoke.test`,
  `@example.com`, `smoke%`); sin `reengage_opt_out`; última actividad hace **7 a 14 días**
  (decisión mía: una cuenta dormida hace meses no recibe un «te extrañamos» al estrenar la
  función); `reengage_sent_at` nulo o anterior a la última actividad (una vez por ausencia) y
  anterior a hace 30 días. Tope de 200 envíos por corrida.
- **Contenido**: la posición más reciente (`lecta_user_positions`) da libro y progreso; el
  título sale de `user_books` o del índice del catálogo en R2 (`epubSha256`); sin título,
  «tu libro». Palabras por repasar: no borradas, con primera exposición (`presented_at` o
  `reps > 0`) y `card.due` vencido. Botón «Seguir leyendo» a `https://lectal.app/?src=regreso`
  (la estantería abre con el último libro como héroe; no hay enlace directo a un libro).
- **Baja sin columna de token**: el enlace lleva `HMAC-SHA256(BETTER_AUTH_SECRET, "reengage:" +
  userId)`; `GET /api/reengage/unsubscribe?u=&t=` verifica y pone `reengage_opt_out = true`.
- **Envío**: Resend como el resumen semanal; `reengage_sent_at` se escribe solo si Resend
  acepta. Cada fallo es silencioso y no aborta el resto.
- **Aviso de privacidad** (`LegalNotice.tsx`): una línea sobre el correo de regreso y su baja.

## Fuera

Enlace directo a un libro y cuentas que nunca tuvieron actividad. La casilla en «Tú» se agregó
después (`GET/POST /api/reengage/preferences`, tarjeta «Correos de Lecta»).
