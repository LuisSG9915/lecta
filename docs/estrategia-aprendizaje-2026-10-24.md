# Estrategia de aprendizaje de Lecta — estado real y evidencia (2026-10-26)

Este documento responde a una pregunta concreta: **¿la estrategia para aprender
de Lecta es buena, y hay mejores maneras de meter al lector en la aplicación?**

Se escribió leyendo el código que la app ejecuta de verdad —no el que solo existe
en un módulo— y contrastando cada decisión con literatura revisada por pares. Los
números de línea son del árbol al 2026-10-26. El registro verificable de cada
afirmación vive en `docs/auditoria/claims.json` y se reproduce con
`node scripts/audit-investigacion.mjs`.

---

## 0. Veredicto en cuatro frases

1. **El motor está bien elegido**: FSRS-6 para el repaso, Rasch por idioma para
   el nivel, utilidad con zona de desarrollo próximo para elegir qué preparar y
   cloze sobre el contexto real para recuperar.
2. **El circuito ya está cerrado de punta a punta**: guardar crea la tarjeta,
   leer produce evidencia, consultar y marcar «ya la conozco» ajustan el nivel,
   y resolver el reto de fin de capítulo **avanza la tarjeta en FSRS** en modo
   scroll y en modo páginas.
3. **Lo que se corrigió en esta ronda**: una sola escala de θ, una sola escala de
   umbrales de cobertura, XP que ya no se puede farmear, autoinforme que no paga
   como repaso, exposición pasiva acotada y sin revivir borrados, y retiro del
   código muerto que duplicaba decisiones.
4. **Lo que sigue faltando**: una medida objetiva de comprensión (hoy solo hay
   autoevaluación de un toque al cerrar cada capítulo) y la curva de retención
   propia con datos reales de lectores. El reencuentro léxico ya ordena Descubre;
   falta ponderarlo por apariciones.

---

## 1. Qué ve hoy el lector (flujo operativo real)

| Paso | Qué pasa | Dónde vive |
|---|---|---|
| Abrir | Toca el libro en la estantería y entra al lector en el mismo gesto | `App.tsx` `openStoredBook`, `Shelf.tsx` |
| Calibrar (opcional) | CAT adaptativo de 6–8 ítems con banco logit; arranca en θ = 0,0 y escribe θ en `lecta:user_language_profile:v1` | `Calibration.tsx:29`, `calibration.ts:400-470` |
| Antes del capítulo | Aviso no intrusivo («N palabras clave en este capítulo»); la hoja se abre solo si el lector la pide y ofrece hasta **40 filas** y 3 cartas rápidas | `useReaderChapterPrep.ts:365-411`, `section-words.ts:201` |
| Orden de esas filas | Utilidad = P(desconocer) × (1 + 1.4·ln f_cap + 0.6·ln f_libro) × zona i+1 × locución × peso L2, en la escala 4 − zipf | `section-words.ts:106-160` |
| Leer | Scroll por defecto, medida 65 ch, 18 px | `settings.ts:379-382`, `:403` |
| Tocar palabra | Ficha lateral sin navegar; glosa barata | `WordPanel.tsx`, `Reader.tsx:4140+` |
| Guardar | Crea una tarjeta FSRS vacía (la primera calificación real la fija) y la deja en el Cuaderno | `fsrs.ts:16-20`, `reviews.ts:60-84` |
| Reencontrar | La ficha muestra la etapa real: «En práctica», «Asentada» o «Dominada» | `WordPanel.tsx:546-560` |
| Pasar página | La exposición pasiva registra hasta 8 lemas no consultados, con dwell proporcional y por debajo de 450 ppm; no revive palabras borradas | `reader-evidence.ts:184-250`, `idb.ts:2069-2078` |
| Cerrar capítulo | Reto de 2–3 ejercicios (cloze del contexto real, scramble, matiz); cada uno resuelto **consolida la palabra en FSRS (Good)** y registra un repaso | `DeepReadingSummaryModal.tsx:122-145`, `reviews.ts:86-160` |
| Cuaderno | «Por aprender», «Repasar hoy» y práctica con ts-fsrs 5.4.2; un ejercicio, un evento de repaso | `Vocabulary.tsx`, `practice.ts:520-640` |
| Medallas | XP por minuto leído, consulta (2, una vez por palabra al día), guardada (3 + 4 si es rara), repaso; racha ×1.1 | `shared/gamification.ts:85-100`, `:555-575` |

