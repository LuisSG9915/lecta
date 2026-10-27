// Catálogo de destinos del EPUB (contrato T10): una unidad lógica de
// lectura (`ChapterTarget`) con identidad ruta canónica + fragmento,
// y su tramo físico `[startSection, endSection)` (`ChapterRange`).
// Perezoso: solo lee toc/landmarks/sections ya cargados por foliate —
// no abre documentos del libro.
//
// Clasificación por precedencia: landmarks (`epub:type` EPUB3 o
// `<guide>` EPUB2) → índice → heurística mínima. En duda, `uncertain`:
// la interfaz pide confirmar el inicio; nunca se inventa «Capítulo 1».

import type { EpubBook, EpubTocItem } from "./epub";

export type ChapterKind = "chapter" | "preliminary" | "frontmatter" | "other" | "uncertain";

export const isPreliminary = (kind: ChapterKind) =>
  kind === "preliminary" || kind === "frontmatter";

export type ChapterTarget = {
  // Identidad: ruta canónica + fragmento, p. ej. «OEBPS/cap1.xhtml#s2».
  // Sin fragmento es solo la ruta. encodeURIComponent va en la clave
  // de session, no aquí.
  id: string;
  // Etiqueta del índice saneada; respaldo «Sección N+1».
  label: string;
  // path#fragment tal como resolvió el libro.
  href: string;
  // Sección física donde empieza el destino.
  sectionIndex: number;
  // Fragmento sin «#»; ausente → inicio de la sección.
  fragment?: string;
  // Profundidad dentro del índice (0 = raíz); metadato de
  // presentación para selectores fieles al índice.
  depth: number;
  kind: ChapterKind;
};

// Un destino cubre el tramo físico [startSection, endSection): desde
// su propia sección hasta la del siguiente destino con sectionIndex
// mayor (exclusivo). Así un capítulo repartido en varios archivos y
// varios capítulos en un archivo funcionan igual.
export type ChapterRange = {
  target: ChapterTarget;
  startSection: number;
  endSection: number;
};

export type ChapterCatalog = {
  targets: ChapterTarget[];
  ranges: ChapterRange[];
};

// Foliate produce landmarks EPUB3 (nav, `type` desde epub:type) y
// EPUB2 (<guide>, `type` separado por espacios); ambos `string[]`.
type Landmark = { label?: string; href?: string; type?: string[] };

const PRELIMINARY = new Set([
  "cover",
  "title-page",
  "toc",
  "frontmatter",
  "copyright-page",
  "dedication",
  "loi",
  "lot",
]);

const BACKMATTER = new Set([
  "backmatter",
  "index",
  "glossary",
  "bibliography",
  "appendix",
  "colophon",
  "acknowledgments",
  "epilogue",
  "afterword",
]);

const CHAPTER_START = new Set(["bodymatter", "text"]);

const FRONT_LABELS = new Set([
  "cover",
  "portada",
  "cubierta",
  "title",
  "title page",
  "pagina de titulo",
  "half title",
  "titulo",
  "copyright",
  "creditos",
  "legal",
  "dedication",
  "dedicatoria",
  "epigraph",
  "epigrafe",
  "contents",
  "table of contents",
  "toc",
  "indice",
  "indice de contenido",
  "tabla de contenidos",
  "contenido",
  "sumario",
  "map",
  "maps",
  "mapa",
  "mapas",
  "dramatis personae",
  "personajes",
  "cast of characters",
  "acknowledgments",
  "acknowledgements",
  "agradecimientos",
  "about the author",
  "sobre el autor",
  "sobre la autora",
  "also by",
  "otros libros",
  "books by",
  "libros de",
  "frontispiece",
  "preface",
  "prefacio",
  "foreword",
  "nota del autor",
  "nota de la autora",
  "authors note",
  "author note",
  "sinopsis",
  "biografia",
  "colofon",
]);

