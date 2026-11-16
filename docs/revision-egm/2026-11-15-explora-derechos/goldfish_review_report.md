# Goldfish Annotated Review Report — Ronda 1

**Target:** `docs/designs/2026-11-15-explora-derechos.md` (full file)
**Revisores:** `design_critic` (completed: 0 🔴 · 11 🟡 · 6 🟢), `codebase_details` (completed: 7 🔴 · 11 🟡 · 7 🟢).
Hallazgos duplicados entre revisores se fusionaron (ids originales entre corchetes).
Comprobado a mano por el Elephant: R1-B6 (`--remote` escribe `lecta.gutenberg_books`, el Worker lee `lecta_dev.`) y R1-B2 (`App.tsx:1416-1424`, `withFile = hasLectaPlus`).

Resultado: ningún CONTEST. Todo es PROPOSE FIX salvo dos DECLINE. Ronda **no limpia**.

**Aplicado (2026-11-15, aprobado por Luis: «Aplicar todo»)**: F1–F27 en el
documento, reescrito con §1 Objetivos/No objetivos, §5 Verificación,
§6 Orden de despliegue y §8 Fuentes por verificar. F28–F29 quedan como
DECLINE. Cambio de numeración: la marca PG pasó a R4 🔴 (antes R5 🟡, por F2);
robots → R5; Trakt → R7 nuevo; caché → R8. Siguiente: ronda 2.

## 🔴 Blocker

### F1 [codebase-B1, design-M1] `issued` no es fecha de publicación
- **Scope:** L35, L186-187 (§2.1, R6 ✅).
- **Discrepancia:** `dcterms:issued` es la fecha de alta del ebook en PG (≥1971), no de la obra. El ✅ bloquearía casi todo o nada útil. `client/lib/catalog.ts:285-287` además lo pinta como «Publicado en».
- **Sugerencia:** PROPOSE FIX. Redefinir `issued`; sustituir el ✅ por «Various/anónimos bloqueados salvo lista blanca» + chequeo de `dcterms:rights` (F8). Anotar el texto «Publicado en» engañoso.

### F2 [codebase-B2, design-N3] EPUBs de PG ya llegan a rutas de pago
- **Scope:** L19-21, L119-125, L181-182 (R5).
- **Discrepancia:** «Obtener» sube el EPUB a `/api/books/:hash` (`requireLectaPlus`, `app.ts:2245`), a R2 `books/`/`user-books/` y al portal Kindle (`requireKindlePlan`, caché `kcache/`). La prueba propuesta no lo cubre.
- **Sugerencia:** PROPOSE FIX. Añadir esos caminos a §2.1 y R5; aclarar que §1.E.8 se activa por cobrar copias/acceso; mitigación: quitar la marca PG antes de sync/Kindle o excluir libros de catálogo de la sync de pago.

### F3 [codebase-B3] No todo sale del Worker
- **Scope:** L42-43, L176-177.
- **Discrepancia:** `gutenberg-index.mjs` (`lecta-catalog-index/1.0`) y `catalog-seed.mjs` (`lecta-catalog-seed/1.0`, RDF+EPUB+portada por libro, concurrencia 3) también pegan a `www.gutenberg.org`.
- **Sugerencia:** PROPOSE FIX. Listar los tres clientes y meter el seed en R4.

### F4 [codebase-B4] URL de respaldo
- **Scope:** L37. Es `.epub.images`, no `.epub`; añadir ≤25 MB, firma `PK`, 25 s, 502.
- **Sugerencia:** PROPOSE FIX.

### F5 [codebase-B5, design-M4] Roles y traducciones mal descritos
- **Scope:** L136-142.
- **Discrepancia:** no existe rol `ill`: todo lo que no es `creator/trl/edt` es `other`. `trl` no cubre publicación póstuma (sin regla). Traductores ausentes del RDF pasan. «Conservador para EE. UU.» es falso: allí cuenta la publicación, PG ya filtra.
- **Sugerencia:** PROPOSE FIX. Reescribir viñeta; mitigación para traducciones sin traductor (idioma ≠ original o buscar «Translated by» en el front matter).

