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
import { deleteBook, uploadBook } from "./books";
import { readBookMeta } from "./cover";

// Encola la subida de un libro local a la cuenta; se procesa con
// runBookQueue (al iniciar sesión o cuando vuelve la conexión).
export function queueBookUpload(hash: string, name?: string, scope?: DbScope) {
  return enqueueBookOp({ kind: "upload", hash, name }, scope);
}

// Encola el borrado remoto de un libro (el local ya se eliminó).
export function queueBookDelete(hash: string, scope?: DbScope) {
  return enqueueBookOp({ kind: "delete", hash }, scope);
}

// Procesa la cola en orden de llegada dentro del contexto capturado:
// si la cuenta cambia a mitad de la corrida se detiene sin marcar
// error (las ops quedan para la próxima corrida de la cuenta nueva).
// Una op que falla queda anotada con su error y no frena a las demás.
// Devuelve cuántas salieron bien; sin sesión no toca la cola y
// devuelve 0.
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
          let title = book.title;
          let author = book.author;
          let sectionCount = book.sectionCount;
          if (!title || !author) {
            const meta = await readBookMeta(book.data).catch(() => null);
            if (meta) {
              title = meta.title || title;
              author = meta.author || author;
              sectionCount = meta.sectionCount ?? sectionCount;
            }
          }
          ok = await uploadBook(
            op.hash,
            new File([book.data], op.name || book.name),
            // Los metadatos viajan con el objeto remoto: así otros
            // dispositivos muestran título y autor sin bajar el EPUB.
            {
              title,
              author,
              sectionCount,
            },
            bound,
          );
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
      done += 1;
    } catch (error) {
      // El contexto venció (la sesión cambió durante la corrida): no es
      // un fallo de la op, así que se queda en la cola sin anotar.
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
