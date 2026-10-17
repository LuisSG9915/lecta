// Rutas del portal Kindle y dispositivos E-ink para Lecta.
// Servidas íntegramente con HTML/CSS ligero generado en el Cloudflare Worker.

import { Hono } from "hono";
import { getConnectionString, withClient, type WorkerEnv } from "../db";
import { getSession } from "../session";
import { createAuth } from "../auth";
import { findEntries, findEntriesForForms, type LexiconEntryView } from "../lexicon";
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card } from "ts-fsrs";
import {
  extractChapterPrepCandidates,
  extractPageWords,
  findSentenceWithWord,
  formatChapterHtmlForMode,
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
  renderKindleLinkView,
  renderLoginView,
  renderReaderView,
  renderLookupView,
  renderPracticeView,
  type KindleBookItem,
  type KindleUser,
  type PageWordItem,
  type PrepWordItem,
  type InlineLookupResult,
  type CatPageNoteItem,
} from "./views";

export interface KindleLinkRecord {
  code: string;
  status: "pending" | "linked" | "expired";
  createdAt: number;
  userToken?: string;
  userId?: string;
  redirectUrl?: string;
}

export const kindleLinkCodes = new Map<string, KindleLinkRecord>();

export function cleanExpiredKindleCodes() {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [code, rec] of kindleLinkCodes.entries()) {
    if (rec.createdAt < cutoff) {
      kindleLinkCodes.delete(code);
    }
  }
}

export async function handleKindleLinkPage(c: any) {
  cleanExpiredKindleCodes();
  const session = await getSession(c);
  if (session?.user) {
    return c.redirect("/k");
  }

  // Generar código temporal de 4 letras al entrar a /kindle desde el e-reader
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Sin O/0 ni I/1 para evitar confusiones
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const record: KindleLinkRecord = {
    code,
    status: "pending",
    createdAt: Date.now(),
  };
  kindleLinkCodes.set(code, record);

  const db = (c.env as any)?.DB;
  if (db?.prepare) {
    try {
      await db.prepare(
        `INSERT INTO kindle_link_codes (code, status, created_at, expires_at) VALUES (?, 'pending', unixepoch(), unixepoch() + 600)`
      ).bind(code).run();
    } catch {}
  }

  return c.html(renderKindleLinkView({ code, user: null }));
}

