import {
  captureDbScope,
  enqueueBookOp,
  isDbScopeActive,
  StaleScopeError,
  getStoredBook,
  listBookOps,
  markBookOpError,
  removeBookOp,
  type DbScope,
} from "./idb";
import { deleteBook, uploadBook, uploadBookCover } from "./books";
import { readBookMeta, isHashLikeIdentifier, humanizeFilename, coverToJpegBlob } from "./cover";

// Encola la subida de un libro local a la cuenta; se procesa con
// runBookQueue (al iniciar sesión o cuando vuelve la conexión).
export async function queueBookUpload(hash: string, name?: string, scope?: DbScope) {
  const bound = scope ?? captureDbScope();
  const book = await getStoredBook(hash, bound);
  if (!book || !book.data || book.data.size === 0) {
    return;
  }
  return enqueueBookOp({ kind: "upload", hash, name }, bound);
}

export function queueBookDelete(hash: string, scope?: DbScope) {
  return enqueueBookOp({ kind: "delete", hash }, scope);
}

// Procesa las operaciones pendientes contra la cuenta activa.
// Devuelve cuántas se completaron. Si la cuenta cambia mientras
// procesa, para de inmediato (las ops pendientes quedan para la
// cuenta correcta).
export async function runBookQueue(scope?: DbScope): Promise<number> {
  const bound = scope ?? captureDbScope();
  if (!bound.userId || !isDbScopeActive(bound)) return 0;
  const ops = (await listBookOps(bound)).sort((a, b) => a.createdAt - b.createdAt);
  let done = 0;
  for (const op of ops) {
    if (!isDbScopeActive(bound)) break;
    try {
      // null = la op ya no aplica y sale de la cola sin ser error
      // (p. ej. el libro se borró del dispositivo antes de subirse).
      let ok: boolean | null;
      if (op.kind === "upload") {
        const book = await getStoredBook(op.hash, bound);
        if (book) {
          if (!book.data || book.data.size === 0) {
            // Guarda estricta: jamás intentar subir a /api/books un libro con data vacía;
            // se descarta la tarea de la cola retornando null.
            ok = null;
          } else {
            let title = book.title;
            let author = book.author;
            let sectionCount = book.sectionCount;
            let language = book.language;
            let coverBlob = book.cover ?? null;

            if (
              !title ||
              !language ||
              !sectionCount ||
              isHashLikeIdentifier(title) ||
              isHashLikeIdentifier(book.name)
            ) {
              const meta = await readBookMeta(book.data).catch(() => null);
              if (meta) {
                title = meta.title || title;
                author = meta.author || author;
                sectionCount = meta.sectionCount ?? sectionCount;
                language = meta.language || language;
                if (!coverBlob && meta.cover) {
                  coverBlob = meta.cover;
                }
              }
            }

            if (!title || isHashLikeIdentifier(title)) {
              const humanized = humanizeFilename(book.name);
              if (humanized) {
                title = humanized;
              }
            }

            ok = await uploadBook(
              op.hash,
              new File([book.data], op.name || book.name),
              // Los metadatos viajan con el objeto remoto: así otros
              // dispositivos muestran título, autor e idioma sin bajar el EPUB.
              {
                title,
                author,
                sectionCount,
                language,
              },
              bound,
            );

            // Subida de portada en segundo plano (best-effort)
            if (ok && coverBlob) {
              try {
                const jpeg = await coverToJpegBlob(coverBlob);
                await uploadBookCover(op.hash, jpeg, bound);
              } catch {
                // Falla silenciosamente sin bloquear la cola
              }
            }
          }
        } else {
          ok = null;
        }
      } else {
        ok = await deleteBook(op.hash, bound);
      }
      if (ok === false) {
        await markBookOpError(op.id, "El servidor rechazó la operación.", bound);
        continue;
      }
      await removeBookOp(op.id, bound);
      if (ok === true) {
        done += 1;
      }
    } catch (error) {
      if (error instanceof StaleScopeError) break;
      await markBookOpError(
        op.id,
        error instanceof Error ? error.message : String(error),
        bound,
      );
    }
  }
  return done;
}
