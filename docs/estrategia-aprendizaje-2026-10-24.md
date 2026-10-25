# Estrategia de aprendizaje de Lecta — auditoría operativa y evidencia (2026-10-24)

Este documento responde a una pregunta concreta: **¿la estrategia para aprender
de Lecta es buena, y hay mejores maneras —que no hemos visto— de meter al
lector en la aplicación?**

Se hizo leyendo el código operativo (no los planes), trazando qué ve realmente
el lector, y contrastando cada decisión con literatura revisada por pares
(meta-análisis y experimentos; se marca el nivel). Los números de línea son del
árbol al 2026-10-24.

---

## 0. Veredicto en tres frases

1. **El motor es de los mejores que se pueden montar hoy con literatura
   pública**: FSRS-6, Rasch por idioma, selección por utilidad con campana ZPD,
   cloze sobre el contexto real, consolidación al cerrar capítulo. Casi ninguna
   app de lectura comercial llega aquí.
2. **La operación contradice al motor en cinco puntos que el lector sí nota**:
   cobertura medida sobre formas únicas con umbrales inventados (90/75/60),
   preparación de 40 filas antes de cada capítulo, «ya la conocí» tratado como
   prueba, exposición pasiva que se auto-engaña, y XP que paga consultas y
   rareza en vez de recuperación.
3. **Lo que falta no es más motor, es otra palanca**: el reencuentro léxico
   planificado en el texto (que las palabras guardadas *vuelvan* a aparecer),
   la prueba previa en lugar del autoinforme, y una medición de retención a 30
   días. Hoy Lecta mide el aparato, no la lectura.

---

## 1. Qué ve hoy el lector (flujo operativo real)

| Paso | Qué pasa | Dónde vive |
|---|---|---|
| Abrir | Toca el libro en estantería y entra al lector en el mismo gesto (489 ms con red lenta simulada) | `App.tsx` `openStoredBook`, `Shelf.tsx` |
| Calibrar (opcional) | CAT adaptativo de 6–8 ítems con banco logit y prior θ = 4,0; escribe θ en `lecta:user_theta:<lang>:v1` | `Calibration.tsx:28-37`, `calibration.ts:413-556` |
| Antes del capítulo | Hoja automática («auto») con hasta **40 filas** «la conozco / no la conozco», más consulta diferida; salteable | `useReaderChapterPrep.ts:43-61`, `section-words.ts:213-435` |
| Orden de esas filas | Utilidad = P(desconocer) × (1 + 1.4·ln f_cap + 0.6·ln f_libro) × campana ZPD × locución × peso L2 — **bien** | `section-words.ts:108-166` |
| Leer | Scroll por defecto, medida 65 ch, 18 px | `settings.ts:379-382`, `:403` |
| Tocar palabra | Ficha lateral sin navegar (glosa barata, correcto) | `WordPanel.tsx`, `Reader.tsx:4158+` |
| Guardar | Crea tarjeta FSRS con D/S prefijados por origen (`pre_reading` 4.5/2.0, `reader_tap` 5.5/1.0, `repeated_lookup` 7.2/0.4) | `fsrs.ts:10-17` |
| Pasar página | Si el dwell ≥ 160 ms × palabras, **todas** las palabras no tocadas de la página se marcan como vistas; 3 exposiciones → «familiar» | `knowledge.ts:739-779`, `:57-85` |
| Cerrar capítulo | 2–3 ejercicios (cloze del contexto real, scramble, matiz) con calificación FSRS *implícita* por tiempo/errores | `practice.ts:567-649`, `:611-649` |
| Cuaderno | Otro destino: «Por aprender», «Repasar hoy» (ts-fsrs 5.4.2, fuzz), práctica | `Vocabulary.tsx`, `practice.ts:332-445` |
| Medallas | XP por minuto leído, consulta (2), guardada (3 + 4 si rara), repaso; racha ×1.1; logros «guarda 25 palabras raras» | `shared/gamification.ts:85-100`, `:311-312`, `:501` |

