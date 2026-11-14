Status: resolved (ronda 1, auto accept: 21 PROPOSE FIX aplicadas, 1 CONTEST, nits declinados salvo líneas viejas y vigencia)

# Goldfish Annotated Review Report — Ronda 1

**Target:** `docs/estrategia-aprendizaje-2026-10-24.md` (full file, 1–487)
**Pregunta:** ¿el proceso de palabras desconocidas aplica las mejores estrategias de aprendizaje al leer?
**Revisores:** `design_critic` + feature-spec-standard (completed), `codebase_details` (completed)
**Resultado:** ronda NO limpia — 6 Blockers vigentes, 15 Majors. Los Blockers 1–6 se verificaron a mano en el código.

## Respuesta corta

La arquitectura está bien elegida (glosa en el punto de necesidad, FSRS-6, cloze sobre la oración real, θ Rasch). La ejecución invierte varios de los principios que el documento dice aplicar:

| Principio | Estado real |
|---|---|
| Glosa en el punto de necesidad | Bien aplicada |
| Espaciado (FSRS) | Motor bueno, contaminado por «Good» inmediato e incondicional del lector (#1) |
| Recuperación con feedback | Casi todo es reconocimiento con reintento; los fallos no llegan a FSRS (#1, #13) |
| Dificultades deseables | Invertidas: la tarea más fácil (lector) puntúa más que la difícil (Cuaderno) |
| Variabilidad de contexto | Solo a mitad de capítulo; el Cuaderno repite oración y distractores (#12) |
| Generación / inferencia | No existe (#14) |
| Encuentros repetidos | No pesan en la preparación (#4) y los reencuentros no se registran (#10) |
| Medición del nivel | Señales contradictorias: exposición sube θ, consulta baja θ del idioma equivocado (#2, #3, #5, #11) |
| Medición de retención | Métrica invertida (#6) |

El documento afirma «circuito cerrado» y «lo que falta es medición» (líneas 19–22, 403–405). El código no lo sostiene.

## Decisión de fondo

Casi todos los hallazgos son **bugs de código** que el documento describe como resueltos. Corregir solo el texto dejaría el documento documentando los bugs. Las ediciones propuestas abajo corrigen el texto (lo que sí es objeto de esta revisión) y pasan cada defecto a §6 como pendiente con prioridad; el arreglo de código es trabajo aparte.

---

## Prioritized Findings & AI Suggestions

### [Issue 1] [`design_critic` dc-1-B1 + `codebase_details` cd-1-B4, cd-1-M12] - Severity: Blocker
*   **Affected Scope:** Lines 21-22, 47, 168-198, 289-291, 405 (§0, tabla §1, H6, M2, §7)
*   **Discrepancy Description:** El reto de cierre y el micro-cloze siempre aplican `Rating.Good` (`reviews.ts:119-123`). `SentenceBuilderGame.tsx:241-277` y `WordScrambleGame.tsx:265-304` reintentan hasta acertar; el scramble ilumina la ficha correcta a los 8 s (`:239-263`). `DeepReadingSummaryModal.tsx:132-152`, `Reader.tsx:1105-1108` y `MidChapterRecallCard.tsx:43` ignoran `errorCount`/`usedHint`. Se califica aunque la tarjeta no esté vencida, y en palabras nuevas la primera nota llega minutos después de consultar.
*   **Rationale:** FSRS nunca ve un fallo; la tarea fácil del lector vale Good (3 XP) y el acierto difícil del Cuaderno vale Hard (2 XP, `practice.ts:111-117`). Contradice dificultades deseables y Cepeda 2008, citados por el propio documento.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Verificado: `scheduleReview(..., Rating.Good, now)` sin condición en `reviews.ts:119-123`.
*   ***Proposed Edit:***
    *   Location: §0 punto 2, fila «Cerrar capítulo» de §1, H6 viñeta 2, §7.
    *   Change: sustituir «consolida de verdad / avanza la tarjeta en FSRS» por: «Hoy el reto aplica `Good` sin mirar errores, pistas ni vencimiento; no es recuperación verificada. Pendiente P0: primer intento sin pista = Hard, error o pista = Again; tarjeta no vencida = solo exposición; palabra nueva = crear tarjeta sin calificar.» Añadir ese P0 a §6.

### [Issue 2] [`design_critic` dc-1-B2 + `codebase_details` cd-1-B1] - Severity: Blocker
*   **Affected Scope:** Lines 46, 148-166 (tabla §1, H5), 458-460
*   **Discrepancy Description:** `checkPassiveExposure` toma candidatos de `analysis.forms` (`reader-evidence.ts:220-231`), las formas únicas de toda la sección en orden de aparición (`chapter-analysis.ts:169`). Cada paso de página suma a los mismos 8 primeros lemas, no a los de la página. Cuenta también al retroceder (`useReaderNavigation.ts:310`) y en modo scroll (el defecto) solo dispara una vez por capítulo (`:245`).
*   **Rationale:** La exposición mide palabras que el lector quizá no vio, y a la tercera página las marca «familiar».
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Verificado en `reader-evidence.ts:220-231`.
*   ***Proposed Edit:***
    *   Location: fila «Pasar página» de §1 y primer párrafo de H5.
    *   Change: describir el comportamiento real y añadir pendiente P0: «formas del rango visible, solo en avance, filtradas por P(desconocer); en scroll, disparo por ventana leída».

### [Issue 3] [`design_critic` dc-1-B2 + `codebase_details` cd-1-B2] - Severity: Blocker
*   **Affected Scope:** Lines 158-166 (H5), 52 (§1 «una sola escala»)
*   **Discrepancy Description:** `recordPassiveExposure` persiste `status:"familiar"` en IndexedDB (`idb.ts:2133-2168`) y sincroniza (`reading-sync.ts:844-847`). `journey.ts:601-614` y `:780-790` cuentan «familiar» como aprendida; `predictSection` la trata como conocida (`knowledge.ts:214-224`, `280-292`). A la vez, `Reader.tsx:659-680` la mete en `evidenceRef` como `known:false` y la hoja la prioriza como `explicit_unknown` (`section-words.ts:328-330`). Además `reader-evidence.ts:248-261` sube θ (`updateLanguageTheta(..., 1, 0.25)`) en cada página válida.
*   **Rationale:** El mismo acto (leer sin consultar) sube θ, baja el umbral del perfil e infla «palabras aprendidas». Es justo lo que H5 dice haber eliminado.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Verificado en `reader-evidence.ts:248-261`.
*   ***Proposed Edit:***
    *   Location: H5 párrafos 1 y 3.
    *   Change: sustituir «no escribe evidencia permanente ni compite con lo que el lector declaró» por el comportamiento real y pasar a P0: «exposición en almacén propio que no llegue a `knowledgeMapRef`/`evidenceRef`; sin llamada a θ; `familiar` no cuenta como aprendida».

### [Issue 4] [`design_critic` dc-1-B3 + `codebase_details` cd-1-B6] - Severity: Blocker
*   **Affected Scope:** Line 41 (fórmula), H2, M1/M2 (260-264)
*   **Discrepancy Description:** `section-words.ts:238-242` cuenta apariciones dentro de formas ya únicas: `f_cap` = 1 siempre. `preparation-rows.ts:33-35` omite `bookFrequencies` a propósito. `freqReward` es constante; `isRepeated` nunca es verdadero en L2. El código usa `ln(1+f)`, el documento `ln f`.
*   **Rationale:** La palanca con más evidencia para la adquisición incidental (repetición en el texto) no influye en qué se prepara.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Verificado: `new Set(words.map(...))` en `chapter-analysis.ts:169`.
*   ***Proposed Edit:***
    *   Location: fila «Orden de esas filas» de §1.
    *   Change: «Utilidad efectiva hoy = P(desconocer) × zona i+1 × locución × peso L2; el término de frecuencia es constante (bug).» Pendiente P0: contar tokens y pasar `bookFrequencies`, con prueba de orden.

### [Issue 5] [`codebase_details` cd-1-B3 + `design_critic` dc-1-M3] - Severity: Blocker
*   **Affected Scope:** Lines 112, 129-134 (H4), 485
*   **Discrepancy Description:** `WordPanel.tsx:403` y `:562` llaman `onRecordSilentCalibration(word, "lookup"|"save")` sin idioma; `recordSilentCalibration` usa `language = "es"` por defecto (`knowledge.ts:744-758`). En un libro en inglés cada consulta baja θ_es. β sale de `calibrationBankZipf`, que devuelve `null` fuera del banco CAT → β = 0,5 casi siempre. Consultar y luego guardar emite dos bajadas.
*   **Rationale:** «Con la dificultad real de la palabra» (línea 134) y «doble bajada corregida» (línea 485) son falsas.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Verificado en `knowledge.ts:744-758` y `WordPanel.tsx:403,562`.
*   ***Proposed Edit:***
    *   Location: H4 viñetas 1-2 y §9 línea 485.
    *   Change: describir el defecto; pendiente P0: «pasar `effectiveLang`, zipf de la ficha léxica, una señal por lema y día».

### [Issue 6] [`codebase_details` cd-1-B5] - Severity: Blocker
*   **Affected Scope:** Lines 229-233 (H8), 466-469
*   **Discrepancy Description:** `computeRetentionSummary` (`journey.ts:96-101`) cuenta como acierto solo good/easy/correct. Los aciertos del Cuaderno son Hard (`practice.ts:114-117`) → cuentan como fallo; el Good incondicional del lector (#1) cuenta como acierto.
*   **Rationale:** La única métrica de retención que el documento da por hecha está invertida.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Verificado en `journey.ts:98-101`.
*   ***Proposed Edit:***
    *   Location: H8 viñeta 2.
    *   Change: añadir «la tasa cuenta Hard como fallo (bug); pendiente P0: acierto = rating ∉ {again, wrong}».

### [Issue 7] [`design_critic` dc-1-B4] - Severity: Blocker
*   **Affected Scope:** Documento completo
*   **Discrepancy Description:** Falta Goals/Non-Goals, Alternatives Considered y Risks & Mitigations del feature-spec-standard.
*   **Rationale:** «The Alternatives Rule».
*   ***AI Suggestion:*** CONTEST
*   ***Justification:*** El documento no es un spec: la línea 3-4 lo declara como respuesta a una pregunta («¿la estrategia para aprender de Lecta es buena…?») y §8 lo define como registro auditable. El estándar se aplicó por configuración de la ronda, no porque el documento lo pretenda. Las propuestas M1–M5 que pasen a diseño necesitarán su propio spec.
*   ***Proposed Edit:*** Ninguno.

### [Issue 8] [`design_critic` dc-1-M1 + `codebase_details` cd-1-M4] - Severity: Major
*   **Affected Scope:** Lines 296-298, 470-472
*   **Discrepancy Description:** `useReaderChapterPrep.ts:466-486` llena `currentChapterPrimedWordsRef` aunque la hoja no se abra; nunca se vacía al cambiar de capítulo; `recordPresented` (`:730-742`) sobrescribe la fuente `notebook-reencounter`. Esas palabras entran al reto y `reviews.ts:135-147` las crea en el Cuaderno con Good. Contradice `reviews.ts:57-60` («exclusivamente cuando el usuario guarda»).
*   **Rationale:** Palabras nunca vistas entran al Cuaderno del lector.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Hallazgo coincidente de ambos revisores con citas concretas.
*   ***Proposed Edit:*** Location: M2 párrafo de prioridades. Change: declarar el defecto; pendiente P1: solo filas presentadas o consultadas, conservar fuente, vaciar por capítulo, sin alta al Cuaderno sin confirmación.

### [Issue 9] [`codebase_details` cd-1-M3] - Severity: Major
*   **Affected Scope:** Lines 46, 155, 175-176, 487
*   **Discrepancy Description:** `consolidateEpisodicWord` pone `deleted: false` (`reviews.ts:127`): revive palabras quitadas. Busca solo por `wordKey(form)`/`wordKey(lemma)`, así que «corrieron» con «corrió» guardada crea tarjeta nueva y la original no avanza.
*   **Rationale:** Contradice «las lápidas no reviven».
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Verificado `deleted: false` en `reviews.ts:127`.
*   ***Proposed Edit:*** Location: H6 viñeta 2. Change: añadir excepción real y pendiente P1 (no revivir, resolver por lema, filtrar «Ya la sé»/«Quitar»).

### [Issue 10] [`design_critic` dc-1-M2] - Severity: Major
*   **Affected Scope:** Lines 254-298 (M1, M2), 395
*   **Discrepancy Description:** La exposición excluye las guardadas (`reader-evidence.ts:227`); reconsultar una palabra «Asentada» no registra fallo de recuerdo. `reencuentros_por_palabra` (línea 395) no tiene fuente.
*   **Rationale:** El reencuentro en el texto es la señal de aprendizaje más valiosa y se pierde.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Encaja con M1 del propio documento («el cuello de botella son los encuentros»).
*   ***Proposed Edit:*** Location: M2 y §6. Change: pendiente P1: consulta de palabra con `reps > 0` = Again; reencuentro sin consulta = evento `reencounter` sin nota FSRS.

### [Issue 11] [`design_critic` dc-1-M4 + `codebase_details` cd-1-M1] - Severity: Major
*   **Affected Scope:** Lines 52, 108-127 (H3), 129-134 (H4)
*   **Discrepancy Description:** Dos estimadores vivos (`estimateProfile` en zipf para cobertura/predicción; θ Rasch para utilidad/CAT) y tres reglas de actualización de θ con topes distintos (`updateThetaForLanguageSignal` en ficha, `updateLanguageTheta` en hoja `Reader.tsx:4544-4549`, y `onSaveToPractice` `:4550-4576`). H4 cita la regla de la hoja como si fuera la de la ficha.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Citas verificables; «una sola escala» es cierto para la escala, no para el modelo.
*   ***Proposed Edit:*** Location: H3 tabla y H4 viñeta 1. Change: listar los dos estimadores y las tres reglas; pendiente P1 unificar.

### [Issue 12] [`design_critic` dc-1-M5] - Severity: Major
*   **Affected Scope:** Lines 47-48, 274-298, 367
*   **Discrepancy Description:** `modeForWord` (`practice.ts:232-239`) alterna modo por posición, no por estabilidad. Cloze siempre con la oración capturada y distractores fijos (`:135-167`). Producción autocalificada. La escalera por estabilidad existe en `buildOneMinuteReviewSession` (`:527-547`) pero no tiene consumidor.
*   **Rationale:** Sin progresión reconocimiento → recuerdo → producción ni variabilidad de contexto; se memoriza el ítem.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Es la brecha pedagógica principal del Cuaderno.
*   ***Proposed Edit:*** Location: §3 nueva propuesta M6 «Escalera por estabilidad y contexto nuevo». Change: modo según estabilidad; oraciones nuevas de libros del lector para asentadas; verificar forma escrita en producción.

### [Issue 13] [`codebase_details` cd-1-M6] - Severity: Major
*   **Affected Scope:** H8 (225-248)
*   **Discrepancy Description:** En el Cuaderno, `PracticeCard.tsx:233-279` aplica Hard en `onSolve` sin importar reintentos; `onWrong` → `tryRescue` (`useReviewSession.ts:736-757`) cambia a un reto más fácil sin registrar Again; la pista no cambia la nota.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Contradice «recuperación con feedback» como palanca.
*   ***Proposed Edit:*** Location: H8. Change: declarar; pendiente P0 junto con #1: error = Again.

### [Issue 14] [`design_critic` dc-1-M6] - Severity: Major
*   **Affected Scope:** Lines 43, 129-146, 284
*   **Discrepancy Description:** `WordPanel.tsx:443-456` muestra el significado de inmediato; no hay opción de inferir antes de ver la glosa.
*   **Rationale:** Inferir y verificar sube la carga de implicación (Laufer & Hulstijn 2001, ya citado) sin bloquear.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Propuesta nueva, opcional; compatible con la regla Zero-Friction si va apagada por defecto.
*   ***Proposed Edit:*** Location: §3. Change: propuesta M7 «Adivina antes de ver» (un toque, solo palabras frontera, opcional, apagada en L1).

### [Issue 15] [`design_critic` dc-1-M7 + `codebase_details` cd-1-M7] - Severity: Major
*   **Affected Scope:** Lines 356-371 (§5), H5
*   **Discrepancy Description:** `wordsAssimilated = sectionWords` (`useReaderNavigation.ts:270`); «+1 % de cobertura» por defecto (`DeepReadingSummaryModal.tsx:72-73`); «la estabilidad se ha consolidado» (`:191-194`).
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Viola §5 «No inflar».
*   ***Proposed Edit:*** Location: §5. Change: añadir excepción vigente y pendiente P1: mostrar consultadas/guardadas/repasadas reales.

### [Issue 16] [`design_critic` dc-1-M8] - Severity: Major
*   **Affected Scope:** Lines 200-223 (H7), 378-379, 401-410 (§7)
*   **Discrepancy Description:** Guardar paga 3 + 4 si rara (`gamification.ts:558-564`); logros solo cuentan guardadas (`:306-332`); P0-3 sigue pendiente pero §7 sugiere que solo falta medición.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Estado del P0 no declarado.
*   ***Proposed Edit:*** Location: §6 P0-3 y §7. Change: marcar «Pendiente» y quitar «lo que falta es medición».

### [Issue 17] [`codebase_details` cd-1-M5] - Severity: Major
*   **Affected Scope:** Lines 188-190, 363-364
*   **Discrepancy Description:** `Vocabulary.tsx:354-386` aplica `Rating.Easy` si el taller IA puntúa ≥ 85, sin mirar vencimiento; `useReviewSession.ts:659-660` precarga la nota con el veredicto IA.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** H6 dice que Easy automático se retiró.
*   ***Proposed Edit:*** Location: H6 viñeta «Sin calificación implícita». Change: declarar excepción y pendiente P1.

### [Issue 18] [`codebase_details` cd-1-M2] - Severity: Major
*   **Affected Scope:** H4
*   **Discrepancy Description:** Atajos de `WordPanel.tsx:720-741` escuchan en `window`; «s» marca conocida una palabra guardada (`handleQuickKnown` no mira `isSaved`).
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Bug real; en el documento basta una línea en pendientes.
*   ***Proposed Edit:*** Location: §6. Change: pendiente P1.

### [Issue 19] [`codebase_details` cd-1-M8] - Severity: Major
*   **Affected Scope:** Lines 43, 281
*   **Discrepancy Description:** En táctil la ficha llega por presión larga → menú → «Significado» (`ReaderContent.tsx:370-479`, `ReaderSelectionBar.tsx:203-219`), no «1 toque».
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Cambio del 2026-11-11 no reflejado.
*   ***Proposed Edit:*** Location: fila «Tocar palabra» de §1. Change: describir ratón (toque) y táctil (presión larga + menú).

### [Issue 20] [`codebase_details` cd-1-M9] - Severity: Major
*   **Affected Scope:** Lines 48, 103, 25-26, 367-369
*   **Discrepancy Description:** `practice.ts:520-640` (`buildOneMinuteReviewSession`) y `MAX_PREVIEW_WORDS` no tienen consumidor; también `updatePreviewFrictionPreference`, `applyChapterCompletionPassiveLoop`, `updatePassiveExposureState`. El Cuaderno usa `buildAdaptivePracticeQueue`.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Contradice «retiro del código muerto».
*   ***Proposed Edit:*** Location: tabla §1 fila «Cuaderno» y H2. Change: citar `buildAdaptivePracticeQueue` (`practice.ts:389-456`); listar el código muerto como pendiente.

### [Issue 21] [`codebase_details` cd-1-M10] - Severity: Major
*   **Affected Scope:** Lines 415-442 (§8)
*   **Discrepancy Description:** `claims.json` ancla H4 en el camino de la hoja; H5 solo busca `uniqueLemmas.size >= 8` y pasa con #2 presente; evidencias con líneas viejas.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** El arnés no detectó ninguno de los Blockers.
*   ***Proposed Edit:*** Location: §8. Change: quitar «Nada pide confianza»; pendiente: sondas de comportamiento (página vs capítulo, idioma de la señal, nota según errores).

### [Issue 22] [`codebase_details` cd-1-M11] - Severity: Major
*   **Affected Scope:** Lines 51-53, 196-197
*   **Discrepancy Description:** `src/worker/kindle/routes.ts:2476-2493` tiene su propio FSRS con fuzz, sin `request_retention`, acierto = Good.
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** «Una sola fuente de verdad de la tarjeta» es falso.
*   ***Proposed Edit:*** Location: §1 párrafo final. Change: declarar el segundo programador y pendiente P1.

### Nits (DECLINE salvo las líneas viejas, que entran con las ediciones de arriba)
*   Referencias de línea viejas (tabla completa en el informe de `codebase_details`): se corrigen al reescribir cada sección tocada.
*   Fechas título 2026-10-26 vs archivo 2026-10-24: añadir nota de vigencia 2026-11-14.
*   Migración de θ solo si ≥ 2,5; tope `MAX_REQUIRED_DWELL_MS`; θ sin `userId`; comentario «≥ 8 s» viejo; `consultedInPageRef` sin limpiar en salidas tempranas; micro-cloze consume la marca en modo páginas; umbral 650 ms vivo para modalidad; M1 «falta» y «Hecho» a la vez; P2-10 duplicado con H6; consultas perdidas en capítulos multi-sección; `mid-chapter-recall` sin flexiones.
