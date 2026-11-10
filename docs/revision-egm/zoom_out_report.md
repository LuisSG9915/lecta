# Etapa 5 — Zoom Out inicial: `docs/concentracion-y-lectura.md`

- **Revisores:** `egm-zoom-out` (alcance y simplicidad) y `egm-inventive-catalyst` (contradicciones y falsos compromisos), cada uno en un contexto limpio.
- **Contexto que recibieron:** `AGENTS.md`, `src/client/components/Reader.tsx` y `docs/estrategia-aprendizaje-2026-10-24.md`.
- **Rango:** documento completo (líneas 1–425). No tiene sección de plan de implementación, así que la Etapa 9 no aplica.
- **Chequeo de contexto:** pasa. Los dos revisores entienden el objetivo: el documento es la base de evidencia para diseñar funciones y prompts de foco.

## Veredicto

No hay bloqueantes. Hay **7 Major** y **5 Nit** después de quitar duplicados. El problema de fondo es uno solo: el documento mezcla tres cosas (revisión de literatura, inventario del sistema y la especificación de una función ya hecha), y el inventario quedó atrás respecto del código. Por eso varias recomendaciones apuntan a cosas que ya existen, o se escribieron contra un sistema que ya no es el actual.

Comprobé a mano tres afirmaciones contra el código y las tres se sostienen:

- `coverage.ts:256-257` usa 94/86, no 90/75/60 (línea 72 del documento).
- `DeepSeekOperation` (`src/worker/ai.ts:79-90`) tiene 11 operaciones, no 4 más `tip`.
- Las líneas 333–336 dicen «una por cuenta y día», pero la 366 dice «1/día por dispositivo».

---

## Major

### Z1. Tres documentos en uno, sin decir qué decide
**Líneas:** 1–6, 21–103, 361–369 · **Fuente:** zoom-out

El documento junta revisión de literatura (§2–3), inventario técnico (§1, que repite `AGENTS.md` y la estrategia) y la especificación de un tip ya implementado (361–369). Quien llega sin contexto no distingue la evidencia, el estado actual y las propuestas.

**Cambio:**
- Reducir §1 a 5–10 líneas que enlacen a `AGENTS.md` y a la estrategia.
- Mover la especificación del tip a su propio archivo, o a los comentarios de `src/worker/ai.ts`.
- Abrir con una sección corta: «Decisiones que este documento sustenta».

### Z2. El inventario contradice al código
**Líneas:** 33–40, 47, 70–74, 80–103 · **Fuente:** los dos revisores (unificado)

- **Cobertura:** el documento dice 90/75/60 con «En tu nivel / Asequible». El código usa 94/86/70 con «Lectura relajada / Ideal para tu ritmo / Un reto / Exigente».
- **Calibración:** «≤18 palabras en 6 bandas zipf» no cuadra con el «CAT de 6–8 ítems» de la estrategia.
- **Operaciones de IA:** el documento dice «cuatro + tip». Hay 11: faltan `evaluate`, `story`, `explain_passage`, `companion_note`, `page_recap` y `character_recap`.
- **Sistema de foco:** omite el modo Retiro de lectura (`useReaderDeepReading.ts`).

**Cambio:** quitar las cifras copiadas y remitir a la fuente. Si se quedan, corregirlas y añadir el inventario completo de IA (ver Z3).

### Z3. Las reglas de IA de §4 ya se incumplen en operaciones que existen
**Líneas:** 302–310, 338–359, 374–375 · **Fuente:** inventive-catalyst

- La línea 374 prohíbe usar la IA para «mensajes de ánimo». `COMPANION_NOTE_SYSTEM_PROMPT` (`ai.ts:1050`) hace justo eso.
- `PAGE_RECAP_SYSTEM_PROMPT` (`ai.ts:1098`) arranca con «Ayudas a un lector que se distrajo o leyó en piloto automático». Infiere un estado, y eso es lo que prohíben la tabla de 302–310 y el principio 6.

**Cambio:** una tabla de operaciones con la columna «cumple §4: sí / no / excepción declarada». Hay que decidir de forma explícita si celebrar un logro ya ocurrido (`companion_note`) es una excepción válida. También hay que corregir la primera frase de `page_recap` o declararla excepción.

