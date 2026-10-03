-- Semilla mínima del catálogo para probar el resolver con el EPUB de prueba.
INSERT INTO lexicon_entries (language, lemma, pos, freq_rank) VALUES
  ('es', 'perenne', 'adjetivo', 12000),
  ('es', 'estrecho', 'adjetivo', 3500),
  ('es', 'antiguo', 'adjetivo', 1800),
  ('es', 'casa', 'sustantivo', 120),
  ('es', 'difícil', 'adjetivo', 700),
  ('es', 'despacio', 'adverbio', 2400),
  ('es', 'sección', 'sustantivo', 1900)
ON CONFLICT DO NOTHING;

INSERT INTO lexicon_forms (language, form, entry_id)
SELECT 'es', v.form, e.id
FROM lexicon_entries e
JOIN (VALUES
  ('perenne', 'perenne'),
  ('estrecho', 'estrecho'), ('estrecha', 'estrecho'),
  ('antiguo', 'antiguo'), ('antigua', 'antiguo'),
  ('casa', 'casa'), ('casas', 'casa'),
  ('difícil', 'difícil'),
  ('despacio', 'despacio'),
  ('sección', 'sección'), ('secciones', 'sección')
) AS v(form, lemma) ON e.lemma = v.lemma AND e.language = 'es'
ON CONFLICT DO NOTHING;

INSERT INTO lexicon_senses (entry_id, sense_order, definition, example)
SELECT e.id, 1, v.definition, v.example
FROM lexicon_entries e
JOIN (VALUES
  ('perenne', 'Que dura siempre o por mucho tiempo.', 'El perenne recuerdo de su abuela.'),
  ('estrecho', 'De poca anchura.', 'Un camino estrecho entre las casas.'),
  ('antiguo', 'Que tiene mucho tiempo de existencia.', 'Una casa antigua.'),
  ('casa', 'Edificio donde vive una persona o familia.', 'La casa tenía una puerta estrecha.'),
  ('difícil', 'Que cuesta trabajo entender o hacer.', 'Una palabra difícil.'),
  ('despacio', 'De forma lenta, sin prisa.', 'Leyó despacio.'),
  ('sección', 'Parte en que se divide un escrito.', 'Otra sección del libro.')
) AS v(lemma, definition, example) ON e.lemma = v.lemma AND e.language = 'es'
ON CONFLICT DO NOTHING;
