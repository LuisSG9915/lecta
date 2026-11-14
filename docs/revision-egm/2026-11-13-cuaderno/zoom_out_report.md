# Etapa 5: revisión Zoom Out

**Objetivo:** `docs/designs/2026-11-13-cuaderno-repaso.md`, el documento completo.
**Revisores:**
- `egm-zoom-out`: simplicidad y alcance.
- `egm-inventive-catalyst`: contradicciones dentro del diseño.

**Contexto que recibieron:** `PracticeCard.tsx`, `PracticeCompanionHeader.tsx`, `useReviewSession.ts`, `usePracticeCompanion.ts`, `Vocabulary.tsx`, `notebook.css`, `app.css` y `base.css`.

**Veredicto:** No hay Blockers. Las cuatro causas (P1–P4) están localizadas en líneas reales del código y los dos revisores las verificaron. Los problemas están en la solución: algunas piezas repiten lo que ya existe y dos decisiones tienen fallos de comportamiento.

Las etiquetas indican qué revisor encontró cada hallazgo: **ZO** es `egm-zoom-out` e **IC** es `egm-inventive-catalyst`.

---

## Major

### M1. La salida de D1 repite un botón, describe mal su destino y puede perder la respuesta (ZO-2, IC-2, IC-5)

- El botón «‹ Cuaderno» llama a `endSessionForToday`, igual que «Terminar por hoy». Quedan dos controles con dos nombres para una sola acción.
- El destino descrito es incorrecto. Si `reviewed > 0`, `endSessionForToday` deja `{ total, items: [] }` y lo que se pinta es `ReviewDone` (`useReviewSession.ts:175-184`, `Vocabulary.tsx:815`), no la portada.
- `grade` solo corre al pulsar «Continuar». Quien sale justo después de responder pierde ese resultado.
- En escritorio la barra de navegación queda visible durante la sesión. Ir a Biblioteca a mitad del repaso deja la cola en un estado que el documento no define.

**Propuesta:**
- Subir «Terminar por hoy» a `notebook-bar` y quitarlo del final de la tarjeta. Así queda una sola salida.
- Si hay una respuesta pendiente, la salida la califica antes de cerrar.
- Corregir el destino en el texto: `ReviewDone`, o la portada si no se repasó nada.

### M2. No existe un cierre de Aprender a mitad de sesión (ZO-3)

`useLearnSession` no tiene un cierre a mitad de sesión. Solo existe `setLearn(null)` en la pantalla final (`LearnSessionView.tsx:84`, `:106`). El documento no dice qué pasa con las fichas ya vistas.

**Propuesta:** definir el comportamiento, por ejemplo `setLearn(null)` dejando claro qué se pierde, o sacar Aprender del alcance de D1.

### M3. Al quitar contadores, quien tiene el gato desactivado se queda sin progreso (ZO-1)

D3 deja «Reto N de M» solo en `PracticeCompanionHeader`. Ese componente devuelve `null` sin compañero (`:45`) y en modo `off` no pinta el progreso (`:49-61`).

**Propuesta:** dejar como única fuente `notebook-count`, que siempre se ve, y quitar del gato el texto «Reto N de M». La barra puede quedarse.

### M4. D3 pide una cabecera más baja y D5 un gato más grande en esa misma cabecera (IC-1)

D3 quiere pasar la cabecera de unos 230 px a 120 px o menos. D5 sube el avatar de 56 a 88 px dentro de ella. El documento no explica cómo caben las dos cosas.

**Propuesta:**
- A partir de 64rem, el gato pasa a una columna lateral junto a la tarjeta. A 1440 px de ancho sobra espacio horizontal.
- Por debajo de 64rem, el avatar mide 56 px en reposo y crece con `transform: scale` solo mientras reacciona, así no ocupa alto en el layout.

### M5. D4 reinventa estilos que ya existen y cambia más de lo necesario (ZO-4, ZO-5)

