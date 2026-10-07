import { Hono } from "hono";
import type pg from "pg";
import { getConnectionString, withClient, type WorkerEnv } from "./db";
import { getSession } from "./session";
import {
  COMPANION_ID_LIMIT,
  validateCompanionBatch,
  type CompanionBatch,
} from "../shared/companion-data";

// El compañero sincronizado por cuenta (el gato). PUT recibe un lote
// con las cuatro colecciones del snapshot y lo confirma en UNA
// transacción: baselines y journal son inmutables por clave (mismo id
// con otro contenido es conflicto 409), los registros del perfil
// arbitran por (updated_at, operation_id) como mergeCompanionRegister
// y las recepciones unen por sello mínimo. GET repasa cada colección
// en páginas de 120 ordenadas por su clave textual (keyset, sin
// OFFSET) para que el cliente re-escanee completo sin perderse nada.
export const companion = new Hono<{ Bindings: WorkerEnv }>();

// Tope del cuerpo del PUT: un lote legítimo (≤120 elementos) queda
// muy por debajo; lo que pase de aquí no se parsea siquiera.
const COMPANION_BODY_MAX_BYTES = 256 * 1024;
const COMPANION_PAGE_SIZE = 120;

// Conflicto de identidad: mismo id con payload distinto, sea dentro
// del lote o contra lo ya guardado. Lleva las claves que chocan para
// el log y la respuesta — nunca el contenido.
class CompanionConflictError extends Error {
  constructor(readonly conflicts: string[]) {
    super("companion batch conflict");
    this.name = "CompanionConflictError";
  }
}

// Claves del lote que llegan repetidas con payload distinto o que ya
// existen en la tabla con un payload JSONB diferente (= es semántico
// sobre jsonb: el orden de propiedades no cuenta). El validador del
// cliente ya rechaza la duplicación interna; esta red es la que
// garantiza la regla aunque el lote llegue por otro camino.
const conflictSql = (table: string, column: "origin_id" | "id") => `
  SELECT key FROM (
    SELECT i.${column} AS key
    FROM (
      SELECT j.value ->> '${column === "origin_id" ? "originId" : "id"}' AS ${column},
             j.value AS payload
      FROM jsonb_array_elements($2::jsonb) AS j(value)
    ) AS i
    GROUP BY i.${column}
    HAVING COUNT(DISTINCT i.payload) > 1
    UNION
    SELECT i.${column}
    FROM (
      SELECT j.value ->> '${column === "origin_id" ? "originId" : "id"}' AS ${column},
             j.value AS payload
      FROM jsonb_array_elements($2::jsonb) AS j(value)
    ) AS i
    JOIN ${table} b
      ON b.user_id = $1 AND b.${column} = i.${column}
    WHERE b.payload <> i.payload
  ) AS conflicts`;

