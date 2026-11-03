# Datos léxicos de Lecta

Tablas derivadas que Lecta publica para cumplir las licencias de sus fuentes. Se
sirven desde la propia aplicación (`/lexicon/…`), sin depender de repositorios
externos.

## `forms-es.tsv.gz` — forma → lema

- **Contenido:** 665 732 pares `forma<TAB>lema`, uno por línea, sin cabecera, UTF-8.
- **Origen:** *Lemmatization Lists* de Michal Měchura, disponibles bajo la **Open
  Database License (ODbL) 1.0**.
- **Derivación:** se parte del diccionario `es` de LemmaGen (`es.plzma`, vía
  *simplemma* 1.1.2), se agrupan los pares forma→lema y se exportan a TSV con
  `scripts/lexicon-export.py`; el resultado se comprime con `gzip -9`. No se añaden
  columnas ni se filtra por frecuencia.
- **Licencia:** ODbL 1.0. Se mantienen intactos los avisos de la fuente y se ofrece
  la base de datos completa sin medidas técnicas restrictivas (§4.3 y §4.6 de la
  licencia). Este archivo es la URI de descarga pública.
- **SHA-256 del `.gz`:**
  `a57100f59e4ecde9a03aad5d9eb325a83873ec39222f713b2f058fc2103eef9a`
- **Generado:** 2026-10-22.
- **Regenerar:**
  ```bash
  python3 -m venv /tmp/lecta-lex-env
  /tmp/lecta-lex-env/bin/pip install simplemma==1.1.2 wordfreq==3.1.1
  /tmp/lecta-lex-env/bin/python3 scripts/lexicon-export.py
  gzip -9 -c data/lexicon/es-forms.tsv > public/lexicon/forms-es.tsv.gz
  ```

## `lemmas-freq-es.tsv.gz` — lema → zipf

- **Contenido:** 71 646 pares `lema<TAB>zipf`, sin cabecera, UTF-8. El valor es la
  frecuencia zipf (0–8) redondeada a dos decimales.
- **Origen:** *wordfreq* de Robyn Speer, bajo **CC BY-SA 4.0**. wordfreq agrega
  Google Books Ngrams, Wikipedia, ParaCrawl, OpenSubtitles y las listas SUBTLEX de
  Marc Brysbaert y colaboradores.
- **Derivación:** `zipf_frequency(lema, "es")` de wordfreq 3.1.1 para cada lema del
  diccionario anterior.
- **Licencia:** CC BY-SA 4.0. Atribución a Robyn Speer y a los corpus citados; las
  obras derivadas deben compartirse bajo la misma licencia.
- **SHA-256 del `.gz`:**
  `317ea68884c115e7817541ef1921b03750b01940d0d53c37a2a62b81e33b75e9`
- **Generado:** 2026-10-22.

## `senses-es.csv.gz` — acepciones del Wikcionario

- **Contenido:** 184 915 acepciones, con cabecera
  `lemma,pos,sense_order,definition,example`, UTF-8, una por línea. Los saltos de línea dentro de
  un campo se aplanan a un espacio; el resto del texto va tal cual (comillas escapadas según
  RFC 4180).
- **Origen:** Wikcionario en español vía [kaikki.org](https://kaikki.org), bajo **CC BY-SA 4.0 +
  GFDL**.
- **Derivación:** `scripts/lexicon-export-senses.mjs` lee el catálogo
  (`lexicon_senses` unido a `lexicon_entries`, idioma `es`) y exporta **solo** las filas
  `source = 'wiktionary'`. Quedan fuera las acepciones generadas con IA (`source = 'ai'`) y las
  de la semilla (`source` NULL): no son datos del Wikcionario.
- **Licencia:** CC BY-SA 4.0 + GFDL. Se acredita al Wikcionario en español y a kaikki.org; las
  obras derivadas se comparten bajo la misma licencia.
- **SHA-256 del `.gz`:**
  `851fd49b06d6e0f058f4e5dd4b64558e9e0cfb84d8fb08689445934772a3c6ef`
- **Generado:** 2026-10-22.
- **Regenerar:**
  ```bash
  node --env-file=.env scripts/lexicon-export-senses.mjs
  ```
  Requiere el catálogo cargado; si hace falta, primero
  `node --env-file=.env scripts/lexicon-wiktionary.mjs`. El orden es estable y el gzip no lleva
  fecha, así que dos ejecuciones sobre el mismo catálogo dan el mismo SHA-256.

## `forms-en.tsv.gz` — forma → lema (inglés)

- **Contenido:** 139 070 pares `forma<TAB>lema`, uno por línea, sin cabecera,
  UTF-8.
- **Origen:** diccionario `en` de LemmaGen (`en.plzma`, vía *simplemma* 1.1.2),
  construido desde el mismo pool documentado para `es`: *Lemmatization Lists*
  de Michal Měchura (**ODbL 1.0**), Kaikki (CC BY-SA 4.0 + GFDL), FreeLing
  (LGPLLR), spaCy lookups-data (MIT), UniMorph (CC BY-SA 3.0) y Wikinflection
  (CC BY 4.0). Por la misma interpretación conservadora adoptada para `es`, la
  tabla derivada se publica bajo ODbL 1.0.
- **Derivación:** `scripts/lexicon-export.py en` y `gzip -9`, sin columnas
  nuevas ni filtro por frecuencia.
- **Licencia:** ODbL 1.0 (§4.3 y §4.6). Este archivo es la URI de descarga
  pública.
- **SHA-256 del `.gz`:**
  `9aa25f880bc4bee684561cf7f1cdd37ae9abbb67815a09a2685b127fd49fed45`
- **Generado:** 2026-11-02.

## `lemmas-freq-en.tsv.gz` — lema → zipf (inglés)

- **Contenido:** 50 373 pares `lema<TAB>zipf`, sin cabecera, UTF-8; 38 511 con
  frecuencia > 0 y el resto con el valor vacío (ausencia de medición, no un 0
  real). El zipf (0–8) va redondeado a dos decimales.
- **Origen:** *wordfreq* de Robyn Speer, bajo **CC BY-SA 4.0** (mismos corpus
  agregados que en la tabla `es`).
- **Derivación:** `zipf_frequency(lema, "en")` de wordfreq 3.1.1 para cada lema
  del diccionario anterior.
- **Licencia:** CC BY-SA 4.0. Atribución a Robyn Speer y a los corpus citados.
- **SHA-256 del `.gz`:**
  `31cffc29388c6708b7858381bf4e4dd8b373ecc3634bcd6811fb345d03bea311`
- **Generado:** 2026-11-02.
- **Regenerar (ambas tablas `en`):**
  ```bash
  python3 -m venv /tmp/lecta-lex-env
  /tmp/lecta-lex-env/bin/pip install simplemma==1.1.2 wordfreq==3.1.1
  /tmp/lecta-lex-env/bin/python3 scripts/lexicon-export.py en
  gzip -9 -c data/lexicon/en-forms.tsv > public/lexicon/forms-en.tsv.gz
  gzip -9 -c data/lexicon/en-lemmas.tsv > public/lexicon/lemmas-freq-en.tsv.gz
  ```

## Notas

- `locuciones.es.json` (frases hechas) se publica aparte y no forma parte de estas
  tres tablas.
- Las acepciones del Wikcionario (CC BY-SA 4.0 + GFDL) se publican en
  `senses-es.csv.gz`; la base de datos sigue siendo la fuente.
- Estas tablas son las que usa el motor de Lecta para lematizar y para ordenar el
  vocabulario por frecuencia; no contienen datos de usuarios.
