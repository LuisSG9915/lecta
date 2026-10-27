# Reporte de auditoría — estrategia de aprendizaje de Lecta

Generado: 2026-10-27T22:47:39.787Z
Documento auditado: `docs/estrategia-aprendizaje-2026-10-24.md`
Registro: `docs/auditoria/claims.json`
Commit: `d55b7432af161113d091b5f4d1251dcf8e360394`
Red: sí (DOI/URL resueltos)

**Veredicto: PASS** — 14 afirmaciones aprobadas, 0 refutadas, 0 refutadas por auditoría, 0 sin verificar, 0 comprobaciones omitidas.

## Afirmaciones

### ✅ H1-cobertura-tipos — La cobertura se calcula sobre formas únicas y con el perfil del idioma del libro

> El porcentaje de cobertura divide conocidas+guardadas entre formas únicas (types), sin ponderar por apariciones (tokens), y se mide con el perfil del idioma del libro, no siempre con el de español.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): MATIZADA** — La fórmula sí usa formas únicas y ahora cada libro se mide con su idioma. Pasar a tokens sube la cifra en vez de bajarla (simulación: 88 % de tipos ≈ 98 % de tokens), así que la insignia es conservadora.
- evidencia: `src/client/lib/knowledge.ts:288`
- evidencia: `src/client/lib/coverage.ts:114-140`

- ✅ **PASS** · doc-mention: el documento contiene «Se calcula sobre **formas únicas**»
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:295 coincide con /\(knownCount \+ savedCount\) / total/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":295,"text":"? Math.max(0, Math.min(100, Math.round(((knownCount + savedCount) / total) * 100)))"}`
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:292 coincide con /const total = forms\.length/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":292,"text":"const total = forms.length;"}`
- ✅ **PASS** · code-absent: /\btokens?\b/ no aparece en src/client/lib/coverage.ts
- ✅ **PASS** · reachable: createCoverageInputsLoader se usa en producción (2 archivo/s)
  - observado: `{"symbol":"createCoverageInputsLoader","callers":[{"file":"src/client/components/DiscoverRail.tsx","line":115,"text":"const inputsFor = createCoverageInputsLoader(scope, loadInputs);"},{"file":"src/client/components/Shelf.tsx","line":390,"text":"const inputsFor = createCoverageInputsLoader(scope);"}]}`
- ✅ **PASS** · referencia laufer2010: https://eric.ed.gov/?id=EJ887873 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ887873","http":200}`
- ✅ **PASS** · referencia nation2006: Crossref: 2006 · how large a vocabulary is needed for reading and listening?
  - observado: `{"doi":"10.3138/cmlr.63.1.59","year":2006,"title":"how large a vocabulary is needed for reading and listening?"}`
- ✅ **PASS** · referencia schmitt2011: https://eric.ed.gov/?id=EJ928357 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ928357","http":200}`

### ✅ H1-umbrales-dobles — Una sola escala de umbrales de cobertura y conteo de reencuentros

> Las tres superficies (catálogo, estantería y etiqueta de nivel) leen los mismos umbrales 94/86 definidos una sola vez, y la cobertura reporta cuántas formas del libro están en el Cuaderno y cuántos lemas distintos del Cuaderno reaparecen.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): SOSTENIDA** — Antes había tres juegos de umbrales (90/75/60, 94/86 y 95/88) y Descubre mostraba dos etiquetas contradictorias; hoy hay una sola escala y una sola etiqueta.
- evidencia: `src/client/lib/coverage.ts:178-207`
- evidencia: `src/client/lib/catalog.ts:279-300`
- evidencia: `src/client/components/DiscoverRail.tsx:216-230`

- ✅ **PASS** · doc-mention: el documento contiene «Una sola escala de umbrales»
- ✅ **PASS** · code-anchor: src/client/lib/coverage.ts:207 coincide con /COVERAGE_FLUID_MIN = 94/
  - observado: `{"file":"src/client/lib/coverage.ts","line":207,"text":"export const COVERAGE_FLUID_MIN = 94;"}`
- ✅ **PASS** · code-anchor: src/client/lib/coverage.ts:208 coincide con /COVERAGE_IDEAL_MIN = 86/
  - observado: `{"file":"src/client/lib/coverage.ts","line":208,"text":"export const COVERAGE_IDEAL_MIN = 86;"}`
- ✅ **PASS** · code-anchor: src/client/lib/coverage.ts:184 coincide con /reencuentrosCount: reencounterLemmas\.size/
  - observado: `{"file":"src/client/lib/coverage.ts","line":184,"text":"reencuentrosCount: reencounterLemmas.size,"}`
- ✅ **PASS** · code-anchor: src/client/lib/catalog.ts:282 coincide con /COVERAGE_FLUID_MIN/
  - observado: `{"file":"src/client/lib/catalog.ts","line":282,"text":"if (bookDifficultyOrLevel >= COVERAGE_FLUID_MIN) {"}`
- ✅ **PASS** · referencia schmitt2011: https://eric.ed.gov/?id=EJ928357 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ928357","http":200}`
- ✅ **PASS** · referencia laufer2010: https://eric.ed.gov/?id=EJ887873 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ887873","http":200}`

### ✅ H2-preparacion-40 — La preparación automática ofrece hasta 40 filas y entra por aviso

> La hoja «Antes de leer» admite hasta 40 filas y no interrumpe: el código degrada la apertura automática a un aviso, y el lector la abre con «Preparar antes de leer».

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): SOSTENIDA** — La hoja no se abre sola: el lector ve una pastilla y decide. El tope de 40 se conserva para la consulta bajo demanda, y la tarjeta rápida muestra 3 cartas y 8 filas por página.
- evidencia: `src/client/hooks/useReaderChapterPrep.ts:365-375`
- evidencia: `src/client/components/reader/ReaderNotices.tsx:101-131`

