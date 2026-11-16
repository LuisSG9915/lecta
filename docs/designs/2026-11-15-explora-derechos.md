# Explora: derechos de autor y licencias de las fuentes (2026-11-15)

Estado: aceptado por Luis tras 5 rondas de Goldfish (tope, sin convergencia; hallazgos de la ronda 5 aplicados sin re-revisión)
(`docs/revision-egm/2026-11-15-explora-derechos/`). No es asesoría legal:
identifica riesgos y propone mitigaciones técnicas; las decisiones de fondo
(y cualquier duda de ley mexicana, europea o de EE. UU.) necesitan a un
abogado.

Decisión de Luis (2026-11-15): mientras no haya una fuente de metadatos con
licencia comercial, la zona «Series y películas» se apaga en producción.
Ver M0. Esta decisión reemplaza la anterior registrada en AGENTS.md:318
(«licencia OMDb CC BY-NC revisada por Luis y aceptada»); AGENTS.md se
actualiza cuando M0 se despliegue.

## 1. Objetivos y alcance

**Objetivos**

- Saber qué contenido de terceros copia, guarda o redistribuye Lecta desde
  Explora, y bajo qué licencia o política.
- Cerrar primero la exposición 🔴, con un criterio verificable por
  mitigación (§6).
- Dejar escritas las preguntas que necesitan a Luis o a un abogado (§8).

**No objetivos**

- Resolver el régimen legal de cada país: el documento fija cortes
  conservadores.
- La pestaña Comunidad (guías de otros lectores).
- Implementar las mitigaciones: van en cambios propios, uno por riesgo.

Explora tiene tres pestañas (`ExploreShelf.tsx:25`); dos usan fuentes
externas:

| Pestaña | Fuente | Código |
|---|---|---|
| Libros gratuitos — riel curado | EPUB de Project Gutenberg sembrados en R2 | `scripts/catalog-seed.mjs`, `scripts/catalog-seed-lib.mjs`, `scripts/catalog-curation.json`, `src/worker/catalog.ts` |
| Libros gratuitos — búsqueda (misma pestaña) | Índice RDF de Gutenberg + EPUB y portada bajo demanda | `scripts/gutenberg-index.mjs`, `src/worker/catalog.ts`, `src/client/lib/gutenberg.ts`, `src/client/components/GutenbergSearch.tsx` |
| Series y películas | OMDb (metadatos, pósters), SubDL (subtítulos), Trakt (rieles) | `src/worker/screen.ts`, `src/worker/screen-discover.ts`, `src/worker/screen-curated.ts`, `src/shared/screen-guide.ts` |
| Comunidad | Guías de otros lectores (fuera de alcance) | — |

Contexto comercial: Lecta cobra Lecta+ ($59 MXN/mes, Stripe). Las rutas de
Explora no están detrás del muro (`requireLectaPlus` no cubre
`/api/catalog/*` ni `/api/screen/*`, `app.ts:228-230`), pero lo que sale de
Explora sí entra en funciones de pago (§2.1.5), el producto en su conjunto
es de pago y el operador está en México.

## 2. Qué toca Lecta de cada fuente

### 2.1 Project Gutenberg

#### 2.1.1 Quién pide a gutenberg.org

Tres clientes, todos contra `www.gutenberg.org` (sitio principal, no espejo):

| Cliente | User-Agent | Qué pide | Cuándo |
|---|---|---|---|
| `scripts/gutenberg-index.mjs --build` | `lecta-catalog-index/1.0` | `cache/epub/feeds/rdf-files.tar.bz2` (el volcado que ofrece la política de robots) | a mano |
| `scripts/catalog-seed.mjs` | `lecta-catalog-seed/1.0` | Por libro curado: RDF y hasta 2 HEAD del EPUB, HEAD de la portada (cada HEAD con un GET parcial si da 405/501). Con `--seed`, además GET del EPUB (si no hay copia local) y GET de la portada. Reintentos 800/1600 ms solo en GET con 5xx o excepción; timeout 30 s en GET (`CATALOG_SEED_FETCH_TIMEOUT_MS`) y 20 s en HEAD y GET parcial. Por defecto 3 workers y 300 ms entre libros (`--concurrency`, `--delay`). | a mano |
| Worker (`catalog.ts`) | `lecta-catalog/1.0` | EPUB y portada `pg-<n>` bajo demanda | cada petición sin copia en R2 |

#### 2.1.2 Catálogo curado

- `catalog-seed.mjs` resuelve cada entrada de `catalog-curation.json` contra
  su RDF y llama a `rightsCheck` directamente (`:197`). No usa
  `indexRowFromRdf`: comprueba idioma (`:189`) y que el EPUB exista (HEAD), pero no tipo, título ni formato del RDF; y como corre
  `main()` al importarse, no se puede probar.
- Publica `catalog/<id>.epub` (sin modificar, `:257`), `catalog/<id>.vocab.json`,
  `catalog/<id>.cover.jpg` y `catalog/index.json` (74 libros; título, autor,
  `synopsis`, `subjects`, `issued` y, solo en 10 entradas inglesas,
  `epubSha256`; `epubBytes` es el `content-length` del HEAD). La subida a R2
  es un paso manual aparte. El `catalog-seed/index.json` local no es copia
  fiel de lo publicado: el estado real sale de `GET /api/catalog` y de R2. Hay artefactos locales de ids que no están en
  `index.json` (p. ej. `vuelta-martin-fierro`, `clemencia`): R2 puede tener
  objetos de catálogo fuera del índice.
- Los avisos de `rightsCheck` se guardan en `catalog-seed/catalog.seed.json`
  y no se publican. `allowContributors: true` salta un `rightsCheck`
  fallido (`:198`, queda como `forcedThrough`); ninguna entrada lo usa.
- El servidor MCP (`mcp/src/tools.ts:528-559`) reexpone `index.json` con
  URLs absolutas de EPUB y portada: otro canal de distribución, gratuito y
  sin copia ni caché propias; hereda lo que haga `index.json`.

**Entradas publicadas con problemas conocidos** (nombres tal como vienen en
el RDF, que es lo que lee la regla):

| Entrada | Colaboradores en el RDF | Problema |
|---|---|---|
| `lazarillo` | «Anonymous» (`creator`, sin fecha) | Pasa hoy por anónimo; M8 lo bloquearía sin lista blanca. |
| `cien-mejores-poesias` | Menéndez y Pelayo (†1912) como `other`; sin `creator` | M8 lo rechaza (sin `creator`). La antología reúne poetas de varios siglos sin auditar. |
| `lusiadas` | Camões (†1580) como `creator`; «Gómez de Tapia, Luis, 16th century» como `trl`, sin fechas | El traductor pasa solo por la regex de siglo; no hay fecha registrada. |
| `dama-camelias` | Dumas (†1895) como `creator`; sin `trl` | Traducción al español sin traductor registrado (tema «Translations into Spanish»). |
| `treasure-island` | Rhead, Louis (†1926) como `other` | Probablemente el ilustrador; el EPUB `.images` lleva sus láminas. |
| `dona-perfecta` | Marsh (†1937) y Byington (†1957) como `other` | Edición con aparato crítico de autores muertos tras 1924. |
| `obras-becquer` | Álvarez Quintero, Joaquín (†1944) y Serafín (†1938) como `other` | Prólogo o edición de autores muertos tras 1924. |