Lectura del mapa: el sistema tiene **dos motores de selección** (utilidad para
la hoja de preparación, campana ZPD para el *priming* de 3–5 palabras) y **solo
el primero está conectado**. `selectOptimalChapterPrimingWords` y
`buildChapterPrimingCandidates` (`section-words.ts:714-884`) no tienen
consumidor en producción: solo tests. El componente con mejor respaldo
científico (Cowan 4±1, Vygotsky operacionalizado) es código muerto.

---

## 2. Los ocho hallazgos que sí mueven la aguja

### H1. La insignia de cobertura miente al lector (y se contradice consigo misma)

- Se calcula sobre **formas únicas**: `(known + saved) / total` con
  `total = forms.length` (`knowledge.ts:284-293`).
- Etiquetas con umbrales propios 90/75/60 (`coverage.ts:152-155`).
- Y el rail de Descubre usa **otra** escala para el mismo dato: ≥94 «relajada»,
  ≥86 «ideal» (`catalog.ts:279-300`).
- La literatura mide **tokens**, no tipos: 95 % mínimo y 98 % para lectura
  autónoma (Laufer & Ravenhorst-Kalovski, 2010, *RFL* 22(1);
  Nation, 2006, *CMLR* 63(1)). En español, 90 % de formas únicas puede ser
  ~85 % de tokens: justo por debajo del umbral donde el lector empieza a
  tropezar (`coverage.ts` ya lo advierte en su comentario, pero la UI no).
- Además la cobertura es **promedio del libro**: un libro al 92 % puede tener un
  capítulo al 78 % — y ahí se abandona.

**Qué hacer**: calcular doble métrica (tipos y tokens), etiquetar por tokens con
98/95, mostrar la varianza por capítulo como aviso («este capítulo tiene más
palabras nuevas»), y unificar los dos umbrales en una sola función.

**Evidencia**: Schmitt, Jiang & Grabe (2011, *MLJ* 95(1)) muestran relación
lineal sin umbral abrupto: el número exacto importa menos que *no mentir sobre
él*.

### H2. La preparación de 40 filas es un deber, no un andamio

- `PREPARATION_ROWS_CAP = 40` (`section-words.ts:203`), hoja en modo `auto`
  (`settings.ts:411`), una vez por sección (`useReaderChapterPrep.ts:43-61`).
- La evidencia favorece **ayuda en el punto de necesidad** sobre la
  pre-enseñanza masiva: glosas durante la lectura suben aciertos de 26,6 % a
  45,3 % (inmediato) y de 19,8 % a 33,4 % (diferido) — 42 estudios, N = 3.802
  (Yanagisawa, Webb & Uchihara, 2020, *SSLA*); y la asistencia *durante* supera
  a la previa para comprensión (Webb, 2009, *CMLR*).
- Pre-enseñar 40 palabras antes de un capítulo también choca con memoria de
  trabajo: el código ya conoce a Cowan (3–5) en `MAX_PREVIEW_WORDS`, pero la
  hoja principal no lo respeta.
- La instrucción léxica previa sí mejora comprensión de pasaje… con efecto que
  se desploma en medidas estandarizadas: d = 0,50 vs d = 0,10 (Elleman et al.,
  2009, *J. Research on Educational Effectiveness* 2(1), 1–44) — nivel: moderado-bajo.

**Qué hacer**: la hoja automática muestra **3–5 palabras frontier** (las que el
selector ZPD ya sabe elegir) y el resto queda en «Preparar capítulo» bajo
demanda. El lector que quiere el deber, lo pide; el que quiere leer, lee.

### H3. Dos escalas de θ con el mismo nombre (fallo vivo, no latente)

Conviven **tres** definiciones de dificultad:

| Escala | Fórmula | Quién la usa |
|---|---|---|
| 7 − zipf (0…6) | `wordDifficulty` | `nextChapterUtility` (hoja de preparación), `loadUserTheta` = 7 − umbral ≈ 4, banco editorial antiguo (b 3,2–5,0) |
| 4 − zipf (−3…+3,5) | `betaFromZipf` | `updateThetaForLanguageSignal`, `updateLanguageTheta`, `estimateWordKnowProbability`, selector ZPD huérfano |
| logit (−2,1…+2,25) | ítems del CAT | `CALIBRATION_BANK_ITEMS_ES`, con prior θ = 4,0 (`CALIBRATION_PRIOR_THETA`) |

