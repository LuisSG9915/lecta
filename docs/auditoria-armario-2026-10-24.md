# Auditoría del Armario del compañero — 2026-10-24

> «Al presionar un atuendo no lo carga visualmente, no hace nada.»
>
> El reporte tenía razón y el motivo no era uno: eran cuatro cosas sumadas. Tres
> quedan corregidas en esta pasada y la cuarta (el diseño de la sección) se
> propone aquí en detalle.

## 1. Resumen ejecutivo

| # | Qué pasa hoy | Estado |
|---|--------------|--------|
| 1 | Los 5 pelajes del selector **escriben aunque estén bloqueados**: el gato no cambia de color y, peor, **se pierde el pelaje que ya llevaba**. | **Corregido** |
| 2 | El globo de prueba **cortaba el requisito**: «Se desbloquea en el niv…». Justo el número que el usuario necesita. | **Corregido** |
| 3 | El pelaje **natural** aparecía con candado («Nivel 8») aunque es el que el gato ya trae puesto. | **Corregido** |
| 4 | La sección, como espacio, no está diseñada: **33 tarjetas en un carril de 4 092 px**, 32 bloqueadas al empezar, miniaturas idénticas y una prenda cada 90 minutos de lectura. | **Propuesta §6-§8** |
| 5 | Cinco tarjetas de pelaje **imposibles de desbloquear** por diseño (`tuxedo`, `latte`, `ginger`, `mist`, `calico`: ninguna ruta de recompensa las otorga). | Propuesta (§7.1) |
| 6 | Abrir el armario desde *Tu recorrido* deja **dos diálogos `aria-modal` apilados** y el contenido del recorrido se transparenta bajo la hoja. | Propuesta (§7.2) |

Verificación: `pnpm gate` en verde (2 582 pruebas, lint 0 warnings, 178,47 kB gzip de
215). Capturas de antes/después en `artifacts/auditoria-armario/`.

## 2. Método

- `pnpm build` + `vite preview` en `:5199`; Chrome real (Playwright, canal del
  sistema) en tres viewports: **420×880**, **390×844** y **1440×900**, más
  **900×500** para horizontal.
- Geometría medida con `getBoundingClientRect` y `getComputedStyle` sobre
  `.sheet--stage`, `.companion-stage`, `.companion-tray` y
  `.companion-tabpanel`; interacciones reales (pulsación de swatches y de
  tarjetas) leyendo después el DOM y el registro `equipped.*` en IndexedDB.
- Banco de pruebas unitario aparte para la parte pura (`effectiveEquipped`,
  `drawableAccessories`, `ownedArticles` con `xp` controlado).
- Sin tocar producción ni la base de datos.

## 3. Por qué «no hace nada» — las cuatro causas

### 3.1 El selector de pelaje escribe lo que no puede dibujar

`CompanionCloset.tsx` llamaba a `onChoose("coat", …)` desde los 5 swatches **sin
mirar el inventario**, mientras la bandeja de tarjetas sí comprobaba `owned`. El
resultado, medido:

- Nivel 1 (lector nuevo): `owned` no contiene **ningún** pelaje. Se pulsa
  «Crema Canela» → se escribe `equipped.coat = "pelaje-siames"` → la cabecera pasa
  a «Crema Canela» → **el gato sigue de color Tinta y Crema**, porque
  `drawableAccessories` filtra por inventario y no dibuja nada.
- Nivel 2 con «Naranja Miel» puesto: se pulsa «Crema Canela» (nivel 6) → el
  registro cambia → **el gato pierde el pelaje que tenía** y vuelve al natural.
  Reproducido a mano y en prueba unitaria: `antes se dibuja: ["pelaje-atigrado"]`
  → `después: []`.

Es exactamente el síntoma reportado: se pulsa, la interfaz dice que sí, el gato
no cambia y (en el peor caso) se rompe lo que estaba bien.

### 3.2 El requisito se cortaba con puntos suspensivos