- ✅ **PASS** · doc-mention: el documento contiene «hasta **40 filas**»
- ✅ **PASS** · code-anchor: src/client/lib/section-words.ts:201 coincide con /PREPARATION_ROWS_CAP = 40/
  - observado: `{"file":"src/client/lib/section-words.ts","line":201,"text":"export const PREPARATION_ROWS_CAP = 40;"}`
- ✅ **PASS** · code-anchor: src/client/lib/settings.ts:411 coincide con /chapterPrimingMode: "auto"/
  - observado: `{"file":"src/client/lib/settings.ts","line":411,"text":"chapterPrimingMode: \"auto\","}`
- ✅ **PASS** · code-anchor: src/client/hooks/useReaderChapterPrep.ts:51 coincide con /unknownKeyWordsCount <= 0/
  - observado: `{"file":"src/client/hooks/useReaderChapterPrep.ts","line":51,"text":"if (unknownKeyWordsCount <= 0) return false;"}`
- ✅ **PASS** · code-anchor: src/client/hooks/useReaderChapterPrep.ts:369 coincide con /opening = "notice"/
  - observado: `{"file":"src/client/hooks/useReaderChapterPrep.ts","line":369,"text":"opening = \"notice\";"}`
- ✅ **PASS** · code-anchor: src/client/lib/section-words.ts:508 coincide con /MAX_PREVIEW_WORDS = 5/
  - observado: `{"file":"src/client/lib/section-words.ts","line":508,"text":"export const MAX_PREVIEW_WORDS = 5;"}`
- ✅ **PASS** · referencia yanagisawa2020: Crossref: 2020 · how do different forms of glossing contribute to l2 vocabulary learning from reading?
  - observado: `{"doi":"10.1017/S0272263119000688","year":2020,"title":"how do different forms of glossing contribute to l2 vocabulary learning from reading?"}`
- ✅ **PASS** · referencia elleman2009: Crossref: 2009 · the impact of vocabulary instruction on passage-level comprehension of school-age children
  - observado: `{"doi":"10.1080/19345740802539200","year":2009,"title":"the impact of vocabulary instruction on passage-level comprehension of school-age children: a meta-analysis"}`
- ✅ **PASS** · referencia webb2009: Crossref: 2009 · the effects of pre-learning vocabulary on reading comprehension and writing
  - observado: `{"doi":"10.3138/cmlr.65.3.441","year":2009,"title":"the effects of pre-learning vocabulary on reading comprehension and writing"}`

### ✅ H2-zpd-huerfano — Sin selectores ZPD duplicados ni huérfanos

> section-words.ts ya no contiene selectores de priming paralelos: la utilidad de la hoja es la única vía y calcula β en la escala 4 − zipf.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): SOSTENIDA** — El selector huérfano y su constructor de candidatas se eliminaron en lugar de conectarse: había dos motores de selección y solo uno tenía pruebas de uso real.
- evidencia: `src/client/lib/section-words.ts:89-160`

- ✅ **PASS** · doc-mention: el documento contiene «sin selectores duplicados»
- ✅ **PASS** · code-absent: /selectOptimalChapterPrimingWords|buildChapterPrimingCandidates|computePreChapterWordUtility/ no aparece en src/client/lib/section-words.ts
- ✅ **PASS** · code-anchor: src/client/lib/section-words.ts:112 coincide con /4\.0 - opts\.zipf/
  - observado: `{"file":"src/client/lib/section-words.ts","line":112,"text":"? Number((4.0 - opts.zipf).toFixed(2))"}`
- ✅ **PASS** · referencia yanagisawa2020: Crossref: 2020 · how do different forms of glossing contribute to l2 vocabulary learning from reading?
  - observado: `{"doi":"10.1017/S0272263119000688","year":2020,"title":"how do different forms of glossing contribute to l2 vocabulary learning from reading?"}`
- ✅ **PASS** · referencia nation2006: Crossref: 2006 · how large a vocabulary is needed for reading and listening?
  - observado: `{"doi":"10.3138/cmlr.63.1.59","year":2006,"title":"how large a vocabulary is needed for reading and listening?"}`

### ✅ H3-theta-escala — Una sola escala de θ y una sola llave

> θ vive en una sola escala (β = 4 − zipf, neutra en 0) y en una sola llave, lecta:user_language_profile:v1. La llave vieja lecta:user_theta:<lang>:v1 (escala 7 − zipf) solo se migra una vez restando 3 y nunca se vuelve a escribir; la hoja, el CAT y cada acto ajustan θ una sola vez.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): SOSTENIDA** — Corregido: θ quedó en la escala Rasch (4 − zipf, neutra en 0) con una sola llave, la hoja y el CAT la comparten, y la llave vieja solo se migra restando 3. Antes el CAT escribía la llave heredada con un valor de otra escala y la hoja calculaba β = 7 − zipf.
- evidencia: `src/client/lib/profile-models.ts:211-300`
- evidencia: `src/client/lib/section-words.ts:106-160`
- evidencia: `src/client/lib/calibration.ts:530-560`

- ✅ **PASS** · doc-mention: el documento contiene «Una sola escala de θ»
- ✅ **PASS** · code-anchor: src/client/lib/profile-models.ts:260 coincide con /clampTheta\(legacy - 3\)/
  - observado: `{"file":"src/client/lib/profile-models.ts","line":260,"text":"legacy >= LEGACY_THETA_MIN_RAW ? clampTheta(legacy - 3) : clampTheta(legacy);"}`