const BACK_LABELS = new Set([
  "epilogue",
  "epilogo",
  "acknowledgments",
  "acknowledgements",
  "agradecimientos",
  "about the author",
  "sobre el autor",
  "sobre la autora",
  "books by",
  "libros de",
  "credits",
  "creditos",
  "copyright",
  "about the publisher",
  "sobre la editorial",
  "back ads",
  "glossary",
  "glosario",
  "appendix",
  "apendice",
  "colophon",
  "colofon",
  "afterword",
  "nota final",
]);

export const normalizeLabel = (label: string) =>
  label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[«»"'().,;:]/g, "")
    .trim();

/**
 * Detector positivo bilingüe (ES/EN) de etiquetas que indican un capítulo real.
 */
export function isLikelyChapterLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  const norm = normalizeLabel(trimmed);
  if (FRONT_LABELS.has(norm) || BACK_LABELS.has(norm)) return false;

  // 1. Prefijos explícitos
  if (
    /^(?:chapter|capitulo|cap\.|ch\.|part|parte|book|libro|section|seccion|act|acto)\b/i.test(
      norm,
    )
  )
    return true;

  // 2. Prólogos/preludios narrativos
  if (
    /^(?:prologue|prologo|prelude|preludio|introduction|introduccion)\b/i.test(
      norm,
    )
  )
    return true;

  // 3. Numeración arábiga al inicio o sola (ej. "1", "1. Inicio", "12")
  if (/^(?:\d{1,3})(?:[\s.:–—-]+\S.*)?$/.test(trimmed)) return true;

  // 4. Numeración romana (I a L) con título/separador (ej. "IV. El viaje", "X - Inicio")
  // Una letra romana sola (ej. "I", "II") sin landmarks queda uncertain (contrato F2).
  if (
    /^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX|XXI|XXII|XXIII|XXIV|XXV|XXVI|XXVII|XXVIII|XXIX|XXX|XXXI|XXXII|XXXIII|XXXIV|XXXV|XL|L)[\s.:–—-]+\S.*$/i.test(
      trimmed,
    )
  )
    return true;

  // 5. Números cardinales y ordinales en inglés (ej. "One", "Twenty-One", "Third")
  if (
    /^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:[-\s](?:one|two|three|four|five|six|seven|eight|nine))?|fifty|first|second|third|fourth|fifth)(?:[\s.:–—-]+\S.*)?$/i.test(
      norm,
    )
  )
    return true;

  // 6. Números cardinales y ordinales en español (ej. "Uno", "Primero", "Dieciséis")
  if (
    /^(?:uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciseis|diecisiete|dieciocho|diecinueve|veinte|primero|segundo|tercero|cuarto|quinto)(?:[\s.:–—-]+\S.*)?$/i.test(
      norm,
    )
  )
    return true;

  return false;
}

const normPath = (path: string) => path.replace(/^\/+/, "");

export const splitHref = (href: string) => {
  const hash = href.indexOf("#");
  return hash < 0
    ? { path: href, fragment: undefined as string | undefined }
    : { path: href.slice(0, hash), fragment: href.slice(hash + 1) || undefined };
};

const targetId = (path: string, fragment?: string) =>
  fragment ? `${normPath(path)}#${fragment}` : normPath(path);

export const sectionIndexOf = (book: EpubBook, path: string) => {
  const wanted = normPath(path);
  const idx = book.sections.findIndex(
    (section) => normPath(section.id) === wanted,
  );
  if (idx < 0) return idx;

  // Si el destino apunta a un fragmento inicial vacío/ornamental generado por Calibre
  // (ej. part0006_split_000.html de < 1.5 KB con solo un adorno/imagen y sin texto),
  // y la sección siguiente es la continuación (_split_001.html) del mismo archivo,
  // el inicio real del capítulo está en la sección siguiente.
  const curr = book.sections[idx];
  const next = book.sections[idx + 1];
  if (
    curr &&
    next &&
    curr.size !== undefined &&
    curr.size > 0 &&
    curr.size < 1500 &&
    normPath(curr.id).includes("_split_000") &&
    normPath(curr.id).replace(/_split_000\./i, "_split_001.") === normPath(next.id)
  ) {
    return idx + 1;
  }

  return idx;
};

