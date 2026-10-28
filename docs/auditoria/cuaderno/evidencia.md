# Auditoría del Cuaderno — estudio antes que prueba

Generado por `scripts/audit-cuaderno.mjs` v1 el 2026-10-28T03:38:58.203Z. Commit: `6b42f07e6f98`.

## La queja, en palabras del usuario

> no recuerdo para nada las palabras al dar iniciar sesión fluida… primero tengo que aprenderme las palabras, de ahí sí puedo practicar

## Veredicto

- Afirmaciones confirmadas: **7/15** · parciales: **0** · movidas: **0** · correcciones en pie: **8** · regresiones: **0**
- Código de salida esperado: `0` (defecto donde decimos y correcciones en su sitio)

## Afirmaciones

| id | estado | tipo | qué comprueba |
|---|---|---|---|
| `C1-cta-primaria-abre-una-prueba` | ✔ CORREGIDO | corregido | El botón principal del héroe ofrece aprender antes de examinar |
| `C2-cola-sale-de-las-vencidas` | ✔ CORREGIDO | corregido | La sesión sale de reviewQueue: vencidas, ya presentadas y sin rama de respaldo |
| `C3-tarjeta-nueva-vence-al-crearse` | ✔ CONFIRMADO | contexto | La tarjeta nace vencida al GUARDAR la palabra en el lector; por eso la cola filtra por exposición |
| `C4-primer-reto-es-elegir-entre-cuatro` | ✔ CORREGIDO | corregido | El reto elige un modo que la palabra puede cumplir y corrige con el significado |
| `C5-estudio-existe-pero-abajo` | ✔ CORREGIDO | corregido | La ficha de presentación es la entrada del héroe; ya no hay bloque enterrado |
| `C6-sesion-puede-ensayar-borradas` | ✔ CONFIRMADO | contexto | Las lápidas no llegan a la sesión: listSavedWords las filtra antes de que exista dueWords |
| `C7-copia-no-dice-cuantas-faltan` | ✔ CORREGIDO | corregido | El botón dice qué hace y con cuántas palabras; no promete minutos |
| `C8-indice-del-heroe-solo-cuenta-hoy` | ✔ CORREGIDO | corregido | El encabezado separa «por aprender» de «para repasar» |
| `C9-el-rescate-llega-despues-de-fallar` | ✔ CONFIRMADO | contexto | La red anti-frustración sigue siendo post-fallo y solo para Nivel 2-3; la corrección nueva está en el modo choose |
| `C10-dos-puertas-a-la-misma-sesion` | ✔ CONFIRMADO | contexto | Queda una sola puerta a la sesión: el héroe; la de GamePanel sigue muerta |
| `X1-la-exposicion-ya-se-persiste` | ✔ CONFIRMADO | contexto | La primera exposición vive por cuenta (learnExposure:v1) y viaja con la palabra (presentedAt) |
| `X2-los-modos-ya-estan-gateados-por-datos` | ✔ CONFIRMADO | contexto | Los modos declaran qué datos necesitan (isEligible) y la sesión lo respeta |
| `X3-el-primer-paso-del-lector-ya-es-una-ficha` | ✔ CONFIRMADO | contexto | La ficha de primera exposición ya tiene UI y voz (learnKeep/learnKnown/learnEnrich) y puente a repaso |
| `C11-cualquier-respuesta-cancela-la-ficha` | ✔ CORREGIDO | corregido | Una palabra con reps 0 solo sale de «Por aprender» con una decisión explícita: la cola la excluye |
| `C12-modos-libres-tampoco-examinan` | ✔ CORREGIDO | corregido | Los modos libres (Hueco, Sílabas, Telar) también salen de reviewWords y avisan cuando no hay nada |

### ✔ `C1-cta-primaria-abre-una-prueba`

**El botón principal del héroe ofrece aprender antes de examinar**

_Por qué:_ «no recuerdo para nada las palabras al dar iniciar sesión fluida… primero tengo que aprenderme las palabras, de ahí sí puedo practicar» — el arreglo: con palabras por aprender, el único botón primario abre la ficha y no la prueba.

