import { accountFetch } from "./account-fetch";
import type { DbScope } from "./idb";
import type {
  BilingualScaffoldingProfile,
  BilingualScaffoldingTier,
  DetectedMultiwordPhrase,
} from "./phrases";
import {
  selectOptimalScaffoldingTier,
  updateBilingualAutonomyProfile,
  calculateLexicalFrictionDensity,
  DEFAULT_BILINGUAL_PROFILE,
  CORE_FOREIGN_IDIOMS,
} from "./phrases";

export type {
  BilingualScaffoldingProfile,
  BilingualScaffoldingTier,
  DetectedMultiwordPhrase,
};
export {
  selectOptimalScaffoldingTier,
  updateBilingualAutonomyProfile,
  calculateLexicalFrictionDensity,
  DEFAULT_BILINGUAL_PROFILE,
  CORE_FOREIGN_IDIOMS,
};

/**
 * Traduce un párrafo de forma natural (de inglés a español) para la lectura bilingüe fluida.
 */
export async function translateParagraph(
  text: string,
  from = "en",
  to = "es",
  scope?: DbScope,
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return "";

  try {
    const res = await accountFetch(
      "/api/ai/translate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed, from, to }),
      },
      scope,
    );

    if (res.ok) {
      const data = (await res.json()) as { translation?: string };
      if (typeof data.translation === "string" && data.translation.trim()) {
        return data.translation.trim();
      }
    }
  } catch {
    // Fallback suave en caso de error de red o modo sin conexión
  }

  return trimmed;
}

/**
 * Traduce una cláusula compleja de forma natural para el Nivel 2 de andamiaje bilingüe.
 */
export async function translateClause(
  clauseText: string,
  from = "en",
  to = "es",
  scope?: DbScope,
): Promise<string> {
  return translateParagraph(clauseText, from, to, scope);
}

/**
 * Segmenta un párrafo en cláusulas conservando índices de inicio y fin dentro del texto original.
 */
export function extractParagraphClauses(paragraphText: string): Array<{
  text: string;
  startIndex: number;
  endIndex: number;
  wordCount: number;
}> {
  const regex = /[^,;:—–.!?]+(?:[,;:—–.!?]+|$)/g;
  const clauses: Array<{
    text: string;
    startIndex: number;
    endIndex: number;
    wordCount: number;
  }> = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(paragraphText)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const offset = raw.indexOf(trimmed);
    const start = match.index + offset;
    const end = start + trimmed.length;
    const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
    clauses.push({
      text: trimmed,
      startIndex: start,
      endIndex: end,
      wordCount,
    });
  }

  return clauses;
}

/**
 * Selecciona la cláusula más compleja (mayor longitud en palabras) de un párrafo
 * para presentar la traducción focalizada en el Nivel 2.
 */
export function selectMostComplexClause(paragraphText: string): {
  text: string;
  startIndex: number;
  endIndex: number;
} | null {
  const clauses = extractParagraphClauses(paragraphText);
  if (!clauses.length) return null;
  const sorted = [...clauses].sort((a, b) => b.wordCount - a.wordCount);
  return {
    text: sorted[0].text,
    startIndex: sorted[0].startIndex,
    endIndex: sorted[0].endIndex,
  };
}