Las tres escriben o leen **la misma llave** `lecta:user_theta:<lang>:v1`:
`persistCatCompletion` (θ del CAT, en logit) y `skipLanguageCalibration`
(0,0) llaman a `saveUserTheta` (`calibration.ts:540-556`, `:596-612`), y la hoja
de preparación la lee con `loadUserTheta()`
(`useReaderChapterPrep.ts:199-207`) para alimentar una utilidad que calcula
β = 7 − zipf.

Consecuencia medida (sonda `theta-escalas` del arnés de auditoría): con θ = 4
la campana ZPD apunta a zipf ≈ 2,4 (palabras raras); con θ = 1 —valor dentro
del rango que produce el CAT— apunta a zipf ≈ 5,4 (palabras corrientes). El
mismo lector recibe dos listas distintas antes y después de calibrar, y
ninguna de las dos sabe de la otra. Con β = 4 − zipf y θ = 4, el selector
huérfano devuelve **0 candidatas** (peso máximo de la campana 0,03, por debajo
del umbral 0,22).

A eso se suma que el prior del CAT (4,0) cae fuera del rango de su propio banco
logit (−2,1…+2,25): en el primer ítem P(conocer) ≈ 0,996 y la información de
Fisher va de 0,008 a 0,17, así que el examen arranca casi sin información.

**Qué hacer**: una sola escala (logit), migrar `nextChapterUtility` a
`betaFromZipf`, poner el prior del CAT en 0,0 con σ 0,8 y añadir un test que
falle si alguien vuelve a mezclar escalas. Sin eso, Track 6 (priming
adaptativo) selecciona al azar disfrazado en cuanto se conecte.

### H4. «Ya la conozco» es un juicio, no una prueba — y se usa como verdad

- `onMarkKnown` → `updateLanguageTheta(lang, β, 1, 1.0)`, delta = 0,18 × (1 −
  P) (`profile-models.ts:454-456`; `Reader.tsx:4158-4170`).
- Los juicios de aprendizaje son sistemáticamente **sobreconfiados**, sobre todo
  tras releer (Koriat & Bjork, 2005, *JEP:LMC* 31(2); nivel: experimental
  replicado).
- Reconocer no es saber: la puntuación cae al pasar de reconocimiento pasivo a
  recuerdo activo (Laufer & Goldstein, 2004, *Language Learning* 54(3)); y los
  formatos de reconocimiento apenas predicen uso real (Kremmel & Schmitt, 2016).

**Qué hacer**: en las 3–5 palabras frontier, **pretest** de 10 segundos
(elegir entre 3glosas) antes de revelar. Fallar no daña si hay feedback
(Kornell, Hays & Bjork, 2009, *JEP:LMC* 35(4)); y el intento previo mejora la
retención posterior aunque salga mal (Richland, Kornell & Kao, 2009,
*JEP:Applied* 15(3)). Beneficio doble: mide de verdad y arregla el sesgo del
autoinforme.

### H5. La exposición pasiva se auto-engaña

`processPageTurnForPassiveKnowledge` marca **todas** las palabras no tocadas de
la página como vistas si el dwell supera `palabras × 160 ms` (tope 12 s), y a
las 3 exposiciones la palabra pasa a «familiar» y **deja de aparecer** en la
predicción (`knowledge.ts:57-85`, `:739-779`).

La adquisición incidental real por exposición es 5–15 % (Nagy, Herman &
Anderson, 1985) y en lectura extensiva se necesitan **8–12 encuentros** para el
significado; con menos de 8 no se retuvo ninguna palabra en el estudio de
Waring & Takaki (2003, *RFL* 15(2)). Marcar «familiar» tras tres pasadas de
página es una promesa que la evidencia no sostiene — y el fallo es silencioso:
el lector recibe *menos* ayuda y no sabe por qué.

**Qué hacer**: «familiar» solo con recuperación exitosa o con 8+ exposiciones
repartidas en ≥3 sesiones distintas; el dwell de página no crea evidencia, solo
cuenta exposición (métrica útil para el recomendador de H6).

### H6. El motor de repaso está bien elegido y mal inicializado