Traducciones publicadas revisadas con `trl` fechado y válido: `hamlet`
(Moratín, †1828), `divina-comedia` (Aranda y Sanjuan, †1900; De Sanctis como
`other`), `herodoto-1` (Pou, †1802). No hay más traducciones publicadas con
tema «Translation». Varias ediciones
traducidas no están publicadas porque el seed las rechazó por su `trl`
(p. ej. Homero, Dostoievski, Hugo, Irving, `salambo`,
`historia-dos-ciudades`). Una traducción sin tema «Translation» ni `trl`
pasaría sin ser vista: la auditoría completa de lo publicado es M9.

#### 2.1.3 Índice de búsqueda

- `--build` baja el volcado RDF a `catalog-seed/.gutenberg/` (ignorado por
  git), lo extrae y escribe `catalog-seed/gutenberg-index.ndjson` y
  `gutenberg-index.skipped.json`. Si la
  descarga falla, reutiliza un tarball local viejo con solo un aviso en
  consola (`gutenberg-index.mjs:128-134`), así que `dcterms:rights` puede
  quedar rancio. `--load` guarda por fila `gutenberg_id`, `language`,
  `title`, `author`, `subjects`, `downloads`, `issued` y `search_text`.
- **Qué tabla lee producción**: el Worker consulta siempre
  `lecta_dev.gutenberg_books` (`CATALOG = "lecta_dev."`, `lexicon.ts:18`).
  `--load --remote` (alias `--prod`) escribe `lecta.gutenberg_books`, que
  nadie lee; y un `--load` normal de desarrollo carga justo la tabla que lee
  producción. Según AGENTS.md el índice estaba en 0 filas el 2026-11-15 con
  gutenberg.org respondiendo 403 al `--build`; confirmar con un
  `SELECT count(*) FROM lecta_dev.gutenberg_books` fechado. El 403 puede ser
  ya un bloqueo de Gutenberg a Lecta.
- **Consecuencia del índice vacío**: hoy no se puede bajar bajo demanda
  ningún EPUB ni portada `pg-` nuevos (ambos exigen fila). Las descargas no
  están apagadas, solo dormidas: cualquier `--load` a `lecta_dev` las
  reactiva en producción.
- **`issued` no es la fecha de publicación**: es el día en que el ebook se
  publicó en PG (1971 o después). El cliente lo pinta como «Publicado en …»
  (`src/client/lib/catalog.ts:285-287`).

#### 2.1.4 Descargas bajo demanda (`pg-<n>`)

- **EPUB**: `GET /api/catalog/pg-<n>/epub` exige sesión, fila en el índice y
  cuota `catalog-fetch` de 20/h; baja `/ebooks/<n>.epub3.images` y, si
  falla, `/ebooks/<n>.epub.images` (≤ 25 MB, firma `PK`, 25 s; si no, 502).
  Las dos variantes llevan ilustraciones. Lo guarda **sin modificar** en
  `catalog/pg-<n>.epub` y lo responde `public, immutable`.
- **Portada**: `GET /api/catalog/pg-<n>/cover` **sin sesión ni cuota**;
  exige fila en el índice (o el id visto en una búsqueda la última hora),
  baja `/cache/epub/<n>/pg<n>.cover.medium.jpg` (JPEG ≤ 400 kB) y la guarda
  en `catalog/pg-<n>.cover.jpg`. Negativas cacheadas 6 h. La búsqueda marca
  `cover: true` en cada resultado: una página son hasta 24 portadas.
- **Una vez en R2, se sirve a cualquiera**: la ruta de objetos mira R2
  primero y responde el hit sin sesión ni consulta al índice, con caché
  pública de un año (`catalog.ts:484-489`). Su contrato es «un libro nuevo
  estrena id, nunca se sobrescribe» (`catalog.ts:23-25`).

#### 2.1.5 A dónde viaja el EPUB después

«Obtener», «Probar con un clásico» y elegir a mano el mismo archivo pasan
por `selectBook`. El cliente no distingue un libro de catálogo:
`getCatalogBook` solo pasa `{ language }` (`App.tsx:1452`) y un archivo
subido a mano tiene el mismo SHA-256. La identidad del libro en Lecta es ese
hash: en el cliente, todas las claves de `isBookScopedSessionKey`
(`idb.ts:1635-1647`: `bookStart`, `bookVocab`, `bookHelp`, `paperReading`,
`paperGuide`, `screenPhrases`, `preparation`, `chapAn`, `chapterFollow`,
`midChapterRecall`); en el servidor, `user_books.book_id`,
`lecta_user_positions.book_hash`, `guides/<hash>.json` y `kcache/<hash>`.

Copias en R2 que salen de ahí:

| Copia | Quién la escribe | Clave R2 | Plan |
|---|---|---|---|
| EPUB (cola) | `PUT /api/books/:hash` (`src/client/lib/books.ts:68`); también `POST /api/books/:hash` y `POST /api/books` (mismo `handleBookUpload`, `app.ts:2245-2247`) | `books/<userId>/<hash>.epub` (`app.ts:1926`) | Lecta+ (`app.ts:2245`) |
| EPUB (directa) | `PUT /api/user/books/:bookId/file` (`App.tsx:1423-1430`, `reading-sync.ts:917`); `bookId` y `x-book-sha256` los declara el cliente y no se comprueban contra el cuerpo (`app.ts:3328`, `:3335`) | `user-books/<userId>/<bookId>.epub` (`app.ts:3353`) | Lecta+ (`app.ts:3316`) |
| Portada | `PUT /api/books/:hash/cover` (`app.ts:2428-2484`; el cliente sube la portada local de toda fila remota con `hasCover: false`, `App.tsx:784-793`); extracción en servidor al subir el EPUB (`app.ts:2194-2201`); reparación en `GET /api/books` (`app.ts:2075-2083`) y `POST /api/books/:hash/repair` (`app.ts:2914-2923`) | `covers/<userId>/<hash>.jpg` (`app.ts:1927`) | `PUT …/cover` y `repair` solo piden sesión: **también Gratis** |

