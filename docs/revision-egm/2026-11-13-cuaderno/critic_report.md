# Etapa 7: revisión crítica, ronda 1

**Objetivo:** `docs/designs/2026-11-13-cuaderno-repaso.md`, líneas 1–255 (especificación funcional).

**Revisores y estado:**

| Revisor | Estado | Estándar |
| --- | --- | --- |
| `egm-design` | completado | feature-spec-standard |
| `egm-structural` | completado | feature-spec-standard |
| `egm-style` | completado | — |

**Veredicto:** no hay Blockers. La estructura cumple el estándar salvo en Alternativas y Riesgos. Lo que falla de verdad son premisas que el código desmiente y riesgos que no se recogen.

Cada hallazgo indica su origen con el formato `<revisor>-1-<n>`, donde `d` es diseño, `s` es estructura y `st` es estilo. **[5]** y **[6]** marcan los hallazgos que ya salieron en las etapas 5 y 6.

---

## 🟡 Major

### C1. D2: el pie fijo en móvil tapa opciones y choca con otros elementos fijos
`d-1-1`, `st-1-1`, `st-1-2`, `s-1-4` [5: M6] [6: 1, 2]

- El objetivo dice «no mueve la página», pero el paso 3 hace `scrollIntoView`.
- «Siempre a la vista» se contradice con la frase siguiente, «actúa si el pie no se ve».
- Un pie fijo de unos 150 px tapa la opción tocada o la correcta.
- No reserva `env(safe-area-inset-bottom)`.
- Choca con `.mini-reader-bar`, que es `fixed` (`app.css:1049`), y con `.app-notices` durante la sesión (`app.css:361`).

**Propuesta:** quitar el paso 3. En móvil, fijar solo «Continuar», con safe-area, y dejar la corrección en el flujo normal. Ocultar `.mini-reader-bar` durante la sesión. Recoger los avisos en Risks.

### C2. D3: bajar el alto de las opciones parte de una premisa falsa y no hay presupuesto de alto
`d-1-2`

- `.btn` ya usa `padding: var(--s-2)` (`components.css:41`).
- `game.css:5611-5617` fuerza `min-height: 48px !important` en `.choice-option`.
- `game.css:5639-5644` fuerza `padding !important` por debajo de 400 px.
- No se sabe de dónde salen los 66 px.
- El objetivo «cabe en 1440×900 y 390×844» no tiene cifras por bloque.

**Propuesta:** medir los 66 px reales. Escribir un presupuesto vertical por bloque para los dos tamaños. Decidir qué hacer con los `!important`.

### C3. D4: `aria-disabled` rompe el estilo de resultado y no se comparó con la alternativa simple
`d-1-3`, `s-1-1`, `s-1-3` [5: M5]

- Sin `disabled`, `.btn:hover:not(:disabled)` (0,3,0) gana sobre `.is-correct` (0,2,0): el borde de acierto o error se pierde al pasar el ratón.
- Vuelven `translateY(1px)` y `cursor: pointer`.
- Se pierde la guarda `|| grading`.
- Las opciones respondidas vuelven a recibir foco con el tabulador.

**Propuesta:** mantener `disabled` y usar `.choice-option:disabled { opacity: 1 }`. Atenuar las opciones neutras con `:not(.is-correct):not(.is-wrong)`. Reutilizar `lecta-shake` y `pop-match` y el ✓ con `::after`.

### C4. D4: el contraste no se verifica y la premisa del «tinte» es falsa
`d-1-4`, `st-1-3`, `d-1-N5`, `s-1-7` [6: 4]

- En `papel` y `blanco`, `--vermilion-wash` es el opaco `#f3ddd5`, no un tinte.
- Los dos tokens ya existen en los cinco temas, así que la prueba propuesta pasa hoy sin ningún cambio.
- El objetivo nombra 3 temas y la prueba, 5 (faltan `oled` y `auto-dark`).

**Propuesta:** una prueba que calcule el contraste de `--ink` sobre cada wash compuesto sobre `--paper-raised`, en los cinco temas, con umbral ≥ 4.5:1.

### C5. D5: la racha cuenta doble
`d-1-5` (nuevo)

`answerOption` suma `combo` al acertar (`useReviewSession.ts:552`) y `grade` lo vuelve a sumar al pulsar «Continuar» (`:490-501`). Con 2 aciertos la racha ya marca 3. Además, `grade` pisa la pose y la frase que puso `answerOption`.

Este error ya existe hoy: el «x3 racha» de la captura puede ser falso.

**Propuesta:** contar la racha en un solo punto, que solo `grade` sume. Añadir una prueba.

### C6. D6: reutilizar el `keydown` permite responder dos veces
`d-1-6`, `s-1-3` [5: M7]

- Las dependencias son `[queue, revealed]` (`:663-694`), así que el handler ve `answered = null` aunque ya se haya respondido.
- Un segundo número pisa la respuesta, vuelve a sumar `combo` y registra otro `answerItem`.
- Un Enter global duplica la activación nativa de «Continuar».
- Hay que quitar la salida temprana `EXERCISE_MODES` (`:677`).
- Falta saber si «Acepción» puede tener más de 4 opciones.

**Propuesta:** añadir `answered` a las dependencias o usar un ref. No manejar Enter. Añadir una prueba de «responder dos veces».

