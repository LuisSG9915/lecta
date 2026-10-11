// Rutas del portal Kindle y dispositivos E-ink para Lecta.
// Servidas íntegramente con HTML/CSS ligero generado en el Cloudflare Worker.

import { Hono } from "hono";
import { getConnectionString, withClient, type WorkerEnv } from "../db";
import { getSession } from "../session";
import { createAuth } from "../auth";
import { findEntries, findEntriesForForms } from "../lexicon";
import {
  extractChapterPrepCandidates,
  extractPageWords,
  findSentenceWithWord,
  getEpubChapter,
  getEpubResource,
  paginateChapter,
  parseEpub,
  stripHtml,
  wrapWordsWithLinks,
} from "./epub-reader";
import {
  renderChapterPrepView,
  renderHomeView,
  renderLoginView,
  renderReaderView,
  renderLookupView,
  type KindleBookItem,
  type KindleUser,
  type PageWordItem,
  type PrepWordItem,
  type InlineLookupResult,
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
        `SELECT book_hash AS "bookHash", section_index AS "sectionIndex", scroll_top AS "scrollTop", progress
         FROM lecta_user_positions WHERE user_id = $1`,
        [user.id],
      )
      .then((res) => res.rows)
      .catch(() => []),
  );

  const positionMap = new Map<string, { sectionIndex: number; pageIndex: number; progress: number }>();
  if (Array.isArray(positionRows)) {
    for (const row of positionRows) {
      positionMap.set(row.bookHash, {
        sectionIndex: Number(row.sectionIndex) || 0,
        pageIndex: Number(row.scrollTop) || 0,
        progress: row.progress != null ? Number(row.progress) : 0,
      });
    }
  }

  const books: KindleBookItem[] = await Promise.all(
    objects.map(async (obj) => {
      const hash = obj.key.split("/").pop()?.replace(/\.epub$/, "") ?? "";
      let title = obj.customMetadata?.title || "";
      let author = obj.customMetadata?.author || "";
      let sections = Number(obj.customMetadata?.sections) || 0;

      // Si el libro remoto no tiene título o autor guardado en los metadatos de R2,
      // lo extraemos directamente del archivo EPUB para que se muestre correctamente.
      if (!title || !author || !sections) {
        try {
          const r2Obj = await c.env.BOOKS!.get(obj.key);
          if (r2Obj) {
            const data = new Uint8Array(await r2Obj.arrayBuffer());
            const parsed = await parseEpub(data);
            if (parsed) {
              title = title || parsed.title;
              author = author || parsed.author;
              sections = sections || parsed.spine.length;

              // Actualiza los metadatos en R2 para que las siguientes peticiones sean inmediatas
              const saveMetaPromise = c.env.BOOKS!.put(obj.key, data, {
                httpMetadata: { contentType: "application/epub+zip" },
                customMetadata: {
                  name: obj.customMetadata?.name || `${title}.epub`,
                  title,
                  author,
                  sections: String(sections),
                },
              }).catch(() => null);

              try {
                c.executionCtx.waitUntil(saveMetaPromise);
              } catch {
                void saveMetaPromise;
              }
            }
          }
        } catch {
          // Ignorar fallos de lectura
        }
      }

      if (!title) {
        title = obj.customMetadata?.name?.replace(/\.epub$/i, "") || "Libro sin título";
      }
      if (!author) {
        author = "Autor desconocido";
      }

      const pos = positionMap.get(hash);

      return {
        hash,
        title,
        author,
        sections,
        currentSection: pos ? pos.sectionIndex : null,
        currentPage: pos ? pos.pageIndex : null,
        progressPercent: pos ? pos.progress : null,
      };
    }),
  );

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
  const requestedPage = c.req.query("page");
  const savedWord = c.req.query("savedWord");
  const markedKnown = c.req.query("markedKnown");
  const lookupWord = c.req.query("lookup")?.trim() || "";
  const isPrep = c.req.query("prep") === "1";

  // Si no se especifica la sección en la URL, cargar la última posición guardada (sección y página)
  if (requestedSection === undefined) {
    const lastPos = await withClient(c.env, (client) =>
      client
        .query(
          `SELECT section_index AS "sectionIndex", scroll_top AS "scrollTop" FROM lecta_user_positions
           WHERE user_id = $1 AND book_hash = $2`,
          [user.id, hash],
        )
        .then((res) => res.rows[0])
        .catch(() => null),
    );

    const targetSection = lastPos ? Number(lastPos.sectionIndex) || 0 : 0;
    const targetPage = lastPos && lastPos.scrollTop != null ? Math.max(0, Number(lastPos.scrollTop) || 0) : 0;
    return c.redirect(`/k/read/${encodeURIComponent(hash)}?section=${targetSection}&page=${targetPage}`);
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

  // Vista de preparación previa al capítulo («Antes de leer»)
  if (isPrep) {
    const cleanText = stripHtml(chapter.contentHtml);
    const candidateForms = extractChapterPrepCandidates(chapter.contentHtml, "es");

    const queryRes = await withClient(c.env, (client) =>
      Promise.all([
        client
          .query(
            `SELECT LOWER(lemma) AS lemma FROM lecta_user_knowledge
             WHERE user_id = $1 AND language = 'es' AND known = true AND deleted = false`,
            [user.id],
          )
          .then((res) => res.rows)
          .catch(() => []),
        client
          .query(
            `SELECT LOWER(form) AS form FROM lecta_user_words
             WHERE user_id = $1 AND deleted = false`,
            [user.id],
          )
          .then((res) => res.rows)
          .catch(() => []),
      ]),
    );

    const knownRows = queryRes ? queryRes[0] : [];
    const savedRows = queryRes ? queryRes[1] : [];

    const knownSet = new Set<string>();
    for (const row of knownRows) {
      if (row.lemma) knownSet.add(row.lemma);
    }
    const savedSet = new Set<string>();
    for (const row of savedRows) {
      if (row.form) savedSet.add(row.form);
    }

    const filteredCandidates = candidateForms.filter((f) => !knownSet.has(f));

    const entriesMap: Record<string, import("../lexicon").LexiconEntryView[]> =
      filteredCandidates.length > 0
        ? ((await withClient(c.env, (client) =>
            findEntriesForForms(client, "es", filteredCandidates.slice(0, 150)),
          ).catch(() => ({}))) ?? {})
        : {};

    const prepItems: PrepWordItem[] = [];
    const seenLemmas = new Set<string>();

    for (const form of filteredCandidates) {
      const entries = entriesMap[form];
      if (!entries || entries.length === 0) continue;
      const entry = entries[0];
      const lemmaLower = (entry.lemma || form).toLowerCase();
      if (knownSet.has(lemmaLower)) continue;
      if (seenLemmas.has(lemmaLower)) continue;

      const firstMeaning = entry.senses && entry.senses.length > 0
        ? entry.senses[0].definition?.trim()
        : null;
      if (!firstMeaning) continue;

      seenLemmas.add(lemmaLower);
      const isSaved = savedSet.has(form) || savedSet.has(lemmaLower);
      const example = findSentenceWithWord(cleanText, form);

      prepItems.push({
        form,
        lemma: entry.lemma || form,
        pos: entry.pos || null,
        meaning: firstMeaning,
        exampleSentence: example,
        saved: isSaved,
        zipf: entry.zipf,
      });
    }

    // Ordenar: primero las que ya tiene guardadas en Cuaderno, luego por rareza (zipf menor primero)
    prepItems.sort((a, b) => {
      if (a.saved && !b.saved) return -1;
      if (!a.saved && b.saved) return 1;
      const zipfA = a.zipf ?? 999;
      const zipfB = b.zipf ?? 999;
      return zipfA - zipfB;
    });

    const topWords = prepItems.slice(0, 7);

    let savedNotice: string | null = null;
    if (savedWord) {
      savedNotice = `✓ Palabra «${savedWord}» guardada en tu Cuaderno.`;
    } else if (markedKnown) {
      savedNotice = `✓ Palabra «${markedKnown}» marcada como conocida.`;
    }

    const nextUrl = `/k/read/${encodeURIComponent(hash)}?section=${chapter.sectionIndex}&page=0`;
    const prevUrl = chapter.sectionIndex > 0
      ? `/k/read/${encodeURIComponent(hash)}?section=${chapter.sectionIndex - 1}&page=last`
      : `/k`;

    return c.html(
      renderChapterPrepView({
        user,
        bookHash: hash,
        bookTitle: chapter.bookTitle,
        bookAuthor: chapter.bookAuthor,
        chapterTitle: chapter.chapterTitle,
        sectionIndex: chapter.sectionIndex,
        totalSections: chapter.totalSections,
        words: topWords,
        savedNotice,
        nextUrl,
        prevUrl,
      }),
    );
  }

  // Paginación del capítulo en pantallas discretas
  const pages = paginateChapter(chapter.contentHtml);
  const totalPages = pages.length;

  let pageIndex = 0;
  if (requestedPage === "last") {
    pageIndex = Math.max(0, totalPages - 1);
  } else if (requestedPage !== undefined) {
    pageIndex = Math.min(Math.max(0, parseInt(requestedPage, 10) || 0), totalPages - 1);
  }

  const rawPageHtml = pages[pageIndex] || "<p>Sin contenido.</p>";

  // Obtener palabras guardadas por el usuario en su Cuaderno para resaltarlas
  const savedWordsRows = await withClient(c.env, (client) =>
    client
      .query(
        `SELECT LOWER(form) AS form FROM lecta_user_words
         WHERE user_id = $1 AND deleted = false`,
        [user.id],
      )
      .then((res) => res.rows)
      .catch(() => []),
  );
  const savedWordsSet = new Set<string>();
  if (Array.isArray(savedWordsRows)) {
    for (const row of savedWordsRows) {
      if (row.form) savedWordsSet.add(row.form);
    }
  }

  const currentUrl = `/k/read/${encodeURIComponent(hash)}?section=${chapter.sectionIndex}&page=${pageIndex}`;

  // Extraer palabras candidatas de esta página para el bloque de vocabulario
  const candidateWords = extractPageWords(rawPageHtml);
  const pageWords: PageWordItem[] = candidateWords.map((form) => ({
    form,
    saved: savedWordsSet.has(form.toLowerCase()),
  }));

  // Enlazar cada palabra en el texto para permitir consulta con un toque
  const interactivePageHtml = wrapWordsWithLinks(
    rawPageHtml,
    hash,
    currentUrl,
    savedWordsSet,
  );

  // Consulta de definición en línea si se pulsó una palabra
  let lookupResult: InlineLookupResult | null = null;
  if (lookupWord) {
    try {
      const entries = await withClient(c.env, (client) =>
        findEntries(client, "es", lookupWord.toLowerCase()),
      );
      lookupResult = {
        word: lookupWord,
        entries: entries || [],
      };
    } catch {
      lookupResult = {
        word: lookupWord,
        entries: [],
      };
    }
  }

  // Guardar la posición de lectura actualizada (sección y página) en la base de datos
  const pageRatio = totalPages > 1 ? pageIndex / (totalPages - 1) : 0;
  const progress = chapter.totalSections > 1
    ? Math.min(1, Math.max(0, (chapter.sectionIndex + pageRatio) / (chapter.totalSections - 1)))
    : pageRatio;

  const now = Date.now();
  const savePositionPromise = withClient(c.env, (client) =>
    client.query(
      `INSERT INTO lecta_user_positions
         (user_id, book_hash, section_index, scroll_top, ratio, progress, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, book_hash) DO UPDATE SET
         section_index = excluded.section_index,
         scroll_top = excluded.scroll_top,
         ratio = excluded.ratio,
         progress = excluded.progress,
         updated_at = excluded.updated_at
       WHERE lecta_user_positions.updated_at <= excluded.updated_at`,
      [user.id, hash, chapter.sectionIndex, pageIndex, pageRatio, progress, now],
    ),
  ).catch(() => null);

  try {
    c.executionCtx.waitUntil(savePositionPromise);
  } catch {
    await savePositionPromise;
  }

  const savedNotice = savedWord ? `✓ Palabra «${savedWord}» guardada en tu Cuaderno.` : null;

  return c.html(
    renderReaderView({
      user,
      bookHash: hash,
      bookTitle: chapter.bookTitle,
      bookAuthor: chapter.bookAuthor,
      chapterTitle: chapter.chapterTitle,
      contentHtml: interactivePageHtml,
      sectionIndex: chapter.sectionIndex,
      totalSections: chapter.totalSections,
      pageIndex,
      totalPages,
      pageWords,
      savedNotice,
      lookupResult,
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
  let lemma = typeof body.lemma === "string" ? body.lemma.trim() : form;
  let pos = typeof body.pos === "string" ? body.pos.trim() : null;
  let meaning = typeof body.meaning === "string" ? body.meaning.trim() : null;
  const bookHash = typeof body.bookHash === "string" ? body.bookHash.trim() : null;
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : "/k";

  if (!form) {
    return c.redirect(returnTo);
  }

  // Si no se proporcionó significado, buscarlo en el catálogo léxico
  if (!meaning) {
    try {
      const entries = await withClient(c.env, (client) =>
        findEntries(client, "es", form.toLowerCase()),
      );
      if (entries && entries.length > 0) {
        lemma = entries[0].lemma || lemma;
        pos = entries[0].pos || pos;
        meaning = entries[0].senses[0]?.definition || null;
      }
    } catch {
      // Ignorar fallo de búsqueda
    }
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

  // Si la petición vino del lector directamente, volver al lector con aviso de confirmación
  if (returnTo.includes("/k/read/")) {
    const separator = returnTo.includes("?") ? "&" : "?";
    return c.redirect(`${returnTo}${separator}savedWord=${encodeURIComponent(form)}`);
  }

  const redirectUrl = `/k/lookup?q=${encodeURIComponent(form)}&saved=1&returnTo=${encodeURIComponent(returnTo)}&bookHash=${encodeURIComponent(bookHash || "")}`;
  return c.redirect(redirectUrl);
});

// 8. Marcar palabra como conocida o desconocida en la preparación
kindleRoutes.post("/knowledge/mark", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.redirect("/k/login");
  }

  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const lemma = typeof body.lemma === "string" ? body.lemma.trim().toLowerCase() : "";
  const known = body.known === "1" || body.known === "true";
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : "/k";

  if (lemma) {
    const now = Date.now();
    await withClient(c.env, (client) =>
      client.query(
        `INSERT INTO lecta_user_knowledge
           (user_id, language, lemma, known, source, updated_at, deleted)
         VALUES ($1, 'es', $2, $3, 'kindle_prep', $4, false)
         ON CONFLICT (user_id, language, lemma) DO UPDATE SET
           known = excluded.known,
           source = excluded.source,
           updated_at = excluded.updated_at,
           deleted = false`,
        [session.user.id, lemma, known, now],
      ),
    ).catch(() => null);
  }

  const separator = returnTo.includes("?") ? "&" : "?";
  return c.redirect(`${returnTo}${separator}markedKnown=${encodeURIComponent(lemma)}`);
});

