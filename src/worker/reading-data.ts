import { Hono } from "hono";
import { withClient, getConnectionString, type WorkerEnv } from "./db";
import { getSession } from "./session";
import {
  cleanAnnotation,
  cleanActivity,
  ANNOTATION_LIMITS,
  ACTIVITY_LIMITS,
  type SyncAnnotationInput,
  type SyncActivityInput,
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