- FSRS-6 es la mejor opción pública: log loss 0,346 vs 0,368 (DASH) y 0,469
  (HLR) en el benchmark abierto (9.999 colecciones, 349,9 M repasos); el paper
  original reporta +12,6 % de mejora en coste de memorización (Ye, Su & Cao,
  2022, KDD). Nivel: benchmark sobre logs — predice recuerdo, no demuestra
  aprendizaje; el único dato con nota final es +16,5 % de retención frente a
  estudio masivo (Lindsey et al., 2014, *Psych. Science* 25(3)).
- Pero: D/S **se fijan a mano** por origen de captura en vez de venir de la
  primera calificación (`fsrs.ts:10-17`), y el multiplicador episódico
  (×1,2 / ×1,35) **infla estabilidad después** del cálculo del scheduler
  (`fsrs.ts:25-43`), lo que alarga intervalos sin que el modelo lo haya pedido.
- La calificación implícita usa tiempo por carácter: `≤ 650 ms/carácter` ⇒ *Easy*
  (`practice.ts:590`). El tiempo es proxy débil de dominio; y *Easy* es la
  calificación que más dispara el intervalo.
- No hay **horizonte declarado**: el intervalo óptimo escala con el retraso del
  examen (20–40 % del horizonte a una semana, 5–10 % a un año; Cepeda et al.,
  2008, *Psych. Science* 19(11)), y FSRS trabaja con `request_retention`
  implícito ~0,9.

**Qué hacer**: inicializar la tarjeta con la primera calificación real (el
pretest de H4 la produce gratis), eliminar el multiplicador episódico o
convertirlo en `desired_retention` más bajo, y declarar el horizonte del lector
(«quiero recordar estas palabras en 6 meses» ⇒ retención 0,9 y repasos más
separados que para un examen).

### H7. La gamificación paga el proxy, no el aprendizaje

- XP por **consulta** (2) y por **guardar** (3 + 4 si la palabra es rara,
  `RARE_ZIPF_BELOW = 3,0`); logros «Cazarraras: guarda 5 palabras raras»,
  «Ojo de filólogo: 25» (`shared/gamification.ts:85-100`, `:311-312`).
- Efecto: el sistema paga consultar y coleccionar palabras oscuras — las menos
  útiles para leer — y no paga recuperar ni terminar un capítulo.
- La evidencia: las recompensas tangibles esperadas y contingentes **erosionan**
  la motivación intrínseca (d ≈ −0,40; Deci, Koestner & Ryan, 1999, *Psych.
  Bull.* 125(6)); la regulación externa no predice persistencia y predice peor
  bienestar (Howard et al., 2021, *Perspect. Psychol. Sci.*); y la gamificación
  da efectos pequeños con decaimiento por novedad (g = 0,25 conductual / 0,36
  motivacional / 0,49 cognitivo; Sailer & Homner, 2020, *Educ. Psychol. Rev.*).
- Lo que sí funciona en la misma familia: racha atada a **una acción mínima**
  (+3,3 % de retención D14 en el A/B de Duolingo, 2020), escudo (ya existe:
  `gap === 2 && streak ≥ 3`, `shared/gamification.ts:524`), meta de proceso
  semanal, y monitoreo del progreso que **se consulta y se comparte**
  (d = 0,40; Harkin et al., 2016, *Psych. Bull.*).

**Qué hacer**: XP por capítulo terminado y por recuperación exitosa en repaso
espaciado; retirar el bonus por rareza (o invertirlo a utilidad: frecuencia ×
frontera); la racha cuenta si hubo ≥1 página o ≥60 s (ya está cerca) y el
escudo se muestra en vez de esconderse.

### H8. Nadie mide si se aprende

- El producto mide consultas, guardados, repasos, minutos, WPM, cobertura.
  **Ninguna** de esas cosas es retención ni comprensión.
- El propio `docs/concentracion-y-lectura.md` §4 lo declara: «Lo que Lecta NO
  mide: comprensión».
- La palanca con mejor evidencia para cerrar eso es barata: recuperación con
  feedback (g ≈ 0,50 en 159 efectos; Rowland, 2014, *Psych. Bull.* 140(6);
  g ≈ 0,61 con feedback; Adesope et al., 2017, *RER* 87(3)).