**Portal Kindle** (`requireKindlePlan`, `kindle/routes.ts:938`): el
cargador intenta primero `catalog/${bookId}.epub` (`kindle/routes.ts:1489-1491`)
y solo después los libros del usuario. Tres entradas lo usan:
`/k/read/:hash`, su ruta de recursos y `/k/preview/page?book=<slug>`
(`:1024-1040`, acepta `/^[\w.-]{1,80}$/`). Ninguna valida que el parámetro
sea un sha256, así que `/k/read/quijote` o `/k/preview/page?book=quijote`
sirven el EPUB de catálogo, con marca, a cualquier cuenta con Kindle (salvo
EPUB de más de 40 MB, como `treasure-island`, que el Kindle rechaza). Los
capítulos y recursos se cachean en `kcache/ch/<id|hash>/` y
`kcache/res/<id|hash>/`, compartidos entre usuarios, y la caché se lee
**antes** de comprobar propiedad (`:1584-1585`, `:2112-2121`). Además, adjuntar
una guía de Comunidad (`POST /api/books/community/:hash/attach`,
`app.ts:2802-2868`) crea una fila `paper_only` con el hash del donante, y
`/k/preview/page` sin `book` elige `firstKindleBookHash`
(`kindle/routes.ts:1534-1546`), que puede ser ese hash. Ver R11.

En el dispositivo, las portadas remotas se cachean también en CacheStorage
(`src/client/lib/cover.ts:196-239`), y el respaldo JSON incluye
`catalogIndex:v1` (`export.ts:781`). El índice del catálogo en el cliente
solo se usa sin conexión (`src/client/lib/catalog.ts:104-122`): en línea
manda la red (caché del isolate 5 min + `public, max-age=300`); sin conexión,
el índice viejo no vence. `catalogVocab:v2:<id>` se cachea sin vencimiento.

**IA de Lecta+**: `/api/ai/*` envía pasajes del libro abierto a DeepSeek
(`src/worker/ai.ts:323`), sea de catálogo o del usuario.

#### 2.1.6 Regla de derechos (`rightsCheck`, `catalog-seed-lib.mjs:156`)

- Solo hay tres roles con nombre: `creator`, `trl`, `edt` (`ROLE_NAMES`,
  `:17-21`). Cualquier otro `marcrel:*` (ilustrador `ill`, autor de
  introducción `aui`, compilador `com`, colaborador `ctb`, anotador `ann`…)
  se vuelve `other`; el rol exacto se pierde.
- Los tres roles bloquean si murieron después de `deathYearMax = 1924` o si
  la fecha de muerte se desconoce. `other` solo genera avisos: el índice los
  ignora y acepta el libro (`gutenberg-index.mjs:72-73`); el seed curado los
  guarda sin publicar.
- Pasan sin fecha de muerte: nombres que contienen
  `anon|an[oó]nimo|unknown|various|varios` (subcadena), nombres con un siglo
  escrito (cualquier siglo) y nacimientos ≤ 1804.
- Un libro sin colaboradores parseados pasa (`rightsCheck([])` = ok). Los
  agentes referenciados por `rdf:resource` no se leen, y `roleBlock`
  (`:102-103`) trata una etiqueta autocerrada como apertura y puede tragarse
  bloques de otros agentes: un `trl` muerto tras 1924 puede no verse.
- `dcterms:rights` se parsea (`:46`) pero no se usa; `rightsCheck` solo
  recibe colaboradores, así que no puede verlo.
- No hay regla para obras de publicación póstuma.

### 2.2 OMDb

- Búsqueda `?s=`, detalle `?i=` y temporadas, con `OMDB_API_KEY` y sesión.
  Al cliente llegan `imdbId`, tipo, título, año, `hasPoster`, número de
  temporadas y números de episodio.
- **Pósters**: `/api/screen/poster` baja la URL de `Poster` (hosts permitidos
  `m.media-amazon.com`, `img.omdbapi.com`; ≤ 2 MB), la guarda en R2
  `screen/posters/<imdbId>.jpg` (siempre `.jpg`) sin vencimiento y la sirve
  `public, max-age=31536000, immutable`. Incluso un hit en R2 exige sesión y
  `OMDB_API_KEY` (`screen.ts:322-324`).
- Los rieles (`/api/screen/discover` y `/api/screen/related`) marcan
  `hasPoster: true` fijo (`screen-discover.ts:130`, `:179`, `:212`) y el
  cliente pide el póster de cada tarjeta (`ScreenShelf.tsx:193`, `:212`);
  si falla, pinta portada tipográfica (`ScreenShelf.tsx:209-224`).
- Al añadir un título, `installScreenWork` guarda el póster en IndexedDB como
  `StoredBook.cover` y conserva el anterior (`previous?.cover`,
  `App.tsx:1786-1803`).
- Licencia de datos de OMDb: CC BY-NC (versión por verificar, §9). En la UI
  no hay crédito a OMDb.

### 2.3 SubDL

- `POST /api/screen/guide` (sesión, cuerpo ≤ 4 KB, cuota 6/h solo si la
  guía no está en R2) busca por `imdb_id` y baja un zip (≤ 2 MB). Prefiere un
  subtítulo suelto; como último recurso baja el **paquete de toda la
  temporada** y abre solo el `.srt` que casa con `SxxEyy`
  (`screen.ts:410-427`, `:533-548`).
- **Un hit en R2 se sirve sin ninguna llave** (`screen.ts:605-621`; comentario
  `:30-31`): quitar `SUBDL_API_KEY` no deja de servir las guías ya creadas.
- El `.srt` (≤ 1 MB) vive **en memoria**. La guía guardada lleva formas
  sueltas sin stopwords ordenadas A–Z, `capitalOnly` (nombres propios,
  incluidos personajes) y claves del banco `CORE_FOREIGN_IDIOMS`. R2 la
  guarda en `screen-guides/v1/<movie|tv>-<imdbId>[-sNNeNN]-<lang>.json`,
  compartida entre usuarios. En el cliente, `installScreenWork` guarda la
  guía fusionada (formas y `capitalOnly` por episodio) en
  `paperGuideSessionKey(hash)` (`App.tsx:1766-1784`) y las frases en
  `screenPhrases:v1:<hash>` (`App.tsx:1815-1831`). No se sincronizan con el
  servidor, pero el respaldo JSON exporta `paperGuide:v1:`
  (`BACKUP_SESSION_PREFIXES`, `export.ts:789-797`; `screenPhrases:v1:` no).
  La importación reescribe esas claves (`idb.ts:1256-1262`) pero borra los
  registros de libro de 0 bytes (`idb.ts:1130-1158`), y las obras de pantalla
  se guardan con `data: new Blob([])` (`App.tsx:1803`): un respaldo deja
  guías `paperGuide:v1:` huérfanas, sin obra.
- Fuera de producción, las llaves viven en `.env` y `.dev.vars`: los scripts
  de sonda (`scripts/screen-probe.mjs`, que llama a OMDb `?s`/`?i`/`Season`
  y baja un zip de SubDL; `scripts/trakt-probe.mjs`;
  `scripts/screen-curated-check.mjs`, OMDb) y `wrangler dev` (que escribe
  guías en el R2 local) siguen funcionando.
