---
name: Lecta
description: Lector de EPUB con cuaderno de vocabulario; sistema visual «Cuaderno de lector».
colors:
  vermilion: "#9e3a23"
  vermilion-bright: "#a24317"
  vermilion-wash: "#f3ddd5"
  ochre: "#d4a43a"
  sage: "#43694d"
  amber: "#8a6a1e"
  accent-focus: "#3b6e8c"
  success: "#3d7a5a"
  paper: "#faf6f0"
  paper-raised: "#ffffff"
  paper-sunken: "#f0e7d5"
  ink: "#1f1d1a"
  ink-soft: "#5c554d"
  ink-faint: "#8a7f72"
  rule: "rgba(120, 95, 70, 0.12)"
  rule-strong: "#c9beaa"
  on-accent: "#ffffff"
  cat-fur: "#e8833a"
typography:
  display:
    fontFamily: "Literata Variable, Literata, Georgia, Times New Roman, serif"
    fontSize: "2.441rem"
    fontWeight: 500
    lineHeight: 1.1
  headline:
    fontFamily: "Literata Variable, Literata, Georgia, Times New Roman, serif"
    fontSize: "1.5625rem"
    fontWeight: 500
    lineHeight: 1.1
  title:
    fontFamily: "Literata Variable, Literata, Georgia, Times New Roman, serif"
    fontSize: "1.25rem"
    fontWeight: 500
    lineHeight: 1.1
  body:
    fontFamily: "Alegreya Sans, Gill Sans, Segoe UI, Trebuchet MS, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  read:
    fontFamily: "Literata Variable, Literata, Georgia, Times New Roman, serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "Alegreya Sans, Gill Sans, Segoe UI, Trebuchet MS, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  r-1: "2px"
  r-2: "4px"
  radius-s: "8px"
  r-sheet: "14px"
  r-pill: "999px"
spacing:
  s-1: "0.25rem"
  s-2: "0.5rem"
  s-3: "0.75rem"
  s-4: "1rem"
  s-5: "1.5rem"
  s-6: "2rem"
  s-7: "3rem"
  s-8: "4rem"
  s-9: "6rem"
components:
  button:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.r-1}"
    padding: "0.5rem 1rem"
    height: "44px"
  button-primary:
    backgroundColor: "{colors.vermilion}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.r-1}"
    padding: "0.5rem 1rem"
    height: "44px"
  button-quiet:
    textColor: "{colors.vermilion}"
    padding: "0.5rem 0.75rem"
    height: "44px"
  field:
    backgroundColor: "{colors.paper-sunken}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-1}"
    padding: "0.5rem 0.75rem"
    height: "44px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    rounded: "{rounded.r-pill}"
    padding: "0.25rem 0.65rem"
  chip-active:
    textColor: "{colors.vermilion}"
    rounded: "{rounded.r-pill}"
  card:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-2}"
    padding: "1rem"
  sheet:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.r-sheet}"
    padding: "0.5rem 1.5rem 1.5rem"
  nav-item:
    textColor: "{colors.ink-soft}"
    typography: "{typography.label}"
    height: "48px"
  nav-item-active:
    textColor: "{colors.vermilion}"
---

# Design System: Lecta

## Overview

**Creative North Star: "Cuaderno de lector"**

Lecta se ve como el cuaderno de alguien que lee mucho: papel con grano, tinta
casi negra, márgenes limpios y una sola tinta de color para lo que importa. El
libro es el protagonista; todo lo demás (ficha de palabra, Cuaderno, recorrido)
se comporta como anotaciones alrededor de la página, nunca como una aplicación
que compite con ella.

La forma es de imprenta: esquinas casi rectas, filetes finos, serif de libro en
los títulos y sans humanista en los controles. La profundidad es papel en
capas (hundido, base, elevado), no objetos flotando. El sistema vive en cuatro
temas con los mismos nombres de token: `papel` (sepia, predeterminado claro),
`blanco`, `noche` (pizarra) y `oled`. Los valores del frontmatter son los de
`papel`; los otros temas cambian el valor, nunca el papel que cumple cada
token. La fuente de verdad es `src/client/styles/tokens.css`.

El gato compañero es la única figura ilustrada y el único lugar donde aparece
el naranja de su pelaje.

**Key Characteristics:**
- Papel con grano sutil y tinta cálida; nunca blanco y negro puros en `papel`.
- Un solo acento, bermellón, reservado a la acción principal y al estado actual.
- Serif de libro para títulos y lectura; sans humanista para la interfaz.
- Esquinas de 2–4 px en controles y tarjetas; píldora solo en fichas.
- Profundidad por tono de papel y filete; sombra mínima y ambiental.
- Objetivos táctiles de 44 px; móvil vertical como diseño de referencia.

## Colors

Paleta de papel y tinta con un bermellón de corrector y unos pocos tonos de
marcador.

### Primary
- **Bermellón de corrector** (`vermilion`): botón principal, enlaces, anillo
  de foco, pestaña activa de la navegación, texto de ficha seleccionada. En
  `noche` se aclara a un terracota para mantener contraste.
