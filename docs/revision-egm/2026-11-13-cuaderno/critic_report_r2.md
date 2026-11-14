# Etapa 7: revisión crítica, ronda 2 (re-auditoría)

**Objetivo:** `docs/designs/2026-11-13-cuaderno-repaso.md`, líneas 1–367.

| Revisor | Estado | Blocker | Major | Nit |
| --- | --- | --- | --- | --- |
| `egm-design` | completado | 0 | 10 | 5 |
| `egm-structural` | completado | 0 | 1 | 8 |
| `egm-style` | completado | 0 | 4 | 8 |

**Resultado:** la ronda no queda limpia. No hay Blockers. Tras deduplicar quedan 13 Major distintos.

**Tope:** la etapa 7 ya usó su única re-auditoría, así que no habrá ronda 3.

**Churn parcial:** algunos hallazgos nuevos caen sobre arreglos de la ronda 1:
- R2-3 y R2-5 sobre el presupuesto de alto.
- R2-4 sobre el «Continuar» fijo.
- R2-7 sobre la racha en un solo punto.
- R2-9 sobre la redacción de `askCatHint`.

Ninguno se resuelve deshaciendo el arreglo: en todos los casos el arreglo estaba incompleto, no equivocado.

---

## 🟡 Major

### R2-1. El cierre de D1 lee un `queue` viejo
Origen: `d-2-1`.

`endSessionForToday` (`useReviewSession.ts:175-184`) usa el `queue` del render. `grade` avanza la cola con un `setQueue` funcional después de un `await`. Esto produce cuatro fallos:

- **Reto pendiente en el primer reto:** `reviewed` vale 0 y la app vuelve a la portada en lugar de mostrar `ReviewDone`.
- **Reto pendiente en el último reto:** el recuento queda uno por debajo.
- **`grade` falla:** atrapa el error (`:534`) y no lo relanza, así que la sesión se cierra igual y se pierde la respuesta. Esto contradice la mitigación «lo calificado ya está guardado».
- **Doble toque:** `gradingRef` cancela el segundo `grade`, pero el cierre sigue adelante con el estado viejo.

**Fix:**
- Que `grade` devuelva `{ ok }`.
- Que el cierre derive el recuento dentro de un `setQueue` funcional.
- Si `ok` es falso, abortar y mostrar `saveError`.
- Deshabilitar el botón mientras `grading` sea verdadero.
- Corregir el texto de la mitigación.

### R2-2. «Única salida» y visibilidad desde cualquier punto
Origen: `st-2-1`, `d-2-9`, `d-2-N1`.

- **«Única salida» es falso.** Siguen existiendo «‹ Volver al libro» en `overlay`, el riel de navegación en escritorio y el «atrás» del navegador. Además, Aprender ya tiene «Terminar por ahora» (`LearnSessionView.tsx:265-271`), así que P1 exagera para Aprender.
- **La salida no se ve desde cualquier punto.** En `page`, `.notebook-bar` es `static` (`notebook.css:38-44`): con un contexto largo, al desplazar se va de la vista. En móvil no queda ninguna otra salida visible.

**Fix:**
- Cambiar la frase a «única forma de terminar la sesión».
- Unificar la etiqueta en «Terminar por hoy».
- Hacer `.notebook-bar` `sticky` cuando exista `data-session` y sumar su alto al presupuesto.

### R2-3. El presupuesto de alto usa medidas de pantalla, no el viewport real
Origen: `d-2-2`, `st-2-2`, `st-2-3`.

- **Pantalla frente a viewport.** 1440×900 deja unos 800 px de `innerHeight`, y el total presupuestado es de 856 px. En Safari, 390×844 deja unos 660 px.
- **Portátiles bajos sin botón fijo.** En 1366×768, o en un iPad horizontal (que cuenta como «escritorio»), no hay botón fijo y el contenido no cabe. Con `preventScroll`, «Continuar» queda fuera de la vista.
- **Opciones de 66 px.** P2 midió opciones de unos 66 px, y nada en el diseño las baja a 48. Cuatro opciones miden 288 px, no 230.
- **Columna inexistente.** El texto menciona una columna «hoy» que la tabla no tiene.

**Fix:**
- Expresar el criterio en `innerHeight`, con cuatro casos: 1440×800, 1366×650, 390×664 y 390×750.
- Activar el «Continuar» fijo con una condición de alto (`@media (height < 56rem)`) además de la de ancho.
- Usar en la tabla la altura real de las opciones (se mide en el paso 0) y decir qué la reduce, si algo lo hace.
- Quitar la referencia a la columna «hoy».

### R2-4. Un `sticky` no sale de la caja de su padre
Origen: `d-2-3`.

- Con «Continuar» dentro de `.nb-answer-foot`, el botón no se ve si el pie entero está por debajo del borde de la ventana.
- Cuando el botón sí se fija, tapa la corrección.

**Fix:**
- Cuando se fija, «Continuar» pasa a ser hijo directo de `.nb-practice`.
- `.nb-practice` reserva `padding-block-end` igual al alto del botón para que no tape nada.
- Añadir este caso a Risks.