`.companion-bubble` estaba posicionado con `left: 50%` + ancho automático: el
bloque disponible para un absoluto con `left:50%` es **la mitad derecha** del
escenario. Con «Quitar prueba» dentro del mismo globo, el texto quedaba en ~80 px
y `white-space: nowrap` lo remataba con «…». La cadena era
`Así se vería · Se desbloquea en el nivel 3` y en pantalla se leía
`Así se vería · Se desbloquea en el…`. Captura: `01-armario-antes.png`.

### 3.3 El pelaje natural estaba «bloqueado»

`resolveCoatId(null)` devuelve `tuxedo`, que es también el premio de nivel 8
(`COAT_LEVELS["pelaje-tuxedo"] = 7`). El gato de un lector nuevo se dibuja
`cat--coat-tuxedo` y el swatch de «Tinta y Crema» aparecía con el nivel 8 y
`data-locked`. Contradicción visible en la primera pantalla.

### 3.4 Lo que sí funcionaba no se veía

Las 32 tarjetas bloqueadas **sí** hacen algo (ponen la prenda en el gato y el
globo lo explica), pero:

- las tarjetas miden 7 rem y el carril completo **4 092 px**: en un iPhone se ven
  **2,5 tarjetas** de 33, sin agrupar por ranura ni ordenar por cercanía;
- el resultado se dibuja en un gato de **128 px** veinte centímetros más arriba;
- nada persiste (es una prueba), y el borde discontinuo + «Quitar prueba» son la
  única señal de que no se lo ha puesto.

Con esa relación señal/ruido, «no hace nada» es la lectura razonable.

## 4. Inventario de hallazgos

| # | Hallazgo | Evidencia | Archivo | Estado |
|---|----------|-----------|---------|--------|
| 1 | Swatch de pelaje escribe sin inventario y borra el pelaje puesto | `cat--coat-tuxedo` invariable tras pulsar 4 swatches; `equipped.coat` cambia | `CompanionCloset.tsx:159-162` | **Corregido** |
| 2 | Globo truncado por `left:50%` + `nowrap` | «Se desbloquea en el…» | `game.css:1750`, `:1770` | **Corregido** |
| 3 | Pelaje natural con candado de nivel 8 | `Tinta y Crema · Nivel 8 · locked` | `CompanionCloset.tsx:123` | **Corregido** |
| 4 | 5 tarjetas de pelaje nunca desbloqueables | `unlockedAccessories`/`unlockedCoats`/`LEVEL_REWARDS`/`ITEM_ACHIEVEMENT_REWARDS` no las otorgan | `companion-data.ts:186-190` | Abierto (P1) |
| 5 | 12 tarjetas de pelaje para 5 pelajes (7 legados duplicados) | «Tuxedo» aparece dos veces en la bandeja | `companion-data.ts:178-190` | Abierto (P1) |
| 6 | Carril de 4 092 px sin agrupar por ranura | medido en los 3 viewports | `CompanionCloset.tsx:125-128`, `game.css:2254` | Abierto (P0) |
| 7 | Al empezar solo 1 de 33 prendas está disponible | `owned` a nivel 1 = `{chaleco}` | `CompanionProvider.tsx:91` | Abierto (P0) |
| 8 | Primera prenda «de verdad» a los 90 min de lectura | 1 XP = 1 min; `LEVEL_REWARDS[2]` = bufanda a 90 XP | `gamification.ts:120-131`, `:395` | Abierto (P0) |
| 9 | El candado dice «Nivel 8» o el nombre del logro, nunca el requisito | «Mente en forma» sin decir «50 repasos» | `CompanionCloset.tsx:234-242` | Abierto (P0) |
| 10 | Panel de 252 px de alto con 301 px de contenido; en horizontal (900×500) baja a **66 px** | medido | `game.css:2088`, `components.css:251` | Abierto (P1) |
| 11 | Dos `aria-modal` apilados al abrir el vestidor desde *Tu recorrido* | 2 `[role=dialog]`, el recorrido se lee bajo la hoja | `Journey.tsx:483-491` | Abierto (P1) |
| 12 | No hay «quitar todo», ni deshacer, ni look rápido | — | — | Propuesta (§7) |

## 5. Lo corregido en esta pasada

