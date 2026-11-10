# Etapa 7: revisión crítica de `docs/concentracion-y-lectura.md` (ronda 1)

- **Revisores** (cada uno con contexto limpio):
  - `egm-design`: diseño y arquitectura, con el estándar `feature-spec-standard`.
  - `egm-structural`: estructura, con el estándar `feature-spec-standard`.
  - `egm-style`: redacción técnica, sin estándar.
- **Estado:** los tres revisores terminaron. Ninguno quedó «no ejecutado».
- **Contexto que recibieron:** `AGENTS.md`, `Reader.tsx` y `docs/estrategia-aprendizaje-2026-10-24.md`.
- **Rango:** líneas 1–425.

## Veredicto y una advertencia sobre los bloqueantes

Después de quitar duplicados quedan **3 Blocker**, **11 Major** y **10 Nit**.

**Los tres bloqueantes dependen de cómo se clasifique el documento.** El estándar `feature-spec-standard` exige problema, metas y no-metas, alternativas y riesgos. El documento se presenta como «insumo» de investigación, no como especificación. Si sigue siendo un documento de evidencia, los bloqueantes C1–C3 se reducen a uno solo: sacar la especificación del `tip` a su propio archivo (la misma salida de Z1). Si el documento quiere ser también la especificación del `tip`, los tres bloqueantes valen tal como están.

Antes de escribir, comprobé contra el código las afirmaciones que pesan:
- `DeepSeekOperation` tiene 11 operaciones (`ai.ts:79-90`).
- `tipCache` es una caché en memoria (`app.ts:1081`).
- La cobertura usa 94/86 (`coverage.ts:256-257`).

El revisor de estilo también confirmó estos valores del documento:
- los umbrales de fatiga, 25 min y 35 % (`focus-telemetry.ts:11,19`);
- `deep_focus` a los 10 min y el corte por inactividad a los 90 s (`companion-state.ts:56,62`);
- `tip-v1`, 160 tokens y 6/h (`ai.ts:12,101`, `app.ts:1769`);
- `tip_shown` y `tip_accepted` (`idb.ts:290,296`).

---

## 🔴 Blocker

### C1. No hay alternativas evaluadas
**Líneas:** 295–377 · **Fuente:** design #1, structural #1

El `tip` aparece como implementado y sus decisiones de diseño no comparan ninguna opción. Además, la línea 374 dice que «las reglas locales bastan y son gratis» para los mensajes de ánimo. Entonces hay que justificar por qué el tip sí necesita DeepSeek, si cuesta tokens, añade latencia y saca datos del dispositivo.

**Alternativas mínimas que hay que comparar:**
- tip con reglas locales deterministas sobre `DayFocus`, frente a tip con LLM;
- sin tip, solo con mejores valores por defecto (por ejemplo, el modo páginas, ver Z6);
- tip en la estantería, frente a tip en el Reader en un punto de corte;
- detector de fatiga por retrocesos, frente a pausas programadas (que según la propia §2, 203–208, tienen mejor base);
- marca diaria en memoria, frente a marca guardada en la base de datos.

**Cambio:** añadir una sección `## Alternativas consideradas` con la tabla `| Alternativa | Por qué se descartó |`.

### C2. Falta el problema, las metas y las no-metas, y el documento mezcla tres tipos de texto
**Líneas:** 1–6, 21–103, 361–377 · **Fuente:** design #2, structural #2 (coincide con Z1 y con el hallazgo 5 de comprensión)

No hay un enunciado del problema del usuario. Las no-metas están dispersas en tres sitios: 278, 324 y 373. No hay un flujo de datos del tip: cliente → `/api/lexicon/tip` → AI Gateway → DeepSeek → estantería → eventos.

**Cambio, una de dos salidas:**
- **(a) Partir el documento** (es la que recomiendo). Este documento queda como evidencia más principios, y se crea una especificación «Consejo diario (tip-v1)» con: problema, metas y no-metas, arquitectura (el flujo y el contrato `TipContext`/`TipResponse`), alternativas y riesgos.
- **(b) Añadir aquí esas secciones** y declarar §2 como anexo.

### C3. No hay una sección de riesgos
**Líneas:** todo el documento · **Fuente:** structural #3, design #6

