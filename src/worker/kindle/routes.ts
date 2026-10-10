// Rutas del portal Kindle y dispositivos E-ink para Lecta.
// Servidas íntegramente con HTML/CSS ligero generado en el Cloudflare Worker.

import { Hono } from "hono";
import { getConnectionString, withClient, type WorkerEnv } from "../db";
import { getSession } from "../session";
import { createAuth } from "../auth";
import { findEntries } from "../lexicon";
import { getEpubChapter, getEpubResource } from "./epub-reader";
import {
  renderHomeView,
  renderLoginView,
  renderReaderView,
  renderLookupView,
  type KindleBookItem,
  type KindleUser,
} from "./views";

export const kindleRoutes = new Hono<{ Bindings: WorkerEnv }>();

// 1. Estantería principal
kindleRoutes.get("/", async (c) => {
  const session = await getSession(c);
  const user: KindleUser | null = session?.user
    ? { id: session.user.id, email: session.user.email, name: session.user.name }
    : null;

  if (!user || !c.env.BOOKS) {
    return c.html(renderHomeView({ user: null, books: [] }));
  }

  // Listar libros del usuario en R2
  const listed = await c.env.BOOKS.list({ prefix: `books/${user.id}/` }).catch(() => null);
  const objects = listed?.objects ?? [];

  // Obtener posiciones guardadas para mostrar el progreso
  const positionRows = await withClient(c.env, (client) =>
    client
      .query(
        `SELECT book_hash AS "bookHash", section_index AS "sectionIndex", progress
         FROM lecta_user_positions WHERE user_id = $1`,
        [user.id],
      )
      .then((res) => res.rows)
      .catch(() => []),
  );

  const positionMap = new Map<string, { sectionIndex: number; progress: number }>();
  if (Array.isArray(positionRows)) {
    for (const row of positionRows) {
      positionMap.set(row.bookHash, {
        sectionIndex: Number(row.sectionIndex) || 0,
        progress: row.progress != null ? Number(row.progress) : 0,
      });
    }
  }

  const books: KindleBookItem[] = objects.map((obj) => {
    const hash = obj.key.split("/").pop()?.replace(/\.epub$/, "") ?? "";
    const title = obj.customMetadata?.title || obj.customMetadata?.name || "Libro sin título";
    const author = obj.customMetadata?.author || "Autor desconocido";
    const sections = Number(obj.customMetadata?.sections) || 0;
    const pos = positionMap.get(hash);

    return {
      hash,
      title,
      author,
      sections,
      currentSection: pos ? pos.sectionIndex : null,
      progressPercent: pos ? pos.progress : null,
    };
  });

  return c.html(renderHomeView({ user, books }));
});

// 2. Iniciar sesión - Formulario
kindleRoutes.get("/login", async (c) => {
  const session = await getSession(c);
  if (session?.user) {
    return c.redirect("/k");
  }
  const returnTo = c.req.query("returnTo") || "/k";
  const email = c.req.query("email") || "";
  return c.html(renderLoginView({ user: null, email, returnTo }));
});

// 2. Iniciar sesión - Procesar credenciales con Better Auth
kindleRoutes.post("/login", async (c) => {
  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const returnTo = typeof body.returnTo === "string" && body.returnTo.startsWith("/k")
    ? body.returnTo
    : "/k";

  if (!email || !password) {
    return c.html(
      renderLoginView({
        user: null,
        error: "Introduce tu correo y contraseña.",
        email,
        returnTo,
      }),
      400,
    );
  }

  if (!getConnectionString(c.env)) {
    return c.html(
      renderLoginView({
        user: null,
        error: "El servicio de autenticación no está disponible.",
        email,
        returnTo,
      }),
      503,
    );
  }

  const baseURL = c.env.BETTER_AUTH_URL ?? new URL(c.req.url).origin;
  const authReq = new Request(new URL("/api/auth/sign-in/email", baseURL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      origin: new URL(baseURL).origin,
    },
    body: JSON.stringify({ email, password }),
  });

  let authRes: Response;
  try {
    authRes = await createAuth(c.env, baseURL).handler(authReq);
  } catch {
    return c.html(
      renderLoginView({
        user: null,
        error: "Error al comunicarse con el servidor de acceso.",
        email,
        returnTo,
      }),
      500,
    );
  }

  if (!authRes.ok) {
    return c.html(
      renderLoginView({
        user: null,
        error: "Correo electrónico o contraseña incorrectos.",
        email,
        returnTo,
      }),
      401,
    );
  }

  // Extraer las cookies establecidas por Better Auth y redirigir
  const headers = new Headers();
  const rawCookies = authRes.headers.getSetCookie
    ? authRes.headers.getSetCookie()
    : [authRes.headers.get("set-cookie")].filter((x): x is string => Boolean(x));

  for (const cookie of rawCookies) {
    headers.append("Set-Cookie", cookie);
  }
  headers.set("Location", returnTo);

  return new Response(null, { status: 302, headers });
});

