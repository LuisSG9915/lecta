import { Hono } from "hono";
import { withClient, getConnectionString, chunks, type WorkerEnv } from "./db";
import { getSession } from "./session";
import {
  cleanAnnotation,
  cleanActivity,
  cleanReview,
  cleanPosition,
  cleanKnowledge,
  knowledgeArbSql,
  ANNOTATION_LIMITS,
  ACTIVITY_LIMITS,
  REVIEW_LIMITS,
  POSITION_LIMITS,
  KNOWLEDGE_LIMITS,
  type SyncAnnotationInput,
  type SyncActivityInput,
  type SyncReviewInput,
  type SyncPositionInput,
  type SyncKnowledgeInput,
} from "../shared/reading-data";

function parseSinceParam(param?: string | null): number {
  if (!param) return 0;
  const num = Number(param);
  if (Number.isFinite(num) && num > 0) return num;
  const parsedDate = Date.parse(param);
  if (!Number.isNaN(parsedDate) && parsedDate > 0) return parsedDate;
  return 0;
}

// Marcadores y pasajes del lector, sincronizados entre dispositivos.
// Mismo patrón que /api/vocab: GET devuelve todo lo del usuario y PUT
// fusiona por clave con updated_at como árbitro.
export const readingData = new Hono<{ Bindings: WorkerEnv }>();

readingData.get("/api/annotations", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para ver tus marcadores." }, 401);

  const since = parseSinceParam(context.req.query("since"));
  const queryStartMs = Date.now();
  const LIMIT = 1000;

  const rows = await withClient(context.env, (client) => {
    if (since > 0) {
      return client
        .query(
          `SELECT book_hash AS "bookHash", id, kind, section_index AS "sectionIndex",
                  anchor, text, prefix, suffix, note,
                  created_at AS "createdAt", updated_at AS "updatedAt", deleted
           FROM lecta_user_annotations
           WHERE user_id = $1 AND updated_at > $2
           ORDER BY updated_at ASC
           LIMIT ${LIMIT}`,
          [session.user.id, since],
        )
        .then((result) => result.rows);
    }
    return client
      .query(
        `SELECT book_hash AS "bookHash", id, kind, section_index AS "sectionIndex",
                anchor, text, prefix, suffix, note,
                created_at AS "createdAt", updated_at AS "updatedAt", deleted
         FROM lecta_user_annotations
         WHERE user_id = $1
         ORDER BY updated_at ASC
         LIMIT ${LIMIT}`,
        [session.user.id],
      )
      .then((result) => result.rows);
  });
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);

  const hasMore = rows.length === LIMIT;
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor =
    hasMore && lastRow
      ? Number(lastRow.updatedAt)
      : Math.max(0, queryStartMs - 5_000);

  return context.json({
    annotations: rows.map((row) => ({
      ...row,
      key: `${row.bookHash}:${row.id}`,
      sectionIndex: Number(row.sectionIndex),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    })),
    serverTime: Date.now(),
    hasMore,
    nextCursor,
  });
});

readingData.put("/api/annotations", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar tus marcadores." }, 401);

  const serverNow = Date.now();
  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.annotations)
    ? (body.annotations as SyncAnnotationInput[])
    : [];
  const annotations = inputs
    .map(cleanAnnotation)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map((item) => ({
      ...item,
      updatedAt: Math.min(item.updatedAt, serverNow),
      createdAt: Math.min(item.createdAt, serverNow),
    }))
    .slice(0, ANNOTATION_LIMITS.batch);
  if (!annotations.length)
    return context.json({ error: "Faltan las anotaciones." }, 400);

  const upserted = await withClient(context.env, async (client) => {
    let total = 0;
    for (const chunk of chunks(annotations)) {
      const result = await client.query(
      `INSERT INTO lecta_user_annotations
         (user_id, book_hash, id, kind, section_index, anchor, text, prefix, suffix, note, created_at, updated_at, deleted)
       SELECT $1,
              j.value ->> 'bookHash', j.value ->> 'id', j.value ->> 'kind',
              (j.value ->> 'sectionIndex')::int8, j.value ->> 'anchor',
              j.value ->> 'text', j.value ->> 'prefix', j.value ->> 'suffix',
              j.value ->> 'note',
              (j.value ->> 'createdAt')::int8, (j.value ->> 'updatedAt')::int8,
              COALESCE((j.value ->> 'deleted')::bool, false)
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, book_hash, id) DO UPDATE SET
         kind = excluded.kind, section_index = excluded.section_index,
         anchor = excluded.anchor, text = excluded.text,
         prefix = excluded.prefix, suffix = excluded.suffix, note = excluded.note,
         updated_at = excluded.updated_at, deleted = excluded.deleted
       WHERE lecta_user_annotations.updated_at < excluded.updated_at`,
      [session.user.id, JSON.stringify(chunk)],
      );
      total += result.rowCount ?? 0;
    }
    return total;
  });
  if (upserted === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({ ok: true, upserted });
});

