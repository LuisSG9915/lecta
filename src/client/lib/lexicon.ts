export type LexiconEntry = {
  lemma: string;
  pos: string | null;
  freqRank: number | null;
  senses: { definition: string; example: string | null }[];
};

export type LookupResult =
  | { ok: true; found: boolean; entries: LexiconEntry[] }
  | { ok: false; error: string };

export async function lookupWord(form: string, language = "es"): Promise<LookupResult> {
  const params = new URLSearchParams({ form, lang: language });
  try {
    const response = await fetch(`/api/lexicon/lookup?${params}`);
    if (response.status === 404) return { ok: true, found: false, entries: [] };
    const data = await response.json();
    if (!response.ok) return { ok: false, error: data.error ?? "No se pudo consultar el catálogo." };
    return { ok: true, found: data.found, entries: data.entries ?? [] };
  } catch {
    return { ok: false, error: "Sin conexión con el catálogo." };
  }
}

export async function enrichWord(
  form: string,
  language = "es",
  context?: string,
): Promise<LookupResult> {
  try {
    const response = await fetch("/api/lexicon/enrich", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ form, language, context }),
    });
    const data = await response.json();
    if (!response.ok) return { ok: false, error: data.error ?? "La IA no pudo definir la palabra." };
    return { ok: true, found: true, entries: data.entries ?? [] };
  } catch {
    return { ok: false, error: "Sin conexión con el catálogo." };
  }
}
