# Estrategia de aprendizaje de Lecta — estado real y evidencia (2026-10-26)

Este documento responde a una pregunta concreta: **¿la estrategia para aprender
de Lecta es buena, y hay mejores maneras de meter al lector en la aplicación?**

Se escribió leyendo el código que la app ejecuta de verdad —no el que solo existe
en un módulo— y contrastando cada decisión con literatura revisada por pares. Los
números de línea son del árbol al 2026-10-26. El registro verificable de cada
afirmación vive en `docs/auditoria/claims.json` y se reproduce con
`node scripts/audit-investigacion.mjs`.

> **Vigencia (2026-11-14).** Una revisión Goldfish contrastó este documento con el
> código del 2026-11-14 y encontró que varias afirmaciones de «hecho» no se
> cumplen. Las secciones afectadas llevan una nota **Estado real** y la lista
> priorizada vive en §10. Informe completo:
> `docs/revision-egm/2026-11-14-estrategia/goldfish_review_report.md`.

---

## 0. Veredicto en cuatro frases

1. **El motor está bien elegido**: FSRS-6 para el repaso, Rasch por idioma para
   el nivel, utilidad con zona de desarrollo próximo para elegir qué preparar y
   cloze sobre el contexto real para recuperar.
2. **El circuito ya está cerrado de punta a punta**: guardar crea la tarjeta,
   leer produce evidencia, consultar y marcar «ya la conozco» ajustan el nivel,
   y resolver el reto de fin de capítulo **avanza la tarjeta en FSRS** en modo
   scroll y en modo páginas. **Estado real (2026-11-14):** el circuito está
   conectado pero no es fiable: el reto puntúa `Good` aunque el lector falle,
   la exposición pasiva sube θ y la consulta mueve θ del idioma equivocado
   (§10).
3. **Lo que se corrigió en esta ronda**: una sola escala de θ, una sola escala de
   umbrales de cobertura, XP que ya no se puede farmear, autoinforme que no paga
   como repaso, exposición pasiva acotada y sin revivir borrados, y retiro del
   código muerto que duplicaba decisiones.
4. **Lo que sigue faltando**: una medida objetiva de comprensión (hoy solo hay
   autoevaluación de un toque al cerrar cada capítulo) y la curva de retención
   propia con datos reales de lectores. El reencuentro léxico ya ordena Descubre,
   ponderado por apariciones.

---

## 1. Qué ve hoy el lector (flujo operativo real)

| Paso | Qué pasa | Dónde vive |
|---|---|---|
| Abrir | Toca el libro en la estantería y entra al lector en el mismo gesto | `App.tsx` `openStoredBook`, `Shelf.tsx` |
| Calibrar (opcional) | CAT adaptativo de 6–8 ítems con banco logit; arranca en θ = 0,0 y escribe θ en `lecta:user_language_profile:v1` | `Calibration.tsx:29`, `calibration.ts:400-470` |
| Antes del capítulo | Aviso no intrusivo («N palabras clave en este capítulo»); la hoja se abre solo si el lector la pide y ofrece hasta **40 filas** y 3 cartas rápidas | `useReaderChapterPrep.ts:365-411`, `section-words.ts:201` |
| Orden de esas filas | Diseño: utilidad = P(desconocer) × (1 + 1.4·ln(1+f_cap) + 0.6·ln(1+f_libro)) × zona i+1 × locución × peso L2, en la escala 4 − zipf. **Estado real:** `f_cap` se cuenta como tokens del texto (`countFormTokens`) y se agrega por lema (todas las formas del capítulo que comparten ficha); `bookFrequencies` llega del manifiesto `bookVocab` (`bookFrequenciesOf`) en el lector y en papel, también agregada por lema sobre las formas del capítulo | `section-words.ts` (`nextChapterUtility`, `buildSuggestionRows`), `preparation-rows.ts:31-37`, `book-vocab.ts:121` |
| Leer | Scroll por defecto, medida 65 ch, 18 px | `settings.ts:383-388` |
| Consultar palabra | Con ratón, un toque abre la ficha; en táctil, presión larga → mini menú → «Significado» → ficha. La ficha muestra el significado de inmediato | `ReaderContent.tsx:370-479`, `ReaderSelectionBar.tsx:203-219`, `ReaderOverlays.tsx:286-310`, `WordPanel.tsx` |
| Guardar | Crea una tarjeta FSRS vacía (la primera calificación real la fija) y la deja en el Cuaderno | `fsrs.ts:125-127`, `reviews.ts:60-84` |
| Reencontrar | La ficha muestra la etapa real: «En práctica», «Asentada» o «Dominada». **Estado real:** reconsultar una palabra guardada no registra fallo de recuerdo y reencontrarla sin consultar no deja rastro | `WordPanel.tsx:673-680` |
| Pasar página | Diseño: la exposición pasiva registra hasta 8 lemas no consultados, con dwell proporcional y por debajo de 450 ppm; no revive palabras borradas. **Estado real:** los 8 lemas son siempre los primeros de la sección, no los de la página; cuenta también al retroceder; en scroll solo dispara al cerrar capítulo | `reader-evidence.ts:184-266`, `idb.ts:2133-2168`, `useReaderNavigation.ts:245`, `:310` |
| Cerrar capítulo | Reto de 2–3 ejercicios (cloze del contexto real, scramble); cada uno resuelto consolida la palabra con `Good` y registra un repaso. **Estado real:** el ejercicio reintenta hasta acertar y la nota es `Good` sin mirar errores, pistas ni vencimiento | `DeepReadingSummaryModal.tsx:132-152`, `reviews.ts:86-160` |
| Cuaderno | «Por aprender», «Repasar hoy» y práctica con ts-fsrs 5.4.2; un ejercicio, un evento de repaso | `Vocabulary.tsx`, `practice.ts:389-456` (`buildAdaptivePracticeQueue`) |
| Medallas | XP por minuto leído, consulta (2, una vez por palabra al día), guardada (3 + 4 si es rara), repaso; racha ×1.1 | `shared/gamification.ts:85-100`, `:555-575` |

Lectura del mapa: hay **una sola vía de selección** para la preparación, **una
sola escala de nivel** y **una sola fuente de verdad de la tarjeta**. Antes había
dos motores de selección y tres escalas de θ; el segundo motor y el código muerto
se retiraron en lugar de conectarse, porque no tenían consumidor y duplicaban una
decisión ya tomada: section-words.ts quedó sin selectores duplicados.