// 3. Cerrar sesión
kindleRoutes.get("/logout", async (c) => {
  const baseURL = c.env.BETTER_AUTH_URL ?? new URL(c.req.url).origin;
  const authReq = new Request(new URL("/api/auth/sign-out", baseURL), {
    method: "POST",
    headers: c.req.raw.headers,
  });

  const authRes = await createAuth(c.env, baseURL).handler(authReq).catch(() => null);
  const headers = new Headers();

  if (authRes) {
    const rawCookies = authRes.headers.getSetCookie
      ? authRes.headers.getSetCookie()
      : [authRes.headers.get("set-cookie")].filter((x): x is string => Boolean(x));
    for (const cookie of rawCookies) {
      headers.append("Set-Cookie", cookie);
    }
  }

  // Eliminar explícitamente la cookie por seguridad
  headers.append(
    "Set-Cookie",
    "better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
  );
  headers.set("Location", "/k");

  return new Response(null, { status: 302, headers });
});

// 4. Lector de capítulos
kindleRoutes.get("/read/:hash", async (c) => {
  const session = await getSession(c);
  const hash = c.req.param("hash");

  if (!session?.user) {
    return c.redirect(`/k/login?returnTo=${encodeURIComponent(c.req.url)}`);
  }

  if (!c.env.BOOKS) {
    return c.html("<h1>Error</h1><p>El almacenamiento no está configurado.</p>", 503);
  }

  const user = { id: session.user.id, email: session.user.email, name: session.user.name };
  const requestedSection = c.req.query("section");

  // Si no se especifica la sección en la URL, cargar la última posición guardada
  if (requestedSection === undefined) {
    const lastPos = await withClient(c.env, (client) =>
      client
        .query(
          `SELECT section_index AS "sectionIndex" FROM lecta_user_positions
           WHERE user_id = $1 AND book_hash = $2`,
          [user.id, hash],
        )
        .then((res) => res.rows[0])
        .catch(() => null),
    );

    const targetSection = lastPos ? Number(lastPos.sectionIndex) || 0 : 0;
    return c.redirect(`/k/read/${encodeURIComponent(hash)}?section=${targetSection}`);
  }

  const sectionIndex = Math.max(0, parseInt(requestedSection, 10) || 0);

  // Descargar el EPUB de R2
  const key = `books/${user.id}/${hash}.epub`;
  const r2Obj = await c.env.BOOKS.get(key);
  if (!r2Obj) {
    return c.html(
      `<h1>Libro no encontrado</h1><p>No se encontró este libro en tu cuenta.</p><p><a href="/k">Volver a la biblioteca</a></p>`,
      404,
    );
  }

  const data = new Uint8Array(await r2Obj.arrayBuffer());
  const chapter = await getEpubChapter(data, sectionIndex, hash);
  if (!chapter) {
    return c.html(
      `<h1>Error de lectura</h1><p>No se pudo procesar el contenido de este libro.</p><p><a href="/k">Volver a la biblioteca</a></p>`,
      500,
    );
  }

  // Guardar la posición de lectura actualizada en la base de datos de forma sincronizada
  const progress = chapter.totalSections > 1
    ? Math.min(1, Math.max(0, chapter.sectionIndex / (chapter.totalSections - 1)))
    : 1;

  const now = Date.now();
  const savePositionPromise = withClient(c.env, (client) =>
    client.query(
      `INSERT INTO lecta_user_positions
         (user_id, book_hash, section_index, scroll_top, ratio, progress, updated_at)
       VALUES ($1, $2, $3, 0, 0, $4, $5)
       ON CONFLICT (user_id, book_hash) DO UPDATE SET
         section_index = excluded.section_index,
         progress = excluded.progress,
         updated_at = excluded.updated_at
       WHERE lecta_user_positions.updated_at < excluded.updated_at`,
      [user.id, hash, chapter.sectionIndex, progress, now],
    ),
  ).catch(() => null);

  try {
    c.executionCtx.waitUntil(savePositionPromise);
  } catch {
    await savePositionPromise;
  }

  return c.html(
    renderReaderView({
      user,
      bookHash: hash,
      bookTitle: chapter.bookTitle,
      bookAuthor: chapter.bookAuthor,
      chapterTitle: chapter.chapterTitle,
      contentHtml: chapter.contentHtml,
      sectionIndex: chapter.sectionIndex,
      totalSections: chapter.totalSections,
    }),
  );
});

