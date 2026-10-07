# Concentración y lectura sin distracciones — evidencia + mapa de Lecta

Investigación web + análisis del código (oct 2026), revisada con una
segunda opinión externa. Sirve como insumo para diseñar funciones y
prompts de IA: qué funciona según la literatura, qué hace ya Lecta y
qué señales tiene disponibles.

## Cómo leer la certeza de cada afirmación

Cada hallazgo lleva una etiqueta de nivel de evidencia:

- `meta-análisis` — síntesis cuantitativa de varios estudios.
- `replicado` — efecto encontrado por más de un equipo.
- `estudio único` — un experimento o serie de un laboratorio.
- `evidencia indirecta` — medido en otro dominio (oficina, laboratorio
  de tareas) y extrapolado a lectura; razonable como hipótesis de
  diseño, no como base.
- `heurística propia` — decisión interna de Lecta sin validación
  externa; se declara así para que nadie la cite como literatura.

## 1. Qué es Lecta (mapa técnico)

PWA de lectura EPUB enfocada en **crecer vocabulario en español**:
leer libros → consultar palabras → guardarlas en el Cuaderno →
repasarlas con FSRS hasta aprenderlas.

- **Cliente**: React 19 + TS + Vite. `foliate-js` renderiza el EPUB;
  IndexedDB por cuenta (`lecta` anónimo, `lecta:u:<id>`); offline-first
  con service worker propio (`public/sw.js`, precache + red primero).
- **Worker**: Cloudflare Workers + Hono + `pg` por request → CockroachDB
  vía Hyperdrive (caché apagado a propósito). Better Auth (magic link,
  contraseña, borrado con verificación). EPUBs en R2.
- **IA (DeepSeek vía AI Gateway)** en `src/worker/ai.ts`, cuatro
  operaciones con prompt versionado, tope de tokens, timeout 8 s y
  reintentos: `enrich` (ficha léxica JSON que se guarda en el catálogo
  compartido `lecta_dev.lexicon_*`), `item` (ejercicio de opción con
  distractores), `verify` (corrige oración escrita por el usuario),
  `explain` (sentido en contexto, efímera, caché TTL 10 min).
  Preferencia «Usar IA» por cuenta (`useAi`, default encendida);
  `lookup`/`batch`/`sample` del catálogo son públicos y no usan IA.

### Flujo de lectura

1. **Estantería** → abrir libro (local, R2 o catálogo público).
   Posición sincronizada con arbitraje por `updatedAt`.
2. **Calibración** de vocabulario: opcional tras el primer tramo leído
   o desde Cuenta; muestra ≤18 palabras en 6 bandas zipf; escribe
   evidencia de conocimiento.
3. **Análisis de capítulo** (local): segmentación por oraciones
   (`Intl.Segmenter` en worker de segmentación), lemas vía catálogo,
   predicción de palabras desconocidas por perfil.
4. **«Antes de leer»** (SectionPreview): hasta 40 filas priorizadas
   (evidencia desconocida → aprendiendo → rareza) + diferidas
   paginadas; el lector marca «la conozco / no la conozco» → evidencia
   + candidatas al Cuaderno. Siempre salteable.
5. **Lectura**: ajustes de fuente (Literata, Alegreya Sans, Source
   Serif, Atkinson, OpenDyslexic), tamaño, interlineado, medida
   (55/65/75 ch), justificado, capitular, **scroll o paginado** (1–2
   columnas), separación silábica, temas (Día/Sepia/Pizarra/OLED/auto).
6. **Consulta de palabra** (WordPanel): ficha del catálogo, locuciones
   del Wikcionario (`phrases.ts`, índice estático), «definir con IA»,
   «explicar en contexto», guardar al Cuaderno, declarar conocida.
7. **Cuaderno**: lista, «Por aprender» (primera exposición guiada,
   `learn.ts`), «Repasar hoy» (FSRS ts-fsrs 5.4.2), práctica (cloze
   del contexto real, opción múltiple con distractores IA, oración
   propia verificada por IA).
8. **Progreso**: intervalos de lectura (idle 90 s cierra segmento),
   días leídos, meta semanal de días (lunes–domingo, ≥60 s/día), WPM
   estimado por día, actividad por libro.
9. **Cobertura** (`coverage.ts`): insignia por libro con % de formas
   únicas que el perfil ya conoce o tiene guardadas (umbrales propios
   90/75/60 → «En tu nivel»/«Asequible»/«Un reto»/«Exigente»). Misma
   cadena de clasificación del lector (`predictSection`) sobre el
   manifiesto precomputado del seed o análisis local.