### F6 [codebase-B6] Causa del índice vacío y bug de `--remote`
- **Scope:** L44.
- **Discrepancia:** el Worker no carga índice; el 403 bloquea el `--build` manual. El Worker lee `lecta_dev.gutenberg_books` siempre (`CATALOG`), pero `--load --remote` escribe `lecta.gutenberg_books`, que nadie lee.
- **Sugerencia:** PROPOSE FIX en el doc + anotar bug de código como trabajo aparte.

### F7 [codebase-B7, design-M5] Depurar el índice no deja de servir
- **Scope:** L139-140, L188.
- **Discrepancia:** un hit en R2 de `catalog/pg-<n>.*` se sirve sin sesión ni índice, `public, immutable` (`catalog.ts:484-489`).
- **Sugerencia:** PROPOSE FIX. El ✅ borra también los objetos R2, o el hit `pg-` revalida índice; bajar TTL de `pg-`; admitir que copias `immutable` en clientes no se recuperan.

## 🟡 Major

| Id | Origen | Scope | Hallazgo | Sugerencia |
|---|---|---|---|---|
| F8 | design-M2, codebase-M3 | R6 | `dcterms:rights` se parsea y se ignora; PG marca «Copyrighted». | PROPOSE FIX: ✅ rechazar todo lo que no sea «Public domain in the USA.» |
| F9 | design-M3, codebase-M1, codebase-N3 | L32-34 | Regex de siglo acepta «20th century»/«siglo XX»; `anon` sin límite de palabra («Canon», «Ganong»). | PROPOSE FIX: R6 + ✅ arreglar regex con pruebas. |
| F10 | codebase-M2 | L30-35 | `rightsCheck([])` = ok; agentes por `rdf:resource` no se parsean. | PROPOSE FIX: bloquear sin creador. |
| F11 | codebase-M4 | L33-34 | Avisos se tiran en el índice; `aui`/`com` (introducciones) dentro del EPUB. | PROPOSE FIX. |
| F12 | design-M6 | R4 | Portada `pg-` sin sesión ni cuota = scraper abierto de gutenberg.org. | PROPOSE FIX: ✅ sesión+cuota o sembrar por lotes. |
| F13 | design-M7 | L175-179 | Espejos usan otra estructura de URL; el proxy bajo demanda sigue siendo automatizado. | PROPOSE FIX: promover siembra por lotes a ✅. |
| F14 | design-M8 | L159-162 | Corpus de frecuencias «de investigación» son NC y vienen de los mismos subtítulos; subir subtítulos propios sigue empujando a piratería. | PROPOSE FIX. |
| F15 | design-M9 | L171-173 | OMDb no puede licenciar lo que es de IMDb; licencia comercial no verificada. Wikidata (CC0) como alternativa. | PROPOSE FIX. |
| F16 | design-M10, codebase-M6 | §2.4 | Trakt guarda en R2 `screen-discover/v1/{rails,related-*}.json`; términos de API (uso comercial, caché) sin revisar. | PROPOSE FIX. |
| F17 | design-M10, codebase-M7 | R2 | `hasPoster: true` fijo en rieles: Trakt/curado disparan copias de pósters. | PROPOSE FIX. |
| F18 | codebase-M8 | R2 | Pósters copiados a IndexedDB (`StoredBook.cover`, `App.tsx:1786-1803`). | PROPOSE FIX: limpieza en cliente. |
| F19 | codebase-M9 | R1 | Último recurso baja pack de temporada completo. | PROPOSE FIX. |
| F20 | codebase-M10, design-N2 | R7 | `/api/screen/search` y primer EPUB `pg-` también `public` con sesión. | PROPOSE FIX: inventario completo. |
| F21 | codebase-M11 | L28-29 | Fila guarda `language`, `search_text`; tarball/RDF/NDJSON locales; reusa tarball viejo si falla. | PROPOSE FIX. |
| F22 | codebase-M5, design-N5 | §2.1 | Ruta curada sin describir: `allowContributors`, vocab, `index.json` con sinopsis. | PROPOSE FIX: subsección. |
| F23 | design-M11 | todo | Afirmaciones de terceros sin fuente; faltan Objetivos, Verificación y Rollout. | PROPOSE FIX: tabla de fuentes «por verificar» con fecha + secciones. |