### C7. D1: Aprender no tiene cierre y la respuesta pendiente se pierde
`d-1-7`, `d-1-N4`, `s-1-3` [5: M1, M2] [6: 3]

- `useLearnSession` no tiene un cierre a mitad de sesión.
- `setLearn(null)` descarta `learn.kept`.
- `endSessionForToday` ignora una respuesta ya contestada pero sin «Continuar», aunque `answerItem` ya la anotó.
- Con algo repasado, la salida lleva a «Terminado por hoy», no a la portada.
- «‹ Cuaderno» repite «Terminar por hoy».
- Un toque accidental en móvil cierra la sesión.

**Propuesta:** una sola salida, «Terminar por hoy», en `notebook-bar`, que primero califique la respuesta pendiente. Definir el cierre de Aprender: qué pasa con `kept` y si el puente de repaso se conserva. Corregir el destino descrito.

### C8. D5: tocar el gato tiene un coste de IA que no se recoge
`d-1-8` (nuevo)

`askCatHint` hace POST a `/api/lexicon/explain` (`lexicon.ts:514`) en cada toque, aunque ya haya `hintText`, e infla `hintsUsedRef`. Con un gato más grande habrá más toques.

**Propuesta:** solo el primer toque de cada tarjeta pide la pista; los siguientes dan la reacción de mimo. Añadirlo a Risks.

### C9. Alternativas incompletas y fuera de su sección
`s-1-1`, `s-1-2`

Solo P2 tiene alternativas. La de D1 está metida en línea (l.146). D3 a D6 no tienen ninguna.

**Propuesta:** reunirlas todas en una sección agrupada por D1–D6.

### C10. Risks sin mitigaciones
`s-1-3`

- El título no es «Risks & Mitigations».
- Bundle y sticky no tienen control.
- No hay línea de seguridad.
- Faltan los modos de fallo de C3, C6, C7 y C8.

### C11. «Modo» y «pista» se usan con dos o tres significados
`st-1-4`, `st-1-5` [6: 6]

«Modo» nombra el ejercicio, el carácter del gato y la presentación `overlay`. «Pista» nombra la ayuda del gato y la leyenda de teclas.

**Propuesta:**
- «modo» solo para el ejercicio.
- «carácter del gato» para Animado y Tranquilo.
- «presentación» para `overlay`.
- «leyenda de atajos» para la leyenda de teclas.

### C12. El título de D2.1 no coincide con lo que describe
`st-1-6`

Dice «espacio reservado», pero no se reserva nada.

**Propuesta:** decidirlo y renombrarlo.

---

## 🟢 Nit

- **`d-1-N1`:** `nb-card-back` solo aparece en «Elegir palabra». D2 no dice qué muestra el pie en «Acepción» y «Contexto».
- **`d-1-N2`:** un borde de 2 px al responder empuja las opciones de abajo. Mejor usar `box-shadow` interior o un borde transparente de 2 px desde el inicio.
- **`d-1-N3`, [5: N1]:** `prefers-reduced-motion` por componente ignora `html[data-cat-motion="full"]`.
- **`d-1-N5`:** `PracticeCompanionHeader` no recibe ningún setter de pose; hace falta una prop nueva.
- **`s-1-5`:** «paso 2/3» se repite en P2 y en D2. Las etiquetas H1–H3 de los hallazgos chocan con los niveles de encabezado.
- **`s-1-6`:** los hallazgos adicionales tienen un formato distinto al de P1–P4.
- **`s-1-7`:** D6 no tiene un objetivo asociado.
- **`s-1-8`:** hay líneas citadas que no coinciden con el código. El foco está en `:704`, no en `:703`. El `keydown` empieza en `:663`. En P4 ya existe la frase de racha.
- **`s-1-9`, `st-1-N1`:** los títulos están en inglés y el cuerpo en español.
- **`s-1-10`, `st-1-N13`:** la l.196 es demasiado larga y no aclara si `--success-wash` existe.
- **`st-1-N2`:** «gato más presente» y «pequeño y pasivo» son juicios. Mejor un título con hechos.
- **`st-1-N3`:** «tres mejoras» y «Hallazgos adicionales» nombran lo mismo.
- **`st-1-N4`:** «bajo el pliegue» es un calco.
- **`st-1-N5`:** la intención de ocultar la barra no cita fuente, y una frase repite el título.
- **`st-1-N6`:** en l.59-61 el desplazamiento por el foco se explica dos veces.
- **`st-1-N7`:** «se nota menos» no da una medida.
- **`st-1-N8`:** «solo ronronea» es ambiguo: ¿sonido, vibración o metáfora?
- **`st-1-N9`:** «alto vertical» es redundante y no da una cifra.
- **`st-1-N10`:** «PC» y «escritorio» se usan para lo mismo. Mejor un solo término definido como ≥ 64rem.
- **`st-1-N11`:** la etiqueta del botón de `overlay` sale de `backLabel`.
- **`st-1-N12`:** «las cuatro ramas» no está definido.
- **`st-1-N14`:** hay predicciones presentadas como hechos: «el pie cabe», «JSX pequeño», «hay que comprobarlo». Además, «marca el momento» es relleno.

---

## Lo que el código confirma

- P1, P3 y la causa raíz de P2 (`focus()` sin `preventScroll`).
- El alcance es solo del cliente.
- El rechazo de 100dvh tiene un motivo dado.