**Estado real (2026-11-14):** la escala es una, pero hay dos estimadores vivos
(`estimateProfile` en zipf para cobertura y predicción; θ Rasch para utilidad y
CAT) y tres reglas de actualización de θ (§H3). La tarjeta tampoco tiene una sola
fuente: el portal Kindle programa con su propio FSRS
(`src/worker/kindle/routes.ts:2476-2493`, con fuzz, sin `request_retention` y
acierto = `Good`). Sigue habiendo código sin consumidor en producción:
`buildOneMinuteReviewSession` y `savedWordToItem` (`practice.ts`),
`MAX_PREVIEW_WORDS` (`section-words.ts:508`), `updatePreviewFrictionPreference`,
`applyChapterCompletionPassiveLoop` y `updatePassiveExposureState`
(`knowledge.ts`).

---

## 2. Los hallazgos que sí mueven la aguja

### H1. La cobertura ya no miente y se mide por idioma

- Se calcula sobre **formas únicas**: `(known + saved) / total` con
  `total = forms.length` (`knowledge.ts:285-292`).
- Cada libro se mide con el perfil de **su** idioma, no siempre con el de español
  (`coverage.ts:114-140`).
- **Una sola escala de umbrales** (94 «Lectura relajada» / 86 «Ideal para tu
  ritmo») la comparten catálogo, estantería y etiqueta de nivel
  (`coverage.ts:178-207`, `catalog.ts:279-300`).
- La cobertura reporta cuántas formas del libro ya están en el Cuaderno y
  cuántos **lemas distintos** del Cuaderno reaparecen (`reencuentrosCount` en
  `coverageOfBook`): el dato que alimenta la promesa de reencuentro. Cuatro
  conjugaciones de «correr» cuentan como una sola palabra del Cuaderno.
- La literatura mide **tokens** (Laufer & Ravenhorst-Kalovski, 2010, *RFL* 22(1);
  Nation, 2006, *CMLR* 63(1)). En una novela de prueba, 88 % de formas únicas
  equivale a ~98 % de tokens: la insignia es conservadora, no inflada. Las
  guardadas del Cuaderno cuentan como cubiertas y los nombres sin ficha como no
  cubiertas, así que el número se lee como aproximación, nunca como promesa.
- Sigue siendo promedio del libro: un libro al 92 % puede tener un capítulo al
  78 %, y ahí se abandona.

**Qué hacer**: mostrar la varianza por capítulo como aviso («este capítulo tiene
más palabras nuevas») y añadir la cobertura por tokens como métrica interna.

**Evidencia**: Schmitt, Jiang & Grabe (2011, *MLJ* 95(1)) muestran relación
lineal sin umbral abrupto: el número exacto importa menos que *no mentir sobre él*.

### H2. La preparación es una oferta, no un deber

- `PREPARATION_ROWS_CAP = 40` (`section-words.ts:201`), pero la hoja **no se abre
  sola**: el código degrada la apertura automática a un aviso y el lector decide
  (`useReaderChapterPrep.ts:365-375`).
- La tarjeta rápida muestra 3 joyas léxicas y 8 filas por página; el resto queda
  en la lista diferida, sin declararse conocido por el recorte.
- La evidencia favorece la **ayuda en el punto de necesidad**: glosas durante la
  lectura suben aciertos de 26,6 % a 45,3 % (inmediato) y de 19,8 % a 33,4 %
  (diferido) — 42 estudios, N = 3.802 (Yanagisawa, Webb & Uchihara, 2020,
  *SSLA*). La instrucción léxica previa también mejora la comprensión del pasaje,
  aunque con efecto que se desploma en medidas estandarizadas: d = 0,50 vs
  d = 0,10 (Elleman et al., 2009, *J. Research on Educational Effectiveness*
  2(1), 1–44). Ambas cosas caben: una preparación breve y opcional.
- Pre-enseñar 40 palabras antes de un capítulo choca con memoria de trabajo: el
  código declara a Cowan (3–5) en `MAX_PREVIEW_WORDS` (`section-words.ts:508`),
  pero esa constante no tiene consumidor.
- **Estado real:** `currentChapterPrimedWordsRef` se llena al terminar el
  análisis aunque la hoja no se abra (`useReaderChapterPrep.ts:466-486`) y no se
  vacía al cambiar de capítulo. Esas palabras entran al reto de cierre y, al
  consolidarse, al Cuaderno, aunque el lector nunca las haya visto.

**Qué hacer**: que la tarjeta rápida priorice 3–5 palabras frontera y el resto
quede bajo demanda, como ya hace el flujo actual.

### H3. Una sola escala de θ y una sola llave

| Escala | Fórmula | Quién la usa |
|---|---|---|
| Rasch (viva) | `betaFromZipf` = 4 − zipf, neutra en 0,0 | nivel del lector, utilidad de la hoja, selector de ítems del CAT, señales de «ya la sé», consulta y capítulo |
| Logit del banco | ítems del CAT | `CALIBRATION_BANK_ITEMS_ES`, con dificultades de −2,1 a +2,25 |

**Una sola escala de θ** (`profile-models.ts:211-300`) y **una sola llave**
(`lecta:user_language_profile:v1`). La llave vieja `lecta:user_theta:<lang>:v1`
(escala 7 − zipf, neutra en 4) se migra **una sola vez** restando 3 y nunca se
vuelve a escribir. El CAT y la hoja leen el mismo valor; antes el CAT escribía la
llave heredada con un número de otra escala y la hoja calculaba β = 7 − zipf.

El banco del CAT ya está en logits y su escala coincide con la viva: el lector
que acierta palabras difíciles sube θ y la hoja le ofrece palabras más raras, que
es lo que la evidencia de la zona de desarrollo próximo pide (Wilson et al.,
2019, *Nature Communications*).

**Qué hacer**: añadir un test que falle si alguien vuelve a introducir una
segunda escala o una segunda llave. El arnés de auditoría ya lo hace por fuera.

