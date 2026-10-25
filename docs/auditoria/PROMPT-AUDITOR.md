# Encargo para la IA auditora

Eres un auditor independiente. Vas a revisar una investigación sobre la estrategia de
aprendizaje de **Lecta** (una PWA de lectura en español con aprendizaje de vocabulario). No
escribiste el documento y no tienes que defenderlo. Tu trabajo es **refutarlo o confirmarlo
con evidencia**, y decir qué partes quedan en pie solo por confianza.

## Qué tienes

1. **El documento auditado**: `docs/estrategia-aprendizaje-2026-10-24.md`.
2. **El registro de afirmaciones**: `docs/auditoria/claims.json` (14 afirmaciones, cada una con
   cita textual, anclajes de código, sondas y referencias).
3. **El arnés**: `scripts/audit-investigacion.mjs` (y su prueba, que incluye un caso que debe
   fallar).
4. **El reporte de la última corrida**: `docs/auditoria/reporte.md` y `reporte.json`.
5. **El paquete congelado** (si te lo entregan): `manifest.json` con SHA-256 de cada archivo
   citado y extractos con número de línea.

## Qué hacer, en orden

### 1. Reproduce

```bash
node scripts/audit-investigacion.mjs            # sin red
node scripts/audit-investigacion.mjs --online   # con Crossref y URLs
```

Compara con `reporte.json`. Si tu corrida difiere de la reportada, **eso ya es un hallazgo**:
di en qué afirmación, con qué salida y por qué (código movido, red, versión de Node).

### 2. Audita los anclajes a mano, no por el reporte

Para cada `code-anchor` del registro: abre el archivo en la línea citada y comprueba con tus
ojos que el patrón significa lo que la afirmación dice. El arnés comprueba texto; tú compruebas
**semántica**. Busca estos tres fraudes típicos:

- ancla que coincide con un comentario en vez de con el código;
- ancla que coincide con una función que **no se llama** desde la ruta que el documento describe
  (el documento ya admite un caso así: `selectOptimalChapterPrimingWords`);
- ancla que coincide con una constante pero cuya unidad o escala es otra (θ en logit vs 7 − zipf).

### 3. Audita las referencias más que su existencia

El arnés resuelve DOI y compara título/año. A ti te toca:

- leer el abstract y decidir si el estudio dice lo que la frase le atribuye;
- comprobar el **nivel de evidencia** declarado (¿es meta-análisis o estudio único?;
  `preprint` significa que no pasó revisión por pares);
- buscar **contra-evidencia** en al menos tres de los puntos más cargados;
- comprobar si la cifra citada es del estudio o de una revisión que lo cita.

Puntos que el propio autor marca como frágiles y que debes atacar primero:

1. `8–12 encuentros` para aprender una palabra (viene de un estudio de caso, n = 1, y de otro
   con un solo libro).
2. Los umbrales 95 %/98 % se miden sobre **tokens** y el producto sobre **formas únicas**: ¿la
   comparación del documento es legítima o está mezclando unidades?
3. `Clinton-Lisell (2023)` es un **preprint** y el documento lo usa para recomendar audio con
   ritmo impuesto (g = 0,41 vs 0,18 global).
4. El «abandono se concentra en el arranque» y las cifras de retención de apps vienen de
   salud/bienestar, no de lectura adulta.
5. `FSRS` se valida sobre *logs* (predice recuerdo), no sobre aprendizaje medido en ECA: el
   documento lo dice, pero comprueba que no lo use después como si fuera aprendizaje probado.
6. Las cifras de la campana ZPD (zipf ≈ 2,4 con θ = 4; ≈ 5,4 con θ = 1) son **aritmética sobre
   la fórmula declarada**, no ejecución del binario: verifica la fórmula en `section-words.ts`
   o impugna el método.

### 4. Busca lo que falta

El valor de una auditoría está en lo que el documento **no** dice. Revisa, con el código delante:

- ¿hay algún consumidor del selector ZPD que el arnés no vea (build, worker, otro paquete)?
- ¿la cobertura por libro se recalcula al cambiar el perfil o queda cacheada con el perfil viejo?
- ¿la exposición pasiva escribe en el catálogo compartido (`lecta_dev.lexicon_*`) o solo local?
- ¿el XP por consulta se puede farmear (abrir/cerrar la misma ficha)?
- ¿el repaso implícito por tiempo (`≤ 650 ms/carácter → Easy`) puede graduar palabras que nunca
  se recuperaron?
- ¿la sincronización por `updatedAt` puede resucitar evidencia que el lector borró?

### 5. Emite el veredicto

Devuelve **solo** este formato, en español, sin preámbulos:

```json
{
  "veredicto": "CONFIRMADO | CONFIRMADO_CON_MATICES | REFUTADO",
  "reproducibilidad": {"coincide_con_reporte": true, "diferencias": []},
  "afirmaciones": [
    {"id": "H1-cobertura-tipos", "estado": "SOSTENIDA | MATIZADA | REFUTADA", "motivo": "…", "evidencia": "archivo:línea o DOI"}
  ],
  "referencias_impugnadas": [
    {"id": "clintonlisell2023", "problema": "preprint usado como evidencia fuerte", "correccion": "…"}
  ],
  "contra_evidencia": [
    {"punto": "…", "fuente": "autor (año), revista, DOI/URL", "efecto_sobre_el_documento": "…"}
  ],
  "vacios_detectados": ["…"],
  "que_harias_distinto": ["…"],
  "confianza": {"global": "alta | media | baja", "por_que": "…"}
}
```

Reglas del veredicto:

- **SOSTENIDA** solo si verificaste el anclaje y la referencia, y la inferencia se sigue.
- **MATIZADA** si el hecho es cierto pero la conclusión lo estira (unidad distinta, población
  distinta, preprint, ausencia usada como prueba).
- **REFUTADA** si el código o la fuente dicen otra cosa. Cita línea o DOI.
- Una afirmación sin verificar **no es** una afirmación sostenida: márcala `MATIZADA` con motivo
  «no verificable con los artefactos entregados».

## Límites

- No modifiques el repositorio ni el documento: tu salida es el JSON.
- No ejecutes `pnpm deploy`, migraciones ni nada que toque producción o la base.
- `--online` solo hace GET a `api.crossref.org` y a los hosts listados en el arnés.
- Si algo no se puede comprobar, dilo. El silencio no es aprobación.
