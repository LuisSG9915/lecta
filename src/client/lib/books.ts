import { accountFetch } from "./account-fetch";
import { StaleScopeError, type DbScope } from "./idb";

export type RemoteBook = {
  hash: string;
  uploaded: string;
  name: string;
  // Metadatos guardados en la subida: título, autor y número de
  // secciones — la estantería los muestra sin descargar el EPUB.
  title?: string;
  author?: string;
  sections?: number;
  language?: string;
};

export type BookUploadMeta = {
  title?: string;
  author?: string;
  sectionCount?: number;
  language?: string;
};

// Las funciones de libros remotos re-lanzan StaleScopeError: «la cuenta
// cambió a mitad» no es un fallo del servidor y quien encoló la
// operación debe distinguirlo (book-queue para sin marcar error).
export async function uploadBook(
  hash: string,
  file: File,
  meta: BookUploadMeta = {},
  scope?: DbScope,
) {
  try {
    const params = new URLSearchParams({ name: file.name });
    if (meta.title) params.set("title", meta.title);
    if (meta.author) params.set("author", meta.author);
    if (meta.sectionCount) params.set("sections", String(meta.sectionCount));
    if (meta.language) params.set("language", meta.language);
    const response = await accountFetch(
      `/api/books/${hash}?${params.toString()}`,
      {
        method: "PUT",
        body: file,
      },
      scope,
    );
    return response.ok;
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return false;
  }
}

export async function listRemoteBooks(scope?: DbScope): Promise<RemoteBook[]> {
  try {
    const response = await accountFetch("/api/books", undefined, scope);
    if (!response.ok) return [];
    const data = (await response.json()) as { books?: RemoteBook[] };
    return data.books ?? [];
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return [];
  }
}

export async function downloadBook(book: RemoteBook, scope?: DbScope) {
  try {
    const response = await accountFetch(`/api/books/${book.hash}`, undefined, scope);
    if (!response.ok) return null;
    const data = await response.blob();
    return new File([data], book.name || `${book.hash.slice(0, 8)}.epub`, {
      type: "application/epub+zip",
    });
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return null;
  }
}

export async function deleteBook(hash: string, scope?: DbScope) {
  try {
    const response = await accountFetch(`/api/books/${hash}`, { method: "DELETE" }, scope);
    // 404 también cuenta: el libro ya no está en la nube, que es lo que
    // pedía el borrado (p. ej. otro dispositivo lo quitó antes). Así la
    // op encolada sale de la cola en vez de reintentar para siempre.
    return response.ok || response.status === 404;
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return false;
  }
}
