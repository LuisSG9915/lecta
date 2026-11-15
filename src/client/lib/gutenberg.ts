import type { CatalogBook } from "./catalog";

// ---------- Búsqueda en el índice propio de Gutenberg ----------
//
// `/api/catalog/search` consulta lecta_dev.gutenberg_books en el
// worker: devuelve páginas de hasta 24 libros pg- ordenados por
// descargas. La forma de cada libro es la de CatalogBook (sin
// wordCount ni manifiesto: el cliente los analiza al vuelo como con
// cualquier EPUB sin vocab).
//
// Vive en su propio módulo —no dentro de catalog.ts— porque solo lo
// usa el componente diferido «Más clásicos»: si se importara desde el
// catálogo general engordaría el chunk inicial de la app.

export type GutenbergSearchParams = {
  q?: string;
  lang?: "es" | "en";
  // Término en inglés de los temas de Gutenberg (fiction, poetry…).
  topic?: string;
  page?: number;
};

export type GutenbergSearchPage = {
  page: number;
  hasMore: boolean;
  books: CatalogBook[];
};

export function isGutenbergSearchPage(
  data: unknown,
): data is GutenbergSearchPage {
  const page = data as GutenbergSearchPage;
  return (
    typeof page === "object" &&
    page !== null &&
    typeof page.page === "number" &&
    typeof page.hasMore === "boolean" &&
    Array.isArray(page.books) &&
    page.books.every(
      (b) =>
        typeof b?.id === "string" &&
        typeof b?.title === "string" &&
        typeof b?.author === "string",
    )
  );
}

// Null en cualquier fallo (red, 4xx/5xx, forma inesperada): la sección
// decide si mostrar error o vacío — nunca lanza por una búsqueda.
export async function searchGutenberg(
  params: GutenbergSearchParams,
  signal?: AbortSignal,
): Promise<GutenbergSearchPage | null> {
  const qs = new URLSearchParams();
  const q = params.q?.trim();
  if (q) qs.set("q", q);
  if (params.lang) qs.set("lang", params.lang);
  if (params.topic?.trim()) qs.set("topic", params.topic.trim());
  if (params.page && params.page > 0) qs.set("page", String(params.page));
  const query = qs.toString();
  const response = await fetch(
    `/api/catalog/search${query ? `?${query}` : ""}`,
    { signal },
  ).catch(() => null);
  if (!response?.ok) return null;
  const data = await response.json().catch(() => null);
  return isGutenbergSearchPage(data) ? data : null;
}