## 🟢 Nit

| Id | Origen | Hallazgo | Sugerencia |
|---|---|---|---|
| F24 | design-N4, codebase-N6 | «tres pestañas» con 4 filas. | PROPOSE FIX |
| F25 | design-N1 | TMDB no licencia el arte. | PROPOSE FIX |
| F26 | design-N6 | 1924 es corte conservador deliberado, no «el plazo de México». | PROPOSE FIX |
| F27 | codebase-N1, N2, N7 | Línea 18-20; clave `catalog/pg-<n>.cover.jpg`; «4.0» sin fuente; logs sin contenido de terceros. | PROPOSE FIX |
| F28 | codebase-N4 | Detalles de la guía (4 KB, clave, `screenPhrases`). | DECLINE: no cambia el análisis. |
| F29 | codebase-N5 | Póster exige `OMDB_API_KEY` aun en hit R2. | DECLINE: funcional, no de derechos. |

---

# Ronda 2

**Revisores:** `design_critic` (completed: 2 🔴 · 8 🟡 · 5 🟢), `codebase_details` (completed: 3 🔴 · 4 🟡 · 7 🟢). Ronda **no limpia**.
Reabiertos (arreglo de ronda 1 incompleto): F20 → G5 (inventario de caché inexacto), F2 → G1/G2.
Sin churn: ningún hallazgo se resuelve revirtiendo un arreglo.

## 🔴 Blocker

| Id | Origen | Scope | Hallazgo | Sugerencia |
|---|---|---|---|---|
| G1 | design-B2, code-F1, code-F5 | §2.1.4, M4, §5 | M4 no elige (bloquear vs quitar marca). Hay dos subidas: `PUT /api/books/:hash` (cola) y `PUT /api/user/books/:id/file` (directa, `App.tsx:1423-1430`). El cliente no distingue libro de catálogo (mismo SHA-256 si se sube a mano). Sin limpieza de copias ya hechas (`books/`, `user-books/`, `kcache/` compartido por hash). | PROPOSE FIX: elegir **quitar la marca** (funciona por cualquier camino); citar ambos endpoints; paso de inventario y limpieza; bloqueo de servidor como respaldo. |
| G2 | design-B1 | M4 §5 | Buscar «Project Gutenberg» en el `.epub` comprimido nunca encuentra nada. | PROPOSE FIX: descomprimir y buscar `/project gutenberg\|gutenberg\.org\|PG-tm/i` en cada entrada; listar archivos a reescribir (opf, ncx/nav, cabecera/pie); portadas con marca. |
| G3 | code-F2 | §2.1.1 | El seed no espacia 300 ms por petición: 300 ms por libro, varias peticiones seguidas por libro + reintentos; banderas configurables. | PROPOSE FIX |
| G4 | code-F3 | R8, §2.4 | Solo `/api/screen/search` lleva `public, max-age=300`; `/tv`, `/season`, `/guide`, `/related` no mandan cabecera; `private` solo en `/discover`. | PROPOSE FIX (reabre F20) |

## 🟡 Major