### 5.1 Selector de pelaje con inventario (`CompanionCloset.tsx`)

```tsx
const isNatural = cId === resolveCoatId(null);      // el color de serie
const isOwned  = owned.has(coatArticle);
const available = isOwned || isNatural;
const reqLevel  = available ? null : requiredLevel(coatArticle);
…
onClick={() => {
  if (!available) { onTryOn(coatArticle, reqLevel); return; }  // prueba, no escribe
  void onChoose("coat", isOwned ? coatArticle : null);
}}
```

- El swatch bloqueado **prueba** (el gato se pinta con ese pelaje) y **no
  escribe**: ya no se puede perder el pelaje puesto.
- Cada bloqueado muestra su requisito: `Nivel 6`, `Nivel 2`, `Nivel 4`, `Nivel 3`
  (9 px, `--ink-faint`) y el `aria-label` completo.
- El natural nunca está bloqueado: si no está en el inventario, pulsarlo **quita
  el registro** (`null`) en vez de fingir una prenda.
- La cabecera y el resaltado salen ahora de lo **dibujable**
  (`equipped.coat && owned.has(...)`), no del deseo del registro: nunca más
  «Dorado» sobre un gato Tinta y Crema.

### 5.2 Globo que cabe (`game.css`, `CompanionStage.tsx`)

```css
.companion-bubble {
  position: absolute;
  top: -0.25rem;
  inset-inline: 0;          /* antes: left: 50% */
  margin-inline: auto;
  width: max-content;
  max-inline-size: calc(100% - var(--s-4));
}
```

Y el texto pasa a `Así se vería · Nivel 6` (el requisito completo, con el nombre
del logro, vive en el `aria-label` de la tarjeta y en su estado visible). Antes/
después en `02-prueba-prenda-bloqueada.png` y `04-pelaje-corregido.png`.

### 5.3 Pruebas añadidas (`CompanionPanel.test.ts`)

- «el swatch de un pelaje bloqueado prueba y no escribe» — comprueba el nivel en
  el swatch, que **no** se escribe `equipped.coat` y que el globo dice el nivel.
- «el swatch de un pelaje desbloqueado sí lo equipa» — escribe `pelaje-atigrado`
  con `xp: 60`.
- «un pelaje del registro que esta copia no tiene no se marca como puesto» — la
  cabecera dice el natural, no «Dorado».
- Ajustada la prueba del globo: ahora exige el nivel (`Nivel 7`), no la frase
  larga que se recortaba.

`pnpm gate` en verde. Nota: `aria-disabled` en los swatches bloqueados hace que
Playwright los considere «no habilitados» igual que las tarjetas; en el navegador
siguen siendo pulsables para probar (es la convención que ya usaba la bandeja).

## 6. Anatomía propuesta del Armario

El problema de fondo no es un bug: es que la sección está organizada como **un
inventario** y debería estar organizada como **un espejo**.

```
┌──────────────────────────────────────────┐
│  GATO · 3/4 de la altura del panel       │   ← el gato GRANDE, siempre
│  (escenario con fondo del look)          │      visible mientras eliges
│  globo: «¿Me queda bien?»                │
├──────────────────────────────────────────┤
│  Cabeza 1/6 · Cuello 2/7 · Ojos 0/4 ·    │   ← ranuras con progreso
│  Escenario 0/4 · Pelaje 2/5              │      (una fila, no seis chips)
├──────────────────────────────────────────┤
│  [Miniatura]  Boina de poeta             │   ← UNA prenda a la vez,
│  Se desbloquea con «Maratón»:            │      grande, con su historia
│  lee 30 min de una sentada · 12/30 min   │      y su barra de progreso
│  ▓▓▓▓▓▓░░░░░░                            │
│  [ Poner ]  [ Probar ]  [ ⬅ anterior ]   │
└──────────────────────────────────────────┘
```

Reglas de interacción propuestas:

1. **Un toque = puesto**. Sin confirmación, sin «Guardar». El botón queda en
   «Quitar» (el mismo control, estado alterno).