- ✅ **PASS** · code-absent: /Math\.max\(0, 7\.0 - zipf\)/ no aparece en src/client/lib/profile-models.ts
- ✅ **PASS** · code-absent: /setItem\(\s*USER_THETA_KEY/ no aparece en src/client/lib/profile-models.ts
- ✅ **PASS** · code-anchor: src/client/lib/profile-models.ts:530 coincide con /4\.0 - zipf/
  - observado: `{"file":"src/client/lib/profile-models.ts","line":530,"text":"return Number(Math.max(-3.0, Math.min(3.5, 4.0 - zipf)).toFixed(2));"}`
- ✅ **PASS** · code-anchor: src/client/lib/calibration.ts:543 coincide con /saveUserLanguageProfile\(updatedProfile\)/
  - observado: `{"file":"src/client/lib/calibration.ts","line":543,"text":"saveUserLanguageProfile(updatedProfile);"}`
- ✅ **PASS** · code-absent: /saveUserTheta\(/ no aparece en src/client/lib/calibration.ts
- ✅ **PASS** · probe: una sola escala (β = 4 − zipf, neutra en 0), una sola llave y un solo ajuste por acto; la llave vieja solo se migra restando 3
  - observado: `{"betaFromZipf_zipf6":-2,"theta_L1_porDefecto":0,"theta_L2_porDefecto":-0.6,"theta_L2_esperado":-0.6,"exporta_escala_vieja":[],"escribe_llave_vieja":false,"migracion_resta":3,"saveUserTheta_en_calibracion":0,"updateLanguageTheta_en_reader":2,"applyPreviewKnownSignal_en_wordPanel":1,"ajustes_por_acto_en_wordPanel":1,"sectionWords_usa_7_menos_zipf":false,"sectionWords_usa_4_menos_zipf":true}`
- ✅ **PASS** · referencia wilson2019: Crossref: 2019 · the eighty five percent rule for optimal learning
  - observado: `{"doi":"10.1038/s41467-019-12552-4","year":2019,"title":"the eighty five percent rule for optimal learning"}`

### ✅ H4-jol — «Ya la conozco» alimenta el nivel como si fuera una prueba

> Marcar «ya la conozco» ajusta θ con outcome 1 y un delta de 0,18 × (1 − P), sin ninguna recuperación verificada de por medio, y el acto se registra sin pagar XP de repaso.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): MATIZADA** — La conclusión se sostiene: «Ya la sé» sigue siendo un juicio. Ahora ajusta θ una sola vez con la dificultad real de la palabra y no paga XP; el pretest bloqueante se descartó por la regla de 1 toque.
- evidencia: `src/client/components/WordPanel.tsx:521-535`
- evidencia: `src/client/lib/profile-models.ts:405-415`

- ✅ **PASS** · doc-mention: el documento contiene ««Ya la conozco» es un juicio, no una prueba»
- ✅ **PASS** · code-anchor: src/client/components/Reader.tsx:4172 coincide con /updateLanguageTheta\(currentLang, beta, 1, 1\.0\)/
  - observado: `{"file":"src/client/components/Reader.tsx","line":4172,"text":"updateLanguageTheta(currentLang, beta, 1, 1.0);"}`
- ✅ **PASS** · code-anchor: src/client/lib/profile-models.ts:417 coincide con /0\.18 \* \(1 - pKnow\)/
  - observado: `{"file":"src/client/lib/profile-models.ts","line":417,"text":"delta = 0.18 * (1 - pKnow);"}`
- ✅ **PASS** · code-anchor: src/client/components/WordPanel.tsx:525 coincide con /award: false/
  - observado: `{"file":"src/client/components/WordPanel.tsx","line":525,"text":"{ award: false },"}`
- ✅ **PASS** · code-anchor: src/client/lib/reviews.ts:47 coincide con /options\.award !== false/
  - observado: `{"file":"src/client/lib/reviews.ts","line":47,"text":"if (options.award !== false) {"}`
- ✅ **PASS** · referencia koriat2005: Crossref: 2005 · illusions of competence in monitoring one's knowledge during study.
  - observado: `{"doi":"10.1037/0278-7393.31.2.187","year":2005,"title":"illusions of competence in monitoring one's knowledge during study."}`
- ✅ **PASS** · referencia laufergoldstein2004: Crossref: 2004 · testing vocabulary knowledge: size, strength, and computer adaptiveness
  - observado: `{"doi":"10.1111/j.0023-8333.2004.00260.x","year":2004,"title":"testing vocabulary knowledge: size, strength, and computer adaptiveness"}`
- ✅ **PASS** · referencia richland2009: Crossref: 2009 · the pretesting effect: do unsuccessful retrieval attempts enhance learning?
  - observado: `{"doi":"10.1037/a0016496","year":2009,"title":"the pretesting effect: do unsuccessful retrieval attempts enhance learning?"}`
- ✅ **PASS** · referencia kornell2009: Crossref: 2009 · unsuccessful retrieval attempts enhance subsequent learning.
  - observado: `{"doi":"10.1037/a0015729","year":2009,"title":"unsuccessful retrieval attempts enhance subsequent learning."}`
- ✅ **PASS** · referencia kremmel2016: https://eric.ed.gov/?id=EJ1120126 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ1120126","http":200}`

### ✅ H5-pasiva — La exposición pasiva acota a 8 lemas por paso y respeta lápidas

> La vía viva registra hasta 8 lemas no consultados por paso de página, exige lectura por debajo de 450 ppm, no revive lápidas y mantiene «familiar» a las 3 exposiciones dentro de la sesión.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): SOSTENIDA** — El mecanismo descrito por el documento original (marcar todas las palabras de la página con tope de 12 s) era código muerto y se eliminó. La vía viva es más conservadora y ahora respeta las lápidas.
- evidencia: `src/client/lib/reader-evidence.ts:184-250`
- evidencia: `src/client/lib/idb.ts:2069-2078`