10. **Gamificación**: XP (min leído = 1, consulta 2, guardada 3 +4 si
    rara, repaso 1–4, libro 50), niveles, racha con bonus 10 %, logros,
    cofres cosméticos, y **el gato** (companion): etapas por nivel,
    pelajes/prendas, cuidado, sincronizado por cuenta.

### Sistema de foco existente

- **`focusMode`**: «Normal» | «Líneas sintácticas» (reparte el párrafo
  en unidades con sentido — cortes tras puntuación o antes de
  conectores; equivale al VSTF de la literatura) | «Regla de foco»
  (franja clara de 1/3/6 líneas que sigue al puntero y vela el resto).
- **Telemetría de foco** (`focus-telemetry.ts`): ventana deslizante
  5 min de movimientos; tras ≥25 min de tramo continuo, ≥8 movimientos
  y ≥35 % de retrocesos → `fatigue_flag` (cooldown 10 min) → aviso
  20-20-20 + bostezo del gato. **Heurística propia sin validar.**
- **Máquina del gato** (`companion-state.ts`): sleep → reading →
  **deep_focus tras 10 min sin interrupción** (heurística propia);
  consulta → curious; fatiga → yawn; meta → celebrating. En deep_focus
  el planificador de presencia NO inicia visitas.
- **Presencia** (`companion-presence.ts`): modos off/visits/playful/
  always; solo cuenta «tiempo elegible» (señales reales, no reloj);
  capas, pestaña oculta o idle pausan sin acumular deuda; supresión
  por libro no persiste.
- **Eventos de trayecto** (`reading-events.ts`, local, 90 días,
  apagable): `target_entered`, `preparation_*`, `word_consulted`,
  `word_saved`, `word_declared_known`, `page_regressed`,
  `section_dwell` (ms + palabras), `fatigue_flag`. De ahí salen WPM/día,
  regresiones, consultas y fatiga por día.

## 2. Evidencia: qué sabemos sobre concentrarse leyendo

### Interrupciones y multitarea

- **Multitarea durante lectura** `meta-análisis` — baja comprensión
  (*g* = −0.28; con ritmo impuesto *g* = −0.54; con ritmo libre no
  confiable, *g* = −0.14) y alarga el tiempo (*g* = +0.52). Con ritmo
  libre el costo se paga en tiempo, no en comprensión.
- **Distractores en lectura digital** `meta-análisis` — interferencia
  atencional baja comprensión (*g* ≈ −0.64, 32 estudios, Frontiers
  2025), pero con **heterogeneidad alta** (I² ≈ 88 %): el efecto es
  mucho mayor en diseños entre grupos (≈ −0.81) que intra-sujeto
  (≈ −0.32), y TV/música pegan más a lectores mayores. Tratar el
  promedio como rango por moderador, no como constante.
- **Audio de fondo** `meta-análisis` — habla, ruido y música tienen
  efecto negativo pequeño pero confiable sobre comprensión. Matiz:
  un texto más difícil puede proteger del habla de fondo al exigir
  más compromiso (Sörqvist & Marsh).
- **Interrupciones fragmentan la sesión** `replicado` — Gloria Mark:
  ~47 s promedio por pantalla antes de cambiar (mediana 40 s). El
  «~23–25 min para reenfocar» divulgativo en realidad medía el tiempo
  hasta retomar una tarea en oficina incluyendo ~2 tareas intermedias
  (CHI 2005): la lección correcta para lectura es que interrumpir
  fragmenta el resto de la sesión, no una constante de reenfoque.
- **Residuo de atención** `evidencia indirecta` — al cambiar de tarea
  parte de la atención queda en la anterior; un «plan de retomar»
  breve lo reduce (Leroy 2009; Leroy & Glomb 2018). Medido en sopas
  de letras y tareas de oficina, no en lectura narrativa — extrapolar
  como hipótesis de diseño.
- **Notificaciones** `replicado` — entregarlas en breakpoints
  naturales baja frustración y tiempo de reacción (Iqbal & Bailey);
  agruparlas 3×/día mejora atención y ánimo vs. siempre activas, pero
  apagarlas del todo sube ansiedad/FoMO (Fitz/Kushlev 2019); un día
  sin ellas: más productividad percibida, menos sensación de respuesta
  social (Pielot & Rello 2017). Regla: **no interrumpir en medio de
  la tarea**, no «cero notificaciones».
