# Cuaderno: salida del repaso, respuesta sin saltos y reacciones del gato

*   **Author:** LuisSG9915
*   **Status:** Draft revisado. Revisión Goldfish: etapas 5–9 completas (7 y 9
    con re-auditoría); arreglos aplicados. Pendiente la aprobación del autor.
*   **Date:** 2026-11-13
*   **Contexto de entrada:** petición de Luis del 2026-11-13 con captura del
    repaso en tema `papel` a 2000×1100 px («Elegir palabra», reto 3 de 5).

--------------------------------------------------------------------------------

## Overview

Luis reporta cuatro problemas del repaso del Cuaderno:

1.  No hay forma de volver a Biblioteca ni a Tú (ajustes) desde el Cuaderno
    mientras hay un repaso en curso.
2.  Al elegir una opción, la página da un salto. Para ver las opciones y el
    botón «Continuar» hay que desplazarse hacia abajo en cada ejercicio, en
    escritorio y en móvil.
3.  En tema claro las opciones respondidas se ven tan pálidas que no se distingue
    si la respuesta estuvo bien o mal.
4.  El gato es pequeño y casi no reacciona.

Este documento explica la causa de cada problema en el código actual, propone el
arreglo y suma cuatro hallazgos adicionales detectados al revisar el módulo
(A1–A4), uno de ellos un bug actual del contador de racha. Todo es código de
cliente: no hay migraciones, ni rutas nuevas del Worker de Cloudflare, ni
secrets.

### Glossary

*   **Cuaderno:** la sección de palabras guardadas (`Vocabulary.tsx`). Su
    **portada** es la vista sin sesión: héroe con el gato, botón «Repasar» o
    «Aprender» y la lista de palabras.
*   **Biblioteca** y **Tú:** las otras secciones de la barra de navegación
    (`AppNav.tsx`); Tú contiene los ajustes.
*   **Repaso:** sesión de ejercicios sobre palabras vencidas. Estado `queue` en
    `useReviewSession.ts`. Cada ejercicio es un **reto**.
*   **Aprender:** sesión de primera exposición con fichas («Ya la conozco» /
    «Quiero aprenderla»). Estado `learn` en `useLearnSession.ts`; `learn.kept`
    son las palabras marcadas para aprender.
*   **Modo:** el tipo de ejercicio.
    *   Con opciones: «Elegir palabra» (`choose`), «Acepción» (`sense`) y
        «Contexto» (`context`).
    *   De autocalificación: «Significado», «Palabra» y los huecos (`meaning`,
        `form`, `cloze`, `clozeNew`): el lector revela la respuesta y se
        califica con las teclas 1–4.
    *   «Escribir» (`write`): el lector escribe una oración y la IA la revisa.
    *   Minijuegos: parejas (`match`), descifrar, categoría y ordenar frase.
*   **Carácter del gato:** «Animado», «Tranquilo» u «Oculto»
    (`PracticeCompanionMode`). En Tranquilo el gato no cambia de pose.
*   **Presentación:** `page` (pestaña Cuaderno) u `overlay` (Cuaderno abierto
    desde el lector).
*   **Racha:** aciertos seguidos dentro de la sesión (`combo` en
    `usePracticeCompanion.ts`).
*   **Escritorio:** ancho ≥ 64rem. **Móvil:** < 64rem.
*   **Alto útil:** `window.innerHeight`, el alto visible del documento sin la
    interfaz del navegador. Los criterios de alto de este documento se miden
    en alto útil, no en tamaño de pantalla.

## The Problem

### P1. El repaso no tiene salida

`app.css:329` oculta la barra de navegación mientras el Cuaderno tiene una
sesión:

```css
.app[data-nav="vocabulary"]:has(.notebook[data-session]) .app-nav { display: none; }
```

`Vocabulary.tsx` solo pinta el botón de volver cuando la presentación es
`overlay`; su etiqueta sale de la prop `backLabel` («‹ Volver al libro» desde el
lector). En la presentación `page` la cabecera solo tiene el título «Repaso» y el
contador. La única salida del repaso es «Terminar por hoy», al final de la
tarjeta, que sin desplazarse queda fuera de la ventana; queda también el botón
«atrás» del navegador. Aprender tiene el mismo problema con su «Terminar por
ahora» (`LearnSessionView.tsx:265-271`), también al final.

El comentario de `app.css:325-328` da la intención: dejar la sesión a pantalla
completa.

### P2. El salto al responder

Al tocar una opción en un modo con opciones pasan tres cosas en el mismo render:

1.  `answerOption` (`useReviewSession.ts:546`) fija `answered`.
2.  Solo en «Elegir palabra», `PracticeCard.tsx:409-414` inserta
    `<p className="nb-card-back">` **dentro** de la tarjeta, encima de las
    opciones. En la captura ocupa ≈ 90 px, así que las opciones bajan ese alto.
3.  «Continuar» se monta **después** de la lista de opciones, y el efecto de
    `useReviewSession.ts:702-707` lo enfoca (`continueRef.current?.focus()`,
    línea 704). `focus()` sin `preventScroll` desplaza la página hasta el
    botón, que a 1100 px de alto queda por debajo de la ventana.

(2) mueve el contenido y (3) mueve la ventana. En «Acepción» y «Contexto» solo
ocurre (3).

Además, el ejercicio mide más que la ventana antes de responder: la cabecera del
gato (≈ 230 px con barra de progreso, fila del gato y fila de acciones), la
píldora «Eco de» (el libro de donde viene la palabra), la tarjeta con contexto y
cuatro opciones de ≈ 66 px. En la captura la cuarta opción ya no se ve.

### P3. Colores pálidos en tema claro

`base.css:87` aplica `opacity: 0.45` a todo `button:disabled`. Al responder,
`PracticeCard.tsx:485` y `:506` deshabilitan **todas** las opciones
(`disabled={Boolean(answered) || grading}`), incluidas la correcta y la
elegida. `.choice-option.is-correct` (`notebook.css:494`) solo cambia borde,
color de texto y peso. Resultado: texto salvia `#43694d` al 45 % sobre papel
crema, sin cambio de fondo.

### P4. El gato mide 56 px y solo cambia de pose al acertar

`.practice-cat-avatar` mide 56×56 px (`notebook.css:299`). En los modos con
opciones el gato pasa a `celebrate` al acertar («¡Exacto!» o «¡En racha!
xN») y a `idle` al fallar («¡Ánimo! Vamos con la siguiente.»,
`useReviewSession.ts:546-566`). Tocarlo llama a `onAskHint` (`handleCatClick`,
`PracticeCompanionHeader.tsx:70`). Sin pista disponible (sin sesión o en
«Escribir»), tocarlo solo reproduce el ronroneo (`playCompanionSound("purr")`
y vibración), sin cambio de pose ni de frase.

