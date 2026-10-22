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

## Notas

- `locuciones.es.json` (frases hechas) se publica aparte y no forma parte de estas
  dos tablas.
- Las acepciones del Wikcionario (CC BY-SA 4.0 + GFDL) viven en la base de datos y
  **todavía no se exportan** como archivo; queda anotado en
  `docs/licencias-lexico.md`.
- Estas tablas son las que usa el motor de Lecta para lematizar y para ordenar el
  vocabulario por frecuencia; no contienen datos de usuarios.
