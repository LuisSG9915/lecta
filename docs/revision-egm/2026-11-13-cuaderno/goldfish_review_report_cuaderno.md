Status: resolved (auto accept, 12 Major + Nits aplicados; 1 CONTEST)

# Informe de revisión Goldfish anotado: etapa 7, ronda 1

**Objetivo:** `docs/designs/2026-11-13-cuaderno-repaso.md`, líneas 1–255.
**Hallazgos de origen:** `critic_report.md`, de C1 a C12 más los Nits.

**Por qué este archivo tiene otro nombre:** ya existe un `goldfish_review_report.md` sin versionar de otra revisión (`docs/plan-lectura-flaquezas.md`). Para no pisarlo, este se llama `goldfish_review_report_cuaderno.md`, igual que el precedente `goldfish_review_report_planes.md`.

**Verificaciones propias en el código antes de clasificar:**
- La racha se cuenta dos veces: `answerOption` suma en `useReviewSession.ts:552` y `grade` vuelve a sumar en `:491`.
- Las opciones de respuesta llevan `!important` en `game.css:5611-5617` (`min-height: 48px`) y en `:5639-5644` (padding por debajo de 400 px).
- `.mini-reader-bar` es `fixed` en `app.css:1049`.
- `askCatHint` (`:737`) no comprueba si ya hay `hintText`. La cabecera oculta el botón de pista, pero un toque en el gato sigue llamando a `onAskHint`.

## Hallazgos priorizados y sugerencias

### [1] C1, de `egm-design`, `egm-style` y `egm-structural`. Major
* **Alcance:** D2, líneas 150–172, y Goals, líneas 107–111.
* **Problema:** el pie fijo en móvil tapa las opciones. `scrollIntoView` contradice el objetivo «la opción no se mueve». Falta el safe-area. Choca con `.mini-reader-bar` y con `.app-notices`.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * Reescribir D2 con dos mecanismos:
    1. La corrección se pinta debajo de las opciones (`.nb-answer-foot`).
    2. El foco usa `preventScroll: true` en las ramas del efecto de `useReviewSession.ts:700-705`: calificaciones, «Continuar», área de escritura y «Mostrar respuesta».
  * Quitar `scrollIntoView`.
  * Por debajo de 64rem, solo el botón «Continuar» es `sticky` (`bottom: env(safe-area-inset-bottom)`). La palabra y el significado siguen en el flujo normal.
  * `.mini-reader-bar` se oculta durante la sesión con la misma regla que la barra de navegación.
  * Reformular el Goal como «responder no desplaza la página ni cambia la posición de las opciones».
  * Añadir a Risks la convivencia con `.app-notices`.

### [2] C2, de `egm-design`. Major
* **Alcance:** D3, líneas 183–185, y Goals, línea 109.
* **Problema:** la propuesta de bajar el padding parte de una premisa falsa, porque `.btn` ya usa `--s-2` y `game.css` impone `!important`. Además, no hay un presupuesto de alto.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * Quitar el punto del padding.
  * Sustituirlo por una tabla de presupuesto vertical por bloque a 1440×900 y a 390×844: cabecera, píldora, tarjeta con contexto de 1 línea, 4 opciones de 48 px con 8 px de separación, y pie.
  * Dejar las alturas medidas como paso 0 del plan, con la captura actual.
  * No se tocan los `!important` de `game.css`: el mínimo de 48 px es el objetivo táctil y se mantiene.

### [3] C3, de `egm-design` y `egm-structural`. Major
* **Alcance:** D4, líneas 189–191.
* **Problema:** usar `aria-disabled` rompe el estilo del hover y quita la guarda `|| grading`. Tampoco se compara con la alternativa simple.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * Mantener `disabled`.
  * Añadir `.choice-option:disabled { opacity: 1 }` y atenuar las neutras con `.choice-option:disabled:not(.is-correct):not(.is-wrong) { opacity: .55 }`.
  * Reutilizar `pop-match`, `lecta-shake` y el ✓ por `::after` de `.match-option.is-done`, y añadir ✕ para el error.
  * Pasar `aria-disabled` a Alternativas como opción descartada.

