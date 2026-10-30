-- Añade fracción intra-párrafo (anchor_offset 0..1) para conservar la línea
-- exacta entre dispositivos de distinto ancho de pantalla.
ALTER TABLE lecta_user_positions
  ADD COLUMN IF NOT EXISTS anchor_offset FLOAT8;