// Intervalos de lectura. A diferencia de las anotaciones son
// inmutables: PUT solo inserta los que faltan (ON CONFLICT DO NOTHING)
// y la unión de solapados se hace al agregar, no al escribir.
readingData.get("/api/activity", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para ver tu actividad." }, 401);

  const since = parseSinceParam(context.req.query("since"));
  const afterId = context.req.query("afterId")?.trim();
  const queryStartMs = Date.now();
  const LIMIT = 1000;

  const rows = await withClient(context.env, (client) => {
    if (afterId) {
      return client
        .query(
          `SELECT id, book_hash AS "bookHash",
                  started_at AS "startedAt", ended_at AS "endedAt"
           FROM lecta_user_activity
           WHERE user_id = $1 AND id > $2
           ORDER BY id ASC
           LIMIT ${LIMIT}`,
          [session.user.id, afterId],
        )
        .then((result) => result.rows);
    }
    if (since > 0) {
      return client
        .query(
          `SELECT id, book_hash AS "bookHash",
                  started_at AS "startedAt", ended_at AS "endedAt"
           FROM lecta_user_activity
           WHERE user_id = $1 AND ended_at > $2
           ORDER BY ended_at ASC, id ASC
           LIMIT ${LIMIT}`,
          [session.user.id, since],
        )
        .then((result) => result.rows);
    }
    return client
      .query(
        `SELECT id, book_hash AS "bookHash",
                started_at AS "startedAt", ended_at AS "endedAt"
         FROM lecta_user_activity
         WHERE user_id = $1
         ORDER BY id ASC
         LIMIT ${LIMIT}`,
        [session.user.id],
      )
      .then((result) => result.rows);
  });
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);

  const hasMore = rows.length === LIMIT;
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor =
    hasMore && lastRow
      ? Number(lastRow.endedAt)
      : Math.max(0, queryStartMs - 5_000);
  const nextAfterId =
    hasMore && lastRow ? String(lastRow.id) : (afterId ?? null);

  return context.json({
    intervals: rows.map((row) => ({
      ...row,
      startedAt: Number(row.startedAt),
      endedAt: Number(row.endedAt),
    })),
    serverTime: Date.now(),
    hasMore,
    nextCursor,
    nextAfterId,
  });
});