**Estado real (2026-11-14):** la escala y la llave son una, las reglas que la
mueven no. La ficha usa `updateThetaForLanguageSignal` (delta 0,18·(1−P), tope
±3,5; `profile-models.ts:404-440`); la hoja de preparación y «Guardar para
practicar» usan `updateLanguageTheta` (otro delta y tope [−3,5, 4,0];
`Reader.tsx:4544-4576`); y la exposición pasiva llama `updateLanguageTheta` con
resultado 1 en cada página válida (`reader-evidence.ts:248-261`), así que θ sube
solo por leer. θ se guarda en localStorage sin `userId`.

**Dos estimadores, a propósito (2026-11-14).** `estimateProfile` da un umbral
en zipf a partir de la evidencia declarada y probada; gobierna la predicción
de la sección y la cobertura. θ Rasch (`thetaByLang`) gobierna la utilidad de
la hoja, el CAT y la dificultad relativa. Desde la revisión ninguna señal los
empuja en sentidos opuestos: la exposición pasiva ya no toca a ninguno y
todas las señales de θ pasan por `updateThetaForLanguageSignal`. La migración de la
llave vieja resta 3 solo si el valor es ≥ 2,5 y no pisa un θ ya distinto de 0
(`profile-models.ts:252-260`).

### H4. «Ya la conozco» es un juicio, no una prueba

- En la ficha, «Ya la sé» → `applyPreviewKnownSignal` →
  `updateThetaForLanguageSignal('explicit_known')`, delta = 0,18 × (1 − P)
  (`WordPanel.tsx:628-671`, `profile-models.ts:404-440`). En la hoja de
  preparación, `onMarkKnown` usa otra regla: `updateLanguageTheta(lang, β, 1, 1.0)`
  (`Reader.tsx:4544-4549`), guarda evidencia `inferred` y no registra historial.
- En la ficha el acto se registra en el historial **sin pagar XP de repaso**.
- **Estado real:** β no es «la dificultad real de la palabra». Sale de
  `calibrationBankZipf`, que solo conoce las palabras del banco CAT; fuera de él
  devuelve `null` y `betaFromZipf(null)` = 0,5. Además, consultar y guardar
  llaman `recordSilentCalibration` sin idioma (`WordPanel.tsx:403`, `:562`), que
  por defecto usa `"es"` (`knowledge.ts:744-758`): en un libro en inglés cada
  consulta baja θ de español, y consultar + guardar son dos bajadas. Los atajos
  de teclado de la ficha escuchan en `window` y «s» declara conocida una palabra
  ya guardada (`WordPanel.tsx:720-741`).
- Los juicios de aprendizaje son sistemáticamente **sobreconfiados** (Koriat &
  Bjork, 2005, *JEP:LMC* 31(2); nivel: experimental replicado).
- Reconocer no es saber: la puntuación cae al pasar de reconocimiento pasivo a
  recuerdo activo (Laufer & Goldstein, 2004, *Language Learning* 54(3)); los
  formatos de reconocimiento apenas predicen uso real (Kremmel & Schmitt, 2016).

**Qué hacer**: cuando haya 3–5 palabras frontera, ofrecer un micro-cloze de un
toque con la oración real del capítulo en lugar de preguntar «¿la conoces?».
Fallar con feedback no daña (Kornell, Hays & Bjork, 2009, *JEP:LMC* 35(4)) y el
intento previo mejora la retención posterior aunque salga mal (Richland, Kornell
& Kao, 2009, *JEP:Applied* 15(3)). Debe ser **opcional y en el texto**, nunca un
examen que bloquee la lectura.

### H5. La exposición pasiva se acota

`checkPassiveExposure` (`reader-evidence.ts:184-266`) registra **hasta 8 lemas
no consultados** por paso de página válido, exige dwell proporcional
(`palabras × 160 ms`, con suelo de 3 s y tope `MAX_REQUIRED_DWELL_MS` de 12 s) y
una velocidad menor a 450 ppm. A las 3 exposiciones la palabra pasa a
«familiar»; una lápida borrada nunca revive (`idb.ts:2143`).

**Estado real (2026-11-14):**

- Los candidatos salen de `analysis.forms`, las formas únicas de **toda la
  sección** en orden de aparición (`chapter-analysis.ts:169`): cada paso de
  página suma a los mismos 8 primeros lemas, no a los de la página leída.
  También cuenta al retroceder (`useReaderNavigation.ts:310`) y en modo scroll
  solo dispara al cerrar el capítulo (`:245`).
- `recordPassiveExposure` **sí** persiste `status: "familiar"` en IndexedDB
  (`idb.ts:2133-2168`) y se sincroniza (`reading-sync.ts:844-847`).
  `journey.ts:601-614` y `:780-790` cuentan «familiar» como palabra aprendida, y
  `predictSection` la trata como conocida (`knowledge.ts:214-224`, `:280-292`).
- A la vez, `Reader.tsx:659-680` mete esas filas en la evidencia como
  `known: false` y la hoja las prioriza como `explicit_unknown`
  (`section-words.ts:328-330`).
- Cada página válida sube θ (`reader-evidence.ts:248-261`).

El mismo acto —leer sin consultar— sube θ, baja el umbral del perfil e infla
«palabras aprendidas». Lo que sigue describe la intención, no el código actual.

La adquisición incidental real por exposición es 5–15 % (Nagy, Herman &
Anderson, 1985, *RRQ* 20(2)), y en lectura extensiva hacen falta muchos
encuentros para el significado; con menos de 8 no se retuvo ninguna palabra en el
estudio de Waring & Takaki (2003, *RFL* 15(2)). Marcar «familiar» tras tres
pasadas de página es una promesa que la evidencia no sostiene: la exposición no
debería escribir evidencia permanente ni competir con lo que el lector declaró.
Hoy hace las dos cosas (ver arriba).

**Qué hacer**: usar la exposición solo como métrica de recomendación
(«esta palabra ya te rodeó tres veces») y no como conocimiento.

### H6. Tarjetas limpias y consolidación conectada

- **Tarjetas limpias y consolidación conectada**: la tarjeta nace vacía y la
  primera calificación real fija dificultad y estabilidad (`fsrs.ts:1-28`). Los
  parámetros por origen de captura y el multiplicador episódico se retiraron:
  inflaban intervalos sin que el modelo lo pidiera.
- Resolver el reto de cierre llama a `consolidateEpisodicWord`, que avanza la
  tarjeta con `Rating.Good`, la incorpora al Cuaderno si venía de una consulta o
  de la preparación, y registra **un solo** repaso (`reviews.ts:86-160`).