// 5. Servidor de recursos e imágenes del EPUB
kindleRoutes.get("/read/:hash/resource", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.text("No autorizado", 401);
  }

  const hash = c.req.param("hash");
  const resourcePath = c.req.query("path");
  if (!resourcePath) {
    return c.text("Ruta de recurso faltante", 400);
  }

  if (!c.env.BOOKS) {
    return c.text("Almacenamiento no configurado", 503);
  }

  const key = `books/${session.user.id}/${hash}.epub`;
  const r2Obj = await c.env.BOOKS.get(key);
  if (!r2Obj) {
    return c.text("Libro no encontrado", 404);
  }

  const data = new Uint8Array(await r2Obj.arrayBuffer());
  const resource = await getEpubResource(data, resourcePath);
  if (!resource) {
    return c.text("Recurso no encontrado en el EPUB", 404);
  }

  return new Response(resource.data as unknown as BodyInit, {
    headers: {
      "Content-Type": resource.mimeType,
      "Cache-Control": "public, max-age=86400",
    },
  });
});

// 6. Diccionario y consulta de definiciones
kindleRoutes.get("/lookup", async (c) => {
  const session = await getSession(c);
  const user = session?.user
    ? { id: session.user.id, email: session.user.email, name: session.user.name }
    : null;

  const query = c.req.query("q")?.trim() || "";
  const saved = c.req.query("saved") === "1";
  const returnTo = c.req.query("returnTo") || "/k";
  const bookHash = c.req.query("bookHash") || "";

  let entries: import("../lexicon").LexiconEntryView[] | null = null;
  if (query) {
    try {
      entries = (await withClient(c.env, (client) =>
        findEntries(client, "es", query.toLowerCase()),
      )) ?? [];
    } catch {
      entries = [];
    }
  }

  return c.html(
    renderLookupView({
      user,
      query,
      entries,
      saved,
      returnTo,
      bookHash,
    }),
  );
});

// 7. Guardar palabra en el Cuaderno
kindleRoutes.post("/vocab/add", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.redirect("/k/login");
  }

  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const form = typeof body.form === "string" ? body.form.trim() : "";
  const lemma = typeof body.lemma === "string" ? body.lemma.trim() : form;
  const pos = typeof body.pos === "string" ? body.pos.trim() : null;
  const meaning = typeof body.meaning === "string" ? body.meaning.trim() : null;
  const bookHash = typeof body.bookHash === "string" ? body.bookHash.trim() : null;
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : "/k";

  if (!form) {
    return c.redirect(returnTo);
  }

  const now = Date.now();
  await withClient(c.env, async (client) => {
    await client.query(
      `INSERT INTO lecta_user_words
         (user_id, language, form, lemma, pos, meaning, context, book_hash, saved_at, updated_at, deleted)
       VALUES ($1, 'es', $2, $3, $4, $5, NULL, $6, $7, $7, false)
       ON CONFLICT (user_id, language, form) DO UPDATE SET
         lemma = excluded.lemma,
         pos = excluded.pos,
         meaning = excluded.meaning,
         book_hash = COALESCE(excluded.book_hash, lecta_user_words.book_hash),
         updated_at = excluded.updated_at,
         deleted = false`,
      [session.user.id, form, lemma, pos, meaning, bookHash, now],
    );
  }).catch(() => null);

  const redirectUrl = `/k/lookup?q=${encodeURIComponent(form)}&saved=1&returnTo=${encodeURIComponent(returnTo)}&bookHash=${encodeURIComponent(bookHash || "")}`;
  return c.redirect(redirectUrl);
});
