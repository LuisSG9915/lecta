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

1. Publicar las tablas derivadas **desde la propia app** (decisión 0.2: Opción A, sin
   depender de un repositorio de GitHub que daba 404):
   - `/lexicon/forms-es.tsv.gz` (forma→lema, 665 732 pares) bajo **ODbL 1.0**.
   - `/lexicon/lemmas-freq-es.tsv.gz` (lema→zipf, 71 646 pares) bajo **CC BY-SA 4.0**.
   - `/lexicon/README.md` con fuentes, proceso, crédito SUBTLEX, licencias y SHA-256 de
     cada archivo — hace de `LICENSE` + `README` en un solo documento.
   - Ambas se sirven con `Content-Type: application/gzip` y `Content-Disposition:
     attachment` (reglas en `public/_headers`) para que se descarguen como archivo.
   - Los TSV de origen los genera `scripts/lexicon-export.py` en `data/lexicon/`
     (no versionado); el `.gz` publicado sí se versiona en `public/lexicon/`.
   - **Pendiente:** `senses-es.csv.gz` (acepciones del Wikcionario, CC BY-SA 4.0 +
     GFDL). No se genera todavía; las acepciones `source='ai'` no entrarían.
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
