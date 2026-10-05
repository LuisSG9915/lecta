import {
  enqueueBookOp,
  getActiveUserId,
  getStoredBook,
  listBookOps,
  markBookOpError,
  removeBookOp,
} from "./idb";
import { deleteBook, uploadBook } from "./books";

// Encola la subida de un libro local a la cuenta; se procesa con
// runBookQueue (al iniciar sesión o cuando vuelve la conexión).
export function queueBookUpload(hash: string, name?: string) {
  return enqueueBookOp({ kind: "upload", hash, name });
}

// Encola el borrado remoto de un libro (el local ya se eliminó).
export function queueBookDelete(hash: string) {
  return enqueueBookOp({ kind: "delete", hash });
}

// Procesa la cola en orden de llegada. Una op que falla queda marcada
// con su error y no frena a las demás. Devuelve cuántas salieron bien;
// sin sesión no toca la cola y devuelve 0.
export async function runBookQueue(): Promise<number> {
  if (!getActiveUserId()) return 0;
  const ops = (await listBookOps()).sort((a, b) => a.createdAt - b.createdAt);
  let done = 0;
  for (const op of ops) {
    try {
      // null = la op ya no aplica y sale de la cola sin ser error
      // (p. ej. el libro se borró del dispositivo antes de subirse).
      let ok: boolean | null;
      if (op.kind === "upload") {
        const book = await getStoredBook(op.hash);
        ok = book
          ? await uploadBook(op.hash, new File([book.data], op.name || book.name))
          : null;
      } else {
        ok = await deleteBook(op.hash);
      }
      if (ok === false) {
        await markBookOpError(op.id, "El servidor rechazó la operación.");
        continue;
      }
      await removeBookOp(op.id);
      done += 1;
    } catch (error) {
      await markBookOpError(
        op.id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return done;
}