- **Bermellón vivo** (`vermilion-bright`): pista del interruptor encendido.
- **Lavado bermellón** (`vermilion-wash`): halo de foco en campos, pasajes
  guardados, contenedores accionables de segundo nivel (cofres).

### Secondary
- **Ocre de resaltador** (`ochre`): selección de texto y resaltes, siempre
  como lavado translúcido, nunca como relleno sólido de un control.

### Tertiary
- **Salvia** (`sage`) y **verde de acierto** (`success`): validez y respuestas
  correctas.
- **Ámbar** (`amber`): avisos.
- **Azul de foco** (`accent-focus`): guías de lectura y ayudas de
  concentración dentro del lector; no se usa en controles.
- **Naranja del gato** (`cat-fur`): exclusivo del compañero.

### Neutral
- **Papel** (`paper`): fondo de página, con el grano `--grain` encima.
- **Papel elevado** (`paper-raised`): tarjetas, hojas, botones, navegación.
- **Papel hundido** (`paper-sunken`): campos y zonas rebajadas.
- **Tinta** (`ink`): texto principal.
- **Tinta suave** (`ink-soft`): texto secundario y explicaciones.
- **Tinta tenue** (`ink-faint`): solo decorativo; no lleva información.
- **Filete** (`rule`) y **filete fuerte** (`rule-strong`): divisores y bordes
  de control.

### Named Rules
**La regla de la tinta única.** El bermellón sólido pertenece a una sola
acción por pantalla: la principal. Todo lo demás que esté «activo» (fichas,
filtros, modos, pestañas) usa el tono translúcido `--chip-active-*` (14 % de
fondo, 45 % de borde).

**La regla del tema vivo.** Ningún componente escribe un color fijo. Siempre
`var(--ink)`, `var(--paper-raised)`, `var(--vermilion)`; un hex suelto rompe
`papel` o `noche`. Cada cambio de estilo se revisa en ambos.

## Typography

**Display Font:** Literata Variable (con Georgia, Times New Roman)
**Body Font:** Alegreya Sans (con Gill Sans, Segoe UI)
**Label/Mono Font:** Alegreya Sans; no hay monoespaciada.

**Character:** Una serif de libro con tamaño óptico para todo lo que se lee o
titula, y una sans humanista de trazo caligráfico para lo que se toca. Las dos
tienen calidez de imprenta; ninguna es geométrica.

### Hierarchy
- **Display** (500, `--fs-3xl`, 1.1): título de vista y momentos de cierre.
- **Headline** (500, `--fs-xl`, 1.1): títulos de sección, hojas y diálogos.
- **Title** (500, `--fs-lg`, 1.1): títulos de tarjeta y de libro. Todos los
  títulos usan `text-wrap: balance`.
- **Body** (400, `--fs-base`, 1.45): texto de interfaz en Alegreya Sans.
- **Read** (400, `--read-size` 1.125rem, 1.65, medida 65ch): el texto del
  libro; la persona lo ajusta desde el panel Aa (también Source Serif 4,
  Atkinson Hyperlegible Next y OpenDyslexic, que se descargan al elegirlas).
- **Label** (500, `--fs-xs`, 0.08em, mayúsculas): antetítulos (`.eyebrow`) y
  etiquetas de navegación (estas sin mayúsculas).

La escala es modular de razón 1.25 (`--fs-xs` a `--fs-3xl`).

### Named Rules
**La regla de los 16 px.** Ningún control de formulario baja de `--fs-base`:
iOS hace zoom al enfocar campos menores.

**La regla del oficio.** Serif para lo que se lee, sans para lo que se
acciona. Un botón nunca va en Literata; un título nunca en Alegreya Sans.

## Layout

Móvil vertical es el diseño de referencia y el orden del DOM es el orden
lógico: el escritorio reacomoda, no reordena. Espaciado en la escala `--s-1`
a `--s-9` (0.25rem a 6rem).

- **Móvil:** navegación fija abajo (52 px de alto más el área segura), una
  columna, secciones largas plegadas.
- **Escritorio (≥ 64rem):** la navegación pasa a un riel lateral de 5rem; las
  vistas densas crecen a 2 columnas (Tu recorrido hasta ~72rem) y las
  secciones plegables van siempre abiertas.
- **Lector:** la posición vive en el scroll del documento; medida de 65ch; un
  solo dock inferior.
- **Hojas:** ancho máximo 48rem, alto máximo 60vh, ancladas abajo.
- **Filas de ajuste:** título y explicación en el mismo bloque a la izquierda,
  control a la derecha centrado; el divisor va debajo de la fila completa.

## Elevation & Depth

Papel en capas. La profundidad se lee por el tono de la superficie (hundido,
base, elevado) y por el filete de 1 px; las sombras son ambientales, muy
bajas, y existen solo donde algo de verdad está encima de otra cosa.

### Shadow Vocabulary
- **Reposo** (`--shadow-1`): tarjetas y el pomo del interruptor.
- **Levantado** (`--shadow-2`): elementos flotantes temporales.
- **Hoja** (`--shadow-sheet`): hoja inferior, proyectada hacia arriba; se
  acompaña de un velo `--scrim` con desenfoque de 8 px.
