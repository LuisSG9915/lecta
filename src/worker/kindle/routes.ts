// Rutas del portal Kindle y dispositivos E-ink para Lecta.
// Servidas íntegramente con HTML/CSS ligero generado en el Cloudflare Worker.

import { Hono, type Context } from "hono";
import { getCookie, setSignedCookie } from "hono/cookie";
import { getConnectionString, withClient, type WorkerEnv } from "../db";
import { getSession } from "../session";
import { createScopedAuth, closePoolSafe } from "../auth";
import { findEntries, findEntriesForForms } from "../lexicon";
import { createEmptyCard, fsrs, generatorParameters, Rating, type Card } from "ts-fsrs";
import {
  estimateThetaFromD1Knowledge,
  extractChapterPrepCandidates,
  extractCompactContextSentence,
  findSentenceWithWord,
  formatChapterHtmlForMode,
  getEpubChapter,
  getEpubResource,
  paginateChapter,
  parseEpub,
  selectKindleChapterPrimingWords,
  stripHtml,
  wrapWordsWithLinks,
  type KindleMargin,
  type KindleUserLexicalState,
} from "./epub-reader";
import { ENGLISH_CORE_LEXICON } from "../../shared/english-core-lexicon";
import { isHashLikeIdentifier, humanizeFilename } from "../../shared/epub-meta";
import {
  renderChapterPrepView,
  renderHomeView,
  renderKindleChapterPrimingView,
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

export interface KindleCodeRecord {
  code: string;
  status: "pending" | "linked" | "consumed";
  userId: string | null;
  sessionToken: string | null;
  createdAt: number;
  expiresAt: number;
  redirectUrl?: string;
  userToken?: string | null;
}

export type KindleLinkRecord = KindleCodeRecord;

// Respaldo en memoria para tests unitarios donde c.env.DB no está presente
export const memoryCodeStore = new Map<string, KindleCodeRecord>();
export const kindleLinkCodes = memoryCodeStore;

const SAFE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Sin I/1/O/0 para evitar confusión en tinta electrónica
const CODE_TTL_SECONDS = 600; // 10 minutos
const STATUS_LIMIT_PER_MINUTE = 20;

// Recursos del EPUB que el navegador E-ink puede recibir. Nada de HTML,
// XHTML ni SVG: un recurso activo same-origin en /k sería XSS.
export const SAFE_EPUB_ASSET_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "font/woff2",
  "font/woff",
  "font/ttf",
  "font/otf",
]);

export const KINDLE_HTML_CSP =
  "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

// Límite por IP y por isolate para la consulta de estado: el código es
// corto y el endpoint entrega una sesión, así que no puede ser un oráculo
// sin freno. No sustituye a la expiración del código, la acompaña.
const statusBuckets = new Map<string, { minute: number; count: number }>();

export function allowKindleStatus(ip: string, now = Date.now()): boolean {
  const minute = Math.floor(now / 60_000);
  let bucket = statusBuckets.get(ip);
  if (!bucket) {
    if (statusBuckets.size >= 5_000) statusBuckets.clear();
    bucket = { minute, count: 0 };
  }
  if (bucket.minute !== minute) {
    bucket.minute = minute;
    bucket.count = 0;
  }
  bucket.count += 1;
  statusBuckets.set(ip, bucket);
  return bucket.count <= STATUS_LIMIT_PER_MINUTE;
}

/** Solo para pruebas: deja el limitador como recién arrancado. */
export function resetKindleStatusLimiter(): void {
  statusBuckets.clear();
}

const VALID_MARGINS = new Set<KindleMargin>(["sm", "md", "lg"]);

export function normalizeMargin(value?: string | null): KindleMargin {
  if (value && VALID_MARGINS.has(value as KindleMargin)) {
    return value as KindleMargin;
  }
  return "md";
}

export function generateFourCharKindleCode(): string {
  let code = "";
  const randomBytes = new Uint8Array(4);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 4; i++) {
    code += SAFE_CHARS[randomBytes[i] % SAFE_CHARS.length];
  }
  return code;
}

export function cleanExpiredKindleCodes() {
  const nowSec = Math.floor(Date.now() / 1000);
  for (const [code, rec] of memoryCodeStore.entries()) {
    if (rec.expiresAt < nowSec) {
      memoryCodeStore.delete(code);
    }
  }
}

export async function createKindleLinkCode(
  db?: D1Database,
  customCode?: string,
  env?: WorkerEnv,
): Promise<KindleCodeRecord> {
  const nowSec = Math.floor(Date.now() / 1000);
  const code = (customCode ?? generateFourCharKindleCode()).toUpperCase();
  const record: KindleCodeRecord = {
    code,
    status: "pending",
    userId: null,
    sessionToken: null,
    userToken: null,
    createdAt: nowSec,
    expiresAt: nowSec + CODE_TTL_SECONDS,
  };

  memoryCodeStore.set(code, record);

  if (env && getConnectionString(env)) {
    try {
      await withClient(env, async (client) => {
        await client.query("DELETE FROM kindle_link_codes WHERE expires_at < $1", [nowSec]);
        await client.query(
          `INSERT INTO kindle_link_codes (code, status, user_id, session_token, created_at, expires_at)
           VALUES ($1, 'pending', NULL, NULL, $2, $3)
           ON CONFLICT(code) DO UPDATE SET status = 'pending', user_id = NULL, session_token = NULL, created_at = excluded.created_at, expires_at = excluded.expires_at`,
          [code, nowSec, record.expiresAt],
        );
      });
    } catch {
      // Fallback a D1 / memoria
    }
  }

  if (db && typeof db.prepare === "function") {
    try {
      await db
        .prepare(`DELETE FROM kindle_link_codes WHERE expires_at < ?`)
        .bind(nowSec)
        .run()
        .catch(() => {});

      await db
        .prepare(
          `INSERT INTO kindle_link_codes (code, status, user_id, session_token, created_at, expires_at)
           VALUES (?, 'pending', NULL, NULL, ?, ?)
           ON CONFLICT(code) DO UPDATE SET status = 'pending', user_id = NULL, session_token = NULL, created_at = excluded.created_at, expires_at = excluded.expires_at`,
        )
        .bind(code, nowSec, record.expiresAt)
        .run();
    } catch {
      // En tests con mocks parciales de D1, el Map en memoria mantiene el flujo vivo
    }
  }

  return record;
}

