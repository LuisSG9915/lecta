Status: resolved (I1–I14 y Nits aplicados al plan y a la especificación)

# Etapa 9: preparación para implementar, ronda 1

**Objetivo:** `docs/designs/2026-11-13-cuaderno-repaso.md`, líneas 466–527 (Detailed Implementation Plan). Se contrasta con la especificación de las líneas 1–465.

| Revisor | Estado | Blocker | Major | Nit |
| --- | --- | --- | --- | --- |
| `egm-implementation-readiness` | completado | 2 | 13 | 8 |
| `egm-codebase-details` | completado | 1 | 10 | 7 |
| `egm-style` | completado | 0 | 7 | 10 |

**Veredicto: no está listo para implementar.** Tras quitar duplicados quedan 3 bloqueantes y 14 problemas importantes. El diseño se sostiene. Lo que falla es el plan: le faltan archivos, arnés de pruebas y decisiones concretas que hoy dejaría en manos de quien implemente.

---

## 🔴 Blocker

### I1. Faltan archivos en el plan, y ningún archivo dice si se crea, modifica o borra
Fuentes: `ir-B1`, `cd-M10`, `cd-M4`, `cd-M5`, `ir-M13`.

Estos archivos se rompen o hay que tocarlos, y el plan no los nombra:

- **`Vocabulary.test.ts`**
  - En `:359`, `:369` y `:1679` pulsa «Terminar por ahora», un botón que el plan renombra.
  - El mock de `PracticeCompanionHeader` (`:110-125`) no pinta el gato, `speech`, `combo` ni `onPet`.
- **`PracticeCompanionHeader.test.ts:188`**: espera el texto «Reto 3 de 5», que el plan quita.
- **`usePracticeCompanion.ts`**: `settleCatAfter` siempre vuelve a `idle` (`:42-51`), y D5 necesita volver a la pose del resultado.
- **`scripts/audit-cuaderno.mjs`**
  - La afirmación C4 (`:164`) exige `className="nb-card-back" role="status"`.
  - La afirmación C15 (`:603`) exige `endSessionForToday(Date.now())`.
  - Ambas pasarán a REGRESION.
  - Además, `pnpm test` y `pnpm gate` no ejecutan las afirmaciones: solo `audit-cuaderno.test.mjs` prueba el mecanismo con fixtures. Por eso el riesgo de la línea 435 está mal descrito, y el cierre debe correr `pnpm audit:cuaderno`.
- **`notebook.css:636-638` (`.nb-quit`)**: el plan no dice si se borra.
- **`artifacts/ux-repaso/`**: el plan no dice si se versiona. `artifacts/` ya está en `.gitignore`.

**Arreglo:** añadir una tabla cerrada de archivos, cada uno marcado como Create, Modify o Delete.

### I2. El plan de pruebas no se puede ejecutar
Fuentes: `ir-B2`, `cd-M5`.

- No existen pruebas de `useReviewSession.ts`, `PracticeCard.tsx` ni `LearnSessionView.tsx`.
- Ningún paso dice en qué archivo van sus pruebas.
- `combo === 2`, `catSpeech` y «dos toques al gato llaman una vez» no se pueden observar con el mock actual.

**Arreglo:** decidir el arnés de pruebas.
- Nuevo archivo `useReviewSession.test.ts` que monte el hook con `createRoot`, igual que `hooks.test.ts`.
- Ampliar el mock de `Vocabulary.test.ts` para que exponga `speech`, `combo`, un avatar pulsable y `onPet`.

### I3. La animación `pop-match` no existe
Fuentes: `cd-B1`, `ir-M1`.

No hay ningún `@keyframes pop-match`. `notebook.css:2028` ya la usa y no hace nada.

**Arreglo:** el plan define el keyframe `lecta-pop` (escala de 0.97 a 1.02 a 1, 220 ms) y se aplica también a `.grammar-cat-btn.is-correct`. Esto arregla de paso el bug latente de `:2028`.

---

## 🟡 Major

### I4. `--border-strong` no es un color
Fuentes: `cd-M1`, `ir-M2`.

En `tokens.css:56` vale `1px solid var(--rule-strong)`.

**Arreglo:** usar `border: 2px solid var(--rule-strong)`.

### I5. Ocultar `.nb-keys-hint` sin puntero fino rompe las leyendas táctiles
Fuentes: `cd-M2`, `ir-M3`.

La clase también se usa en Parejas (`PracticeCard.tsx:194`), en los minijuegos (`WordScrambleGame:664`, `GrammarGame:196`, `SentenceBuilderGame:605,760`) y en `SentenceBuilderGame.test.ts:187`.

**Arreglo:** crear el modificador `.nb-keys-hint--kbd` y aplicarlo solo a las dos leyendas de teclado.

### I6. No está definido cómo un toque al gato decide entre pedir pista o acariciarlo
Fuentes: `ir-M4`, `ir-M5`, `cd-M3`, `cd-M8`.

- La cabecera no conoce `answered`.
- Si la pista se retira de la cabecera, tampoco sabe si ya se pidió.
- `tryRescue` (`:732`) fija `hintText` sin pasar por `hintsUsedRef`.
- `settleCatAfter` solo devuelve el gato a `idle`.
- La pose de resultado no se guarda en ningún sitio.