Los riesgos están dispersos (189–193, 277, 302–310, 349–350 y 376), y tres no aparecen en ningún sitio:
- **Privacidad.** El tip es una llamada proactiva, sin que el usuario haga nada, y `useAi` está activado por defecto. Manda a DeepSeek, a través de AI Gateway, la hora local, el modo de foco, la meta semanal y 14 días de retrocesos y «avisos de fatiga». El documento no habla de consentimiento, de retención en el gateway ni de minimizar datos.
- **Salida inválida del modelo.** No dice qué pasa si `parseTip` devuelve una acción que no está en el conjunto cerrado.
- **Deduplicación imperfecta entre dispositivos** (ver C6).

**Cambio:** añadir `## Riesgos y mitigaciones` con la tabla `| Riesgo | Modo de fallo | Mitigación | Estado |`.

---

## 🟡 Major

### C4. El mapa del sistema está desactualizado
**Líneas:** 33–40, 99–103 · **Fuente:** design #5, structural #5 y #8, style M1 (coincide con Z2)

- El documento dice «cuatro operaciones». El código tiene 11.
- La lista de eventos (99–103) omite `tip_*`, `resume_*` y `tts_*`.
- §1 no menciona `localNotificationScheduler`/`periodicsync`, `MidChapterRecallCard` ni la autoevaluación «¿Seguiste el hilo?».

### C5. Funciones que aparecen como brechas y ya existen
**Líneas:** 280–293, 370–372 · **Fuente:** design #5, structural #6 (coincide con Z4)

- `ResumeSessionOverlay`, con un resumen sin spoilers y los eventos `resume_shown`/`resume_reread`, ya cubre «Marcador de retomar» y «Dónde quedaste».
- TTS ya funciona con `kittenTtsEngine`/`useReaderTts` y los eventos `tts_*`.

**Cambio:** marcar los dos puntos como «implementado; falta X».

### C6. La cadencia del tip se contradice y promete más de lo que garantiza
**Líneas:** 333–336 frente a 366 · **Fuente:** los tres revisores (coincide con Z8)

- **Cliente:** muestra un tip al día por dispositivo (`TIP_LAST_DAY_KEY`).
- **Worker:** la marca por cuenta vive en `createTtlCache` (en memoria, por isolate, 200 entradas, TTL de 20 h). Funciona en el mejor de los casos: otro isolate no ve la marca, y con más de 200 usuarios activos al día se expulsan entradas.
- **Tope duro real:** 6 por hora por cuenta.

**Cambio:** reemplazar las dos frases por una sola. El revisor de estilo propone esta redacción:

> Cadencia: el cliente muestra como máximo un tip por día y dispositivo. El worker guarda en caché en memoria (por isolate, TTL 20 h) la marca «esta cuenta ya generó hoy» y devuelve silencio a otros dispositivos mientras esa entrada exista. Es un esfuerzo razonable, no una garantía: el límite duro es el rate limit de 6/h.

### C7. El tip le pide a la IA algo que §4 prohíbe
**Líneas:** 373–377 frente al prompt real · **Fuente:** design #4

- La línea 376 prohíbe usar la IA para «interpretar series temporales del usuario».
- Aun así, `buildTipPrompt` (`ai.ts:731-745`) le manda la serie de 14 días, y `TIP_SYSTEM_PROMPT` le pide frases como «ayer retrocediste más que tu media». El LLM calcula la media e interpreta la serie.

**Cambio:** calcular en el cliente la media y el disparador, y mandarle al LLM solo el hallazgo ya decidido para que lo redacte. Si no, declarar la excepción en Alternativas.

### C8. Operaciones de IA que ya incumplen §4
**Líneas:** 302–310, 374–375 · **Fuente:** design #5 (coincide con Z3)

- `companion_note` escribe notas «cariñosas y motivadoras», justo lo que prohíbe la línea 374.
- `page_recap` empieza con «Ayudas a un lector que se distrajo…», es decir, infiere un estado del lector.

**Cambio:** decidir si cada una es una excepción declarada o una deuda pendiente.

### C9. El sesgo con TDAH está identificado pero no mitigado
**Líneas:** 87–90, 189–193, 276, 309, 352–353 · **Fuente:** design #7 (coincide con Z5)