- ✅ **PASS** · doc-mention: el documento contiene «La exposición pasiva se acota»
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:54 coincide con /GAMMA_PASSIVE = 0\.82/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":54,"text":"export const GAMMA_PASSIVE = 0.82;"}`
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:55 coincide con /FAMILIAR_PASSIVE_THRESHOLD = 3/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":55,"text":"export const FAMILIAR_PASSIVE_THRESHOLD = 3;"}`
- ✅ **PASS** · code-anchor: src/client/lib/reader-evidence.ts:230 coincide con /uniqueLemmas\.size >= 8/
  - observado: `{"file":"src/client/lib/reader-evidence.ts","line":230,"text":"if (uniqueLemmas.size >= 8) break;"}`
- ✅ **PASS** · code-anchor: src/client/lib/idb.ts:2077 coincide con /if \(existing\?\.deleted\) return existing/
  - observado: `{"file":"src/client/lib/idb.ts","line":2077,"text":"if (existing?.deleted) return existing;"}`
- ✅ **PASS** · code-absent: /processPageTurnForPassiveKnowledge/ no aparece en src/client/lib/knowledge.ts
- ✅ **PASS** · referencia nagy1985: Crossref: 1985 · learning words from context
  - observado: `{"doi":"10.2307/747758","year":1985,"title":"learning words from context"}`
- ✅ **PASS** · referencia pigada2006: https://eric.ed.gov/?id=EJ759833 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ759833","http":200}`
- ✅ **PASS** · referencia waring2003: https://eric.ed.gov/?id=EJ676380 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ676380","http":200}`

### ✅ H6-fsrs-manual — Tarjetas FSRS limpias y consolidación de fin de capítulo conectada

> Las tarjetas nacen vacías, sin dificultad ni estabilidad prefijadas por origen de captura, y resolver el reto de cierre consolida la tarjeta de verdad en FSRS con Rating.Good y un solo repaso registrado.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): SOSTENIDA** — Antes el reto de fin de capítulo solo pagaba XP y las tarjetas se creaban con D/S inventados por origen. Hoy la tarjeta nace limpia y el ejercicio resuelto la avanza con Rating.Good.
- evidencia: `src/client/lib/fsrs.ts:1-28`
- evidencia: `src/client/lib/reviews.ts:86-160`
- evidencia: `src/client/components/DeepReadingSummaryModal.tsx:122-145`

- ✅ **PASS** · doc-mention: el documento contiene «Tarjetas limpias y consolidación conectada»
- ✅ **PASS** · code-absent: /CAPTURE_SOURCE_PARAMS|newCardWithSource|scheduleEpisodicReview/ no aparece en src/client/lib/fsrs.ts
- ✅ **PASS** · code-anchor: src/client/lib/reviews.ts:93 coincide con /export async function consolidateEpisodicWord/
  - observado: `{"file":"src/client/lib/reviews.ts","line":93,"text":"export async function consolidateEpisodicWord("}`
- ✅ **PASS** · code-anchor: src/client/components/DeepReadingSummaryModal.tsx:148 coincide con /consolidateEpisodicWord\(current\.item/
  - observado: `{"file":"src/client/components/DeepReadingSummaryModal.tsx","line":148,"text":"void consolidateEpisodicWord(current.item, bookId)"}`
- ✅ **PASS** · referencia ye2022: Crossref: 2022 · a stochastic shortest path algorithm for optimizing spaced repetition scheduling
  - observado: `{"doi":"10.1145/3534678.3539081","year":2022,"title":"a stochastic shortest path algorithm for optimizing spaced repetition scheduling"}`
- ✅ **PASS** · referencia lindsey2014: Crossref: 2014 · improving students’ long-term knowledge retention through personalized review
  - observado: `{"doi":"10.1177/0956797613504302","year":2014,"title":"improving students’ long-term knowledge retention through personalized review"}`
- ✅ **PASS** · referencia cepeda2008: Crossref: 2008 · spacing effects in learning
  - observado: `{"doi":"10.1111/j.1467-9280.2008.02209.x","year":2008,"title":"spacing effects in learning"}`
- ✅ **PASS** · referencia cepeda2006: Crossref: 2006 · distributed practice in verbal recall tasks: a review and quantitative synthesis.
  - observado: `{"doi":"10.1037/0033-2909.132.3.354","year":2006,"title":"distributed practice in verbal recall tasks: a review and quantitative synthesis."}`
- ✅ **PASS** · referencia rowland2014: Crossref: 2014 · the effect of testing versus restudy on retention: a meta-analytic review of the testing e
  - observado: `{"doi":"10.1037/a0037559","year":2014,"title":"the effect of testing versus restudy on retention: a meta-analytic review of the testing effect."}`
- ✅ **PASS** · referencia adesope2017: Crossref: 2017 · rethinking the use of tests: a meta-analysis of practice testing
  - observado: `{"doi":"10.3102/0034654316689306","year":2017,"title":"rethinking the use of tests: a meta-analysis of practice testing"}`

### ✅ H6-implicito-tiempo — Sin calificación implícita por velocidad y un solo registro por ejercicio

> La calificación por tiempo (≤ 650 ms/carácter ⇒ Easy) ya no existe en el código, y el cierre de capítulo ocurre igual en modo scroll y en modo páginas.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): SOSTENIDA** — La velocidad como proxy de dominio se eliminó en vez de conectarse, y el doble registro de repasos en el Cuaderno se corrigió: un ejercicio, un evento.
- evidencia: `src/client/lib/practice.ts:535-555`
- evidencia: `src/client/hooks/useReaderNavigation.ts:201-270`

