import { Hono } from "hono";
import { getConnectionString, withClient, type WorkerEnv } from "./db";
import {
  findEntries,
  findEntriesForForms,
  insertEnrichment,
  pendingEnrichmentJobs,
  sampleForCalibration,
} from "./lexicon";
import {
  ENRICHMENT_MODEL,
  ITEM_CALL_OPTIONS,
  ITEM_SYSTEM_PROMPT,
  VERIFY_CALL_OPTIONS,
  VERIFY_SYSTEM_PROMPT,
  buildItemPrompt,
  buildVerifyPrompt,
  callDeepSeek,
  logAiCall,
  parseItem,
  parseVerify,
  requestEnrichment,
} from "./ai";
import { createAuth } from "./auth";
import { isStopword } from "../shared/stopwords";
import { hasUsableDefinition } from "../shared/lexicon";
import { checkEpubHeader, EPUB_MAX_BYTES } from "../shared/epub-check";
import { getSession } from "./session";
import { readingData } from "./reading-data";

export const app = new Hono<{ Bindings: WorkerEnv }>();
app.route("/", readingData);

app.get("/api/health", (context) => context.json({ status: "ok" }));

app.on(["GET", "POST"], "/api/auth/*", (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "La autenticación no está configurada." }, 503);
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.req.url).origin;
  return createAuth(context.env, baseURL).handler(context.req.raw);
});

app.get("/api/lexicon/lookup", async (context) => {
  const form = context.req.query("form")?.trim();
  const language = context.req.query("lang")?.trim() || "es";
  if (!form || form.length > 100) return context.json({ found: false }, 400);

  let entries;
  try {
    entries = await withClient(context.env, (client) => findEntries(client, language, form));
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!entries) return context.json({ error: "El catálogo no está configurado." }, 503);
  return context.json(
    { found: entries.length > 0, entries },
    entries.length > 0 ? 200 : 404,
  );
});

// Muestra de lemas para la calibración inicial de vocabulario:
// lectura pública del catálogo, como lookup/batch (sin sesión).
// `definition` sale null cuando el lema no tiene acepción cargada —
// la fila se ofrece igual y al marcarla no hay revelado.
// Hoy solo hay muestra en español — es el único idioma con catálogo
// y medición zipf completa.
app.get("/api/lexicon/sample", async (context) => {
  const language = context.req.query("language")?.trim() || "es";
  if (language !== "es")
    return context.json({ error: "La muestra solo existe en español por ahora." }, 400);

  let words;
  try {
    words = await withClient(context.env, (client) =>
      sampleForCalibration(client, language),
    );
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!words) return context.json({ error: "El catálogo no está configurado." }, 503);
  return context.json({ words });
});

app.post("/api/lexicon/batch", async (context) => {
  const body = await context.req.json().catch(() => null);
  const forms = Array.isArray(body?.forms)
    ? body.forms.filter((form: unknown) => typeof form === "string").slice(0, 2000)
    : [];
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  if (!forms.length) return context.json({ error: "Faltan las palabras." }, 400);

  let entries;
  try {
    entries = await withClient(context.env, (client) =>
      findEntriesForForms(client, language, forms),
    );
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!entries) return context.json({ error: "El catálogo no está configurado." }, 503);
  return context.json({ entries });
});