- El detector usa umbrales absolutos (25 min / 8 movimientos / 35 %).
- Dispara el aviso 20-20-20 y el bostezo del gato, y su conteo llega al prompt del tip.
- El principio 6 solo prohíbe *nombrar* la población, no corrige el sesgo.

**Cambio:** fijar el umbral respecto a la mediana del propio lector en 14 días, dar un interruptor visible para apagar el aviso y sacar `fatigue` del prompt hasta que la heurística esté validada.

### C10. No hay un presupuesto global de interrupciones
**Líneas:** 343–345 · **Fuente:** design #8, style M8, structural #13 (coincide con Z9)

- El principio 2 dice «≤N» sin fijar el valor de N.
- Hay al menos ocho canales y cada uno tiene su propio enfriamiento:
  - fatiga, 10 min;
  - `react()` del gato, 90 s;
  - `MidChapterRecallCard`;
  - «Antes de leer»;
  - reanudar;
  - notificaciones de hábito;
  - tip;
  - `companion_note`.
- La evidencia de agrupar notificaciones (*batching*) apoya un tope total, no uno por canal.

**Cambio:** fijar N, definir qué cuenta como intervención y decidir si hace falta un árbitro común. Esta es la decisión que ya quedó pendiente en Z9.

### C11. La regla de «menos de 5 min» se contradice con el documento y con el producto
**Líneas:** 209–214, 287–289, 315, 321–322 · **Fuente:** design #9, style M7 (coincide con N2 de la Etapa 5)

- Las líneas 213–214 piden no usar cifras sin ancla empírica, y luego 289 y 321 presentan los 5 min como «la evidencia → regla más limpia».
- La línea 315 dice «sin telemetría nueva» y la 321 habla de una «nueva señal».
- No está implementada: no aparece *settling* ni acomodación en `src`.
- «Antes de leer» y `MidChapterRecallCard` intervienen justo al inicio de la sesión.

**Cambio:** etiquetarla `heurística propia`, decir si está propuesta o implementada, y listar qué canales quedan exentos y por qué.

### C12. La evaluación del tip no permite decidir nada
**Líneas:** 324–331 · **Fuente:** design #10 (coincide con Z7)

El plan tiene tres sesgos:
- **sesgo de selección:** aceptan el ajuste quienes ya querían cambiar;
- **regresión a la media:** el tip se dispara en días atípicos;
- **efecto novedad.**

Además, falta lo necesario para decidir:
- no se registra cuándo el lector revierte el ajuste tras `tip_accepted`;
- no hay métrica de éxito;
- no hay criterio para retirar la función.

**Cambio:**
- registrar la reversión del ajuste;
- medir el éxito como retención del ajuste a 7 días, junto con «¿Seguiste el hilo?»;
- usar como control días elegibles en los que el tip se retiene al azar;
- fijar un criterio de retiro (aceptación por debajo de X % o reversión por encima de Y %).

### C13. Etiquetas de evidencia fuera de la leyenda, y viñetas sin etiqueta
**Líneas:** 8–19 frente a 141, 157–168, 194, 200, 203 · **Fuente:** los tres revisores (coincide con N1)

- `disputado`, `plausible/preliminar` y `replicado, mixto` no están en la leyenda.
- La viñeta de 165–168 no lleva etiqueta.

**Cambio:** añadir a la leyenda `disputado` y `preliminar`, y normalizar `replicado, mixto` a `replicado` con el matiz «(resultados mixtos)».

### C14. Afirmaciones de diseño sin respaldo
**Líneas:** 90, 186–188, 258, 290–291, 299–300 · **Fuente:** structural #9, style M5, M6, M9

- El aviso 20-20-20 (90) no tiene etiqueta ni aparece en §2.
- La fila «glosas marginales» (258) figura como «respaldado» pero no tiene fuente.
- Superlativos sin respaldo: «la función de accesibilidad con mejor soporte» y «mayor evidencia por esfuerzo que cualquier tip».
- El principio «no inferir estados» (299) no está definido. El más cercano, el principio 6, solo cubre la inferencia de población.

---

## 🟢 Nit