- Lecta ya publica datos derivados de subtítulos: las tablas zipf de
  wordfreq incluyen OpenSubtitles y SUBTLEX (`LegalNotice.tsx:135`), con su
  licencia y atribución. Es un corpus agregado de frecuencias con licencia,
  no subtítulos de una obra concreta bajados por Lecta.
- Logs de SubDL y Trakt: `imdbId`, tipo o ruta, estado, conteos y mensaje de
  error. Nunca texto de subtítulos ni URLs con llave.
- Los subtítulos de SubDL son transcripciones o traducciones de terceros del
  guion de obras con derechos vigentes.

### 2.4 Trakt

- Rieles «tendencia/recientes/populares» y «relacionados»: `imdbId`, tipo,
  título, año (`TRACKT_API_KEY`). No dependen de OMDb. Respaldo curado propio
  (27 títulos).
- Copias en R2: `screen-discover/v1/rails.json` (fresca 12 h; la vencida se
  sirve si Trakt cae) y `screen-discover/v1/related-<type>-<imdbId>.json`
  (14 días; sesión, cuota 30/h). `/discover` responde
  `private, max-age=300`; `/related` no manda cabecera de caché.
- Crédito y aviso de no aval en Cuenta → «Acerca de y Diagnóstico»
  (`Account.tsx:1332`).

## 3. Riesgos

Severidad: 🔴 exposición legal o de cuenta probable; 🟡 exposición real pero
acotada; 🟢 higiene.

### R1 🔴 SubDL como fuente de subtítulos

La guía final no reproduce el guion. El riesgo está en el insumo: Lecta
descarga de forma automatizada copias completas de subtítulos (obras
derivadas del guion), a veces el paquete de una temporada entera, de un
sitio sin licencia de los titulares, para un producto comercial, con una
llave de API a su nombre. Las guías ya creadas son producto de esa copia, se
comparten entre usuarios y se siguen sirviendo sin llave. Conservarlas es
una decisión legal (§8); servirlas mientras se decide, no. Ver Trakt junto a
un extractor de subtítulos de fans es además lo que más fácil choca con la
política anti-piratería de Trakt (§9).

### R2 🔴 Pósters cacheados y redistribuidos

Los pósters son arte con derechos de los estudios. Lecta los copia a R2 sin
vencimiento, los sirve como propios con caché pública de un año y los guarda
en IndexedDB de cada usuario; los rieles los multiplican (`hasPoster: true`
fijo). `m.media-amazon.com` es el CDN de IMDb, cuyas condiciones restringen
reutilizar sus imágenes (§9); `img.omdbapi.com` es la API de pósters para
patrocinadores de OMDb. Las copias ya entregadas con `immutable` siguen en
navegadores y caches intermedias hasta un año: residuo que ninguna
mitigación quita.

### R3 🔴 Licencia CC BY-NC de OMDb en un producto de pago

Lecta es comercial. Aunque la zona de pantalla no está detrás del muro,
sirve para adquirir y retener clientes de pago, que es uso comercial según
la lectura habitual de NC. Tampoco se da la atribución que exige BY. Una
licencia comercial de OMDb puede no bastar: buena parte de sus datos vienen
de IMDb, y OMDb no puede licenciar derechos que no tiene.

### R4 🔴 Libros con marca Project Gutenberg en funciones de pago

La licencia de PG permite redistribuir gratis con la marca; quien cobra una
tarifa por copias o por acceso a obras con la marca debe pagar regalías
(20 % de las ganancias brutas, §1.E.8; §9). El detonante es cobrar por la
copia o el acceso, no ser un producto comercial. `/api/catalog/*` es gratis,
pero el EPUB sin modificar, con su marca, ya entra en la sync en la nube y,
sobre todo, el portal Kindle de pago lo sirve directo desde `catalog/`
(§2.1.5). Está en producción. La salida que permite PG: quitar toda
referencia a Project Gutenberg del archivo; queda texto de dominio público
sin condiciones de marca.

Otros canales de pago sin analizar: las funciones de IA de Lecta+ trabajan
sobre el texto del libro abierto en el lector (`/api/ai/*`,
`requireLectaPlus`), y las copias con marca guardadas por «Obtener» viven en
IndexedDB de cada dispositivo sin vencimiento (§8).

Caso distinto, sin resolver: un EPUB de PG que el usuario baja por su cuenta
de gutenberg.org y sube a Lecta. Lecta no lo distribuyó, pero lo aloja y lo
lleva al Kindle de pago (§8).

### R5 🔴 Catálogo curado con colaboradores sin auditar

Siete entradas publicadas hoy, servidas sin sesión, sincronizadas y en el
Kindle, tienen problemas conocidos (§2.1.2): una traducción sin traductor
registrado (`dama-camelias`), una con traductor sin fecha (`lusiadas`), tres
con colaboradores muertos después de 1924 (`treasure-island`,
`dona-perfecta`, `obras-becquer`), una antología sin auditar
(`cien-mejores-poesias`) y una que depende de la regla de anónimos
(`lazarillo`). Además puede haber objetos de `catalog/` en R2 fuera de
`index.json` (§2.1.2), igual de públicos y sin auditar. Es posible
infracción de derechos hoy, no solo higiene de la regla.

### R6 🟡 Acceso automatizado a www.gutenberg.org

La política de robots de Gutenberg (§9) ofrece el volcado RDF y un punto de
cosecha (`/robot/harvest`) que redirige a espejos, y pide no automatizar el
sitio principal. Lecta lo automatiza desde el seed y desde el Worker
(§2.1.1). El peor es la portada `pg-<n>`: sin sesión ni cuota, cualquiera
puede recorrer los ids indexados y usar el Worker como raspador. Con el
índice vacío está latente, pero el 403 al `--build` sugiere que el bloqueo
ya pudo ocurrir. No es un riesgo de copyright, sino de cumplimiento y
disponibilidad.

### R7 🟡 Huecos en la regla de derechos

- **`dcterms:rights` ignorado**: PG aloja obras marcadas «Copyrighted. Read
  the copyright notice inside this book…».
- **«Various»/anónimos pasan siempre.** PG tiene muchas antologías y revistas
  de 1930–1960 (pulp con copyright no renovado en EE. UU.) atribuidas a
  «Various». Son de dominio público en EE. UU. por no renovación; en México
  y en la UE pueden no serlo.
- **Expresiones regulares demasiado amplias**: la de siglo acepta «20th
  century» y «siglo XX»; la de anónimos busca subcadenas («Canon…»).
- **Parseo incompleto**: sin colaboradores = aprobado; agentes por
  `rdf:resource` ignorados; etiquetas autocerradas mal tratadas; roles
  distintos de `creator/trl/edt` colapsados a `other`.
- **Traducciones sin traductor**: `trl` solo protege si el traductor figura
  en el RDF.
