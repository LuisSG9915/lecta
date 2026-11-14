# Etapa 8: revisión Zoom Out intermedia

**Objetivo:** `docs/designs/2026-11-13-cuaderno-repaso.md` (documento completo, 502 líneas).
**Revisor:** `egm-zoom-out`, completado. Lo comparé con `zoom_out_report.md` (etapa 5).

**Veredicto:** no hay bloqueantes. Hay 2 hallazgos importantes y 6 menores.

El diseño sigue siendo la solución más simple para P1–P4: todo ocurre en el cliente y reutiliza poses, animaciones y tokens que ya existen. Los hallazgos M1–M7 y N1–N5 de la etapa 5 están resueltos. La complejidad nueva viene de dos mitigaciones de la etapa 7.

---

## 🟡 Major

### Z1. El «Continuar» sticky tapa parte de la corrección y el cambio de padre no existe

Afecta a las líneas 254–261, 173–175 y 466–472.

- **El padding no evita el solape.** `padding-block-end` en `.nb-practice` no impide que un `sticky` con `bottom` se pinte encima del contenido que queda en el borde inferior. Con poca altura, el botón (56 px) tapa parte de la corrección hasta que el lector desplaza la página. Por eso es falso que el botón «nunca tapa». Además, es el mismo problema que se usó para descartar el «pie entero fijo», aunque aquí sea menor.
- **El botón ya está donde el diseño quiere moverlo.** «Continuar» ya es hijo directo de `.nb-practice`: lo envuelve un fragmento (`PracticeCard.tsx:516-531`), que no añade nodo al DOM.
- **Propuesta:**
  - Quitar la reserva de padding, la afirmación «nunca tapa» y el texto sobre reubicar el botón.
  - En el Goal de poca altura, aceptar que el botón fijo puede tapar hasta 56 px de la corrección hasta que el lector desplace.
  - Darle al botón fondo de papel y sombra superior.

### Z2. Calificar al salir encadena cuatro mecanismos para un caso límite

Afecta a las líneas 215–226, 434–437 y 484–489.

- **Los cuatro mecanismos:**
  - `grade` devuelve `{ ok }`.
  - El botón se deshabilita mientras `grading` está activo.
  - El cierre se cancela si el guardado falla.
  - `reviewed` se calcula dentro de un `setQueue` funcional.
- **Dos problemas:**
  - El contrato `{ ok }` no define qué devuelve la salida temprana de `:455`.
  - Calcular `reviewed` dentro del updater mete `setFinishedAt` y `resetExercise` dentro de él. Es un antipatrón: en StrictMode, React puede ejecutar el updater dos veces.
- **Alternativas más simples:**
  - (a) No calificar al salir. La palabra sigue vencida y solo se pierde el avance FSRS de un acierto.
  - (b) `endSessionForToday(now, extra)` suma 1 al conteo capturado si `grade` devolvió `ok`.

---

## 🟢 Nit

- **Z3. Hay tres regiones `role="status"`.** El globo del gato (`PracticeCompanionHeader.tsx:152`), `nb-card-back` (`PracticeCard.tsx:410`) y el pie nuevo. Con el gato visible, el resultado se anuncia dos o tres veces. Propuesta: que el pie herede el `role` de `nb-card-back` y decidir qué pasa con el del globo durante la reacción.
- **Z4. El patrón para mostrar la pista ya existe.** Los minijuegos la pintan dentro del tablero (`WordScrambleGame.tsx:658-662` `.scramble-hint-box`, `GrammarGame.tsx:190`, `SentenceBuilderGame.tsx:599,754`). Propuesta: reutilizar esa clase. Si D3 quita la pista del globo, también desaparece su duplicado en los minijuegos, y el Non-Goal de la línea 191 dice que no se tocan. Hay que declarar esa excepción.
- **Z5. La leyenda de atajos ya existe.** Hay que reutilizar `.nb-keys-hint` (`PracticeCard.tsx:631`, `notebook.css:466`) con el mismo criterio de puntero para la leyenda vieja y la nueva.
- **Z6. Aprender no recibe `onPet`** (`LearnSessionView.tsx:113-119`). El Goal de tocar al gato no se cumple en Aprender si el paso 6 no lo conecta.
- **Z7. `onPet` después de responder choca con «la pose sigue al estado».** Hay que definir si el gato vuelve a la pose de resultado o a `idle`.
- **Z8. El diseño baja a detalles de implementación.**
  - El código literal de la línea 358 sobra, y su `|| hintBusy` repite la guarda que ya existe. Basta con enunciar la regla.
  - Las sumas de píxeles y el cálculo de especificidad sirven como justificación, pero su sitio natural es el plan.

## Sin hallazgos

- La prueba de contraste: reutiliza `contrastRatio` de `tokens.test.ts`.
- `notebook-bar` sticky: solo quita la excepción `page`.
- Ocultar `.mini-reader-bar`: ya está oculta en escritorio.
- `<Activity>` en escritorio.
- La etiqueta «Terminar por hoy» en Aprender.
- `preventScroll` en las cuatro ramas.