### Additional Findings

#### A1. El progreso se muestra tres veces

«3 de 5» en `notebook-count`, «Reto 3 de 5» con barra en la cabecera del gato y
«Elegir palabra · 3 de 5» en `nb-practice-counter`. Juntos ocupan ≈ 50 px.

#### A2. Las opciones no tienen teclado

En los modos de autocalificación, 1–4 califican y Espacio revela
(`keydown` de `useReviewSession.ts:663-694`). En los modos con opciones el
handler sale en la línea 677 (`EXERCISE_MODES`): solo ratón o tabulador.

#### A3. La fila de acciones del gato ocupa una fila entera

«💡 Pista» y el selector de carácter («Animado») ocupan una fila propia de
≈ 60 px con solo dos controles.

#### A4. La racha se cuenta dos veces (bug actual)

`combo` se suma dos veces por acierto en todos los modos que no son de
autocalificación: primero donde se muestra el resultado y luego en `grade`
(`useReviewSession.ts:490-501`, que suma en todo acierto):

*   Modos con opciones: `answerOption` (`:552`) y después `grade` al pulsar
    «Continuar».
*   Descifrar, categoría y ordenar frase: `onSolve`
    (`PracticeCard.tsx:208-218, 238-248, 267-277`) y después `grade`.
*   Parejas: `pickMeaning` suma por pareja (`useReviewSession.ts:625-635`) y
    `finishMatchTanda` llama a `grade` por cada palabra.

Con dos aciertos seguidos en «Elegir palabra» el contador ya marca 3; el «x3
racha» de la captura puede corresponder a dos aciertos. `grade` también pisa la
frase y la pose del resultado y deja `celebrate` con un temporizador de 2200 ms
que sigue en el reto siguiente.

## Goals

*   Desde cualquier punto del repaso o de Aprender, sin desplazarse, hay a la
    vista un botón que termina la sesión y lleva a la pantalla de cierre o a la
    portada; desde ahí se llega a Biblioteca y a Tú. En escritorio la barra de
    navegación está visible todo el tiempo.
*   Responder una opción no desplaza la página ni cambia la posición de las
    opciones dentro de la tarjeta.
*   En «Elegir palabra» con contexto de una línea:
    *   Con alto útil ≥ 800 px en escritorio (1440×800), las cuatro opciones, la
        corrección y «Continuar» caben sin desplazarse.
    *   Con alto útil ≥ 750 px en móvil (390×750), las cuatro opciones y
        «Continuar» caben sin desplazarse.
    *   Con menos alto útil (1366×650, 390×664), «Continuar» queda siempre a la
        vista y la opción tocada no se mueve; antes de responder puede hacer
        falta desplazar para ver la última opción, y el botón fijo puede tapar
        hasta 56 px de la corrección hasta que el lector desplace.
*   Una opción respondida comunica acierto o error sin depender solo del color,
    con contraste de texto ≥ 4.5:1 en los cinco temas (`papel`, `blanco`,
    `noche`, `oled` y `auto-dark`), comprobado por prueba, y el resultado se
    anuncia al lector de pantalla aunque el gato esté oculto.
*   El gato mide 72 px, crece durante la reacción, reacciona distinto a acierto,
    error y racha, y responde al toque aunque no haya pista.
*   La racha cuenta cada acierto una sola vez en todos los modos.
*   En escritorio, las teclas numéricas eligen una opción en los modos con
    opciones.

## Non-Goals

*   No se cambian los modos, su orden, la cantidad de opciones ni la
    calificación FSRS. «Acepción» puede mostrar más de cuatro acepciones; ese
    caso queda fuera del objetivo de alto.
*   No se cambian los tableros de los minijuegos. Heredan la cabecera compacta,
    la regla de racha y la pista fuera del globo (D3), que solo les quita un
    duplicado.
*   No se añaden poses ni ilustraciones: se usan las de `CompanionPose`.
*   La sesión de Aprender (`LearnSessionView`) también usa
    `PracticeCompanionHeader`, así que hereda D3 y D5; de sus fichas solo cambia
    la posición del botón de cierre (D1).
*   No se toca el lector.

## Proposed Design

### D1. Terminar la sesión desde la cabecera (P1)

El botón que termina la sesión sube del final de la tarjeta a la cabecera
(`notebook-bar`), a la izquierda del título, en las presentaciones `page` y
`overlay`, mientras haya repaso o Aprender en curso. Es la única forma de
terminar la sesión dentro del Cuaderno; el botón del final desaparece. En
Aprender, «Terminar por ahora» pasa a llamarse «Terminar por hoy» para que las
dos sesiones usen la misma etiqueta. En `overlay`, «‹ Volver al libro»
(`backLabel`) sigue cerrando el Cuaderno entero.

Durante la sesión, `.notebook-bar` pasa a `position: sticky; top: 0` (hoy es
`static` en `page`, `notebook.css:38-44`), con el fondo de papel, así que el
botón sigue a la vista aunque se desplace la tarjeta.

**Repaso.** Al tocar el botón:

1.  Si `grading` es verdadero, el botón está deshabilitado: hay una
    calificación en curso.
2.  Si hay una respuesta sin confirmar (`answered`), se llama a `grade` con su
    resultado. `grade` pasa a devolver `Promise<boolean>`: `true` si guardó la
    calificación, `false` si salió sin calificar (la salida temprana de
    `gradingRef`, `useReviewSession.ts:455`) o si el guardado falló (su
    `catch`, `:534-535`, que ya fija `saveError`). Con `false` el cierre se
    cancela y queda a la vista el `saveError`.
3.  `endSessionForToday(now, extra)` recibe un segundo argumento: 1 si el paso 2
    calificó, 0 si no. Lo suma al `reviewed` que calcula hoy con la cola
    capturada en el render, que todavía no refleja el reto recién quitado.
4.  Si se repasó al menos un reto, la sesión termina en `ReviewDone`
    («Terminado por hoy»); si no, vuelve a la portada.

Otros estados pendientes al salir: en «Escribir», un `writePick` sin confirmar
se califica igual que `answered`; una tanda de Parejas a medias se descarta (sus
palabras siguen vencidas); con `verifying` en curso (la IA revisa la oración) el
botón está deshabilitado, igual que con `grading`.