- **Solo tener el teléfono cerca** `disputado` — Ward et al. 2017
  («brain drain») propuso que su presencia drena capacidad cognitiva.
  **La replicación directa pre-registrada no lo confirmó** (sin
  diferencias en OSpan ni Go/No-Go) y los meta-análisis divergen:
  Hartanto et al. 2024 (166 efectos) → d = −0.02 no significativo;
  otro (k = 56) solo halla efecto pequeño en memoria de trabajo.
  «Teléfono en otro cuarto» sigue siendo precaución barata, no hecho.

### Atención interna: divagación y metacognición

- **Divagar al leer** `replicado` — ocurre ~20–30 % del tiempo de
  lectura (46.9 % del tiempo despierto en general, Killingsworth &
  Gilbert 2010) y se asocia consistentemente con peor comprensión
  (meta-análisis 2022).
- **Entrenamiento metacognitivo** `estudio único` — reduce lectura
  «en automático» y estabiliza comprensión (N = 80).
- Instrucciones de **meta-awareness** mejoran foco pero pueden costar
  comprensión; de **compromiso externo** mejoran comprensión sin
  reducir divagación reportada; «mente curiosa» redujo divagación
  intencional y no intencional (N = 610) `estudio único`.
- **Metas antes de leer** `estudio único` — instrucciones de
  relevancia/objetivo claro mejoran comprensión en contextos con
  distractores (eye-tracking, U. de Antioquia): saber para qué se lee
  guía la atención.
- Fijaciones anormalmente **lentas** (no rápidas) delatan divagación —
  señal usable: patrones de dwell, no velocidad cruda. Pero ojo: el
  dwell alto también puede ser procesamiento profundo (señal ambigua,
  ver §4).

### Pantalla, formato y fatiga

- **Pantalla vs papel** `meta-análisis` — papel > tablet > e-reader >
  computadora > smartphone. **La brecha casi desaparece sin scroll**
  (*g* 0.03–0.12); con scroll el papel gana claramente (*g* 0.35–0.48).
  En pantalla hay procesamiento más superficial y menor regulación
  metacognitiva, sobre todo con límite de tiempo.
- **Hipertexto** `meta-análisis` — cada enlace impone una decisión
  («¿clic o no?») que carga memoria de trabajo; el daño cae sobre
  lectores con poco conocimiento previo (DeStefano & LeFevre 2007).
  Implicación directa para Lecta: la consulta debe ser **barata y
  lateral** (panel, no navegación) y el texto no debe poblarse de
  elementos pulsables.
- **Lectura bimodal (texto+audio)** `replicado` — lectores débiles
  comprenden al nivel de lectores promedio con read-along (Montali &
  Lewandowski); en hábiles puede costar por redundancia. Audiolibro
  vs. texto: sin diferencias en narrativa (Rogowsky 2016); leve
  ventaja del texto auto-ritmado (Daniel & Woody 2013). TTS+resaltado
  es la función de accesibilidad con mejor soporte disponible.
- **TDAH** `replicado` — más divagación, más regresiones y patrones
  más erráticos **como línea base estable**, no como fatiga. Cualquier
  detector de «fatiga» por retrocesos dará falsos positivos
  sistemáticos en esa población; y para ella las pausas programadas
  y el chunking ayudan *más*, no menos.
- **Segmentación sintáctica** `plausible/preliminar` — VSTF (Walker
  et al. 2005) y entrenamiento por chunks mejoran el procesado
  multi-palabra, pero la evidencia es de pocos estudios, un
  laboratorio, y poblaciones en remediación o principiantes. El dato
  de periodicidad ~2 Hz alineada a chunks (Scientific Reports 2023)
  es neurociencia descriptiva, no validación de intervención.
- **Reglas/guías de lectura** `plausible/preliminar` — la evidencia de
  reglas físicas y overlays en dislexia es pequeña y mixta; ofrecerlas
  como preferencia es legítimo, «validado» no.
- **Descansos** `replicado, mixto` — pausas sistemáticas (tipo
  Pomodoro 24/6 o 12/3) dieron ~20 % menos fatiga y menos
  distractibilidad que autorreguladas; otro estudio no halló
  diferencias de resultado y midió fatiga más temprana con Pomodoro
  rígido. Conclusión honesta: descansar antes de agotarse ayuda; el
  cronómetro estricto es opcional.
