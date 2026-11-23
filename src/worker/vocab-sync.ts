// Sincronización del cuaderno: `/api/vocab` (pull incremental y upsert por
// sello) y `/api/sync/counts`. Extraído de app.ts (R2 de la deuda de
// complejidad).
import { Hono } from "hono";
import { toCatalogId, toSenseOrder } from "./catalog-ids";
import { chunks, getConnectionString, withClient, type WorkerEnv } from "./db";
import { isResetBlocked, readResetAck, resetBlockedResponse, withResetGuard } from "./reset-guard";
import { getSession } from "./session";
import { isFsrsCardShape } from "../shared/reading-data";

export const vocabSync = new Hono<{ Bindings: WorkerEnv }>();

type UserWordInput = {
  form?: unknown;
  language?: unknown;
  lemma?: unknown;
  pos?: unknown;
  meaning?: unknown;
  context?: unknown;
  bookHash?: unknown;
  card?: unknown;
  senseEntryId?: unknown;
  senseOrder?: unknown;
  presentedAt?: unknown;
  savedAt?: unknown;
  updatedAt?: unknown;
  deleted?: unknown;
};

const cleanText = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : undefined;
const cleanNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

function parseSinceParam(param?: string | null): number {
  if (!param) return 0;
  const num = Number(param);
  if (Number.isFinite(num) && num > 0) return num;
  const parsedDate = Date.parse(param);
  if (!Number.isNaN(parsedDate) && parsedDate > 0) return parsedDate;
  return 0;
}

vocabSync.get("/api/vocab", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver tu vocabulario." }, 401);
  const language = context.req.query("lang")?.trim() || "es";
  const since = parseSinceParam(context.req.query("since"));
  const afterWord = context.req.query("afterWord")?.trim() || null;
  // availableLanguages solo hace falta al descubrir idiomas en la primera
  // página. En las siguientes (o cuando el cliente lo desactiva) se evita
  // el DISTINCT: es una consulta cara que se repetía por cada página.
  const includeLanguages =
    context.req.query("includeLanguages") !== "0" && !afterWord;
  const queryStartMs = Date.now();
  const LIMIT = 1000;

  const resultData = await withClient(context.env, async (client) => {
    const params: unknown[] = [session.user.id, language];
    const filters = ["user_id = $1", "language = $2"];
    if (since > 0) {
      if (afterWord) {
        filters.push(
          "(synced_at > $3 OR (synced_at = $3 AND form > $4))",
        );
        params.push(since, afterWord);
      } else {
        filters.push("synced_at > $3");
        params.push(since);
      }
    }

    const rows = await client
      .query(
        `SELECT language, form, lemma, pos, meaning, context, book_hash AS "bookHash",
                sense_entry_id AS "senseEntryId", sense_order AS "senseOrder",
                card, presented_at AS "presentedAt",
                saved_at AS "savedAt", updated_at AS "updatedAt",
                synced_at AS "syncedAt", deleted
         FROM lecta_user_words
         WHERE ${filters.join(" AND ")}
         ORDER BY synced_at ASC, form ASC
         LIMIT ${LIMIT}`,
        params,
      )
      .then((result) => result.rows);

    const langRows = includeLanguages
      ? await client
          .query(
            `SELECT DISTINCT language FROM lecta_user_words WHERE user_id = $1`,
            [session.user.id],
          )
          .then((result) => result.rows)
          .catch(() => [])
      : [];

    return { rows, langRows, includeLanguages };
  });

  if (resultData === undefined)
    return context.json({ error: "El vocabulario no está configurado." }, 503);

  const { rows, langRows, includeLanguages: withLanguages } = resultData;
  const hasMore = rows.length === LIMIT;
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor =
    hasMore && lastRow
      ? Number(lastRow.syncedAt)
      : Math.max(0, queryStartMs - 5_000);
  const nextAfterWord = hasMore && lastRow ? String(lastRow.form) : null;

  const availableLanguages = withLanguages
    ? Array.from(
        new Set([
          ...langRows
            .map((r: { language?: unknown }) =>
              typeof r.language === "string" ? r.language.trim() : "",
            )
            .filter(Boolean),
          language,
        ]),
      )
    : undefined;

  return context.json({
    words: rows.map((row) => ({
      ...row,
      key: `${row.language}:${row.form.toLowerCase()}`,
      // int8 > 2^53: se devuelve como string; un Number lo truncaría.
      senseEntryId: row.senseEntryId != null ? String(row.senseEntryId) : null,
      senseOrder: row.senseOrder != null ? Number(row.senseOrder) : null,
      presentedAt: row.presentedAt != null ? Number(row.presentedAt) : null,
      savedAt: Number(row.savedAt),
      updatedAt: Number(row.updatedAt),
      syncedAt: row.syncedAt != null ? Number(row.syncedAt) : Number(row.updatedAt),
      card: typeof row.card === "string" ? JSON.parse(row.card) : row.card,
    })),
    serverTime: Date.now(),
    hasMore,
    nextCursor,
    nextAfterWord,
    availableLanguages,
  });
});