- **Introducciones, compiladores, anotadores e ilustraciones**: son `other`,
  solo avisan. Su texto o sus imágenes van dentro del EPUB.
- **Obras póstumas**: la primera publicación póstuma puede generar un derecho
  propio (en la UE, 25 años para obras inéditas; México por verificar).
- **Depurar no retira**: el índice nunca borra filas, y un objeto ya en R2
  (`catalog/pg-*` o `catalog/<id>.*`) se sigue sirviendo a cualquiera. Las
  copias entregadas con `immutable` no se recuperan.
- **El corte de 1924** es conservador y deliberado (vida + 100). La
  ampliación mexicana de 2003 no revivió obras ya en dominio público, así
  que probablemente excluye obras que México permitiría; queda para el
  abogado. Para EE. UU. el corte no aplica: allí cuenta la fecha de
  publicación, y lo cubre el filtro de PG.

La parte de búsqueda está latente con el índice vacío; la parte curada es R5.

### R8 🟡 Términos de la API de Trakt

Sin comprobar si los términos de Trakt permiten apps comerciales sin
aprobación, ni si permiten las copias en R2 (§9).

### R9 🟡 Sin proceso de retiro de contenido

La reforma de 2020 a la Ley Federal del Derecho de Autor (T-MEC) creó un
régimen de aviso y retirada para proveedores de servicios que alojan
material **a petición de usuarios**, con condiciones como tener un
procedimiento y un contacto (§9). Dos casos distintos:

- **Contenido de usuarios** (`books/`, `user-books/`, `covers/`, `kcache/`
  de libros propios): el puerto seguro puede aplicar si hay proceso. Hoy no
  hay contacto, procedimiento ni registro de avisos. Purgar copias de pago de
  un cliente necesita un criterio y alguien que decida.
- **Contenido elegido por Lecta** (`catalog/`, `screen/posters/`,
  `screen-guides/`, `screen-discover/`): no hay puerto seguro; un proceso de
  retiro no reduce la exposición. Las mitigaciones reales son M0, M4 y M9.

### R10 🟢 Encabezados de caché públicos en rutas con sesión

Responden `public` pese a exigir sesión: `/api/screen/search` con
cualquier respuesta 2xx de OMDb, aunque no haya resultados (`max-age=300`;
`q` vacío, error de red o no-2xx no mandan cabecera),
`/api/screen/poster` (`immutable`) y la primera respuesta del EPUB `pg-`
(`immutable`). Después, los hits de R2 en `/api/catalog/*` son públicos por
diseño. `/discover` manda `private`; las demás rutas de pantalla no mandan
cabecera. Los Workers no se cachean en el CDN de Cloudflare por defecto: el
riesgo real son caches compartidas y del navegador.

### R11 🔴 La caché del Kindle sirve libros de otros usuarios

`kcache/ch/<hash>/` y `kcache/res/<hash>/` son compartidos y las tres
entradas del portal (`/k/read/:hash`, su ruta de recursos y
`/k/preview/page`) los leen antes de comprobar propiedad (§2.1.5). Los
hashes de libros de otros usuarios son públicos para cualquier sesión:
`GET /api/books/community` devuelve `hash` (`app.ts:2278`). Una cuenta con
Kindle puede abrir `/k/read/<hash de Comunidad>` y recibir capítulos e
imágenes de un libro con derechos que subió otro usuario, si el dueño lo
abrió antes en su Kindle. Rompe la promesa de Comunidad («el EPUB nunca sale
del espacio privado del donante», `app.ts:2514-2517`) y es distribución
desde una caché que eligió Lecta: sin puerto seguro. Está en producción y no
depende de Explora. La fila `paper_only` que crea adjuntar una guía de
Comunidad, más `firstKindleBookHash` en `/k/preview/page`, abre el mismo
camino sin que el usuario escriba ningún hash. Arreglo en la sesión
«Kindle: guardia de propiedad antes de kcache», rama
`claude/xenodochial-morse-c44cc2` (commits `295c8a9` y `efaeffa`), sin
desplegar a 2026-11-15. Los capítulos ya filtrados siguen en los
dispositivos que los recibieron.

### R12 🟡 Texto de libros enviado a un procesador externo

Las funciones de IA de Lecta+ mandan pasajes del libro abierto a DeepSeek
(`src/worker/ai.ts:323`), incluidos libros con derechos que subió el
usuario. Son fragmentos para una consulta del propio lector, no la obra,
pero es una copia hacia un tercero cuyos términos de uso de datos (retención,
entrenamiento) no se han revisado (§9).

## 4. Mitigaciones

✅ = recomendado ya. Cada ✅ tiene su verificación en §6.

- **R11 Caché del Kindle**
  - ✅ M12: guardia de propiedad común antes de
    `getCachedChapter`/`getCachedResource` en las tres entradas
    (`/k/read/:hash`, recursos, `/k/preview/page`). Propiedad = fila de
    `user_books` del usuario con `paper_only = false` y objeto EPUB real; el
    parámetro debe ser un sha256; `firstKindleBookHash` salta las filas
    `paper_only`; `loadEpubObjectForKindle` deja de buscar en `catalog/` (y
    se actualiza `src/worker/user-books.test.ts:315-335`, que esperaba ese
    camino). Cubre también el canal Kindle de R4. Hecho en la rama del
    arreglo, pendiente de revisión y despliegue.
- **R1–R3, R8 Pantalla**
  - ✅ M0 (decidido por Luis): interruptor `SCREEN_ENABLED` que pone en 503
    **todas** las rutas `/api/screen/*`: búsqueda, detalle, temporadas,
    pósters (también hits de R2), guías (también hits de R2) y rieles de
    Trakt (también copias de R2). El cliente lo conoce por una constante de
    compilación (`VITE_SCREEN_ENABLED`), apagada en el build de producción;
    el Worker por su variable. Quitar `OMDB_API_KEY`, `SUBDL_API_KEY` y
    `TRACKT_API_KEY` de producción **y** de `.env`/`.dev.vars`, y retirar los
    scripts de sonda (§2.3), para que tampoco se bajen subtítulos en
    desarrollo. Con la constante apagada se ocultan la pestaña
    (`ExploreShelf.tsx:221-227`, panel `:255-268`), los retornos que caen en
    `screen` (`:47-51`, `:73`, `:91`), la sección «Tus títulos»
    (`ScreenShelf.tsx:302-303`) y el crédito a Trakt de `Account.tsx:1332`
    (con su prueba). Se reabre solo con una fuente de metadatos con licencia
    comercial y la decisión de Luis.
  - ✅ M2: borrar lo copiado. En R2: `screen/posters/` y
    `screen-discover/v1/`. Las guías de `screen-guides/v1/` se conservan sin
    servir hasta la respuesta del abogado (§8). En el cliente, en el mismo
    despliegue que M0: borrar las obras de pantalla (`paperOnly && mediaKind`)
    con su `cover` y sus claves de libro (reusar `isBookScopedSessionKey`,
    `idb.ts:1635`); las palabras del Cuaderno que venían de ellas se
    conservan y pierden la etiqueta de origen. Migración de una vez marcada
    por una bandera de sesión (precedente `COMPANION_MIGRATION_KEY`,
    `idb.ts:2365`) en cada base local (`dbNameFor`). El respaldo deja de
    exportar `paperGuide:v1:` de obras de pantalla, y la importación descarta
    toda clave `paperGuide:v1:` cuyo hash no tenga libro local (las guías
    huérfanas que hoy deja un respaldo, §2.3).
  - ✅ M3: crédito a OMDb en «Términos de servicio y licencias»
    (`LegalNotice.tsx`) si la zona vuelve con OMDb.