- **Estado real (2026-11-14): no es una recuperación verificada.**
  `SentenceBuilderGame.tsx:241-277` y `WordScrambleGame.tsx:265-304` dejan
  reintentar hasta acertar; el scramble ilumina la ficha correcta a los 8 s
  (`:239-263`). `DeepReadingSummaryModal.tsx:132-152`, `Reader.tsx:1105-1108` y
  `MidChapterRecallCard.tsx:43` ignoran `errorCount` y `usedHint`, y
  `reviews.ts:119-123` aplica `Good` sin condición, aunque la tarjeta no esté
  vencida y aunque la palabra sea nueva (la primera nota llega minutos después
  de consultarla). FSRS nunca ve un fallo y la tarea más fácil (lector, `Good`)
  puntúa más que la difícil (Cuaderno, `Hard`). Además pone `deleted: false`
  (`reviews.ts:127`), así que revive palabras quitadas, y solo busca por
  `wordKey(form)`/`wordKey(lemma)`: otra flexión de una palabra guardada crea una
  tarjeta nueva y la original no avanza.
- El cierre de capítulo ocurre igual en modo scroll y en modo páginas: el enlace
  «Siguiente» al final del texto llama a `completeChapterTo`
  (`useReaderNavigation.ts:217-278`).
- FSRS-6 es la mejor opción pública: log loss 0,346 vs 0,368 (DASH) y 0,469
  (HLR) en el benchmark abierto de la comunidad (9.999 colecciones, 349,9 M
  repasos; es un benchmark sobre *logs*, sin arbitraje). El paper de SSP-MMC
  reporta +12,6 % de ahorro de repasos en simulación (Ye, Su & Cao, 2022, KDD).
  Nivel: predice recuerdo, no demuestra aprendizaje; el único dato con nota final
  es +16,5 % de retención frente a estudio masivo (Lindsey et al., 2014,
  *Psych. Science* 25(3)).
- **Sin calificación implícita por velocidad**: la regla «≤ 650 ms/carácter ⇒
  Easy» se retiró. El tiempo es proxy débil de dominio y *Easy* es la
  calificación que más dispara el intervalo. **Estado real:** sigue habiendo
  `Easy` automático por otra vía: el taller IA aplica `Rating.Easy` con
  puntuación ≥ 85 sin mirar vencimiento (`Vocabulary.tsx:354-386`) y su veredicto
  precarga la nota en «Escribir» (`useReviewSession.ts:659-660`). El umbral de
  650 ms sigue vivo para elegir modalidad (`practice.ts:705`), no para calificar.
- Antes no había **horizonte declarado**: FSRS trabajaba con `request_retention`
  implícito ~0,9, y el intervalo óptimo escala con el retraso del examen (20–40 %
  del horizonte a una semana, 5–10 % a un año; Cepeda et al., 2008, *Psych.
  Science* 19(11)).

**Hecho**: el Cuaderno ofrece «Ritmo de repaso» con tres niveles (Fluido 85 %,
Equilibrado 90 %, Firme 93 %) que fijan `request_retention` y se guardan por cuenta. Falta ajustarlo con
la curva propia del lector cuando haya datos suficientes.

### H7. La gamificación paga el proxy

- **La gamificación paga el proxy**: consultar paga 2 XP **una sola vez por
  palabra e idioma al día** (`game.ts:207-255`), guardar paga 3 y una palabra
  rara (zipf < 3,0) paga 7 (`RARE_ZIPF_BELOW = 3.0`); la racha multiplica por
  1,1. «Ya la sé» no paga como repaso y la consolidación paga como «Bien».
- Efecto restante: el sistema sigue pagando consultar y coleccionar palabras
  oscuras —las menos útiles para leer— y paga poco por recuperar.
- La evidencia: las recompensas tangibles esperadas y contingentes **erosionan**
  la motivación intrínseca (d ≈ −0,40; Deci, Koestner & Ryan, 1999, *Psych.
  Bull.* 125(6)); la regulación externa no predice persistencia y predice peor
  bienestar (Howard et al., 2021, *Perspect. Psychol. Sci.*); y la gamificación
  da efectos pequeños con decaimiento por novedad (g = 0,25 conductual / 0,36
  motivacional / 0,49 cognitivo; Sailer & Homner, 2020, *Educ. Psychol. Rev.*).
  El XP es una recompensa simbólica, más cercana a la retroalimentación que a un
  premio tangible; el efecto negativo aplica sobre todo a premios tangibles.
- Lo que sí funciona en la misma familia: racha atada a **una acción mínima**,
  escudo (`gap === 2 && streak ≥ 3`, `gamification.ts:540`), meta de proceso
  semanal y monitoreo del progreso que **se consulta y se comparte**
  (d = 0,40; Harkin et al., 2016, *Psych. Bull.*).

**Qué hacer**: XP por capítulo terminado y por recuperación exitosa en repaso
espaciado; retirar el bonus por rareza (o invertirlo a utilidad: frecuencia ×
frontera). **Pendiente (2026-11-14):** guardar sigue pagando 3 + 4 si es rara
(`gamification.ts:558-564`), los logros solo cuentan palabras guardadas
(`:306-332`) y el reto del lector (3 XP, `Good`) paga más que un acierto del
Cuaderno (2 XP, `Hard`).

### H8. Nadie mide si se aprende

- El producto mide consultas, guardados, repasos, minutos, WPM y cobertura.
  **Ninguna** de esas cosas es comprensión.
- La retención del vocabulario ya se mide: `computeRetentionSummary`
  (`journey.ts`) calcula la tasa de acierto sobre los repasos verificados y
  cuántas palabras tienen memoria estimada de 7 y 30 días (la estabilidad de FSRS); «Tu
  recorrido» lo muestra junto a las etapas, y el Cuaderno ofrece un «Chequeo 30
  días» de un minuto sobre las palabras asentadas con 30 o más días desde su último repaso.