2. **El gato reacciona al ponérselo**: pose de mirarse (`.cat--p-pet` ya existe),
   ronroneo si el sonido está activo, y una frase en su voz. Un cambio de ropa
   debe ser un momento, no un `setState`.
3. **Nada de perder selección**: nunca se escribe un valor que no se pueda
   dibujar (regla ya aplicada en §5.1, extenderla a la bandeja).
4. **Agrupación por ranura** con contador y sin duplicados: 5 pelajes, 6 cabezas,
   7 cuellos, 4 ojos, 4 escenarios. Nunca 33 en un carril.
5. **Carrusel de una prenda** (o rejilla de 3×N con página) en vez de 4 092 px de
   scroll horizontal: el armario es un catálogo que se hojea, no una cinta.
6. **Objetivos táctiles ≥ 44 px** y el panel nunca por debajo de 4 rem de área
   útil (hoy en horizontal quedan 66 px).

## 7. El gancho: qué le gusta de verdad a un lector aquí

El armario no compite con el lector: compite con cerrar la app. Lo que retiene a
un lector en una sección de este tipo no es «más objetos», es **ver su propia
lectura convertida en algo con forma**. Doce palancas, ordenadas por
impacto/coste.

### 7.1 Que cada prenda sea un recuerdo de lectura, no un nivel

Ya está construido y es oro: cada prenda de la Fase 3 está atada a una conducta
de lectura concreta.

| Prenda | Se gana con | Requisito real |
|--------|-------------|----------------|
| Boina de Poeta | Maratón | 30 min de una sentada |
| Audífonos de Estudio | Primera hora | 1 h leída en total |
| Bufanda de Invierno | Semana lectora | 7 días de racha |
| Moño de Académico | Curioso | 50 consultas de palabras |
| Gafas de Lectura | Cien en el cuaderno | 100 palabras guardadas |
| Esclavina de Detective | Cazarraras | 5 palabras raras guardadas |
| Sombrero de Sabio | Mente en forma | 50 repasos |
| Capa Azul de Darío | Devoralibros | 3 libros terminados |
| Corona de Laurel | Estante propio | 5 libros terminados |
| Ventana Lluviosa | Hora sin interrupciones | 60 min de una sentada |
| Biblioteca Nocturna | Lector de tardes largas | 25 h en total |

Hoy eso se muestra como `Maratón` en 9 px grises. **Propuesta**: la tarjeta
bloqueada dice la conducta y **cuánto falta**, con la barra que ya calcula
`listFamilyProgress(state)` para la Vitrina (`13 min de lectura enfocada`,
`38/50 consultas`). Es el mismo dato que ya usa el mapa de la Vitrina: cero
lógica nueva, un componente reutilizado. Coste: bajo. Efecto: la pared de
candados se convierte en una lista de cosas que hacer.

### 7.2 Un objeto, un motivo, una frase

«Capa Azul de Darío» tiene historia (Rubén Darío, modernismo); «Esclavina de
Detective» también (buscar palabras raras es investigar). Cada prenda merece una
**ficha de dos líneas con voz literaria** — qué es, por qué se gana, y una cita o
un guiño del libro que la inspiró. Un lector de Lecta lee tarjetas con texto
bueno; ese es el hook más barato que existe y no toca el bundle (pesa bytes, no
kB de JS).

### 7.3 Anticipación visible (gradiente de meta)

La pestaña *Recompensas* ya tiene «Próximo botín · Faltan N puntos». El armario
no. Cada ranura bloqueada debería mostrar **la siguiente más cercana** y su
progreso; y el encabezado del armario, una sola frase: «A 13 min de las Gafas de
Lectura». La distancia corta motiva; el nivel abstracto no.

### 7.4 Looks, no ranuras

Elegir 5 piezas es trabajo. Un lector quiere **un look**: «Noche de lluvia»
(ventana lluviosa + bufanda + gato gris), «Detective de biblioteca», «Poeta de
provincia». Tres looks guardados con nombre, cambio con un toque, y el gato
adopta la **pose** del look. Es autoexpresión pura y reduce el armario a tres
decisiones afectivas en vez de 33 controles.

### 7.5 El gato opina