- ✅ **PASS** · doc-mention: el documento contiene «Sin calificación implícita por velocidad»
- ✅ **PASS** · code-absent: /computeImplicitFsrsGrade|msPerChar <= 650/ no aparece en src/client/lib/practice.ts
- ✅ **PASS** · code-anchor: src/client/hooks/useReaderNavigation.ts:211 coincide con /const completeChapterTo/
  - observado: `{"file":"src/client/hooks/useReaderNavigation.ts","line":211,"text":"const completeChapterTo = useCallback("}`
- ✅ **PASS** · code-anchor: src/client/components/Vocabulary.tsx:1501 coincide con /await grade\(item, wrongs/
  - observado: `{"file":"src/client/components/Vocabulary.tsx","line":1501,"text":"await grade(item, wrongs ? EXERCISE_RATING.wrong : EXERCISE_RATING.correct);"}`
- ✅ **PASS** · referencia rowland2014: Crossref: 2014 · the effect of testing versus restudy on retention: a meta-analytic review of the testing e
  - observado: `{"doi":"10.1037/a0037559","year":2014,"title":"the effect of testing versus restudy on retention: a meta-analytic review of the testing effect."}`
- ✅ **PASS** · referencia laufergoldstein2004: Crossref: 2004 · testing vocabulary knowledge: size, strength, and computer adaptiveness
  - observado: `{"doi":"10.1111/j.0023-8333.2004.00260.x","year":2004,"title":"testing vocabulary knowledge: size, strength, and computer adaptiveness"}`

### ✅ H7-xp-proxy — El XP paga consultar una vez al día y no paga el autoinforme

> Consultar paga 2 XP una sola vez por palabra e idioma al día, guardar paga 3 y una palabra rara (zipf < 3,0) paga 7; «Ya la sé» queda en el historial sin XP y la consolidación paga como «Bien».

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): MATIZADA** — El XP sigue pagando el proxy, pero ya no se puede farmear: la consulta paga una vez por palabra al día y el autoinforme no paga. Guardar desde el lector tampoco paga «saved»; el bonus por rareza casi solo ocurre en el glosario.
- evidencia: `src/client/lib/game.ts:207-255`
- evidencia: `src/client/hooks/useReaderSelection.ts:145-150`

- ✅ **PASS** · doc-mention: el documento contiene «La gamificación paga el proxy»
- ✅ **PASS** · code-anchor: src/shared/gamification.ts:556 coincide con /gained \+= 2/
  - observado: `{"file":"src/shared/gamification.ts","line":556,"text":"gained += 2;"}`
- ✅ **PASS** · code-anchor: src/shared/gamification.ts:563 coincide con /gained \+= 4/
  - observado: `{"file":"src/shared/gamification.ts","line":563,"text":"gained += 4;"}`
- ✅ **PASS** · code-anchor: src/shared/gamification.ts:87 coincide con /RARE_ZIPF_BELOW = 3\.0/
  - observado: `{"file":"src/shared/gamification.ts","line":87,"text":"export const RARE_ZIPF_BELOW = 3.0;"}`
- ✅ **PASS** · code-anchor: src/shared/gamification.ts:517 coincide con /STREAK_XP_BONUS = 1\.1/
  - observado: `{"file":"src/shared/gamification.ts","line":517,"text":"export const STREAK_XP_BONUS = 1.1;"}`
- ✅ **PASS** · code-anchor: src/client/lib/game.ts:217 coincide con /export async function awardConsultOncePerDay/
  - observado: `{"file":"src/client/lib/game.ts","line":217,"text":"export async function awardConsultOncePerDay("}`
- ✅ **PASS** · probe: consultar y guardar pagan XP; guardar una palabra rara paga el doble que una común; terminar un libro paga 50
  - observado: `{"RARE_ZIPF_BELOW":3,"STREAK_XP_BONUS":1.1,"xp_consulta":2,"xp_guardada_rara":7,"rareSaved_tras_rara":1,"xp_guardada_comun":3,"xp_repaso_good":3,"xp_libro_terminado":50,"logros_de_rarezas":["raras_5","raras_25","raras_75"]}`
- ✅ **PASS** · referencia deci1999: Crossref: 1999 · a meta-analytic review of experiments examining the effects of extrinsic rewards on intrin
  - observado: `{"doi":"10.1037/0033-2909.125.6.627","year":1999,"title":"a meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation."}`
- ✅ **PASS** · referencia howard2021: Crossref: 2021 · student motivation and associated outcomes: a meta-analysis from self-determination theory
  - observado: `{"doi":"10.1177/1745691620966789","year":2021,"title":"student motivation and associated outcomes: a meta-analysis from self-determination theory"}`
- ✅ **PASS** · referencia sailer2020: https://eric.ed.gov/?id=EJ1245270 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ1245270","http":200}`
- ✅ **PASS** · referencia harkin2016: Crossref: 2016 · does monitoring goal progress promote goal attainment? a meta-analysis of the experimental
  - observado: `{"doi":"10.1037/bul0000025","year":2016,"title":"does monitoring goal progress promote goal attainment? a meta-analysis of the experimental evidence."}`

