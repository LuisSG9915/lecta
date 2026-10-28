# Encargo — Auditoría del Cuaderno y de la «Sesión Fluida»

Esto se pega en una sesión nueva, sin más contexto. Eres un auditor independiente de
**Lecta** (PWA de lectura en español con aprendizaje de vocabulario). No escribiste el
Cuaderno y no tienes que defenderlo. Tu trabajo es **refutar o confirmar con evidencia** y
devolver un plan de implementación **por fases**.

## La queja, con las palabras del usuario

> «No recuerdo para nada las palabras al dar iniciar sesión fluida. No creo que esa sea la
> mejor manera de aprender: primero tengo que aprenderme las palabras, de ahí sí puedo
> practicar. Necesitamos mejorar este apartado.»

Tu hipótesis de trabajo (a confirmar o refutar, no a asumir): **el Cuaderno examina antes de
enseñar**. La sesión fluida pide recuperar el significado de palabras que se presentaron una
vez —o nunca— y la fase de presentación existe, pero está enterrada y desconectada de la
acción principal.

## Qué tienes

1. **El arnés**: `scripts/audit-cuaderno.mjs`. 13 afirmaciones falsables con anclajes
   `archivo:línea`, la lista de preguntas de investigación y las fases F0–F6.
2. **El reporte de la última corrida**: `docs/auditoria/cuaderno/evidencia.md` y
   `evidencia.json`.
3. **El código**: `src/client/components/Vocabulary.tsx` (héroe, cola, fichas),
   `src/client/lib/practice.ts` (enrutamiento cognitivo), `src/client/lib/learn.ts`
   (primera exposición), `src/client/lib/fsrs.ts` (agenda), `src/client/components/GamePanel.tsx`
   (segunda puerta a la sesión).
4. **El marco del proyecto**: `AGENTS.md` (reglas Zero-Friction y puertas de verificación) y
   `docs/auditoria/PROMPT-AUDITOR.md` (el formato de auditoría ya usado en este repo).

## Qué hacer, en orden

### 1. Reproduce

```bash
node scripts/audit-cuaderno.mjs                # sin red
node scripts/audit-cuaderno.mjs --online       # además resuelve citas en Crossref
node scripts/audit-cuaderno.mjs --brief        # encargo ya formateado
```

Sale `0` si las afirmaciones coinciden con el código, `1` si el código se movió o el defecto
ya no está. Si tu corrida difiere de `evidencia.json`, **eso ya es un hallazgo**: di en qué
afirmación y con qué salida.

### 2. Audita el flujo a mano, no por el reporte

El arnés comprueba texto; tú compruebas **semántica**. Recorre el embudo real y mide:

- guardar una palabra mientras lees → abrir el Cuaderno → tocar el botón primario del héroe;
- ¿cuántos toques y cuántos segundos hay entre «veo la palabra» y «me preguntan por ella»?
- ¿qué ve el usuario antes de la primera pregunta? Si la respuesta es «cuatro opciones», la
  queja está confirmada y hay que decir con qué palabra y en qué pantalla.
- ¿qué pasa con una palabra **borrada** (tombstone) o sin significado guardado?
- ¿qué cambia con `learnPending > 0` y con `learnPending === 0`?

Busca estos tres fraudes típicos:

- ancla que coincide con un comentario en vez de con el código que se ejecuta;
- ancla sobre una función que **no** es la que dispara la ruta que se describe (la sesión
  fluida tiene dos puertas: héroe y `GamePanel`);
- copia de interfaz que promete algo que el flujo no hace («~2 min» con palabras jamás vistas).

### 3. Audita la ciencia, no su existencia

`--online` resuelve la cita; a ti te toca decidir si dice lo que se le atribuye. Puntos
cargados, por orden de peligro:

1. **R1 (testing effect)** se midió sobre material ya estudiado. Si la sesión fluida lo usa
   para justificar preguntar sobre palabras nunca presentadas, la inferencia no se sigue.