Micro-diálogo en su voz al equipar («Un poco grande, ¿no?»), al quitarse algo, al
llevar el mismo look 3 días. Barato, encantador, y convierte el armario en una
conversación. Regla del proyecto: sin emojis pictóricos en la interfaz; la voz va
en texto.

### 7.6 Huecos de álbum (cierre de colección)

Las 33 miniaturas bloqueadas son **idénticas**: un gato gris con candado. Una
silueta (`?` o forma de la prenda) y el contador `Cabeza 1/6` en el chip activan
el impulso de completar sin decir una palabra. Es el mecanismo del álbum de
estampas, aplicado a la ropa.

### 7.7 Sorpresa con ceremonia (cofres)

El cofre ya existe y ya revela. Falta el **beat**: sonido, chispa, «nuevo» en la
tarjeta, y que el gato se lo pruebe solo. Y una regla anti-frustración: si sale
algo repetido, se convierte en estampa o en progreso de la familia — nunca en
nada.

### 7.8 Estacionalidad ligera

Una prenda de temporada («Paraguas de abril») atada a una conducta simple durante
una semana. Usa la maquinaria de logros que ya existe; crea cita y novedad sin
castigar a quien no entra.

### 7.9 El look atado al libro

El armario puede leer el contexto del lector: está con *Marianela* → el gato
propone la boina de poeta. «Vestir al gato para este libro» convierte una sesión
de lectura en un ritual pequeño, y el look se vuelve **diario emocional de lo que
leyó**. Alto valor, coste medio (el `readerContext` ya está en el proveedor).

### 7.10 Exhibición serena

Un «retrato» del gato con su look y su cifra («25 h · 312 palabras») listo para
compartir o para la Vitrina. Reconocimiento sin ruido social: nadie ve rankings,
solo un retrato bonito de su esfuerzo.

### 7.11 Que la primera sesión termine con algo nuevo

Hoy: 33 prendas, 1 disponible, primera prenda real a los 90 min. La curva actual
premia la perseverancia y castiga la primera visita. Propuesta de arranque:
chaleco + un accesorio de bienvenida (sombrero o pañuelo) y **un desbloqueo
garantizado a los 10 minutos** de la primera lectura. Ese primer «se lo puso» es
la diferencia entre volver y no volver.

### 7.12 Reversibilidad total

«Quitar todo», deshacer, y «sorpréndeme» (look aleatorio de lo que ya tiene). El
juego de vestir es divertido cuando equivocarse es gratis.

## 8. Plan por fases

| Fase | Contenido | Puerta |
|------|-----------|--------|
| **0 (hecho)** | Swatch con inventario, globo que cabe, natural sin candado, pruebas | `pnpm gate` |
| **1 · Gancho mínimo** | Requisito + progreso en la tarjeta bloqueada (§7.1); contadores por ranura (§6.4); fuera las 5 tarjetas muertas y los 7 pelajes legados duplicados (§4.4-4.5); «quitar todo» (§7.12) | gate + captura móvil/escritorio |
| **2 · Espejo** | Gato grande y prenda de una en una (§6); reacción del gato al equipar (§7.5); siluetas de álbum (§7.6); ficha de dos líneas por prenda (§7.2) | gate + 3 viewports |
| **3 · Vínculo** | Looks con nombre (§7.4); «próximo desbloqueo» en la cabecera (§7.3); ceremonia del cofre (§7.7); bienvenida y primer desbloqueo a 10 min (§7.11) | gate + medición |
| **4 · Contexto** | Look sugerido por libro (§7.9); retrato compartible (§7.10); prenda de temporada (§7.8) | gate + revisión de copy |

Orden deliberado: primero **que lo que hay se entienda** (fase 1), después **que
se vea** (fase 2) y solo entonces **más cosas** (3 y 4). Añadir prendas antes de
arreglar la vitrina multiplica el problema: ya hay 33 y una se ve.

## 9. Qué medir (para no diseñar a ciegas)

Con el `focus-telemetry` y los `client_error` ya existentes, sin base nueva:

