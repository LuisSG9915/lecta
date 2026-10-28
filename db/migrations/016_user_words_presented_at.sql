-- 016_user_words_presented_at.sql: sello de primera exposición por palabra.
--
-- La ficha de «Aprender» vive en el dispositivo (`learnExposure:v1`) y no
-- viajaba al servidor: en un equipo nuevo, una palabra que ya se presentó pero
-- todavía no se repasó volvía a ofrecerse en la ficha. `presented_at` guarda el
-- sello (ms del cliente, acotado al reloj del servidor en el worker) para que la
-- decisión viaje con la palabra. No cambia la agenda FSRS: la tarjeta sigue
-- siendo la de ts-fsrs.
--
-- Migración y worker van JUNTOS: el worker nuevo escribe y lee esta columna, así
-- que aplicarla antes de desplegar es obligatorio; con la columna y el worker
-- viejo no se rompe nada (el pull por `synced_at` sigue igual).
--
-- En CockroachDB, si `lecta_user_words` tiene `schema_locked=true`, el migrador
-- falla rápido: desbloquéala solo para esta sentencia, migra y vuelve a
-- bloquearla. Un job `SCHEMA CHANGE GC` en la cola (tras un DROP) puede retener
-- el ALTER hasta que expire el TTL de la base: mira `SHOW JOBS` antes de tocar
-- nada.

ALTER TABLE lecta_user_words ADD COLUMN IF NOT EXISTS presented_at BIGINT;