app.post("/api/lexicon/enrich", async (context) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const contextText = typeof body?.context === "string" ? body.context.slice(0, 500) : undefined;
  if (!form || form.length > 100) return context.json({ error: "Falta la palabra." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);

  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para definir palabras con IA." }, 401);
  if (isStopword(form, language))
    return context.json({ error: "«" + form + "» es una palabra muy común; no necesita ficha de IA." }, 400);

  let result;
  try {
    const existing = await withClient(context.env, (client) =>
      findEntries(client, language, form),
    );
    if (existing === undefined)
      return context.json({ error: "El catálogo no está configurado." }, 503);
    if (hasUsableDefinition(existing)) {
      result = { status: "existing" as const, entries: existing };
    } else {
      const allowed = await consumeRateUnits(context.env, session.user.id, 1);
      if (!allowed)
        return context.json(
          { error: "Llegaste al límite de definiciones con IA por hora. Intenta más tarde." },
          429,
        );
      const ai = await requestEnrichment(context.env, { form, language, context: contextText });
      if (!ai.ok) {
        result = { status: ai.reason } as const;
      } else {
        const entries = await withClient(context.env, async (client) => {
          await insertEnrichment(client, language, ai.enrichment, form);
          return findEntries(client, language, form);
        });
        result = { status: "created" as const, entries: entries ?? [] };
      }
    }
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!result) return context.json({ error: "El catálogo no está configurado." }, 503);
  switch (result.status) {
    case "existing":
      return context.json({ status: "existing", entries: result.entries });
    case "created":
      return context.json({ status: "created", entries: result.entries });
    case "not-configured":
      return context.json({ error: "El enriquecimiento no está configurado." }, 503);
    default:
      return context.json({ error: "La IA no devolvió una ficha válida." }, 502);
  }
});

app.post("/api/lexicon/enrich-batch", async (context) => {
  const body = await context.req.json().catch(() => null);
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const rawForms: string[] = Array.isArray(body?.forms)
    ? body.forms.filter((f: unknown): f is string => typeof f === "string").slice(0, 200)
    : [];
  // Las stopwords no gastan cuota ni IA: el workflow las omitiría igual.
  const forms = [...new Set(rawForms.map((f) => f.trim().toLowerCase()))]
    .filter((f) => f && !isStopword(f, language))
    .slice(0, 50);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  if (!context.env.ENRICHMENT_WORKFLOW)
    return context.json({ error: "El procesamiento por lotes no está configurado." }, 503);

  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para definir palabras con IA." }, 401);
  if (!forms.length) return context.json({ count: 0, skipped: rawForms.length });

  let pending;
  try {
    const catalog = await withClient(context.env, (client) =>
      findEntriesForForms(client, language, forms),
    );
    if (catalog === undefined)
      return context.json({ error: "El catálogo no está configurado." }, 503);
    pending = pendingEnrichmentJobs(forms, catalog);
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }
  if (!pending.length)
    return context.json({ count: 0, skipped: rawForms.length });

  const allowed = await consumeRateUnits(context.env, session.user.id, pending.length);
  if (!allowed)
    return context.json(
      { error: "Llegaste al límite de definiciones con IA por hora. Intenta más tarde." },
      429,
    );

  const instance = await context.env.ENRICHMENT_WORKFLOW.create({
    params: { forms: pending.map((job) => job.form), language },
  });
  return context.json({ instanceId: instance.id, count: pending.length }, 202);
});

// Los ids del catálogo son INT8 de unique_rowid() (~1.2e18 > 2^53):
// por JSON viajan como string de dígitos, porque un number los
// truncaría (…305 → …300). Se acepta también un entero y se
// canoniza («007» → «7»); Postgres castea el texto a int8/int4.
const INT8_MAX = 9223372036854775807n;
const toCatalogId = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1)
    return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = BigInt(trimmed);
  return id >= 1n && id <= INT8_MAX ? id.toString() : null;
};

// Reporte «esta acepción no corresponde»: solo sube el contador
// editorial de la fila de lexicon_senses; no crea ni edita fichas.
app.post("/api/lexicon/report", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para reportar una acepción." }, 401);

  const body = await context.req.json().catch(() => null);
  const entryId = toCatalogId(body?.entryId);
  const senseOrder = toCatalogId(body?.senseOrder);
  if (entryId === null || senseOrder === null)
    return context.json({ error: "Falta la acepción que reportar." }, 400);

  const reports = await withClient(context.env, async (client) => {
    const result = await client.query(
      `UPDATE lexicon_senses SET reports = reports + 1
       WHERE entry_id = $1 AND sense_order = $2
       RETURNING reports`,
      [entryId, senseOrder],
    );
    if (!result.rowCount) return null;
    return Number(result.rows[0]?.reports ?? 0);
  });
  if (reports === undefined)
    return context.json({ error: "El catálogo no está configurado." }, 503);
  if (reports === null)
    return context.json({ error: "Esa acepción no existe." }, 404);
  return context.json({ ok: true, reports });
});

