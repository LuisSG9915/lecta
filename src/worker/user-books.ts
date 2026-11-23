// Libros propios sincronizados (BYO-EPUB) en CockroachDB y R2:
// `/api/user/books/*`. Extraído de app.ts (R2 de la deuda de complejidad).
import { Hono } from "hono";
import {
  HASH_PATTERN,
  checkUserBooksQuota,
  listUserBookFlags,
  recordUserBook,
  type BookFlags,
} from "./book-store";
import { getConnectionString, isMissingColumnError, withClient, type WorkerEnv } from "./db";
import { requireLectaPlus } from "./plan-middleware";
import {
  StaleResetError,
  isResetBlocked,
  readResetAck,
  resetBlockedResponse,
  staleResetAt,
  withResetGuard,
} from "./reset-guard";
import { checkEpubBuffer, EPUB_MAX_BYTES } from "../shared/epub-check";
import { getSessionUser } from "./session";

export const userBooks = new Hono<{ Bindings: WorkerEnv }>();

// ---------- Sincronización Cloud de EPUBs Propios (BYO-EPUB) en CockroachDB y R2 ----------

// Libro propio solo con metadatos (027): gratis y con sesión. Registra la
// fila para que la estantería de otro dispositivo vea el libro; el archivo
// se adjunta allá (emparejado por sha256). Nunca toca r2_key, size_bytes ni
// has_file de una fila que ya tenga archivo.
userBooks.put("/api/user/books/:bookId/meta", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ error: "No autenticado" }, 401);
  const bookId = c.req.param("bookId");
  const body = (await c.req.json().catch(() => null)) as {
    title?: unknown;
    author?: unknown;
    language?: unknown;
    sha256?: unknown;
  } | null;
  const text = (value: unknown, max: number) =>
    typeof value === "string" ? value.trim().slice(0, max) : "";
  const sha256 = text(body?.sha256, 64).toLowerCase();
  if (!HASH_PATTERN.test(bookId) || sha256 !== bookId) {
    return c.json({ error: "El archivo no coincide con el libro." }, 400);
  }
  if (!getConnectionString(c.env)) {
    return c.json({ error: "Servicio temporalmente no disponible" }, 503);
  }
  const quota = await checkUserBooksQuota(c.env, user.id, bookId, 0);
  if (!quota.allowed) {
    return c.json({ error: quota.reason ?? "Llegaste al límite de libros de tu cuenta." }, 413);
  }
  const now = Date.now();
  const params = [
    user.id,
    bookId,
    text(body?.title, 300),
    text(body?.author, 200),
    text(body?.language, 16),
    sha256,
    now,
  ];
  const insert = (client: Parameters<Parameters<typeof withClient>[1]>[0]) =>
    client.query(
      `INSERT INTO user_books (user_id, book_id, title, author, language, r2_key, size_bytes, sha256, has_file, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, '', 0, $6, false, $7, $7)
       ON CONFLICT (user_id, book_id) DO UPDATE SET
         title = EXCLUDED.title,
         author = EXCLUDED.author,
         language = EXCLUDED.language,
         updated_at = EXCLUDED.updated_at`,
      params,
    );
  let res;
  try {
    res = await withResetGuard(c.env, readResetAck(c), user.id, insert);
  } catch (err) {
    if (err instanceof StaleResetError) return resetBlockedResponse(c, err.resetAt);
    if (isMissingColumnError(err)) {
      return c.json({ error: "Servicio temporalmente no disponible" }, 503);
    }
    throw err;
  }
  if (isResetBlocked(res)) return resetBlockedResponse(c, res.blockedAt);
  return c.json({ ok: true, hasFile: false });
});

userBooks.put("/api/user/books/:bookId/file", requireLectaPlus, async (c) => {
  const user = c.get("session")?.user ?? null;
  if (!user) return c.json({ error: "No autenticado" }, 401);

  const staleReset = await staleResetAt(c.env, c, user.id);
  if (staleReset) return resetBlockedResponse(c, staleReset);

  const booksBucket = c.env.BOOKS;
  if (!booksBucket) {
    return c.json({ error: "Almacenamiento no configurado" }, 503);
  }

  const bookId = c.req.param("bookId");
  const rawTitle = c.req.header("x-book-title");
  const rawAuthor = c.req.header("x-book-author");
  const rawLanguage = c.req.header("x-book-language");
  const title = rawTitle ? decodeURIComponent(rawTitle) : bookId;
  const author = rawAuthor ? decodeURIComponent(rawAuthor) : "";
  const language = rawLanguage ? decodeURIComponent(rawLanguage) : "";
  const sha256 = c.req.header("x-book-sha256") ?? "";

  const buffer = await c.req.arrayBuffer();
  if (buffer.byteLength === 0 || buffer.byteLength > EPUB_MAX_BYTES) {
    return c.json({ error: "El archivo EPUB excede el límite permitido" }, 413);
  }

  const check = checkEpubBuffer(buffer);
  if (!check.ok) {
    return c.json({ error: check.reason ?? "Archivo EPUB inválido" }, 400);
  }

  // Verificar cuota acumulada del usuario
  const quota = await checkUserBooksQuota(c.env, user.id, bookId, buffer.byteLength);
  if (!quota.allowed) {
    return c.json({ error: quota.reason ?? "Storage quota exceeded for this account" }, 413);
  }

  const r2Key = `user-books/${user.id}/${bookId}.epub`;
  await booksBucket.put(r2Key, buffer, {
    httpMetadata: { contentType: "application/epub+zip" },
    customMetadata: { userId: user.id, bookId, title, author },
  });

  const now = Date.now();
  try {
    await recordUserBook(c.env, {
      userId: user.id,
      bookId,
      title,
      author,
      language,
      r2Key,
      sizeBytes: buffer.byteLength,
      sha256,
      resetAck: readResetAck(c),
    });
  } catch (err) {
    if (err instanceof StaleResetError) {
      await booksBucket.delete(r2Key).catch(() => undefined);
      return resetBlockedResponse(c, err.resetAt);
    }
    throw err;
  }

  return c.json({ ok: true, bookId, sizeBytes: buffer.byteLength, updatedAt: now });
});