export async function linkKindleCodeFromMobile(params: {
  db?: D1Database;
  code: string;
  userId: string;
  sessionToken: string;
  redirectUrl?: string;
  env?: WorkerEnv;
}): Promise<{ ok: boolean; error?: string; redirectUrl?: string }> {
  const cleanCode = params.code.trim().toUpperCase();
  const nowSec = Math.floor(Date.now() / 1000);

  if (!/^[A-Z0-9]{4}$/.test(cleanCode)) {
    return { ok: false, error: "El código debe tener 4 caracteres." };
  }

  // 1. Intentar actualizar en Postgres si está disponible
  if (params.env && getConnectionString(params.env)) {
    try {
      const res = await withClient(params.env, async (client) => {
        const queryRes = await client.query(
          `SELECT code, status, expires_at FROM kindle_link_codes WHERE code = $1 LIMIT 1`,
          [cleanCode],
        );
        const row = queryRes.rows[0];
        if (!row) return null;
        if ((row.expires_at != null && Number(row.expires_at) < nowSec) || (row.status && row.status !== "pending")) {
          return { error: "Código expirado o ya utilizado." };
        }
        await client.query(
          `UPDATE kindle_link_codes
           SET status = 'linked', user_id = $1, session_token = $2
           WHERE code = $3`,
          [params.userId, params.sessionToken, cleanCode],
        );
        return { ok: true };
      });

      if (res?.error) {
        return { ok: false, error: res.error };
      }
      if (res?.ok) {
        const mem = memoryCodeStore.get(cleanCode);
        if (mem) {
          mem.status = "linked";
          mem.userId = params.userId;
          mem.sessionToken = params.sessionToken;
          mem.userToken = params.sessionToken;
          if (params.redirectUrl) mem.redirectUrl = params.redirectUrl;
        } else {
          memoryCodeStore.set(cleanCode, {
            code: cleanCode,
            status: "linked",
            userId: params.userId,
            sessionToken: params.sessionToken,
            userToken: params.sessionToken,
            createdAt: nowSec,
            expiresAt: nowSec + CODE_TTL_SECONDS,
            redirectUrl: params.redirectUrl,
          });
        }
        return { ok: true, redirectUrl: params.redirectUrl };
      }
    } catch {
      // Fallback a D1 / memoria
    }
  }

  // 2. Intentar actualizar en D1 si está disponible
  if (params.db && typeof params.db.prepare === "function") {
    try {
      const row = await params.db
        .prepare(
          `SELECT code, status, expires_at FROM kindle_link_codes WHERE code = ? LIMIT 1`,
        )
        .bind(cleanCode)
        .first<{ code: string; status: string; expires_at?: number }>();

      if (row) {
        if ((row.expires_at != null && row.expires_at < nowSec) || (row.status && row.status !== "pending")) {
          return { ok: false, error: "Código expirado o ya utilizado." };
        }
        await params.db
          .prepare(
            `UPDATE kindle_link_codes
             SET status = 'linked', user_id = ?, session_token = ?
             WHERE code = ?`,
          )
          .bind(params.userId, params.sessionToken, cleanCode)
          .run();

        const mem = memoryCodeStore.get(cleanCode);
        if (mem) {
          mem.status = "linked";
          mem.userId = params.userId;
          mem.sessionToken = params.sessionToken;
          mem.userToken = params.sessionToken;
          if (params.redirectUrl) mem.redirectUrl = params.redirectUrl;
        } else {
          memoryCodeStore.set(cleanCode, {
            code: cleanCode,
            status: "linked",
            userId: params.userId,
            sessionToken: params.sessionToken,
            userToken: params.sessionToken,
            createdAt: nowSec,
            expiresAt: nowSec + CODE_TTL_SECONDS,
            redirectUrl: params.redirectUrl,
          });
        }
        return { ok: true, redirectUrl: params.redirectUrl };
      }
    } catch {
      // Fallback al store en memoria
    }
  }

  // 3. Fallback en memoria (tests unitarios o dev local sin migración corrida)
  const memRecord = memoryCodeStore.get(cleanCode);
  if (!memRecord || (memRecord.expiresAt && memRecord.expiresAt < nowSec) || memRecord.status !== "pending") {
    return { ok: false, error: "Código inválido o expirado." };
  }

  memRecord.status = "linked";
  memRecord.userId = params.userId;
  memRecord.sessionToken = params.sessionToken;
  memRecord.userToken = params.sessionToken;
  if (params.redirectUrl) memRecord.redirectUrl = params.redirectUrl;
  return { ok: true, redirectUrl: params.redirectUrl };
}

