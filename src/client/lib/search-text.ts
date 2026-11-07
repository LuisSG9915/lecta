// Normalización compartida para búsquedas de texto libre (título,
// autor, filtros de comunidad/catálogo). Sin dependencias de DOM ni de
// datos para que la comunidad pueda usarla sin cargar el catálogo.

export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
