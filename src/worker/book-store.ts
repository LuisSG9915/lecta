// Almacén de libros propios en CockroachDB: cuota por cuenta, registro,
// portada y borrado de `user_books`, y flags de la fila. Extraído de app.ts
// para que `user-books.ts` y las rutas `/api/books*` no dependan de un
// import circular con `app.ts`.
import { getConnectionString, isMissingColumnError, withClient, type WorkerEnv } from "./db";
import { isResetBlocked, StaleResetError, withResetGuard } from "./reset-guard";

export const HASH_PATTERN = /^[a-f0-9]{64}$/;

export const MAX_USER_STORAGE_BYTES = 500 * 1024 * 1024; // 500 MB por cuenta
export const MAX_USER_BOOKS = 100;

export async function checkUserBooksQuota(
  env: WorkerEnv,
  userId: string,
  bookId: string,
  newFileBytes: number,
): Promise<{ allowed: boolean; reason?: string }> {
  let totalBytes = 0;
  let bookCount = 0;

  if (getConnectionString(env)) {
    const res = await withClient(env, (client) =>
      client.query<{ total_bytes: string | number; book_count: string | number }>(
        `SELECT
           COALESCE(SUM(size_bytes), 0)::bigint AS total_bytes,
           COUNT(*)::int AS book_count
         FROM user_books
         WHERE user_id = $1 AND book_id != $2`,
        [userId, bookId],
      ),
    );
    if (res?.rows[0]) {
      totalBytes = Number(res.rows[0].total_bytes);
      bookCount = Number(res.rows[0].book_count);
    }
  }

  if (bookCount >= MAX_USER_BOOKS) {
    return { allowed: false, reason: "Storage quota exceeded: maximum books limit reached (100)" };
  }
  if (totalBytes + newFileBytes > MAX_USER_STORAGE_BYTES) {
    return { allowed: false, reason: "Storage quota exceeded for this account" };
  }

  return { allowed: true };
}

export async function recordUserBook(
  env: WorkerEnv,
  book: {
    userId: string;
    bookId: string;
    title: string;
    author: string;
    language?: string;
    // Género editorial (BOOK_GENRES); "" = sin clasificar. En conflicto
    // solo pisa si trae valor: la elección manual del lector al
    // compartir sobrevive a una resubida sin género.
    genre?: string;
    r2Key: string;
    sizeBytes: number;
    sha256: string;
    hasCover?: boolean;
    // Marca de reinicio que el cliente declara; definida, la fila se
    // escribe dentro de la transacción guardada (StaleResetError si un
    // reinicio remoto la invalida).
    resetAck?: number;
  },
): Promise<void> {
  const now = Date.now();
  const hasCoverVal = book.hasCover ? true : false;
  if (getConnectionString(env)) {
    // Tolera la columna `language` ausente (despliegue antes de la
    // migración 022): el error se traga y la fila no se registra, como
    // cuando falta la conexión.
    // Con resetAck la fila corre dentro de la transacción guardada: un
    // sello más nuevo aborta con StaleResetError en vez de resucitar.
    // Dos variantes: con `genre` (migración 025 aplicada) y sin ella
    // (worker desplegado antes de migrar) — el género es metadato
    // complementario y jamás debe tirar la fila del libro.
    const sqlBase = `INSERT INTO user_books (user_id, book_id, title, author, language, r2_key, size_bytes, sha256, has_cover, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           title = EXCLUDED.title,
           author = EXCLUDED.author,
           language = EXCLUDED.language,
           r2_key = EXCLUDED.r2_key,
           size_bytes = EXCLUDED.size_bytes,
           sha256 = EXCLUDED.sha256,
           has_cover = EXCLUDED.has_cover,
           updated_at = EXCLUDED.updated_at`;
    const sqlGenre = `INSERT INTO user_books (user_id, book_id, title, author, language, r2_key, size_bytes, sha256, has_cover, genre, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           title = EXCLUDED.title,
           author = EXCLUDED.author,
           language = EXCLUDED.language,
           r2_key = EXCLUDED.r2_key,
           size_bytes = EXCLUDED.size_bytes,
           sha256 = EXCLUDED.sha256,
           has_cover = EXCLUDED.has_cover,
           genre = CASE WHEN EXCLUDED.genre <> '' THEN EXCLUDED.genre ELSE user_books.genre END,
           updated_at = EXCLUDED.updated_at`;
    // Tercera variante (027): la subida deja el archivo en R2, así que la
    // fila pasa a has_file = true aunque antes fuera solo de metadatos.
    const sqlGenreFile = `INSERT INTO user_books (user_id, book_id, title, author, language, r2_key, size_bytes, sha256, has_cover, genre, has_file, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, $12)
         ON CONFLICT (user_id, book_id) DO UPDATE SET
           title = EXCLUDED.title,
           author = EXCLUDED.author,
           language = EXCLUDED.language,
           r2_key = EXCLUDED.r2_key,
           size_bytes = EXCLUDED.size_bytes,
           sha256 = EXCLUDED.sha256,
           has_cover = EXCLUDED.has_cover,
           genre = CASE WHEN EXCLUDED.genre <> '' THEN EXCLUDED.genre ELSE user_books.genre END,
           has_file = EXCLUDED.has_file,
           updated_at = EXCLUDED.updated_at`;
    const baseParams = [
      book.userId,
      book.bookId,
      book.title,
      book.author,
      book.language ?? "",
      book.r2Key,
      book.sizeBytes,
      book.sha256,
      hasCoverVal,
      now,
      now,
    ];
    const genreParams = [...baseParams.slice(0, 9), book.genre ?? "", ...baseParams.slice(9)];
    // Cadena ante 42703: genre + has_file → genre → base.
    const insert = (client: Parameters<Parameters<typeof withClient>[1]>[0]) =>
      client
        .query(sqlGenreFile, genreParams)
        .catch((err: unknown) =>
          isMissingColumnError(err)
            ? client.query(sqlGenre, genreParams)
            : Promise.reject(err),
        )
        .catch((err: unknown) =>
          isMissingColumnError(err)
            ? client.query(sqlBase, baseParams)
            : Promise.reject(err),
        );
    const res = await (book.resetAck === undefined
      ? withClient(env, insert)
      : withResetGuard(env, book.resetAck, book.userId, insert)
    ).catch((err: unknown) => {
      if (err instanceof StaleResetError) throw err;
      return undefined;
    });
    if (isResetBlocked(res)) throw new StaleResetError(res.blockedAt);
  }
}

