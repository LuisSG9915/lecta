# Fase 4 — Inventario y mapa de reemplazo de emojis

Auditoría de diseño 2026-11-10 · consolidado de 4 reportes (beam, modelo, nemotron, base).
Estado: **INVENTARIO + PROPUESTA — pendiente puerta editorial antes del barrido.**

## Alcance real medido

- **64 símbolos distintos** en el rango emoji/pictográfico.
- **32 archivos de producto** (`src/client`, `src/shared`, sin tests) los contienen.
- ~15 archivos de test los referencian en aserciones — se actualizan junto al fuente.
- Concentración: `GamePanel` (📖🐾), `Journey` (💌🐾🎯), `CompanionPanel`,
  `SmartReaderDock`/`TtsNowPlaying` (controles de audio), juegos del cuaderno.

El sistema de diseño es «tinta y papel»: iconos SVG de trazo fino
(`Icon.tsx`, 29 nombres, `stroke="currentColor"`). Los emojis a color
rompen la coherencia y en temas oscuros compiten con la paleta.

## Clasificación propuesta

### A — Pictográficos que deben pasar a `Icon` (SVG)

| Emoji | Usos aprox. | Contexto típico | Icon propuesto |
|---|---|---|---|
| 🐾 | 15 | compañero, logros, recompensas | `paw` (nuevo) o `sparkles` si es genérico |
| 📖 | 15 | libro, lecturas, modo papel | `book` (existe) |
| 🐱 😺 😻 🤔 | ~11 | estados del gato / juegos | `cat` (nuevo) o ilustración del sprite |
| 💡 | 8 | consejos, tips, «dato» | `sparkle` (existe) o `bulb` (nuevo) |
| ✨ | 18 | celebración, nuevo, IA | `sparkles` (existe) |
| 🏆 | 4 | logros, nivel | `trophy` (nuevo) |
| 🎧 | 4 | TTS, audio | `headphones` (existe) |
| 🔖 | 3 | guardar, marcador | `bookmark` (existe) |
| 🎯 | 3 | meta, objetivo | `target` (nuevo) |
| 👥 | 3 | comunidad, social | `users` (nuevo) |
| 🌱 | 3 | racha, crecimiento | `sprout` (nuevo) |
| ⏳ ⏱ ⏸ ⏮ ⏭ ⌫ ↺ | ~11 | controles TTS/reproductor | `clock`/`pause`/`skip-back`/`skip-forward`/`delete`/`retry` (nuevos, familia media) |
| 🔍 | 2 | buscar | `search` (existe) |
| 🔒 | 1 | bloqueado | `lock` (existe) |
| 🗑 | 2 | borrar | `trash` (nuevo) o `close` |
| 🔤 | 2 | vocabulario/letras | `text`/`abjad` (nuevo) o `index` (existe) |
| 📜 | 2 | reglas, pergamino | `scroll` (nuevo) o `quote` (existe) |
| 📌 | 2 | fijado | `pin` (nuevo) o `bookmark` |
| 💧 | 2 | agua/hidratación | `droplet` (nuevo) |
| 👓 | 2 | anteojos/detalle | `glasses` (nuevo) o `focus` (existe) |
| 🎁 🎀 | 4 | regalo, premio | `gift` (nuevo) o `sparkles` |
| ⚡ | 2 | energía/rápido | `zap` (nuevo) |
| 🌊 | 2 | flujo/oleaje | `wave` (nuevo) o `retreat` |
| ✎ ✍ | 3 | escribir/anotar | `edit`/`pen` (nuevo) |
| 🔀 | 2 | mezclar/barajar | `shuffle` (nuevo) |
| 🔊 | 1 | sonido | `speaker` (existe) |
| 🛡 | 1 | escudo/protección | `shield` (nuevo) |
| 🚫 | 1 | prohibido | `ban`/`close` |
| 🧭 | 1 | guía | `compass` (nuevo) o `journey` |
| 🥣 | 1 | cuenco/comida | `bowl` (nuevo) — contexto por revisar |
| 📑 📊 | 2 | informe/gráfica | `chart`/`file` (nuevos) |
| 👕 | 1 | prenda/armario | `shirt` (nuevo) |
| 🏛 | 1 | institución | `bank`/`landmark` (nuevo) |
| ⭐ | 1 | favorito | `star` (nuevo) |
| ⌘ | 1 | atajo de teclado | texto `⌘` se conserva (es convención macOS) |

