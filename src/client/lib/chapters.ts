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

export type ChapterKind = "chapter" | "preliminary" | "other" | "uncertain";

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

const normPath = (path: string) => path.replace(/^\/+/, "");

const splitHref = (href: string) => {
  const hash = href.indexOf("#");
  return hash < 0
    ? { path: href, fragment: undefined as string | undefined }
    : { path: href.slice(0, hash), fragment: href.slice(hash + 1) || undefined };
};

const targetId = (path: string, fragment?: string) =>
  fragment ? `${normPath(path)}#${fragment}` : normPath(path);

const sectionIndexOf = (book: EpubBook, path: string) => {
  const wanted = normPath(path);
  return book.sections.findIndex(
    (section) => normPath(section.id) === wanted,
  );
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
  // cuerpo del libro. Sin landmarks no hay certeza → todo uncertain.
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
  const toc = book.toc?.length
    ? flattenToc(book.toc)
    : // Sin índice: una entrada por sección lineal, todas uncertain —
      // la interfaz pide el inicio explícitamente.
      book.sections
        .map((section, index) => ({
          item: { label: `Sección ${index + 1}`, href: section.id },
          depth: 0,
          synthetic: section.linear === "no",
        }))
        .filter((entry) => !entry.synthetic);

  for (const { item, depth } of toc) {
    if (!item.href) continue;
    const { path, fragment } = splitHref(item.href);
    const sectionIndex = sectionIndexOf(book, path);
    // Destinos rotos/externos se descartan: catálogo explícito, nunca
    // contenido mezclado.
    if (sectionIndex < 0) continue;
    const id = targetId(path, fragment);
    // Mismo destino por padre e hijo no se duplica; gana el primero.
    if (seen.has(id)) continue;
    seen.add(id);

    const semantic = landmarkKindAt(path);
    const beforeBody = bodyIndex >= 0 && sectionIndex < bodyIndex;
    const noLinear = book.sections[sectionIndex]?.linear === "no";
    let kind: ChapterKind;
    if (semantic === "preliminary" || beforeBody) kind = "preliminary";
    else if (semantic === "other" || (noLinear && !beforeBody))
      kind = "other";
    else if (semantic === "chapter" || (bodyIndex >= 0 && !noLinear))
      kind = "chapter";
    else kind = "uncertain";

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

// Posición física → capítulo lógico: el destino cuyo tramo
// `[startSection, endSection)` contiene la sección.
export const targetAt = (
  ranges: ChapterRange[],
  sectionIndex: number,
): ChapterTarget | null =>
  ranges.find(
    (range) =>
      range.startSection <= sectionIndex && sectionIndex < range.endSection,
  )?.target ?? null;

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