- **Flow en lectura** `estudio único` — requiere reto ≈ habilidad
  (relación U invertida, Reading Flow Short Scale), metas claras y
  feedback inmediato. Existe una **fase de acomodación** al inicio de
  cada sesión (los primeros minutos cuestan más; estudio de
  «settling-in»). La cifra divulgativa «15–25 min para entrar en
  flow» no tiene ancla empírica: no usarla como constante.
- **Ejercicio y sueño** `replicado` — 12 min de ejercicio aeróbico
  mejoran la atención visual selectiva ~45 min; sueño suficiente
  sostiene funciones ejecutivas.
- **Hábitos** `replicado` — formación de hábito toma una mediana de
  ~66 días con alta variabilidad (Lally 2010); las intenciones de
  implementación («leeré a tal hora en tal lugar») mejoran el
  cumplimiento (Gollwitzer & Sheeran 2006); las rachas motivan pero
  su ruptura predice abandono — metas flexibles (N de 7 días) o
  «congeladores» tienen mejor base que rachas estrictas.

### Vocabulario y lectura (núcleo de Lecta)

- **Cobertura léxica** `replicado` — comprensión adecuada exige ~95 %
  de cobertura del texto y lectura placentera sin asistencia ~98 %
  (Laufer & Ravenhorst-Kalovski 2010; Nation). **Ojo: esos umbrales
  se miden sobre tokens (palabras corridas), no sobre formas únicas**
  — no se comparan directo con el % de la insignia de `coverage.ts`
  (que cuenta formas únicas). Sirven para razonar el diseño, no para
  copiar los números.
- **Pre-aprender vocabulario** acelera la lectura; **asistencia
  durante** la lectura mejora comprensión sin costar velocidad
  `replicado` — estudios con L2/intermedios (Webb 2009; asistencia
  antes/durante con lectores de español). La preparación debe ser
  selectiva para no quitar autonomía ni tiempo de lectura.
- **Adquisición incidental** `replicado` — aprender una palabra de una
  sola exposición en contexto ronda 5–15 % (Nagy, Herman & Anderson
  1985): la consulta sola no basta → justifica FSRS sobre lookup.
- **Testing effect** `meta-análisis` — recuperar activamente
  (cloze, producir oración) retiene mejor que releer (Roediger &
  Karpicke): justifica la práctica del Cuaderno.
- **Speed reading desmentido** `replicado` — las técnicas de lectura
  veloz sacrifican comprensión (Rayner et al. 2016, PSPI). Vacuna
  interna: el WPM estimado es diagnóstico, no marcador a maximizar —
  la comprensión no se mide en el producto.

## 3. Cruce: evidencia × Lecta

### Respaldado por la literatura

| Función de Lecta | Evidencia |
|---|---|
| «Antes de leer» + consulta en contexto | pre-aprendizaje acelera; ayuda durante lectura mejora comprensión (estudios L2/intermedios — extrapolación moderada a L1) |
| Modo paginado (sin scroll) | la inferioridad de pantalla se concentra en el scroll |
| Explicación en contexto (glosa) | glosas marginales/hipertextuales apoyan comprensión y algo de aprendizaje léxico |
| FSRS + práctica (cloze, oración) | adquisición incidental ~5–15 %/exposición + testing effect |
| Consulta lateral, sin salir del texto | el costo de decisión del hipertexto exige que la consulta sea barata y no navegue |

### Plausible — evidencia preliminar o en otras poblaciones

| Función | Matiz |
|---|---|
| Líneas sintácticas | VSTF con soporte real pero en lectores en remediación/principiantes, pocos estudios; la periodicidad ~2 Hz es descriptiva |
| Regla de foco | guías de lectura con evidencia pequeña y mixta; preferencia legítima |
| Ajustes tipográficos | la personalización sí tiene base (variabilidad individual, Readability Consortium); OpenDyslexic no muestra beneficio (Wery & Diliberto 2017; Rello & Baeza-Yates 2013) — lo que ayuda es el espaciado entre letras/palabras |
| Meta de días/semana | metas claras + hábito; la meta flexible (N de 7) tiene mejor base que racha estricta (la ruptura de racha predice abandono) |

### Principio de diseño o heurística propia (sin ancla en literatura)