### B — Símbolos tipográficos: se conservan como texto

| Símbolo | Usos | Decisión propuesta |
|---|---|---|
| → ← ↔ ↓ ↑ ↘ ↗ ↕ | ~240 | Flechas de flujo en botones/texto («Continuar →»). Son tipografía, no pictogramas: **conservar**. |
| ✓ ✕ | ~55 | Check/cross en listas y toggles. Candidatos a `Icon` (`check`/`close` existen como `close`; `check` nuevo) **solo donde sean interactivos**; en texto corrido («✓ hecho») conservar. |
| ★ ☆ ✦ | ~23 | Valoraciones/favoritos. `star` (nuevo) donde sea control; en prosa («★★★») conservar. |
| ♥ | 2 | Corazón en gestos del gato — revisar contexto; probablemente `Icon` o conservar. |

### C — Emojis del compañero: decisión editorial

`🐾` (15), `🐱` (7), `😺`/`😻`/`🤔` (~4) aparecen en GamePanel, Journey,
CompanionPanel, práctica. El gato YA tiene arte SVG propio — estos
emojis compiten con él. Opciones:

1. **Reemplazar todos** por el sprite real del gato (más coherente, más trabajo).
2. **Reemplazar por `Icon name="paw"`/`cat`** nuevo — neutro, no compite.
3. **Conservar** donde son «la mascota habla» (diálogos, tips) por calidez.

Recomendación: opción 2 en UI funcional (botones, estados, listas) y
conservar solo donde el emoji hace de «voz del gato» en texto narrativo.

## Iconos nuevos necesarios (~15)

`paw`, `cat`, `trophy`, `target`, `users`, `sprout`, `trash`, `pin`,
`droplet`, `glasses`, `gift`, `zap`, `wave`, `edit`, `shuffle`, `shield`,
`compass`, `bowl`, `chart`, `shirt`, `star`, `check`, `pause`,
`skip-back`, `skip-forward`, `retry`, `bulb`, `scroll`, `text`.

Muchos son trazo fino estilo lucide/feather — mismo lenguaje que los 29
existentes. Se agregan a `IconName` + `renderIconPath` en un solo commit.

## Plan de ejecución propuesto (por tandas verificables)

1. **Tanda 0 — Iconos**: agregar los ~15-20 paths nuevos a `Icon.tsx` + tests de render.
2. **Tanda 1 — Controles de audio/TTS**: `SmartReaderDock`, `TtsNowPlaying`, `TtsConsentDialog` (⏮⏭⏱🔊✕) — mayor impacto, superficie acotada.
3. **Tanda 2 — Juego/cuaderno**: `GamePanel`, `Journey`, juegos (🏆🔥✨🎯🌱🎁🎧🐾📖).
4. **Tanda 3 — Resto de componentes**: Shelf, WordPanel, Vocabulary, paneles, diálogos.
5. **Tanda 4 — Tests**: actualizar aserciones que buscan el emoji literal.
6. **Puerta por tanda**: `pnpm vitest run <archivos>` + revisión visual rápida.

Cada tanda deja el árbol verde; no hay big-bang.

## Decisiones de Luis (2026-11-10)

1. **Alcance**: barrido completo (32 archivos de producto).
2. **Gato**: emoji → **icono neutro SVG** (`paw`/`cat`), no el sprite.
3. **Símbolos en prosa**: **iconificar** — →←↔✓✕★☆ pasan a Icon donde
   sean controles/etiquetas; en prosa corrida que no admite SVG inline
   se reescribe el texto o se conserva solo si es imposible (decidir
   caso por caso, sin inventar vocabulario).
4. **⌘**: se conserva (convención de teclado).
5. **Verificación**: visual por tanda + `pnpm vitest` + gate.

## Lo que NO se toca

- Emojis dentro de contenido de usuario/libros (texto de la obra).
- `♥` en `companion-pet-hearts` si es parte del gesto de caricia (verificar).
- Tests que solo *leén* el símbolo en fixtures de contenido.
