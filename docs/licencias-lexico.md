# Licencias del catálogo léxico

Revisión encargada en la Fase 2. Conclusión: **los datos se pueden usar
con fines comerciales**, pero al servir el catálogo a usuarios contamos
como «uso público» y hay obligaciones de atribución y publicación.

Esto es análisis de cumplimiento, no asesoría legal.

## Fuentes y licencias

| Fuente | Aporta | Licencia |
|---|---|---|
| simplemma (código) | Exportador de listas | MIT © Adrien Barbaresi |
| Lemmatization Lists (M. Měchura) | ~498 k pares forma→lema `es` | **ODbL 1.0** |
| Kaikki (Wikcionario) | listas dentro de simplemma | CC BY-SA 4.0 + GFDL |
| FreeLing (UPC/IULA) | diccionario morfológico `es` | LGPLLR |
| spaCy lookups-data | listas dentro de simplemma | MIT |
| UniMorph `spa` | listas dentro de simplemma | CC BY-SA 3.0 |
| Wikinflection (Metheniti) | listas dentro de simplemma | CC BY 4.0 |
| wordfreq (datos) | frecuencias zipf por lema | **CC BY-SA 4.0** |
| Kaikki eswiktionary | acepciones (definiciones y ejemplos) `es` | **CC BY-SA 4.0 + GFDL** |

La lista `es` de simplemma combina todas las fuentes anteriores; las
licencias exactas que empaqueta están en `licenses/` de su repo.

## Qué nos obligan

- **ODbL 1.0** (Měchura): nuestra tabla forma→lema es una *Derivative
  Database*. Servir fichas al público cuenta como uso público (§4.4c).
  Debemos licenciarla ODbL (o compatible) y **ofrecerla descargable**,
  o publicar el archivo de alteraciones/método (§4.6). Cada obra
  producida pública lleva el aviso «Contiene información de… bajo ODbL»
  (§4.3).
- **CC BY-SA 4.0** (wordfreq y derivadas): atribución + indicar cambios
  + la *tabla derivada* queda bajo BY-SA 4.0. No alcanza la base
  completa de Lecta (usuarios, libros, anotaciones son colección
  ajena). La autora de wordfreq pide además que la atribución viaje
  con los datos: nada de CSV suelto sin LICENSE.
- **SUBTLEX** (dentro de wordfreq): crédito a los autores y dejar claro
  que son datos libres (`NOTICE.md` de wordfreq).

## Cumplimiento adoptado

1. Publicar las dos tablas derivadas empaquetadas con sus licencias:
   - `forms-es.csv.gz` (forma→lema) bajo **ODbL 1.0**.
   - `lemmas-freq-es.csv.gz` (lema→zipf) bajo **CC BY-SA 4.0**, con
     `LICENSE` y `README` (fuentes, proceso, crédito SUBTLEX).
   - `senses-es.csv.gz` (acepciones cargadas del Wikcionario en
     español vía kaikki.org; `lexicon_senses.source='wiktionary'`)
     bajo **CC BY-SA 4.0 + GFDL**. Las acepciones `source='ai'` son
     contenido propio generado y no entran en ese archivo.
   - Repo público dedicado `lecta-lexicon-data`, enlazado desde
     «Acerca de». Los TSV generados por `scripts/lexicon-export.py`
     son la fuente de esos archivos.
2. Texto de atribución en «Acerca de» (pendiente de implementar):

   > Lecta incluye datos léxicos derivados de Simplemma (código MIT,
   > © Adrien Barbaresi), cuyas listas provienen de Lemmatization
   > Lists de Michal Měchura (Open Database License 1.0), el
   > Wikcionario vía kaikki.org (CC BY-SA 4.0 / GFDL), FreeLing (UPC),
   > spaCy lookups-data (MIT), UniMorph (CC BY-SA 3.0) y el corpus
   > Wikinflection (CC BY 4.0). Las frecuencias derivan de wordfreq
   > de Robyn Speer (CC BY-SA 4.0; incluye Google Books Ngrams,
   > Wikipedia, ParaCrawl, OpenSubtitles y las listas SUBTLEX de
   > Marc Brysbaert et al.). Contiene información de «Lemmatization
   > lists» disponible bajo ODbL 1.0. Las definiciones provienen del
   > Wikcionario en español vía kaikki.org (CC BY-SA 4.0 / GFDL). Las
   > tablas derivadas se publican en [URL del repo].

3. No hace falta: licenciar la base entera, abrir el código del Worker
   ni mostrar licencias en cada ficha.

## Alternativa si no se quiere share-alike

Usar solo la lematización por reglas de simplemma (código MIT, sin
listas): no obliga a nada, pero cubre menos y con menos precisión.