| Función | Matiz |
|---|---|
| `deep_focus` silencia visitas | aplicación limpia de «interrumpir solo en breakpoints»; el umbral de 10 min es propio |
| Aviso de fatiga tras retrocesos | la literatura habla de *cuándo* interrumpir, no de *cómo detectar* fatiga; el retroceso es señal ambigua (la relectura correlaciona con buena comprensión); umbrales 25 min/8 mov/35 % = heurística propia |
| Gato acompañante | evita daño motivacional (nunca regaña) — eso sí está en el espíritu de la evidencia; «sin costo atencional» no está probado: en modo playful es un distractor visual potencial. Gamificación: efectos moderados y dependientes de contexto, con decaimiento por novedad (Sailer & Homner 2020) |
| WPM estimado por día | diagnóstico interno; no gamificar velocidad (speed reading desmentido) |

### Brechas que la evidencia sugiere (sin implementar)

- **Marcador de retomar**: al volver de pausa larga o días después,
  dónde quedó + contexto cercano ≈ «ready-to-resume plan»
  (evidencia indirecta, pero barata y de bajo riesgo).
- **Meta de la sesión** antes de abrir (opcional): instrucciones de
  relevancia protegen comprensión en contextos con distractores.
- **Acomodación**: los primeros minutos son frágiles — no ofrecer
  preparación pesada ni festejos ahí (regla derivable: <5 min de
  sesión → no intervenir).
- **TTS read-along**: mayor evidencia por esfuerzo que cualquier tip
  de IA para lectores débiles; no usa el riel DeepSeek.
- **Racha flexible/congelador**: si la racha pesa en la motivación,
  la evidencia de aversión a la pérdida la sugiere.

## 4. Información útil para la IA de Lecta

### Señales medidas — y su ambigüedad declarada

Toda señal que alimente un prompt debe declarar sus lecturas
alternativas, o el principio «no inferir estados» es incumplible:

| Señal | Hipótesis A | Hipótesis B | NO concluir |
|---|---|---|---|
| `page_regressed` alto | perdió el hilo (fatiga) | relectura elaborativa (correlata con buena comprensión) | «está cansado» |
| `dwell` alto | procesamiento profundo | divagación (fijaciones lentas) | «está atento» |
| WPM bajo | texto difícil | esfuerzo de decodificación | «lee mal» |
| Muchas consultas | vocabulario bajo | curiosidad léxica alta | «le cuesta» |
| Pocas consultas | texto asequible | abandono de la consulta | «entendió todo» |
| Patrón errático estable | TDAH (línea base) | fatiga situacional | «hoy está distraído» |
| Tramo sin señales | pausa/ociosidad | lectura en otra pestaña/papel | «dejó de leer» |

Además, por día/visita: WPM estimado, `regressions`, `consults`,
`fatigue` flags, `savedNotPresented`, tramo continuo, `deep_focus`,
hora local, racha, meta semanal y avance. Todo existe en
`ReadingEvent`/`DayFocus`/intervalos — sin telemetría nueva.

**Umbrales internos declarados**: `deep_focus` a 10 min, fatiga a
25 min/8 mov/35 %, idle a 90 s son heurísticas propias sin validación
externa; no presentarlos a la IA como constantes fisiológicas.

**Nueva señal consumible**: minutos desde apertura de sesión < 5 →
no intervenir (fase de acomodación, la evidencia → regla más limpia).

**Lo que Lecta NO mide**: comprensión. La instrumentación mínima ya
existe — `tip_shown`/`tip_accepted` en el riel de `ReadingEvent` —
pero mide aceptación del consejo, no comprensión; a futuro,
micro-checks opcionales (el cloze de fin de capítulo ya es
infraestructura) cerrarían la brecha de verdad.

### Principios para cualquier mensaje de IA

1. **Nunca interrumpir a media línea**: solo en breakpoints (fin de
   capítulo, cierre de hoja, pausa). El patrón `react()` pendiente ya
   lo implementa — reusarlo.
2. **Cadencia máxima**: ≤N intervenciones por día con cooldown —
   generalizar el patrón del `fatigue_flag` (la evidencia de batching
   apoya tope, no solo momento).
3. **Una acción concreta por mensaje**, máx. ~45 palabras (misma
   disciplina que `EXPLAIN_SYSTEM_PROMPT`).
4. **Nombrar la base observable**: «retrocediste más que tu media»,
   no solo «prueba la regla de foco» — el principio verificable por
   el usuario reduce la sensación de vigilancia.
5. **Sin regaño ni urgencia**: la presión sube ansiedad (FoMO/
   telepressure) sin mejorar atención.
6. **Prohibida la inferencia de población**: nunca sugerir TDAH,
   dislexia ni tratar un patrón estable como estado del momento.
7. **El silencio es resultado válido**: si la señal no supera umbral,
   el tip devuelve «sin tip hoy» — un mensaje genérico diario degrada
   el canal entero.