| Id | Origen | Hallazgo | Sugerencia |
|---|---|---|---|
| G5 | design-M1 | M8 bloquearía `lazarillo` («Anónimo») y `cien-mejores-poesias` («Varios»); traducciones curadas sin traductor (Homero, Dante, Dostoievski…) sin auditar; M9 no cubre `catalog/<id>.*`. | PROPOSE FIX |
| G6 | design-M2 | M9 depende del bug de tabla (paso 5) y con 0 filas revalidar = 404 de todo `pg-`. Falta limpieza offline de `catalog/pg-*` existentes. | PROPOSE FIX: tabla antes de M9; compuerta «nada se reactiva con índice vacío»; auditoría offline. |
| G7 | design-M3, code-F14 | M5 con cuota del EPUB (20/h) rompe la UI (24 portadas por página). M6 sin dimensionar; alternativa de redirigir al espejo sin evaluar. | PROPOSE FIX |
| G8 | design-M4 | R3 🔴 sin mitigación que cierre NC; solo crédito. | PROPOSE FIX + **decisión de Luis**: medida provisional (quitar `OMDB_API_KEY` o bandera). Ojo code-F13: sin la llave, los pósters ya en R2 dan 503. |
| G9 | design-M5 | Falta riesgo de retiro de contenido (notice-and-takedown, reforma LFDA 2020). | PROPOSE FIX: R9 + runbook + pregunta al abogado. |
| G10 | design-M6 | Parseo: `rdf:resource` sin mitigar, `roleBlock` acepta etiqueta autocerrada; `ill` fuera; traducciones/póstumas sin prueba ni paso. | PROPOSE FIX |
| G11 | design-M7 | Falta sección de alternativas descartadas. | PROPOSE FIX |
| G12 | design-M8 | Orden de despliegue contradice severidad (M5 🟡 antes que M4 🔴; R3 sin paso). | PROPOSE FIX |
| G13 | code-F4 | `PUT /api/books/:hash/cover` copia la portada a `covers/<userId>/` **también en Gratis** (`App.tsx:784-793`). | PROPOSE FIX |
| G14 | code-F6 | wrangler 4.141 no lista R2; limpieza de IndexedDB necesita migración probada (`previous?.cover`). | PROPOSE FIX: nombrar herramienta (cliente S3 con credenciales R2) y prueba de migración. |
| G15 | code-F7 | `rightsCheck` no ve `dcterms:rights`; el seed curado no usa `indexRowFromRdf`; `catalog-seed.mjs` no es probable. | PROPOSE FIX: `admitRdf(xml, opts)` exportada y usada por ambos scripts. |

## 🟢 Nit

Todos PROPOSE FIX por baratos: design-N1 (para qué sirve la regex anclada), N2 (guías = formas + nombres propios + claves de frases; pregunta al abogado), N3 (pósters ya entregados `immutable`), N4 (fuentes faltantes en §8), N5 (R5/R6 latentes con índice vacío; compuerta); code-F8 (aviso en consola, no silencio), F9 (0 filas: respaldar con `count(*)` fechado; `--prod` = `--remote`), F10 (logs con mensaje de error), F11 (el seed curado guarda avisos en `catalog.seed.json`), F12 (MCP reexpone el catálogo), F13 (clave `.jpg` fija, tope 2 MB, hit R2 exige `OMDB_API_KEY`).

**Aplicado ronda 2 (2026-11-15)**: G1–G15 y todos los Nit en el documento.
Decisión de Luis para G8: quitar `OMDB_API_KEY` (M0, con `SUBDL_API_KEY` y la
pestaña oculta). Cambios de estructura: §2.1 partido en 2.1.1–2.1.6, tabla de
tres copias R2 (G1, G13), R8 nuevo = retiro de contenido (G9), caché pasa a
R9, §5 Alternativas descartadas (G11), §6 Verificación, §7 orden por
severidad (G12), compuerta de recarga del índice (G6, N5). Riesgo residual
aceptado y anotado: obras póstumas y traducciones sin traductor en el índice
de búsqueda. Siguiente: ronda 3.

---

# Ronda 3

**Revisores:** `design_critic` (completed: 2 🔴 · 9 🟡 · 4 🟢), `codebase_details` (completed: 5 🔴 · 6 🟡 · 6 🟢). Ronda **no limpia**.
Reabiertos: F24/N6 (número de pestañas: el arreglo de ronda 1 lo empeoró; son 3 pestañas, `ExploreShelf.tsx:25`), G5 (entradas curadas mal identificadas: el Elephant usó nombres de la curación y no los del RDF).
Churn: parcial en pestañas (se corrige reestructurando la tabla, no revirtiendo).

## 🔴 Blocker