export async function consumeLinkedKindleCode(
  db?: D1Database | undefined,
  code?: string,
  env?: WorkerEnv,
): Promise<{ status: "pending" | "linked" | "expired" | "not_found"; sessionToken?: string; userId?: string; redirectUrl?: string }> {
  const cleanCode = (code || "").trim().toUpperCase();
  const nowSec = Math.floor(Date.now() / 1000);

  type ConsumeOutcome =
    | { row: { session_token: string | null; user_id: string | null } }
    | { expired: true }
    | { gone: true }
    | { pending: true }
    | { missing: true };

  const takeMemory = (): { status: "pending" | "linked" | "expired" | "not_found"; sessionToken?: string; userId?: string; redirectUrl?: string } => {
    const mem = memoryCodeStore.get(cleanCode);
    if (!mem) return { status: "not_found" };
    if (mem.expiresAt && mem.expiresAt < nowSec) {
      memoryCodeStore.delete(cleanCode);
      return { status: "expired" };
    }
    if (mem.status === "linked" && (mem.sessionToken || mem.userToken)) {
      const sessionToken = (mem.sessionToken || mem.userToken) as string;
      memoryCodeStore.delete(cleanCode);
      return {
        status: "linked",
        sessionToken,
        userId: mem.userId ?? undefined,
        redirectUrl: mem.redirectUrl,
      };
    }
    if (mem.status !== "pending") {
      memoryCodeStore.delete(cleanCode);
      return { status: "not_found" };
    }
    return { status: "pending" };
  };

  // 1. Postgres: DELETE ... RETURNING consume el código exactamente una
  // vez. Si el código no vive en Postgres, se sigue con D1/memoria.
  if (env && getConnectionString(env)) {
    try {
      const outcome = await withClient<ConsumeOutcome>(env, async (client) => {
        const consumed = await client.query<{
          session_token: string | null;
          user_id: string | null;
        }>(
          `DELETE FROM kindle_link_codes
           WHERE code = $1 AND status = 'linked' AND expires_at >= $2
           RETURNING session_token, user_id`,
          [cleanCode, nowSec],
        );
        if (consumed.rows[0]) return { row: consumed.rows[0] };
        const state = await client.query<{
          status: string;
          expires_at: number | string | null;
        }>(
          `SELECT status, expires_at FROM kindle_link_codes WHERE code = $1 LIMIT 1`,
          [cleanCode],
        );
        const row = state.rows[0];
        if (!row) return { missing: true };
        if (row.expires_at != null && Number(row.expires_at) < nowSec) {
          await client.query(
            `DELETE FROM kindle_link_codes WHERE code = $1`,
            [cleanCode],
          );
          return { expired: true };
        }
        if (row.status !== "pending") {
          await client.query(
            `DELETE FROM kindle_link_codes WHERE code = $1`,
            [cleanCode],
          );
          return { gone: true };
        }
        return { pending: true };
      });

      if (outcome && "row" in outcome) {
        const record = outcome.row;
        if (!record.session_token) return { status: "not_found" };
        const mem = memoryCodeStore.get(cleanCode);
        memoryCodeStore.delete(cleanCode);
        return {
          status: "linked",
          sessionToken: record.session_token,
          userId: record.user_id ?? undefined,
          redirectUrl: mem?.redirectUrl,
        };
      }
      if (outcome && "expired" in outcome) {
        memoryCodeStore.delete(cleanCode);
        return { status: "expired" };
      }
      if (outcome && "gone" in outcome) {
        memoryCodeStore.delete(cleanCode);
        return { status: "not_found" };
      }
      if (outcome && "pending" in outcome) return { status: "pending" };
    } catch {
      // Fallback a D1 / memoria
    }
  }

  // 2. D1: mismo DELETE ... RETURNING para que un código se canjee una
  // sola vez aunque dos pestañas consulten a la vez.
  if (db && typeof db.prepare === "function") {
    try {
      const row = await db
        .prepare(
          `DELETE FROM kindle_link_codes
           WHERE code = ? AND status = 'linked' AND expires_at >= ?
           RETURNING session_token, user_id`,
        )
        .bind(cleanCode, nowSec)
        .first<{ session_token: string | null; user_id: string | null }>();
      if (row?.session_token) {
        const mem = memoryCodeStore.get(cleanCode);
        memoryCodeStore.delete(cleanCode);
        return {
          status: "linked",
          sessionToken: row.session_token,
          userId: row.user_id ?? undefined,
          redirectUrl: mem?.redirectUrl,
        };
      }
      const state = await db
        .prepare(
          `SELECT status, expires_at FROM kindle_link_codes WHERE code = ? LIMIT 1`,
        )
        .bind(cleanCode)
        .first<{ status: string; expires_at?: number }>();
      if (state) {
        if (state.expires_at != null && state.expires_at < nowSec) {
          await db
            .prepare(`DELETE FROM kindle_link_codes WHERE code = ?`)
            .bind(cleanCode)
            .run();
          memoryCodeStore.delete(cleanCode);
          return { status: "expired" };
        }
        if (state.status !== "pending") {
          await db
            .prepare(`DELETE FROM kindle_link_codes WHERE code = ?`)
            .bind(cleanCode)
            .run();
          memoryCodeStore.delete(cleanCode);
          return { status: "not_found" };
        }
        return { status: "pending" };
      }
    } catch {
      // Fallback a memoria
    }
  }

  return takeMemory();
}

export async function handleKindleLinkPage(c: Context<{ Bindings: WorkerEnv }>) {
  cleanExpiredKindleCodes();
  const session = await getSession(c);
  if (session?.user) {
    return c.redirect("/k");
  }

  const queryCode = (c.req.query("code") || "").trim().toUpperCase();
  let code = "";
  if (queryCode && /^[A-Z0-9]{4}$/.test(queryCode)) {
    const mem = memoryCodeStore.get(queryCode);
    const nowSec = Math.floor(Date.now() / 1000);
    if (mem && mem.status === "pending" && mem.expiresAt > nowSec) {
      code = queryCode;
    } else if (c.env && getConnectionString(c.env)) {
      try {
        const row = await withClient(c.env, async (client) => {
          const res = await client.query(
            `SELECT code, status, expires_at FROM kindle_link_codes WHERE code = $1 AND status = 'pending' LIMIT 1`,
            [queryCode],
          );
          return res.rows[0];
        });
        if (row && (row.expires_at == null || Number(row.expires_at) > nowSec)) {
          code = queryCode;
        }
      } catch {
        /* ignore */
      }
    } else if (c.env?.DB && typeof c.env.DB.prepare === "function") {
      try {
        const row = await c.env.DB.prepare(
          `SELECT code, status, expires_at FROM kindle_link_codes WHERE code = ? AND status = 'pending' LIMIT 1`,
        ).bind(queryCode).first<{ code: string; status: string; expires_at?: number }>();
        if (row && (row.expires_at == null || row.expires_at > nowSec)) {
          code = queryCode;
        }
      } catch {
        /* ignore */
      }
    }
  }

  if (!code) {
    const record = await createKindleLinkCode(c.env?.DB, undefined, c.env);
    code = record.code;
  }

  return c.html(renderKindleLinkView({ code, user: null }));
}

