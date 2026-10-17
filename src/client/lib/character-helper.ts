import { searchBookMentions } from "./book-search";

export interface CharacterCardInfo {
  name: string;
  oneLiner: string;
}

/**
 * Escanea la página actual y busca referencias pasadas sin spoilers.
 * Corta el arreglo de capítulos en el índice actual (currentChapterIndex - 1 hacia atrás)
 * para que sea matemáticamente imposible un spoiler del futuro.
 */
export async function getCharactersOnPageWithoutSpoilers(params: {
  pageText: string;
  currentChapterIndex: number;
  bookId: string;
  sections?: any[];
  toc?: any[];
}): Promise<CharacterCardInfo[]> {
  const { pageText, currentChapterIndex, bookId } = params;

  // Extraer palabras capitalizadas candidatas a nombres propios (dos palabras o una palabra relevante)
  const twoWordMatches = pageText.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,}\s[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/gu) || [];
  const singleWordMatches = pageText.match(/\b([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\b/gu) || [];
  const stopNames = new Set([
    "Capítulo", "Capitulo", "Sección", "Seccion", "Libro", "Parte",
    "Lecta", "The", "And", "This", "That", "Cuando", "Donde", "Pero",
    "Entonces", "Mientras", "Aunque", "Luego", "Desde", "Hasta",
  ]);
  const filteredSingle = singleWordMatches.filter((w) => !stopNames.has(w));
  const matches = [...twoWordMatches, ...filteredSingle];
  const uniqueNames = Array.from(new Set(matches)).slice(0, 4);

  const results: CharacterCardInfo[] = [];

  for (const name of uniqueNames) {
    // Buscar exclusivamente en capítulos anteriores (currentChapterIndex - 1 hacia atrás)
    const history = await searchBookMentions({
      bookId,
      query: name,
      maxChapterIndex: currentChapterIndex - 1,
      sections: params.sections,
      toc: params.toc,
    });

    if (history.length > 0) {
      results.push({
        name,
        oneLiner: history[0].shortContextSnippet || "Mencionado anteriormente en la historia.",
      });
    }
  }

  return results;
}