readingData.put("/api/activity", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar tu actividad." }, 401);

  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.intervals)
    ? (body.intervals as SyncActivityInput[])
    : [];
  const intervals = inputs
    .map(cleanActivity)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, ACTIVITY_LIMITS.batch);
  if (!intervals.length)
    return context.json({ error: "Faltan los intervalos." }, 400);

  const inserted = await withClient(context.env, async (client) => {
    let total = 0;
    for (const chunk of chunks(intervals)) {
      const result = await client.query(
      `INSERT INTO lecta_user_activity
         (user_id, id, book_hash, started_at, ended_at)
       SELECT $1,
              j.value ->> 'id', j.value ->> 'bookHash',
              (j.value ->> 'startedAt')::int8, (j.value ->> 'endedAt')::int8
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [session.user.id, JSON.stringify(chunk)],
      );
      total += result.rowCount ?? 0;
    }
    return total;
  });
  if (inserted === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({ ok: true, inserted });
});

// Historial de repasos. Mismo patrón que la actividad: anexable por id,
// PUT solo inserta los que faltan (ON CONFLICT DO NOTHING) y nunca edita.
readingData.get("/api/reviews", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para ver tus repasos." }, 401);

  const since = parseSinceParam(context.req.query("since"));
  const afterId = context.req.query("afterId")?.trim();
  const queryStartMs = Date.now();
  const LIMIT = 1000;

  const rows = await withClient(context.env, (client) => {
    if (afterId) {
      return client
        .query(
          `SELECT id, language, form, kind, rating, hints,
                  created_at AS "createdAt"
           FROM lecta_user_reviews
           WHERE user_id = $1 AND id > $2
           ORDER BY id ASC
           LIMIT ${LIMIT}`,
          [session.user.id, afterId],
        )
        .then((result) => result.rows);
    }
    if (since > 0) {
      return client
        .query(
          `SELECT id, language, form, kind, rating, hints,
                  created_at AS "createdAt"
           FROM lecta_user_reviews
           WHERE user_id = $1 AND created_at > $2
           ORDER BY created_at ASC, id ASC
           LIMIT ${LIMIT}`,
          [session.user.id, since],
        )
        .then((result) => result.rows);
    }
    return client
      .query(
        `SELECT id, language, form, kind, rating, hints,
                created_at AS "createdAt"
         FROM lecta_user_reviews
         WHERE user_id = $1
         ORDER BY id ASC
         LIMIT ${LIMIT}`,
        [session.user.id],
      )
      .then((result) => result.rows);
  });
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);

  const hasMore = rows.length === LIMIT;
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor =
    hasMore && lastRow
      ? Number(lastRow.createdAt)
      : Math.max(0, queryStartMs - 5_000);
  const nextAfterId =
    hasMore && lastRow ? String(lastRow.id) : (afterId ?? null);

  return context.json({
    reviews: rows.map((row) => ({
      ...row,
      hints: Number(row.hints),
      createdAt: Number(row.createdAt),
    })),
    serverTime: Date.now(),
    hasMore,
    nextCursor,
    nextAfterId,
  });
});

readingData.put("/api/reviews", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar tus repasos." }, 401);

  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.reviews)
    ? (body.reviews as SyncReviewInput[])
    : [];
  const reviews = inputs
    .map(cleanReview)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, REVIEW_LIMITS.batch);
  if (!reviews.length)
    return context.json({ error: "Faltan los repasos." }, 400);

  const inserted = await withClient(context.env, async (client) => {
    let total = 0;
    for (const chunk of chunks(reviews)) {
      const result = await client.query(
      `INSERT INTO lecta_user_reviews
         (user_id, id, language, form, kind, rating, hints, created_at)
       SELECT $1,
              j.value ->> 'id', j.value ->> 'language', j.value ->> 'form',
              j.value ->> 'kind', j.value ->> 'rating',
              (j.value ->> 'hints')::int4, (j.value ->> 'createdAt')::int8
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [session.user.id, JSON.stringify(chunk)],
      );
      total += result.rowCount ?? 0;
    }
    return total;
  });
  if (inserted === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({ ok: true, inserted });
});