const flattenToc = (items: EpubTocItem[], depth = 0, out: { item: EpubTocItem; depth: number }[] = []) => {
  for (const item of items) {
    out.push({ item, depth });
    if (item.subitems?.length) flattenToc(item.subitems, depth + 1, out);
  }
  return out;
};

export function buildChapterCatalog(book: EpubBook): ChapterCatalog {
  const landmarks = (book.landmarks ?? []) as Landmark[];

  // chapterStart: primera sección que un landmark declara inicio del
  // cuerpo del libro. Sin landmarks no hay certeza → heurística mínima.
  let chapterStart = Infinity;
  for (const landmark of landmarks) {
    if (!landmark.href || !landmark.type?.some((t) => CHAPTER_START.has(t)))
      continue;
    const index = sectionIndexOf(book, splitHref(landmark.href).path);
    if (index >= 0 && index < chapterStart) chapterStart = index;
  }
  const bodyIndex = chapterStart === Infinity ? -1 : chapterStart;

  // Tipos semánticos por destino: el landmark apunta al mismo tramo.
  const landmarkKindAt = (path: string): ChapterKind | null => {
    const wanted = normPath(path);
    for (const landmark of landmarks) {
      if (!landmark.href || !landmark.type?.length) continue;
      if (normPath(splitHref(landmark.href).path) !== wanted) continue;
      if (landmark.type.some((t) => PRELIMINARY.has(t))) return "preliminary";
      if (landmark.type.some((t) => BACKMATTER.has(t))) return "other";
      if (landmark.type.some((t) => CHAPTER_START.has(t))) return "chapter";
    }
    return null;
  };

  const targets: ChapterTarget[] = [];
  const seen = new Set<string>();
  const hasRealToc = Boolean(book.toc?.length);
  const toc = hasRealToc
    ? flattenToc(book.toc!)
    : // Sin índice: una entrada por sección lineal, todas uncertain —
      // la interfaz pide el inicio explícitamente.
      book.sections
        .map((section, index) => ({
          item: { label: `Sección ${index + 1}`, href: section.id },
          depth: 0,
          synthetic: section.linear === "no",
        }))
        .filter((entry) => !entry.synthetic);

  // Inferencia cuando el libro carece de landmarks bodymatter pero tiene índice real (ej. Calibre o EPUB2):
  // Buscamos el primer destino con un rótulo que sea positivamente un capítulo
  let inferredBodyIdx = -1;
  if (bodyIndex < 0 && hasRealToc) {
    for (let i = 0; i < toc.length; i++) {
      const { item } = toc[i];
      const norm = normalizeLabel(item.label || "");
      if (!FRONT_LABELS.has(norm) && isLikelyChapterLabel(item.label || "")) {
        inferredBodyIdx = i;
        break;
      }
    }
  }

  for (let i = 0; i < toc.length; i++) {
    const { item, depth } = toc[i];
    if (!item.href) continue;
    const { path, fragment } = splitHref(item.href);
    const sectionIndex = sectionIndexOf(book, path);
    // Destinos rotos/externos se descartan: catálogo explícito, nunca
    // contenido mezclado.
    if (sectionIndex < 0) continue;
    const realSection = book.sections[sectionIndex];
    const realPath = realSection ? realSection.id : path;
    const id = targetId(realPath, fragment);
    // Mismo destino por padre e hijo no se duplica; gana el primero.
    if (seen.has(id)) continue;
    seen.add(id);

    const norm = normalizeLabel(item.label || "");
    const semantic = landmarkKindAt(path);
    const beforeBody = bodyIndex >= 0 && sectionIndex < bodyIndex;
    const noLinear = book.sections[sectionIndex]?.linear === "no";
    let kind: ChapterKind;

    if (semantic === "preliminary" || beforeBody) {
      kind = "preliminary";
    } else if (semantic === "other" || (noLinear && !beforeBody)) {
      kind = "other";
    } else if (semantic === "chapter" || (bodyIndex >= 0 && !noLinear)) {
      kind = "chapter";
    } else if (inferredBodyIdx >= 0) {
      if (i < inferredBodyIdx) {
        kind = "frontmatter";
      } else if (BACK_LABELS.has(norm)) {
        kind = "other";
      } else if (!noLinear) {
        kind = "chapter";
      } else {
        kind = "uncertain";
      }
    } else {
      if (FRONT_LABELS.has(norm)) {
        kind = "frontmatter";
      } else if (BACK_LABELS.has(norm)) {
        kind = "other";
      } else {
        kind = "uncertain";
      }
    }

    targets.push({
      id,
      label: item.label?.trim() || `Sección ${sectionIndex + 1}`,
      href: item.href,
      sectionIndex,
      fragment,
      depth,
      kind,
    });
  }

  // Rangos: cada destino llega hasta el siguiente con sección mayor.
  const ranges: ChapterRange[] = targets.map((target, index) => {
    const next = targets
      .slice(index + 1)
      .find((other) => other.sectionIndex > target.sectionIndex);
    return {
      target,
      startSection: target.sectionIndex,
      endSection: next ? next.sectionIndex : book.sections.length,
    };
  });

  return { targets, ranges };
}