### ✅ H7-scroll — El lector abre en scroll por defecto

> El ajuste por defecto de layout es scroll con medida de 65 caracteres, aunque la evidencia favorece el paginado en textos informativos.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): MATIZADA** — El código es correcto, pero la evidencia no respalda cambiar el valor por defecto en novelas: en Delgado et al. (2018) el scroll no es moderador y no hay ventaja del papel en narrativa.
- evidencia: `src/client/lib/settings.ts:379-382`
- evidencia: `doi:10.1016/j.edurev.2018.09.003`

- ✅ **PASS** · doc-mention: el documento contiene «`scroll` (`settings.ts:382`)»
- ✅ **PASS** · code-anchor: src/client/lib/settings.ts:382 coincide con /layout: "scroll"/
  - observado: `{"file":"src/client/lib/settings.ts","line":382,"text":"layout: \"scroll\","}`
- ✅ **PASS** · code-anchor: src/client/lib/settings.ts:379 coincide con /measure: 65/
  - observado: `{"file":"src/client/lib/settings.ts","line":379,"text":"measure: 65,"}`
- ✅ **PASS** · referencia delgado2018: Crossref: 2018 · don't throw away your printed books: a meta-analysis on the effects of reading media on re
  - observado: `{"doi":"10.1016/j.edurev.2018.09.003","year":2018,"title":"don't throw away your printed books: a meta-analysis on the effects of reading media on reading comprehension"}`
- ✅ **PASS** · referencia haverkamp2023: Crossref: 2022 · is it the size, the movement, or both? investigating effects of screen size and text movem
  - observado: `{"doi":"10.1007/s11145-022-10328-9","year":2022,"title":"is it the size, the movement, or both? investigating effects of screen size and text movement on processing, understanding, and motivation when students read informational text"}`
- ✅ **PASS** · referencia sanchez2009: Crossref: 2009 · to scroll or not to scroll: scrolling, working memory capacity, and comprehending complex 
  - observado: `{"doi":"10.1177/0018720809352788","year":2009,"title":"to scroll or not to scroll: scrolling, working memory capacity, and comprehending complex texts"}`
- ✅ **PASS** · referencia dyson2001: Crossref: 2001 · the influence of reading speed and line length on the effectiveness of reading from screen
  - observado: `{"doi":"10.1006/ijhc.2001.0458","year":2001,"title":"the influence of reading speed and line length on the effectiveness of reading from screen"}`

### ✅ M4-sin-push — No hay notificaciones push en el cliente

> El cliente no registra pushManager ni pide permiso de notificaciones, así que cualquier recordatorio tiene que ser in-app.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-26): SOSTENIDA** — No hay push en todo el repositorio; el recordatorio queda in-app y el ruido de SMS médicos y archivos .ics se retiró del documento.
- evidencia: `src/client`

- ✅ **PASS** · doc-mention: el documento contiene «no existe `pushManager` en el cliente»
- ✅ **PASS** · code-absent: /pushManager|showNotification|Notification\.requestPermission/ no aparece en src/client
- ✅ **PASS** · referencia gollwitzer2006: Crossref: 2006 · implementation intentions and goal achievement: a meta‐analysis of effects and processes
  - observado: `{"doi":"10.1016/S0065-2601(06)38002-1","year":2006,"title":"implementation intentions and goal achievement: a meta‐analysis of effects and processes"}`
- ✅ **PASS** · referencia thakkar2016: Crossref: 2016 · mobile telephone text messaging for medication adherence in chronic disease
  - observado: `{"doi":"10.1001/jamainternmed.2015.7667","year":2016,"title":"mobile telephone text messaging for medication adherence in chronic disease"}`
- ✅ **PASS** · referencia lally2010: Crossref: 2009 · how are habits formed: modelling habit formation in the real world
  - observado: `{"doi":"10.1002/ejsp.674","year":2009,"title":"how are habits formed: modelling habit formation in the real world"}`

### ✅ H8-sin-medicion — Se mide la retención del vocabulario; la comprensión solo tiene autoevaluación

> No hay ninguna medida objetiva de comprensión lectora. La retención del vocabulario sí se calcula (tasa de acierto y palabras con memoria estimada de 7 y 30 días) y al cerrar cada capítulo el lector puede anotar si seguió el hilo; esa autoevaluación se muestra como valoración propia, no como comprensión medida.

Código: **PASS** · Referencias: **PASS**

**Veredicto de auditoría (2026-10-27): MATIZADA** — La comprensión lectora sigue sin medida objetiva. Hay autoevaluación de un toque al cerrar capítulo, guardada por cuenta y mostrada como valoración propia, y la retención de vocabulario (7 y 30 días) ya tiene métrica real. El «Chequeo 30 días» solo ofrece palabras con 30 o más días desde su último repaso. La medida objetiva de comprensión queda pospuesta hasta tener datos de uso.
- evidencia: `src/client/lib/chapter-follow.ts`
- evidencia: `src/client/components/DeepReadingSummaryModal.tsx`
- evidencia: `src/client/components/Journey.tsx`
- evidencia: `src/client/lib/journey.ts`
- evidencia: `src/client/components/Vocabulary.tsx`

- ✅ **PASS** · doc-mention: el documento contiene «Nadie mide si se aprende»
- ✅ **PASS** · code-absent: /comprehension|delayedRetention|chequeoDeComprension/ no aparece en src
- ✅ **PASS** · code-absent: /postTest|delayedRecall/ no aparece en src
- ✅ **PASS** · code-anchor: src/client/lib/journey.ts:77 coincide con /export function computeRetentionSummary/
  - observado: `{"file":"src/client/lib/journey.ts","line":77,"text":"export function computeRetentionSummary("}`