export async function handleKindleLinkAction(c: Context<{ Bindings: WorkerEnv }>) {
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
  if (!userSessionToken && session?.user?.id) {
    userSessionToken = `token_${session.user.id}_${Date.now()}`;
  }

  // Redirigir a la página exacta del libro actual si el usuario tiene posición previa
  let redirectUrl = "/k";
  const userId = session?.user?.id;
  if (userId) {
    try {
      const pos = await withClient(c.env, (client) =>
        client.query(
          `SELECT book_hash AS "bookHash", section_index AS "sectionIndex", scroll_top AS "scrollTop"
           FROM lecta_user_positions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
          [userId],
        ).then((res) => res.rows[0]),
      );
      if (pos?.bookHash) {
        const sec = pos.sectionIndex != null ? Number(pos.sectionIndex) : 0;
        const page = pos.scrollTop != null ? Number(pos.scrollTop) : 0;
        redirectUrl = `/k/read/${encodeURIComponent(pos.bookHash)}?section=${sec}&page=${page}`;
      }
    } catch {
      /* ignore */
    }
  }

  const result = await linkKindleCodeFromMobile({
    db: c.env?.DB,
    code,
    userId: userId || "",
    sessionToken: userSessionToken,
    redirectUrl,
    env: c.env,
  });

  if (!result.ok) {
    return c.json({ error: result.error || "Código inválido o expirado" }, 400);
  }

  return c.json({ success: true, redirectUrl });
}

export async function handleKindleStatus(c: Context<{ Bindings: WorkerEnv }>) {
  cleanExpiredKindleCodes();
  const code = (c.req.query("code") || "").trim().toUpperCase();
  if (!code) {
    return c.json({ error: "Código no proporcionado" }, 400);
  }

  const ip =
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    "local";
  if (!allowKindleStatus(ip)) {
    return c.json(
      { error: "Demasiadas consultas de código. Espera un minuto." },
      429,
    );
  }
  if (!c.env.BETTER_AUTH_SECRET) {
    return c.json({ error: "La vinculación no está configurada." }, 503);
  }

  const result = await consumeLinkedKindleCode(c.env?.DB, code, c.env);

  const isHtml =
    c.req.query("redirect") === "1" ||
    (c.req.header("accept") || "").includes("text/html");

  if (result.status === "not_found") {
    if (isHtml) {
      return c.redirect("/kindle");
    }
    return c.json({ error: "Código no encontrado" }, 404);
  }

  if (result.status === "expired") {
    if (isHtml) {
      return c.redirect("/kindle?error=expired");
    }
    return c.json({ error: "Código expirado", status: "expired" }, 400);
  }

  if (result.status === "linked" && result.sessionToken) {
    // Better Auth valida la cookie firmada (HMAC-SHA256), no el token
    // en crudo. En HTTPS la cookie debe llevar el prefijo __Secure-.
    const isSecure = new URL(c.req.url).protocol === "https:";
    const cookieName = isSecure
      ? "__Secure-better-auth.session_token"
      : "better-auth.session_token";
    await setSignedCookie(c, cookieName, result.sessionToken, c.env.BETTER_AUTH_SECRET, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "Lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    let redirectUrl = result.redirectUrl || "/k";

    // Si aún no apunta a un libro específico y tenemos userId,
    // buscamos en lecta_user_positions (005_user_positions.sql)
    if ((!result.redirectUrl || redirectUrl === "/k") && result.userId) {
      try {
        const pos = await withClient(c.env, (client) =>
          client.query(
            `SELECT book_hash AS "bookHash", section_index AS "sectionIndex", scroll_top AS "scrollTop"
             FROM lecta_user_positions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1`,
            [result.userId],
          ).then((res) => res.rows[0]),
        );
        if (pos?.bookHash) {
          const sec = pos.sectionIndex != null ? Number(pos.sectionIndex) : 0;
          const page = pos.scrollTop != null ? Number(pos.scrollTop) : 0;
          redirectUrl = `/k/read/${encodeURIComponent(pos.bookHash)}?section=${sec}&page=${page}`;
        }
      } catch {
        /* ignore */
      }
    }

    if (isHtml) {
      return c.redirect(redirectUrl);
    }
    return c.json({ linked: true, redirectUrl });
  }

  if (isHtml) {
    return c.redirect(`/kindle?code=${encodeURIComponent(code)}&pending=1`);
  }

  return c.json({ linked: false, status: result.status });
}

/**
 * POST /kindle/priming/action y POST /k/priming/action
 * Maneja acciones sin requerir JS complejo en navegadores E-Ink:
 * - action = 'known': Marca palabra como conocida en user_knowledge y sube theta
 * - action = 'save': Guarda palabra en user_knowledge ('learning') y agenda en user_reviews (FSRS)
 * - action = 'mute_book': Desactiva pre-lectura para este libro
 * - action = 'disable_all': Desactiva pre-lectura globalmente
 */
export async function handleKindlePrimingAction(c: Context<{ Bindings: WorkerEnv }>) {
  const formData = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
  const action = String(formData["action"] || "");
  const bookId = String(formData["bookId"] || "");
  const chapterIndex = Number(formData["chapter"] ?? formData["section"] ?? 0);
  const lemma = String(formData["lemma"] || "").trim().toLowerCase();
  const lang = String(formData["lang"] || "es").slice(0, 2).toLowerCase();
  const returnUrl = String(
    formData["returnUrl"] || `/k/read/${encodeURIComponent(bookId)}?section=${chapterIndex}`,
  );

  const session = await getSession(c).catch(() => null);
  const userId =
    session?.user?.id ||
    (typeof (c as unknown as { get?: (k: string) => unknown }).get === "function"
      ? ((c as unknown as { get: (k: string) => unknown }).get("userId") as string | undefined)
      : undefined);
  const db = c.env?.DB;
  const now = Date.now();

  if (userId) {
    if (action === "known" && lemma) {
      if (db && typeof db.prepare === "function") {
        await db
          .prepare(
            `INSERT INTO user_knowledge (user_id, word, lang, status, encounters, updated_at)
             VALUES (?1, ?2, ?3, 'known', 1, ?4)
             ON CONFLICT(user_id, word, lang)
             DO UPDATE SET status = 'known', encounters = encounters + 1, updated_at = ?4`,
          )
          .bind(userId, lemma, lang, now)
          .run()
          .catch(() => {});
      }
      if (getConnectionString(c.env)) {
        await withClient(c.env, (client) =>
          client.query(
            `INSERT INTO lecta_user_knowledge
               (user_id, language, lemma, known, source, updated_at, deleted)
             VALUES ($1, $2, $3, true, 'kindle_prep', $4, false)
             ON CONFLICT (user_id, language, lemma) DO UPDATE SET
               known = true,
               source = 'kindle_prep',
               updated_at = excluded.updated_at,
               deleted = false`,
            [userId, lang, lemma, now],
          ),
        ).catch(() => {});
      }
    } else if (action === "save" && lemma) {
      if (db && typeof db.prepare === "function") {
        await db
          .prepare(
            `INSERT INTO user_knowledge (user_id, word, lang, status, encounters, updated_at)
             VALUES (?1, ?2, ?3, 'learning', 1, ?4)
             ON CONFLICT(user_id, word, lang)
             DO UPDATE SET status = 'learning', encounters = encounters + 1, updated_at = ?4`,
          )
          .bind(userId, lemma, lang, now)
          .run()
          .catch(() => {});

        // Inicializar repaso espaciado FSRS en user_reviews
        await db
          .prepare(
            `INSERT INTO user_reviews (user_id, word, next_review_at, stability, difficulty, reps, lapses, state, updated_at)
             VALUES (?1, ?2, ?3, 1.5, 5.0, 0, 0, 'new', ?3)
             ON CONFLICT(user_id, word) DO NOTHING`,
          )
          .bind(userId, lemma, now + 86_400_000)
          .run()
          .catch(() => {});
      }
      if (getConnectionString(c.env)) {
        await withClient(c.env, async (client) => {
          await client.query(
            `INSERT INTO lecta_user_knowledge
               (user_id, language, lemma, known, source, updated_at, deleted)
             VALUES ($1, $2, $3, false, 'kindle_prep', $4, false)
             ON CONFLICT (user_id, language, lemma) DO UPDATE SET
               known = false,
               source = 'kindle_prep',
               updated_at = excluded.updated_at,
               deleted = false`,
            [userId, lang, lemma, now],
          ).catch(() => {});
          await client.query(
            `INSERT INTO lecta_user_words
               (user_id, language, form, lemma, pos, meaning, context, book_hash, saved_at, updated_at, deleted)
             VALUES ($1, $2, $3, $3, NULL, NULL, NULL, $4, $5, $5, false)
             ON CONFLICT (user_id, language, form) DO UPDATE SET
               updated_at = excluded.updated_at,
               deleted = false`,
            [userId, lang, lemma, bookId || null, now],
          ).catch(() => {});
        }).catch(() => {});
      }
    }
  }

  if (action === "mute_book" && bookId) {
    c.header(
      "Set-Cookie",
      `lecta_k_mute_${encodeURIComponent(bookId)}=1; Path=/; Max-Age=31536000; SameSite=Lax`,
      { append: true },
    );
    const sep = returnUrl.includes("?") ? "&" : "?";
    const target = returnUrl.includes("primed=1") ? returnUrl : `${returnUrl}${sep}primed=1`;
    return c.redirect(target, 303);
  }

  if (action === "disable_all") {
    c.header(
      "Set-Cookie",
      `lecta_k_priming_off=1; Path=/; Max-Age=31536000; SameSite=Lax`,
      { append: true },
    );
    const sep = returnUrl.includes("?") ? "&" : "?";
    const target = returnUrl.includes("primed=1") ? returnUrl : `${returnUrl}${sep}primed=1`;
    return c.redirect(target, 303);
  }

  if (action === "enable_all") {
    c.header(
      "Set-Cookie",
      `lecta_k_priming_off=0; Path=/; Max-Age=0; SameSite=Lax`,
      { append: true },
    );
    return c.redirect(returnUrl, 303);
  }

  return c.redirect(returnUrl, 303);
}

export const kindleRoutes = new Hono<{ Bindings: WorkerEnv }>();

// Middleware registrado antes de las rutas: anti-caché, CSP restrictiva
// y nosniff en todas las vistas HTML del Kindle.
kindleRoutes.use("*", async (c, next) => {
  await next();
  const contentType = c.res.headers.get("content-type");
  if (contentType?.includes("text/html")) {
    c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    c.res.headers.set("Pragma", "no-cache");
    c.res.headers.set("Expires", "0");
    c.res.headers.set("Content-Security-Policy", KINDLE_HTML_CSP);
    c.res.headers.set("X-Content-Type-Options", "nosniff");
  }
});

kindleRoutes.get("/kindle", handleKindleLinkPage);
kindleRoutes.get("/link", handleKindleLinkPage);
kindleRoutes.get("/verify", handleKindleStatus);
kindleRoutes.get("/api/kindle/status", handleKindleStatus);
kindleRoutes.post("/api/kindle/link", handleKindleLinkAction);
kindleRoutes.post("/priming/action", handleKindlePrimingAction);
kindleRoutes.post("/kindle/priming/action", handleKindlePrimingAction);

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

  let liveHydrationCount = 0;
  const MAX_LIVE_HYDRATIONS_PER_REQ = 1;
  const MAX_HYDRATION_EPUB_BYTES = 15 * 1024 * 1024;

  const books: KindleBookItem[] = await Promise.all(
    objects.map(async (obj) => {
      const hash = obj.key.split("/").pop()?.replace(/\.epub$/, "") ?? "";
      let title = obj.customMetadata?.title || "";
      let author = obj.customMetadata?.author || "";
      let sections = Number(obj.customMetadata?.sections) || 0;

      const canHydrate =
        (!title || !author || !sections) &&
        liveHydrationCount < MAX_LIVE_HYDRATIONS_PER_REQ &&
        (obj.size == null || obj.size <= MAX_HYDRATION_EPUB_BYTES);

      if (canHydrate) {
        liveHydrationCount += 1;
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

      if (!title || isHashLikeIdentifier(title)) {
        title = humanizeFilename(obj.customMetadata?.name) || (author && author !== "Autor desconocido" ? `Libro de ${author}` : "Libro sin título");
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

  let userBookList: Array<{ id: string; title: string; author: string }> = [];
  if (getConnectionString(c.env)) {
    const rows = await withClient(c.env, async (client) => {
      const res = await client.query<{ id: string; title: string; author: string }>(
        `SELECT book_id AS id, title, author FROM user_books WHERE user_id = $1 ORDER BY updated_at DESC`,
        [user.id],
      );
      return res.rows;
    });
    if (rows) userBookList = rows;
  } else if (c.env.DB) {
    const d1Result = await c.env.DB.prepare(
      `SELECT book_id AS id, title, author FROM user_books WHERE user_id = ? ORDER BY updated_at DESC`,
    )
      .bind(user.id)
      .all<{ id: string; title: string; author: string }>()
      .catch(() => null);

    if (d1Result?.results) {
      userBookList = d1Result.results;
    }
  }

  if (userBookList.length > 0) {
    const knownHashes = new Set(books.map((b) => b.hash));
    for (const d1 of userBookList) {
      if (!knownHashes.has(d1.id)) {
        const pos = positionMap.get(d1.id);
        const resolvedTitle = (!d1.title || isHashLikeIdentifier(d1.title))
          ? (d1.author && d1.author !== "Autor desconocido" ? `Libro de ${d1.author}` : "Libro sin título")
          : d1.title;
        books.push({
          hash: d1.id,
          title: resolvedTitle,
          author: d1.author || "Autor desconocido",
          sections: 1,
          currentSection: pos ? pos.sectionIndex : null,
          currentPage: pos ? pos.pageIndex : null,
          progressPercent: pos ? pos.progress : null,
        });
      }
    }
  }

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
  const { auth: loginAuth, closePool: closeLoginPool } = createScopedAuth(c.env, baseURL);
  try {
    authRes = await loginAuth.handler(authReq);
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
  } finally {
    await closePoolSafe(closeLoginPool, c);
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

  const { auth: logoutAuth, closePool: closeLogoutPool } = createScopedAuth(c.env, baseURL);
  let authRes: Response | null;
  try {
    authRes = await logoutAuth.handler(authReq).catch(() => null);
  } finally {
    await closePoolSafe(closeLogoutPool, c);
  }
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

// Función de carga de binario EPUB para /k con soporte de catálogo y libros de usuario
export async function loadEpubBufferForKindle(
  env: WorkerEnv,
  userId: string | null,
  bookId: string,
): Promise<ArrayBuffer | null> {
  const bucket = env.BOOKS_BUCKET ?? env.BOOKS;
  if (!bucket) return null;

  // 1. Intentar desde catálogo público en R2
  const catalogObj = await bucket.get(`catalog/${bookId}.epub`);
  if (catalogObj) return await catalogObj.arrayBuffer();

  // 2. Fallback a libros propios del usuario vinculado en /k
  if (!userId) return null;
  if (getConnectionString(env)) {
    const userBook = await withClient(env, async (client) => {
      const res = await client.query<{ r2_key: string }>(
        `SELECT r2_key FROM user_books WHERE user_id = $1 AND book_id = $2`,
        [userId, bookId],
      );
      return res.rows[0];
    });
    if (userBook?.r2_key) {
      const userObj = await bucket.get(userBook.r2_key);
      if (userObj) return await userObj.arrayBuffer();
    }
  } else if (env.DB) {
    const userBook = await env.DB.prepare(
      `SELECT r2_key FROM user_books WHERE user_id = ? AND book_id = ?`,
    )
      .bind(userId, bookId)
      .first<{ r2_key: string }>()
      .catch(() => null);

    if (userBook?.r2_key) {
      const userObj = await bucket.get(userBook.r2_key);
      if (userObj) return await userObj.arrayBuffer();
    }
  }

  const userBookObj = await bucket.get(`user-books/${userId}/${bookId}.epub`);
  if (userBookObj) return await userBookObj.arrayBuffer();

  const legacyObj = await bucket.get(`books/${userId}/${bookId}.epub`);
  if (legacyObj) return await legacyObj.arrayBuffer();

  return null;
}

// 4. Lector de capítulos
kindleRoutes.get("/read/:hash", async (c) => {
  const session = await getSession(c);
  const hash = c.req.param("hash");

  if (!session?.user) {
    return c.redirect(`/k/login?returnTo=${encodeURIComponent(c.req.url)}`);
  }

  if (!c.env.BOOKS && !c.env.BOOKS_BUCKET) {
    return c.html("<h1>Error</h1><p>El almacenamiento no está configurado.</p>", 503);
  }

  const user = { id: session.user.id, email: session.user.email, name: session.user.name };
  const requestedSection = c.req.query("section") ?? c.req.query("chapter");
  const requestedPage = c.req.query("page");
  const savedWord = c.req.query("savedWord");
  const markedKnown = c.req.query("markedKnown");
  const lookupWord = c.req.query("lookup")?.trim() || "";
  const isPrep = c.req.query("prep") === "1";
  const rawMode = c.req.query("mode");
  const rawSize = c.req.query("size");
  const rawGloss = c.req.query("gloss");
  const rawLayout = c.req.query("layout");
  const rawMargin = c.req.query("margin");
  const cookieMargin = getCookie(c, "lecta_k_margin");
  const margin = normalizeMargin(rawMargin ?? cookieMargin);

  if (rawMargin && VALID_MARGINS.has(rawMargin as KindleMargin)) {
    c.header(
      "Set-Cookie",
      `lecta_k_margin=${margin}; Path=/; Max-Age=31536000; SameSite=Lax`,
      { append: true },
    );
  }

  const mode = (rawMode as "clean" | "paragraphs" | "lexicon") || "clean";
  const size = (rawSize as "sm" | "md" | "lg" | "xl") || "md";
  const gloss = rawGloss === "1";
  const cookieHeader = c.req.header("cookie") || "";
  const cookieLayout = cookieHeader.includes("lecta_k_layout=scroll") ? "scroll" : "paged";
  const layout: "paged" | "scroll" = rawLayout === "scroll" || rawLayout === "paged"
    ? rawLayout
    : cookieLayout;
  const querySuffix = `${rawMode ? `&mode=${encodeURIComponent(rawMode)}` : ""}${rawSize ? `&size=${encodeURIComponent(rawSize)}` : ""}${rawGloss !== undefined ? `&gloss=${encodeURIComponent(rawGloss)}` : ""}${layout !== "paged" ? `&layout=${layout}` : ""}&margin=${margin}`;
  const renderQuerySuffix = `&mode=${encodeURIComponent(mode)}&size=${encodeURIComponent(size)}&gloss=${gloss ? "1" : "0"}&layout=${layout}&margin=${margin}`;

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

  // Descargar el EPUB de R2 (con fallback a user_books en D1 o catálogo)
  const epubBuffer = await loadEpubBufferForKindle(c.env, user.id, hash);
  if (!epubBuffer) {
    return c.html(
      `<h1>Libro no encontrado</h1><p>No se encontró este libro en tu cuenta.</p><p><a href="/k">Volver a la biblioteca</a></p>`,
      404,
    );
  }

  const data = new Uint8Array(epubBuffer);
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

  // Paginación del capítulo en pantallas discretas (Zero-Scroll en modo paged)
  const pages = paginateChapter(chapter.contentHtml, {
    size,
    margin,
    layout,
    mode,
  });
  const totalPages = pages.length;

  let pageIndex = 0;
  if (requestedPage === "last") {
    pageIndex = Math.max(0, totalPages - 1);
  } else if (requestedPage !== undefined) {
    pageIndex = Math.min(Math.max(0, parseInt(requestedPage, 10) || 0), totalPages - 1);
  }

  const isPrimed = c.req.query("primed") === "1";
  const isPrimingOff = cookieHeader.includes("lecta_k_priming_off=1");
  const isBookMuted = cookieHeader.includes(`lecta_k_mute_${encodeURIComponent(hash)}=1`);

  // Antesala de pre-lectura adaptativa (solo al inicio del capítulo en página 0)
  if (
    pageIndex === 0 &&
    requestedPage !== "last" &&
    !isPrep &&
    !lookupWord &&
    !savedWord &&
    !markedKnown &&
    !isPrimed &&
    !isPrimingOff &&
    !isBookMuted
  ) {
    const bookLang = (chapter.language || "es").slice(0, 2).toLowerCase();
    const cleanText = stripHtml(chapter.contentHtml);

    // 1. Cargar historial del usuario para estimar theta y lemas conocidos
    let d1Rows: Array<{ word: string; status: string; difficultyBeta?: number }> = [];
    if (c.env?.DB && typeof c.env.DB.prepare === "function") {
      try {
        const res = await c.env.DB.prepare(
          `SELECT word, status FROM user_knowledge WHERE user_id = ? AND lang = ?`,
        )
          .bind(user.id, bookLang)
          .all<{ word: string; status: string }>();
        if (res?.results) {
          d1Rows = res.results.map((r) => ({
            word: r.word.toLowerCase(),
            status: r.status,
          }));
        }
      } catch {
        /* fallback */
      }
    }

    const pgKnowledge =
      (getConnectionString(c.env)
        ? await withClient(c.env, (client) =>
            client
              .query<{ lemma: string; known: boolean }>(
                `SELECT LOWER(lemma) AS lemma, known FROM lecta_user_knowledge
                 WHERE user_id = $1 AND language = $2 AND deleted = false`,
                [user.id, bookLang],
              )
              .then((res) => res.rows)
              .catch(() => []),
          )
        : []) ?? [];

    const knowledgeRecords: Array<{ word: string; status: string; difficultyBeta?: number }> = [...d1Rows];
    const knownLemmas = new Set<string>();
    const learningRetrievability = new Map<string, number>();

    for (const r of d1Rows) {
      if (r.status === "known") knownLemmas.add(r.word);
      else if (r.status === "learning") learningRetrievability.set(r.word, 0.5);
    }

    for (const row of pgKnowledge) {
      const status = row.known ? "known" : "learning";
      knowledgeRecords.push({ word: row.lemma, status });
      if (row.known) knownLemmas.add(row.lemma);
      else learningRetrievability.set(row.lemma, 0.5);
    }

    const theta = estimateThetaFromD1Knowledge(knowledgeRecords);
    const userState: KindleUserLexicalState = {
      theta,
      knownLemmas,
      learningRetrievability,
    };

    // 2. Construir catálogo léxico relevante para este capítulo
    const lexiconCatalog = new Map<string, { beta: number; gloss: string; pos?: string; zipf?: number | null }>();

    if (bookLang === "en") {
      for (const [w, item] of Object.entries(ENGLISH_CORE_LEXICON)) {
        lexiconCatalog.set(w, {
          beta: 0.6,
          gloss: item.translation ? `${item.translation}: ${item.definition}` : item.definition,
          pos: item.pos,
        });
      }
    } else {
      const candidateForms = extractChapterPrepCandidates(chapter.contentHtml, "es");
      const filtered = candidateForms.filter((f) => !knownLemmas.has(f)).slice(0, 100);
      if (filtered.length > 0 && getConnectionString(c.env)) {
        const entriesMap: Record<string, import("../lexicon").LexiconEntryView[]> =
          (await withClient(c.env, (client) =>
            findEntriesForForms(client, "es", filtered),
          ).catch(() => ({}))) as Record<string, import("../lexicon").LexiconEntryView[]>;

        for (const [form, entries] of Object.entries(entriesMap)) {
          if (Array.isArray(entries) && entries.length > 0) {
            const entry = entries[0];
            const gloss = entry.senses?.[0]?.definition?.trim();
            if (gloss) {
              const lemma = (entry.lemma || form).toLowerCase();
              lexiconCatalog.set(lemma, {
                beta: entry.zipf ? Math.max(0.1, 5.0 - entry.zipf) : 0.6,
                gloss,
                pos: entry.pos || undefined,
                zipf: entry.zipf ?? null,
              });
            }
          }
        }
      }
    }

    // 3. Seleccionar palabras óptimas según Rasch + ZPD
    const primingWords = selectKindleChapterPrimingWords(
      cleanText,
      bookLang,
      userState,
      lexiconCatalog,
      { maxWords: 5, isForeignLang: bookLang !== "es" },
    );

    if (primingWords.length > 0) {
      let savedNotice: string | null = null;
      if (savedWord) {
        savedNotice = `✓ Palabra «${savedWord}» guardada en tu Cuaderno.`;
      } else if (markedKnown) {
        savedNotice = `✓ Palabra «${markedKnown}» marcada como conocida.`;
      }

      const readUrl = `/k/read/${encodeURIComponent(hash)}?section=${chapter.sectionIndex}&page=0&primed=1${renderQuerySuffix}`;
      return c.html(
        renderKindleChapterPrimingView({
          user,
          bookId: hash,
          bookHash: hash,
          bookTitle: chapter.bookTitle,
          bookAuthor: chapter.bookAuthor,
          chapterTitle: chapter.chapterTitle,
          chapterIndex: chapter.sectionIndex,
          sectionIndex: chapter.sectionIndex,
          totalSections: chapter.totalSections,
          bookLang,
          lang: bookLang,
          isForeignLang: bookLang !== "es",
          words: primingWords,
          readUrl,
          savedNotice,
        }),
      );
    }
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

  // En lectura regular no se extraen palabras ni se consultan notas al pie para Zero-Scroll y rendimiento
  const pageWords: PageWordItem[] = [];
  const catNotes: CatPageNoteItem[] = [];

  // Formatear texto según modo y enlazar palabras con spans inertes
  const formattedHtml = formatChapterHtmlForMode(rawPageHtml, mode);
  const interactivePageHtml = wrapWordsWithLinks(
    formattedHtml,
    hash,
    currentUrl,
    savedWordsSet,
  );

  // Consulta de definición en línea si se pulsó una palabra
  let lookupResult: InlineLookupResult | null = null;
  if (lookupWord) {
    const contextSentence = extractCompactContextSentence(stripHtml(rawPageHtml), lookupWord) || null;
    try {
      const entries = await withClient(c.env, (client) =>
        findEntries(client, "es", lookupWord.toLowerCase()),
      );
      lookupResult = {
        word: lookupWord,
        entries: entries || [],
        contextSentence,
      };
    } catch {
      lookupResult = {
        word: lookupWord,
        entries: [],
        contextSentence,
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
      margin,
      gloss,
      catNotes,
      primingOff: isPrimingOff || isBookMuted,
      layout,
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

  const epubBuffer = await loadEpubBufferForKindle(c.env, session.user.id, hash);
  if (!epubBuffer) {
    return c.text("Libro no encontrado", 404);
  }

  const data = new Uint8Array(epubBuffer);
  const resource = await getEpubResource(data, resourcePath);
  if (!resource) {
    return c.text("Recurso no encontrado en el EPUB", 404);
  }

  if (!SAFE_EPUB_ASSET_MIMES.has(resource.mimeType)) {
    return c.text("Unsupported resource type", 415);
  }

  return new Response(resource.data as unknown as BodyInit, {
    headers: {
      "Content-Type": resource.mimeType,
      "Cache-Control": "private, max-age=86400",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
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
  const context = typeof body.context === "string" && body.context.trim() ? body.context.trim().slice(0, 280) : null;
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
       VALUES ($1, 'es', $2, $3, $4, $5, $6, $7, $8, $8, false)
       ON CONFLICT (user_id, language, form) DO UPDATE SET
         lemma = excluded.lemma,
         pos = excluded.pos,
         meaning = excluded.meaning,
         context = COALESCE(excluded.context, lecta_user_words.context),
         book_hash = COALESCE(excluded.book_hash, lecta_user_words.book_hash),
         updated_at = excluded.updated_at,
         deleted = false`,
      [session.user.id, form, lemma, pos, meaning, context, bookHash, now],
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

  // Cargar palabras guardadas del usuario para practicar (orden determinista por saved_at)
  const wordsRows = await withClient(c.env, (client) =>
    client
      .query(
        `SELECT form, lemma, pos, meaning, context, card FROM lecta_user_words
         WHERE user_id = $1 AND deleted = false AND meaning IS NOT NULL
         ORDER BY saved_at DESC, form ASC LIMIT 15`,
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
        contextSentence: (targetWord as { context?: string | null }).context ?? null,
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