- **Estado real (2026-11-14): la tasa de acierto está invertida.**
  `computeRetentionSummary` (`journey.ts:96-101`) cuenta como acierto solo
  good/easy/correct, pero un acierto del Cuaderno es `Hard`
  (`practice.ts:114-117`) y cuenta como fallo; el `Good` incondicional del lector
  cuenta como acierto. En los minijuegos del Cuaderno los errores tampoco llegan
  a FSRS: `onSolve` aplica `Hard` sin importar reintentos
  (`PracticeCard.tsx:233-279`), `onWrong` cambia a un reto más fácil sin
  registrar `Again` (`useReviewSession.ts:736-757`) y la pista no cambia la nota.
  El «Chequeo 30 días» califica con `grade` palabras no vencidas: mezcla medir
  con programar.
- El propio `docs/concentracion-y-lectura.md` §4 lo declara: «Lo que Lecta NO
  mide: comprensión».
- La palanca con mejor evidencia para cerrar eso es barata: recuperación con
  feedback (g ≈ 0,50 en 159 efectos; Rowland, 2014, *Psych. Bull.* 140(6);
  g ≈ 0,61 global; Adesope et al., 2017, *RER* 87(3)).

**Hecho**: al cerrar cada capítulo, un toque anota «¿Seguiste el hilo?» (Seguí el
hilo / Más o menos / Me perdí). Se guarda por cuenta y «Tu recorrido» lo muestra
como **valoración propia**: es una autoevaluación, no una medida de comprensión.

**Pendiente**: una medida objetiva de comprensión (por ejemplo, una pregunta de
inferencia generada con IA). Se pospone hasta tener datos de uso de la
autoevaluación. La curva de retención propia sigue siendo la siguiente medida.

---

## 3. Lo que no hemos visto: cuatro maneras de meter al lector en la app

Ordenadas por *fuerza de evidencia × ajuste a lo que Lecta ya tiene*.

### M1. Reencuentro léxico planificado (la palanca que falta)

**Idea**: recomendar y ordenar libros por **cuántas palabras del Cuaderno
reaparecen** en ellos. La cobertura ya calcula ese número
(`reencuentrosCount`) y Descubre lo muestra: «Repite 14 palabras de tu cuaderno».

**Por qué**: el cuello de botella del vocabulario no es el repaso, es el número
de encuentros en contexto (Pigada & Schmitt, 2006, *RFL* 18(1); Waring & Takaki,
2003). Leer el mismo dominio léxico (*narrow reading*) es el mecanismo más
eficiente para producirlos: para cubrir el segundo millar hacen falta ~200 k
tokens ≈ 2 novelas (Nation, 2014, *RFL* 26(2)).

**Hecho**: el conteo es por lema (`coverageOfBook`) y se pondera por apariciones:
en tus libros propios, cada aparición de una palabra del cuaderno vale 1 (`reencuentrosPonderados`).
Descubre ordena los libros en tu nivel por esa suma, antes que por cobertura
(`compareBookCoverages`). El análisis del libro guarda `occurrences`; los libros
analizados antes valen una aparición por lema, sin migrar datos. El catálogo compartido
todavía no trae conteos: ahí cada lema vale 1 hasta regenerar su manifiesto, lo que cambia
datos compartidos y requiere autorización.

### M2. Repaso en el texto (spacing + retrieval + contexto variable)

**Idea**: al cargar las próximas N secciones, detectar palabras **vencidas** de
FSRS y, en el siguiente *breakpoint* natural (fin de sección), ofrecer un
micro-cloze de 1 toque con la oración real de ese capítulo.

**Por qué**: el repaso hoy vive en el Cuaderno, que es otro destino: el
principio «1 toque» se rompe justo en la frontera del lector. Mover la
recuperación al texto junta espaciamiento, recuperación y variabilidad de
contexto — las tres palancas con evidencia (Cepeda 2006; Rowland 2014; Laufer &
Hulstijn 2001 sobre carga de implicación).

**Hecho**: al pasar a la sección siguiente, si una palabra del cuaderno ya venció y
aparece en ella, arriba del texto aparece un micro-cloze de 1 toque con su oración
(`MidChapterRecallCard`). Es la versión elegida: se dispara al entrar, no al final
de la sección; como máximo una vez por capítulo, se puede saltar y solo corre con
la consolidación activa. Al resolverse consolida la palabra en FSRS
(Rating.Good), igual que el cierre, y con el mismo defecto: no mira errores ni
pistas (§H6). Solo encuentra la forma exacta guardada, sin flexiones
(`mid-chapter-recall.ts:33`), y en modo páginas consume la marca de «una vez por
capítulo» aunque no se muestre. Verificado en el navegador con un libro real:
la tarjeta aparece, se ve y saltar no toca la tarjeta FSRS. En modo páginas no se
muestra: arriba de las columnas dejaría el área de lectura en 248 px de 687, así
que ahí el repaso llega solo en el cierre de capítulo.

**Cierre de capítulo**: `buildPostChapterConsolidationQueue` prioriza las palabras
del cuaderno que reaparecen en el capítulo (`notebook-reencounter`), sin duplicar
lemas. Ese criterio es de reencuentro, no de vencimiento FSRS. **Estado real:**
abrir la hoja de preparación sobrescribe esa fuente con `pre-chapter-primed`
(`recordPresented`, `useReaderChapterPrep.ts:730-742`), así que la prioridad solo
se cumple si la hoja no se abrió. Las consultas se vacían por sección
(`useReaderSectionLoader.ts:243`) y el cierre es por capítulo: en capítulos de
varias secciones se pierden las de las primeras.

**Falta el reencuentro como señal.** La exposición excluye las palabras
guardadas (`reader-evidence.ts:227`): reencontrar una palabra del Cuaderno en el
texto no deja rastro, y reconsultar una «Asentada» no registra un fallo de
recuerdo. `reencuentros_por_palabra` (§6) no tiene fuente.

### M3. Lectura con audio de ritmo controlado (y modo manos libres)

**Idea**: TTS + resaltado con velocidad 120–180 wpm y control por frase; modo
audio para trayectos (la lectura sigue sola, la pantalla se apaga).

**Por qué**: la lectura bimodal tiene efecto pequeño en promedio (g = 0,18;
30 estudios, N = 1.945) pero **se triplica cuando el audio marca el ritmo**
(g = 0,41) y desaparece cuando lo marca el lector (g = 0,06 ns)
(Clinton-Lisell, 2023, *Educational Research: Theory and Practice* 34(3),
133–155). Es una meta-regresión con pocos estudios en L2 y lectores con
dificultades, así que se trata como señal, no como garantía. Y por encima de
~200 wpm la comprensión de intermedios se deteriora (Griffiths, 1992, *TESOL
Quarterly* 26(2)).