// Ejecuta el lote completo en una transacción: primero se detectan
// conflictos de identidad (abortan antes de escribir nada) y después
// los cuatro merges, cada uno con su regla. Devuelve los ids que
// quedaron confirmados tras el commit.
async function applyBatch(
  client: pg.Client,
  userId: string,
  batch: CompanionBatch,
) {
  await client.query("BEGIN");
  try {
    const conflicts: string[] = [];
    for (const [table, column, rows] of [
      ["lecta_user_companion_baselines", "origin_id", batch.baselines],
      ["lecta_user_companion_events", "id", batch.events],
    ] as const) {
      if (!rows.length) continue;
      const result = await client.query(conflictSql(table, column), [
        userId,
        JSON.stringify(rows),
      ]);
      for (const row of result.rows as { key: string }[])
        conflicts.push(row.key);
    }
    if (conflicts.length) throw new CompanionConflictError(conflicts);

    if (batch.baselines.length)
      await client.query(
        `INSERT INTO lecta_user_companion_baselines (user_id, origin_id, payload)
         SELECT $1, j.value ->> 'originId', j.value
         FROM jsonb_array_elements($2::jsonb) AS j(value)
         ON CONFLICT (user_id, origin_id) DO NOTHING`,
        [userId, JSON.stringify(batch.baselines)],
      );

    if (batch.events.length)
      await client.query(
        `INSERT INTO lecta_user_companion_events (user_id, id, payload)
         SELECT $1, j.value ->> 'id', j.value
         FROM jsonb_array_elements($2::jsonb) AS j(value)
         ON CONFLICT (user_id, id) DO NOTHING`,
        [userId, JSON.stringify(batch.events)],
      );

    if (batch.fields.length)
      // Si el lote trae varias escrituras del mismo campo gana la de
      // mayor sello dentro del lote (DISTINCT ON), y contra lo guardado
      // arbitra la misma tupla (updated_at, operation_id) que usa
      // mergeCompanionRegister — el null viaja como jsonb 'null', que
      // es dato legítimo (una prenda quitada), no ausencia de fila.
      await client.query(
        `INSERT INTO lecta_user_companion_fields
           (user_id, field, value, updated_at, operation_id)
         SELECT $1, w.field, w.value, w.updated_at, w.operation_id
         FROM (
           SELECT DISTINCT ON (i.field)
                  i.field, i.value, i.updated_at, i.operation_id
           FROM (
             SELECT j.value ->> 'field' AS field,
                    j.value -> 'value' AS value,
                    (j.value ->> 'updatedAt')::int8 AS updated_at,
                    j.value ->> 'operationId' AS operation_id
             FROM jsonb_array_elements($2::jsonb) AS j(value)
           ) AS i
           ORDER BY i.field, i.updated_at DESC, i.operation_id DESC
         ) AS w
         ON CONFLICT (user_id, field) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           operation_id = excluded.operation_id
         WHERE (excluded.updated_at, excluded.operation_id)
             > (lecta_user_companion_fields.updated_at,
                lecta_user_companion_fields.operation_id)`,
        [userId, JSON.stringify(batch.fields)],
      );

    if (batch.receipts.length)
      // Una recepción repetida dentro del lote se une primero por
      // sello mínimo (GROUP BY); contra la tabla la regla es la misma.
      await client.query(
        `INSERT INTO lecta_user_companion_receipts (user_id, id, at)
         SELECT $1, w.id, w.at
         FROM (
           SELECT i.id, MIN(i.at) AS at
           FROM (
             SELECT j.value ->> 'id' AS id, (j.value ->> 'at')::int8 AS at
             FROM jsonb_array_elements($2::jsonb) AS j(value)
           ) AS i
           GROUP BY i.id
         ) AS w
         ON CONFLICT (user_id, id) DO UPDATE SET
           at = LEAST(lecta_user_companion_receipts.at, excluded.at)`,
        [userId, JSON.stringify(batch.receipts)],
      );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }

  // Lo enviado quedó confirmado por el commit: para baselines y
  // journal «confirmado» incluye los ya-existentes-idénticos (el
  // insert fue no-op pero el dato está); para registros, cada
  // operationId ya tiene veredicto — ganó o quedó superado por un
  // sello mayor, decisión final que no cambia reenviando.
  return {
    baselines: [...new Set(batch.baselines.map((b) => b.originId))],
    events: [...new Set(batch.events.map((e) => e.id))],
    fields: [...new Set(batch.fields.map((f) => f.operationId))],
    receipts: [...new Set(batch.receipts.map((r) => r.id))],
  };
}