8. **Respetar `useAi` apagado, modo «off» y supresión por libro**:
   la IA no tiene canal aparte.

### Usos candidatos (mismo riel técnico actual)

- `operation: "tip"` en `callDeepSeek` — **implementado**: consejo en
  la estantería al abrir la app (no en el Reader: la franja ya la
  ocupa el aviso de preparación) sobre agregados de ≤14 días.
  `tip-v1`, 160 tokens, cadencia 1/día por dispositivo, rate limit
  6/h, silencio válido, acciones cerradas (`focus_ruler`/`syntactic`)
  que aplican el ajuste de verdad. Instrumentado con
  `tip_shown`/`tip_accepted`.
- «Dónde quedaste» al retomar tras días: el candidato mejor
  sustentado; con guardarraíl anti-spoiler (no resumir más allá del
  punto de corte).
- No usar IA para: decidir fatiga (regla auditable), calificar
  palabras (FSRS no se toca), mensajes de ánimo (las reglas locales
  bastan y son gratis), ni **interpretar series temporales del
  usuario** («tu mes en Lecta») — donde más riesgo de inferencia
  espuria hay.

## Fuentes principales

- Leroy (2009) OBHDP — residuo de atención; Leroy & Glomb (2018)
  Org. Science — plan de retomar. Evidencia indirecta (otro dominio).
- Mark — *Attention Span* (2023); CHI 2005/2008 — 47 s/pantalla,
  fragmentación post-interrupción, compensación con estrés.
- Clinton-Lisell et al., J. Research in Reading — meta-análisis
  multitarea (*g* −0.28 / +0.52).
- Shen et al., Frontiers in Psychology (2025) — meta-análisis
  distractores digitales (*g* −0.64, I² ≈ 88 %, moderadores).
- Vasilev et al. — meta-análisis distracción auditiva.
- Ward et al. (2017) JACR — «brain drain»; **replicación fallida**
  (Acta Psychologica 2023); Hartanto et al. (2024) — meta-análisis
  nulo (d = −0.02); meta-análisis k = 56 (Media Psychology) — solo
  memoria de trabajo.
- Fitz, Kushlev et al. (2019) CHB — batching 3×/día; Pielot & Rello
  (2017) MobileHCI; Iqbal & Bailey — breakpoints.
- Meta-análisis MW-lectura Psychon Bull Rev (2022); review integrador
  (NSF 10284385); entrenamiento metacognitivo J. Educ. Psychol.
  (2023); mindset de curiosidad (N = 610); Killingsworth & Gilbert
  (2010) — 46.9 %.
- Íkala (U. de Antioquia) — metas de lectura + inhibición.
- Network meta-análisis Educ. Inf. Technol. (2025) — papel vs
  dispositivos; el scroll explica la brecha. Delgado & Salmerón.
- DeStefano & LeFevre (2007) — costo cognitivo del hipertexto.
- Montali & Lewandowski — lectura bimodal; Rogowsky et al. (2016);
  Daniel & Woody (2013).
- Wery & Diliberto (2017); Rello & Baeza-Yates (2013); Kuster et al.
  (2018); Joseph & Powell (2022) — fuentes disléxicas sin beneficio.
- Lally et al. (2010) — ~66 días de formación de hábito; Gollwitzer &
  Sheeran (2006) — implementation intentions; literatura de rachas y
  aversión a la pérdida.
- Laufer & Ravenhorst-Kalovski (2010); Nation — umbrales 95 %/98 %
  de cobertura (sobre tokens).
- Webb (2009) CMLR; «Vocabulary assistance before and during
  reading» — ayuda durante > antes para comprensión.
- Nagy, Herman & Anderson (1985) — adquisición incidental ~5–15 %.
- Roediger & Karpicke — testing effect.
- Rayner et al. (2016) PSPI — speed reading desmentido.
- Walker et al. (2005) VSTF; CRST (ARAL 2024); Reading and Writing
  (2023) frase-a-frase; Scientific Reports (2023) chunks ~2 Hz —
  todos con matiz de población.
- Reading Flow Short Scale; estudio de «settling-in» en lectura
  larga. La cifra «15–25 min de flow» es divulgativa sin ancla.
- Sailer & Homner (2020) — meta-análisis de gamificación.
- Estudios Pomodoro/descansos (MDPI Behav. Sci. 2025; Educ. Psychol.
  2023); ejercicio agudo 12 min → atención ~45 min (PMC4052664).