**Qué hacer**: dos instrumentos, ambos opcionales y de un toque:
1. **Pregunta de inferencia al cerrar capítulo** (1 de cada 3 capítulos, 1
   toque, sin bloquear): mide comprensión y entrena metacognición.
2. **Chequeo de 60 segundos a los 30 días**: 10 cloze muestreados de lo
   aprendido, con retraso ≥30 días. Eso produce la curva de retención propia —
   el dato que hoy no tiene ninguna app de lectura en español y que permite
   ajustar `request_retention` con evidencia en vez de con intuición.

---

## 3. Lo que no hemos visto: seis maneras de meter al lector en la app

Ordenadas por *fuerza de evidencia × ajuste a lo que Lecta ya tiene*. Ninguna
exige infraestructura nueva de datos.

### M1. Reencuentro léxico planificado (la palanca que falta)

**Idea**: recomendar y ordenar libros por **cuántas palabras del cuaderno
reaparecen** en ellos. «Este libro repite 14 palabras que estás aprendiendo»;
«el siguiente de la serie repite 23».

**Por qué**: el cuello de botella del vocabulario no es el repaso, es el número
de encuentros en contexto (8–12; Pigada & Schmitt, 2006, *RFL* 18(1); Waring &
Takaki, 2003). Leer el mismo dominio léxico (*narrow reading*) es el mecanismo
más eficiente que existe para producirlos: para cubrir el segundo millar hacen
falta ~200 k tokens ≈ 2 novelas (Nation, 2014, *RFL* 26(2)).

**Cómo**: el manifiesto de cobertura ya existe por libro; añadir un índice de
lemas por libro (o un filtro Aho-Corasick en el cliente sobre los EPUB propios)
y una puntuación `reencuentros = Σ peso(palabra) × apariciones`. Va en
`DiscoverRail.tsx` y en el cierre de libro («tu próxima lectura»).

**Efecto esperado**: sube encuentros por hora sin pedirle al lector ni un
minuto extra.

### M2. Repaso en el texto (spacing + retrieval + contexto variable)

**Idea**: al cargar las próximas N secciones, detectar palabras **vencidas** de
FSRS y, en el siguiente *breakpoint* natural (fin de sección), ofrecer un
micro-cloze de 1 toque con la oración real de ese capítulo.

**Por qué**: el repaso hoy vive en el Cuaderno, que es otro destino: el
principio «1 toque» se rompe justo en la frontera del lector. Mover la
recuperación al texto junta espaciamiento, recuperación y variabilidad de
contexto — las tres palancas con evidencia (Cepeda 2006; Rowland 2014;
Laufer & Hulshoff 2001 sobre carga de implicación).

**Cómo**: `practice.ts` ya tiene cloze contextual y `buildPostChapterConsolidationQueue`;
falta el disparador por vencimiento y la inserción en el *breakpoint*
(`ReaderFloatingLane`, sin interrumpir a media línea).

### M3. Lectura con audio de ritmo controlado (y modo manos libres)

**Idea**: TTS + resaltado con velocidad 120–180 wpm y control por frase; modo
audio para trayectos (la lectura sigue sola, la pantalla se apaga).

**Por qué**: la lectura bimodal tiene efecto pequeño en promedio (g = 0,18;
30 estudios, N = 1.945) pero **se triplica cuando el audio marca el ritmo**
(g = 0,41) y desaparece cuando lo marca el lector (g = 0,06 ns)
(Clinton-Lisell, 2023, preprint OSF). Y por encima de ~200 wpm la comprensión
de intermedios se deteriora (Griffiths, 1992, *TESOL Quarterly* 26(2)). Es, además, la función de
accesibilidad con mejor respaldo y no usa el riel de IA.

**Cómo**: existe `kittenTtsEngine`/`useReaderTts`; falta la velocidad como eje
de primera clase y el modo audio continuo con *pre-síntesis* ya prevista.

### M4. Contrato «si–entonces» + recordatorio en la hora elegida

**Idea**: al terminar el primer capítulo, un pacto de 7 días: «si son las 21:30
y estoy en casa, abro Lecta y leo una página». Recordatorio en esa hora.