### R2-5. La cabecera del gato no cabe en el presupuesto
Origen: `d-2-4`, `d-2-5`.

- **Con un avatar de 72 px, la CSS actual mide como mínimo 121 px.** El presupuesto es de 110 px en escritorio y 100 px en móvil.
- **La pista crece dentro del globo.** `hintText` puede ocupar un párrafo, la fila crece y empuja las opciones: otro salto.
- **Poco espacio para el texto en móvil.** En 390 px, con los botones a la derecha, quedan unos 100 px para el texto.

**Fix:**
- Fijar los paddings y gaps de `.practice-cat-bar`.
- Limitar el globo a 2 líneas con `line-clamp`.
- Mostrar la pista dentro de la tarjeta del reto, debajo del contexto, en lugar de en el globo.
- En móvil, convertir «Pista» y la selección de carácter en iconos de 44 px.

### R2-6. La guarda de `askCatHint` está descrita como si ya existiera
Origen: `d-2-6`, `st-2-4`.

- Hoy cada toque hace un POST (`:737-738`). El diseño describe la guarda en presente, como si ya estuviera.
- Después de responder, un toque todavía pediría una pista, gastaría IA y contaminaría `hints` en `recordReview`.

**Fix:**
- Declarar la guarda como cambio nuevo: `if (hintForRef.current === current.word.key && (hintText || hintBusy)) return;`.
- Con `answered` presente, el toque va a `onPet` y no pide pista.

### R2-7. La píldora de racha muestra un valor viejo y `grade` pisa la pose
Origen: `d-2-7`.

- Si `combo` solo se escribe en `grade`, durante `answered` la píldora muestra N mientras la frase muestra N+1.
- Al fallar, la píldora sigue diciendo «x3».
- `grade` pone `celebrate` y un temporizador de 2200 ms después de avanzar, así que el reto siguiente empieza celebrando.

**Fix:**
- En los modos con opciones, `answerOption` escribe `combo`, la pose y la frase. `grade` no toca ninguno de los tres.
- En los modos de autocalificación, `grade` sigue como hoy.

### R2-8. A4 (racha contada dos veces) también ocurre en minijuegos y «Parejas»
Origen: `d-2-8`.

- Descifrar, gramática y ordenar frase suman en `onSolve` (`PracticeCard.tsx:208-218, 238-248, 267-277`) y después llaman a `grade`.
- `pickMeaning` suma una vez por pareja (`:625-635`) y `finishMatchTanda` llama a `grade` una vez por palabra.

**Fix:**
- Enumerar en A4 todos los puntos de escritura.
- Regla general: suma quien muestra el resultado al lector (`answerOption`, `onSolve`, `pickMeaning`). `grade` solo suma en autocalificación.
- En «Parejas», la racha cuenta por pareja.
- Pruebas por modo.

### R2-9. El resultado no se anuncia si el gato está oculto, y la frase de error no sirve en «Acepción»
Origen: `d-2-10`.

- El único `role="status"` que anuncia el resultado es el globo del gato.
- Con el compañero desactivado o en «Oculto», el lector de pantalla no oye el resultado.
- En «Acepción» y «Contexto», «Era *curdle*» no aporta nada, porque la palabra está a la vista.

**Fix:**
- El pie siempre lleva un `role="status"` con «Correcto» o «Incorrecto: era «…»». Si hace falta, puede ser visualmente oculto.
- En «Acepción» y «Contexto», el gato nombra la acepción correcta.

### R2-10. La lista a/b/c no se renderiza como lista
Origen: `s-2-1`.

CommonMark no reconoce letras como marcadores de lista (líneas 80–88). **Fix:** usar 1/2/3 y citar (2) y (3).

---

## 🟢 Nit

**Fix barato:**
- `d-2-N3`: el borde de 2 px debe ser «con el color actual», no transparente.
- `d-2-N4`: escalar el `<Companion>` interior y no el contenedor, que choca con `:hover`. Fijar `z-index` y `transform-origin`.
- `d-2-N5`: limitar «Acepción» a 4 opciones visibles (la correcta más 3) o dejarlo fuera del Goal.
- `s-2-*` y `st-2-*`:
  - añadir «escribir» al glosario;
  - poner en inglés los H3 «Glossary» y «Additional Findings»;
  - partir la alternativa doble de D2;
  - enunciar el riesgo del bundle;
  - citar `handleCatClick` con número de línea;
  - quitar del Status la referencia a un archivo sin versionar;
  - reescribir el título de P4, «nunca tapa», «No se descarta nada» y «justo».

**DECLINE:**
- `s-2-N` «Proposed Design» frente a «Technical Plan»: el estándar acepta los dos nombres.
- `s-2-N` CUJ Given/When/Then: el estándar no lo exige y los Goals ya funcionan como criterios.
- `s-2-N` plantilla H3 con Pros/Cons para las alternativas: las razones ya son concretas.
- `d-2-N2`: la simetría de Aprender con 0 fichas se resuelve en R2-2 con «vuelve a la portada si no se vio ninguna».
