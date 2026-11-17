-- Pronunciación IPA del catálogo léxico (Fase 1 del plan IPA + pronunciación).
-- Columna nullable: solo lemas frecuentes (zipf >= 3) llevan IPA.
-- El catálogo es compartido (lecta_dev) y se lee cross-DB desde prod.

ALTER TABLE lexicon_entries ADD COLUMN IF NOT EXISTS ipa STRING;