// ---------- Ítems de ejercicio (Nivel B) ----------
//
// Un ítem por acepción (tabla lexicon_items, migración 006): una
// oración nueva generada por IA más tres definiciones distractoras,
// validada por reglas al insertar (status 'auto_validado'). Sirve
// tanto para «elegir el significado en contexto» como para
// «completar la oración».

// entryId viaja como string de dígitos (int8 > 2^53): las llaves de
// dedupe y las comparaciones internas se hacen con el texto canónico.
type ItemRef = { entryId: string; senseOrder: string };
const MAX_ITEM_REFS = 50;
// Las llamadas a la IA son secuenciales y con timeout de 45 s: generar
// muchas en una sola petición haría esperar de más al cliente.
const MAX_ITEMS_GENERATED_PER_CALL = 8;

const toItemRef = (value: unknown): ItemRef | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const entryId = toCatalogId(raw.entryId);
  const senseOrder = toCatalogId(raw.senseOrder);
  return entryId !== null && senseOrder !== null ? { entryId, senseOrder } : null;
};

const refKey = (ref: ItemRef) => `${ref.entryId}:${ref.senseOrder}`;

type LexiconItemRow = {
  id: string;
  entry_id: string | number;
  sense_order: string | number;
  sentence: string;
  distractors: unknown;
  attempts: string | number;
  correct: string | number;
  definition: string;
};

