export type RemoteBook = { hash: string; uploaded: string; name: string };

export async function uploadBook(hash: string, file: File) {
  try {
    const response = await fetch(`/api/books/${hash}?name=${encodeURIComponent(file.name)}`, {
      method: "PUT",
      body: file,
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function listRemoteBooks(): Promise<RemoteBook[]> {
  try {
    const response = await fetch("/api/books");
    if (!response.ok) return [];
    const data = (await response.json()) as { books?: RemoteBook[] };
    return data.books ?? [];
  } catch {
    return [];
  }
}

export async function downloadBook(book: RemoteBook) {
  try {
    const response = await fetch(`/api/books/${book.hash}`);
    if (!response.ok) return null;
    const data = await response.blob();
    return new File([data], book.name || `${book.hash.slice(0, 8)}.epub`, {
      type: "application/epub+zip",
    });
  } catch {
    return null;
  }
}

export async function deleteBook(hash: string) {
  try {
    const response = await fetch(`/api/books/${hash}`, { method: "DELETE" });
    // 404 también cuenta: el libro ya no está en la nube, que es lo que
    // pedía el borrado (p. ej. otro dispositivo lo quitó antes). Así la
    // op encolada sale de la cola en vez de reintentar para siempre.
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