### [4] C4, de `egm-design` y `egm-style`. Major
* **Alcance:** D4, líneas 194–207, y Goals, línea 113.
* **Problema:** se describe `--vermilion-wash` como un tinte, pero en `papel` y `blanco` es opaco. La prueba propuesta pasa hoy sin cambios. El documento habla de 3 temas cuando hay 5.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * Decir que los dos wash ya existen en los cinco temas (`papel`, `blanco`, `noche`, `oled` y `auto-dark`).
  * Sustituir la prueba por una que calcule el contraste de `--ink` sobre cada wash compuesto sobre `--paper-raised`, con umbral ≥ 4.5:1, en los cinco temas.
  * Cambiar el borde a 2 px transparente desde el estado inicial (absorbe N2).

### [5] C5, de `egm-design`. Major
* **Alcance:** D5, línea 215.
* **Problema:** la racha se cuenta dos veces.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * Nuevo P5 en The Problem: la racha suma en `answerOption` y en `grade`. Es un bug actual.
  * En D5: `answerOption` decide la pose y la frase según `combo + 1`, sin escribirlo. Solo `grade` escribe `combo`, y no pisa la frase si `answered` ya la fijó.
  * Prueba: dos aciertos seguidos dejan `combo === 2`.

### [6] C6, de `egm-design` y `egm-structural`. Major
* **Alcance:** D6, líneas 228–231.
* **Problema:** el `keydown` usa un closure con estado viejo y Enter se ejecuta dos veces.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * Quitar la salida temprana de `EXERCISE_MODES` (`:677`) solo para `choose`, `sense` y `context`.
  * Añadir `answered` a las dependencias.
  * Si `answered` existe, los números no hacen nada.
  * No se maneja Enter: el foco nativo en «Continuar» basta.
  * Las teclas aplican solo hasta el número de opciones (máximo 4 en `choiceOptions`). Si `senseLikeOptions` tiene más, solo funcionan las 4 primeras.
  * Prueba: pulsar «2» después de responder con «1» no cambia `answered`.

### [7] C7, de `egm-design`. Major
* **Alcance:** D1, líneas 129–147.
* **Problema:** Aprender no tiene cierre, se pierde la respuesta pendiente, el destino está mal descrito y el botón está duplicado.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * Una sola salida: «Terminar por hoy» pasa del final de la tarjeta a `notebook-bar`, en las presentaciones `page` y `overlay`.
  * Si hay `answered` pendiente, primero se llama a `grade` con su resultado y después a `endSessionForToday`.
  * El destino es `ReviewDone` si ya se repasó algo y la portada si no.
  * Aprender: el mismo botón llama a un `endLearnForToday` nuevo en `useLearnSession`. Ese cierre conserva `kept` y muestra la pantalla final que ya existe, con el puente «Repasar estas N palabras». No descarta nada.
  * Añadir a Risks: un toque accidental termina la sesión. Se mitiga porque lo calificado ya se guardó y la cola restante sigue vencida en la portada.

### [8] C8, de `egm-design`. Major
* **Alcance:** D5, líneas 217–221.
* **Problema:** cada toque al gato cuesta IA.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * `askCatHint` sale si `hintText` ya es de la tarjeta actual. Solo el primer toque pide pista; los siguientes llaman a una prop nueva `onPet`, que usa `setCatPose` y `settleCatAfter` del hook. Esto absorbe N5 de diseño.
  * Añadir el coste a Risks.

### [9] C9, de `egm-structural`. Major
* **Alcance:** Alternatives, líneas 233–241.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:*** agrupar las alternativas por D1–D6:
  * D1: barra siempre visible.
  * D2: avanzar sin «Continuar», y 100dvh.
  * D3/D5: gato en columna lateral en escritorio, propuesta de la etapa 5 (IC-1). Se descarta porque cambia el layout de toda la sesión. Se adopta un avatar de 72 px fijo en todos los tamaños, con escala `transform` a 1.25 durante la reacción.
  * D4: `aria-disabled`.
  * D6: manejar Enter globalmente.

### [10] C10, de `egm-structural`. Major
* **Alcance:** Risks, líneas 243–254.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * Renombrar la sección a «Risks & Mitigations» y darle una mitigación a cada riesgo.
  * Bundle: `check:size` en `pnpm gate` falla por encima de 215 kB.
  * Sticky: el paso del plan comprueba con `getComputedStyle` que ningún ancestro de `.nb-answer-foot` tenga `overflow` distinto de `visible`. Si lo hay, se cambia esa regla.
  * Seguridad: no hay rutas nuevas, ni datos nuevos que salgan del cliente, ni cambios de auth. La única llamada de red afectada es `/api/lexicon/explain` (ver [8]).
  * Añadir los riesgos de [1], [7] y [8].