- ✔ src/client/components/Vocabulary.tsx:2072 ~ /\) : learnable\.length > 0 \? \(/
  - `) : learnable.length > 0 ? (`
- ✔ src/client/components/Vocabulary.tsx:2079 ~ /onClick=\{\(\) => startLearn\(\)\}/
  - `onClick={() => startLearn()}`
- ✔ src/client/components/Vocabulary.tsx:2051-2106 no contiene /Iniciar Sesi[oó]n Fluida/

### ✔ `C2-cola-sale-de-las-vencidas`

**La sesión sale de reviewQueue: vencidas, ya presentadas y sin rama de respaldo**

_Por qué:_ Se fue la rama scopedWords.slice(0,5), que servía palabras no vencidas, «Ya la conozco» y adelantaba repasos.

- ✔ src/client/components/Vocabulary.tsx:893 ~ /const reviewWords = reviewQueue\(scopedWords, knownKeys, exposure\);/
  - `const reviewWords = reviewQueue(scopedWords, knownKeys, exposure);`
- ✔ src/client/lib/learn.ts:145 ~ /!isLearnPending\(word, knownKeys, exposure\) &&/
  - `!isLearnPending(word, knownKeys, exposure) &&`
- ✔ src/client/components/Vocabulary.tsx:1-9999 no contiene /scopedWords\.slice\(0, 5\)/

### ✔ `C3-tarjeta-nueva-vence-al-crearse`

**La tarjeta nace vencida al GUARDAR la palabra en el lector; por eso la cola filtra por exposición**

_Por qué:_ scheduleCapturedReview crea newCard() (reps 0, due=ahora) al guardar. La cola no puede decidir solo por vencimiento: exige exposición o reps > 0.

- ✔ src/client/lib/reviews.ts:75 ~ /const card = existing\.card \?\? newCard\(\);/
  - `const card = existing.card ?? newCard();`
- ✔ src/client/lib/fsrs.ts:85 ~ /return createEmptyCard\(now\);/
  - `return createEmptyCard(now);`
- ✔ src/client/lib/fsrs.ts:89 ~ /return !card \|\| new Date\(card\.due\)\.getTime\(\) <= now\.getTime\(\);/
  - `return !card || new Date(card.due).getTime() <= now.getTime();`

### ✔ `C4-primer-reto-es-elegir-entre-cuatro`

**El reto elige un modo que la palabra puede cumplir y corrige con el significado**

_Por qué:_ Una palabra sin oración ya no cae en choose (adivinar al 25 %): pasa al modo significado. Tras responder se muestra forma y significado.

- ✔ src/client/lib/practice.ts:363 ~ /if \(isNew \|\| stability < 2\.5\) \{/
  - `if (isNew || stability < 2.5) {`
- ✔ src/client/components/Vocabulary.tsx:1111 ~ /if \(!isEligible\(ch\.word, mode\)\) \{/
  - `if (!isEligible(ch.word, mode)) {`
- ✔ src/client/components/Vocabulary.tsx:3352 ~ /Toca la palabra que falta\./
  - `<p className="meta">Toca la palabra que falta.</p>`
- ✔ src/client/components/Vocabulary.tsx:3356 ~ /className="nb-card-back" role="status"/
  - `<p className="nb-card-back" role="status">`

### ✔ `C5-estudio-existe-pero-abajo`

**La ficha de presentación es la entrada del héroe; ya no hay bloque enterrado**

_Por qué:_ Se quitó la sección «Por aprender · N» que vivía debajo del héroe: el botón primario hace ese trabajo.

- ✔ src/client/components/Vocabulary.tsx:1-9999 no contiene /aria-label="Palabras por aprender"/
- ✔ src/client/components/Vocabulary.tsx:2079 ~ /onClick=\{\(\) => startLearn\(\)\}/
  - `onClick={() => startLearn()}`

### ✔ `C6-sesion-puede-ensayar-borradas`

**Las lápidas no llegan a la sesión: listSavedWords las filtra antes de que exista dueWords**

_Por qué:_ Buscar «deleted» dentro de dueWords era una ausencia usada como prueba. El filtro real está en la carga y al borrar se quita la fila del estado.

- ✔ src/client/lib/idb.ts:1710 ~ /return all\.filter\(\(word\) => !word\.deleted\);/
  - `return all.filter((word) => !word.deleted);`
- ✔ src/client/components/Vocabulary.tsx:756 ~ /listSavedWords\(/
  - `void listSavedWords(undefined, scope)`

### ✔ `C7-copia-no-dice-cuantas-faltan`

**El botón dice qué hace y con cuántas palabras; no promete minutos**

_Por qué:_ «~2 min» y «1 min» describían la misma sesión. Ahora el botón lleva la cifra real y desaparece la promesa de duración.

- ✔ src/client/components/Vocabulary.tsx:2083 ~ /Aprender \{learnable\.length\}/
  - `Aprender {learnable.length}{" "}`
- ✔ src/client/components/Vocabulary.tsx:2100 ~ /Repasar \{Math\.min\(REVIEW_SESSION_SIZE, reviewWords\.length\)\}/
  - `Repasar {Math.min(REVIEW_SESSION_SIZE, reviewWords.length)}{" "}`
- ✔ src/client/components/Vocabulary.tsx:2051-2106 no contiene /~2 min|1 min/

### ✔ `C8-indice-del-heroe-solo-cuenta-hoy`

**El encabezado separa «por aprender» de «para repasar»**

_Por qué:_ Dos trabajos distintos ya no comparten una sola cifra: la de aprender solo cuenta palabras que pueden entrar a la ficha.

- ✔ src/client/components/Vocabulary.tsx:1883 ~ /por aprender/
  - `learnable.length > 0 ? ` · ${learnable.length} por aprender` : ""`
- ✔ src/client/components/Vocabulary.tsx:1121 ~ /para repasar/
  - `"Estas palabras necesitan una oración o un significado para repasarse.",`

### ✔ `C9-el-rescate-llega-despues-de-fallar`

**La red anti-frustración sigue siendo post-fallo y solo para Nivel 2-3; la corrección nueva está en el modo choose**

_Por qué:_ rescueChallenge solo actúa si el fallo fue en Nivel 2 o 3. Para la palabra nueva (Nivel 1), la corrección es ver forma y significado.

- ✔ src/client/lib/practice.ts:407 ~ /export function rescueChallenge\(/
  - `export function rescueChallenge(`
- ✔ src/client/components/Vocabulary.tsx:3120 ~ /current\.adaptiveChallenge\.level > 1/
  - `if (current.adaptiveChallenge && current.adaptiveChallenge.level > 1) {`

### ✔ `C10-dos-puertas-a-la-misma-sesion`

**Queda una sola puerta a la sesión: el héroe; la de GamePanel sigue muerta**

_Por qué:_ Se quitó «Repaso rápido», que caía a startAdaptiveFlow con otro texto. El CTA adaptive_flow de GamePanel nunca se pinta: el único montaje usa dashboard o ai_workshop.

- ✔ src/client/components/Vocabulary.tsx:2253 ~ /mode=\{workshopOpen \? "ai_workshop" : "dashboard"\}/
  - `mode={workshopOpen ? "ai_workshop" : "dashboard"}`
- ✔ src/client/components/Vocabulary.tsx:2051-2106 no contiene /notebook-quick-review-cta/

### ✔ `X1-la-exposicion-ya-se-persiste`

**La primera exposición vive por cuenta (learnExposure:v1) y viaja con la palabra (presentedAt)**

_Por qué:_ isLearnPending + withExposure arbitran estudio vs repaso y migran de anónimo a cuenta. Además `presentedAt` se guarda en la fila y se sincroniza con `lecta_user_words.presented_at`, así que en otro dispositivo la ficha no se repite antes del primer repaso.

- ✔ src/client/lib/learn.ts:10 ~ /LEARN_EXPOSURE_KEY = "learnExposure:v1"/
  - `export const LEARN_EXPOSURE_KEY = "learnExposure:v1";`
- ✔ src/client/lib/learn.ts:96 ~ /export function isLearnPending\(/
  - `export function isLearnPending(`
- ✔ src/client/lib/learn.ts:104 ~ /exposure\.seen\[word\.key\] \|\| \(word\.presentedAt \?\? 0\) > 0/
  - `if (exposure.seen[word.key] || (word.presentedAt ?? 0) > 0) return false;`

### ✔ `X2-los-modos-ya-estan-gateados-por-datos`

**Los modos declaran qué datos necesitan (isEligible) y la sesión lo respeta**

_Por qué:_ isEligible define qué pide cada modo; startAdaptiveFlow ahora lo consulta antes de armar el ítem.

- ✔ src/client/components/Vocabulary.tsx:428 ~ /const isEligible = \(word: SavedWord, mode: PracticeMode\) => \{/
  - `const isEligible = (word: SavedWord, mode: PracticeMode) => {`
- ✔ src/client/components/Vocabulary.tsx:1111 ~ /if \(!isEligible\(ch\.word, mode\)\) \{/
  - `if (!isEligible(ch.word, mode)) {`

### ✔ `X3-el-primer-paso-del-lector-ya-es-una-ficha`

**La ficha de primera exposición ya tiene UI y voz (learnKeep/learnKnown/learnEnrich) y puente a repaso**

_Por qué:_ El puente estudio→prueba reutiliza esa ficha, sin duplicar un componente nuevo.

- ✔ src/client/components/Vocabulary.tsx:1174 ~ /const startLearn = \(first\?: SavedWord\) => \{/
  - `const startLearn = (first?: SavedWord) => {`
- ✔ src/client/components/Vocabulary.tsx:1230 ~ /const learnKeep = async \(\) => \{/
  - `const learnKeep = async () => {`
- ✔ src/client/components/Vocabulary.tsx:2789 ~ /Repasar esta palabra/
  - `? "Repasar esta palabra"`

### ✔ `C11-cualquier-respuesta-cancela-la-ficha`

**Una palabra con reps 0 solo sale de «Por aprender» con una decisión explícita: la cola la excluye**

_Por qué:_ isLearnPending sigue excluyendo reps > 0, pero ahora reviewQueue exige exposición o reps > 0: una respuesta al azar ya no puede ser la primera exposición de una palabra.

- ✔ src/client/lib/learn.ts:129 ~ /export function reviewQueue\(/
  - `export function reviewQueue(`
- ✔ src/client/lib/learn.ts:105 ~ /if \(\(word\.card\?\.reps \?\? 0\) > 0\) return false;/
  - `if ((word.card?.reps ?? 0) > 0) return false;`

### ✔ `C12-modos-libres-tampoco-examinan`

**Los modos libres (Hueco, Sílabas, Telar) también salen de reviewWords y avisan cuando no hay nada**

_Por qué:_ startPractice usaba dueWords y podía preguntar por palabras nunca presentadas, además de adelantar repasos. Ahora comparte la regla de la sesión y explica por qué los botones están apagados.

- ✔ src/client/components/Vocabulary.tsx:893 ~ /reviewWords/
  - `const reviewWords = reviewQueue(scopedWords, knownKeys, exposure);`
- ✔ src/client/components/Vocabulary.tsx:2127 ~ /disabled=\{reviewWords\.filter\(\(w\) => isEligible\(w, "cloze"\)\)\.length === 0\}/
  - `disabled={reviewWords.filter((w) => isEligible(w, "cloze")).length === 0}`
- ✔ src/client/components/Vocabulary.tsx:2183 ~ /Los modos libres usan palabras que ya viste/
  - `? "Los modos libres usan palabras que ya viste. Aprende primero las nuevas."`

## Preguntas de investigación

Verificar en Crossref con `--online`; la existencia no valida la interpretación.

### R1-recuperacion-antes-que-exposicion

**Pregunta:** ¿Una palabra desconocida se aprende mejor si se le pide recuperarla antes de presentarla, o al revés?

**Cita:** Roediger & Karpicke (2006). *Test-enhanced learning: Taking memory tests improves long-term retention*. Psychological Science.

**Por qué importa:** Es la evidencia que sostiene la Sesión Fluida actual (testear). Su condición: el material YA fue estudiado.

**Qué atacar:** Comprobar si el estudio midió retención sobre material nunca presentado; si no, no aplica a palabras nuevas.

### R2-pretesting

**Pregunta:** ¿Fallar un intento de recuperación antes de estudiar ayuda después? ¿Cuánto y en qué material?

**Cita:** Richland, Kornell & Kao (2009). *The pretesting effect: Do unsuccessful retrieval attempts enhance learning?*. Journal of Experimental Psychology: Applied.

**Por qué importa:** Es el mejor argumento CONTRA el arreglo propuesto (presentar primero). Hay que citarlo, no esquivarlo.

**Qué atacar:** El efecto pretesting se mide en material con pistas ricas (prosa, preguntas). ¿Se replica con pares forma-significado aislados y sin retroalimentación inmediata?

### R3-fallo-con-retroalimentacion

**Pregunta:** ¿La recuperación fallida mejora el aprendizaje solo si hay retroalimentación correctiva inmediata?

**Cita:** Kornell, Hays & Bjork (2009). *Unsuccessful retrieval attempts enhance subsequent learning*. Journal of Experimental Psychology: Learning, Memory, and Cognition.

**Por qué importa:** Si la mejora depende de la corrección inmediata, la sesión actual (fallar → rescate con pista) no capitaliza el fallo: lo tapa.

**Qué atacar:** ¿El rescate de practice.ts:407 muestra la respuesta correcta o solo una pista parcial (prefijo de 2 letras)?

### R4-dificultades-deseables

**Pregunta:** ¿Cuándo una dificultad es «deseable» y cuándo es solo fricción que hace abandonar?

**Cita:** Bjork & Bjork (2011). *Making things hard on yourself, but in a good way: Creating desirable difficulties to enhance learning*. Psychology and the real world (capítulo).

**Por qué importa:** Da el marco para decidir si «que no recuerde nada» es dificultad deseable o fracaso de diseño.

**Qué atacar:** La condición de dificultad deseable es éxito alcanzable y alto; con acierto ~azar (4 opciones) no se cumple.

### R5-repeticiones-para-vocabulario-l2

**Pregunta:** ¿Cuántos encuentros con una palabra hacen falta antes de exigir recuperación productiva?

**Cita:** Webb (2007). *The effects of repetition on vocabulary knowledge*. Applied Linguistics.

**Por qué importa:** Da el orden de magnitud para el umbral de la primera pasada (1 encuentro no basta para reconocimiento con distractores).

**Qué atacar:** No es un estudio de caso: 121 estudiantes japoneses, pseudopalabras en contexto y aprendizaje INCIDENTAL (1, 3, 7 y 10 encuentros; ganancias sustanciales a los 10, conocimiento completo pide más). El «8–12» no aplica a estudio intencional con definición.

### R6-modelo-de-agenda-fsrs

**Pregunta:** ¿Qué predice FSRS exactamente, y qué NO predice?

**Cita:** Ye, Su & Cao (2022). *A Stochastic Shortest Path Algorithm for Optimizing Spaced Repetition Scheduling*. KDD.

**Por qué importa:** FSRS predice recuerdo a partir de logs de repaso. Una tarjeta con reps 0 no tiene log: no hay nada que predecir.

**Qué atacar:** Verificar que el producto no use la estabilidad predicha como si midiera aprendizaje probado.

### R7-carga-cognitiva-y-ejemplos

**Pregunta:** ¿Conviene resolver un problema sin instrucción previa cuando el material es arbitrario (forma-significado)?

**Cita:** Sweller (1988). *Cognitive load during problem solving: Effects on learning*. Cognitive Science.

**Por qué importa:** Para material arbitrario, buscar en el vacío impone carga que no deja traza: apoya presentar antes de exigir.

**Qué atacar:** El contraejemplo es «productive failure» (Kapur, 2008), que funciona con conceptos, no con pares léxicos.

### R8-reconocer-antes-que-recordar

**Pregunta:** ¿Una interfaz debe pedir reconocimiento o recuerdo según lo que el usuario ya sabe?

**Cita:** Nielsen (1994). *10 usability heuristics for user interface design (heurística 6)*. Nielsen Norman Group.

**Por qué importa:** Es la heurística que el héroe del Cuaderno incumple: pide reconocer algo que nunca se mostró.

**Qué atacar:** La heurística es guía, no medición: no sustituye la evidencia experimental (R1–R3).

### R9-generar-error-con-correccion

**Pregunta:** ¿Generar un intento libre y recibir la respuesta correcta de inmediato supera a solo leer, incluso con vocabulario nuevo?

**Cita:** Potts & Shanks (2014). *The benefit of generating errors during learning*. Journal of Experimental Psychology: General.

**Por qué importa:** Es el contraargumento más fuerte a «presentar primero»: generar y fallar con corrección inmediata gana a leer. También es la evidencia que respalda la ficha actual (ver la palabra y el contexto, pensar, «Mostrar significado»).

**Qué atacar:** En el mismo trabajo, ELEGIR entre opciones y fallar no supera a leer. La mecánica de Lecta (4 formas, sin significado y sin corrección del significado) no capitaliza este efecto; la ficha sí puede.

### R10-pretesting-con-y-sin-demora

**Pregunta:** ¿El beneficio de intentar recuperar antes de estudiar depende de que el par tenga relación semántica o de que el estudio venga enseguida?

**Cita:** Grimaldi & Karpicke (2012). *When and why do retrieval attempts enhance subsequent encoding?*. Memory & Cognition.

**Por qué importa:** Delimita el pretesting: ayuda con pares relacionados, no con pares sin relación, y el beneficio desaparece si hay una demora breve entre el intento y el estudio.

**Qué atacar:** Lecta trabaja con pares forma-significado de relación arbitraria y la presentación puede llegar mucho después de la captura: no es la condición donde el pretesting funciona.

### R11-errores-relacionados

**Pregunta:** ¿El error ayuda solo cuando se acerca a la respuesta correcta?

**Cita:** Huelser & Metcalfe (2012). *Making related errors facilitates learning, but learners do not know it*. Memory & Cognition.

**Por qué importa:** Con pares sin relación semántica no hubo beneficio de generar el error. Es la condición típica de una palabra desconocida en otro idioma.

**Qué atacar:** Que el efecto sea nulo en pares aislados no autoriza a examinar sin presentar: solo quita el argumento a favor del pretest y deja la carga de la prueba en quien lo defiende.

### R12-pretesting-y-reconocimiento

**Pregunta:** ¿El pretesting mejora reconocer la respuesta aunque no mejore recordarla con pista?

**Cita:** Seabrooke, Mitchell, Wills, Waters & Hollins (2021). *Pretesting boosts recognition, but not cued recall, of targets from unrelated word pairs*. Psychonomic Bulletin & Review.

**Por qué importa:** Separa dos tipos de memoria: elegir entre 4 mide reconocimiento, no recuerdo. Un beneficio en reconocimiento no justifica presentar el repaso como si midiera saber la palabra.

**Qué atacar:** La sesión actual mide reconocimiento de FORMA en una oración, no significado. Aun con beneficio de reconocimiento, no es lo que el usuario cree que está practicando.

## Encargo por fases

### F0 — Corregir el registro del arnés

**Objetivo:** Que el arnés no confirme afirmaciones falsas ni dé por buenas citas resueltas a otra obra. No toca el producto.

**Archivos:**

- `scripts/audit-cuaderno.mjs (CLAIMS, RESEARCH, PHASES, resolveQuote)`
- `scripts/audit-cuaderno.test.mjs`

**Criterio de aceptación:**

- C6 pasa a contexto y ancla la exclusión en idb.ts:1706
- C10 ancla «Repaso rápido» (Vocabulary.tsx:2028) y la puerta muerta (Vocabulary.tsx:2170)
- resolveQuote consulta el DOI cuando existe y marca DUDOSA si el título no se parece o el año no coincide (±1)
- node scripts/audit-cuaderno.mjs --out /tmp/audit-cuaderno sale 0 sin red

**Riesgo:** Ninguno de producto. Un arnés mal calibrado hace que F5 declare corregido lo que no lo está.

**Puerta:** `pnpm test scripts/audit-cuaderno.test.mjs && node scripts/audit-cuaderno.mjs --out /tmp/audit-cuaderno`

### F1 — Regla: solo se repasa lo que ya se presentó

**Objetivo:** Que la sesión sirva únicamente palabras vencidas que pasaron por la ficha o por un repaso real, ordenadas por vencimiento, sin rama de respaldo y con un modo que la palabra puede cumplir.

**Archivos:**

- `src/client/lib/learn.ts (reviewQueue, isWordKnownBy)`
- `src/client/components/Vocabulary.tsx (startAdaptiveFlow, reviewWords)`

**Criterio de aceptación:**

- reviewQueue excluye lápidas, conocidas, exposición known, reps 0 sin exposición y no vencidas
- reviewQueue ordena por priority y luego por vencimiento ascendente
- una palabra sin context y con significado entra en modo meaning, no en choose
- no queda ninguna rama que llene la cola con palabras no vencidas

**Riesgo:** Quien abría el Cuaderno y siempre encontraba algo para practicar ahora puede ver «Estás al día». Es el comportamiento buscado.

**Puerta:** `pnpm test src/client/lib/learn.test.ts src/client/components/Vocabulary.test.ts && pnpm typecheck && pnpm lint`

### F2 — Héroe con un solo botón principal y cifras separadas

**Objetivo:** Que el botón principal diga qué hace y con cuántas palabras (Aprender / Repasar / Seguir leyendo) y que desaparezcan «Repaso rápido» y el bloque «Por aprender».

**Archivos:**

- `src/client/components/Vocabulary.tsx (nb-hero-cta, título del héroe, notebook-count)`
- `src/client/components/Vocabulary.test.ts`

**Criterio de aceptación:**

- una prueba por rama: aprender, repasar, al día, sin palabras
- en cada rama hay exactamente un .btn--primary dentro de .nb-hero-cta
- el encabezado separa «por aprender» de «para repasar»
- no queda la promesa «~2 min» ni el botón «Repaso rápido» del héroe

**Riesgo:** Cambia el punto de entrada más usado. Hay que conservar el acceso a la práctica con un solo botón y sin duplicarlo.

**Puerta:** `pnpm test src/client/components/Vocabulary.test.ts && pnpm typecheck && pnpm lint`

### F3 — Puente aprender → repasar y salida de la ficha sin significado

**Objetivo:** Que al terminar la ficha se ofrezca repasar las palabras que el usuario quiso aprender, y que una ficha sin significado se pueda pasar.

**Archivos:**

- `src/client/components/Vocabulary.tsx (learn.kept, pantalla de fin, «Pasar por ahora»)`

**Criterio de aceptación:**

- guardar 2 palabras abre una cola de 2 con «Repasar estas 2 palabras»
- con 0 guardadas no aparece el puente
- «Pasar por ahora» avanza sin escribir exposición ni tarjeta

**Riesgo:** La pantalla de fin gana un segundo botón; «Ver el cuaderno» debe quedar como acción secundaria.

**Puerta:** `pnpm test src/client/components/Vocabulary.test.ts && pnpm typecheck && pnpm lint`

### F4 — Corrección con significado en «Elegir palabra»

**Objetivo:** Que tras responder se vea la forma correcta y su significado, y que los distractores sean del mismo idioma que la palabra.

**Archivos:**

- `src/client/components/Vocabulary.tsx (choiceOptions, rama choose)`

**Criterio de aceptación:**

- antes de responder el significado no está en pantalla; después sí
- con palabras de dos idiomas, las 4 opciones son del idioma de la palabra

**Riesgo:** Aparece texto en el modo choose de todos los flujos (sesión, modo libre y juego por fila). Es intencional.

**Puerta:** `pnpm test src/client/components/Vocabulary.test.ts && pnpm typecheck && pnpm lint`

### F5 — Cierre verificado

**Objetivo:** Que el arnés registre los defectos como corregidos y que la puerta completa quede en verde con un recorrido real.

**Archivos:**

- `scripts/audit-cuaderno.mjs (afirmaciones tipo corregido)`
- `docs/auditoria/cuaderno/evidencia.md`
- `docs/auditoria/cuaderno/evidencia.json`

**Criterio de aceptación:**

- pnpm gate en verde con 0 warnings y check:size bajo 215 kB
- el arnés sale 0 y las afirmaciones de defecto quedan como CORREGIDO
- recorrido en navegador anotado: toques y segundos antes y después

**Riesgo:** Ninguno: es la puerta de salida. Si algo falla, no se declara cerrado.

**Puerta:** `pnpm gate && node scripts/audit-cuaderno.mjs`