`notebook.css` ya tiene el lenguaje visual de acierto y error:
- `.match-option.is-done` usa `--success-wash` y pinta ✓ con `::after` (`:579-594`).
- `.is-wrong` usa `lecta-shake` (`:596-600`, `:2031-2037`, `@keyframes` en `:2269`).
- `.grammar-cat-btn.is-correct` usa `pop-match` (`:2028`).

Los dos tokens wash ya existen en todos los temas, así que la prueba de tokens que propone el documento sobra.

La causa de las opciones pálidas es solo `base.css:87`. Basta con `.choice-option:disabled { opacity: 1 }` y atenuar las opciones con `:not(.is-correct):not(.is-wrong)`. Así se conserva `disabled` nativo, no hace falta reescribir `aria-label` y las pruebas actuales siguen valiendo.

**Propuesta:**
- Reutilizar `lecta-shake`, `pop-match` y el ✓ por `::after` (añadir ✕ para el error).
- Mantener `disabled`.
- Quitar la prueba de tokens del plan.

### M6. D2 usa cuatro mecanismos contra un solo salto, y uno contradice el Goal (ZO-6, IC-4)

- `scrollIntoView` mueve la página, que es justo lo que prohíbe el Goal «no mueve la página».
- El pie fijo en móvil, con la palabra, el significado y el botón (unos 150 px), tapa las últimas opciones justo cuando hay que ver cuál era la correcta.

**Propuesta:**
- Quedarse con dos mecanismos: la corrección pasa debajo de las opciones y el foco usa `preventScroll`.
- En móvil, solo el botón «Continuar» va fijo (`sticky`); la corrección sigue en el flujo normal.
- Quitar `scrollIntoView`.
- Opcional (IC-4): reservar desde el principio una ranura de alto fijo para el pie.

### M7. Reutilizar el `keydown` actual en D6 trae un closure con estado viejo (IC-3, ZO-8)

- Las dependencias del efecto son `[queue, revealed]` (`useReviewSession.ts:663-694`). Después de responder, el handler sigue viendo `answered = null`, así que pulsar «3» puede volver a llamar a `answerOption` y cambiar el resultado.
- Manejar Enter de forma global se duplica con la activación nativa del botón «Continuar», que ya tiene el foco (`:704`). El efecto es saltarse un ítem.

**Propuesta:**
- Añadir `answered` a las dependencias, o leer el estado desde un ref.
- No manejar Enter.
- Añadir una prueba: pulsar 1–4 después de responder no cambia `answered`.

---

## Nit

- **N1 (ZO-7).** `base.css:134` ya reduce el movimiento de forma global, con la excepción `html[data-cat-motion="full"]` para el gato. Si D4 y D5 reducen el movimiento por su cuenta, se salta la preferencia «Animaciones del gato: Completas». Conviene apoyarse en la regla global.
- **N2 (ZO-9).** Si el toque sin pista cambia la pose dentro de `PracticeCompanionHeader`, aparece un segundo estado que compite con el del hook. Es mejor pasar un callback que use `setCatPose` y `settleCatAfter`.
- **N3 (ZO-10).** `playful_hop` con racha de 3 o más solo en `answerOption` choca con los minijuegos y con `grade`, que usan `celebrate`. Hay que aplicarlo en todos o en ninguno.
- **N4 (IC-6).** La pose de resultado depende de temporizadores fijos (`2200 ms`, 1,2 s). Es mejor mantenerla mientras exista `answered` y volver a `idle` al cambiar de ítem.
- **N5 (ZO-11).** `LearnSessionView` también usa `PracticeCompanionHeader`, así que hereda D3 y D5. Hay que declararlo en Non-Goals o en Risks.

## Sin hallazgos

- El alcance solo de cliente.
- El rechazo de la alternativa de 100dvh, con su motivo.
- La causa raíz de P3 (`opacity: 0.45` global).