// Posición de lectura por libro (continuidad entre dispositivos). Una
// fila por (user_id, book_hash); updated_at arbitra qué dispositivo
// escribió último, como en anotaciones y vocabulario.
readingData.get("/api/positions", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para ver tus posiciones." }, 401);

  const since = parseSinceParam(context.req.query("since"));
  const queryStartMs = Date.now();
  const LIMIT = 1000;

  const rows = await withClient(context.env, (client) => {
    if (since > 0) {
      return client
        .query(
          `SELECT book_hash AS "bookHash", section_index AS "sectionIndex",
                  scroll_top AS "scrollTop", ratio, progress, anchor,
                  updated_at AS "updatedAt"
           FROM lecta_user_positions
           WHERE user_id = $1 AND updated_at > $2
           ORDER BY updated_at ASC
           LIMIT ${LIMIT}`,
          [session.user.id, since],
        )
        .then((result) => result.rows);
    }
    return client
      .query(
        `SELECT book_hash AS "bookHash", section_index AS "sectionIndex",
                scroll_top AS "scrollTop", ratio, progress, anchor,
                updated_at AS "updatedAt"
         FROM lecta_user_positions
         WHERE user_id = $1
         ORDER BY updated_at ASC
         LIMIT ${LIMIT}`,
        [session.user.id],
      )
      .then((result) => result.rows);
  });
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);

  const hasMore = rows.length === LIMIT;
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor =
    hasMore && lastRow
      ? Number(lastRow.updatedAt)
      : Math.max(0, queryStartMs - 5_000);

  return context.json({
    positions: rows.map((row) => ({
      ...row,
      sectionIndex: Number(row.sectionIndex),
      scrollTop: Number(row.scrollTop),
      ratio: row.ratio != null ? Number(row.ratio) : null,
      progress: row.progress != null ? Number(row.progress) : null,
      updatedAt: Number(row.updatedAt),
    })),
    serverTime: Date.now(),
    hasMore,
    nextCursor,
  });
});

readingData.put("/api/positions", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar tu posición." }, 401);

  const serverNow = Date.now();
  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.positions)
    ? (body.positions as SyncPositionInput[])
    : [];
  const positions = inputs
    .map(cleanPosition)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map((item) => ({
      ...item,
      updatedAt: Math.min(item.updatedAt, serverNow),
    }))
    .slice(0, POSITION_LIMITS.batch);
  if (!positions.length)
    return context.json({ error: "Faltan las posiciones." }, 400);

  const upserted = await withClient(context.env, async (client) => {
    let total = 0;
    for (const chunk of chunks(positions)) {
      const result = await client.query(
      `INSERT INTO lecta_user_positions
         (user_id, book_hash, section_index, scroll_top, ratio, progress, anchor, updated_at)
       SELECT $1,
              j.value ->> 'bookHash',
              (j.value ->> 'sectionIndex')::int8,
              (j.value ->> 'scrollTop')::float8,
              (j.value ->> 'ratio')::float8,
              (j.value ->> 'progress')::float8,
              j.value ->> 'anchor',
              (j.value ->> 'updatedAt')::int8
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, book_hash) DO UPDATE SET
          section_index = excluded.section_index,
          scroll_top = excluded.scroll_top,
          ratio = excluded.ratio,
          progress = excluded.progress,
          anchor = excluded.anchor,
          updated_at = excluded.updated_at
       WHERE lecta_user_positions.updated_at < excluded.updated_at`,
      [session.user.id, JSON.stringify(chunk)],
      );
      total += result.rowCount ?? 0;
    }
    return total;
  });
  if (upserted === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({ ok: true, upserted });
});