**Aprender.** El botón ejecuta lo que hoy hace «Terminar por ahora»:
`setLearn({ ...learn, done: true })`, que muestra la pantalla final existente
(`LearnSessionView.tsx:65-110`) con «Repasar estas N palabras» si `learn.kept`
no está vacío. Las palabras de `learn.kept` se conservan. Si no se vio ninguna
ficha (`learn.items.length === learn.total`), vuelve a la portada
(`setLearn(null)`), igual que el repaso. El botón está deshabilitado mientras
`learnBusy`, como los botones de la ficha.

**Navegación.** La barra de navegación sigue oculta durante la sesión en móvil,
pero se muestra en escritorio, donde es un riel lateral que no quita alto: la
regla de `app.css:329` pasa a vivir dentro de `@media (width < 64rem)`. Ir a
otra sección en escritorio a mitad de sesión deja el Cuaderno montado dentro de
su `<Activity>` oculto; al volver la sesión sigue donde estaba.

### D2. Responder sin salto (P2)

1.  **La corrección baja debajo de las opciones.** Se añade un pie
    (`.nb-answer-foot`) debajo de `.choice-list`. Contiene:
    *   Siempre, un texto con `role="status"`: «Correcto» o «Incorrecto: era
        «…»» con la forma o la acepción correcta. Así el resultado se anuncia
        aunque el gato esté oculto o desactivado. Es la única región que anuncia
        el resultado: el pie hereda el `role="status"` que hoy tiene
        `nb-card-back` (`PracticeCard.tsx:410`), y el globo del gato
        (`PracticeCompanionHeader.tsx:152`) pasa de `role="status"` a
        `aria-live="off"` cuando recibe `onCatTap` (repaso y Aprender), porque
        sus frases repiten el resultado. Sin `onCatTap` (`ReviewDone.tsx:32-38`,
        `GamePanel.tsx:585-591`) conserva `role="status"`.
    *   En «Elegir palabra», además, la palabra y su significado (lo que hoy es
        `nb-card-back` dentro de la tarjeta).
    *   En «Acepción» y «Contexto» el texto de estado es visualmente oculto
        (`.visually-hidden`), porque la opción correcta ya se ve marcada.
2.  **Foco sin desplazamiento.** El efecto de `useReviewSession.ts:702-707`
    usa `focus({ preventScroll: true })` en sus cuatro ramas: primera
    calificación, «Continuar», área de «Escribir» y «Mostrar respuesta».
3.  **«Continuar» fijo al borde inferior.** Los dos «Continuar» (opciones y
    «Escribir») llevan una clase nueva `.nb-continue`, van en el DOM después de
    `.nb-answer-foot` y llevan
    `position: sticky` y
    `bottom: calc(env(safe-area-inset-bottom) + var(--s-2))` en todos los
    anchos, con el mismo fondo que `.notebook`
    (`var(--grain), var(--surface-herbarium)`) y sombra superior. Sigue siendo hijo directo de
    `.nb-practice` (hoy lo envuelve un fragmento, `PracticeCard.tsx:516-531`,
    que no añade nodo), y no se mete dentro del pie: un `sticky` no sale de la
    caja de su padre, así que dentro del pie no se fijaría si el pie entero
    queda fuera de la ventana. Cuando el contenido cabe, el `sticky` no actúa.
    Cuando actúa, el botón puede tapar hasta 56 px de la corrección hasta que
    el lector desplace; se acepta en los Goals. Durante la sesión
    `.mini-reader-bar` se oculta con la misma condición que la barra de
    navegación.

No hay `scrollIntoView`: el pie aparece debajo de lo que el lector mira y
«Continuar» ya está a la vista.

### D3. Cabecera compacta y presupuesto de alto (P2, A1, A3)

*   **Una sola fuente de progreso:** `notebook-count` («3 de 5»), que siempre se
    ve, incluso con el gato en «Oculto» o desactivado
    (`PracticeCompanionHeader` devuelve `null` sin compañero). La cabecera del
    gato conserva la barra sin texto. `nb-practice-counter` queda solo con el
    nombre del modo («Elegir palabra»).
*   **Cabecera del gato de ≤ 100 px:** `.practice-cat-bar` baja su padding de
    `--s-3` a `--s-2` y su gap a `--s-1`; la barra de progreso pasa a 4 px, sin
    `padding-block-end` ni borde. Con el gato de 72 px queda en
    8 + 4 + 4 + 72 + 8 + 2 (borde) = 98 px.
*   **Acciones en la fila del gato:** «💡 Pista» y el selector de carácter van a
    la derecha del globo y desaparece `.practice-cat-actions`. En móvil son
    iconos de 44×44 px con `aria-label`, para dejar ancho al texto.
*   **Globo de 2 líneas:** con `onCatTap`, `.practice-cat-text` se recorta a 2
    líneas con el bloque que ya usa el repositorio (`display: -webkit-box;
    -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden`,
    como `.nb-word-preview`, `notebook.css:1454-1459`). Sin `onCatTap`
    (`ReviewDone`, `GamePanel`) el globo no se recorta. La pista
    de la IA, que puede ocupar un párrafo, deja de pintarse en el globo y se
    muestra dentro de la tarjeta del reto, debajo del contexto, donde su alto no
    empuja la cabecera. Se reutiliza el patrón que ya usan los minijuegos
    (`.scramble-hint-box` con `role="status"`, `WordScrambleGame.tsx:658-662`).
    Como los minijuegos ya pintan la pista en su tablero, quitarla del globo
    elimina también su duplicado allí. `PracticeCard` pinta la caja en los modos
    con opciones y de autocalificación, debajo del contexto de `.nb-card`; no
    en los minijuegos ni en «Escribir». La cabecera deja de recibir `hintText`;
    el botón «💡 Pista» se oculta cuando el reto actual ya pidió pista (prop
    `hintUsed`, ver D5).
*   **Tarjeta:** `.nb-card` baja sus márgenes verticales de `--s-4`/`--s-5` a
    `--s-3`.
*   **Opciones de 52 px:** el paso 0 del plan mide la altura real de las
    opciones (≈ 66 px en la captura). Se bajan a ≈ 52 px con `line-height: 1.3`
    y el tamaño de letra de `.btn`, sin bajar del `min-height: 48px` de
    `game.css:5611-5617` (objetivo táctil). No se tocan los `!important` de
    `game.css`.

Presupuesto en alto útil para «Elegir palabra» con contexto de una línea:

| Bloque | Escritorio, 800 px | Móvil, 750 px |
| --- | --- | --- |
| Cabecera de la app y `notebook-bar` | ≤ 120 px | ≤ 100 px |
| Cabecera del gato | ≤ 100 px | ≤ 100 px |
| Píldora «Eco de» y modo | ≤ 32 px | ≤ 32 px |
| Tarjeta con contexto de 1 línea | ≤ 180 px | ≤ 200 px |
| 4 opciones (52 px + 8 px de separación) | ≤ 232 px | ≤ 232 px |
| Corrección de 2 líneas | ≤ 60 px | en el flujo, debajo |
| «Continuar» (48 px + `--s-2`) | ≤ 56 px | ≤ 56 px |
| **Total** | **≤ 800 px** | **≤ 720 px** |

### D4. Opciones con resultado legible (P3)

*   Las opciones respondidas **siguen** con `disabled`: el navegador bloquea el
    clic, la opción sale del orden de tabulación y se mantiene la condición
    `|| grading`. Se anula solo la opacidad global:
    `.choice-option:disabled { opacity: 1; }`.
*   Las opciones que no son la correcta ni la elegida se atenúan:
    `.choice-option:disabled:not(.is-correct):not(.is-wrong) { opacity: .55; }`.
*   Todas las opciones llevan `border: 2px solid var(--rule-strong)` desde el
    inicio (el color de `--border-strong`, que es una abreviatura de borde y no
    un color), así que el cambio de color al responder no empuja las de abajo.
*   El fondo de una opción respondida se pinta en capas sobre el fondo de la
    opción: `background: linear-gradient(var(--success-wash),
    var(--success-wash)), var(--paper-raised)` (y lo mismo con
    `--vermilion-wash`). Así el color pintado es el que compone la prueba de
    contraste, aunque `.choice-list` esté sobre el fondo herbario de la página.
*   `.is-correct`: wash `var(--success-wash)`, borde `var(--success)`, texto
    `var(--ink)` en peso 600, ✓ con `::after` como `.match-option.is-done`
    (`notebook.css:579-594`) y una animación nueva `@keyframes lecta-pop`
    (escala 0.97 → 1.02 → 1, 220 ms). `pop-match`, que usa
    `.grammar-cat-btn.is-correct` (`notebook.css:2028`), nunca se definió; esa
    regla pasa a usar `lecta-pop`.
*   `.is-wrong`: wash `var(--vermilion-wash)`, borde `var(--vermilion)`, texto
    `var(--ink)` tachado, ✕ con `::after` y la animación `lecta-shake` que ya
    existe (`notebook.css:2269`).
*   Los dos wash ya existen en los cinco temas de `tokens.css`. En `papel` y
    `blanco`, `--vermilion-wash` es un color opaco (`#f3ddd5`), no un tinte, así
    que el contraste no se da por supuesto: una prueba nueva en
    `tokens.test.ts` calcula el contraste de `--ink` sobre cada wash compuesto
    sobre `--paper-raised` en los cinco temas y exige ≥ 4.5:1.
*   El movimiento depende de la regla global de `base.css:134`; no hay manejo
    propio de `prefers-reduced-motion`.

### D5. Gato más grande y con reacciones (P4, A4)

*   **Tamaño:** `.practice-cat-avatar` pasa a 72 px en todos los anchos. Durante
    una reacción crece el `<Companion>` interior, no el contenedor, con
    `transform: scale(1.25)`, `transform-origin: bottom center` y `z-index: 1`.
    Así no ocupa alto de layout y no choca con el `transform` de
    `.practice-cat-avatar:hover` / `:active` (`notebook.css:312-318`). El
    disparador es un atributo `data-reacting` en `.practice-cat-avatar`,
    presente mientras `catPose !== "idle"` y el carácter no sea «Tranquilo»; la
    regla es `.practice-cat-avatar[data-reacting] .cat-anim`, con
    `transition: transform var(--dur-2) var(--ease-out)`. `data-reacting` solo
    se pone si la cabecera recibe `onCatTap`; en `ReviewDone` y `GamePanel`,
    que fijan `pose="celebrate"`, el gato no queda escalado. El `<svg>` raíz
    de `Companion` ya lleva `.cat-anim` (`Companion.tsx:545`), así que la
    escala solo se anima cuando la regla global de movimiento lo permite o con
    `html[data-cat-motion="full"]`.
*   **Racha en un solo punto (A4):** suma `combo` quien muestra el resultado al
    lector: `answerOption` en los modos con opciones, `onSolve` en descifrar,
    categoría y ordenar frase, y `pickMeaning` por cada pareja en Parejas.
    `grade` solo suma, y solo fija pose y frase, en los modos de
    autocalificación y en «Escribir». Así la píldora «x N racha», que lee
    `combo`, coincide con la frase en el momento de la reacción.
*   **Reacciones por modo.** Mismas poses en todos los modos. «Pose de
    resultado» significa que se guarda en `resultPose` y se mantiene hasta el
    cambio de reto; «temporizador» significa `settleCatAfter(2200)`.

    | Modo | Quién reacciona | Acierto | Error | Mecanismo |
    | --- | --- | --- | --- | --- |
    | `choose` | `answerOption` | `celebrate`; `playful_hop` con racha ≥ 3 | `pet`, `` `Era «${form}». La próxima la tienes.` `` | pose de resultado |
    | `sense`, `context` | `answerOption` | igual | `pet`, `` `Era «${acepción}».` `` con `conciseMeaning(senseLikeOptions[senseLikeAnswer], 60)`; sin `senseLikeAnswer`, «¡Ánimo! Vamos con la siguiente.» | pose de resultado |
    | `scramble`, `grammar`, `syntax` | `onSolve` / `onWrong` en `PracticeCard.tsx` | igual | `pet`, `` `Era «${form}».` `` | temporizador |
    | `match` | `pickMeaning` por pareja | igual | `pet`, «Esa no. Prueba otra.» (hoy `greet`) | temporizador |
    | autocalificación y `write` | `grade` | igual | `pet`, `` `Era «${form}».` `` (hoy `idle`) | temporizador |

    `tryRescue` conserva su pose `greet`: es la reacción de rescate, no de
    error.
*   **Cambio de reto:** un efecto sobre `currentKey` en `useReviewSession`
    llama a `resetCat()` de `usePracticeCompanion`, que cancela el temporizador
    pendiente y pone `resultPose` y `catPose` en `idle`. Así ninguna
    celebración pasa al reto siguiente, en ningún modo.