1. **Aperturas del armario por sesión de lectura** y tiempo dentro.
2. **Swatches/tarjetas pulsadas por visita** (hoy: cuántas pruebas sin compra).
3. **Equipados por usuario y semana** (¿se cambia de ropa o se toca una vez?).
4. **Primer equipado**: minutos desde la primera lectura hasta el primer «Puesto».
5. **Tasa de prueba → equipado** cuando la prenda se desbloquea (¿vuelve a por
   ella?).
6. **Abandono del panel** (cierre sin equipar) por franja de nivel.

Criterio de éxito de la fase 1: subir (4) por debajo de 30 minutos y bajar (6).

## 10. Lo que no hay que hacer

- **No bloquear la lectura con el armario**: sigue siendo una hoja; nada de
  modales previos (regla Zero-Friction nº 2).
- **No convertir el candado en ansiedad**: sin cuentas atrás agresivas ni
  «pierdes tu look». La racha ya tiene su marcapáginas protector; el armario no
  debe castigar ausencias.
- **No meter jerga**: nada de «slot», «rareza», «tier»; el vocabulario ya es
  bueno (Pelaje, Escenario, Vitrina, Estampa).
- **No emojis pictóricos** en la interfaz (regla del proyecto) y **respetar
  `data-cat-motion`**: si el movimiento está reducido, la reacción del gato es un
  cambio de pose sin animación.
- **No engordar el arranque**: todo esto vive en `CompanionPanel` (30 kB
  diferido). El presupuesto está en 178,47 kB de 215; el armario no debe pagarse
  al abrir la app.

---

# 11. Estado tras la implementación (2026-10-25)

Las fases 1, 2 y 3 se implementaron y verificaron en navegador real. Lo que
queda abierto está al final, con su motivo.

## 11.1 Qué cambió, hallazgo por hallazgo

| # | Hallazgo (§4) | Estado | Cómo quedó |
|---|---------------|--------|------------|
| 1 | Swatch escribe sin inventario | **Corregido** | El pelaje vive ahora en la vista «Pelaje» como tarjetas; el bloqueado prueba y no escribe; el natural no pide nivel. |
| 2 | Globo truncado | **Corregido** | `inset-inline: 0` + `width: max-content`; texto corto con el requisito completo en el `aria-label`. |
| 3 | Natural con candado de nivel 8 | **Corregido** | «Tinta y Crema» se marca `Natural` y su ficha no pide nivel; «Natural» queda como acción de quitar. |
| 4 | 5 tarjetas imposibles de desbloquear | **Corregido (en UI)** | `HIDDEN_ARTICLES` las excluye de la rejilla; el catálogo y la validación de registros **no** se tocan (un `equipped.coat` guardado con id de paleta sigue siendo válido). |
| 5 | 12 tarjetas para 5 pelajes | **Corregido** | La rejilla de pelaje tiene «Natural» + las 5 paletas con nombre de paleta; los 7 `pelaje-*` ya no se listan como prendas. |
| 6 | Carril de 4 092 px | **Corregido** | `.companion-tray` es una rejilla `auto-fill minmax(5.5rem, 1fr)`: 3 columnas en móvil, 7 en escritorio; scroll vertical, que es el natural. |
| 7 | Solo 1 de 33 prendas al empezar | **Corregido** | «Lo tuyo primero» en la rejilla; cada candado dice su distancia; el look «Uniforme de biblioteca» se puede poner desde el minuto cero y el **primer pelaje (Naranja Miel) es de serie** (`COAT_LEVELS["pelaje-atigrado"] = 0`): un lector nuevo ya puede vestir y repintar al gato. |
| 8 | Primera prenda real a los 90 min | **Mitigado** | Sin tocar la escalera de niveles: el pelaje de serie y el look inicial dan juego desde el minuto cero, y cada requisito se traduce a **tiempo de lectura** («faltan 320 pts · unas 5 h 20 min de lectura»). La cadencia de prendas sigue igual (§11.3). |
| 9 | El candado no decía el requisito | **Corregido** | `closetRequirement`: «Nivel 5 · faltan 320 pts» con barra, o «Guarda 100 palabras · 38 de 100 palabras». El logro con 0 de avance muestra sólo su descripción. |
| 10 | Panel de 252 px; 66 px en horizontal | **Mitigado** | El panel sube a 302 px en 900×500 (puntos de corte de pantalla baja a 34 rem); el gato crece en el armario (128 → 160 px) y se retira el suelo de estado. |
| 11 | Dos `aria-modal` apilados desde *Tu recorrido* | **Corregido** | `Journey.tsx` cierra su hoja antes de abrir el vestidor; verificado: 1 diálogo (antes 2), la estantería queda debajo y «atrás» cierra el armario. |
| 12 | Sin «quitar todo» ni looks | **Corregido** | «Quitar prendas» (una escritura por ranura), «Sorpréndeme» (look al azar entre lo tuyo) y 4 looks con nombre. |
| 13 | Las prendas bloqueadas se anunciaban como *deshabilitadas* aunque al pulsarlas se prueben | Medido con `aria-disabled="true"` en 33 tarjetas | Sin `aria-disabled`: `data-locked` para el tono + nombre accesible («Moño: bloqueada, Nivel 5 · faltan 320 pts. Pulsa para probarla»). El requisito ya no se apaga con la tarjeta. |