**Cómo**: existe `kittenTtsEngine`/`useReaderTts`; falta la velocidad como eje
de primera clase y el modo audio continuo con *pre-síntesis* ya prevista.

### M4. Contrato «si–entonces» + recordatorio en la hora elegida

**Idea**: al terminar el primer capítulo, un pacto de 7 días: «si son las 21:30
y estoy en casa, abro Lecta y leo una página». Recordatorio en esa hora.

**Por qué**: las intenciones de implementación son la intervención conductual
con mejor relación efecto/coste: d = 0,65 (94 estudios, N ≈ 8.461; Gollwitzer &
Sheeran, 2006). La formación de hábito tarda ~66 días de mediana con alta
varianza y **fallar un día no la rompe** (Lally et al., 2010, *EJSP* 40(6)).

**Ojo de infraestructura**: hoy **no existe `pushManager` en el cliente**, así
que el recordatorio es una tarjeta in-app al abrir. Los recordatorios por SMS de
la literatura de salud (Thakkar et al., 2016) son evidencia indirecta: su
población y su canal no son los de Lecta.

### M5. Progreso que se comparte (sin ranking)

**Idea**: al cerrar la semana, una tira («Esta semana: 4 días, 62 páginas, 9
palabras nuevas, 3 capítulos») compartible.

**Por qué**: el monitoreo del progreso mejora el logro con d = 0,40 (138
estudios, N = 19.951) y el efecto se amplifica cuando el avance **se registra y
se hace público** (Harkin et al., 2016). Los clubes de lectura no tienen
meta-análisis —trátese como hipótesis a medir— y el ranking no está respaldado.

### M6. Escalera por estabilidad y contexto nuevo en el Cuaderno

**Idea**: elegir el tipo de ejercicio por la estabilidad de la tarjeta
(reconocimiento → recuerdo con pista → producción verificada) y, para palabras
asentadas, usar oraciones nuevas sacadas de los libros del lector en lugar de la
oración capturada.

**Por qué**: hoy `modeForWord` (`practice.ts:232-239`) alterna el modo por
posición en la cola, el cloze usa siempre la misma oración y los distractores son
fijos por palabra (`:135-167`): con varios repasos se memoriza el ítem, no la
palabra. Los modos de producción («Significado», «Palabra») se autocalifican,
que es la sobreconfianza de H4. La variabilidad de contexto y la progresión de
dificultad son dos de las palancas con evidencia que §M2 ya cita.

### M7. Adivinar antes de ver la glosa

**Idea**: para palabras frontera, opción de un toque «¿qué crees que significa?»
antes de mostrar la glosa, y luego verificar. Opcional y apagada por defecto en
L1.

**Por qué**: `WordPanel.tsx:443-456` muestra el significado de inmediato: la
carga de implicación es baja (tocar → ver → guardar). Inferir y comprobar añade
el componente de *evaluación* de Laufer & Hulstijn (2001) y el intento previo
mejora la retención aunque salga mal (Richland, Kornell & Kao, 2009), sin
bloquear la lectura si es un toque opcional.

---

## 4. Ajustes de una línea con respaldo (no requieren diseño)

| Cambio | De | A | Evidencia |
|---|---|---|---|
| Métrica de éxito | consultas, guardados, minutos | retención a 30 días, capítulos terminados, D7/D14 | Rowland 2014; Harkin 2016 |
| Meta semanal | días leídos | días **y** minutos de proceso, nunca «libros/año» | Locke & Latham, 2002 |
| Pausas | aviso de fatiga por retrocesos | ofrecer pausa de 5–10 min cada 25–30 y «volver en 30 min» con marcador | micro-descansos d = 0,36 vigor / 0,35 fatiga (Albulescu et al., 2022, *PLOS ONE*) |
| Medida de línea | 65 ch | 55–65 ch por defecto | 55 cpl da mejor comprensión que 100 cpl (Dyson & Haselgrove, 2001) |
| Layout por defecto | `scroll` (`settings.ts:388`) | `scroll` en narrativa; paginar como opción | En Delgado et al. (2018) el scroll no es moderador y no hay ventaja del papel en textos narrativos; Haverkamp (2022) encuentra ventaja de paginar en textos informativos |

---

## 5. Qué NO hacer

- **No gamificar velocidad.** El WPM es diagnóstico; leer rápido sacrifica
  comprensión (Rayner et al., 2016, *PSPI*). No hay medalla por WPM.
- **No inflar la cobertura** para que la insignia se vea bonita: el lector
  abandona el capítulo difícil y la app queda mal calibrada. **Hoy se infla en el
  cierre:** «+N palabras asimiladas» usa N = total de palabras de la sección
  (`useReaderNavigation.ts:270`), «+1 % de cobertura» es el valor por defecto
  (`DeepReadingSummaryModal.tsx:72-73`) y el texto afirma que «la estabilidad se
  ha consolidado» (`:191-194`).
- **No interrumpir a media línea.** Toda intervención va en *breakpoint*.
- **No usar IA para juzgar fatiga ni para calificar palabras.** FSRS no se toca;
  las reglas locales bastan y son auditables. Hoy se incumple en el taller IA
  del Cuaderno (§H6).
- **No añadir otra capa flotante.** Ya hay franja única; el siguiente aviso
  debe reemplazar, no apilar.
- **No conectar código muerto solo porque existe.** Un módulo con pruebas y sin
  consumidor no es una función del producto: o se conecta con una prueba de uso
  real, o se retira.

---

## 6. Plan por impacto (sin tocar producción)

Antes de todo esto van los defectos de §10: sin ellos, cualquier palanca nueva
se mide con datos contaminados.

**P0 — lo que el lector ya nota** (todos pendientes)
1. Cobertura por tokens como métrica interna y aviso de capítulo difícil.
2. Micro-cloze opcional en lugar de «¿la conoces?» en las 3–5 palabras frontera
   (`SectionPreview` sigue usando `onMarkKnown`).
3. XP por capítulo terminado y por recuperación exitosa; retirar el bonus por
   rareza.