*   **Toque:** la decisión vive en el hook, no en la cabecera.
    *   **Límite de una pista por reto, dentro de `askCatHint`:** sale también
        si `hintsUsedRef.current > 0` o si `current.mode === "write"`. Así el
        límite vale para el gato, el botón «💡 Pista» y los minijuegos, que
        llaman a `askCatHint` directamente (`PracticeCard.tsx:207, 237, 266`).
        `hintsUsedRef` ya es el contador por reto: se incrementa en
        `askCatHint` (`:741`) y se reinicia en `resetExercise` (`:152`) y en
        `grade` (`:527`). `tryRescue` no lo toca, así que una pista de rescate
        no cuenta como pedida. Hoy `askCatHint` solo sale con
        `!current || hintBusy || !canHint` (`:737-738`).
    *   **`hintUsed`:** estado nuevo (`useState`) que `askCatHint` pone en
        `true` y que se reinicia donde se reinicia `hintsUsedRef`. El hook lo
        expone y `PracticeCard` lo pasa a la cabecera para ocultar «💡 Pista».
    *   **`catTap()`:** pide pista con `askCatHint` solo si no hay `answered` ni
        `writePick`, el modo no es `write`, `canHint` es verdadero y
        `hintUsed` es falso. En cualquier otro caso llama a `pet()`.
    *   **`pet()`:** pone la pose `pet`, una frase de una lista fija («Prrr…»,
        «¡Mrrau!», «Aquí sigo contigo.») y llama a
        `settleCatAfter(1200, resultPose)`. El ronroneo y la vibración siguen
        en la cabecera (`handleCatClick`), que los reproduce antes de llamar a
        `onCatTap`; `pet()` no los repite.
    *   **`usePracticeCompanion`** expone `resultPose`, `setResultPose(pose)`,
        `resetCat()` y `settleCatAfter(ms, to = "idle")`.
    *   `PracticeCompanionHeader` cambia `onAskHint` por `onCatTap` en el toque
        del avatar; el botón «💡 Pista» sigue llamando a `onAskHint`. La prop
        `onPet` de `Companion` (pulsación larga, `Companion.tsx:558`) no se toca.
    *   Aprender: `LearnSessionView` gana la prop `onCatTap: () => void`, que
        reenvía a la cabecera; `Vocabulary.tsx` le pasa `petHeroCat`
        (`:318-325`). Hoy `LearnSessionView.tsx:113-119` no pasa ningún
        manejador de toque.
*   En carácter «Tranquilo» cambian las frases pero no la pose.

### D6. Teclado en las opciones (A2)

*   En `choose`, `sense` y `context`, las teclas 1–9 eligen la opción en esa
    posición, hasta el número de opciones. La salida temprana de la línea 677
    deja de aplicarse a esos tres modos.
*   El efecto añade `answered` a sus dependencias; con `answered` presente los
    números no hacen nada, así que no se puede responder dos veces.
*   Enter no se maneja: «Continuar» ya tiene el foco y Enter lo activa de forma
    nativa.
*   Una leyenda de atajos bajo las opciones («Teclas 1–N eligen») usa
    `.nb-keys-hint` con un modificador nuevo `.nb-keys-hint--kbd`. La leyenda de
    autocalificación (`PracticeCard.tsx:631`) también lo lleva. Solo las
    leyendas con `--kbd` se ocultan sin puntero fino; las demás `.nb-keys-hint`
    (Parejas y minijuegos) son instrucciones táctiles y no cambian.

## Alternatives Considered

*   **D1. Mostrar siempre la barra de navegación en móvil.** Quita 56 px donde
    D3 pide espacio. Descartada.
*   **D1. Un botón «‹ Cuaderno» además de «Terminar por hoy».** Dos controles
    para una acción. Descartada.
*   **D2. Avanzar solo tras el acierto, sin «Continuar».** Quita un toque, pero
    elimina el momento de leer la corrección, que es lo que enseña al fallar.
    Descartada.
*   **D2. Pantalla de 100dvh con opciones en una caja con desplazamiento.**
    Obliga a desplazar dentro de una caja con contextos largos y choca con el
    teclado virtual en «Escribir». Descartada.
*   **D2. Pie entero fijo, con corrección y botón.** Con la corrección
    (≈ 150 px) tapa las opciones justo cuando hay que ver cuál era la correcta.
    Descartada.
*   **D2. `scrollIntoView` hasta el pie al responder.** Mueve la página, que es
    lo que el objetivo prohíbe. Descartada.
*   **D3/D5. Gato en una columna lateral en escritorio.** Libera alto, pero cambia
    el layout de toda la sesión y añade otra rama de CSS. Descartada a favor de
    72 px con escala durante la reacción.
*   **D4. `aria-disabled` en lugar de `disabled`.** Hace que vuelvan a aplicar
    `.btn:hover:not(:disabled)` (especificidad 0,3,0, gana sobre `.is-correct`),
    `translateY(1px)` en `:active` y el foco con tabulador, y pierde la condición
    `|| grading`. Descartada.
*   **D6. Manejar Enter de forma global.** Duplica la activación nativa de
    «Continuar». Descartada.

## Risks & Mitigations

*   **Pruebas existentes.** `Vocabulary.test.ts` y las de PracticeCard que
    busquen `nb-card-back` dentro de `.nb-card` o el botón de cierre al final
    cambiarán. *Mitigación:* se actualizan en el mismo cambio; ninguna se borra
    sin sustituirla.
*   **Auditoría del Cuaderno.** `pnpm audit:cuaderno`
    (`scripts/audit-cuaderno.mjs`) comprueba afirmaciones sobre el Cuaderno
    buscando patrones de código (comprobación `presente`). `pnpm test` solo
    corre `audit-cuaderno.test.mjs`, que prueba el mecanismo con fixtures, no
    las afirmaciones reales, así que `pnpm gate` no detecta una afirmación
    rota. Este cambio rompe dos: C4 (`role="status"` en `nb-card-back`) y C15
    (`endSessionForToday(Date.now())`). *Mitigación:* el plan actualiza sus
    patrones y el cierre corre `pnpm audit:cuaderno` aparte; ninguna afirmación
    se desactiva.
*   **Tamaño del bundle.** Las reglas CSS nuevas, la lógica de teclado y las
    props nuevas suman bytes. *Mitigación:* el JS nuevo va en el chunk perezoso
    del Cuaderno; `check:size` dentro de `pnpm gate` falla si el JS inicial
    pasa de 215 kB gzip (hoy 208.19 kB) o el CSS de 55 kB.
