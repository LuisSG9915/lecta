import { Hono } from "hono";
import { withClient, getConnectionString, type WorkerEnv } from "./db";
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

  const rows = await withClient(context.env, (client) =>
    client
      .query(
        `SELECT book_hash AS "bookHash", id, kind, section_index AS "sectionIndex",
                anchor, text, prefix, suffix, note,
                created_at AS "createdAt", updated_at AS "updatedAt", deleted
         FROM lecta_user_annotations WHERE user_id = $1`,
        [session.user.id],
      )
      .then((result) => result.rows),
  );
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({
    annotations: rows.map((row) => ({
      ...row,
      key: `${row.bookHash}:${row.id}`,
      sectionIndex: Number(row.sectionIndex),
      createdAt: Number(row.createdAt),
      updatedAt: Number(row.updatedAt),
    })),
  });
});

readingData.put("/api/annotations", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar tus marcadores." }, 401);

  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.annotations)
    ? (body.annotations as SyncAnnotationInput[])
    : [];
  const annotations = inputs
    .map(cleanAnnotation)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, ANNOTATION_LIMITS.batch);
  if (!annotations.length)
    return context.json({ error: "Faltan las anotaciones." }, 400);

  const upserted = await withClient(context.env, async (client) => {
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
      [session.user.id, JSON.stringify(annotations)],
    );
    return result.rowCount ?? 0;
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

  const rows = await withClient(context.env, (client) =>
    client
      .query(
        `SELECT id, book_hash AS "bookHash",
                started_at AS "startedAt", ended_at AS "endedAt"
         FROM lecta_user_activity WHERE user_id = $1`,
        [session.user.id],
      )
      .then((result) => result.rows),
  );
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({
    intervals: rows.map((row) => ({
      ...row,
      startedAt: Number(row.startedAt),
      endedAt: Number(row.endedAt),
    })),
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
    const result = await client.query(
      `INSERT INTO lecta_user_activity
         (user_id, id, book_hash, started_at, ended_at)
       SELECT $1,
              j.value ->> 'id', j.value ->> 'bookHash',
              (j.value ->> 'startedAt')::int8, (j.value ->> 'endedAt')::int8
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [session.user.id, JSON.stringify(intervals)],
    );
    return result.rowCount ?? 0;
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

  const rows = await withClient(context.env, (client) =>
    client
      .query(
        `SELECT id, language, form, kind, rating, hints,
                created_at AS "createdAt"
         FROM lecta_user_reviews WHERE user_id = $1`,
        [session.user.id],
      )
      .then((result) => result.rows),
  );
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({
    reviews: rows.map((row) => ({
      ...row,
      hints: Number(row.hints),
      createdAt: Number(row.createdAt),
    })),
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
    const result = await client.query(
      `INSERT INTO lecta_user_reviews
         (user_id, id, language, form, kind, rating, hints, created_at)
       SELECT $1,
              j.value ->> 'id', j.value ->> 'language', j.value ->> 'form',
              j.value ->> 'kind', j.value ->> 'rating',
              (j.value ->> 'hints')::int4, (j.value ->> 'createdAt')::int8
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, id) DO NOTHING`,
      [session.user.id, JSON.stringify(reviews)],
    );
    return result.rowCount ?? 0;
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

  const rows = await withClient(context.env, (client) =>
    client
      .query(
        `SELECT book_hash AS "bookHash", section_index AS "sectionIndex",
                scroll_top AS "scrollTop", ratio, progress, anchor,
                updated_at AS "updatedAt"
         FROM lecta_user_positions WHERE user_id = $1`,
        [session.user.id],
      )
      .then((result) => result.rows),
  );
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({
    positions: rows.map((row) => ({
      ...row,
      sectionIndex: Number(row.sectionIndex),
      scrollTop: Number(row.scrollTop),
      ratio: row.ratio != null ? Number(row.ratio) : null,
      progress: row.progress != null ? Number(row.progress) : null,
      updatedAt: Number(row.updatedAt),
    })),
  });
});

readingData.put("/api/positions", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar tu posición." }, 401);

  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.positions)
    ? (body.positions as SyncPositionInput[])
    : [];
  const positions = inputs
    .map(cleanPosition)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, POSITION_LIMITS.batch);
  if (!positions.length)
    return context.json({ error: "Faltan las posiciones." }, 400);

  const upserted = await withClient(context.env, async (client) => {
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
      [session.user.id, JSON.stringify(positions)],
    );
    return result.rowCount ?? 0;
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
  const rows = await withClient(context.env, (client) =>
    client
      .query(
        language
          ? `SELECT language, lemma, known, source,
                    updated_at AS "updatedAt", deleted
             FROM lecta_user_knowledge
             WHERE user_id = $1 AND language = $2`
          : `SELECT language, lemma, known, source,
                    updated_at AS "updatedAt", deleted
             FROM lecta_user_knowledge
             WHERE user_id = $1`,
        language ? [session.user.id, language] : [session.user.id],
      )
      .then((result) => result.rows),
  );
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({
    rows: rows.map((row) => ({
      ...row,
      updatedAt: Number(row.updatedAt),
    })),
  });
});

readingData.put("/api/knowledge", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar lo que conoces." }, 401);

  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.rows)
    ? (body.rows as SyncKnowledgeInput[])
    : [];
  const rows = inputs
    .map(cleanKnowledge)
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .slice(0, KNOWLEDGE_LIMITS.batch);
  if (!rows.length)
    return context.json({ error: "Faltan las palabras conocidas." }, 400);

  const upserted = await withClient(context.env, async (client) => {
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
      [session.user.id, JSON.stringify(rows)],
    );
    return result.rowCount ?? 0;
  });
  if (upserted === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({ ok: true, upserted });
});