companion.put("/api/companion", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar a tu compañero." }, 401);

  // El tamaño se mide antes de parsear: primero el encabezado si
  // viaja, y siempre el cuerpo crudo — un content-length mentiroso no
  // abre la puerta.
  const declared = Number(context.req.header("content-length") ?? 0);
  if (declared > COMPANION_BODY_MAX_BYTES)
    return context.json({ error: "El lote es demasiado grande." }, 413);
  const raw = await context.req.raw.arrayBuffer().catch(() => null);
  if (raw === null || raw.byteLength > COMPANION_BODY_MAX_BYTES)
    return context.json({ error: "El lote es demasiado grande." }, 413);

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    /* cuerpo que no es JSON: cae al 400 de abajo */
  }
  const validated = validateCompanionBatch(parsed);
  if (!validated.ok)
    return context.json(
      { error: "El lote del compañero no es válido.", reason: validated.reason },
      400,
    );
  const batch = validated.batch;

  // Un reintento por error de serialización (40001) es seguro: el
  // lote completo es idempotente y la transacción se repite entera.
  let accepted;
  try {
    accepted = await withClient(context.env, async (client) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await applyBatch(client, session.user.id, batch);
        } catch (err) {
          const code = (err as { code?: string } | null)?.code;
          if (code !== "40001" || attempt === 2) throw err;
        }
      }
      return undefined as never;
    });
  } catch (err) {
    if (err instanceof CompanionConflictError)
      return context.json(
        {
          error: "El lote choca con datos que el servidor ya guardó.",
          conflicts: err.conflicts,
        },
        409,
      );
    return context.json(
      { error: "No se pudo guardar a tu compañero." },
      503,
    );
  }
  if (accepted === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  return context.json({ ok: true, accepted });
});

// ---------- Lectura paginada por clave ----------
//
// Cada colección responde en páginas de COMPANION_PAGE_SIZE ordenadas
// por su clave textual; `after` es la última clave entregada y la
// consulta pide una fila de más para saber si queda página siguiente.
// Los int8 vuelven como texto del driver y pasan por Number() — son
// sellos en ms, lejos de 2^53.

type CompanionKind = "baselines" | "events" | "fields" | "receipts";

const PAGE_QUERIES: Record<
  CompanionKind,
  { table: string; column: string; select: string }
> = {
  baselines: {
    table: "lecta_user_companion_baselines",
    column: "origin_id",
    select: "payload",
  },
  events: {
    table: "lecta_user_companion_events",
    column: "id",
    select: "payload",
  },
  fields: {
    table: "lecta_user_companion_fields",
    column: "field",
    select: 'field, value, updated_at AS "updatedAt", operation_id AS "operationId"',
  },
  receipts: {
    table: "lecta_user_companion_receipts",
    column: "id",
    select: "id, at",
  },
};

companion.get("/api/companion", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para ver a tu compañero." }, 401);

  const kind = context.req.query("kind") as CompanionKind | undefined;
  if (!kind || !(kind in PAGE_QUERIES))
    return context.json(
      { error: "Indica qué datos del compañero quieres ver." },
      400,
    );
  const after = context.req.query("after");
  if (
    after !== undefined &&
    (after.length === 0 || after.length > COMPANION_ID_LIMIT)
  )
    return context.json({ error: "El cursor no es válido." }, 400);

  const { table, column, select } = PAGE_QUERIES[kind];
  let rows;
  try {
    rows = await withClient(context.env, async (client) => {
      const result = await client.query(
        `SELECT ${select} FROM ${table}
         WHERE user_id = $1 AND ($2::text IS NULL OR ${column} > $2)
         ORDER BY ${column}
         LIMIT ${COMPANION_PAGE_SIZE + 1}`,
        [session.user.id, after ?? null],
      );
      return result.rows;
    });
  } catch {
    return context.json(
      { error: "No se pudo leer a tu compañero." },
      503,
    );
  }
  if (rows === undefined)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);

  const page = rows.slice(0, COMPANION_PAGE_SIZE);
  const items = page.map((row) => {
    switch (kind) {
      case "baselines":
      case "events":
        return row.payload;
      case "fields":
        return {
          field: row.field,
          value: row.value,
          updatedAt: Number(row.updatedAt),
          operationId: row.operationId,
        };
      case "receipts":
        return { id: row.id, at: Number(row.at) };
    }
  });
  const keyOf = (item: unknown): string => {
    switch (kind) {
      case "baselines":
        return (item as { originId: string }).originId;
      case "events":
      case "receipts":
        return (item as { id: string }).id;
      case "fields":
        return (item as { field: string }).field;
    }
  };
  const nextCursor =
    rows.length > COMPANION_PAGE_SIZE ? keyOf(items[items.length - 1]) : null;
  return context.json({ items, nextCursor });
});