**Por qué**: las intenciones de implementación son la intervención conductual
con mejor relación efecto/coste: d = 0,65 (94 estudios, N ≈ 8.461;
Gollwitzer & Sheeran, 2006); los recordatorios duplican la odds de adherencia
(OR 2,11; 16 ECA; Thakkar et al., 2016, *JAMA Intern Med*). La formación de
hábito tarda ~66 días de mediana con alta varianza y **fallar un día no la
rompe** (Lally et al., 2010, *EJSP* 40(6)).

**Ojo de infraestructura**: hoy no hay push (no existe `pushManager` en el
cliente). Se puede empezar con tarjeta in-app al abrir + export `.ics` al
calendario; el push queda para cuando haya service worker de notificaciones.

### M5. Progreso que se comparte (sin ranking)

**Idea**: al cerrar la semana, una tira («Esta semana: 4 días, 62 páginas, 9
palabras nuevas, 3 capítulos») compartible, y la opción de mandarla a alguien.

**Por qué**: el monitoreo del progreso mejora el logro con d = 0,40 (138
estudios, N = 19.951) y el efecto se amplifica cuando el avance **se registra y
se hace público** (Harkin et al., 2016). Es también la única vía barata a la
tercera necesidad de la autodeterminación (relación), que hoy no existe: el gato
acompaña, pero no hay nadie más. Los clubes de lectura no tienen meta-análisis
—trátese como hipótesis a medir— y el ranking no está respaldado.

**Cómo**: `QuoteCardModal` ya genera una tarjeta; la tira semanal es el mismo
riel.

### M6. Reenganche con reinicio semanal

**Idea**: el lunes, una tarjeta de reinicio («empezamos de nuevo, 1 página») y
un «quiero/debo» con caducidad: el audiolibro de una novela ligera solo se
desbloquea en el trayecto.

**Por qué**: el «fresh start» reactiva conducta aspiracional (Dai, Milkman &
Riis, 2014) y la asistencia decae ~21 % del lunes al viernes: el reinicio sirve
para reenganchar, no para sostener (hay que re-anclar cada semana). El
*temptation bundling* sube la conducta deseada (+51 % en visitas al gimnasio con
acceso solo-gym al audiolibro) y **decae** al caducar el experimento (Milkman,
Minson & Volpp, 2014).

---

## 4. Ajustes de una línea con respaldo (no requieren diseño)

| Cambio | De | A | Evidencia |
|---|---|---|---|
| Layout por defecto | `scroll` (`settings.ts:382`) | `pages` en móvil, scroll opcional | Delgado et al. 2018, *Educ. Res. Rev.* 25: g = −0,21 papel>pantalla, con el scroll como moderador; paginar mejora comprensión integrada (Haverkamp et al., 2023) y el scroll castiga a baja memoria de trabajo (Sanchez & Wiley, 2009) |
| Medida de línea | 65 ch | 55–65 ch por defecto | velocidad máxima ~55 ch; comprensión casi plana (Dyson & Haselgrove, 2001) |
| Pausas | aviso de fatiga por retrocesos (heurística propia) | ofrecer pausa de 5–10 min cada 25–30 y «volver en 30 min» con marcador | micro-descansos d = 0,36 vigor / 0,35 fatiga (Albulescu et al., 2022, *PLOS ONE*) |
| Métrica de éxito | consultas, guardados, minutos | retención a 30 días, capítulos terminados, D7/D14 | Rowland 2014; Harkin 2016 |
| Meta semanal | días leídos | días **y** minutos de proceso, nunca «libros/año» | Locke & Latham, 2002; metas de resultado distal degradan estrategia (Seijts & Latham) |

---

## 5. Qué NO hacer

- **No gamificar velocidad.** El WPM es diagnóstico; leer rápido sacrifica
  comprensión (Rayner et al., 2016, *PSPI*). No hay medalla por WPM.
- **No inflar la cobertura** para que la insignia se vea bonita: el lector
  abandona el capítulo difícil y la app queda mal calibrada para siempre.
- **No interrumpir a media línea.** Toda intervención va en *breakpoint* (fin de
  sección, cierre de hoja, pausa). El costo de interrumpir no es el reenfoque
  mítico de 23 min, es que fragmenta el resto de la sesión.
- **No usar IA para juzgar fatiga ni para calificar palabras.** FSRS no se
  toca; las reglas locales bastan y son auditables.
