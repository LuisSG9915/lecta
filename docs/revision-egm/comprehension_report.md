# Etapa 6 — Prueba de comprensión: `docs/concentracion-y-lectura.md`

**Revisor:** `egm-comprehension`, con contexto limpio. Solo leyó el documento: ningún archivo del repositorio, nada de contexto adicional.
**Rango:** líneas 1–425. `DetailedRange` no aplica.
**Qué mide:** si alguien sin contexto puede reconstruir qué propone el documento y cómo funciona hoy el sistema solo con lo que está escrito.

## Qué propone este documento

El documento no propone un único cambio. Junta una síntesis de investigación con un mapa del producto, y sirve de insumo para diseñar funciones y prompts de IA en Lecta. Clasifica la evidencia sobre concentración lectora por nivel de certeza y la cruza con las funciones de Lecta en cuatro grupos: respaldadas, plausibles, heurística propia y brechas.

A partir de ese cruce propone cinco funciones nuevas:
- un marcador de retomar;
- una meta de sesión opcional;
- una regla de no intervenir en los primeros 5 minutos;
- TTS con lectura sincronizada;
- una racha flexible, o «congelador».

También fija ocho principios obligatorios para cualquier mensaje de IA:
1. solo en breakpoints;
2. tope diario;
3. una sola acción por mensaje;
4. nombrar la señal observable;
5. sin regaño;
6. sin inferir TDAH ni dislexia;
7. el silencio es válido;
8. respetar `useAi`, el modo «off» y la supresión por libro.

Por último, documenta una operación de IA `tip` que ya funciona: un consejo diario en la estantería con acciones cerradas. Y descarta usar IA para detectar fatiga, calificar palabras, dar ánimo o interpretar series temporales.

## Cómo funciona hoy el sistema, según este documento

Lecta es una PWA offline-first para leer EPUB y ampliar vocabulario en español.

- **Stack:** el cliente usa React. El backend es un Worker de Cloudflare con CockroachDB y R2. La IA es DeepSeek, con cuatro operaciones: `enrich`, `item`, `verify` y `explain`.
- **Lectura:** el lector analiza cada capítulo en local, predice qué palabras serán desconocidas y ofrece una vista previa opcional («Antes de leer»). Consultar una palabra abre un panel lateral.
- **Vocabulario y progreso:** las palabras guardadas se repasan en el Cuaderno con FSRS. También hay progreso, cobertura por libro y gamificación con un gato acompañante.
- **Foco:** hay cinco modos visuales. Una telemetría heurística marca fatiga a partir de la proporción de retrocesos y dispara un aviso 20-20-20. El gato entra en `deep_focus` a los 10 minutos y deja de hacer visitas.
- **Registro:** un registro local de eventos de lectura (90 días) alimenta los cálculos diarios de WPM, regresiones, consultas y fatiga.

> **Nota de la coordinación:** este último párrafo muestra el costo del hallazgo Z2 de la Etapa 5. Un lector nuevo se queda con «cuatro operaciones de IA», y el código tiene 11.

## Hallazgos

### Major

1. **Número de operaciones de IA** (líneas 33–38 frente a 363–369). §1 dice «cuatro operaciones» y §4 afirma que `operation: "tip"` está implementado. No queda claro cuál de las dos secciones está desactualizada.

2. **Cadencia del tip** (líneas 333–336 frente a 366–367). Una dice «una por cuenta y día» y la otra «1/día por dispositivo». Además aparece un «rate limit 6/h» sin explicar cómo convive con el límite diario.

3. **Eventos del registro** (líneas 99–103 frente a 325 y 368–369). §1 enumera los eventos de `reading-events.ts` sin `tip_shown` ni `tip_accepted`, pero §4 dice que esos eventos ya están en ese mismo registro.

4. **Cloze de fin de capítulo** (línea 330). Se cita como «infraestructura» que ya existe, pero §1 solo describe el cloze como práctica dentro del Cuaderno (línea 65).

5. **No se distingue lo implementado, lo decidido y lo sugerido** (§3 «Brechas» y todo §4).
   - El apartado «Usos candidatos» abre con algo que ya está implementado.
   - La «nueva señal» de menos de 5 minutos (línea 321) aparece junto a la frase «sin telemetría nueva» (línea 315).
   - El principio 2 deja «≤N» sin valor.
   - Ninguna brecha dice si está decidida, pendiente o descartada.

6. **Unidades de tiempo sin definir.** Se usan «sesión», «tramo», «tramo continuo», «segmento», «intervalo» y «visita» (líneas 67–68, 88, 289, 312–313, 321 y 329) sin definir ninguna. Las reglas de menos de 5 minutos y de 25 minutos o más dependen de saber qué abre y qué cierra cada unidad.

7. **La heurística de fatiga no se puede reproducir** (líneas 87–90, 92 y 276). Con lo que dice el texto no se sabe qué es un «movimiento», cómo se calcula el «% de retrocesos» ni qué cuenta como «sin interrupción».

8. **Se piden reutilizar mecanismos que no se explican** (líneas 341–342 y 346–347). No se dice qué es `react()`, qué significa que esté «pendiente» ni dónde vive `EXPLAIN_SYSTEM_PROMPT`.

9. **Señales sin definir** (líneas 309, 312–315 y 366).
   - `DayFocus` y `savedNotPresented` no tienen definición.
   - «Agregados de ≤14 días» no dice qué campos agrega.
   - El «patrón errático estable» no tiene una medida en el sistema que se describe.

### Nit

10. **Etiquetas de evidencia fuera de la leyenda.** Las etiquetas `disputado`, `plausible/preliminar` y `replicado, mixto` no están en la leyenda. Además, las viñetas de las líneas 157–160 y 165–168 no llevan etiqueta.

11. **Términos internos sin definir.**
    - «evidencia de conocimiento» y «perfil»;
    - `predictSection` y «manifiesto precomputado del seed»;
    - «candidatas al Cuaderno» y «diferidas paginadas»;
    - «capas» y «supresión por libro»;
    - los modos del gato (visits, playful, always);
    - «aviso de preparación» y «riel».

    Tampoco se dice que las acciones `focus_ruler` y `syntactic` corresponden a los modos «Regla de foco» y «Líneas sintácticas».

12. **Siglas y fuentes sin expandir ni enlazar.**
    - VSTF y BeeLine no se explican.
    - Hay fuentes sin DOI ni enlace: «NSF 10284385», «PMC4052664», el estudio de Íkala sin título y el de «settling-in» sin autor.
    - Sörqvist & Marsh y Readability Consortium se citan pero no aparecen en «Fuentes principales».

13. **Procedencia vaga** (líneas 3 y 151). «Revisada con una segunda opinión externa» no dice quién revisó ni qué cambió. La cifra «~20–30 % del tiempo de lectura» no tiene fuente.

## Valoración del revisor

Pudo parafrasear todas las secciones, así que no hay bloqueos. Los problemas principales son las contradicciones entre §1 y §4 sobre el estado del sistema (hallazgos 1–4) y la falta de distinción entre lo implementado, lo decidido y lo sugerido (hallazgo 5).

## Cruce con la Etapa 5

| Etapa 6 | Coincide con la Etapa 5 |
|---|---|
| 1 | Z2 (inventario de IA) |
| 2 | Z8 (cadencia) |
| 3, 4 | Nuevos: el mapa de §1 no cubre lo que §4 da por existente |
| 5 | Z1 (tres documentos en uno), N2 |
| 6, 7, 9 | Nuevos: definiciones que faltan para que las reglas se puedan reproducir |
| 8 | Nuevo |
| 10 | N1 |
| 11–13 | Nuevos (Nit) |
