# Reporte de auditoría — estrategia de aprendizaje de Lecta

Generado: 2026-10-25T03:16:57.479Z
Documento auditado: `docs/estrategia-aprendizaje-2026-10-24.md`
Registro: `docs/auditoria/claims.json`
Red: sí (DOI/URL resueltos)

**Veredicto: PASS** — 14 afirmaciones aprobadas, 0 refutadas, 0 sin verificar, 0 comprobaciones omitidas.

## Afirmaciones

### ✅ H1-cobertura-tipos — La cobertura se calcula sobre formas únicas

> El porcentaje de cobertura de un libro divide conocidas+guardadas entre formas únicas (types), sin ponderar por apariciones (tokens).

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «Se calcula sobre **formas únicas**»
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:292 coincide con /\(knownCount \+ savedCount\) / total/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":292,"text":"? Math.max(0, Math.min(100, Math.round(((knownCount + savedCount) / total) * 100)))"}`
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:289 coincide con /const total = forms\.length/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":289,"text":"const total = forms.length;"}`
- ✅ **PASS** · code-absent: /\btokens?\b/ no aparece en src/client/lib/coverage.ts
- ✅ **PASS** · referencia laufer2010: https://eric.ed.gov/?id=EJ887873 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ887873","http":200}`
- ✅ **PASS** · referencia nation2006: Crossref: 2006 · how large a vocabulary is needed for reading and listening?
  - observado: `{"doi":"10.3138/cmlr.63.1.59","year":2006,"title":"how large a vocabulary is needed for reading and listening?"}`
- ✅ **PASS** · referencia schmitt2011: https://eric.ed.gov/?id=EJ928357 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ928357","http":200}`

### ✅ H1-umbrales-dobles — Dos sistemas de umbrales para la misma métrica

> coverageLabel usa 90/75/60 y getBookAffinityBadge usa 94/86 sobre el mismo porcentaje, así que un libro puede llevar dos etiquetas distintas a la vez.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «Etiquetas con umbrales propios 90/75/60»
- ✅ **PASS** · code-anchor: src/client/lib/coverage.ts:152 coincide con /percent >= 90/
  - observado: `{"file":"src/client/lib/coverage.ts","line":152,"text":"if (percent >= 90) return \"En tu nivel\";"}`
- ✅ **PASS** · code-anchor: src/client/lib/catalog.ts:281 coincide con /bookDifficultyOrLevel >= 94/
  - observado: `{"file":"src/client/lib/catalog.ts","line":281,"text":"if (bookDifficultyOrLevel >= 94) {"}`
- ✅ **PASS** · code-anchor: src/client/lib/catalog.ts:288 coincide con /bookDifficultyOrLevel >= 86/
  - observado: `{"file":"src/client/lib/catalog.ts","line":288,"text":"if (bookDifficultyOrLevel >= 86) {"}`
- ✅ **PASS** · referencia schmitt2011: https://eric.ed.gov/?id=EJ928357 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ928357","http":200}`
- ✅ **PASS** · referencia laufer2010: https://eric.ed.gov/?id=EJ887873 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ887873","http":200}`

### ✅ H2-preparacion-40 — La preparación automática ofrece hasta 40 filas

> La hoja «Antes de leer» se abre sola una vez por sección cuando hay palabras desconocidas y admite hasta 40 filas, mientras el tope de palabras de priming es 3–5.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «hasta **40 filas**»
- ✅ **PASS** · code-anchor: src/client/lib/section-words.ts:203 coincide con /PREPARATION_ROWS_CAP = 40/
  - observado: `{"file":"src/client/lib/section-words.ts","line":203,"text":"export const PREPARATION_ROWS_CAP = 40;"}`
- ✅ **PASS** · code-anchor: src/client/lib/settings.ts:411 coincide con /chapterPrimingMode: "auto"/
  - observado: `{"file":"src/client/lib/settings.ts","line":411,"text":"chapterPrimingMode: \"auto\","}`
- ✅ **PASS** · code-anchor: src/client/hooks/useReaderChapterPrep.ts:51 coincide con /unknownKeyWordsCount <= 0/
  - observado: `{"file":"src/client/hooks/useReaderChapterPrep.ts","line":51,"text":"if (unknownKeyWordsCount <= 0) return false;"}`
- ✅ **PASS** · code-anchor: src/client/lib/section-words.ts:508 coincide con /MAX_PREVIEW_WORDS = 5/
  - observado: `{"file":"src/client/lib/section-words.ts","line":508,"text":"export const MAX_PREVIEW_WORDS = 5;"}`