// Modelo de conocimiento del lector: qué lemas sabe y cuáles no, una
// fila por (usuario, idioma, lema). Mismo patrón que /api/vocab: GET
// devuelve todo lo del usuario (con filtro opcional por idioma) y PUT
// fusiona con updated_at como árbitro, lápidas incluidas.
readingData.get("/api/knowledge", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para ver lo que conoces." }, 401);

  const language = context.req.query("language")?.trim();
  const since = parseSinceParam(context.req.query("since"));
  const queryStartMs = Date.now();
  const LIMIT = 1000;

  const resultData = await withClient(context.env, async (client) => {
    let queryPromise: Promise<{ rows: Record<string, unknown>[] }>;
    if (since > 0) {
      if (language) {
        queryPromise = client.query(
          `SELECT language, lemma, known, source,
                  updated_at AS "updatedAt", deleted
           FROM lecta_user_knowledge
           WHERE user_id = $1 AND language = $2 AND updated_at > $3
           ORDER BY updated_at ASC
           LIMIT ${LIMIT}`,
          [session.user.id, language, since],
        );
      } else {
        queryPromise = client.query(
          `SELECT language, lemma, known, source,
                  updated_at AS "updatedAt", deleted
           FROM lecta_user_knowledge
           WHERE user_id = $1 AND updated_at > $2
           ORDER BY updated_at ASC
           LIMIT ${LIMIT}`,
          [session.user.id, since],
        );
      }
    } else {
      if (language) {
        queryPromise = client.query(
          `SELECT language, lemma, known, source,
                  updated_at AS "updatedAt", deleted
           FROM lecta_user_knowledge
           WHERE user_id = $1 AND language = $2
           ORDER BY updated_at ASC
           LIMIT ${LIMIT}`,
          [session.user.id, language],
        );
      } else {
        queryPromise = client.query(
          `SELECT language, lemma, known, source,
                  updated_at AS "updatedAt", deleted
           FROM lecta_user_knowledge
           WHERE user_id = $1
           ORDER BY updated_at ASC
           LIMIT ${LIMIT}`,
          [session.user.id],
        );
      }
    }

    const langPromise = client
      .query(
        `SELECT DISTINCT language FROM lecta_user_knowledge WHERE user_id = $1`,
        [session.user.id],
      )
      .then((res) => res.rows)
      .catch(() => []);

    const [queryRes, langRows] = await Promise.all([queryPromise, langPromise]);
    return { rows: queryRes.rows, langRows };
  });

  if (resultData === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);

  const { rows, langRows } = resultData;
  const hasMore = rows.length === LIMIT;
  const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
  const nextCursor =
    hasMore && lastRow
      ? Number(lastRow.updatedAt)
      : Math.max(0, queryStartMs - 5_000);

  const availableLanguages = Array.from(
    new Set([
      ...langRows
        .map((r: { language?: unknown }) =>
          typeof r.language === "string" ? r.language.trim() : "",
        )
        .filter(Boolean),
      ...(language ? [language] : ["es"]),
    ]),
  );

  return context.json({
    rows: rows.map((row) => ({
      ...row,
      updatedAt: Number(row.updatedAt),
    })),
    serverTime: Date.now(),
    hasMore,
    nextCursor,
    availableLanguages,
  });
});

readingData.put("/api/knowledge", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar lo que conoces." }, 401);

  const serverNow = Date.now();
  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.rows)
    ? (body.rows as SyncKnowledgeInput[])
    : [];
  const rows = inputs
    .map(cleanKnowledge)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .map((item) => ({
      ...item,
      updatedAt: Math.min(item.updatedAt, serverNow),
    }))
    .slice(0, KNOWLEDGE_LIMITS.batch);
  if (!rows.length)
    return context.json({ error: "Faltan las palabras conocidas." }, 400);

  const upserted = await withClient(context.env, async (client) => {
    let total = 0;
    for (const chunk of chunks(rows)) {
      const result = await client.query(
      // Arbitraje convergente: la tupla la genera knowledgeArbSql
      // desde el mismo mapa de pesos que knowledgeArbWins — así el
      // servidor, punto de encuentro de los dispositivos, converge al
      // mismo ganador sin importar el orden de llegada.
      `INSERT INTO lecta_user_knowledge
         (user_id, language, lemma, known, source, updated_at, deleted)
       SELECT $1,
              j.value ->> 'language', j.value ->> 'lemma',
              (j.value ->> 'known')::bool, j.value ->> 'source',
              (j.value ->> 'updatedAt')::int8,
              COALESCE((j.value ->> 'deleted')::bool, false)
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, language, lemma) DO UPDATE SET
         known = excluded.known, source = excluded.source,
         updated_at = excluded.updated_at, deleted = excluded.deleted
       WHERE ${knowledgeArbSql("excluded")}
         > ${knowledgeArbSql("lecta_user_knowledge")}`,
      [session.user.id, JSON.stringify(chunk)],
      );
      total += result.rowCount ?? 0;
    }
    return total;
  });
  if (upserted === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({ ok: true, upserted });
});