Lectura del mapa: hay **una sola vía de selección** para la preparación, **una
sola escala de nivel** y **una sola fuente de verdad de la tarjeta**. Antes había
dos motores de selección y tres escalas de θ; el segundo motor y el código muerto
se retiraron en lugar de conectarse, porque no tenían consumidor y duplicaban una
decisión ya tomada: section-words.ts quedó sin selectores duplicados.

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
  código ya conoce a Cowan (3–5) en `MAX_PREVIEW_WORDS` (`section-words.ts:506`).

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

### H4. «Ya la conozco» es un juicio, no una prueba

- `onMarkKnown` → `updateLanguageTheta(lang, β, 1, 1.0)`, delta = 0,18 × (1 − P)
  (`profile-models.ts:405-415`; `Reader.tsx:4165-4178`).
- El acto se registra en el historial **sin pagar XP de repaso** y ajusta θ una
  sola vez con la dificultad real de la palabra (`WordPanel.tsx:521-535`).
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

`checkPassiveExposure` (`reader-evidence.ts:184-250`) registra **hasta 8 lemas
no consultados** por paso de página válido, exige dwell proporcional
(`palabras × 160 ms`, con suelo de 3 s) y una velocidad menor a 450 ppm. A las 3
exposiciones la palabra pasa a «familiar» **dentro de la sesión**; al recargar,
la evidencia inferida sin respaldo se descarta (`isCredibleKnowledge`) y una
lámina borrada nunca revive (`idb.ts:2069-2078`).

La adquisición incidental real por exposición es 5–15 % (Nagy, Herman &
Anderson, 1985, *RRQ* 20(2)), y en lectura extensiva hacen falta muchos
encuentros para el significado; con menos de 8 no se retuvo ninguna palabra en el
estudio de Waring & Takaki (2003, *RFL* 15(2)). Marcar «familiar» tras tres
pasadas de página es una promesa que la evidencia no sostiene, por eso ahora la
exposición **no escribe evidencia permanente** ni compite con lo que el lector
declaró.

**Qué hacer**: usar la exposición solo como métrica de recomendación
(«esta palabra ya te rodeó tres veces») y no como conocimiento.

### H6. Tarjetas limpias y consolidación conectada

- **Tarjetas limpias y consolidación conectada**: la tarjeta nace vacía y la
  primera calificación real fija dificultad y estabilidad (`fsrs.ts:1-28`). Los
  parámetros por origen de captura y el multiplicador episódico se retiraron:
  inflaban intervalos sin que el modelo lo pidiera.
- Resolver el reto de cierre **consolida de verdad**: `consolidateEpisodicWord`
  avanza la tarjeta con `Rating.Good`, la incorpora al Cuaderno si venía de una
  consulta o de la preparación, y registra **un solo** repaso
  (`reviews.ts:86-160`).
- El cierre de capítulo ocurre igual en modo scroll y en modo páginas: el enlace
  «Siguiente» al final del texto llama a `completeChapterTo`
  (`useReaderNavigation.ts:201-270`).
- FSRS-6 es la mejor opción pública: log loss 0,346 vs 0,368 (DASH) y 0,469
  (HLR) en el benchmark abierto de la comunidad (9.999 colecciones, 349,9 M
  repasos; es un benchmark sobre *logs*, sin arbitraje). El paper de SSP-MMC
  reporta +12,6 % de ahorro de repasos en simulación (Ye, Su & Cao, 2022, KDD).
  Nivel: predice recuerdo, no demuestra aprendizaje; el único dato con nota final
  es +16,5 % de retención frente a estudio masivo (Lindsey et al., 2014,
  *Psych. Science* 25(3)).