// El «donde empiezas» sugerido: el primer capítulo que no sea
// material preliminar por rótulo. Además, una entrada de los
// primeros archivos cuyo rótulo repite el título del libro es casi
// siempre la portada interna, no un capítulo («Juego de tronos»
// dentro de «Juego de tronos») — se salta igual. Sin capítulo
// limpio cae al primer capítulo declarado; sin ninguno, al primer
// destino — la interfaz siempre deja elegir otro lugar.
export function suggestedChapterTarget(
  catalog: ChapterCatalog,
  bookTitle?: string,
): ChapterTarget | null {
  const chapters = catalog.targets.filter((t) => t.kind === "chapter");
  const title = bookTitle ? normalizeLabel(bookTitle) : "";
  const isFront = (target: ChapterTarget) =>
    FRONT_LABELS.has(normalizeLabel(target.label)) ||
    (title !== "" &&
      target.sectionIndex <= 3 &&
      normalizeLabel(target.label) === title);
  return (
    chapters.find((t) => !isFront(t)) ??
    chapters[0] ??
    catalog.targets[0] ??
    null
  );
}

export interface IntraSectionContext {
  /** Fragmento activo explícito o detectado en la vista actual */
  activeFragment?: string | null;
  /** Página actual (0-based) en modo paginado */
  currentPage?: number;
  /** Mapa de fragmentId -> pageIndex dentro de la sección actual */
  fragmentPageMap?: ReadonlyMap<string, number>;
}

// Identidad estable del capítulo en el que está el lector. Sin entrada
// del índice (libro sin TOC utilizable, sección fuera de todo tramo) cae
// a la sección física: la autoevaluación y el repaso a mitad de capítulo
// siguen existiendo y comparten la misma clave.
export function chapterIdFor(target: ChapterTarget | null, sectionIndex: number): string {
  return target?.id ?? `sec-${sectionIndex}`;
}