### Z4. Se proponen como pendientes funciones que ya existen
**Líneas:** 282–284, 290–291, 370–372 · **Fuente:** los dos revisores (unificado)

- **«Marcador de retomar» / «Dónde quedaste»:** el documento los da por no implementados. Ya existen `ResumeSessionOverlay` (más de 48 h, con resumen sin spoilers de `generateZeroSpoilerSceneRecap`) y una tarjeta de retomar para posiciones quietas de 3 días o más. Proponer una tercera vía con DeepSeek reinventa algo que ya está resuelto en local. La deuda real es otra: hay **dos** mecanismos de retomar (48 h y 3 días) sin unificar.
- **«TTS read-along»:** ya hay TTS con resaltado (`ttsController.ts`, `tts-landing.ts`, Kitten TTS). Si lo que falta es la sincronía palabra por palabra, el documento tiene que decirlo así.
- **Notificaciones locales de hábito:** el documento discute el batching de notificaciones pero no menciona `localNotificationScheduler`.

**Cambio:** pasar esos puntos a «Respaldado / implementado» y reescribir la brecha como «unificar los dos mecanismos de retomar».

### Z5. La señal de fatiga: el documento la declara ambigua pero la usa con umbral fijo
**Líneas:** 87–90, 189–193, 276, 304, 309, 349, 373 · **Fuente:** los dos revisores (unificado)

El documento muestra que el retroceso es ambiguo: puede ser relectura sana, y en TDAH el patrón errático es la línea base. Aun así:
1. `fatigue_flag` dispara con umbrales globales fijos (25 min / 8 movimientos / 35 %) y muestra un aviso visible.
2. `buildTipPrompt` (`ai.ts:731-737`) manda a la IA «N avisos de fatiga» con ese nombre: la IA no decide la fatiga, pero recibe una heurística sin validar como si fuera un hecho.
3. El tip compara contra la media del propio lector (línea 349) y el aviso de fatiga no. Son dos criterios opuestos para la misma señal.

**Cambio:** decidir y dejarlo escrito:
- **Corto plazo:** en el prompt, renombrar la señal a algo observable («avisos de pausa por retrocesos») o quitarla.
- **Opcional:** disparar `fatigue_flag` por percentil de la historia del propio lector (los agregados `DayFocus` de 14 días ya existen), con el umbral absoluto como respaldo para lectores sin historia.
- **Costo:** arranque en frío con lectores nuevos, y una fatiga crónica se vuelve línea base y deja de detectarse.

### Z6. La única función de IA activa empuja la evidencia más débil
**Líneas:** 172–176, 194–202, 266–267, 366–368 · **Fuente:** zoom-out

Las acciones del tip son `focus_ruler` y `syntactic`, y el propio documento clasifica las dos como «plausible / preliminar». La intervención con mejor evidencia según el documento, la lectura paginada (la brecha entre pantalla y papel «casi desaparece sin scroll»), no está entre las acciones, y el scroll es el valor por defecto.

**Cambio:** recomendar una acción «pasar a modo páginas», o justificar por qué se eligieron las dos acciones con menos evidencia.

### Z7. Cómo se evalúa el tip: sin grupo de control
**Líneas:** 324–331 · **Fuente:** inventive-catalyst

Comparar los `DayFocus` antes y después de aceptar el tip tiene tres fallas:
- **(a)** Mide con señales que el propio documento declara ambiguas.
- **(b)** `focus_ruler` y `syntactic` cambian la presentación del texto, y con ella los retrocesos y el dwell. La intervención altera el instrumento con que se mide.
- **(c)** El tip solo aparece cuando la señal supera el umbral, así que parte de la «mejora» será regresión a la media.

**Cambio:** en una fracción aleatoria de los días elegibles, no mostrar el tip y registrar `tip_withheld`. Luego comparar los días con tip mostrado contra los días con tip retenido. Para (b), medir el resultado con el cloze de fin de capítulo.
**Costo:** un tipo de evento nuevo, lógica de asignación y una N mínima antes de poder concluir.