- **Sin calificación implícita por velocidad**: la regla «≤ 650 ms/carácter ⇒
  Easy» se retiró. El tiempo es proxy débil de dominio y *Easy* es la
  calificación que más dispara el intervalo.
- Antes no había **horizonte declarado**: FSRS trabajaba con `request_retention`
  implícito ~0,9, y el intervalo óptimo escala con el retraso del examen (20–40 %
  del horizonte a una semana, 5–10 % a un año; Cepeda et al., 2008, *Psych.
  Science* 19(11)).

**Hecho**: el Cuaderno ofrece «Ritmo de repaso» con tres niveles (Fluido 85 %,
Equilibrado 90 %, Firme 93 %) que fijan `request_retention`. Falta ajustarlo con
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
frontera).

### H8. Nadie mide si se aprende

- El producto mide consultas, guardados, repasos, minutos, WPM y cobertura.
  **Ninguna** de esas cosas es comprensión.
- La retención del vocabulario ya se mide: `computeRetentionSummary`
  (`journey.ts`) calcula la tasa de acierto sobre los repasos verificados y
  cuántas palabras tienen estabilidad de 7 y 30 días; «Tu
  recorrido» lo muestra junto a las etapas, y el Cuaderno ofrece un «Chequeo 30
  días» de un minuto sobre las palabras asentadas con 30 o más días desde su último repaso.
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

**Hecho**: el conteo ya es por lema (`coverageOfBook`), y Descubre ordena los
libros en tu nivel por reencuentros antes que por cobertura (`compareBookCoverages`).

**Siguiente paso**: ponderar por apariciones (`reencuentros = Σ peso(palabra) ×
apariciones`), con un índice de lemas por libro o un filtro Aho-Corasick sobre los
EPUB propios.

### M2. Repaso en el texto (spacing + retrieval + contexto variable)

**Idea**: al cargar las próximas N secciones, detectar palabras **vencidas** de
FSRS y, en el siguiente *breakpoint* natural (fin de sección), ofrecer un
micro-cloze de 1 toque con la oración real de ese capítulo.

**Por qué**: el repaso hoy vive en el Cuaderno, que es otro destino: el
principio «1 toque» se rompe justo en la frontera del lector. Mover la
recuperación al texto junta espaciamiento, recuperación y variabilidad de
contexto — las tres palancas con evidencia (Cepeda 2006; Rowland 2014; Laufer &
Hulstijn 2001 sobre carga de implicación).

**Hecho en el cierre**: `buildPostChapterConsolidationQueue` prioriza las palabras
del Cuaderno que reaparecen en el capítulo (`notebook-reencounter`), sin duplicar
lemas. Ese criterio es de reencuentro, no de vencimiento FSRS.

**Pendiente**: el disparador por vencimiento en el *breakpoint* del texto
(`ReaderFloatingLane`, sin interrumpir a media línea).

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

---

## 4. Ajustes de una línea con respaldo (no requieren diseño)

| Cambio | De | A | Evidencia |
|---|---|---|---|
| Métrica de éxito | consultas, guardados, minutos | retención a 30 días, capítulos terminados, D7/D14 | Rowland 2014; Harkin 2016 |
| Meta semanal | días leídos | días **y** minutos de proceso, nunca «libros/año» | Locke & Latham, 2002 |
| Pausas | aviso de fatiga por retrocesos | ofrecer pausa de 5–10 min cada 25–30 y «volver en 30 min» con marcador | micro-descansos d = 0,36 vigor / 0,35 fatiga (Albulescu et al., 2022, *PLOS ONE*) |
| Medida de línea | 65 ch | 55–65 ch por defecto | 55 cpl da mejor comprensión que 100 cpl (Dyson & Haselgrove, 2001) |
| Layout por defecto | `scroll` (`settings.ts:382`) | `scroll` en narrativa; paginar como opción | En Delgado et al. (2018) el scroll no es moderador y no hay ventaja del papel en textos narrativos; Haverkamp (2022) encuentra ventaja de paginar en textos informativos |