export function targetAt(
  ranges: ChapterRange[],
  sectionIndex: number,
  context?: IntraSectionContext | string | null,
): ChapterTarget | null {
  const ctx: IntraSectionContext | null =
    typeof context === "string"
      ? { activeFragment: context }
      : (context ?? null);

  const covering = ranges.filter(
    (range) =>
      range.startSection <= sectionIndex && sectionIndex < range.endSection,
  );
  if (!covering.length) return null;

  const sameSectionTargets = covering
    .filter((r) => r.target.sectionIndex === sectionIndex)
    .map((r) => r.target);

  if (sameSectionTargets.length > 1) {
    // Prioridad 1: currentPage + fragmentPageMap (modo paginado)
    if (
      ctx?.currentPage !== undefined &&
      ctx.currentPage !== null &&
      ctx.fragmentPageMap &&
      ctx.fragmentPageMap.size > 0
    ) {
      let best: ChapterTarget | null = null;
      for (const t of sameSectionTargets) {
        if (t.fragment && ctx.fragmentPageMap.has(t.fragment)) {
          const page = ctx.fragmentPageMap.get(t.fragment)!;
          if (page <= ctx.currentPage) {
            best = t;
          }
        }
      }
      if (best) return best;
    }

    // Prioridad 2: activeFragment explícito o detectado en scroll
    if (ctx?.activeFragment) {
      const found = sameSectionTargets.find(
        (t) => t.fragment === ctx.activeFragment,
      );
      if (found) return found;
    }

    // Fallback inicial cuando no hay fragmento activo aún en esa sección
    return sameSectionTargets[0];
  }

  return covering[0].target;
}

// ¿El lector llegó al final del rango? Está en su última sección con
// la vista casi completa (0.98: en desplazamiento el tope real puede
// no llegar a 1.0) o ya la dejó atrás. No distingue cómo llegó ahí —
// quien llama decide si antes hubo lectura real del tramo.
export const reachedRangeEnd = (
  range: { startSection: number; endSection: number },
  sectionIndex: number,
  ratio: number,
): boolean =>
  sectionIndex > range.endSection - 1 ||
  (sectionIndex === range.endSection - 1 && ratio >= 0.98);

// ---------- Invitación a la prueba de vocabulario ----------

// Seguimiento del tramo candidato: dónde se observó lectura real y si
// su última sección ya se pisó — avanzar a la sección inmediata desde
// ella también cuenta como terminar (una última sección de una página
// jamás llega al 0.98 de vista).
export type CalibrationTrack = {
  range: { startSection: number; endSection: number };
  sawLast: boolean;
};

// ¿La posición está dentro del tramo y antes de su final? Es la única
// evidencia de lectura: una sección previa del rango, o la última sin
// haber llegado al tope.
const insideBeforeEnd = (
  range: { startSection: number; endSection: number },
  sectionIndex: number,
  ratio: number,
): boolean =>
  sectionIndex >= range.startSection &&
  (sectionIndex < range.endSection - 1 ||
    (sectionIndex === range.endSection - 1 && ratio < 0.98));

// Avanza el seguimiento con cada posición observada y devuelve si la
// invitación debe aparecer (una sola vez por apertura: quien llama
// traba tras el primer `offer`). El tramo candidato solo se arma con
// lectura real — aterrizar directo en el final (retomar la posición,
// un marcador o un salto del índice) no arma nada. Dispara cuando el
// tramo armado llega a su fin. Saltar más allá sin pisar la última
// sección no dispara: el candidato se recalcula donde cayó el lector.
export function trackCalibrationOffer(
  track: CalibrationTrack | null,
  sectionIndex: number,
  viewRatio: number,
  rangeFor: (
    index: number,
  ) => { startSection: number; endSection: number } | null,
): { track: CalibrationTrack | null; offer: boolean } {
  if (track) {
    const { range } = track;
    if (sectionIndex === range.endSection - 1) {
      return viewRatio >= 0.98
        ? { track, offer: true }
        : { track: { range, sawLast: true }, offer: false };
    }
    if (sectionIndex === range.endSection && track.sawLast)
      return { track, offer: true };
    if (insideBeforeEnd(range, sectionIndex, viewRatio))
      return { track, offer: false };
    // Cayó fuera del tramo sin completarlo: se reevalúa abajo.
  }
  const range = rangeFor(sectionIndex) ?? {
    startSection: sectionIndex,
    endSection: sectionIndex + 1,
  };
  const atLast = sectionIndex === range.endSection - 1;
  const armed =
    sectionIndex >= range.startSection &&
    sectionIndex < range.endSection &&
    (!atLast || viewRatio < 0.98);
  return {
    track: armed ? { range, sawLast: atLast } : track,
    offer: false,
  };
}