| Id | Origen | Hallazgo | Sugerencia |
|---|---|---|---|
| H1 | design-F1, code-B5 | M0 no cierra R1: `POST /api/screen/guide` sirve guías de R2 antes de mirar `SUBDL_API_KEY` (`screen.ts:605-621`). Los rieles de Trakt siguen funcionando (no usan OMDb) con portada tipográfica. «Cierra R1–R3» es falso. | PROPOSE FIX: interruptor `SCREEN_ENABLED` que pone toda `/api/screen/*` en 503 (guías y Trakt incluidos); «conservar sin servir»; reescribir «cierra». |
| H2 | design-F2, code-M3 | M4 limpia «antes de publicar», pero los `catalog/*.epub` con marca ya están en R2 con `immutable`; sobrescribir la misma clave deja copias un año y rompe `epubSha256`. | PROPOSE FIX: republicar con claves nuevas (`.v2`), regenerar `index.json`/`vocab.json`, borrar claves viejas; M4b incluye `catalog/`; verificación sobre todo lo publicado. |
| H3 | code-B4 | El Kindle lee `catalog/<id>.epub` directo (`kindle/routes.ts:1489-1491`); `/k/read/:hash` no valida sha256 → `/k/read/quijote` sirve el EPUB con marca a usuarios de pago y cachea `kcache/*/quijote/`. | PROPOSE FIX: añadir a §2.1.5, a M4b y validar forma del parámetro o propiedad. |
| H4 | code-B2 | Entradas de M8 mal identificadas: el RDF de `lazarillo` dice «Anonymous»; `cien-mejores-poesias` no tiene «Varios» en el RDF sino solo `other` (Menéndez y Pelayo, †1912) y caería por M7 (sin creator). Endurecer roles bloquearía `treasure-island` (Rhead †1926), `dona-perfecta` (†1937, †1957), `obras-becquer` (†1944, †1938). | PROPOSE FIX (reabre G5) |
| H5 | code-B3 | Iliada, Odisea, Crimen y castigo, Miserables y Alhambra **no están publicadas** (rechazadas por `trl`); Dante, Camões, Heródoto tienen `trl` válido. El hueco real: `dama-camelias` (traducción sin `trl`). | PROPOSE FIX |
| H6 | code-B1 | Son tres pestañas; curado y búsqueda comparten «Libros gratuitos». | PROPOSE FIX (reabre F24) |

## 🟡 Major

| Id | Origen | Hallazgo | Sugerencia |
|---|---|---|---|
| H7 | design-F3 | M4 no cubre EPUB de PG subidos a mano desde gutenberg.org. | PROPOSE FIX: detectar la marca por contenido en servidor, o argumentar caso distinto + pregunta al abogado. |
| H8 | design-F4 | M4b rompe datos de pago: la identidad es el hash (posiciones, guías, `kcache`); sin bloqueo en servidor la cola los vuelve a subir. | PROPOSE FIX: bloqueo en servidor ✅ antes de M4b; migración hash viejo → nuevo; aviso. |
| H9 | design-F5 | Puerto seguro de la LFDA solo cubre contenido subido por usuarios; `catalog/`, pósters, guías y Trakt son contenido del operador. | PROPOSE FIX: partir R8. |
| H10 | design-F6 | Catálogo curado expuesto hoy con traducciones sin auditar = posible infracción, 🟡 < R4 🔴. | PROPOSE FIX: R6-curado 🔴; retirar `dama-camelias` y las 3 con aviso hasta auditar. |
| H11 | design-F7 | Riesgo residual sin dueño. | PROPOSE FIX: decisión explícita en §8 + heurística en `admitRdf`. |
| H12 | design-F8 | Compuerta solo procedimental: un `--load` normal a `lecta_dev` reactiva prod. M5 vs M6 incoherente. | PROPOSE FIX: interruptor `CATALOG_PG_FETCH=off` ya; tabla antes de cargar; M6 reemplaza M5. |
| H13 | design-F9 | Arreglos del parser sin ✅ pero M7/M8 dependen de ellos. | PROPOSE FIX |
| H14 | design-F10 | Trakt sigue activo tras M0. | Cubierto por H1. |
| H15 | design-F11 | Política de robots ofrece feeds y `/robot/harvest`; el 403 puede ser bloqueo ya activo; tarball viejo hace `dcterms:rights` rancio. | PROPOSE FIX |
| H16 | code-M1 | `installScreenWork` guarda también la guía fusionada en `paperGuideSessionKey(hash)`. | PROPOSE FIX |
| H17 | code-M2 | No hay framework de migración IndexedDB; precedente = bandera de sesión; unidad = cada base local. | PROPOSE FIX |
| H18 | code-M4 | Patrón del seed: modo `verify` por defecto solo RDF + HEAD; GET completos solo con `--seed`; timeout 30 s. | PROPOSE FIX |
| H19 | code-M5 | Otras tres rutas escriben `covers/<userId>/`. | PROPOSE FIX |
| H20 | code-M6 | No existe interruptor para ocultar la pestaña: requiere código. | PROPOSE FIX |