*   **`position: sticky`.** `notebook-bar` y «Continuar» no se fijan si un
    ancestro tiene `overflow` distinto de `visible`, y un `sticky` no sale de la
    caja de su padre. *Mitigación:* «Continuar» se queda como hijo de
    `.nb-practice`; el paso del plan comprueba con `getComputedStyle`
    `.nb-practice`, `.notebook--page` y `.app-main`, y si alguno tiene
    `overflow` se ajusta esa regla para la sesión. Con poco alto útil el botón
    fijo tapa hasta 56 px de la corrección; se acepta en los Goals.
*   **Avisos durante la sesión.** `.app-notices` baja al borde inferior en
    sesión (`app.css:361-363`) y quedaría sobre «Continuar». *Mitigación:* en
    sesión, `bottom` suma el alto del botón (56 px) más el safe-area.
*   **Salida accidental.** Un toque en «Terminar por hoy» cierra la sesión.
    *Mitigación:* la respuesta pendiente se califica antes de cerrar y, si el
    guardado falla, el cierre se cancela; la cola restante sigue vencida en la
    portada.
*   **Coste de IA por toques al gato.** Cada pista es un POST a
    `/api/lexicon/explain`. *Mitigación:* la salida temprana nueva de
    `askCatHint` limita las pistas a una por reto y ninguna después de
    responder.
*   **Seguridad.** No hay rutas nuevas, ni datos nuevos que salgan del cliente,
    ni cambios de autenticación. La única llamada de red afectada es la de la
    pista, que queda limitada a una por reto.

## Detailed Implementation Plan

### Files

| Archivo | Acción | Pasos |
| --- | --- | --- |
| `src/client/hooks/useReviewSession.ts` | Modificar | 1, 3, 5, 6, 7 |
| `src/client/hooks/useReviewSession.test.ts` | Crear | 1, 5, 6, 7 |
| `src/client/hooks/usePracticeCompanion.ts` | Modificar | 6 |
| `src/client/components/notebook/PracticeCard.tsx` | Modificar | 1, 3, 4, 5, 6, 7 |
| `src/client/components/notebook/LearnSessionView.tsx` | Modificar | 5, 6 |
| `src/client/components/notebook/ReviewDone.tsx` | Sin cambios de código; se comprueba en el paso 8 | 8 |
| `src/client/components/GamePanel.tsx` | Sin cambios de código; se comprueba en el paso 8 | 8 |
| `src/client/components/PracticeCompanionHeader.tsx` | Modificar | 3, 4, 6 |
| `src/client/components/PracticeCompanionHeader.test.ts` | Modificar | 4, 6 |
| `src/client/components/Vocabulary.tsx` | Modificar | 5, 6 |
| `src/client/components/Vocabulary.test.ts` | Modificar | 3, 4, 5, 6 |
| `src/client/styles/notebook.css` | Modificar | 2, 3, 4, 5, 6, 7 |
| `src/client/styles/app.css` | Modificar | 3, 5 |
| `src/client/styles/tokens.test.ts` | Modificar | 2 |
| `scripts/audit-cuaderno.mjs` | Modificar | 3, 5 |
| `artifacts/ux-repaso/` | Crear; no se versiona (`artifacts/` está en `.gitignore`) | 0, 8 |

### Test harness

*   **`useReviewSession.test.ts` (nuevo).** Monta `useReviewSession` junto a
    `usePracticeCompanion` con `createRoot` y `act`, como
    `src/client/hooks/hooks.test.ts`. Copia los `vi.mock` de
    `Vocabulary.test.ts:31-65` y `:86-89`: `../lib/idb` con `importOriginal`
    (simula `updateSavedWord` y `captureDbScope`), `../lib/lexicon`
    (`explainInContext`, `answerItem`), `../lib/reviews` (`recordReview`) y
    `../lib/vocab` (`pushWordsToServer`); añade `../lib/account-plan`
    (`useUserPlan`), `../lib/haptics` y `../lib/companion-audio`. No simula
    `fsrs`, que es puro. Un ayudante `renderReview(items: QueueItem[])` pasa
    los argumentos mínimos del hook (`reviewWords`, `all`, `setWords`,
    `wordsRef`, `setSaveError`) y llama a `beginQueue(items)`. Observa
    `combo`, `catPose`, `resultPose`, `catSpeech`, `answered`, `hintUsed`, el
    valor que devuelve `grade` y las llamadas a `explainInContext`. Aquí van
    las pruebas de lógica de los pasos 1, 5, 6 y 7.
*   **`Vocabulary.test.ts`.** Cubre lo que se ve en el DOM: el botón de cierre en
    la cabecera, el `role="status"` del pie y el foco. Su mock de
    `PracticeCompanionHeader` (`:110-125`) cambia: oculta «💡 Pista» con
    `props.hintUsed` en lugar de `props.hintText`, deja de pintar `.hint-text`
    y gana un botón `data-testid="cat-tap"` que llama a `props.onCatTap`. Las
    pruebas de pista (B3, `:1477-1514`) pasan a buscar la caja
    `.scramble-hint-box` dentro de la tarjeta.
*   **`PracticeCompanionHeader.test.ts`.** Comprueba la barra sin texto, los
    `aria-label` nuevos, `data-reacting` y el toque.
*   Comando por paso: `pnpm vitest run <archivos del paso>`.

### Steps

0.  **Medición.** Con `pnpm dev` y un navegador con el viewport fijado a cada
    tamaño (1440×800, 1366×650, 390×750 y 390×664 de alto útil), medir con
    `getBoundingClientRect` cada bloque de la tabla de D3 y una opción. Guardar
    capturas «antes» y la tabla en `artifacts/ux-repaso/medidas.md`. Si un
    bloque supera su presupuesto en más de 8 px y ninguna regla de D3 lo reduce,
    se actualiza su fila en la tabla de D3 y se anota el motivo en
    `medidas.md` antes del paso 1.
1.  **A4 racha y vuelta a `idle`.**
    *   `useReviewSession.ts`, en `grade`: la suma de `combo`, la pose, la
        frase, `triggerHaptic("success")`, `triggerPurrHaptic`,
        `playCompanionSound("purr")` y `settleCatAfter(2200)` solo se ejecutan
        en `meaning`, `form`, `cloze`, `clozeNew` y `write`. En `choose`,
        `sense`, `context`, `match`, `scramble`, `grammar` y `syntax`, `grade`
        no modifica `combo` ni dispara esos efectos.
    *   `PracticeCard.tsx`: los tres `onSolve` (descifrar, categoría, ordenar
        frase) llaman a `settleCatAfter(2200)` después de fijar la pose.
    *   Pruebas en `useReviewSession.test.ts`: dos aciertos seguidos en «Elegir
        palabra» y dos parejas en Parejas dejan `combo === 2`; un acierto en
        «Significado» deja `combo === 1`.