**Arreglo:**
- `useReviewSession` expone `catTap()`. Si no hay `answered`, `canHint` es verdadero y `hintsUsedRef` del reto actual vale 0, pide pista. En cualquier otro caso llama a `pet()`.
- `pet()` pone `pet` y luego `settleCatAfter(1200, resultPose)`.
- `resultPose` es un estado nuevo en `usePracticeCompanion`: se fija al responder y se limpia al cambiar de reto.
- `settleCatAfter(ms, to = "idle")`.
- La cabecera recibe `onCatTap` en lugar de decidir por su cuenta.
- Aprender recibe un `pet` equivalente desde `Vocabulary.tsx`, reutilizando `petHeroCat` (`:318-325`).

### I7. Faltan el disparador y la duración de la escala del gato
Fuente: `ir-M6`.

**Arreglo:** el contenedor del gato lleva `data-reacting` mientras `catPose !== "idle"` y el carácter no sea «Tranquilo». La regla `.practice-cat-avatar[data-reacting] .cat-anim { transform: scale(1.25) }` aplica la escala.

### I8. El paso 1 no cierra qué hace `grade` en cada modo
Fuente: `ir-M7`.

**Arreglo:** dar la lista exacta.
- `grade` suma `combo` y fija pose, frase, háptica, sonido y `settleCatAfter` solo en `meaning`, `form`, `cloze`, `clozeNew` y `write`.
- En `choose`, `sense`, `context`, `match`, `scramble`, `grammar` y `syntax` no hace nada de lo anterior.

### I9. «Continuar» no tiene una clase propia
Fuentes: `cd-M6`, `ir-M8`.

**Arreglo:**
- Crear `.nb-continue` y aplicarla a los dos «Continuar», el de opciones y el de «Escribir». Los dos quedan fijos al hacer scroll.
- En el DOM va después de `.nb-answer-foot`, para mantener el orden de lectura.

### I10. Falta decir dónde y en qué modos se pinta la pista
Fuentes: `cd-M7`, `ir-M9`.

**Arreglo:**
- En los modos con opciones y de autocalificación, la pista va debajo del contexto en `.nb-card`, con `.scramble-hint-box`.
- No se pinta en los minijuegos ni en `write`.
- La cabecera deja de recibir `hintText`. El botón «💡 Pista» se oculta según `hintsUsed > 0` del reto actual.

### I11. Iconos de la cabecera en móvil
Fuente: `ir-M10`.

**Arreglo:**
- «Pista» usa el icono 💡 con `aria-label="Pedir una pista"`.
- El carácter usa 🐾 con `aria-label="Carácter del gato: {modo}"`.

### I12. Casos límite al salir de la sesión
Fuentes: `ir-M11`, `cd-M9`.

**Arreglo:**
- **«Escribir» con `writePick` sin confirmar:** se califica igual que `answered`.
- **Parejas a medias:** se descarta la tanda. No se califica.
- **`verifying` en curso:** el botón queda deshabilitado.
- **Aprender:**
  - «Sin fichas vistas» significa `learn.total === learn.items.length`.
  - El botón queda deshabilitado mientras `learnBusy`.
  - Pruebas para «Aprender sin fichas vistas» y para «`grade` devuelve `false`».

### I13. El objetivo de alto no tiene criterio de aprobado
Fuente: `ir-M12`.

**Arreglo:**
- En el paso 0, si un bloque supera el presupuesto, se ajusta la tabla de D3 antes de implementar.
- El cierre usa el navegador del entorno con `resize_window` en los cuatro tamaños.
- Se mide con `getBoundingClientRect` que la cuarta opción y `.nb-continue` estén dentro de `innerHeight`.
- Se guarda una tabla de resultados en `artifacts/ux-repaso/medidas.md`.

### I14. Referencias vagas en el plan
Fuente: `st-M1`–`st-M7`.

**Arreglo:**
- «subir `.app-notices`» se sustituye por el valor exacto de `bottom`.
- «Comprobar `overflow`» se resuelve ya (ver `ir-N5`): `.app` usa `overflow-x: clip`, `.notebook--page` es visible y `.app-main` no lo define. En `overlay`, el contenedor con scroll es `.notebook`.
- «la pista sale del globo» pasa a ser «deja de mostrarse en el globo».
- Se nombran los selectores en lugar de números de línea, que cambian al editar.
- «72 px» se escribe como `.practice-cat-avatar { inline-size: 72px; block-size: 72px }`.

---

## 🟢 Nit

Se aplican al reescribir el plan:
- `cd-N1`: el efecto de foco abarca `:702-707`.
- `cd-N3`: la pantalla final de Aprender está en `:65`.
- `cd-N5`: la etiqueta de `form` es «Palabra».
- `cd-N6`: el umbral de la píldora de racha queda en ≥ 2, como hoy. D5 solo cambia la pose con ≥ 3.
- `cd-N7`:
  - La prop `onPet` de `Companion` ya existe (pulsación larga) y no se toca. La nueva se llama `onCatTap`.
  - `compositeOver` y `contrastRatio` se reutilizan.
  - No hay e2e del repaso: se elimina la condición.
  - El fondo de la barra fija en `page` usa `--surface-herbarium`.
- `ir-N2`: «Era curdle.» va en texto plano. El recorte usa `conciseMeaning(…, 60)`.
- `ir-N3`: frases de `pet`: «Prrr…», «¡Mrrau!» y «Aquí sigo contigo.».
- `ir-N4`: la prueba de teclado comprueba la clase `is-correct`/`is-wrong` en la segunda opción.
- `ir-N6`: orden en `overlay`: «‹ Volver al libro», «Terminar por hoy», título.
- `ir-N7`: la prueba del `role="status"` único se hace sin pista.
- `st-N8`–`st-N17`: formato, preposiciones y selectores con punto.

Se registran sin aplicar:
- `cd-N2`, `cd-N4`: ajustes de números de línea que no cambian el plan.