## 🟢 Nit

PROPOSE FIX: design-F12 (justificación por entrada en lista blanca; `an[oó]nimo`), F13 (M5 probar con portada no cacheada; R2 hits siguen `public`), F14 (revisar nombres de archivo y OPF; escaneo de todo `catalog/*.epub`), F15 (cubierto por H1); code-N1 (índice ignora avisos y acepta), N2 (`/discover` sí manda `private`), N3 (404 tras purga requiere quitar fila; caché de `index.json`), N4 (503 con sesión), N5 (`screen-discover/` en R8; objetos en R2 fuera del índice), N6 (prefijo `src/`).

**Aplicado ronda 3 (2026-11-15, «Aplicar todo»)**: H1–H20 y Nits. El Elephant
verificó antes de escribir, contra `catalog-seed/catalog.seed.json` e
`index.json`: colaboradores RDF de las seis entradas curadas, que Iliada/
Odisea/Crimen/Miserables/cuentos-alhambra no están publicadas
(`alhambra-leyendas` sí, pero es de Fernández y González, no traducción) y
`kindle/routes.ts:1489-1491`. Cambios: interruptores `SCREEN_ENABLED` y
`CATALOG_PG_FETCH`; M4 partido en M4a–M4d (rechazo por contenido en servidor,
Kindle solo sha256 propio, claves `.v2`, migración de hash); R5 nuevo 🔴
(catálogo curado: retirar 4 entradas); R9 partido en contenido de usuarios /
de Lecta; M7 (siembra por lotes) sustituye a la cuota de portadas; parser
dentro de M8; riesgo residual con dueño (§8.3). Siguiente: ronda 4.

---

# Ronda 4

**Revisores:** `design_critic` (completed: 1 🔴 · 7 🟡 · 3 🟢), `codebase_details` (completed: 1 🔴 · 7 🟡 · 10 🟢). Ronda **no limpia**.
Reabiertos: H4 (`lusiadas` no tiene `trl` fechado), M4b (falta `/k/preview/page`), M0 (verificación incompleta).
Confirmado a mano por el Elephant: `kindle/routes.ts:1584` devuelve `kcache` antes de comprobar propiedad; `app.ts:2278` publica `hash` en `/api/books/community`.

## 🔴 Blocker

| Id | Origen | Hallazgo | Sugerencia |
|---|---|---|---|
| I1 | design-1, code-3 | **Fuga en producción**: `kcache/ch|res/<hash>/` es compartido y se lee antes de comprobar propiedad en `/k/read`, su ruta de recursos y `/k/preview/page?book=` (acepta slugs). Los hashes son públicos vía Comunidad → una cuenta con Kindle lee capítulos de libros con derechos de otro usuario. Rompe la promesa A1 de Comunidad; sin puerto seguro. | PROPOSE FIX: R11 🔴 propio; guardia de propiedad común antes de la caché en las tres rutas; quitar `catalog/` de `loadEpubObjectForKindle`; prueba con caché sembrada; paso 1. **Arreglo de código aparte, urgente.** |
| I2 | code-1 | `lusiadas`: el `trl` «Gómez de Tapia, 16th century» no tiene fecha; pasa por la regex de siglo. | PROPOSE FIX (reabre H4) |

## 🟡 Major

