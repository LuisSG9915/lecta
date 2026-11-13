import { accountFetch } from "./account-fetch";
import { StaleScopeError, type DbScope } from "./idb";
import { isHashLikeIdentifier } from "./cover";

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
  hasCover?: boolean;
  // Flags de la biblioteca comunitaria (fila user_books, migración 024):
  // `shared` = lo ofrecí a la comunidad; `paperOnly` = copia comunitaria
  // que solo abre el índice del modo papel, nunca el lector.
  shared?: boolean;
  paperOnly?: boolean;
  // Género editorial detectado al subir (migración 025): sirve para
  // preseleccionar los chips al compartir desde otro dispositivo.
  genre?: string;
  // Migración 027: false = libro propio registrado solo con metadatos (plan
  // free); el archivo no está en la nube y se adjunta en este dispositivo.
  hasFile?: boolean;
};

// Entrada del catálogo comunitario: una por sha256 aunque lo compartan
// varios lectores. Solo metadatos — el EPUB llega al adjuntar.
export type CommunityBook = {
  hash: string;
  title: string;
  author: string;
  language: string;
  sizeBytes: number;
  hasCover: boolean;
  sharers: number;
  // Uno de BOOK_GENRES o "" cuando la guía no se clasificó todavía.
  genre: string;
};

export type BookUploadMeta = {
  title?: string;
  author?: string;
  sectionCount?: number;
  language?: string;
  genre?: string;
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
    if (meta.genre) params.set("genre", meta.genre);
    const response = await accountFetch(
      `/api/books/${hash}?${params.toString()}`,
      {
        method: "PUT",
        body: file,
      },
      scope,
    );
    // 402 = la nube de EPUB es de Lecta+: la operación ya no aplica (null la
    // saca de la cola sin marcarla como error).
    if (response.status === 402) return null;
    return response.ok;
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return false;
  }
}

/**
 * Registra un libro propio solo con metadatos (gratis, migración 027) para
 * que la estantería de otro dispositivo lo vea. true = registrado;
 * null = 4xx (no tiene sentido reintentar); false = 5xx o sin red.
 */
export async function registerBookMeta(
  hash: string,
  meta: { title?: string; author?: string; language?: string },
  scope?: DbScope,
): Promise<boolean | null> {
  try {
    const response = await accountFetch(
      `/api/user/books/${hash}/meta`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...meta, sha256: hash }),
      },
      scope,
    );
    if (response.ok) return true;
    return response.status >= 400 && response.status < 500 ? null : false;
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
  return (await downloadBookWithStatus(book, scope)).file;
}

/** Como downloadBook, pero distingue el 402 de Lecta+ de un fallo de red. */
export async function downloadBookWithStatus(
  book: RemoteBook,
  scope?: DbScope,
): Promise<{ file: File | null; status: number }> {
  try {
    const response = await accountFetch(`/api/books/${book.hash}`, undefined, scope);
    if (!response.ok) return { file: null, status: response.status };
    const data = await response.blob();
    const fallbackName = book.title && !isHashLikeIdentifier(book.title)
      ? `${book.title}.epub`
      : `${book.hash}.epub`;
    const file = new File([data], book.name && !isHashLikeIdentifier(book.name) ? book.name : fallbackName, {
      type: "application/epub+zip",
    });
    return { file, status: response.status };
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return { file: null, status: 0 };
  }
}

// --- Biblioteca comunitaria «solo papel» (modelo A1) ------------------
// Compartir es opt-in por libro: se sube la GUÍA de papel generada en
// este dispositivo (índice + formas por capítulo, cero texto). Adjuntar
// crea la entrada propia paper_only y devuelve la guía — el EPUB del
// donante jamás sale de su cuenta.

export type CommunityBooksResult = {
  ok: boolean;
  books: CommunityBook[];
};

export async function listCommunityBooksResult(
  scope?: DbScope,
): Promise<CommunityBooksResult> {
  try {
    const response = await accountFetch("/api/books/community", undefined, scope);
    if (!response.ok) return { ok: false, books: [] };
    const data = (await response.json()) as { books?: CommunityBook[] };
    return { ok: true, books: data.books ?? [] };
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return { ok: false, books: [] };
  }
}

export async function listCommunityBooks(scope?: DbScope): Promise<CommunityBook[]> {
  const result = await listCommunityBooksResult(scope);
  return result.books;
}

export async function shareBook(
  hash: string,
  shared: boolean,
  scope?: DbScope,
  guide?: unknown,
  // Género elegido en la hoja de opciones (BOOK_GENRES); "" lo limpia,
  // undefined no toca la columna. Viaja en el mismo PUT que la guía.
  genre?: string,
) {
  try {
    const payload =
      shared && (guide !== undefined || genre !== undefined)
        ? JSON.stringify({ guide, genre })
        : undefined;
    const response = await accountFetch(`/api/books/${hash}/share`, {
      method: shared ? "PUT" : "DELETE",
      headers:
        payload ? { "content-type": "application/json" } : undefined,
      body: payload,
    }, scope);
    return response.ok;
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return false;
  }
}

export type AttachResult = {
  ok: boolean;
  already?: boolean;
  // La guía de papel sanitizada por el servidor — lista para guardar
  // en `paperGuide:v1:{hash}` sin una segunda descarga.
  guide?: unknown;
  // Motivo real que respondió el servidor («Ese libro ya es tuyo»,
  // «La guía ya no está disponible»…) — sin él toda falla se leía
  // como problema de conexión.
  error?: string;
};

export async function attachCommunityBook(
  hash: string,
  scope?: DbScope,
): Promise<AttachResult> {
  try {
    const response = await accountFetch(`/api/books/community/${hash}/attach`, {
      method: "POST",
    }, scope);
    const data = (await response.json().catch(() => null)) as
      | (AttachResult & { error?: string })
      | null;
    if (!response.ok) return { ok: false, error: data?.error };
    return data ?? { ok: false };
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return { ok: false };
  }
}

// La guía de un libro adjuntado: sirve para recuperarla en otro
// dispositivo o tras limpiar IndexedDB.
export async function fetchBookGuide(
  hash: string,
  scope?: DbScope,
): Promise<unknown | null> {
  try {
    const response = await accountFetch(`/api/books/${hash}/guide`, undefined, scope);
    if (!response.ok) return null;
    return await response.json();
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

export async function uploadBookCover(
  hash: string,
  cover: Blob,
  scope?: DbScope,
): Promise<boolean> {
  try {
    const response = await accountFetch(
      `/api/books/${hash}/cover`,
      {
        method: "PUT",
        headers: { "Content-Type": cover.type || "image/jpeg" },
        body: cover,
      },
      scope,
    );
    return response.ok;
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return false;
  }
}

export async function fetchBookCover(
  hash: string,
  scope?: DbScope,
): Promise<Blob | null> {
  try {
    const response = await accountFetch(`/api/books/${hash}/cover`, undefined, scope);
    if (!response.ok) return null;
    return await response.blob();
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return null;
  }
}

export async function repairRemoteBook(
  hash: string,
  scope?: DbScope,
): Promise<Partial<RemoteBook> | null> {
  try {
    const response = await accountFetch(`/api/books/${hash}/repair`, { method: "POST" }, scope);
    if (!response.ok) return null;
    return (await response.json()) as Partial<RemoteBook>;
  } catch (error) {
    if (error instanceof StaleScopeError) throw error;
    return null;
  }
}