### [11] C11, de `egm-style`. Major
* **Alcance:** todo el documento.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:***
  * «modo» se usa solo para el tipo de ejercicio.
  * «carácter del gato» se usa para Animado, Tranquilo y Oculto.
  * «presentación» se usa para `page` y `overlay`.
  * «leyenda de atajos» sustituye a «pista de teclas».
  * Añadir un glosario breve tras Overview con los términos del producto: Cuaderno, Biblioteca, Tú, portada, Aprender, repaso y racha. Esto cubre el hallazgo 7 de la etapa 6.

### [12] C12, de `egm-style`. Major
* **Alcance:** D2.1, línea 153.
* ***Sugerencia:*** PROPOSE FIX.
* ***Edición propuesta:*** el título pasa a ser «La corrección baja debajo de las opciones». No se reserva espacio, porque la ranura vacía antes de responder gastaría el alto que pide C2.

### [13] Nits que se arreglan porque son baratos o porque [1]–[12] ya tocan esas líneas
* **Sugerencia:** PROPOSE FIX.
* **`d-1-N1`:** en «Acepción» y «Contexto» el pie solo muestra «Continuar», porque la opción correcta ya está marcada.
* **`d-1-N3`:** las poses dependen de la regla global de `base.css:134` y de `.cat-anim`. No hay manejo propio de `prefers-reduced-motion`.
* **`s-1-5`:**
  * Las etiquetas H1–H3 pasan a ser A1–A3.
  * Los pasos de P2 pasan a ser a, b y c.
* **`s-1-7`:** añadir un Goal para el teclado.
* **`s-1-8`:** corregir las líneas citadas.
  * El foco está en `:704`.
  * El `keydown` está en `:663` y la salida en `:677`.
  * P4 ya tiene una frase de racha.
* **`s-1-10`/`st-1-N13`:** volver a ajustar la línea 196.
* **`st-1-N2`:** P4 pasa a llamarse «El gato mide 56 px y reacciona solo a acierto y error».
* **`st-1-N5`:** citar la fuente de la intención, que es el comentario de `app.css:325-328`, y borrar la frase que repite.
* **`st-1-N6`:** dejar una sola explicación del desplazamiento.
* **`st-1-N8`:** «ronronea» significa sonido y vibración (`playCompanionSound("purr")` y `triggerHaptic`), sin cambio de pose.
* **`st-1-N10`:** usar «escritorio (≥ 64rem)» y «móvil (< 64rem)» en todo el texto.
* **`st-1-N11`:** decir que la etiqueta del botón en `overlay` sale de `backLabel`.
* **`st-1-N12`:** nombrar las ramas.
* **`st-1-N14`:** convertir las predicciones en criterios y borrar «marca el momento».

### [14] `s-1-9`/`st-1-N1`: títulos en inglés y cuerpo en español. Nit
* ***Sugerencia:*** CONTEST.
* ***Justificación:*** el documento sigue la convención de la plantilla de diseños del repositorio. `docs/designs/2026-11-12-planes-y-landing.md`, aprobado, usa los mismos títulos en inglés («Overview», «The Problem», «Goals»), metadatos en inglés y cuerpo en español.

### [15] Resto de Nits. Se registran y no se aplican
* ***Sugerencia:*** DECLINE.
* **`s-1-6`:** el formato de los hallazgos adicionales queda resuelto con A1–A3.
* **`st-1-N3`:** «tres mejoras» frente a «Hallazgos adicionales» se unifica a «hallazgos adicionales» de paso.
* **`st-1-N4`:** «bajo el pliegue» se cambia de paso.
* **`st-1-N7`:** «se nota menos» se borra.
* **`st-1-N9`:** «alto vertical» lo cubre la tabla de presupuesto de [2].

## Recuento

- PROPOSE FIX: 12 Major y 1 grupo de Nits.
- CONTEST: 1.
- ESCALATE: 0.
- DECLINE: 1 grupo de Nits.
