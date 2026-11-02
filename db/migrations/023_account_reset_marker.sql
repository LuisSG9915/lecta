-- 023_account_reset_marker.sql: sello del último reinicio de datos de
-- cada cuenta.
--
-- El reset borra todas las filas de usuario sin lápidas: sin esta
-- fila, otro dispositivo con copia local no tiene forma de saber que
-- la cuenta se vació y vuelve a subir lo que la persona acababa de
-- borrar (los PUTs solo comparan updatedAt contra su cursor). El sello
-- vive en una tabla aparte justamente para sobrevivir al DELETE del
-- reset y poder leerse antes de aceptar otra escritura.
CREATE TABLE IF NOT EXISTS lecta_account_state (
  user_id STRING PRIMARY KEY,
  reset_at INT8 NOT NULL
);