## 11.2 Cómo quedó la sección

```
[ gato 160 px: espejo en vivo de lo que tocas ]
[ MÁS CERCA · Corbatín · Nivel 2 · faltan 30 pts  ▓▓░░ ]
[ Todo 1/26 ][ Cabeza 0/6 ]…[ Pelaje 0/5 ][ Looks 0/4 ]
[ ficha de la prenda tocada: nombre · una línea de historia ·
  requisito con barra · Poner / Probar ]
[ rejilla: lo tuyo primero, cada candado con su distancia ]
[ Quitar prendas ]
```

- **Una dimensión por vista**: prendas por ranura, pelaje (paletas) y looks
  (conjuntos). Antes se apilaban tres bloques y la rejilla caía fuera de la
  primera pantalla en un panel de 226 px.
- **La ficha** usa `ARTICLE_STORIES` (una línea por prenda) y no muestra
  requisito cuando lo que describes ya lo lleva puesto el gato.
- **El gato opina** al vestirse (`closetComment`): «¿Salgo así a leer?»,
  «Un poco apretado, pero elegante.».
- **La prueba se limpia** al cambiar de vista: el globo ya no persiste cuando
  el gato vuelve a lo suyo.

## 11.3 Las cuatro decisiones (2026-10-26)

Las elegiste todas por la opción recomendada; están implementadas y verificadas.

### (a) Cadencia: el primer premio llega a los 10 minutos

Logro nuevo **«Primer cuarto de hora»** (`primer_cuarto`, familia `sesion`,
meta 10 min de una sentada) que regala el **Corbatín**. Aditivo: no toca
`LEVELS` ni `LEVEL_REWARDS`, así que la escalera de niveles y el mapa de *Tu
recorrido* quedan igual. **Sin XP a propósito** (xp: 0): el premio es la prenda,
no acelerar la economía — con XP habría empujado el nivel 2 al minuto 10 y el
corbatín se habría duplicado.

El armario resuelve ahora el requisito **por logro primero**: cuando una prenda
tiene dos caminos, anuncia el más corto y el más concreto («Lee 10 minutos de
una sentada» en vez de «Nivel 2 · faltan 30 pts»).

### (b) Prenda de temporada: ventana de calendario, sin arte nuevo

`SEASONAL_WINDOWS` reparte el año en cuatro ventanas sobre prendas que ya
existen: bufanda (dic–feb), ventana lluviosa (mar–may), gafas (jun–ago) y capa
azul (sep–nov). La ventana activa se anuncia en una línea con su motivo, su
tarjeta va **la primera** de la rejilla y se etiqueta. Cambiar de temporada es
editar una tabla, no dibujar un SVG.

### (c) Retrato de lectura: PNG 1080×1350, descargable y compartible

