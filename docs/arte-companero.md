# Arte del compañero: cómo se llena el armario

Añadir una prenda no es un cambio de código: es un cambio de **dibujo** con seis
puntos de enganche. Este documento es la receta y la herramienta para que dibujar
sea un bucle de diez minutos y no una tarde adivinando coordenadas.

## La herramienta: sastrería

```bash
pnpm dev            # y abre http://localhost:5173/sastreria.html
```

- El gato a 480 px con **grid cada 10** sobre el lienzo de 160×160.
- **Guías anatómicas medidas del propio dibujo** (`getBBox` del gato real): no son
  números copiados a mano, así que si el arte cambia se mueven solas.
- Todas las capas conmutables por ranura (una por ranura: la primera que lleves
  gana).
- **Banco de paths**: pegas `d` por línea, eliges color y lo ves al instante.
- **Copiar snippet completo** genera los seis puntos con el id y el color que
  hayas puesto.

La página no entra en el bundle: `vite build` sólo compila `index.html`, así que
`sastreria.html` vive en desarrollo y no llega a producción.

## Anatomía del lienzo (medida el 2026-10-26, etapa 0)

| Guía | x,y | tamaño |
|---|---|---|
| Cabeza | 31, 21 | 99 × 85 |
| Hocico | 58, 77 | 44 × 18 |
| Cuerpo | 60, 118 | 41 × 30 |
| Oreja izquierda | 34, 21 | 30 × 18 |
| Oreja derecha | 96, 21 | 30 × 18 |
| Cola | 96, 113 | 13 × 21 |

Cada etapa (0–4) tiene su propio cuerpo y su propia cabeza, y las prendas se
calculan **en función de esas medidas** dentro de `makeStage`: `cx` (centro),
`headTop`, `jawY` (línea de la mandíbula, `headBottom - 6`), `bodyCy`, `bodyRx`,
`bodyRy`. Por eso una prenda bien dibujada le queda a las cinco etapas sin
retocar nada.

## Los seis puntos de enganche

| # | Archivo | Qué se añade |
|---|---|---|
| 1 | `src/shared/companion-data.ts` | `COMPANION_ARTICLES`: `id: "ranura"` (`head`/`neck`/`face`/`body`/`coat`) |
| 2 | `src/client/components/companion-sprites.ts` | `wear.<id>` con los `d` (dentro de `makeStage`) |
| 3 | `src/client/components/Companion.tsx` | una fila en `WEAR_LAYERS`, en su ranura |
| 4 | `src/client/styles/game.css` | `.cat .cat-wear--<id> path { fill; stroke; stroke-width }` |
| 5 | `src/client/lib/companion-closet.ts` | `ARTICLE_LABELS` y `ARTICLE_STORIES` (nombre y una línea de historia) |
| 6 | `src/shared/gamification.ts` | la fuente: `LEVEL_REWARDS[n]` o `ITEM_ACHIEVEMENT_REWARDS[id]`, o `COAT_LEVELS` si es pelaje |

Reglas que la herramienta no puede comprobar y conviene respetar:

- **Una prenda por ranura.** `WEAR_LAYERS` es una tabla de prioridad: si el gato
  lleva dos del mismo sitio, se dibuja la primera de la fila (así conviven los
  ids viejos con los nuevos sin duplicar el dibujo).
- **Colores del tema**, no literales: `var(--vermilion)`, `var(--ochre)`,
  `var(--cat-outline)`, `#1e3a8a` cuando el color *es* el chiste (capa de Darío).
- **Trazos, no rellenos sueltos**: el arte se dibuja con `path` (los `if` del
  sprite no pintan `rect`), `fill` en el primero y `stroke` común.
- **Sin emojis ni texto dentro del SVG**: el gato es dibujo; su voz va en la hoja.

## El guardián: `companion-art.test.ts`

Un test recorre todas las listas y falla si alguna no cuadra:

- las cinco etapas dibujan **las mismas** prendas (un id que sólo existe en la
  etapa 0 desaparece al crecer el gato);
- toda prenda visible tiene arte con al menos un trazo;
- toda prenda visible está en `WEAR_LAYERS` (si no, **no se dibuja nunca** y nadie
  se entera);
- `WEAR_LAYERS` no inventa ids ni repite prenda en dos ranuras;
- toda prenda tiene nombre e historia, y los nombres no se pisan;
- toda prenda se puede **ganar**: nivel, logro o paleta por nivel. El único sin
  fuente es el chaleco, a propósito;
- los pelajes del catálogo son paletas o alias conocidos.

Ese guardián es la respuesta al bug que encontramos: cinco ids de paleta en el
catálogo que ninguna recompensa otorgaba. Ahora una prenda a medias rompe el
`gate` en vez de llegar al usuario como tarjeta muerta.

## Cuatro ejemplos completos (2026-10-26)

Estas cuatro están dibujadas, coloreadas, con ficha y con fuente, y sirven de
plantilla: copiar una y cambiar los `d` es el camino más corto para la quinta.

| Prenda | Ranura | Se gana con | Por qué así |
|---|---|---|---|
| Pañuelo de lectura | `neck` | «Tres días seguidos» (racha 3) | El primer premio de constancia, visible al cuello |
| Gafas de sol | `face` | «Lector de oficio» (10 h) | Diez horas ya merecen protección solar |
| Abrigo de invierno | `body` | «Dos semanas seguidas» (racha 14) | Abriga lo que cuesta mantener |
| Pluma de escribano | `head` | «Primer libro cerrado» | Marca la última página del primer libro |

Cada una vive en los seis puntos ya enganchados, y `companion-art.test.ts` las
vigila: si alguna se queda sin arte, sin capa o sin fuente, el `gate` falla.

Notas de dibujo que salieron de estas cuatro:

- El **pañuelo** se calcula con `jawW` y baja hasta `bandY + 26`: si se alarga
  más, pisa el pecho y compite con la capa.
- Las **gafas de sol** reutilizan `p.eyeRx/eyeRy + 3` (no números fijos): en la
  etapa 4 la cabeza es más grande y siguen encajando.
- El **abrigo** cuelga de `p.bodyCy ± p.bodyRy` y deja el pecho asomar entre los
  dos faldones: leer el gato sin ropa interior no funciona.
- La **pluma** se ancla a `headTop` y a `hw`, con la punta limitada a `y ≥ 10`
  para no salirse del lienzo (el SVG recorta).

## Qué dibujar después

| Idea | Ranura | Cómo se gana | Por qué |
|---|---|---|---|
| Paraguas | `body` | racha de 5 días de lluvia/otoño | Objeto, no prenda: da juego al escenario |
| Marcapáginas de gala | `head` | terminar 10 libros | Cierra la escalera de libros |
| Bufanda de verano | `neck` | temporada de verano | Hoy la ventana de verano reutiliza las gafas |
| Delantal de cuaderno | `body` | 100 palabras guardadas | Premia el vocabulario, no la lectura |

Los **pelajes no necesitan arte nuevo**: son cinco paletas, se pintan con los
tokens de `COMPANION_COATS` y las rayas de `art.marks`. Añadir un pelaje es
añadir una entrada a la tabla, no dibujar.