- **R4 Marca PG**
  - ✅ M13 (provisional, paso 2): hasta M4c, los libros de catálogo se
    abren sin subir el archivo a la sync de pago (el cliente marca su
    origen al «Obtener» y no encola `withFile`), y el Kindle ya no los lee
    (M12). Así R4 no queda sin medida entre el paso 1 y el 4.
  - ✅ M14: antes de borrar nada (M5, M9), un manifiesto con id, clave R2,
    tamaño y SHA-256 de cada EPUB de `catalog/` (curados, huérfanos y
    `pg-*`), calculado sobre los objetos servidos, no sobre el
    `catalog-seed/index.json` local. Alimenta la lista de rechazo de M4a y el
    inventario de M4d.
  - ✅ M4c: republicar sin marca **con ids nuevos** (`<id>-v2` →
    `catalog/<id>-v2.epub`, `.vocab.json`, `.cover.jpg`; el patrón de
    `catalog.ts:40` lo admite) **solo lo que pasa `admitRdf`** (M8), y
    regenerar `index.json` (`id`, `epubSha256`, `epubBytes`). La limpieza
    revisa el **contenido** de todo archivo de texto del zip (XHTML,
    `content.opf` con `dc:source`/`dc:publisher`/`dc:rights`/`dc:identifier`,
    `toc.ncx`/`nav.xhtml`) y los nombres de archivo con `/gutenberg/i`, y las
    portadas a mano. Las claves viejas se borran a los 10 minutos (caché del
    isolate + `max-age=300`); el índice del cliente pasa a `catalogIndex:v2`
    para que la copia sin conexión no ofrezca ids borrados, y la importación
    de respaldos descarta `catalogIndex:v1`.
  - ✅ M4a: rechazo en servidor, **junto con M4c o después**, dentro de
    `handleBookUpload` (cubre `PUT` y los dos `POST`) y del manejador de
    `/api/user/books/:bookId/file`. El servidor calcula el SHA-256 del cuerpo
    (en `user-books` el hash declarado no se comprueba hoy) y rechaza si está
    en la lista de M14. Rechaza, no limpia (`app.ts:2160-2162`). Hasta que
    responda el abogado (§8) **solo** se usa la lista: un EPUB del usuario
    con marcadores de PG que no está en ella se acepta. La detección por
    marcadores (`*** START OF THE PROJECT GUTENBERG EBOOK`, `dc:publisher` =
    Project Gutenberg) queda escrita y probada pero apagada. El cliente, ante
    el rechazo, saca el elemento de la cola y cambia a la versión limpia.
  - ✅ M4d: con el manifiesto de M14, inventario y sustitución de copias con
    marca en `books/`, `user-books/`, `covers/`, `kcache/ch|res/` y, en cada
    dispositivo, IndexedDB y CacheStorage. La migración hash viejo → nuevo
    cubre las claves de `isBookScopedSessionKey` y, en el servidor,
    `user_books.book_id`, `lecta_user_positions.book_hash` y
    `guides/<hash>.json`, con aviso al usuario.
- **R5 Catálogo curado**
  - ✅ M1: herramienta de listado de R2 (cliente S3 con credenciales de R2
    o ruta de administración temporal autenticada): wrangler 4.141 no lista.
    Requisito de M14, M5, M2, M4c, M4d y M9.
  - ✅ M5: retirar de `index.json` y de R2 (tras M14) `dama-camelias`,
    `lusiadas`, `treasure-island`, `dona-perfecta`, `obras-becquer` y
    `cien-mejores-poesias` hasta auditarlas, con sus `kcache/ch|res/<id>/` y,
    si se compartieron en Comunidad, su `guides/<hash>.json`. Borrar también
    los objetos curados huérfanos: ids con forma curada (no `index`, no
    `pg-\d+`) que no estén en `index.json` ni en el registro de sembrados de
    M7. Antes de purgar, confirmar contra `GET /api/catalog` que las siete
    entradas de §2.1.2 están publicadas.
  - ✅ M5b: copias ya entregadas de las seis retiradas (sync, Kindle,
    IndexedDB, CacheStorage): no se borran a los clientes; se marcan y se
    deciden con el abogado (§8). Mientras, el Kindle ya no las sirve si no
    son del usuario (M12) y no vuelven a subir (M4a con su hash en la lista).
  - ✅ M10: en `catalog-curation.json`, una línea por traducción con el
    traductor y su año de muerte, y una justificación escrita por cada
    entrada de la lista blanca; sin ellas, la entrada falla.
- **R6 Robots de Gutenberg**
  - ✅ M6: interruptor `CATALOG_PG_FETCH=off` ya: un miss de
    `serveGutenbergEpub`/`serveGutenbergCover` responde 404 sin tocar
    gutenberg.org. Provisional: se borra con M7.
  - ✅ M7a: camino de obtención sin automatizar el sitio principal, definido
    **antes** de M8/M9: los RDF salen del volcado (`--build`, la URL
    permitida) y los EPUB del punto de cosecha o de un espejo oficial.
    Releer la política (§9) y confirmar el esquema de URL del espejo. El
    `--build` falla si no puede bajar el volcado, en vez de reutilizar uno
    viejo.
  - M7b: sembrar EPUB y portadas `pg-` por lotes por ese camino, quitar la
    descarga bajo demanda del Worker y dimensionar (libros es+en del índice
    × tamaño medio → GB y costo en R2). El registro de sembrados es una
    columna `seeded` en `gutenberg_books`: la búsqueda solo devuelve filas
    sembradas y M5 no borra lo que esté ahí.