2.  **D4 colores.**
    *   `notebook.css`: `.choice-option` con
        `border: 2px solid var(--rule-strong)`;
        `.choice-option:disabled { opacity: 1 }`;
        `.choice-option:disabled:not(.is-correct):not(.is-wrong) { opacity: .55 }`.
    *   `.is-correct`: `background: linear-gradient(var(--success-wash),
        var(--success-wash)), var(--paper-raised)`, borde `var(--success)`,
        `color: var(--ink)`, `font-weight: 600`, ✓ por `::after` y
        `animation: lecta-pop 220ms var(--ease-out)`.
    *   `.is-wrong`: lo mismo con `--vermilion-wash`, borde `var(--vermilion)`,
        `color: var(--ink)`, `text-decoration: line-through`, ✕ por `::after`
        y `lecta-shake`.
    *   `@keyframes lecta-pop` nuevo (escala 0.97 → 1.02 → 1);
        `.grammar-cat-btn.is-correct` pasa de `pop-match` a `lecta-pop`.
    *   `tokens.test.ts`: para cada tema de `extractThemeBlocks` (`:75`), con
        `parseColor` (`:5`), `compositeOver` (`:61-71`), `relativeLuminance`
        (`:51-53`) y `contrastRatio` (`:55-59`), el contraste de `--ink` sobre
        cada wash compuesto sobre `--paper-raised` es ≥ 4.5:1.
3.  **D2 sin salto.**
    *   `PracticeCard.tsx`: `<div className="nb-answer-foot" role="status">`
        (clase y rol en la misma línea, por la auditoría) después de
        `.choice-list`, con «Correcto» o «Incorrecto: era “…”» (visualmente
        oculto en `sense` y `context`) y, en `choose`, la palabra y el
        significado que hoy pinta `nb-card-back` dentro de la tarjeta. Clase
        `.nb-continue` en los dos «Continuar», colocados después del pie.
    *   `PracticeCompanionHeader.tsx`: el globo usa `aria-live="off"` si recibe
        `onCatTap` y `role="status"` si no.
    *   `useReviewSession.ts`, efecto de foco (`:702-707`):
        `focus({ preventScroll: true })` en sus cuatro ramas (primera
        calificación, «Continuar», área de «Escribir», «Mostrar respuesta»).
    *   `notebook.css`: `.nb-continue { position: sticky;
        bottom: calc(env(safe-area-inset-bottom) + var(--s-2));
        background: var(--grain), var(--surface-herbarium); }` con sombra
        superior.
    *   `app.css`, con el selector
        `.app[data-nav="vocabulary"]:has(.notebook[data-session])`:
        `.mini-reader-bar { display: none }` y `.app-notices { bottom:
        calc(56px + env(safe-area-inset-bottom) + var(--s-3)) }`.
    *   `scripts/audit-cuaderno.mjs`: el `expect` de C4 (`:164`) pasa a
        `'className="nb-answer-foot" role="status"'`.
    *   Pruebas en `Vocabulary.test.ts`, sin pista: tras responder mal hay un
        único `role="status"` y contiene «Incorrecto»; un espía de
        `HTMLElement.prototype.focus` recibe `{ preventScroll: true }` al
        enfocar «Continuar».
    *   Nota (lectura del CSS, sin acción): ningún ancestro rompe el `sticky`.
        `.app` usa `overflow-x: clip`, `.notebook--page` es `visible`,
        `.app-main` no define `overflow`, y en `overlay` el contenedor con
        scroll es `.notebook` (`overflow-y: auto`), donde `sticky` funciona.
4.  **D3 cabecera.**
    *   `PracticeCompanionHeader.tsx`: «💡 Pista» y el selector de carácter
        pasan dentro de `.practice-cat-main-row`, a la derecha del globo. Bajo
        64rem, sus textos van en `.visually-hidden` y se ven solo los iconos 💡
        y 🐾 (botones de 44×44 px). Sus `aria-label` son «Pedir una pista» y
        «Carácter del gato: {modo}» en todos los anchos.
        `.practice-header-progress` deja de mostrar «Reto N de M». El globo deja
        de mostrar `hintText`. Prop nueva `hintUsed` para ocultar «💡 Pista».
    *   `PracticeCard.tsx`: la pista va en `.scramble-hint-box` debajo del
        contexto de `.nb-card`, en los modos con opciones y de
        autocalificación. `.nb-practice-counter` deja de mostrar «N de M».
    *   `notebook.css`:
        *   `.practice-cat-bar` con `padding: var(--s-2)` y `gap: var(--s-1)`;
        *   `.practice-progress-track` de 4 px, sin `padding-block-end` ni
            borde;
        *   `.practice-cat-bar[data-tap] .practice-cat-text` con el bloque
            `-webkit-line-clamp: 2`;
        *   `.nb-card` con `margin-block: var(--s-3)`;
        *   `.choice-option` con `line-height: 1.3`.
    *   Pruebas en `PracticeCompanionHeader.test.ts`:
        *   `:188` deja de esperar «Reto 3 de 5» y comprueba la barra con
            `aria-valuenow="3"`;
        *   `:148` comprueba `aria-label="Carácter del gato: Animado"`;
        *   «💡 Pista» no se pinta con `hintUsed`.
    *   En `Vocabulary.test.ts`: el mock cambia como dice el arnés.
