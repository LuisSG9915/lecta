# Auditoría de la investigación — cómo usarla

Este directorio contiene el arnés que permite a **otra IA (o a una persona) verificar** las
afirmaciones de `docs/estrategia-aprendizaje-2026-10-24.md` sin tener que creerle nada al autor.

## Piezas

| Archivo | Qué es |
|---|---|
| `claims.json` | El registro: 14 afirmaciones falsables. Cada una declara su cita textual en el documento, los anclajes de código (`archivo:línea` + patrón), las sondas ejecutables y las referencias que la sostienen. |
| `reporte.md` / `reporte.json` | Resultado de la última corrida (se regeneran). |
| `PROMPT-AUDITOR.md` | Encargo listo para pegarle a otra IA auditora. |
| `../../scripts/audit-investigacion.mjs` | El auditor: anclajes + sondas + referencias. |
| `../../scripts/audit-investigacion.test.mjs` | Pruebas del propio arnés (incluye un caso que **debe** fallar). |

## Correr

```bash
node scripts/audit-investigacion.mjs                 # sin red: código + forma de las referencias
node scripts/audit-investigacion.mjs --online        # además resuelve DOI (Crossref) y URLs
node scripts/audit-investigacion.mjs --claim H3-theta-escala
node scripts/audit-investigacion.mjs --pack artifacts/auditoria/pack
```

Códigos de salida: `0` aprobado (o aprobado con pendientes), `1` alguna afirmación refutada,
`2` error de uso. En `pnpm test` corre el arnés contra sí mismo.

## Qué significa cada estado

- **PASS** — todas las comprobaciones de esa afirmación coinciden: el documento dice eso, el
  código lo hace y (con `--online`) la referencia existe con los metadatos citados.
- **FAIL** — alguna comprobación no coincide. Es lo que hay que leer primero: o el documento
  está mal, o el código cambió y el documento quedó viejo.
- **UNVERIFIED** — no se pudo comprobar: sin red, una referencia con solo forma válida; o una
  sonda que no corre en Node. **Nunca cuenta como aprobada.**
- **NOT_CHECKABLE** — la referencia no tiene identificador (se cita por revista y año): hay que
  revisarla a mano.
- **SKIP** — una sonda desconocida o un tipo de comprobación que el auditor no implementa.
- **REFUTED_EXPECTED** — la auditoría marcó la afirmación como `REFUTADA` y sus comprobaciones
  fallan, como se espera. No vuelve `FAIL` el reporte.
- **VERDICT_STALE** — la afirmación está marcada `REFUTADA`, pero sus comprobaciones ya pasan:
  el código cambió y hay que revisar el veredicto. Cuenta como fallo.

Cada afirmación separa **Código** y **Referencias**, porque son dos actos distintos: que el
programa haga lo que el documento dice no valida la ciencia que lo justifica, y al revés.

## Qué queda fuera del arnés (y debe juzgar el auditor)

1. **La calidad de la evidencia.** El registro declara un nivel (`meta-análisis`, `preprint`,
   `benchmark de logs`…), pero no mide si el nivel está bien puesto. Eso es juicio.
2. **La interpretación.** Que un estudio diga `d = 0,46` no implica que «esta función lo
   aproveche». El arnés verifica que la cita existe y dice lo que se le atribuye; no que la
   conclusión de producto se siga de ella.
3. **Las recomendaciones.** El plan P0/P1/P2 es opinión informada, no una afirmación falsable.
4. **Las ausencias.** «No se mide comprensión» se comprueba por ausencia de identificadores
   (`comprehension`, `delayedRetention`…), que es evidencia más débil que una presencia: un
   módulo podría medirlo con otro nombre.

## Reglas del arnés

- No toca red sin `--online` y nunca escribe fuera de `--out` / `--pack`.
- No ejecuta código del documento: solo lee el repositorio e importa módulos puros para observar
  valores (`profile-models`, `gamification`, `ts-fsrs`).
- Los números de línea se buscan con una ventana (±3 por defecto): mover código no rompe el
  anclaje, cambiar el comportamiento sí.
- Si una sonda no puede importar un módulo en Node, se marca `SKIP` y se dice por qué.
- `reachable` exige que el símbolo se use en producción fuera del archivo que lo define. No
  cuentan pruebas, comentarios ni reexportaciones. Toda afirmación que cite una función debería
  llevar uno.