| # | Líneas | Problema | Cambio |
|---|---|---|---|
| C15 | 361–369 | El título «Usos candidatos» incluye algo ya implementado | Separar en «Uso implementado: `tip`» y «Usos candidatos» |
| C16 | 297–310 frente a 363–369 | La tabla de ambigüedad no está conectada con el prompt | Meter las hipótesis A/B en el prompt (tip-v2) o explicar por qué no |
| C17 | 151–156, 161–164, 215–217, 268, 383–425 | Citas sin autor ni DOI («~20–30 %», N = 80, U. de Antioquia, NSF 10284385, *settling-in*), «12 min de ejercicio» con etiqueta `replicado` y un solo estudio, y Readability Consortium y Sörqvist & Marsh ausentes de Fuentes | Usar el formato `Autor (año). Revista. DOI`; si no hay cita, bajar la etiqueta |
| C18 | 304 | Dice «correlata» | «se correlaciona» |
| C19 | 23 | «crecer vocabulario» | «ampliar el vocabulario» |
| C20 | 117, 166, 207, 229, 246, 275, 331, 368, 374 | Tono coloquial o valorativo: «pegan más», «Ojo:», «Conclusión honesta», «Vacuna interna», «de verdad», «son gratis» | Ver las sustituciones de style N2 abajo |
| C21 | varias | Anglicismos sin glosa: *default*, *lookup*, *breakpoints*, *dwell*, *chunking*, *read-along*, *settling-in*, *batching*, *testing effect*, *speed reading*, *telepressure* | Usar el término en español y el inglés entre paréntesis la primera vez |
| C22 | 8, 21, 105, 250, 295, 379 · 254–302 | La numeración de H2 es inconsistente y las tablas de §3 tienen encabezados distintos | Numerar todo o declarar Fuentes como anexo; usar `\| Función \| Evidencia \| Matiz / decisión \|` |
| C23 | 3–4, 30–31, 340, 346 | «segunda opinión externa» no se puede verificar; «caché apagado a propósito» no dice por qué; el título del principio 1 («a media línea») no coincide con su contenido; «máx. ~45» | Quitar o concretar; poner «máximo 45 palabras» |
| C24 | 3–4 · 215–217 | El mapa técnico no tiene fecha de revisión ni versión; «Ejercicio y sueño» no se conecta con ninguna decisión | Añadir «mapa revisado el … (v0.2.15)»; marcar ese punto como fuera de alcance o quitarlo |

**Sustituciones propuestas por style N2:**

| Línea | Ahora | Propuesta |
|---|---|---|
| 117 | «pegan más» | «tienen mayor efecto» |
| 166, 229 | «Ojo:» | eliminar |
| 207 | «Conclusión honesta:» | «Conclusión:» |
| 246 | «Vacuna interna:» | «Implicación para Lecta:» |
| 331 | «de verdad» | «permitirían medir comprensión» |
| 374 | «son gratis» | «sin coste de IA» |

---

## Trazabilidad

| Ítem | design | structural | style | Etapas 5/6 |
|---|---|---|---|---|
| C1 | #1 | #1 | — | — |
| C2 | #2 | #2 | — | Z1, comp. 5 |
| C3 | #6 | #3 | — | — |
| C4 | #5 | #5, #8 | M1 | Z2, comp. 1, 3 |
| C5 | #5 | #6 | — | Z4 |
| C6 | #3 | #4 | M2 | Z8, comp. 2 |
| C7 | #4 | — | — | — |
| C8 | #5 | — | — | Z3 |
| C9 | #7 | — | — | Z5 |
| C10 | #8 | #13 | M8 | Z9 |
| C11 | #9 | — | M7 | N2 |
| C12 | #10 | — | — | Z7 |
| C13 | #11 | #7 | M4 | N1, comp. 10 |
| C14 | — | #9 | M5, M6, M9 | — |
| C15 | — | — | M3 | comp. 5 |
| C16 | #15 | — | — | — |
| C17 | #12 | #11 | N7, N8, N10, N14 | comp. 12, 13 |
| C18 | #14 | — | N3 | — |
| C19 | — | — | N5 | — |
| C20 | — | — | N2 | — |
| C21 | — | — | N4 | — |
| C22 | — | #10, #12 | — | — |
| C23 | — | — | N1, N6, N11–N13 | comp. 8, 13 |
| C24 | #13 | — | N9 | — |