`lib/companion-portrait.ts`: el gato se serializa con **el estilo computado
copiado a atributos** (sus colores viven en clases CSS, así que un clon directo
saldría en negro), se rasteriza en canvas y el texto se dibuja con `fillText`.
Sobre el papel y la tinta del tema activo. `navigator.share` con archivo cuando
el navegador lo admite; si no, descarga. Todo en memoria: **no se sube nada**.

La tarjeta se ve en la Vitrina con las cifras (horas, palabras, libros, racha) y
se omite lo que está a cero. Verificado en Chrome: PNG de 69 KB, 1080×1350,
`lecta-gato-2026-10-26.png`.

### (d) Ambiente por libro: el lector dice «para este libro, así»

Cuatro ambientes (poesía, aventura, misterio, clásico) que apuntan a los looks
que ya existen. La elección se recuerda **por hash de libro** en las preferencias
del dispositivo (`CompanionDevicePrefs.bookMoods`), no en el sync: es un dato de
lectura, pero meterlo en el contrato obligaría a un registro nuevo y a un
despliegue coordinado del worker. Al elegir, el gato se viste con lo que tengas
de ese look; repetir el ambiente lo quita sin desvestir.

La fila sólo aparece con un libro abierto (`readerContext.bookId`), que es
cuando la pregunta tiene sentido.

## 11.4 Lo que queda abierto y por qué

1. **Cadencia de prendas (§7.11).** El primer pelaje ya es gratis y el primer
   look se puede poner al instante, pero la primera **prenda** (corbatín) sigue
   pidiendo 30 puntos. Adelantarla a los 10 minutos exige mover
   `LEVEL_REWARDS` o añadir un logro con premio: cambia la escalera compartida
   con el mapa de *Tu recorrido* y el recuento de rangos de la Vitrina. No se
   hace sin medir antes la economía de XP.
3. **Look atado al libro (§7.9)** y **retrato compartible (§7.10)**: ideas de la
   fase 4, no implementadas.
4. **Prenda de temporada (§7.8)**: necesita calendario y criterio de caducidad.

## 11.5 Segunda pasada (2026-10-26)

- **«Sorpréndeme»** (§7.12): `surpriseLook(owned, equipped, random)` elige un
  look al azar **sólo entre prendas tuyas**, siempre cambia al menos una ranura
  y acepta quitarse algo. `random` se inyecta para poder probarlo.
  Con el gato recién vestido y sin inventario devuelve `null` (no hay sorpresa).
- **Accesibilidad de las bloqueadas** (hallazgo 13): una prenda bloqueada se
  puede probar, así que no es un control deshabilitado. Se retira
  `aria-disabled`, se conserva `data-locked` para el tono (miniatura al 72 %,
  texto intacto) y el candado se explica en el nombre accesible. Antes un
  lector de pantalla anunciaba 33 tarjetas «no disponibles» y la única forma de
  ver la prenda puesta —probarla— quedaba fuera de su alcance.
- Pruebas: 2 608 en verde (4 nuevas: tres de «Sorpréndeme» y el candado
  accesible en la hoja).

## 11.6 Verificación

- `pnpm gate`: typecheck + lint (0 warnings) + **2 624 pruebas** + build +
  presupuesto de arranque. El arranque casi no paga nada: 178,64 kB gzip de 215
  (el armario vive en el chunk diferido `CompanionPanel`, que pasó de 30,3 a
  39,2 kB).
- Nuevas pruebas: `src/client/lib/companion-portrait.test.ts` (10: cifras,
  reparto del lienzo, nombre del archivo y texto al compartir) y
  `src/client/lib/companion-closet.test.ts` (33) cubren
  inventario por ranura, requisitos con número, la prenda «más cerca», looks,
  «lo tuyo primero» y la voz del gato; `CompanionPanel.test.ts` (27) cubre la
  hoja completa, ahora con el pelaje como vista y no como selector suelto.
- Chrome real a 420×880, 390×844, 1440×900 y 900×500: rejilla de 3 / 3 / 7 / 4
  columnas, panel de 226 / 226 / 226 / 302 px, siete fichas visibles sin carril
  horizontal, y el flujo probar → poner → quitar prendas sin escrituras
  accidentales (verificado leyendo `equipped.*` en IndexedDB).