- ✅ **PASS** · referencia yanagisawa2020: Crossref: 2020 · how do different forms of glossing contribute to l2 vocabulary learning from reading?
  - observado: `{"doi":"10.1017/S0272263119000688","year":2020,"title":"how do different forms of glossing contribute to l2 vocabulary learning from reading?"}`
- ✅ **PASS** · referencia elleman2009: Crossref: 2009 · the impact of vocabulary instruction on passage-level comprehension of school-age children
  - observado: `{"doi":"10.1080/19345740802539200","year":2009,"title":"the impact of vocabulary instruction on passage-level comprehension of school-age children: a meta-analysis"}`
- ✅ **PASS** · referencia webb2009: Crossref: 2009 · the effects of pre-learning vocabulary on reading comprehension and writing
  - observado: `{"doi":"10.3138/cmlr.65.3.441","year":2009,"title":"the effects of pre-learning vocabulary on reading comprehension and writing"}`

### ✅ H2-zpd-huerfano — El selector ZPD de 3–5 palabras no tiene consumidor

> selectOptimalChapterPrimingWords y buildChapterPrimingCandidates existen y están probados, pero ningún módulo de producción los importa.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «es código muerto»
- ✅ **PASS** · no-importers: selectOptimalChapterPrimingWords no tiene importadores fuera de su archivo ni de las pruebas
  - observado: `{"symbol":"selectOptimalChapterPrimingWords","callers":[]}`
- ✅ **PASS** · no-importers: buildChapterPrimingCandidates no tiene importadores fuera de su archivo ni de las pruebas
  - observado: `{"symbol":"buildChapterPrimingCandidates","callers":[]}`
- ✅ **PASS** · referencia yanagisawa2020: Crossref: 2020 · how do different forms of glossing contribute to l2 vocabulary learning from reading?
  - observado: `{"doi":"10.1017/S0272263119000688","year":2020,"title":"how do different forms of glossing contribute to l2 vocabulary learning from reading?"}`
- ✅ **PASS** · referencia nation2006: Crossref: 2006 · how large a vocabulary is needed for reading and listening?
  - observado: `{"doi":"10.3138/cmlr.63.1.59","year":2006,"title":"how large a vocabulary is needed for reading and listening?"}`

### ✅ H3-theta-escala — Dos escalas de dificultad con el mismo nombre de theta

> Las tres escalas de dificultad (7 − zipf, 4 − zipf y logit) comparten la llave lecta:user_theta:<lang>:v1: el CAT y el salto de calibración la escriben, la hoja de preparación la lee y calcula β = 7 − zipf. Con θ = 4 la campana ZPD apunta a zipf ≈ 2,4; con θ = 1, a zipf ≈ 5,4.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «Dos escalas de θ con el mismo nombre»
- ✅ **PASS** · code-anchor: src/client/lib/profile-models.ts:227 coincide con /Math\.max\(0, 7\.0 - zipf\)/
  - observado: `{"file":"src/client/lib/profile-models.ts","line":227,"text":"return Math.max(0, 7.0 - zipf);"}`
- ✅ **PASS** · code-anchor: src/client/lib/profile-models.ts:569 coincide con /4\.0 - zipf/
  - observado: `{"file":"src/client/lib/profile-models.ts","line":569,"text":"return Number(Math.max(-3.0, Math.min(3.5, 4.0 - zipf)).toFixed(2));"}`
