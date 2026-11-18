# Dock: «Cap. X de Y» con capítulos reales y minutos del capítulo

Plan: Opus (arquitecto). Implementación: Sonnet. 2026-11-18.

## Problema
En modo scroll el dock muestra `Cap. {sectionIndex+1} de {sectionTotal}` con `sectionTotal = book.sections.length` (`Reader.tsx:2086`): secciones EPUB, no capítulos (ej. «Cap. 23 de 40» en un libro de 20). El «~X min» es solo de la sección (`progress.ts:31-35`).

## Objetivo
«Cap. 7 de 20 · ~12 min» con capítulos reales (`catalog`/`currentChapterTarget`) y minutos hasta el fin del capítulo. Sin catálogo o en preliminares: texto actual. `bookProgress` no se toca. `formatCompactProgress` (`SmartReaderDock.tsx:20-30`) ya parsea «Cap. N de M · ~Xm».

## Corrección a la propuesta original
`sectionSizes` está en **bytes** (`section.size`, `Reader.tsx:2104`; foliate `getSize`), no en palabras. Palabras reales solo de la sección abierta (`sectionWords`, `useReaderSectionLoader.ts:283`). Para las demás secciones del capítulo se convierte bytes→palabras con la razón medida en la sección actual.

## Decisiones de Luis (el plan asume el valor por defecto)
1. Preliminares: texto actual por secciones (alternativa: nombre, «Prólogo · ~3 min»).
2. Modo paginado: sin cambios (alternativa: minutos de capítulo también).
3. Bytes→palabras: se acepta la aproximación (±20 %) (alternativa: solo minutos de sección hasta tener palabras reales).

## Paso 1 — `src/client/lib/progress.ts` (tras `minutesLeft`, l.35)
`chapterMinutesLeft(sizes, sectionIndex, range | null, sectionWords, ratio, wpm): number`
- Sin rango → `minutesLeft(sectionWords, ratio, wpm)`.
- Restantes sección actual: `sectionWords * (1 - clamp(ratio))`.
- Palabras/byte: `sectionWords / sizes[sectionIndex]` solo si `sectionWords >= MIN_SAMPLE_WORDS` (l.7) y `sizes[sectionIndex] > 0`; si no, solo cuenta la sección actual.
- Suma `sizes[i] * palabrasPorByte` para `i` en `sectionIndex+1 .. range.endSection-1`.
- `Math.ceil(total / max(wpm,1))`. Última sección del rango = `minutesLeft`.
- Capítulos que comparten archivo comparten `[start,end)` (`chapters.ts:395-401`): sobreestima un poco; documentar en comentario.

Pruebas (`progress.test.ts`): rango nulo = `minutesLeft`; capítulo de 3 secciones con calibración (valor a mano); `sectionWords < 40` solo sección actual; última sección = `minutesLeft`; `ratio = 1` en la última → 0.

## Paso 2 — `src/client/lib/chapters.ts` (tras `chapterIdFor`, l.446)
`chapterOrdinal(catalog | null, target | null): { n, total, range } | null`
- Cuentan los `catalog.targets` tipo `chapter` o `uncertain` (criterio de `atChapterEnd`, `Reader.tsx:3311-3314`).
- `n` = posición en esa lista + 1; `total` = longitud.
- Rango: `catalog.ranges.find(r => r.target.id === target.id)` (no usar `endRange`, l.3305: falla con varios capítulos por archivo).
- `null` si no hay catálogo/capítulo actual, es preliminar u «other», o `total === 0`.

Pruebas (`chapters.test.ts`): 2 preliminares + 3 capítulos en 5 secciones → «2 de 3» en el segundo; preliminar → `null`; sin catálogo → `null`; 2 capítulos en una sección → cada uno su `n`.

## Paso 3 — texto del dock (función pura)
`dockProgressText({ layout, page, pageCount, sectionIndex, sectionTotal, minutes, ordinal })` en `progress.ts` o `lib/dock-progress.ts`.
- `pages`: «Pág.» actual sin cambios.
- scroll + ordinal: `Cap. ${n} de ${total}` + ` · ~${minutes} min` si `minutes > 0`.
- scroll sin ordinal: texto actual.

Prueba: cada caso + pasar el resultado por `formatCompactProgress` y verificar N, M y minutos.

## Paso 4 — `Reader.tsx`
1. Cerca de l.1007: `const chapterOrd = useMemo(() => chapterOrdinal(catalog, currentChapterTarget), [catalog, currentChapterTarget]);`
2. L.3113: `minutes` = `minutesLeft(...)` en páginas; en scroll `chapterMinutesLeft(sectionSizes, sectionIndex, chapterOrd?.range ?? null, sectionWords, viewRatio, wpm)` (sin `useMemo`: bucle corto).
3. L.3679: pasar `chapterOrdinal={chapterOrd}`.
4. `bookProgress` (l.3112) intacto.

## Paso 5 — `ReaderDockHost.tsx`
- Prop `chapterOrdinal: { n: number; total: number } | null` (junto a `sectionTotal`/`minutes`, l.29-30; desestructuración l.89).
- Sustituir l.141-145 por `progressText={dockProgressText({...})}`.

## Riesgos
- Rendimiento: `chapterOrd` memoizado; minutos se recalculan por scroll como hoy.
- Precisión: ±20 % en capítulos con mucho marcado/imágenes hasta abrir cada archivo.
- Cambio de capítulo: un cuadro con `sectionWords` de la sección anterior; aceptable (el dock solo monta con `state === "ready"`).
- Bundle: cientos de bytes sobre ~5.7 kB de margen.

## Verificación
1. Por paso: `pnpm vitest run src/client/lib/progress.test.ts src/client/lib/chapters.test.ts src/client/components/SmartReaderDock.test.ts`.
2. Final: `pnpm gate`. Si fallan `Account`/`Welcome`/`AuthForms`, confirmar con `git stash` que vienen de cambios ajenos sin commit.
3. Manual: libro de 20 capítulos en 40 secciones, modo scroll → «Cap. N de 20» y minutos bajan al scrollear.
