# Prueba de comprensión (etapa 6): docs/designs/2026-11-13-cuaderno-repaso.md

Revisor: `egm-comprehension`. Leyó solo el documento, sin el código ni otro contexto. En esta etapa no se aplica ninguna norma de documento.

## Qué propone (paráfrasis)

El documento arregla cuatro problemas del repaso del Cuaderno. Todos los cambios son de cliente:

- **D1, salida del repaso.** Un botón «‹ Cuaderno» en la cabecera de la vista de página. Termina la sesión por el mismo camino que «Terminar por hoy» y vuelve a la portada. En escritorio (≥ 64rem) la barra de navegación deja de ocultarse durante la sesión.
- **D2, responder sin salto.** La corrección y «Continuar» pasan a un pie (`.nb-answer-foot`) debajo de las opciones. El foco se mueve sin desplazar la página y, si hace falta, después se hace un `scrollIntoView` mínimo. En móvil el pie es `sticky`.
- **D3, cabecera compacta.** Se quitan los contadores duplicados, las acciones del gato pasan a su fila y los márgenes se reducen. Objetivo: ≤ 120 px de alto en PC.
- **D4, resultado legible.** Las opciones usan `aria-disabled` en vez de `disabled`, con fondo tintado, borde, ✓/✕, `aria-label` y una animación corta.
- **D5, gato más grande y reactivo.** Mide 88 px en PC y 72 px en móvil. Tiene una pose para acierto, otra para error y otra para racha, y responde al toque aunque no haya pista.
- **D6, teclado.** Las teclas 1–4 eligen una opción y Enter activa «Continuar».

## Cómo funciona el sistema actual, según el documento

En la pestaña Cuaderno (`presentation="page"`), una regla CSS oculta la barra de navegación mientras existe `data-session`. La cabecera no tiene botón de volver; ese botón solo existe en el modo `overlay`, el que se abre desde el lector.

Al responder una opción pasan tres cosas:

1. `answerOption` fija `answered`.
2. `PracticeCard` inserta `nb-card-back` encima de las opciones y las empuja hacia abajo.
3. Un efecto pone el foco en «Continuar» sin `preventScroll`, y la página se desplaza.

Además, todas las opciones respondidas reciben `disabled`, y `base.css` les aplica una opacidad de 0.45. Por eso el acierto y el error se ven pálidos.

El gato mide 56 px y solo cambia de pose al acertar o al fallar. Tocarlo pide una pista o solo ronronea, sin ningún cambio visible.

## Hallazgos

1. **Major. Los Goals (líneas 107–111) contradicen D2 (líneas 160–172).**
   - El objetivo 2 pide que la opción tocada no se mueva de sitio, pero el paso 3 de D2 hace `scrollIntoView`.
   - El objetivo 3 pide que, a 390×844, todo quepa sin desplazarse, pero D2 dice «En móvil, el pie puede quedar debajo».
   - No queda claro si en móvil se acepta el desplazamiento. D3 tampoco da un presupuesto de alto para móvil.
2. **Major. D2, «Móvil: pie fijo».** No se explica en qué caso un pie `sticky` deja de verse, así que no se sabe si el paso 3 llega a ejecutarse alguna vez. Tampoco se dice si el pie tapa la última opción.
3. **Major. D1 deja Aprender sin especificar.**
   - «El cierre equivalente de `useLearnSession`» no tiene nombre ni comportamiento definido.
   - `queue` y `learn` aparecen sin definir, y tampoco se define «Aprender».
   - El paso 4 del plan no prueba Aprender, aunque el objetivo 1 lo promete.
4. **Major. D4 no aclara los tokens.**
   - No dice si `--success-wash` ya existe ni si el plan debe crearlo.
   - Habla de «cinco temas», pero solo nombra tres (`papel`, `blanco`, `noche`).
5. **Major. Risks, `audit-cuaderno`.** No se explica qué es `audit-cuaderno`, qué es la comprobación `presente` ni qué significa «afirmación». Con eso, el riesgo no se puede evaluar.
6. **Major. «Modo» significa dos cosas.**
   - Se usa para los modos de ejercicio y para los modos del gato, y ninguna de las dos listas está definida.
   - Los modos de autocalificación no se enumeran.
   - No se dice si «sentido» es lo mismo que «Acepción».
   - De «Tranquilo» solo se sabe que el gato no cambia de pose.
7. **Nit.** Hay términos del producto sin definir: Cuaderno, Biblioteca, Tú, portada, «Reto», la píldora «Eco de», la píldora de racha y FSRS. Tampoco se dice qué cuenta la «racha ≥ 3».
8. **Nit. D5, toque del gato.** No se dice qué hacen el segundo toque y los siguientes cuando hay pista. Tampoco si «no hay `onAskHint`» equivale a «no hay pista».
9. **Nit. D2, paso 2.** No se nombran las «cuatro ramas» del efecto de foco.
10. **Nit. D3.** Faltan los valores de `--s-2` a `--s-5`. Sin ellos no se pueden comprobar los 120 px ni los 44 px.
11. **Nit. D6.** No queda claro si la pista de teclas ya existe. Tampoco qué añade Enter si «Continuar» ya tiene el foco.
12. **Nit. Plan.** No se definen `pnpm gate` ni `catSpeech`. «Con la forma correcta» admite dos lecturas. Tampoco se sabe si existe el spec e2e.
13. **Nit. Risks, bundle.** No se explica que 215 kB es un presupuesto ni dónde se aplica.
14. **Nit. Overview.** «Rutas del Worker» y «secrets» dan por sabida la arquitectura, aunque no afecta a la comprensión del diseño.

## Nota de cruce con la etapa 5

Los hallazgos 1, 2 y 3 coinciden con M6 y M2 de `zoom_out_report.md`. El hallazgo 11 coincide con M7. Los hallazgos 5 a 14 son de redacción para quien no conoce el proyecto. El público del documento es el autor y los agentes con acceso al repositorio, así que basta con un glosario breve.