### Z8. Cadencia del tip: dos frases que se contradicen y una garantía que no existe
**Líneas:** 333–336 frente a 366 · **Fuente:** los dos revisores (unificado)

La línea 333 dice «una por cuenta y día», y la 366, «1/día por dispositivo». `tipCache` es un `createTtlCache` en memoria (`app.ts:1081`): cada isolate de Cloudflare tiene el suyo, así que la garantía «por cuenta» es, en el mejor de los casos, por instancia del worker.

**Cambio:** dejar una sola frase fiel al código. Si la cadencia por cuenta importa, usar `lecta_ai_quota` con `scope = 'tip'` y un bucket diario como marca durable, y cerrar en silencio si la base falla.

### Z9. Cada canal de interrupción tiene su propio enfriamiento, sin un tope global
**Líneas:** 82–103, 134–140, 340–345, 358, 364–365 · **Fuente:** los dos revisores (unificado: el zoom-out dice que es una abstracción prematura, el catalyst propone un árbitro)

Hay cinco canales o más con reglas propias: `fatigue_flag`, `react()` del gato, `deep_focus`, el tip, el aviso de preparación, `companion_note` y el recap de reanudación. El principio 2 propone generalizar enfriamientos canal por canal, lo que da N enfriamientos sin tope diario. Las líneas 364–365 muestran el síntoma: el tip se mudó a la estantería porque la franja ya estaba ocupada. Se resolvió cambiándolo de lugar, no decidiendo una prioridad.

**Postura de los revisores:**
- **zoom-out:** hoy hay una sola intervención *proactiva de IA*, así que no hace falta un marco general. Basta con una regla concreta para el tip.
- **catalyst:** con cinco canales o más en producción, sí se justifica un árbitro único (por ejemplo, ampliar `companion-presence.ts`) con presupuesto diario, compuerta de breakpoint, `deep_focus` y prioridades.

**Decisión pendiente tuya:** ¿cuentan como un mismo presupuesto las interrupciones *locales* (no-IA)? Si cuentan, gana el árbitro. Si no, gana la regla concreta.

---

## Nit

| # | Líneas | Problema | Cambio |
|---|---|---|---|
| N1 | 8–19 frente a 141, 194, 200, 203 | Etiquetas `disputado`, `plausible/preliminar` y `replicado, mixto` fuera de la leyenda (lo señalan los dos revisores) | Añadirlas a la leyenda o reasignarlas |
| N2 | 211–214, 287–289, 315–322, 343–345 | La regla de menos de 5 min se presenta como «la más limpia», pero no tiene ancla empírica ni consumidor en el código. La línea 315 dice «sin telemetría nueva» y la 321, «nueva señal» | Etiquetarla `heurística propia` y atarla a un consumidor existente, o marcarla como hipótesis |
| N3 | 87–90, 333–336, 361–369 | Valores de código (160 tokens, 6/h, `tip-v1`, ventana de 5 min) que se desactualizan solos | Enlazar al archivo en lugar de copiar el valor |
| N4 | 75–77, 177–182, 307–308 | El XP paga cada consulta, y luego el número de consultas llega a la IA como señal de vocabulario o curiosidad: la recompensa contamina la señal | Añadir la hipótesis «consulta motivada por XP» a la tabla 302–310 |
| N5 | 69, 218–223, 277, 292–293 | Racha diaria estricta junto a la meta N-de-7 que el documento prefiere; el modo `playful` del gato reconocido como distractor sin una decisión | Declarar por qué conviven las dos o unificarlas en racha semanal; escribir «`playful` no es el valor por defecto; en `deep_focus` solo visits/off» |

---

## Trazabilidad

| Ítem | zoom-out | inventive-catalyst |
|---|---|---|
| Z1 | #1 | — |
| Z2 | #2 | #1 (parte) |
| Z3 | — | #1 (a, c) |
| Z4 | #3, #4 | #1 (b) |
| Z5 | #6 | #3 |
| Z6 | #5 | — |
| Z7 | — | #4 |
| Z8 | #8 | #2 |
| Z9 | #7 | #5 |
| N1 | #10 | #9 |
| N2 | #7 (parte) | #8 |
| N3 | #9 | — |
| N4 | — | #6 |
| N5 | #11 | #7 |