---

## 5. Qué NO hacer

- **No gamificar velocidad.** El WPM es diagnóstico; leer rápido sacrifica
  comprensión (Rayner et al., 2016, *PSPI*). No hay medalla por WPM.
- **No inflar la cobertura** para que la insignia se vea bonita: el lector
  abandona el capítulo difícil y la app queda mal calibrada.
- **No interrumpir a media línea.** Toda intervención va en *breakpoint*.
- **No usar IA para juzgar fatiga ni para calificar palabras.** FSRS no se toca;
  las reglas locales bastan y son auditables.
- **No añadir otra capa flotante.** Ya hay franja única; el siguiente aviso
  debe reemplazar, no apilar.
- **No conectar código muerto solo porque existe.** Un módulo con pruebas y sin
  consumidor no es una función del producto: o se conecta con una prueba de uso
  real, o se retira.

---

## 6. Plan por impacto (sin tocar producción)

**P0 — lo que el lector ya nota**
1. Cobertura por tokens como métrica interna y aviso de capítulo difícil.
2. Micro-cloze opcional en lugar de «¿la conoces?» en las 3–5 palabras frontera.
3. XP por capítulo terminado y por recuperación exitosa; retirar el bonus por
   rareza.

**P1 — palancas nuevas**
4. Repaso en el texto (M2): el cierre ya usa las palabras del Cuaderno que reaparecen; falta el disparador en el *breakpoint*.
5. Chequeo de retención a 30 días (hecho, con 30 días de retraso) y autoevaluación del hilo al cerrar capítulo (hechos); la medida objetiva de comprensión queda pospuesta hasta tener datos de uso (H8).
6. Contrato si–entonces (M4) con tarjeta in-app.
7. Reencuentro léxico ordenado por apariciones (M1).

**P2 — profundidad**
8. Audio de ritmo controlado y modo manos libres (M3).
9. Tira semanal compartible (M5).
10. Horizonte de retención declarado y ajuste de `request_retention`.

### Instrumentación mínima para saber si funcionó

`retention_30d`, `chapters_completed / chapters_started`,
`time_to_first_word`, `consults_per_1000_words`, `reencuentros_por_palabra`,
`D7` y `D14`, `% sesiones < 5 min`, `% preparaciones salteadas`. Casi todo sale
de datos que ya se guardan (`reading-events.ts`, `reviews`).

---

## 7. Respuesta directa a la pregunta

**¿Es buena la estrategia para aprender?** Sí, y ahora el circuito está
completo: el lector guarda, lee, recibe evidencia, ve su etapa y el ejercicio de
cierre mueve de verdad la tarjeta. Lo que falta no es motor, es medición.

**¿Hay mejores maneras de poner al lector en la aplicación?** Sí, y no son de
gamificación: son de **reencuentro** (que sus palabras vuelvan en el siguiente
libro), de **texto** (glosa y repaso dentro de la página), de **ritual**
(si–entonces + hora fija) y de **prueba** (micro-cloze antes, retención a 30 días
después).

---

## 8. Cómo se audita este documento

Nada de lo anterior pide confianza. El registro `docs/auditoria/claims.json`
convierte las afirmaciones en comprobaciones ejecutables: cita textual en este
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
- **H8 — la retención ya se mide.** Tasa de acierto real y palabras con estabilidad
  de 7 y 30 días en «Tu recorrido», más un «Chequeo 30 días» opcional en el
  Cuaderno. La comprensión sigue sin medida objetiva: hay una autoevaluación de
  un toque al cerrar cada capítulo, mostrada como valoración propia.
- **M1 y M2 conectados.** Los reencuentros cuentan lemas distintos, ordenan
  Descubre y las palabras del Cuaderno que reaparecen entran primero al cierre
  del capítulo. El ritmo de repaso de FSRS se elige en el Cuaderno (0,85 / 0,90 /
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