vocabSync.put("/api/vocab", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar tu vocabulario." }, 401);

  const serverNow = Date.now();
  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.words) ? (body.words as UserWordInput[]) : [];
  // Una card malformada invalida la petición completa antes del SQL:
  // guardarla corrompería el historial de repaso y descartarla en
  // silencio perdería la tarjeta sin avisar al cliente.
  if (
    inputs.some(
      (input) => input.card != null && !isFsrsCardShape(input.card),
    )
  )
    return context.json({ error: "Hay una tarjeta de repaso inválida." }, 400);
  const words = inputs
    .map((input) => {
      const form = cleanText(input.form, 100)?.trim().toLowerCase();
      const language = cleanText(input.language, 10)?.trim() || "es";
      const rawUpdatedAt = cleanNumber(input.updatedAt);
      const updatedAt =
        rawUpdatedAt !== undefined ? Math.min(rawUpdatedAt, serverNow) : serverNow;
      if (!form) return null;
      const rawSavedAt = cleanNumber(input.savedAt);
      const savedAt =
        rawSavedAt !== undefined ? Math.min(rawSavedAt, serverNow) : updatedAt;
      return {
        form,
        language,
        lemma: cleanText(input.lemma, 100) ?? null,
        pos: cleanText(input.pos, 30) ?? null,
        meaning: cleanText(input.meaning, 500) ?? null,
        context: cleanText(input.context, 500) ?? null,
        bookHash: cleanText(input.bookHash, 80) ?? null,
        // Referencia a la acepción guardada: los mismos validadores del
        // catálogo (int8/int4 positivos); lo inválido queda en null.
        senseEntryId: toCatalogId(input.senseEntryId),
        senseOrder: toSenseOrder(input.senseOrder),
        card: input.card ?? null,
        // Sello de primera exposición: reloj del cliente acotado al del
        // servidor, como updatedAt. Ausente queda en null y no borra el previo.
        presentedAt: (() => {
          const raw = cleanNumber(input.presentedAt);
          return raw !== undefined && raw > 0 ? Math.min(raw, serverNow) : null;
        })(),
        savedAt,
        updatedAt,
        deleted: input.deleted === true,
      };
    })
    .filter((word): word is NonNullable<typeof word> => word !== null)
    .slice(0, 500);
  if (!words.length) return context.json({ error: "Faltan las palabras." }, 400);

  const resetAck = readResetAck(context);
  const upserted = await withResetGuard(context.env, resetAck, session.user.id, async (client) => {
    let total = 0;
    for (const chunk of chunks(words)) {
      const result = await client.query(
      `INSERT INTO lecta_user_words
         (user_id, language, form, lemma, pos, meaning, context, book_hash,
          sense_entry_id, sense_order, card, presented_at, saved_at, updated_at,
          deleted, synced_at)
       SELECT $1,
              j.value ->> 'language', j.value ->> 'form', j.value ->> 'lemma',
              j.value ->> 'pos', j.value ->> 'meaning', j.value ->> 'context',
              j.value ->> 'bookHash',
              (j.value ->> 'senseEntryId')::int8, (j.value ->> 'senseOrder')::int4,
              NULLIF(j.value -> 'card', 'null'::jsonb) AS card,
              (j.value ->> 'presentedAt')::int8,
              (j.value ->> 'savedAt')::int8, (j.value ->> 'updatedAt')::int8,
              COALESCE((j.value ->> 'deleted')::bool, false),
              $3::int8
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, language, form) DO UPDATE SET
         lemma = excluded.lemma, pos = excluded.pos, meaning = excluded.meaning,
         context = excluded.context, book_hash = excluded.book_hash,
         sense_entry_id = excluded.sense_entry_id,
         sense_order = excluded.sense_order,
         card = CASE
           WHEN excluded.deleted THEN NULL
           ELSE COALESCE(NULLIF(excluded.card, 'null'::jsonb), lecta_user_words.card)
         END,
         presented_at = COALESCE(excluded.presented_at, lecta_user_words.presented_at),
         updated_at = excluded.updated_at,
         deleted = excluded.deleted,
         synced_at = excluded.synced_at
       WHERE lecta_user_words.updated_at <= excluded.updated_at`,
      [session.user.id, JSON.stringify(chunk), serverNow],
      );
      total += result.rowCount ?? 0;
    }
    return total;
  });
  if (isResetBlocked(upserted))
    return resetBlockedResponse(context, upserted.blockedAt);
  if (upserted === undefined)
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  return context.json({ ok: true, upserted, serverTime: serverNow });
});

vocabSync.get("/api/sync/counts", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para consultar sincronización." }, 401);

  const counts = await withClient(context.env, async (client) => {
    // Una sola sentencia: seis COUNT sueltos en un solo client se
    // serializan igual (pg no paraleliza) y pagan ~100 ms por round-trip.
    const res = await client.query<Record<string, number | string>>(
      `SELECT
         (SELECT COUNT(*) FROM lecta_user_words WHERE user_id = $1 AND deleted = false)::int8 AS words,
         (SELECT COUNT(*) FROM lecta_user_annotations WHERE user_id = $1 AND deleted = false)::int8 AS annotations,
         (SELECT COUNT(*) FROM lecta_user_activity WHERE user_id = $1)::int8 AS activity,
         (SELECT COUNT(*) FROM lecta_user_reviews WHERE user_id = $1)::int8 AS reviews,
         (SELECT COUNT(*) FROM lecta_user_positions WHERE user_id = $1)::int8 AS positions,
         (SELECT COUNT(*) FROM lecta_user_knowledge WHERE user_id = $1 AND deleted = false)::int8 AS knowledge`,
      [session.user.id],
    );
    const row = res.rows[0] ?? {};
    return {
      words: Number(row.words ?? 0),
      annotations: Number(row.annotations ?? 0),
      activity: Number(row.activity ?? 0),
      reviews: Number(row.reviews ?? 0),
      positions: Number(row.positions ?? 0),
      knowledge: Number(row.knowledge ?? 0),
    };
  });
  if (counts === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);

  return context.json({ counts, serverTime: Date.now() });
});