- ✅ **PASS** · code-anchor: src/client/components/Vocabulary.tsx:1115 coincide con /const startRetentionCheck30d/
  - observado: `{"file":"src/client/components/Vocabulary.tsx","line":1115,"text":"const startRetentionCheck30d = () => {"}`
- ✅ **PASS** · code-anchor: src/client/lib/chapter-follow.ts:52 coincide con /export async function summarizeChapterFollows/
  - observado: `{"file":"src/client/lib/chapter-follow.ts","line":52,"text":"export async function summarizeChapterFollows("}`
- ✅ **PASS** · code-anchor: src/client/components/Vocabulary.tsx:410 coincide con /const RETENTION_CHECK_MIN_AGE_DAYS = 30/
  - observado: `{"file":"src/client/components/Vocabulary.tsx","line":410,"text":"const RETENTION_CHECK_MIN_AGE_DAYS = 30;"}`
- ✅ **PASS** · referencia rowland2014: Crossref: 2014 · the effect of testing versus restudy on retention: a meta-analytic review of the testing e
  - observado: `{"doi":"10.1037/a0037559","year":2014,"title":"the effect of testing versus restudy on retention: a meta-analytic review of the testing effect."}`
- ✅ **PASS** · referencia adesope2017: Crossref: 2017 · rethinking the use of tests: a meta-analysis of practice testing
  - observado: `{"doi":"10.3102/0034654316689306","year":2017,"title":"rethinking the use of tests: a meta-analysis of practice testing"}`
- ✅ **PASS** · referencia harkin2016: Crossref: 2016 · does monitoring goal progress promote goal attainment? a meta-analysis of the experimental
  - observado: `{"doi":"10.1037/bul0000025","year":2016,"title":"does monitoring goal progress promote goal attainment? a meta-analysis of the experimental evidence."}`

### ✅ H3-cat-prior — El CAT inicia en θ = 0,0 sin un segundo motor en escala vieja

> El CAT arranca en θ = 0,0 y persiste en el perfil; el estimador MAP con prior 4,0 se retiró, así que no queda un segundo motor con la escala vieja.

Código: **PASS** · Referencias: **SKIP**

**Veredicto de auditoría (2026-10-26): SOSTENIDA** — El prior 4,0 nunca gobernó el CAT real: solo lo usaba un estimador que llamaban las pruebas. Se eliminó junto con el banco duplicado en vez de conectarlo.
- evidencia: `src/client/components/Calibration.tsx:29`
- evidencia: `src/client/lib/calibration.ts:407`

- ✅ **PASS** · doc-mention: el documento contiene «el CAT arranca en 0,0»
- ✅ **PASS** · code-anchor: src/client/lib/calibration.ts:407 coincide con /startTheta = typeof initialTheta === "number" \? initialTheta : 0\.0/
  - observado: `{"file":"src/client/lib/calibration.ts","line":407,"text":"const startTheta = typeof initialTheta === \"number\" ? initialTheta : 0.0;"}`
- ✅ **PASS** · code-absent: /CALIBRATION_PRIOR_THETA|estimateThetaMAP/ no aparece en src/client/lib/profile-models.ts

## Referencias

