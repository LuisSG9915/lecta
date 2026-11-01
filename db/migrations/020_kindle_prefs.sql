-- 020_kindle_prefs.sql: preferencias de lectura Kindle por cuenta.
--
-- El Kindle se configura desde el celular (K8) y lee aquí sus ajustes
-- (tipografía, tamaño, interlineado, margen, alineación, enfoque y layout).
-- Una fila por usuario; el worker hace UPSERT y cae a defaults si la tabla
-- no existe todavía, así que puede desplegarse antes que esta migración.
-- Migraciones nuevas van solo a `lecta_dev` salvo autorización expresa.

CREATE TABLE IF NOT EXISTS lecta_kindle_prefs (
  user_id      STRING NOT NULL,
  font_family  STRING NOT NULL DEFAULT 'literata',
  font_size    STRING NOT NULL DEFAULT 'md',
  line_height  STRING NOT NULL DEFAULT 'normal',
  margin       STRING NOT NULL DEFAULT 'md',
  align        STRING NOT NULL DEFAULT 'justify',
  approach     STRING NOT NULL DEFAULT 'clean',
  layout       STRING NOT NULL DEFAULT 'paged',
  updated_at   INT8 NOT NULL,
  synced_at    INT8 NOT NULL,
  CONSTRAINT pk_lecta_kindle_prefs PRIMARY KEY (user_id)
);