- **Portada** (`--shadow-cover`): portadas de libro, el único objeto con
  sombra de cosa física.

### Named Rules
**La regla del papel sólido.** Las hojas y fichas sobre el texto llevan fondo
opaco `paper-raised`: el texto del libro nunca se transparenta a través de
una superficie con contenido.

## Shapes

Forma de imprenta: rectángulos con esquinas apenas matadas. Controles y
portadas a 2 px (`--r-1`), tarjetas a 4 px (`--r-2`), selectores de ajuste a
8 px, hojas a 14 px solo en las esquinas superiores. La píldora (`--r-pill`)
es exclusiva de fichas, filtros e interruptores. Bordes de 1 px: `rule` para
contenedores, `rule-strong` para controles. Borde punteado solo en zonas de
adición o carga («+ Añadir libro»); avisos y estados pendientes usan borde
sólido con tinte. Portadas siempre 2:3.

## Components

### Buttons
Sobrios, de imprenta.
- **Shape:** esquina casi recta (2 px), alto mínimo 44 px, peso 500.
- **Default:** papel elevado, tinta, borde `rule-strong`; al pasar el cursor
  el borde sube a tinta suave.
- **Primary:** bermellón sólido con texto `on-accent`; al pasar el cursor se
  oscurece mezclando 12 % de tinta.
- **Quiet:** sin caja, texto bermellón; el subrayado aparece al pasar.
- **Pressed:** baja 1 px con `transform`, sin mover el flujo. **Disabled:**
  opacidad 0.45.
- **Focus:** contorno bermellón de 2 px con 2 px de respiro, en todo el
  sistema; nunca el anillo azul del navegador.

### Chips
- **Style:** píldora, `--fs-xs`, fondo papel, borde `rule`, texto tinta suave.
- **State:** activa = fondo, borde y texto `--chip-active-*`, peso 600, con
  `aria-pressed`. Nunca relleno bermellón sólido.

### Cards / Containers
- **Corner Style:** 4 px. **Background:** papel elevado. **Border:** `rule`
  de 1 px. **Shadow:** reposo. **Padding:** `--s-4`, separación interna
  `--s-3`.
- Contenedor accionable de segundo nivel (cofres): fondo `--action-tint-bg`
  con borde sólido `--action-tint-border`.

### Inputs / Fields
- **Style:** papel hundido, borde `rule`, 2 px de radio, alto 44 px; etiqueta
  encima en `--fs-sm` tinta suave.
- **Focus:** borde bermellón más halo de 3 px en lavado bermellón.
- **Error:** borde bermellón y fondo lavado. **Válido:** borde salvia.
- **Switch:** área táctil de 44 px con pista delgada; encendido en bermellón
  vivo; el pomo se desliza con un leve rebote.

### Navigation
Barra inferior en móvil, riel lateral de 5rem desde 64rem. Ítems de 48 px con
icono y etiqueta `--fs-xs`, tinta suave en reposo. El actual va en bermellón,
peso 600, con una pestaña de 24×3 px en el borde.

### Sheet (hoja inferior)
Sube desde abajo sobre un velo desenfocado; esquinas superiores de 14 px,
fondo opaco, tocar el velo cierra. Es el contenedor de la ficha de palabra.

### Gato compañero
Figura SVG con paleta propia (`--cat-fur`, `--cat-fur-light`, `--cat-outline`,
`--cat-nose`) que se ajusta por tema. Sus animaciones usan solo `transform` y
`opacity`, y la persona puede reducirlas aparte del resto de la app.

### Marcas de lectura
Pasajes guardados como lavado translúcido (bermellón, ámbar, salvia, azul);
palabras previstas con subrayado punteado sin fondo. El texto nunca cambia de
color por estar marcado.

## Do's and Don'ts

### Do:
- **Do** usar tokens de `tokens.css` para todo color, radio, espacio y
  duración, y revisar cada cambio en `papel` y `noche`.
- **Do** reservar el bermellón sólido para la acción principal de la pantalla.
- **Do** mantener 44 px de alto mínimo en todo lo que se toca.
- **Do** poner el CSS de un componente en una hoja que viaje con él si se usa
  en más de una vista.
- **Do** animar con `transform` y `opacity`, con las curvas y duraciones de
  `--ease-*` y `--dur-*`; todo se apaga con `prefers-reduced-motion`.
- **Do** dar a la información texto en `ink` o `ink-soft`.

### Don't:
- **Don't** escribir colores fijos en componentes compartidos.
- **Don't** marcar fichas, filtros o pestañas activas con relleno bermellón
  sólido.
- **Don't** usar borde punteado fuera de zonas de adición o carga.
- **Don't** usar `ink-faint` para texto que informa.
- **Don't** poner dos barras flotantes inferiores a la vez en el lector.
- **Don't** mostrar el mismo control o el mismo texto dos veces en una vista.
- **Don't** bajar un control de formulario de 16 px de letra.