| id | estado | cita | detalle |
|---|---|---|---|
| laufer2010 | ✅ PASS | Laufer & Ravenhorst-Kalovski (2010), Reading in a Foreign Language 22(1), 15–30 — umbrales 95 %/98 % | https://eric.ed.gov/?id=EJ887873 → HTTP 200 |
| nation2006 | ✅ PASS | Nation (2006), Canadian Modern Language Review 63(1) — tamaño léxico por modalidad | Crossref: 2006 · how large a vocabulary is needed for reading and listening? |
| schmitt2011 | ✅ PASS | Schmitt, Jiang & Grabe (2011), Modern Language Journal 95(1), 26–43 — relación lineal cobertura-comprensión | https://eric.ed.gov/?id=EJ928357 → HTTP 200 |
| yanagisawa2020 | ✅ PASS | Yanagisawa, Webb & Uchihara (2020), Studies in Second Language Acquisition — glosas 45,3 % vs 26,6 % | Crossref: 2020 · how do different forms of glossing contribute to l2 vocabulary learning from reading? |
| elleman2009 | ✅ PASS | Elleman, Lindo, Morphy & Compton (2009), Journal of Research on Educational Effectiveness 2(1), 1–44 — d = 0,50 vs 0,10 | Crossref: 2009 · the impact of vocabulary instruction on passage-level comprehension of school-age children |
| webb2009 | ✅ PASS | Webb (2009), Canadian Modern Language Review — asistencia durante la lectura supera a la previa | Crossref: 2009 · the effects of pre-learning vocabulary on reading comprehension and writing |
| wilson2019 | ✅ PASS | Wilson et al. (2019), Nature Communications — regla del 85 % de acierto | Crossref: 2019 · the eighty five percent rule for optimal learning |
| koriat2005 | ✅ PASS | Koriat & Bjork (2005), JEP:LMC 31(2) — ilusiones de competencia | Crossref: 2005 · illusions of competence in monitoring one's knowledge during study. |
| laufergoldstein2004 | ✅ PASS | Laufer & Goldstein (2004), Language Learning 54(3) — reconocimiento vs recuerdo | Crossref: 2004 · testing vocabulary knowledge: size, strength, and computer adaptiveness |
| richland2009 | ✅ PASS | Richland, Kornell & Kao (2009), JEP:Applied 15(3) — efecto de la prueba previa | Crossref: 2009 · the pretesting effect: do unsuccessful retrieval attempts enhance learning? |
| kornell2009 | ✅ PASS | Kornell, Hays & Bjork (2009), JEP:LMC 35(4) — fallar con feedback no daña | Crossref: 2009 · unsuccessful retrieval attempts enhance subsequent learning. |
| kremmel2016 | ✅ PASS | Kremmel & Schmitt (2016), Language Assessment Quarterly — los test inflan el saber | https://eric.ed.gov/?id=EJ1120126 → HTTP 200 |
| nagy1985 | ✅ PASS | Nagy, Herman & Anderson (1985), Reading Research Quarterly 20(2), 233–253 — 5–15 % por exposición | Crossref: 1985 · learning words from context |
| pigada2006 | ✅ PASS | Pigada & Schmitt (2006), Reading in a Foreign Language 18(1) — aprendizaje parcial y necesidad de encuentros | https://eric.ed.gov/?id=EJ759833 → HTTP 200 |
| waring2003 | ✅ PASS | Waring & Takaki (2003), Reading in a Foreign Language 15(2) — ninguna palabra con <8 encuentros se retuvo | https://eric.ed.gov/?id=EJ676380 → HTTP 200 |
| ye2022 | ✅ PASS | Ye, Su & Cao (2022), KDD — SSP-MMC/FSRS, +12,6 % de coste de memorización | Crossref: 2022 · a stochastic shortest path algorithm for optimizing spaced repetition scheduling |
| lindsey2014 | ✅ PASS | Lindsey et al. (2014), Psychological Science 25(3) — +16,5 % de retención con personalización | Crossref: 2014 · improving students’ long-term knowledge retention through personalized review |
| cepeda2008 | ✅ PASS | Cepeda et al. (2008), Psychological Science 19(11) — 20–40 % a una semana, 5–10 % a un año | Crossref: 2008 · spacing effects in learning |
| cepeda2006 | ✅ PASS | Cepeda et al. (2006), Psychological Bulletin 132(3) — 317 experimentos de práctica distribuida | Crossref: 2006 · distributed practice in verbal recall tasks: a review and quantitative synthesis. |
| rowland2014 | ✅ PASS | Rowland (2014), Psychological Bulletin 140(6) — g ≈ 0,50 para práctica de recuperación | Crossref: 2014 · the effect of testing versus restudy on retention: a meta-analytic review of the testing e |
| adesope2017 | ✅ PASS | Adesope, Trevisan & Sundararajan (2017), Review of Educational Research 87(3) — g ≈ 0,61 con feedback | Crossref: 2017 · rethinking the use of tests: a meta-analysis of practice testing |
| deci1999 | ✅ PASS | Deci, Koestner & Ryan (1999), Psychological Bulletin 125(6) — d ≈ −0,40 por recompensas contingentes | Crossref: 1999 · a meta-analytic review of experiments examining the effects of extrinsic rewards on intrin |
| howard2021 | ✅ PASS | Howard et al. (2021), Perspectives on Psychological Science — la regulación externa no predice persistencia | Crossref: 2021 · student motivation and associated outcomes: a meta-analysis from self-determination theory |
| sailer2020 | ✅ PASS | Sailer & Homner (2020), Educational Psychology Review — g = 0,49 / 0,36 / 0,25 | https://eric.ed.gov/?id=EJ1245270 → HTTP 200 |
| harkin2016 | ✅ PASS | Harkin et al. (2016), Psychological Bulletin — monitoreo del progreso, d = 0,40 | Crossref: 2016 · does monitoring goal progress promote goal attainment? a meta-analysis of the experimental |
| delgado2018 | ✅ PASS | Delgado et al. (2018), Educational Research Review 25 — g = −0,21 papel > pantalla | Crossref: 2018 · don't throw away your printed books: a meta-analysis on the effects of reading media on re |
| haverkamp2023 | ✅ PASS | Haverkamp et al. (2023), Reading and Writing 36(7) — paginar vs mover texto | Crossref: 2022 · is it the size, the movement, or both? investigating effects of screen size and text movem |
| sanchez2009 | ✅ PASS | Sanchez & Wiley (2009), Human Factors — el scroll castiga a baja memoria de trabajo | Crossref: 2009 · to scroll or not to scroll: scrolling, working memory capacity, and comprehending complex  |
| dyson2001 | ✅ PASS | Dyson & Haselgrove (2001), IJHCS — velocidad máxima en ~55 caracteres | Crossref: 2001 · the influence of reading speed and line length on the effectiveness of reading from screen |
| gollwitzer2006 | ✅ PASS | Gollwitzer & Sheeran (2006), Advances in Experimental Social Psychology — d = 0,65 | Crossref: 2006 · implementation intentions and goal achievement: a meta‐analysis of effects and processes |
| thakkar2016 | ✅ PASS | Thakkar et al. (2016), JAMA Internal Medicine — recordatorios SMS, OR 2,11 | Crossref: 2016 · mobile telephone text messaging for medication adherence in chronic disease |
| lally2010 | ✅ PASS | Lally et al. (2010), European Journal of Social Psychology 40(6), 998–1009 — 66 días de mediana | Crossref: 2009 · how are habits formed: modelling habit formation in the real world |

## Cómo reproducir

```bash
node scripts/audit-investigacion.mjs            # sin red
node scripts/audit-investigacion.mjs --online    # resuelve DOI y URLs
node scripts/audit-investigacion.mjs --pack /tmp/pack
```
