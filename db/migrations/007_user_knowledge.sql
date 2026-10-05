-- Modelo de conocimiento por cuenta: qué lemas sabe el lector y
-- cuáles no. Una fila por (user_id, language, lemma); `source` dice de
-- dónde vino la evidencia (calibración inicial, «ya la conozco» o
-- inferida de sus actos) y updated_at arbitra entre dispositivos como
-- en vocabulario y anotaciones, con lápidas para propagar borrados.
CREATE TABLE IF NOT EXISTS lecta_user_knowledge (
  user_id STRING NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  language STRING NOT NULL,
  lemma STRING NOT NULL,
  known BOOL NOT NULL,
  source STRING NOT NULL,
  updated_at INT8 NOT NULL,
  deleted BOOL NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, language, lemma)
);