**P1 — palancas nuevas**
4. Repaso en el texto (M2): hecho al entrar a una sección con palabras vencidas, una vez por capítulo.
5. Chequeo de retención a 30 días (hecho, con 30 días de retraso) y autoevaluación del hilo al cerrar capítulo (hechos); la medida objetiva de comprensión queda pospuesta hasta tener datos de uso (H8).
6. Contrato si–entonces (M4) con tarjeta in-app.
7. Reencuentro léxico ordenado por apariciones (M1): hecho en Descubre.
8. Escalera por estabilidad y contexto nuevo en el Cuaderno (M6).
9. Adivinar antes de ver la glosa (M7).

**P2 — profundidad**
10. Audio de ritmo controlado y modo manos libres (M3).
11. Tira semanal compartible (M5).
12. Ajustar `request_retention` con la curva propia del lector (el horizonte
    declarado ya está hecho, H6).

### Instrumentación mínima para saber si funcionó

`retention_30d`, `chapters_completed / chapters_started`,
`time_to_first_word`, `consults_per_1000_words`, `reencuentros_por_palabra`,
`D7` y `D14`, `% sesiones < 5 min`, `% preparaciones salteadas`. Casi todo sale
de datos que ya se guardan (`reading-events.ts`, `reviews`).

---

## 7. Respuesta directa a la pregunta

**¿Es buena la estrategia para aprender?** La arquitectura sí: glosa en el punto
de necesidad, FSRS-6, cloze sobre la oración real y θ Rasch. La ejecución no
(revisión del 2026-11-14): el reto de cierre puntúa `Good` aunque el lector
falle, la exposición pasiva cuenta las palabras equivocadas y sube θ, la
consulta mueve θ del idioma equivocado, la repetición en el texto no pesa en la
preparación y la tasa de acierto está invertida. Lo que falta no es solo
medición: primero hay que corregir las señales que alimentan el motor (§10).

**¿Hay mejores maneras de poner al lector en la aplicación?** Sí, y no son de
gamificación: son de **reencuentro** (que sus palabras vuelvan en el siguiente
libro), de **texto** (glosa y repaso dentro de la página), de **ritual**
(si–entonces + hora fija) y de **prueba** (micro-cloze antes, retención a 30 días
después).

---

## 8. Cómo se audita este documento

El registro `docs/auditoria/claims.json` convierte las afirmaciones en
comprobaciones ejecutables, pero sus comprobaciones son de presencia de código,
no de comportamiento: no detectaron ninguno de los defectos de §10 (la de H5 solo
busca `uniqueLemmas.size >= 8` y pasa con el defecto presente; la de H4 se ancla
en el camino de la hoja, no en la ficha; varias evidencias citan líneas viejas).
Faltan sondas de comportamiento: página contra capítulo en la exposición, idioma
de la señal de consulta y nota según errores en el reto. Cada comprobación: cita textual en este
documento, anclaje `archivo:línea` con patrón, comprobación de que la función
citada **se usa en producción**, sonda que observa valores reales y referencia
con DOI contrastado contra Crossref.

```bash
node scripts/audit-investigacion.mjs            # sin red: código + forma de las citas
node scripts/audit-investigacion.mjs --online   # además resuelve DOI y URLs
node scripts/audit-investigacion.mjs --pack artifacts/auditoria/pack
```

Cada afirmación lleva además un `auditVerdict` con su estado (sostenida,
matizada o refutada) y la evidencia que lo respalda. Una afirmación refutada
cuyas comprobaciones fallen se reporta como `REFUTED_EXPECTED`; si sus
comprobaciones empiezan a pasar, el arnés la marca `VERDICT_STALE` y obliga a
revisar el veredicto.

Dos advertencias que el arnés no puede resolver y el auditor sí:

- el paso de tipos a tokens es una **simulación**, no una medición del catálogo
  completo;
- «no se mide comprensión» es una afirmación de ausencia: se comprueba por
  identificadores, y un módulo podría medirlo con otro nombre.

---

## 9. Correcciones de la auditoría independiente (2026-10-26)

Una revisión del código que llega a ejecutarse (no solo del texto citado)
encontró que varias afirmaciones describían funciones que la app nunca llama.
Lo que se corrigió:

- **H1 — una sola escala de umbrales y cobertura por idioma.** Antes había tres
  juegos (90/75/60, 94/86 y 95/88) y Descubre pintaba dos etiquetas
  contradictorias. Ahora hay una sola escala (94/86) y una sola etiqueta.
- **H2 — la hoja de 40 filas no se abre sola.** El lector ve una pastilla y
  decide; la hoja muestra 3 cartas y 8 filas por página.
- **H3 — una sola escala de θ y una sola llave.** La sesión del CAT empieza en el
  centro de la escala: el CAT arranca en 0,0 y persiste en el perfil; la llave heredada solo se migra restando 3. El motor
  MAP con prior 4,0 se retiró porque solo lo llamaban las pruebas.
- **H5 — la exposición pasiva descrita era código muerto.** La vía real registra
  hasta 8 lemas por paso, no todas las palabras de la página, y respeta las
  lápidas.
- **H6 — tarjetas limpias y consolidación conectada.** Los parámetros FSRS por
  origen, el multiplicador episódico y el «Fácil por velocidad» se retiraron; el
  reto de cierre ahora consolida la tarjeta de verdad, también en modo scroll.
- **H7 — el XP ya no se puede farmear.** Consultar paga una vez por palabra al
  día y el autoinforme no paga como repaso.
- **H8 — la retención ya se mide.** Tasa de acierto real y palabras con memoria estimada
  de 7 y 30 días en «Tu recorrido», más un «Chequeo 30 días» opcional en el
  Cuaderno. La comprensión sigue sin medida objetiva: hay una autoevaluación de
  un toque al cerrar cada capítulo, mostrada como valoración propia.
- **M1 y M2 conectados.** Los reencuentros se ponderan por apariciones y ordenan
  Descubre; las palabras del Cuaderno que reaparecen entran primero al cierre del
  capítulo, y al entrar a una sección con una palabra vencida aparece un micro-cloze
  (una vez por capítulo). El ritmo de repaso de FSRS se elige en el Cuaderno (0,85 / 0,90 /
  0,93) y la migración de θ ya no resta 3 a quien venía en escala Rasch.