// Barajado determinista con semilla del id del ítem: la posición de la
// respuesta correcta es estable entre peticiones y dispositivos (mismo
// esquema mulberry32 que la mezcla de opciones del repaso en el
// cliente, src/client/lib/practice.ts).
const seedFromId = (id: string) => {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

function shuffleSeeded<T>(items: T[], seed: number): T[] {
  const result = [...items];
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Forma de respuesta: `options` mezcla la definición correcta con los
// distractores y `answerIndex` marca cuál es la buena. Decisión: no
// devolver `distractors` por separado — el cliente ya conoce la
// acepción (la trajo con la ficha) y lo único que necesita del ítem
// es la pregunta lista para mostrar; una sola lista con índice evita
// que la correcta se distinga por posición fija o por un campo aparte.
function toItemResponse(row: LexiconItemRow) {
  const definition = row.definition.trim();
  const distractors = (
    Array.isArray(row.distractors)
      ? row.distractors.filter((d): d is string => typeof d === "string")
      : []
  ).filter((d) => d.trim().toLowerCase() !== definition.toLowerCase());
  const options = shuffleSeeded([definition, ...distractors], seedFromId(row.id));
  return {
    id: row.id,
    entryId: String(row.entry_id),
    senseOrder: Number(row.sense_order),
    sentence: row.sentence,
    options,
    answerIndex: options.indexOf(definition),
    attempts: Number(row.attempts),
    correct: Number(row.correct),
  };
}

const ITEM_SELECT_SQL = `
  SELECT i.id, i.entry_id, i.sense_order, i.sentence, i.distractors,
         i.attempts, i.correct, s.definition
  FROM lexicon_items i
  JOIN lexicon_senses s
    ON s.entry_id = i.entry_id AND s.sense_order = i.sense_order
`;

app.post("/api/lexicon/items", async (context) => {
  const body = await context.req.json().catch(() => null);
  const rawRefs: unknown[] = Array.isArray(body?.refs) ? body.refs : [];
  const refs = [
    ...new Map(
      rawRefs
        .map(toItemRef)
        .filter((ref): ref is ItemRef => ref !== null)
        .map((ref) => [refKey(ref), ref] as const),
    ).values(),
  ].slice(0, MAX_ITEM_REFS);
  if (!refs.length) return context.json({ error: "Faltan las acepciones." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para practicar." }, 401);

  const items: ReturnType<typeof toItemResponse>[] = [];
  try {
    // Una sola conexión para leer: los ítems existentes (son del
    // catálogo compartido, no por cuenta) y los sentidos de los refs
    // que falten por generar.
    const catalog = await withClient(context.env, async (client) => {
      const existing = await client.query<LexiconItemRow>(
        `${ITEM_SELECT_SQL}
         JOIN (
           SELECT (j.value ->> 'entryId')::int8 AS entry_id,
                  (j.value ->> 'senseOrder')::int4 AS sense_order
           FROM jsonb_array_elements($1::jsonb) AS j(value)
         ) r ON r.entry_id = i.entry_id AND r.sense_order = i.sense_order
         WHERE i.status <> 'rechazado'`,
        [JSON.stringify(refs)],
      );
      const found = new Set(
        existing.rows.map((row) =>
          refKey({ entryId: String(row.entry_id), senseOrder: String(row.sense_order) }),
        ),
      );
      const missing = refs.filter((ref) => !found.has(refKey(ref)));
      const senses = missing.length
        ? await client.query<{
            entry_id: string | number;
            sense_order: string | number;
            lemma: string;
            pos: string | null;
            definition: string;
          }>(
            `SELECT r.entry_id, r.sense_order, e.lemma, e.pos, s.definition
             FROM (
               SELECT (j.value ->> 'entryId')::int8 AS entry_id,
                      (j.value ->> 'senseOrder')::int4 AS sense_order
               FROM jsonb_array_elements($1::jsonb) AS j(value)
             ) r
             JOIN lexicon_senses s
               ON s.entry_id = r.entry_id AND s.sense_order = r.sense_order
             JOIN lexicon_entries e ON e.id = s.entry_id`,
            [JSON.stringify(missing)],
          )
        : { rows: [] };
      return { existing: existing.rows, missing, senses: senses.rows };
    });
    if (catalog === undefined)
      return context.json({ error: "El catálogo no está configurado." }, 503);

    for (const row of catalog.existing) items.push(toItemResponse(row));
    const senseByRef = new Map(
      catalog.senses.map((row) => [
        refKey({ entryId: String(row.entry_id), senseOrder: String(row.sense_order) }),
        row,
      ]),
    );

    // Generación: una unidad de cuota por ítem intentado (como en
    // enrich, que cobra antes de llamar a la IA). Si la cuota se
    // agota a media tanda se devuelve lo ya reunido, sin error.
    for (const ref of catalog.missing.slice(0, MAX_ITEMS_GENERATED_PER_CALL)) {
      const sense = senseByRef.get(refKey(ref));
      if (!sense) continue;
      const allowed = await consumeRateUnits(
        context.env,
        session.user.id,
        1,
        ITEM_UNITS_PER_HOUR,
        "item",
      );
      if (!allowed) break;
      const ai = await callDeepSeek(context.env, {
        system: ITEM_SYSTEM_PROMPT,
        user: buildItemPrompt(sense.lemma, sense.pos, sense.definition),
      }, ITEM_CALL_OPTIONS);
      const parsed =
        ai.ok && ai.finishReason !== "length" ? parseItem(ai.content) : null;
      logAiCall(
        ITEM_CALL_OPTIONS,
        ai,
        !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
      );
      if (!ai.ok) continue;
      if (!parsed) continue;
      const row = await withClient(context.env, async (client) => {
        const inserted = await client.query<LexiconItemRow>(
          `INSERT INTO lexicon_items
             (id, entry_id, sense_order, sentence, distractors, status,
              model_version, prompt_version, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, 'auto_validado', $6, $7, $8)
           ON CONFLICT (entry_id, sense_order) DO NOTHING
           RETURNING id, entry_id, sense_order, sentence, distractors, attempts, correct`,
          [
            crypto.randomUUID(),
            ref.entryId,
            ref.senseOrder,
            parsed.sentence,
            JSON.stringify(parsed.distractors),
            ENRICHMENT_MODEL,
            ITEM_CALL_OPTIONS.promptVersion,
            Date.now(),
          ],
        );
        if (inserted.rows[0])
          return { ...inserted.rows[0], definition: sense.definition };
        // Carrera: otra petición generó el mismo ítem; se sirve el que
        // quedó insertado (si no está rechazado).
        const raced = await client.query<LexiconItemRow>(
          `${ITEM_SELECT_SQL}
           WHERE i.entry_id = $1 AND i.sense_order = $2 AND i.status <> 'rechazado'`,
          [ref.entryId, ref.senseOrder],
        );
        return raced.rows[0] ?? null;
      });
      if (row) items.push(toItemResponse(row));
    }
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }
  return context.json({ items });
});

// Registro de intentos del ejercicio: sube attempts siempre y correct
// solo cuando el cliente reporta acierto.
app.post("/api/lexicon/items/answer", async (context) => {
  const body = await context.req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const correct = body?.correct;
  if (!id || id.length > 64 || typeof correct !== "boolean")
    return context.json({ error: "Falta la respuesta." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para practicar." }, 401);

  const updated = await withClient(context.env, async (client) => {
    const result = await client.query(
      `UPDATE lexicon_items
       SET attempts = attempts + 1, correct = correct + $2
       WHERE id = $1`,
      [id, correct ? 1 : 0],
    );
    return result.rowCount ?? 0;
  });
  if (updated === undefined)
    return context.json({ error: "El catálogo no está configurado." }, 503);
  if (!updated) return context.json({ error: "Ese ejercicio no existe." }, 404);
  return context.json({ ok: true });
});

// Corrección IA de la oración que el usuario escribe con una palabra
// (ejercicio «write»). Privacidad: solo viajan la forma, el sentido
// esperado y el texto propio del usuario — nunca el contexto del libro
// ni identificadores de ficha o cuenta (la sesión solo gobierna cuota).
app.post("/api/lexicon/verify-sentence", async (context) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const meaning = typeof body?.meaning === "string" ? body.meaning.trim() : "";
  const sentence = typeof body?.sentence === "string" ? body.sentence.trim() : "";
  if (!form || form.length > 100 || !meaning || meaning.length > 500 || !sentence || sentence.length > 300)
    return context.json({ error: "Falta la oración o la palabra." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para practicar." }, 401);

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    VERIFY_UNITS_PER_HOUR,
    "verify",
  );
  if (!allowed)
    return context.json(
      { error: "Llegaste al límite de correcciones por hora. Intenta más tarde." },
      429,
    );

  const ai = await callDeepSeek(context.env, {
    system: VERIFY_SYSTEM_PROMPT,
    user: buildVerifyPrompt(form, meaning, sentence),
  }, VERIFY_CALL_OPTIONS);
  const parsed =
    ai.ok && ai.finishReason !== "length" ? parseVerify(ai.content) : null;
  logAiCall(
    VERIFY_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );
  if (!ai.ok)
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "La corrección no está configurada."
            : "La IA no pudo revisar la oración.",
      },
      ai.reason === "not-configured" ? 503 : 502,
    );
  if (!parsed)
    return context.json({ error: "La IA no devolvió una corrección válida." }, 502);
  return context.json({ correct: parsed.correct, feedback: parsed.feedback });
});

// Presupuestos por hora y por alcance: cada función IA gasta de su
// propia bolsa (columna scope de lecta_rate_log), así una tanda de
// ítems o de correcciones no consume la cuota de enriquecimiento.
const ENRICH_UNITS_PER_HOUR = 60;
const ITEM_UNITS_PER_HOUR = 24;
const VERIFY_UNITS_PER_HOUR = 30;
const HOUR_MS = 3_600_000;

// Suma `units` a la ventana de la última hora del scope dado y la
// registra en la misma consulta; devuelve false cuando la cuenta ya
// llegó al límite.
async function consumeRateUnits(
  env: WorkerEnv,
  userId: string,
  units: number,
  limit = ENRICH_UNITS_PER_HOUR,
  scope = "enrich",
) {
  const now = Date.now();
  const result = await withClient(env, (client) =>
    client.query(
      `WITH cnt AS (
         SELECT COALESCE(SUM(units), 0)::int8 AS total
         FROM lecta_rate_log
         WHERE user_id = $1 AND scope = $5 AND created_at > $2
       ), ins AS (
         INSERT INTO lecta_rate_log (user_id, units, scope, created_at)
         SELECT $1, $3, $5, $4 FROM cnt WHERE cnt.total + $3 <= $6
         RETURNING 1
       )
       SELECT EXISTS (SELECT 1 FROM ins) AS allowed`,
      [userId, now - HOUR_MS, units, now, scope, limit],
    ),
  );
  return result?.rows[0]?.allowed === true;
}

const bookKey = (userId: string, hash: string) => `books/${userId}/${hash}.epub`;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

app.get("/api/books", async (context) => {
  if (!context.env.BOOKS)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver tus libros." }, 401);

  const listed = await context.env.BOOKS.list({ prefix: `books/${session.user.id}/` });
  return context.json({
    books: listed.objects.map((object) => ({
      hash: object.key.split("/").pop()?.replace(/\.epub$/, ""),
      uploaded: object.uploaded,
      name: object.customMetadata?.name ?? "",
    })),
  });
});

app.put("/api/books/:hash", async (context) => {
  if (!context.env.BOOKS)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para guardar libros." }, 401);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);
  const data = new Uint8Array(await context.req.arrayBuffer());
  if (!data.byteLength || data.byteLength > EPUB_MAX_BYTES)
    return context.json({ error: "Archivo vacío o demasiado grande (máximo 50 MB)." }, 400);
  if (!checkEpubHeader(data).ok)
    return context.json({ error: "El archivo no es un EPUB válido." }, 400);
  // El hash de la ruta es la identidad del libro: tiene que corresponder
  // al contenido subido, no servir solo como nombre de la llave.
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (hex !== hash)
    return context.json({ error: "El contenido no coincide con el identificador declarado." }, 400);

  await context.env.BOOKS.put(bookKey(session.user.id, hash), data, {
    httpMetadata: { contentType: "application/epub+zip" },
    customMetadata: { name: context.req.query("name")?.slice(0, 200) ?? "" },
  });
  return context.json({ ok: true });
});

app.get("/api/books/:hash", async (context) => {
  if (!context.env.BOOKS)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver tus libros." }, 401);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  const object = await context.env.BOOKS.get(bookKey(session.user.id, hash));
  if (!object) return context.json({ error: "Libro no encontrado." }, 404);
  return new Response(object.body, {
    headers: { "content-type": "application/epub+zip" },
  });
});

app.delete("/api/books/:hash", async (context) => {
  if (!context.env.BOOKS)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para borrar libros." }, 401);

  const hash = context.req.param("hash");
  if (!HASH_PATTERN.test(hash))
    return context.json({ error: "Identificador de libro inválido." }, 400);

  await context.env.BOOKS.delete(bookKey(session.user.id, hash));
  return context.json({ ok: true });
});

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
  savedAt?: unknown;
  updatedAt?: unknown;
  deleted?: unknown;
};

const cleanText = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : undefined;
const cleanNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
// Ids de catálogo opcionales: entero ≥0 o string de dígitos; null si
// llega otra cosa. sense_entry_id es int8 > 2^53 y viaja como string —
// el SQL lo castea con ::int8/::int4 al insertar.
const cleanId = (value: unknown): number | string | null => {
  const n = cleanNumber(value);
  if (n != null && n >= 0) return Math.floor(n);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return null;
};

app.get("/api/vocab", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver tu vocabulario." }, 401);
  const language = context.req.query("lang")?.trim() || "es";

  const rows = await withClient(context.env, (client) =>
    client
      .query(
        `SELECT language, form, lemma, pos, meaning, context, book_hash AS "bookHash",
                sense_entry_id AS "senseEntryId", sense_order AS "senseOrder",
                card, saved_at AS "savedAt", updated_at AS "updatedAt", deleted
         FROM lecta_user_words WHERE user_id = $1 AND language = $2`,
        [session.user.id, language],
      )
      .then((result) => result.rows),
  );
  if (rows === undefined)
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  return context.json({
    words: rows.map((row) => ({
      ...row,
      key: `${row.language}:${row.form.toLowerCase()}`,
      // int8 > 2^53: se devuelve como string; un Number lo truncaría.
      senseEntryId: row.senseEntryId != null ? String(row.senseEntryId) : null,
      senseOrder: row.senseOrder != null ? Number(row.senseOrder) : null,
      savedAt: Number(row.savedAt),
      updatedAt: Number(row.updatedAt),
      card: typeof row.card === "string" ? JSON.parse(row.card) : row.card,
    })),
  });
});

app.put("/api/vocab", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para guardar tu vocabulario." }, 401);

  const body = await context.req.json().catch(() => null);
  const inputs = Array.isArray(body?.words) ? (body.words as UserWordInput[]) : [];
  const words = inputs
    .map((input) => {
      const form = cleanText(input.form, 100)?.trim().toLowerCase();
      const language = cleanText(input.language, 10)?.trim() || "es";
      const updatedAt = cleanNumber(input.updatedAt) ?? Date.now();
      if (!form) return null;
      return {
        form,
        language,
        lemma: cleanText(input.lemma, 100) ?? null,
        pos: cleanText(input.pos, 30) ?? null,
        meaning: cleanText(input.meaning, 500) ?? null,
        context: cleanText(input.context, 500) ?? null,
        bookHash: cleanText(input.bookHash, 80) ?? null,
        senseEntryId: cleanId(input.senseEntryId),
        senseOrder: cleanId(input.senseOrder),
        card: input.card ?? null,
        savedAt: cleanNumber(input.savedAt) ?? updatedAt,
        updatedAt,
        deleted: input.deleted === true,
      };
    })
    .filter((word): word is NonNullable<typeof word> => word !== null)
    .slice(0, 500);
  if (!words.length) return context.json({ error: "Faltan las palabras." }, 400);

  const upserted = await withClient(context.env, async (client) => {
    const result = await client.query(
      `INSERT INTO lecta_user_words
         (user_id, language, form, lemma, pos, meaning, context, book_hash,
          sense_entry_id, sense_order, card, saved_at, updated_at, deleted)
       SELECT $1,
              j.value ->> 'language', j.value ->> 'form', j.value ->> 'lemma',
              j.value ->> 'pos', j.value ->> 'meaning', j.value ->> 'context',
              j.value ->> 'bookHash',
              (j.value ->> 'senseEntryId')::int8, (j.value ->> 'senseOrder')::int4,
              j.value -> 'card',
              (j.value ->> 'savedAt')::int8, (j.value ->> 'updatedAt')::int8,
              COALESCE((j.value ->> 'deleted')::bool, false)
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, language, form) DO UPDATE SET
         lemma = excluded.lemma, pos = excluded.pos, meaning = excluded.meaning,
         context = excluded.context, book_hash = excluded.book_hash,
         sense_entry_id = excluded.sense_entry_id,
         sense_order = excluded.sense_order,
         card = excluded.card, updated_at = excluded.updated_at,
         deleted = excluded.deleted
       WHERE lecta_user_words.updated_at < excluded.updated_at`,
      [session.user.id, JSON.stringify(words)],
    );
    return result.rowCount ?? 0;
  });
  if (upserted === undefined)
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  return context.json({ ok: true, upserted });
});