- **R7 Regla de derechos**
  - ✅ M8: una sola función exportada `admitRdf(xml, opts)` en
    `catalog-seed-lib.mjs`, usada por el índice y por el seed curado
    (separar `main()` del seed para poder probarlo). Incluye los arreglos
    del parser (resolver `rdf:resource` contra `pgterms:agent rdf:about`,
    excluir etiquetas autocerradas en `roleBlock`, conservar el rol exacto).
    Rechaza: `dcterms:rights` distinto de «Public domain in the USA.», tipo
    distinto de «Text», sin `creator`, «Various»/anónimos fuera de la lista
    blanca, regex de siglo > XVIII, `trl` sin fecha, y muertes posteriores a
    1924 en `trl`, `edt`, `ill`, `aui`, `com`, `ann` y `ctb`; cualquier otro
    rol con muerte posterior a 1924 también rechaza (por defecto, bloquear).
    Heurística de traducción: rechaza sin `trl` si el tema dice
    «Translations into» o el título o la descripción dicen
    «translated/traducción». La regex anclada
    `/^(anonymous|an[oó]nimo|unknown|various|varios)\b/i` solo decide qué
    nombres pueden entrar a la lista blanca. La lista blanca, con su
    justificación (M10), salta la regla de anónimos y la de «sin creator».
  - ✅ M9: auditoría offline de lo publicado: listar `catalog/` con M1, traer
    los RDF del volcado (M7a), pasar `admitRdf` y purgar lo que falle
    (objetos, entrada de `index.json`, fila del índice), con el manifiesto
    de M14 ya hecho.
  - Corregir la etiqueta «Publicado en» del cliente para `issued`.
- **R9 Retiro de contenido**
  - ✅ M11: contacto de derechos en «Términos de servicio y licencias»
    (`LegalNotice.tsx`, que ya tiene una cláusula de responsabilidad del
    usuario) y en la landing; runbook para contenido de usuarios (qué
    prefijos, quién decide purgar copias de pago, registro de la petición).
    Para contenido de Lecta, el runbook remite a M0, M4 y M9.
- **R10 Caché**: `private` en `/api/screen/search`, `/api/screen/poster` y la
  primera respuesta `pg-`.
- **R12 IA**: revisar los términos de datos de DeepSeek (§9) y decirlo en
  «Términos de servicio y licencias».

**Riesgo residual** (decisión de Luis, §8): obras póstumas sin regla; copias
ya entregadas con `immutable` (pósters, EPUB con marca y las seis entradas
retiradas); copias con marca en dispositivos que no vuelvan a abrir Lecta;
las guías de SubDL conservadas sin servir; respaldos JSON en discos de
usuarios que ya contienen guías de pantalla; y los capítulos del Kindle ya
filtrados entre usuarios.

**Compuerta de carga del índice** (única): `gutenberg-index.mjs --load` se
niega a correr sin `--gate-ok` hasta que existan (1) la corrección de la
tabla, (2) M8, (3) el borrado de filas que ya no pasan en cada carga y
(4) M7b, para que la búsqueda solo ofrezca lo sembrado. `CATALOG_PG_FETCH`
sigue apagado hasta que M7b lo elimine; nunca se enciende.

## 5. Alternativas descartadas

| Riesgo | Alternativa | Por qué no |
|---|---|---|
| R1 | Corpus de frecuencia «de investigación» (SUBTLEX…) para guías por obra | Lecta ya usa wordfreq, que agrega esos corpus con licencia, para frecuencias generales; pero una guía por obra necesita el texto de esa obra, que esos corpus no dan. |
| R1 | Subtítulos aportados por el usuario | Sigue pareciendo una invitación a bajarlos de sitios piratas, sobre todo junto a Trakt. |
| R2 | Enlazar pósters (hotlink) en vez de copiarlos | La CSP solo permite `img-src 'self' data: blob:`; y el arte sigue siendo de los estudios. |
| R2 | TMDB | Da atribución y un acuerdo de API (comercial con contrato), no los derechos del arte. |
| R3 | Licencia comercial de OMDb | Sin verificar que exista, y no cubre los datos que vienen de IMDb. |
| R3 | Wikidata (CC0) | Viable para títulos, años y temporadas; episodios incompletos. Candidata para reabrir la zona, no para hoy. |
| R4 | Bloquear solo en el cliente | El cliente no distingue el libro de catálogo; un archivo elegido a mano entra igual. Se usa solo como medida provisional (M13). |
| R4 | Limpiar la marca en el servidor al subir | El contenido cambiaría bajo un hash que ya no le corresponde. |
| R4 | Pagar el 20 % o pedir permiso a PG | Costo y dependencia sin necesidad: quitar la marca es lo que PG prevé. |
| R4 | Claves `.v2` bajo el mismo id | Ninguna ruta las sirve: `catalog/${id}.epub` es fijo (`catalog.ts:469-479`). |
| R6 | Cuotas en la portada `pg-` | Innecesario si M7b quita la descarga bajo demanda; M6 la apaga mientras tanto. |
| R6 | Redirigir al cliente al espejo (302) | Choca con la CSP y CORS del lector y deja la disponibilidad en manos del espejo. |
| R6 | rsync del espejo completo | Más volumen del necesario (todos los idiomas y formatos). |

## 6. Verificación