userBooks.get("/api/user/books", async (c) => {
  const user = await getSessionUser(c);
  if (!user) return c.json({ books: [] });

  // Defensa del modelo A1: las entradas paper_only no son libros
  // descargables — su «archivo» es la guía (r2_key = guides/…). Si
  // salieran en esta lista, un sync que bajara lo que falta guardaría
  // el JSON de la guía como EPUB local.
  const flags = await listUserBookFlags(c.env, user.id).catch(
    () => new Map<string, BookFlags>(),
  );
  const notPaper = (id: unknown) => !flags.get(String(id))?.paperOnly;

  if (getConnectionString(c.env)) {
    const rows = await withClient(c.env, async (client) => {
      const res = await client.query<{
        id: string;
        title: string;
        author: string;
        sizebytes: number | string;
        sha256: string;
        updatedat: number | string;
      }>(
        // 027: sin archivo no hay nada que bajar; sin la columna se
        // reintenta con la consulta anterior.
        `SELECT book_id AS id, title, author, size_bytes AS sizebytes, sha256, updated_at AS updatedat
         FROM user_books WHERE user_id = $1 AND has_file = true ORDER BY updated_at DESC`,
        [user.id],
      ).catch((err: unknown) =>
        isMissingColumnError(err)
          ? client.query<{
              id: string;
              title: string;
              author: string;
              sizebytes: number | string;
              sha256: string;
              updatedat: number | string;
            }>(
              `SELECT book_id AS id, title, author, size_bytes AS sizebytes, sha256, updated_at AS updatedat
               FROM user_books WHERE user_id = $1 ORDER BY updated_at DESC`,
              [user.id],
            )
          : Promise.reject(err),
      );
      return res.rows.map((r) => ({
        id: r.id,
        title: r.title,
        author: r.author,
        sizeBytes: Number(r.sizebytes),
        sha256: r.sha256,
        updatedAt: Number(r.updatedat),
      }));
    });
    if (rows) return c.json({ books: rows.filter((b) => notPaper(b.id)) });
  }


  return c.json({ books: [] });
});

userBooks.get("/api/user/books/:bookId/file", requireLectaPlus, async (c) => {
  const user = c.get("session")?.user ?? null;
  if (!user) return c.json({ error: "No autenticado" }, 401);

  const booksBucket = c.env.BOOKS;
  if (!booksBucket) {
    return c.json({ error: "Almacenamiento no configurado" }, 503);
  }

  const bookId = c.req.param("bookId");

  // Misma defensa A1 que /api/books/:hash — una entrada paper_only no
  // tiene EPUB; su r2_key apunta a la guía y servirla aquí la haría
  // pasar por libro descargable.
  const fileFlags = await listUserBookFlags(c.env, user.id).catch(
    () => new Map<string, BookFlags>(),
  );
  if (fileFlags.get(bookId)?.paperOnly)
    return c.json(
      { error: "Esta entrada es una guía de papel, no un libro descargable." },
      403,
    );

  let r2Key: string | null = null;

  if (getConnectionString(c.env)) {
    const res = await withClient(c.env, (client) =>
      client.query<{ r2_key: string }>(
        `SELECT r2_key FROM user_books WHERE user_id = $1 AND book_id = $2`,
        [user.id, bookId],
      ),
    );
    r2Key = res?.rows[0]?.r2_key ?? null;
  }

  const keysToTry = [
    r2Key,
    `user-books/${user.id}/${bookId}.epub`,
    `books/${user.id}/${bookId}.epub`,
  ].filter(Boolean) as string[];

  for (const key of keysToTry) {
    const obj = await booksBucket.get(key);
    if (obj) {
      return new Response(obj.body, {
        headers: {
          "Content-Type": "application/epub+zip",
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }

  return c.json({ error: "Libro no encontrado en la nube" }, 404);
});