export async function setUserBookCover(
  env: WorkerEnv,
  userId: string,
  bookId: string,
  hasCover: boolean,
  resetAck?: number,
): Promise<void> {
  const now = Date.now();
  if (getConnectionString(env)) {
    const update = (client: Parameters<Parameters<typeof withClient>[1]>[0]) =>
      client.query(
        `UPDATE user_books SET has_cover = $1, updated_at = $2 WHERE user_id = $3 AND book_id = $4`,
        [hasCover, now, userId, bookId],
      );
    const res = await (resetAck === undefined
      ? withClient(env, update)
      : withResetGuard(env, resetAck, userId, update)
    ).catch((err: unknown) => {
      if (err instanceof StaleResetError) throw err;
      return undefined;
    });
    if (isResetBlocked(res)) throw new StaleResetError(res.blockedAt);
  }
}

export async function deleteUserBookRecord(
  env: WorkerEnv,
  userId: string,
  bookId: string,
  resetAck?: number,
): Promise<void> {
  if (getConnectionString(env)) {
    const remove = (client: Parameters<Parameters<typeof withClient>[1]>[0]) =>
      client.query(`DELETE FROM user_books WHERE user_id = $1 AND book_id = $2`, [userId, bookId]);
    const res = await (resetAck === undefined
      ? withClient(env, remove)
      : withResetGuard(env, resetAck, userId, remove));
    if (isResetBlocked(res)) throw new StaleResetError(res.blockedAt);
  }
}

export type BookFlags = { shared: boolean; paperOnly: boolean; genre: string };

// Flags que viven en la fila (el customMetadata de R2 no se actualiza
// sin resubir el archivo). `genre` (025) se pide primero en la misma
// consulta; sin la columna se reintenta con las de la 024 — los flags
// base no se pierden por un género que aún no existe.
export async function listUserBookFlags(
  env: WorkerEnv,
  userId: string,
): Promise<Map<string, BookFlags>> {
  const flags = new Map<string, BookFlags>();
  const sqlPgGenre = `SELECT book_id, shared, paper_only, genre FROM user_books WHERE user_id = $1`;
  const sqlPgBase = `SELECT book_id, shared, paper_only FROM user_books WHERE user_id = $1`;
  const collect = (rows: Array<{ book_id: unknown; shared: unknown; paper_only: unknown; genre?: unknown }>) => {
    for (const row of rows) {
      flags.set(String(row.book_id), {
        shared: row.shared === true || row.shared === 1,
        paperOnly: row.paper_only === true || row.paper_only === 1,
        genre: String(row.genre ?? ""),
      });
    }
  };
  if (getConnectionString(env)) {
    const query = (sql: string) =>
      withClient(env, (client) =>
        client.query<{ book_id: unknown; shared: unknown; paper_only: unknown; genre?: unknown }>(sql, [userId]),
      ).catch((err) => (isMissingColumnError(err) ? null : Promise.reject(err)));
    const res = (await query(sqlPgGenre)) ?? (await query(sqlPgBase)) ?? undefined;
    if (res) collect(res.rows);
    return flags;
  }
  return flags;
}