- **No añadir otra capa flotante.** Ya hay franja única; el siguiente aviso que
  se sume debe reemplazar, no apilar.

---

## 6. Plan por impacto (sin tocar producción)

**P0 — corrige lo que el lector ya nota (1–2 semanas)**
1. Un solo sistema de cobertura: tipos **y** tokens, umbrales 98/95, una
   etiqueta (`coverage.ts` + `catalog.ts`).
2. Hoja automática de 3–5 palabras (selector ZPD existente) y 40 filas bajo
   demanda.
3. Pretest de 3 glosas en lugar de «¿la conoces?» en esas 3–5.
4. Unificar la escala θ (`β = 4 − zipf`) o congelar Track 6 hasta unificarla.
5. XP: quitar consulta y rareza; pagar capítulo y recuperación.
6. Layout paginado por defecto en móvil.

**P1 — palancas nuevas (2–6 semanas)**
7. Reencuentro léxico (M1) en Descubre y al cerrar libro.
8. Repaso en el texto (M2) con las palabras vencidas de las próximas secciones.
9. Chequeo de retención a 30 días + pregunta de inferencia por capítulo (H8).
10. Contrato si–entonces (M4) con tarjeta in-app y `.ics`.

**P2 — profundidad**
11. Audio de ritmo controlado y modo manos libres (M3).
12. Tira semanal compartible y reinicio semanal (M5, M6).
13. Retirar el multiplicador episódico y declarar horizonte de retención (H6).

### Instrumentación mínima para saber si funcionó

`retention_30d`, `chapters_completed / chapters_started`,
`time_to_first_word`, `consults_per_1000_words`, `reencuentros_por_palabra`,
`D7` y `D14`, `% sesiones < 5 min`, `% preparaciones salteadas`. Nada de esto
existe hoy y todo sale de datos que ya se guardan (`reading-events.ts`).

---

## 7. Respuesta directa a la pregunta

**¿Es buena la estrategia para aprender?** Sí, en el motor: FSRS + Rasch +
selección por utilidad + cloze contextual es mejor que lo que hace la mayoría
del mercado, y está por encima de lo que la evidencia exige. No, en la
operación: mide el aparato en vez de la lectura, pone el deber antes del texto,
se auto-engaña con la exposición pasiva y paga con XP justo las conductas que
no aprende nadie.

**¿Hay mejores maneras de poner al lector en la aplicación?** Sí, y no son de
gamificación: son de **reencuentro** (que sus palabras vuelvan en el siguiente
libro), de **texto** (glosa y repaso dentro de la página, no en otra pestaña),
de **ritual** (si–entonces + hora fija + reinicio semanal) y de **prueba**
(pretest antes, retención a 30 días después). La app ya tiene el 80 % de las
piezas; lo que falta es conectarlas en el orden en que el lector las vive.

---

## 8. Cómo se audita este documento

Nada de lo anterior pide confianza. El registro `docs/auditoria/claims.json`
convierte las afirmaciones en comprobaciones ejecutables: cita textual en este
documento, anclaje `archivo:línea` con patrón, sonda que observa valores reales
y referencia con DOI contrastado contra Crossref.

```bash
node scripts/audit-investigacion.mjs            # sin red: código + forma de las citas
node scripts/audit-investigacion.mjs --online   # además resuelve DOI y URLs
node scripts/audit-investigacion.mjs --pack artifacts/auditoria/pack
```

Estado de la última corrida (2026-10-24): **14/14 afirmaciones con anclajes y
sondas en verde, 32 referencias verificadas, 0 refutadas**. El encargo para una
IA auditora independiente está en `docs/auditoria/PROMPT-AUDITOR.md` y las
reglas del arnés en `docs/auditoria/README.md`.

Dos advertencias que el arnés no puede resolver y el auditor sí:

- los números de la campana ZPD (zipf ≈ 2,4 con θ = 4; ≈ 5,4 con θ = 1) son
  aritmética sobre la fórmula declarada en `section-words.ts`, no ejecución del
  binario;
- «no se mide comprensión» es una afirmación de ausencia: se comprueba por
  identificadores, y un módulo podría medirlo con otro nombre.