| Id | Origen | Hallazgo | Sugerencia |
|---|---|---|---|
| I3 | design-2, code-4 | M4a: «rechazar o limpiar» sin decidir; limpiar en servidor rompe la identidad por hash (`app.ts:2160-2162`); bloquear EPUB del usuario se adelanta al abogado; regex con falsos positivos; M4a antes de M4c rompe «Obtener»; faltan `POST /api/books(/:hash)`. | PROPOSE FIX: rechazar en servidor (dentro de `handleBookUpload` y `user-books`), limpiar en cliente antes del hash; solo hashes de catálogo hasta el abogado; marcadores de PG reales; desplegar con M4c; manejo del rechazo en la cola. |
| I4 | design-3 | `catalog/<id>.v2.epub` no lo sirve ninguna ruta (`catalog.ts:469-479`). | PROPOSE FIX: id nuevo `<id>-v2`; borrar viejos tras vencer la caché del índice. |
| I5 | design-4 | Compuerta y despliegue se contradicen; `CATALOG_PG_FETCH` sin sentido tras M7; borrar filas no está en la compuerta. | PROPOSE FIX: una sola compuerta. |
| I6 | design-5 | Objetos de `catalog/` fuera de `index.json` públicos hasta el paso 4; la herramienta de listado no es un paso. | PROPOSE FIX |
| I7 | design-6 | M2 deja obras de pantalla rotas en la estantería y palabras etiquetadas; guías usadas offline hasta el paso 3. | PROPOSE FIX |
| I8 | design-7 | Copias locales en IndexedDB con marca sin vencimiento; IA de Lecta+ sobre texto con marca sin analizar. | PROPOSE FIX |
| I9 | design-8, code-2 | `cien-mejores-poesias` es posible infracción pero M5 no la retira; «M7» debe ser «M8». | PROPOSE FIX |
| I10 | code-5 | El respaldo JSON exporta `paperGuide:v1:` y restaurarlo reinstala guías de SubDL tras M2. | PROPOSE FIX |
| I11 | code-6 | La verificación de M7 (grep sin `www.gutenberg.org`) no puede pasar: el volcado RDF y los tests usan el host. | PROPOSE FIX |
| I12 | code-7, design-9 | Verificación de M0 sin póster en R2, `/related`, `/tv`, `/season`. | PROPOSE FIX (reabre) |
| I13 | code-8 | AGENTS.md:318 dice «licencia OMDb CC BY-NC revisada por Luis y aceptada»; el doc no lo cita. | PROPOSE FIX: citar y decir que M0 lo reemplaza. |

## 🟢 Nit

PROPOSE FIX: design-10 (cubierto por I3), design-11 (guías de Comunidad de libros de catálogo), code-9 (`App.tsx:1815-1831`), code-10 (líneas de pestaña y retornos a `screen`), code-11 (R10: cualquier 2xx de OMDb), code-12 (HEAD 20 s), code-13 (`salambo`, `historia-dos-ciudades`), code-14 (CSP `img-src 'self' data: blob:`), code-15 (`treasure-island` > 40 MB no entra al Kindle), code-16 (scripts de sonda), code-17 (cliente de búsqueda), code-18 (crédito Trakt con zona apagada).

## Estado del bucle

4 de 5 rondas. Ninguna limpia. La ronda 5 es el tope: si sale con hallazgos, toca decidir aceptar, seguir o devolver a borrador.

**Aplicado ronda 4 (2026-11-15, «Aplicar y ronda 5»)**: I1–I13 y Nits. R11 🔴
nuevo (caché del Kindle) con M12, que absorbe M4b; el arreglo de código corre
en la sesión aparte «Kindle: guardia de propiedad antes de kcache». M4c usa
ids `<id>-v2`; M4a rechaza en servidor (sin limpiar), por marcadores de PG,
solo hashes de catálogo, desplegado con M4c. M1 nuevo (herramienta de listado
de R2). M5 retira seis entradas (+`lusiadas`, `cien-mejores-poesias`) y los
objetos fuera del índice. Compuerta única. M2 borra obras de pantalla locales
y filtra el respaldo. Cita a AGENTS.md:318. Siguiente: ronda 5 (tope).

---

# Ronda 5 (tope)

**Revisores:** `design_critic` (completed: 0 🔴 · 6 🟡 · 4 🟢), `codebase_details` (completed: 3 🔴 · 7 🟡 · 9 🟢). Ronda **no limpia**. Bucle detenido en el tope de 5 rondas, sin convergencia. Estos hallazgos **no** se aplicaron al documento.

Tendencia: los Blockers bajaron de 7 (r1) a 3 (r5), y desde la r4 los de diseño son de coherencia interna (orden, dependencias), no de exposición nueva. Los hallazgos de la r5 ya no cambian qué hacer primero, solo detallan cómo.