export async function handleKindleLinkAction(c: any) {
  cleanExpiredKindleCodes();
  const body = await c.req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  let userSessionToken = typeof body?.userSessionToken === "string" ? body.userSessionToken.trim() : "";

  const session = await getSession(c);
  if (!userSessionToken && session?.session?.token) {
    userSessionToken = session.session.token;
  }
  if (!userSessionToken) {
    const cookieHeader = c.req.header("cookie") || "";
    const match = cookieHeader.match(/(?:better-auth\.session_token|__Secure-better-auth\.session_token)=([^;]+)/);
    if (match) userSessionToken = match[1];
  }

  let record = kindleLinkCodes.get(code);
  const db = (c.env as any)?.DB;
  if (!record && db?.prepare) {
    try {
      const d1Record = await db.prepare(
        `SELECT * FROM kindle_link_codes WHERE code = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > unixepoch())`
      ).bind(code).first();
      if (d1Record) {
        record = {
          code,
          status: "pending",
          createdAt: Number(d1Record.created_at) * 1000 || Date.now(),
        };
      }
    } catch {}
  }

  if (!record || record.status !== "pending") {
    return c.json({ error: "Código inválido o expirado" }, 400);
  }

  // Redirigir a la página exacta del libro actual si el usuario tiene posición previa
  let redirectUrl = "/k";
  if (session?.user?.id) {
    try {
      const pos = await withClient(c.env, (client) =>
        client.query(
          `SELECT book_hash AS "bookHash" FROM lecta_user_positions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
          [session.user.id],
        ).then((res) => res.rows[0]),
      );
      if (pos?.bookHash) {
        redirectUrl = `/k/read/${pos.bookHash}`;
      }
    } catch {}
  }

  record.status = "linked";
  record.userToken = userSessionToken;
  record.userId = session?.user?.id;
  record.redirectUrl = redirectUrl;
  kindleLinkCodes.set(code, record);

  if (db?.prepare) {
    try {
      await db.prepare(
        `UPDATE kindle_link_codes SET status = 'linked', user_id = ?, session_token = ? WHERE code = ?`
      ).bind(session?.user?.id ?? null, userSessionToken, code).run();
    } catch {}
  }

  return c.json({ success: true, redirectUrl });
}

export async function handleKindleStatus(c: any) {
  cleanExpiredKindleCodes();
  const code = (c.req.query("code") || "").trim().toUpperCase();
  if (!code) {
    return c.json({ error: "Código no proporcionado" }, 400);
  }

  let record = kindleLinkCodes.get(code);
  const db = (c.env as any)?.DB;
  if (db?.prepare) {
    try {
      const d1Record = await db.prepare(
        `SELECT * FROM kindle_link_codes WHERE code = ?`
      ).bind(code).first();
      if (d1Record) {
        record = {
          code,
          status: (d1Record.status as any) || record?.status || "pending",
          createdAt: Number(d1Record.created_at) * 1000 || (record?.createdAt ?? Date.now()),
          userToken: d1Record.session_token || d1Record.user_token || record?.userToken,
          userId: d1Record.user_id || record?.userId,
          redirectUrl: record?.redirectUrl,
        };
        kindleLinkCodes.set(code, record);
      }
    } catch {}
  }

  if (!record) {
    return c.json({ error: "Código no encontrado" }, 404);
  }

  if (record.status === "linked") {
    if (record.userToken) {
      c.header(
        "Set-Cookie",
        `better-auth.session_token=${encodeURIComponent(record.userToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
      );
    }
    return c.json({ linked: true, redirectUrl: record.redirectUrl || "/k" });
  }

  return c.json({ linked: false, status: record.status });
}

export const kindleRoutes = new Hono<{ Bindings: WorkerEnv }>();

kindleRoutes.get("/kindle", handleKindleLinkPage);
kindleRoutes.get("/link", handleKindleLinkPage);
kindleRoutes.get("/api/kindle/status", handleKindleStatus);
kindleRoutes.post("/api/kindle/link", handleKindleLinkAction);

// Cabeceras anti-caché para todas las vistas HTML del Kindle:
// garantiza que al refrescar en el Kindle siempre se vean los últimos cambios.
kindleRoutes.use("*", async (c, next) => {
  await next();
  const contentType = c.res.headers.get("content-type");
  if (contentType?.includes("text/html")) {
    c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    c.res.headers.set("Pragma", "no-cache");
    c.res.headers.set("Expires", "0");
  }
});

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
  const rawMode = c.req.query("mode");
  const rawSize = c.req.query("size");
  const rawGloss = c.req.query("gloss");
  const mode = (rawMode as "clean" | "paragraphs" | "lexicon") || "clean";
  const size = (rawSize as "sm" | "md" | "lg" | "xl") || "md";
  const gloss = rawGloss !== "0";
  const querySuffix = `${rawMode ? `&mode=${encodeURIComponent(rawMode)}` : ""}${rawSize ? `&size=${encodeURIComponent(rawSize)}` : ""}${rawGloss !== undefined ? `&gloss=${encodeURIComponent(rawGloss)}` : ""}`;
  const renderQuerySuffix = `&mode=${encodeURIComponent(mode)}&size=${encodeURIComponent(size)}&gloss=${gloss ? "1" : "0"}`;

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
    return c.redirect(`/k/read/${encodeURIComponent(hash)}?section=${targetSection}&page=${targetPage}${querySuffix}`);
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

  // Obtener palabras guardadas y conocimiento del usuario
  const [savedWordsRows, knownWordsRows] = (await withClient(c.env, (client) =>
    Promise.all([
      client
        .query<{ form: string }>(
          `SELECT LOWER(form) AS form FROM lecta_user_words
           WHERE user_id = $1 AND deleted = false`,
          [user.id],
        )
        .then((res) => res.rows)
        .catch(() => []),
      client
        .query<{ lemma: string }>(
          `SELECT LOWER(lemma) AS lemma FROM lecta_user_knowledge
           WHERE user_id = $1 AND language = 'es' AND known = true AND deleted = false`,
          [user.id],
        )
        .then((res) => res.rows)
        .catch(() => []),
    ]),
  )) ?? [[], []];

  const savedWordsSet = new Set<string>();
  if (Array.isArray(savedWordsRows)) {
    for (const row of savedWordsRows) {
      if (row.form) savedWordsSet.add(row.form);
    }
  }

  const knownSet = new Set<string>();
  if (Array.isArray(knownWordsRows)) {
    for (const row of knownWordsRows) {
      if (row.lemma) knownSet.add(row.lemma);
    }
  }

  const currentUrl = `/k/read/${encodeURIComponent(hash)}?section=${chapter.sectionIndex}&page=${pageIndex}${renderQuerySuffix}`;

  // Extraer palabras candidatas de esta página
  const candidateWords = extractPageWords(rawPageHtml, "es");
  const pageWords: PageWordItem[] = candidateWords.map((form) => ({
    form,
    saved: savedWordsSet.has(form.toLowerCase()),
  }));

  // Extraer hasta 4 palabras desconocidas para las Notas del Gato
  const unknownCandidates = candidateWords.filter((w) => !knownSet.has(w.toLowerCase()));
  const catNotes: CatPageNoteItem[] = [];
  if (unknownCandidates.length > 0) {
    const entriesMap: Record<string, LexiconEntryView[]> =
      (await withClient(c.env, (client) =>
        findEntriesForForms(client, "es", unknownCandidates.slice(0, 50)),
      ).catch(() => ({}))) ?? {};

    const seenLemmas = new Set<string>();
    let noteIdx = 1;
    for (const form of unknownCandidates) {
      const entries = entriesMap?.[form] || entriesMap?.[form.toLowerCase()];
      if (!entries || entries.length === 0) continue;
      const entry = entries[0];
      const lemma = entry.lemma || form;
      const lemmaLower = lemma.toLowerCase();
      if (knownSet.has(lemmaLower) || seenLemmas.has(lemmaLower)) continue;
      const firstMeaning = entry.senses?.[0]?.definition?.trim();
      if (!firstMeaning) continue;

      seenLemmas.add(lemmaLower);
      catNotes.push({
        form,
        lemma,
        pos: entry.pos || null,
        meaning: firstMeaning,
        noteIndex: noteIdx++,
        saved: savedWordsSet.has(form.toLowerCase()) || savedWordsSet.has(lemmaLower),
      });
      if (catNotes.length >= 4) break;
    }
  }

  const notedWordsMap = new Map<string, number>();
  if (mode === "lexicon") {
    for (const note of catNotes) {
      notedWordsMap.set(note.form.toLowerCase(), note.noteIndex);
    }
  }

  // Formatear texto según modo y enlazar palabras interactivas
  const formattedHtml = formatChapterHtmlForMode(rawPageHtml, mode);
  const interactivePageHtml = wrapWordsWithLinks(
    formattedHtml,
    hash,
    currentUrl,
    savedWordsSet,
    mode === "lexicon" ? notedWordsMap : undefined,
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

  // Guardar la posición de lectura actualizada y registrar actividad en la base de datos
  const pageRatio = totalPages > 1 ? pageIndex / (totalPages - 1) : 0;
  const progress = chapter.totalSections > 1
    ? Math.min(1, Math.max(0, (chapter.sectionIndex + pageRatio) / (chapter.totalSections - 1)))
    : pageRatio;

  const now = Date.now();
  const savePositionPromise = withClient(c.env, async (client) => {
    await client.query(
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
    );
    const actId = `k_${hash}_${chapter.sectionIndex}_${pageIndex}_${now}`;
    await client.query(
      `INSERT INTO lecta_user_activity (user_id, id, book_hash, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [user.id, actId, hash, Math.max(0, now - 60000), now],
    ).catch(() => null);
  }).catch(() => null);

  try {
    c.executionCtx.waitUntil(savePositionPromise);
  } catch {
    await savePositionPromise;
  }

  let savedNotice: string | null = null;
  if (savedWord) {
    savedNotice = `¡Guardé «${savedWord}» en tu cuaderno! 🐾`;
  } else if (markedKnown) {
    savedNotice = `¡Anotado! Ya conoces «${markedKnown}». 🐾`;
  }

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
      mode,
      size,
      gloss,
      catNotes,
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

// 9. Práctica rápida de vocabulario E-ink
kindleRoutes.get("/practice", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.redirect(`/k/login?returnTo=${encodeURIComponent(c.req.url)}`);
  }

  const user = { id: session.user.id, email: session.user.email, name: session.user.name };
  const qIndex = Math.max(0, parseInt(c.req.query("q") || "0", 10) || 0);
  const correctCount = Math.max(0, parseInt(c.req.query("score") || "0", 10) || 0);
  const bookHash = c.req.query("bookHash") || "";
  const returnTo = c.req.query("returnTo") || (bookHash ? `/k/read/${encodeURIComponent(bookHash)}` : "/k");
  const isDone = c.req.query("done") === "1" || qIndex >= 3;

  if (isDone) {
    return c.html(
      renderPracticeView({
        user,
        isFinished: true,
        correctCount,
        totalQuestions: 3,
        returnTo,
        bookHash,
      }),
    );
  }

  // Cargar palabras guardadas del usuario para practicar
  const wordsRows = await withClient(c.env, (client) =>
    client
      .query(
        `SELECT form, lemma, pos, meaning, card FROM lecta_user_words
         WHERE user_id = $1 AND deleted = false AND meaning IS NOT NULL
         ORDER BY updated_at DESC LIMIT 15`,
        [user.id],
      )
      .then((res) => res.rows)
      .catch(() => []),
  );

  const FALLBACK_WORDS = [
    { form: "perenne", lemma: "perenne", pos: "adjetivo", meaning: "Que dura indefinidamente o no se extingue." },
    { form: "inefable", lemma: "inefable", pos: "adjetivo", meaning: "Que no se puede explicar con palabras." },
    { form: "prístino", lemma: "prístino", pos: "adjetivo", meaning: "Antiguo, primero, primitivo o inalterado." },
    { form: "efímero", lemma: "efímero", pos: "adjetivo", meaning: "Que dura un solo día o que es pasajero y breve." },
  ];

  const pool = Array.isArray(wordsRows) && wordsRows.length >= 3 ? wordsRows : FALLBACK_WORDS;
  const targetWord = pool[qIndex % pool.length];

  const otherMeanings = pool
    .filter((w) => w.lemma !== targetWord.lemma && w.meaning !== targetWord.meaning)
    .map((w) => w.meaning);

  const fallbackDistractors = [
    "Dicho de una persona o cosa que se encuentra en todas partes a la vez.",
    "Sosiego, tranquilidad y templanza del ánimo ante las dificultades.",
    "Sentimiento de afecto o nostalgia profunda por el pasado.",
  ];

  const distractor1 = otherMeanings[0] || fallbackDistractors[0];
  const distractor2 = otherMeanings[1] || fallbackDistractors[1];

  const correctKey: "A" | "B" | "C" = qIndex === 0 ? "B" : qIndex === 1 ? "A" : "C";
  const optionsList: { key: "A" | "B" | "C"; text: string; correct: boolean }[] = [];
  if (correctKey === "A") {
    optionsList.push(
      { key: "A", text: targetWord.meaning, correct: true },
      { key: "B", text: distractor1, correct: false },
      { key: "C", text: distractor2, correct: false },
    );
  } else if (correctKey === "B") {
    optionsList.push(
      { key: "A", text: distractor1, correct: false },
      { key: "B", text: targetWord.meaning, correct: true },
      { key: "C", text: distractor2, correct: false },
    );
  } else {
    optionsList.push(
      { key: "A", text: distractor1, correct: false },
      { key: "B", text: distractor2, correct: false },
      { key: "C", text: targetWord.meaning, correct: true },
    );
  }

  return c.html(
    renderPracticeView({
      user,
      question: {
        word: targetWord.form,
        lemma: targetWord.lemma || targetWord.form,
        pos: targetWord.pos,
        options: optionsList,
        questionIndex: qIndex,
        totalQuestions: 3,
      },
      correctCount,
      totalQuestions: 3,
      returnTo,
      bookHash,
    }),
  );
});

// 10. Responder pregunta de práctica
kindleRoutes.post("/practice/answer", async (c) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.redirect("/k/login");
  }

  const body = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const word = typeof body.word === "string" ? body.word.trim() : "";
  const selectedOption = typeof body.selectedOption === "string" ? body.selectedOption.trim() : "";
  const questionIndex = parseInt(String(body.questionIndex || "0"), 10) || 0;
  const totalQuestions = parseInt(String(body.totalQuestions || "3"), 10) || 3;
  let correctCount = parseInt(String(body.correctCount || "0"), 10) || 0;
  const bookHash = typeof body.bookHash === "string" ? body.bookHash.trim() : "";
  const returnTo = typeof body.returnTo === "string" ? body.returnTo : "/k";

  const expectedKey = questionIndex === 0 ? "B" : questionIndex === 1 ? "A" : "C";
  const isCorrect = selectedOption === expectedKey;
  if (isCorrect) {
    correctCount++;
  }

  const now = Date.now();
  const rating = isCorrect ? "good" : "again";
  const reviewId = `kr_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const actId = `ka_${now}_${Math.random().toString(36).slice(2, 8)}`;
  const eventId = `ke_${now}_${Math.random().toString(36).slice(2, 8)}`;

  await withClient(c.env, async (client) => {
    // 1. FSRS en lecta_user_words
    const existing = await client
      .query(`SELECT card FROM lecta_user_words WHERE user_id = $1 AND form = $2`, [
        session.user.id,
        word,
      ])
      .then((res) => res.rows[0]?.card)
      .catch(() => null);

    const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));
    let cardObj: Card;
    try {
      cardObj =
        existing && typeof existing === "object"
          ? (existing as Card)
          : createEmptyCard(new Date(now));
      cardObj.due = new Date(cardObj.due);
      if (cardObj.last_review) cardObj.last_review = new Date(cardObj.last_review);
    } catch {
      cardObj = createEmptyCard(new Date(now));
    }

    const scheduled = scheduler.next(
      cardObj,
      new Date(now),
      isCorrect ? Rating.Good : Rating.Again,
    );
    const updatedCard = scheduled.card;

    await client
      .query(
        `UPDATE lecta_user_words SET card = $1, updated_at = $2 WHERE user_id = $3 AND form = $4`,
        [JSON.stringify(updatedCard), now, session.user.id, word],
      )
      .catch(() => null);

    // 2. Insertar en lecta_user_reviews
    await client
      .query(
        `INSERT INTO lecta_user_reviews (user_id, id, language, form, kind, rating, hints, created_at)
         VALUES ($1, $2, 'es', $3, 'practice', $4, 0, $5)
         ON CONFLICT (user_id, id) DO NOTHING`,
        [session.user.id, reviewId, word, rating, now],
      )
      .catch(() => null);

    // 3. Registrar actividad en lecta_user_activity
    await client
      .query(
        `INSERT INTO lecta_user_activity (user_id, id, book_hash, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, id) DO NOTHING`,
        [session.user.id, actId, bookHash || "practice", Math.max(0, now - 30000), now],
      )
      .catch(() => null);

    // 4. Registrar evento de compañero en lecta_user_companion_events
    const eventPayload = {
      id: eventId,
      at: now,
      dayKey: new Date(now).toISOString().slice(0, 10),
      kind: "review",
      rating,
    };
    await client
      .query(
        `INSERT INTO lecta_user_companion_events (user_id, id, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, id) DO NOTHING`,
        [session.user.id, eventId, JSON.stringify(eventPayload)],
      )
      .catch(() => null);
  }).catch(() => null);

  const nextIndex = questionIndex + 1;
  const isFinished = nextIndex >= totalQuestions;

  const redirectUrl = isFinished
    ? `/k/practice?done=1&score=${correctCount}&bookHash=${encodeURIComponent(bookHash)}&returnTo=${encodeURIComponent(returnTo)}`
    : `/k/practice?q=${nextIndex}&score=${correctCount}&bookHash=${encodeURIComponent(bookHash)}&returnTo=${encodeURIComponent(returnTo)}`;

  return c.redirect(redirectUrl);
});