- **Referencias corregidas:** Webb (2009) encuentra que pre-aprender vocabulario
  *ayuda* a la comprensión; en Delgado et al. (2018) el scroll no es moderador y
  no hay ventaja del papel en textos narrativos; Clinton-Lisell (2023) está
  publicado en *Educational Research: Theory and Practice* 34(3); Dyson &
  Haselgrove (2001) asocian 55 cpl con mejor comprensión; Adesope et al. (2017)
  no encuentran efecto de la retroalimentación (g = 0,61 es el global).

Defectos reales que se corrigieron a raíz de la auditoría: cobertura medida con
el perfil en español para libros en otros idiomas, XP por consulta que se podía
farmear, «Ya la sé» pagando XP como repaso, consolidación que pagaba siempre
«Fácil», doble bajada de θ al abrir una ficha, doble registro de repasos en el
Cuaderno, tarjetas marcadas como «nuevas» al reencontrar una palabra asentada y
lápidas de conocimiento que la exposición pasiva podía revivir.

> La revisión del 2026-11-14 (§10) encontró que tres de estas correcciones no se
> sostienen en el código actual: la consolidación paga siempre `Good` (no
> «Fácil», pero sin mirar errores), consultar y guardar siguen siendo dos bajadas
> de θ, y la consolidación sí revive lápidas del Cuaderno.

---

## 10. Revisión Goldfish del 2026-11-14: defectos pendientes

Contraste del documento con el código del 2026-11-14 por dos revisores
independientes (crítica de diseño y precisión técnica). Detalle, citas y
justificación: `docs/revision-egm/2026-11-14-estrategia/goldfish_review_report.md`.
Ninguno está corregido todavía; esta lista es el orden propuesto.

**P0 — señales que contaminan el motor** (corregidos en código el 2026-11-14;
las notas «Estado real» de las secciones anteriores describen el árbol previo)

1. **Reto de cierre y micro-cloze** — hecho. `consolidateEpisodicWord` recibe
   `errorCount`/`usedHint`: error o pista = `Again`, primer intento = `Hard`
   (`episodicRating`, `reviews.ts`). Palabra sin repasos que aún no tocaba = se
   crea o conserva la tarjeta sin calificar, se marca presentada y vence mañana;
   palabra con repasos no vencida = un fallo sí cuenta, un acierto no adelanta el
   repaso. El scramble cuenta como pista la ficha iluminada a los 8 s.
2. **Exposición pasiva** — hecho. Formas de la página leída (`pageForms`, reparto
   del texto por tokens), solo al avanzar; `recordPassiveExposure` solo suma
   `passiveSeenCount` en filas existentes (no crea filas ni cambia
   `known`/`status`); sin llamada a θ; `predictSection` y `journey.ts` ya no
   cuentan «familiar» ni `passiveSeenCount ≥ 3` como conocida o aprendida.
3. **Señal de consulta** — hecho. `recordSilentCalibration(word, event, lang,
   zipf)` con `effectiveLang` y el zipf medido del análisis (`zipfForForm` en el
   lector); una señal por palabra y día (consultar y guardar es un acto).
4. **Frecuencia en la preparación** — hecho a nivel de capítulo:
   `countFormTokens` cuenta tokens del texto; `bookFrequencies` llega desde el
   manifiesto del libro (ver P1 abajo).
5. **Tasa de acierto** — hecho. `RECALL_HIT_RATINGS` incluye `hard` en cliente,
   `admin-insights.ts` y el SQL de `worker/admin.ts`.
6. **Errores del Cuaderno** — hecho. Un error en un minijuego marca el reto
   (`missedRef` en `useReviewSession`) y el acierto posterior, también tras el
   rescate, se califica `Again`.

**P1 — coherencia del circuito** (corregidos en código el 2026-11-14, segunda tanda)

7. **Reto de cierre** — hecho. Al terminar el análisis solo entran las palabras
   del Cuaderno que reaparecen (`notebook-reencounter`); las filas de la hoja
   entran solo si la hoja se mostró (`recordPresented` suma sin pisar la
   fuente). La lista se reemplaza por capítulo y se descartan filas sin oración.
8. **Consolidación** — hecho. No revive lápidas; busca por forma y luego por
   lema entre las guardadas (otra flexión avanza la tarjeta existente); no da
   de alta palabras solo preparadas (`pre-chapter-primed`) ni declaradas
   conocidas.
9. **Reencuentro** — hecho en parte. Reconsultar en el libro una palabra con
   `reps > 0` registra `Again` sin XP, una vez al día (`recordLookupLapse`). El
   reencuentro sin consulta sigue sin registrarse: necesitaría un tipo de
   repaso nuevo en el contrato de sync.
10. **θ** — hecho. La hoja usa las mismas señales que la ficha
    (`applyPreviewKnownSignal` / `applyWordPanelLookupSignal`);
    `updateLanguageTheta` se retiró. Siguen dos estimadores a propósito (§H3).
11. **Taller IA** — hecho. Vale `Good` (nunca `Easy`) y solo si la tarjeta ya
    tocaba. La IA sigue precargando la nota en «Escribir», pero el lector la
    confirma.
12. **Modal de cierre** — hecho. «Palabras leídas» (cifra real) en lugar de
    «asimiladas»; sin «+1 % de cobertura» ni «sellado en memoria»; el resumen
    del retiro ya no fabrica cifras.
13. **Atajos de la ficha** — hecho. Se ignoran con Cmd/Ctrl/Alt y en campos
    editables; «Ya la sé» no actúa sobre una palabra guardada.
14. **Kindle** — hecho. Acierto con opciones = `hard` y `request_retention` 0,9
    (ritmo «Equilibrado»); el ritmo elegido por el lector vive solo en el
    dispositivo y no llega al servidor.
15. **Código sin consumidor** — retirado: `buildOneMinuteReviewSession`,
    `savedWordToItem`, `MAX_PREVIEW_WORDS`, `updatePreviewFrictionPreference`,
    `applyChapterCompletionPassiveLoop`, `updatePassiveExposureState` y
    `updateLanguageTheta`.
16. **Arnés** — sonda de comportamiento `senales-aprendizaje` en H6 (regla de
    acierto ejecutada; exposición por página y sin θ; reto calificado por
    errores; consulta en el idioma del libro; frecuencia por tokens).

**P0-4 completo**: la hoja también pondera las apariciones en el libro entero
(`bookFrequenciesOf` del manifiesto `bookVocab`), igual en el lector y en «Leo
este libro en papel».