2. **R2 (pretesting)** es el mejor contraargumento al arreglo «presentar primero». Trátalo en
   serio: si el efecto se replicara con pares forma-significado aislados y sin
   retroalimentación, el arreglo propuesto empeora el aprendizaje. Di qué evidencia falta.
3. **R3**: si la recuperación fallida solo ayuda **con corrección inmediata**, la red actual
   (`rescueChallenge`, pista de dos letras) no capitaliza el fallo: lo tapa.
4. **R5**: el umbral de encuentros antes de exigir recuperación. Comprueba si el número que se
   use en el plan tiene fuente o es folclore (los estudios de caso con n = 1 no cuentan).
5. **R6 (FSRS)**: predice recuerdo desde logs. Una tarjeta con `reps = 0` no tiene log. Que la
   estabilidad predicha no se use como si midiera aprendizaje probado.

### 4. Busca lo que falta

El valor de la auditoría está en lo que el registro **no** dice. Revisa con el código delante:

- ¿la sesión fluida puede servir palabras que el usuario declaró «ya la conozco»?
- ¿el orden de la cola depende de `priority` o del orden de guardado?
- ¿qué pasa con una palabra sin `meaning` en el reto de 4 opciones: se cae del modo, se
  inventa, o se pregunta igual?
- ¿el acierto tras una presentación de 2 segundos escribe estabilidad de repaso?
- ¿la energía léxica / XP se puede farmear repitiendo la misma sesión?
- ¿el héroe tiene un solo botón primario? (Regla Zero-Friction del proyecto: un solo CTA.)

### 5. Emite el veredicto y el plan

Devuelve **solo** este JSON, en español, sin preámbulos ni resumen en prosa:

```json
{
  "veredicto": "CONFIRMADO | CONFIRMADO_CON_MATICES | REFUTADO",
  "queja_del_usuario": {
    "se_reproduce": true,
    "evidencia": "archivo:línea o pasos exactos",
    "mecanismo": "por qué el usuario no recuerda nada (en una frase)"
  },
  "afirmaciones": [
    { "id": "C1-cta-primaria-abre-una-prueba", "estado": "SOSTENIDA | MATIZADA | REFUTADA", "motivo": "…", "evidencia": "archivo:línea" }
  ],
  "investigacion": [
    { "id": "R2-pretesting", "existe": true, "dice_lo_que_se_le_atribuye": false, "correccion": "…", "efecto_sobre_el_plan": "…" }
  ],
  "vacios_detectados": ["…"],
  "fases": [
    {
      "id": "F1",
      "titulo": "…",
      "cambio_de_comportamiento": "qué hace distinto el producto al terminar",
      "archivos": ["ruta:línea"],
      "aceptacion": ["prueba concreta que debe pasar"],
      "puerta": "comando exacto"
    }
  ],
  "orden_recomendado": ["F0", "F1", "…"],
  "confianza": { "global": "alta | media | baja", "por_que": "…" }
}
```

Reglas del veredicto:

- **SOSTENIDA** solo si verificaste el anclaje y la referencia, y la inferencia se sigue.
- **MATIZADA** si el hecho es cierto pero la conclusión lo estira (otra población, otra
  unidad, preprint, ausencia usada como prueba).
- **REFUTADA** si el código o la fuente dicen otra cosa. Cita línea o DOI.
- Una afirmación que no puedas verificar **no** está sostenida: márcala `MATIZADA` con motivo
  «no verificable con los artefactos entregados».
- Si el plan que propone el arnés te parece incorrecto, **dilo y propón el tuyo**: el arnés es
  una hipótesis, no la verdad. Pero cada fase debe caber en una sesión de implementación y
  llevar su puerta.

## Límites

- No modifiques el repositorio ni la interfaz: tu salida es el JSON.
- Nada de `pnpm deploy`, migraciones, ni escrituras contra la base o producción.
- `--online` solo hace GET a `api.crossref.org`.
- Si algo no se puede comprobar, dilo. El silencio no es aprobación.