- ✅ **PASS** · code-anchor: src/client/lib/calibration.ts:556 coincide con /saveUserTheta\(finalTheta/
  - observado: `{"file":"src/client/lib/calibration.ts","line":556,"text":"saveUserTheta(finalTheta, norm);"}`
- ✅ **PASS** · code-anchor: src/client/lib/calibration.ts:612 coincide con /saveUserTheta\(0\.0/
  - observado: `{"file":"src/client/lib/calibration.ts","line":612,"text":"saveUserTheta(0.0, norm);"}`
- ✅ **PASS** · code-anchor: src/client/hooks/useReaderChapterPrep.ts:202 coincide con /loadUserTheta\(/
  - observado: `{"file":"src/client/hooks/useReaderChapterPrep.ts","line":202,"text":"userTheta: loadUserTheta("}`
- ✅ **PASS** · probe: dos escalas de beta con 3 logits de desfase; el selector ZPD devuelve vacío con theta=4 y la hoja con theta=0 prima zipf≈6
  - observado: `{"wordDifficulty_zipf6":1,"betaFromZipf_zipf6":-2,"defaultTheta_threshold3":4,"theta_L1_porDefecto":0,"theta_L2_porDefecto":-0.6,"desfase_logits_zipf6":3,"zpd_offset_L1":0.65,"zpd_sigma_L1":1,"minUtilityThreshold":0.22,"zpd_escenarioA_max_peso":0.0299,"zpd_escenarioA_devuelve_vacio":true,"zpd_escenarioB_mejor_zipf":6.5,"zpd_escenarioB_peso":0.9888,"zpd_vivo_zipf_con_theta4":2.35,"zpd_vivo_zipf_con_theta1":5.35,"zpd_vivo_desplazamiento_zipf":3}`
- ✅ **PASS** · referencia wilson2019: Crossref: 2019 · the eighty five percent rule for optimal learning
  - observado: `{"doi":"10.1038/s41467-019-12552-4","year":2019,"title":"the eighty five percent rule for optimal learning"}`

### ✅ H4-jol — «Ya la conozco» alimenta el nivel como si fuera una prueba

> Marcar «ya la conozco» llama a updateLanguageTheta con outcome 1 y un delta de 0,18 × (1 − P), sin ninguna recuperación verificada de por medio.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene ««Ya la conozco» es un juicio, no una prueba»
- ✅ **PASS** · code-anchor: src/client/components/Reader.tsx:4167 coincide con /updateLanguageTheta\(currentLang, beta, 1, 1\.0\)/
  - observado: `{"file":"src/client/components/Reader.tsx","line":4167,"text":"updateLanguageTheta(currentLang, beta, 1, 1.0);"}`
- ✅ **PASS** · code-anchor: src/client/lib/profile-models.ts:456 coincide con /0\.18 \* \(1 - pKnow\)/
  - observado: `{"file":"src/client/lib/profile-models.ts","line":456,"text":"delta = 0.18 * (1 - pKnow);"}`
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

### ✅ H5-pasiva — La exposición pasiva marca páginas completas y «familiariza» a las 3 pasadas

> Si el dwell supera palabras × 160 ms (con tope de 12 s), todas las palabras no tocadas de la página se registran como vistas, y la tercera exposición las vuelve «familiar», lo que las saca de la predicción.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «La exposición pasiva se auto-engaña»
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:58 coincide con /GAMMA_PASSIVE = 0\.82/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":58,"text":"export const GAMMA_PASSIVE = 0.82;"}`
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:59 coincide con /FAMILIAR_PASSIVE_THRESHOLD = 3/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":59,"text":"export const FAMILIAR_PASSIVE_THRESHOLD = 3;"}`
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:740 coincide con /MIN_MS_PER_WORD = 160/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":740,"text":"export const MIN_MS_PER_WORD = 160; // ~375 palabras por minuto (lectura ágil real, no escaneo)"}`
- ✅ **PASS** · code-anchor: src/client/lib/knowledge.ts:766 coincide con /tappedWordsOnPage\.has/
  - observado: `{"file":"src/client/lib/knowledge.ts","line":766,"text":"if (!clean || tappedWordsOnPage.has(clean) || tappedWordsOnPage.has(w)) continue;"}`
- ✅ **PASS** · probe: el dwell exigido se satura en 12 s: cualquier página de 75+ palabras se marca completa
  - observado: `{"MIN_PAGE_DWELL_MS":3000,"MIN_MS_PER_WORD":160,"MAX_REQUIRED_DWELL_MS":12000,"requerido_40_palabras":6400,"requerido_250_palabras":12000,"saturacion_desde_palabras":75,"wpm_efectivo_250_palabras":1250}`
- ✅ **PASS** · referencia nagy1985: Crossref: 1985 · learning words from context
  - observado: `{"doi":"10.2307/747758","year":1985,"title":"learning words from context"}`
- ✅ **PASS** · referencia pigada2006: https://eric.ed.gov/?id=EJ759833 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ759833","http":200}`
- ✅ **PASS** · referencia waring2003: https://eric.ed.gov/?id=EJ676380 → HTTP 200
  - observado: `{"url":"https://eric.ed.gov/?id=EJ676380","http":200}`

### ✅ H6-fsrs-manual — Las tarjetas se inicializan a mano y la estabilidad se infla después

> CAPTURE_SOURCE_PARAMS fija dificultad y estabilidad por origen de captura en vez de usar la primera calificación, y scheduleReview multiplica la estabilidad por 1,2/1,35 después del cálculo del scheduler.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «bien elegido y mal inicializado»
- ✅ **PASS** · code-anchor: src/client/lib/fsrs.ts:15 coincide con /reader_tap: \{ difficulty: 5\.5, stability: 1\.0 \}/
  - observado: `{"file":"src/client/lib/fsrs.ts","line":15,"text":"reader_tap: { difficulty: 5.5, stability: 1.0 },"}`
- ✅ **PASS** · code-anchor: src/client/lib/fsrs.ts:40 coincide con /nextCard\.stability \* options\.episodicMultiplier/
  - observado: `{"file":"src/client/lib/fsrs.ts","line":40,"text":"nextCard.stability = Number((nextCard.stability * options.episodicMultiplier).toFixed(4));"}`
- ✅ **PASS** · probe: la tarjeta se inicializa con D/S manuales distintos de los del modelo, y el bono episódico se aplica después
  - observado: `{"params_manuales":{"pre_reading":{"difficulty":4.5,"stability":2},"reader_tap":{"difficulty":5.5,"stability":1},"repeated_lookup":{"difficulty":7.2,"stability":0.4}},"init_del_modelo":{"Again":{"stability":0.212,"difficulty":6.4133,"intervalDays":0},"Hard":{"stability":1.2931,"difficulty":5.1122,"intervalDays":0},"Good":{"stability":2.3065,"difficulty":2.1181,"intervalDays":0},"Easy":{"stability":8.2956,"difficulty":1,"intervalDays":8}},"desvio_reader_tap":-1.3065,"desvio_pr…`
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

### ✅ H6-implicito-tiempo — La calificación implícita convierte velocidad en «Easy»

> computeImplicitFsrsGrade devuelve grade 4 (Easy) si el tiempo por carácter es ≤ 650 ms, sin comprobar producción ni recuerdo demorado.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «650 ms/carácter»
- ✅ **PASS** · code-anchor: src/client/lib/practice.ts:590 coincide con /msPerChar <= 650/
  - observado: `{"file":"src/client/lib/practice.ts","line":590,"text":"if (msPerChar <= 650) {"}`
- ✅ **PASS** · code-anchor: src/client/lib/practice.ts:574 coincide con /errorCount >= 2/
  - observado: `{"file":"src/client/lib/practice.ts","line":574,"text":"if (metrics.errorCount >= 2) {"}`
- ✅ **PASS** · referencia rowland2014: Crossref: 2014 · the effect of testing versus restudy on retention: a meta-analytic review of the testing e
  - observado: `{"doi":"10.1037/a0037559","year":2014,"title":"the effect of testing versus restudy on retention: a meta-analytic review of the testing effect."}`
- ✅ **PASS** · referencia laufergoldstein2004: Crossref: 2004 · testing vocabulary knowledge: size, strength, and computer adaptiveness
  - observado: `{"doi":"10.1111/j.0023-8333.2004.00260.x","year":2004,"title":"testing vocabulary knowledge: size, strength, and computer adaptiveness"}`

### ✅ H7-xp-proxy — El XP paga consultar y coleccionar rarezas

> Consultar una palabra paga 2 XP, guardar paga 3 y una palabra rara (zipf < 3,0) paga 7; hay logros por acumular palabras raras, y la racha multiplica el XP por 1,1.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «La gamificación paga el proxy»
- ✅ **PASS** · code-anchor: src/shared/gamification.ts:540 coincide con /gained \+= 2/
  - observado: `{"file":"src/shared/gamification.ts","line":540,"text":"gained += 2;"}`
- ✅ **PASS** · code-anchor: src/shared/gamification.ts:547 coincide con /gained \+= 4/
  - observado: `{"file":"src/shared/gamification.ts","line":547,"text":"gained += 4;"}`
- ✅ **PASS** · code-anchor: src/shared/gamification.ts:87 coincide con /RARE_ZIPF_BELOW = 3\.0/
  - observado: `{"file":"src/shared/gamification.ts","line":87,"text":"export const RARE_ZIPF_BELOW = 3.0;"}`
- ✅ **PASS** · code-anchor: src/shared/gamification.ts:501 coincide con /STREAK_XP_BONUS = 1\.1/
  - observado: `{"file":"src/shared/gamification.ts","line":501,"text":"export const STREAK_XP_BONUS = 1.1;"}`
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

> El ajuste por defecto de layout es scroll con medida de 65 caracteres, aunque la evidencia favorece el paginado.

Código: **PASS** · Referencias: **PASS**

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

> El cliente no registra pushManager ni pide permiso de notificaciones, así que cualquier recordatorio tiene que ser in-app o externo (calendario).

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «no existe `pushManager` en el cliente»
- ✅ **PASS** · code-absent: /pushManager|showNotification|Notification\.requestPermission/ no aparece en src/client
- ✅ **PASS** · referencia gollwitzer2006: Crossref: 2006 · implementation intentions and goal achievement: a meta‐analysis of effects and processes
  - observado: `{"doi":"10.1016/S0065-2601(06)38002-1","year":2006,"title":"implementation intentions and goal achievement: a meta‐analysis of effects and processes"}`
- ✅ **PASS** · referencia thakkar2016: Crossref: 2016 · mobile telephone text messaging for medication adherence in chronic disease
  - observado: `{"doi":"10.1001/jamainternmed.2015.7667","year":2016,"title":"mobile telephone text messaging for medication adherence in chronic disease"}`
- ✅ **PASS** · referencia lally2010: Crossref: 2009 · how are habits formed: modelling habit formation in the real world
  - observado: `{"doi":"10.1002/ejsp.674","year":2009,"title":"how are habits formed: modelling habit formation in the real world"}`

### ✅ H8-sin-medicion — No se mide comprensión ni retención diferida

> No existe en el código ninguna comprobación de comprensión ni de retención demorada; el bucle se valida con consultas, guardados, repasos y minutos.

Código: **PASS** · Referencias: **PASS**

- ✅ **PASS** · doc-mention: el documento contiene «Nadie mide si se aprende»
- ✅ **PASS** · code-absent: /comprehension|delayedRetention|retentionCheck|chequeoDeRetencion/ no aparece en src
- ✅ **PASS** · code-absent: /postTest|delayedRecall/ no aparece en src
- ✅ **PASS** · referencia rowland2014: Crossref: 2014 · the effect of testing versus restudy on retention: a meta-analytic review of the testing e
  - observado: `{"doi":"10.1037/a0037559","year":2014,"title":"the effect of testing versus restudy on retention: a meta-analytic review of the testing effect."}`
- ✅ **PASS** · referencia adesope2017: Crossref: 2017 · rethinking the use of tests: a meta-analysis of practice testing
  - observado: `{"doi":"10.3102/0034654316689306","year":2017,"title":"rethinking the use of tests: a meta-analysis of practice testing"}`
- ✅ **PASS** · referencia harkin2016: Crossref: 2016 · does monitoring goal progress promote goal attainment? a meta-analysis of the experimental
  - observado: `{"doi":"10.1037/bul0000025","year":2016,"title":"does monitoring goal progress promote goal attainment? a meta-analysis of the experimental evidence."}`

### ✅ H3-cat-prior — El prior del CAT está en otra escala que su banco

> El banco activo del CAT usa dificultades logit entre −2,1 y +2,25, mientras el prior es θ = 4,0: en el primer ítem P(conocer) ≈ 0,996 y la información de Fisher es casi nula.

Código: **PASS** · Referencias: **SKIP**

- ✅ **PASS** · doc-mention: el documento contiene «el prior del CAT (4,0) cae fuera del rango»
- ✅ **PASS** · code-anchor: src/shared/calibration-bank.ts:1077 coincide con /CALIBRATION_BANK_ITEMS_ES/
  - observado: `{"file":"src/shared/calibration-bank.ts","line":1077,"text":"export const CALIBRATION_BANK_ITEMS_ES: readonly CalibrationBankItem[] = ["}`
- ✅ **PASS** · code-anchor: src/client/lib/calibration.ts:382 coincide con /getCalibrationBankByLang/
  - observado: `{"file":"src/client/lib/calibration.ts","line":382,"text":"const candidatesBank = bank ?? getCalibrationBankByLang(state.lang);"}`
- ✅ **PASS** · code-anchor: src/client/lib/profile-models.ts:658 coincide con /CALIBRATION_PRIOR_THETA = 4\.0/
  - observado: `{"file":"src/client/lib/profile-models.ts","line":658,"text":"export const CALIBRATION_PRIOR_THETA = 4.0;"}`
- ✅ **PASS** · probe: banco logit [-2.1, 2.25] con prior θ = 4: P(conocer) mínimo 0.9997 e información de Fisher ≤ 0.1434
  - observado: `{"items":30,"min":-2.1,"max":2.25,"discriminacion":1.35,"prior_theta":4,"p_conocer_en_el_min":0.9997,"p_conocer_en_el_max":0.9139,"info_fisher_maxima":0.1434,"info_fisher_en_beta_0":0.0082}`

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