## Abiertos por severidad

### 🔴
- **J1** (code-B1): la guardia de M12 no cubre las filas `paper_only` que crea `POST /api/books/community/:hash/attach`; `/k/preview/page` sin `book` elige `firstKindleBookHash` y puede servir el `kcache` del donante. Reenviado a la sesión del arreglo del Kindle.
- **J2** (code-B2): la importación del respaldo no restaura las obras de pantalla (borra registros de 0 bytes), solo deja `paperGuide:v1:` huérfanas; `screenPhrases:v1:` no se exporta.
- **J3** (code-B3, design-7): la caché de `index.json` en el cliente no vence (solo se usa sin conexión) y viaja en el respaldo; las condiciones «tras vencer la caché» no tienen base.

### 🟡
- **J4** (design-1, design-6, code-M-b): M5 borra objetos (`pg-*`, huérfanos) cuyos hashes necesitan M4a y M4d; hace falta un manifiesto previo. `/api/user/books/:bookId/file` no verifica el hash declarado; la prueba de M4a mezcla lista de hashes y marcadores.
- **J5** (design-2): las copias ya entregadas de las seis entradas retiradas (sync, Kindle, IndexedDB, `immutable`) no tienen mitigación ni figuran en el residuo.
- **J6** (design-3): orden: M9 depende del camino de M7 (paso 8); M4c republica antes de M8/M9.
- **J7** (design-4, code-M-c): la regla de borrado de M5 choca con M7 y, literal, borraría `catalog/index.json` y todo `pg-*`.
- **J8** (design-5): R4 sin medida provisional entre el paso 1 y el 4 (ocultar «Obtener» o marcar sin subida).
- **J9** (code-M-a): `catalog-seed/index.json` local no refleja lo publicado (sin `epubSha256` en español; `epubBytes` = HEAD): el estado real sale de `GET /api/catalog` y R2.
- **J10** (code-M-d): quitar los secretos de producción no para los scripts de sonda ni `wrangler dev` (`.env`, `.dev.vars`).
- **J11** (code-M-e): no hay mecanismo para que el cliente sepa `SCREEN_ENABLED`.
- **J12** (code-M-f): texto de libros enviado a DeepSeek; zipf de wordfreq incluye OpenSubtitles/SUBTLEX (choca con el descarte de §5); portadas en CacheStorage; `LegalNotice.tsx` ya tiene términos y es el lugar de M3/M11.
- **J13** (code-M-g): la migración de hash debe cubrir también `user_books.book_id`, `lecta_user_positions.book_hash`, `guides/<hash>.json` y todas las claves de `isBookScopedSessionKey`.

### 🟢
design-8 (bloqueo técnico de `--load`), design-9 (M4c revisar contenido de texto y portadas), design-10 (residuo: guías conservadas, respaldos en disco, capítulos ya filtrados; nivel del MCP); code: `:bookId`, «Tus títulos», `skipped.json`, el seed sí comprueba idioma, regex `/gutenberg/i`, `ctb` en M8, `user-books.test.ts:315-335`, `kcache` de ids retirados, traducciones revisadas (`hamlet`, `divina-comedia`, `herodoto-1`).

**Cierre (2026-11-15)**: Luis eligió «Aplicar r5 y aceptar». J1–J13 y los Nit
de la ronda 5 se aplicaron al documento **sin una ronda de re-revisión**. El
bucle termina **aceptado en el tope** (5 rondas, sin dos rondas limpias
seguidas). Novedades: M12 con propiedad = `paper_only = false`; M13 (sin subir
libros de catálogo hasta M4c); M14 (manifiesto antes de borrar); M5b (copias
ya entregadas, al abogado); M7 partido en M7a (camino, antes de M8/M9) y M7b
(siembra, columna `seeded`); M4c después de M8/M9 y con `catalogIndex:v2`;
M4a solo por lista de hashes calculados en servidor; constante
`VITE_SCREEN_ENABLED`; compuerta técnica `--gate-ok`; R12 nuevo (texto a
DeepSeek). Arreglo de código del Kindle: rama
`claude/xenodochial-morse-c44cc2`, commits `295c8a9` y `efaeffa`, sin
desplegar ni fusionar.