| Mitigación | Cómo se comprueba |
|---|---|
| M0 | `wrangler secret list` sin las tres llaves; `.env` y `.dev.vars` sin ellas; scripts de sonda borrados. Pruebas de worker con `SCREEN_ENABLED` apagado y **con sesión**, todas 503: `/api/screen/search`, `/tv/:id`, `/tv/:id/season/:n`, `/api/screen/poster` con póster en R2, `POST /api/screen/guide` con guía en R2, `/discover` y `/related` con copia en R2. `ExploreShelf.test.ts` con `VITE_SCREEN_ENABLED` apagado: sin pestaña, sin «Tus títulos», ningún retorno a `screen`. |
| M1 | Lista `catalog/`, `screen/posters/`, `books/` de prueba. |
| M2 | Listado de `screen/posters/` y `screen-discover/v1/` vacío. Migración: en cada base local desaparecen las obras de pantalla y sus claves, el Cuaderno queda, la bandera evita una segunda pasada. Respaldo: exportar no incluye guías de pantalla; importar uno viejo no deja `paperGuide:v1:` huérfanas. |
| M3 | Texto de crédito en `LegalNotice.tsx`, con prueba. |
| M4a | Pruebas de worker: un EPUB cuyo SHA-256 está en la lista de M14, por `PUT /api/books/:hash`, `POST /api/books/:hash`, `POST /api/books` y `PUT /api/user/books/:bookId/file` (este con `x-book-sha256` falso) → rechazado; un EPUB del usuario con marcadores de PG que no está en la lista → aceptado; la detección por marcadores, probada aparte con su interruptor encendido (fixture con `*** START…` rechazado, colofón que cita a PG aceptado). Cliente: el rechazo saca el elemento de la cola. |
| M4c | Por la API: cada `id` de `index.json` sirve su EPUB por `/api/catalog/<id>/epub`; al descomprimirlo, ningún nombre de archivo casa con `/gutenberg/i` y ningún archivo de texto contiene `project gutenberg`, `gutenberg.org` ni `PG-tm`; abre en el lector; portadas revisadas a mano. A los 10 minutos las claves viejas → 404. |
| M4d | Informe del inventario: claves con marca en `books/`, `user-books/`, `covers/`, `kcache/` = 0; prueba de la migración de hash (posición en `lecta_user_positions` y claves locales conservadas). |
| M5 | Manifiesto de M14 existe antes del borrado; `index.json` sin las seis entradas; sus claves y `kcache/<id>/` → 404; listado de ids curados de `catalog/` ⊆ `index.json` ∪ sembrados (excluidos `index.json` y `pg-*`). |
| M5b | Lista de copias de usuarios de las seis entradas, entregada al abogado. |
| M6 | Prueba de worker: con `CATALOG_PG_FETCH=off` y fila en el índice, un miss de EPUB y portada `pg-` → 404 sin `fetch` saliente. |
| M7a | `--build` sin red → falla. Sin URLs `/ebooks/` ni `/cache/epub/<n>/` de `www.gutenberg.org` en `src/worker/catalog.ts` ni en `scripts/catalog-seed-lib.mjs` (pruebas excluidas; excepción: el volcado RDF en `gutenberg-index.mjs`). |
| M7b | Búsqueda con una fila no sembrada → no aparece. |
| M8 | Pruebas de `admitRdf` con RDF «Copyrighted», «Various» fuera de la lista blanca, «20th century», «Canon, …», sin creador, ilustrador y `ctb` muertos en 1950, rol desconocido muerto en 1950, `trl` sin fecha, `trl` por `rdf:resource` y etiqueta autocerrada: todos rechazados; `lazarillo` con justificación en lista blanca: aceptado. |
| M9 | Informe de la auditoría: objetos revisados, rechazados y purgados; un objeto purgado → 404 a los 10 minutos. |
| M10 | El seed falla con una traducción sin traductor anotado o una entrada de lista blanca sin justificación. |
| M11 | Contacto visible en «Términos de servicio y licencias»; runbook en `docs/`. |
| M12 | Pruebas de worker: A tiene capítulo y recurso en `kcache`; B (sin fila, y también con la fila `paper_only` de adjuntar la guía de A) pide `/k/read/<hash>`, su recurso, `/k/preview/page?book=<hash>` y `/k/preview/page` sin `book` → 404 o texto de muestra; `/k/read/quijote` → 400/404. |
| M13 | Prueba del cliente: «Obtener» un libro de catálogo no encola subida de archivo. |
| M14 | El manifiesto lista cada EPUB de `catalog/` con SHA-256 calculado sobre el objeto servido. |
| Compuerta | `gutenberg-index.mjs --load` sin `--gate-ok` → sale con error. |

## 7. Orden de despliegue

Por severidad y dependencias:

1. M12 (Kindle). Rama del arreglo, pendiente de revisión y despliegue.
2. M0 con la migración de cliente de M2, M6, M13 y la compuerta técnica de
   `--load`. **Reduce** R1–R4 y R6; queda el residuo de §4.
3. M1, M14 (manifiesto) y M7a (camino de obtención).
4. M5 y M5b (retirar seis entradas y huérfanos), y el borrado de R2 de M2.
5. M8, M10 y M9 (regla única y auditoría de lo publicado).
6. M4c y M4a juntos (catálogo limpio con ids nuevos, solo lo que pasa
   `admitRdf`, y rechazo por lista), luego M4d.
7. Bug aparte: `--load --remote` escribe `lecta.gutenberg_books`, que el
   Worker no lee, y `--load` normal escribe la que sí lee. Decidir una sola
   tabla.
8. M11, M3 (si la zona vuelve) y R12.
9. M7b. Solo con la compuerta de §4 cumplida se carga el índice.

## 8. Preguntas abiertas

1. Para Luis: ¿qué fuente con licencia comercial permitiría reabrir «Series
   y películas»? (Wikidata es la candidata.)
2. Para Luis: ¿qué jurisdicciones cubrimos: solo México, o también España/UE
   y EE. UU.? Decide el corte de 1924 y cómo tratar «Various».
3. Para Luis: ¿se acepta como riesgo residual lo listado en §4?
4. Para el abogado de propiedad intelectual:
   - ¿§1.E.8 de PG aplica a la sync y al Kindle de pago, incluido un EPUB de
     PG que subió el propio usuario?
   - ¿§1.E.8 aplica a las funciones de IA de Lecta+ que trabajan sobre el
     texto de un EPUB con marca abierto en el lector?
   - ¿Se pueden conservar (sin servir) las guías derivadas de subtítulos de
     SubDL (formas, nombres propios, claves de frases)?
   - ¿Qué requisitos del régimen de aviso y retirada de la LFDA aplican al
     contenido que suben los usuarios?
   - ¿Qué hacer con las copias que los usuarios ya tienen de las seis
     entradas retiradas (M5b)?
   - ¿Enviar pasajes de libros con derechos a DeepSeek requiere algo más que
     informarlo (R12)?

## 9. Fuentes de terceros (por verificar)

Las afirmaciones sobre políticas ajenas vienen de memoria del autor y no se
han releído para este documento. Antes de actuar con base en ellas, leer
cada fuente y anotar la fecha.

| Afirmación | Fuente | Verificado |
|---|---|---|
| Robots: no automatizar el sitio principal; volcado RDF y `/robot/harvest` hacia espejos | gutenberg.org/policy/robot_access.html | pendiente |
| Licencia PG §1.E.8, regalías del 20 % | gutenberg.org/policy/license.html | pendiente |
| Marca PG: quitar referencias deja texto sin condiciones de marca | gutenberg.org/policy/license.html (§1.C, §1.E) | pendiente |
| Datos de OMDb bajo CC BY-NC (versión) y términos de la llave gratuita | omdbapi.com/legal.htm | pendiente |
| Condiciones de uso de imágenes de IMDb | imdb.com/conditions | pendiente |
| Términos de la API de SubDL | subdl.com | pendiente |
| Términos de la API de Trakt (uso comercial, caché, piratería) | trakt.docs.apiary.io / trakt.tv/terms | pendiente |
| Términos de uso de datos de la API de DeepSeek (retención, entrenamiento) | api-docs.deepseek.com / platform.deepseek.com | pendiente |
| Términos de la API de TMDB | themoviedb.org/api-terms-of-use | pendiente |
| Wikidata: CC0 y cobertura de series/episodios | wikidata.org/wiki/Wikidata:Licensing | pendiente |
| UE: 25 años para obras inéditas publicadas póstumamente | Directiva 2006/116/CE, art. 4 | pendiente |
| México: plazos y transitorios (1963, 1994, 2003) | Ley Federal del Derecho de Autor, art. 29 y transitorios | pendiente |
| México: aviso y retirada para proveedores que alojan contenido de usuarios (reforma 2020) | LFDA, arts. 114 Octies y siguientes | pendiente |