5.  **D1 salida.**
    *   `Vocabulary.tsx`: «Terminar por hoy» en `.notebook-bar` mientras haya
        `data-session`, después de «‹ Volver al libro» en `overlay`, con
        `onClick={() => void review.exitSession()}` en una línea (por la
        auditoría). Para Aprender, el botón llama al cierre de D1. Está
        deshabilitado mientras `grading`, `verifying` o `learnBusy` sean
        verdaderos, o mientras `matchDone.size === tanda.length` (tanda de
        Parejas calificándose).
    *   `notebook.css`: `.notebook--page[data-session] .notebook-bar
        { position: sticky; inset-block-start: 0; background: var(--grain),
        var(--surface-herbarium); }`. La base de `.notebook-bar` ya es sticky
        (`:70-73`); solo `page` la anula (`:38-44`). Se borra `.nb-quit`
        (`:636-638`), que no tiene otros usos.
    *   Se quitan el botón de `PracticeCard.tsx` y «Terminar por ahora» de
        `LearnSessionView.tsx`.
    *   `useReviewSession.ts`:
        *   `grade` devuelve `Promise<boolean>` (`false` en la salida de
            `gradingRef` y en el `catch`);
        *   `endSessionForToday(now, extra = 0)` suma `extra`;
        *   `finishMatchTanda` deja de calificar la tanda si un `grade` devuelve
            `false`;
        *   nueva `exitSession()`:
            *   con `answered`, llama a `grade(current, answered.correct ?
                EXERCISE_RATING.correct : EXERCISE_RATING.wrong)`;
            *   con `writePick`, llama a `grade(current, writePick === "good" ?
                Rating.Good : Rating.Again)`;
            *   si `grade` devuelve `true`, llama a
                `endSessionForToday(Date.now(), 1)`; si devuelve `false`, no
                hace nada más;
            *   sin nada pendiente, llama a `endSessionForToday(Date.now(), 0)`.
    *   `app.css`: la regla que oculta `.app-nav` en sesión (`:329`) pasa
        dentro de `@media (width < 64rem)`.
    *   `scripts/audit-cuaderno.mjs`: el `expect` de C15 (`:603`) pasa a
        `"onClick=\\{\\(\\) => void review\\.exitSession\\(\\)\\}"`.
    *   Pruebas:
        *   `Vocabulary.test.ts`:
            *   con sesión, «Terminar por hoy» está en `.notebook-bar`;
            *   el título del `it` de `:359` y los clics de `:369` y `:1679`
                pasan de «Terminar por ahora» a «Terminar por hoy»;
            *   en Aprender, salir sin fichas vistas vuelve a la portada.
        *   `useReviewSession.test.ts`:
            *   con `answered` en el primer reto, `exitSession` llama a `grade`
                una vez y deja la cola vacía con una palabra repasada;
            *   si `grade` devuelve `false`, por error de guardado o por
                `gradingRef`, la cola no cambia.
6.  **D5 gato.**
    *   `usePracticeCompanion.ts`: `resultPose`, `setResultPose`, `resetCat()`
        y `settleCatAfter(ms, to = "idle")`.
    *   `useReviewSession.ts`:
        *   `answerOption` llama a `setCatPose(p)` y `setResultPose(p)` según la
            tabla de D5, sin temporizador; `conciseMeaning` se importa de
            `../lib/practice`;
        *   `pickMeaning` y la rama de autocalificación de `grade` usan las
            poses y frases de la tabla;
        *   el efecto sobre `currentKey` llama a `resetCat()`;
        *   `askCatHint` gana la salida temprana (`hintsUsedRef.current > 0` o
            `write`) y fija `hintUsed`;
        *   nuevas `catTap()` y `pet()` según «Toque» en D5.
    *   `PracticeCard.tsx`: los `onSolve` y `onWrong` de los minijuegos usan
        las poses y frases de la tabla de D5; se pasan `onCatTap={catTap}` y
        `hintUsed` a la cabecera.
    *   `PracticeCompanionHeader.tsx`:
        *   prop `onCatTap`; `handleCatClick` reproduce el ronroneo y la
            vibración y llama a `onCatTap`;
        *   con `onCatTap`, `.practice-cat-bar` lleva `data-tap` y el avatar
            `data-reacting` mientras `pose !== "idle"` y el carácter no sea
            «Tranquilo»;
        *   la píldora de racha conserva `combo >= 2`.
    *   `LearnSessionView.tsx`: prop `onCatTap: () => void`, que reenvía a la
        cabecera. `Vocabulary.tsx` le pasa `petHeroCat`.
    *   `notebook.css`:
        *   `.practice-cat-avatar { inline-size: 72px; block-size: 72px; }`;
        *   `.practice-cat-avatar .cat-anim { transition: transform
            var(--dur-2) var(--ease-out); }`;
        *   `.practice-cat-avatar[data-reacting] .cat-anim { transform:
            scale(1.25); transform-origin: bottom center; z-index: 1; }`.
    *   Pruebas:
        *   `PracticeCompanionHeader.test.ts:196-200`: tocar el avatar llama a
            `onCatTap` y no a `onAskHint`; sin `onCatTap` no hay
            `data-reacting`.
        *   `useReviewSession.test.ts`:
            *   un fallo en `choose` deja `catSpeech` igual a `Era «${form}». La
                próxima la tienes.` y `catPose === "pet"`;
            *   dos `catTap()` en el mismo reto llaman a `explainInContext` una
                vez, igual que dos `askCatHint()`;
            *   un `catTap()` tras responder no llama a `explainInContext`, deja
                `catPose === "pet"` y, tras 1200 ms, `catPose` vuelve a
                `resultPose`;
            *   al cambiar de reto, `catPose === "idle"`;
            *   tras `onSolve` y 2200 ms, `catPose === "idle"`.
        *   `Vocabulary.test.ts`: el botón `cat-tap` del mock llama a
            `onCatTap`.
7.  **D6 teclado.**
    *   `useReviewSession.ts`: en el `keydown` (`:663-694`), las teclas 1–9
        eligen opción en `choose`, `sense` y `context`, hasta el número de
        opciones; `answered` entra en el array de dependencias del efecto.
    *   `PracticeCard.tsx`: leyenda «Teclas 1–N eligen» con
        `className="nb-keys-hint nb-keys-hint--kbd"`; la leyenda de
        autocalificación (`:631`) gana `nb-keys-hint--kbd`.
    *   `notebook.css`: `@media not (pointer: fine) { .nb-keys-hint--kbd
        { display: none } }`.
    *   Pruebas en `useReviewSession.test.ts`: la tecla «2» fija `answered` con
        la segunda opción; la tecla «3» después de responder no cambia
        `answered`.
8.  **Cierre.**
    *   Correr `pnpm gate` y `pnpm audit:cuaderno`; el gate no cubre la
        auditoría.
    *   Repetir las medidas del paso 0 y guardar capturas «después» en
        `artifacts/ux-repaso/`, en los temas `papel` y `noche`. Criterios:
        *   en 1440×800 y 390×750, tras responder, la cuarta opción y
            `.nb-continue` quedan dentro de `innerHeight`;
        *   en 1366×650 y 390×664, `.nb-continue` queda dentro de `innerHeight`
            y la opción tocada no cambia su `top`.
    *   Comprobar a mano `ReviewDone` y el panel de juegos (`GamePanel`): el
        gato no queda escalado y el globo no se recorta.
    *   No hay e2e: ninguna especificación de `e2e/` cubre el repaso.
