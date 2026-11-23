// Léxico y práctica con IA: `/api/lexicon/*` y `/api/ai/enrich` (consulta,
// lote, enriquecimiento, ítems de práctica, verificación y explicación).
// Extraído de app.ts (R2 de la deuda de complejidad).
import { Hono } from "hono";
import type { Context } from "hono";
import { getConnectionString, withClient, type WorkerEnv } from "./db";
import { requireLectaPlus } from "./plan-middleware";
import { toCatalogId, toSenseOrder } from "./catalog-ids";
import { CATALOG, findEntries, findEntriesForForms, insertEnrichment, pendingEnrichmentJobs, sampleForCalibration, type LexiconEntryView } from "./lexicon";
import { ENRICHMENT_MODEL, createTtlCache, EXPLAIN_CALL_OPTIONS, ITEM_CALL_OPTIONS, VERIFY_CALL_OPTIONS, buildExplainPrompt, buildExplainSystemPrompt, buildItemPrompt, buildItemSystemPrompt, buildVerifyPrompt, buildVerifySystemPrompt, callDeepSeek, logAiCall, parseExplain, parseItem, parseVerify, requestEnrichment, AI_TASK_BUDGETS } from "./ai";
import { isStopword } from "../shared/stopwords";
import { hasUsableDefinition } from "../shared/lexicon";
import { calibrationBankVersion, type CalibrationProfile } from "../shared/calibration-bank";
import { getSession } from "./session";
import { consumeRateUnits } from "./rate-limit";
import { computeAiCacheKey, getCachedAiText, setCachedAiText } from "./ai-cache";
import { ITEM_UNITS_PER_HOUR, VERIFY_UNITS_PER_HOUR, EXPLAIN_UNITS_PER_HOUR } from "./ai-units";

export const lexiconRoutes = new Hono<{ Bindings: WorkerEnv }>();

lexiconRoutes.get("/api/lexicon/lookup", async (context) => {
  const form = context.req.query("form")?.trim();
  const language = context.req.query("lang")?.trim() || "es";
  if (!form || form.length > 100) return context.json({ found: false }, 400);

  let entries;
  try {
    entries = await withClient(context.env, (client) => findEntries(client, language, form), true);
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
// lectura pública del catálogo, como lookup/batch (sin sesión). Cada
// lema de la muestra entra solo con definición cargada y zipf dentro
// de su banda — el selector verifica la medición real, nada entra a
// ciegas desde el banco.
// Disponible en español e inglés.
const sampleCache = createTtlCache<{ words: unknown; version: string }>({
  maxEntries: 4,
  ttlMs: 5 * 60_000,
});

lexiconRoutes.get("/api/lexicon/sample", async (context) => {
  const language = context.req.query("language")?.trim() || "es";
  const rawProfile = context.req.query("profile")?.trim();
  const profile: CalibrationProfile = rawProfile === "learner" ? "learner" : "native";
  if (language !== "es" && language !== "en")
    return context.json({ error: "La muestra solo existe en español e inglés por ahora." }, 400);

  const cacheKey = `${language}:${profile}`;
  const cached = sampleCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  let words;
  try {
    words = await withClient(context.env, (client) =>
      sampleForCalibration(client, language, profile),
    true);
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!words) return context.json({ error: "El catálogo no está configurado." }, 503);
  const payload = { words, version: calibrationBankVersion(language, profile) };
  sampleCache.set(cacheKey, payload);
  return context.json(payload);
});

lexiconRoutes.post("/api/lexicon/batch", async (context) => {
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
    true);
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!entries) return context.json({ error: "El catálogo no está configurado." }, 503);
  return context.json({ entries });
});

const handleEnrich = async (context: Context<{ Bindings: WorkerEnv }>) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const nativeLanguage = typeof body?.nativeLanguage === "string" ? body.nativeLanguage.trim() : "es";
  const contextText = typeof body?.context === "string" ? body.context.slice(0, 500) : undefined;
  if (!form || form.length > 100) return context.json({ error: "Falta la palabra." }, 400);

  // Si no hay configuración de base de datos ni de IA, reportar 503
  if (!getConnectionString(context.env) && !context.env.DEEPSEEK_API_KEY) {
    return context.json({ error: "El catálogo no está configurado." }, 503);
  }

  const session = await getSession(context);
  if (!session) return context.json({ error: "No autorizado." }, 401);

  if (isStopword(form, language))
    return context.json({ error: "«" + form + "» es una palabra muy común; no necesita ficha de IA." }, 400);

  let existing: LexiconEntryView[] = [];
  if (getConnectionString(context.env)) {
    try {
      const found = await withClient(context.env, (client) =>
        findEntries(client, language, form),
      true);
      if (found) existing = found;
    } catch {
      // Si la base no responde, se continúa con enriquecimiento directo
    }
  }

  if (hasUsableDefinition(existing)) {
    return context.json({ status: "existing", entries: existing });
  }

  if (session) {
    const allowed = await consumeRateUnits(context.env, session.user.id, 1);
    if (!allowed) {
      return context.json(
        { error: "Llegaste al límite de definiciones con IA por hora. Intenta más tarde." },
        429,
      );
    }
  }

  const ai = await requestEnrichment(context.env, { form, language, context: contextText, nativeLanguage });
  if (!ai.ok) {
    if (existing.length > 0) {
      return context.json({ status: "existing", entries: existing });
    }
    switch (ai.reason) {
      case "not-configured":
        return context.json({ error: "El catálogo no está configurado." }, 503);
      case "rate-limited":
        return context.json({ error: "La IA está saturada. Intenta de nuevo en unos minutos." }, 503);
      default:
        return context.json({ error: "La IA no devolvió una ficha válida." }, 502);
    }
  }

  const fallbackEntry: LexiconEntryView = {
    entryId: null,
    lemma: ai.enrichment.lemma,
    pos: ai.enrichment.pos,
    freqRank: ai.enrichment.freqRank,
    zipf: null,
    senses: ai.enrichment.senses.map((s, idx) => ({
      definition: s.definition,
      example: s.example,
      senseOrder: idx + 1,
    })),
  };

  // El catálogo es compartido por todas las cuentas: una ficha generada con
  // `context` (texto libre del cliente que entra al prompt) nunca se persiste.
  // Es lo más simple que protege a cualquier cuenta, también a las sin Lecta+.
  if (!contextText && getConnectionString(context.env)) {
    try {
      const entries = await withClient(context.env, async (client) => {
        await insertEnrichment(client, language, ai.enrichment, form);
        return findEntries(client, language, form);
      });
      if (entries && entries.length > 0) {
        return context.json({ status: "created", entries });
      }
    } catch {
      // Si falla la inserción en BD, devolver igualmente el resultado generado en 200
    }
  }

  return context.json({ status: "created", entries: [fallbackEntry] }, 200);
};

lexiconRoutes.post("/api/lexicon/enrich", handleEnrich);
lexiconRoutes.post("/api/ai/enrich", handleEnrich);

lexiconRoutes.post("/api/lexicon/enrich-batch", async (context) => {
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
    true);
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


// Reporte «esta acepción no corresponde»: solo sube el contador
// editorial de la fila de lexicon_senses; no crea ni edita fichas.
lexiconRoutes.post("/api/lexicon/report", async (context) => {
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para reportar una acepción." }, 401);

  const body = await context.req.json().catch(() => null);
  const entryId = toCatalogId(body?.entryId);
  const senseOrder = toSenseOrder(body?.senseOrder);
  if (entryId === null || senseOrder === null)
    return context.json({ error: "Falta la acepción que reportar." }, 400);

  const reports = await withClient(context.env, async (client) => {
    const result = await client.query(
      `UPDATE ${CATALOG}lexicon_senses SET reports = reports + 1
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
// Las llamadas a la IA son secuenciales y con timeout de 8 s por
// intento (más reintentos): generar muchas en una sola petición haría
// esperar de más al cliente.
const MAX_ITEMS_GENERATED_PER_CALL = 8;

const toItemRef = (value: unknown): ItemRef | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const entryId = toCatalogId(raw.entryId);
  const senseOrder = toSenseOrder(raw.senseOrder);
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
  FROM ${CATALOG}lexicon_items i
  JOIN ${CATALOG}lexicon_senses s
    ON s.entry_id = i.entry_id AND s.sense_order = i.sense_order
`;

lexiconRoutes.post("/api/lexicon/items", requireLectaPlus, async (context) => {
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
  const session = context.get("session");
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
            language?: string;
            definition: string;
          }>(
            `SELECT r.entry_id, r.sense_order, e.lemma, e.pos, e.language, s.definition
             FROM (
               SELECT (j.value ->> 'entryId')::int8 AS entry_id,
                      (j.value ->> 'senseOrder')::int4 AS sense_order
               FROM jsonb_array_elements($1::jsonb) AS j(value)
             ) r
             JOIN ${CATALOG}lexicon_senses s
               ON s.entry_id = r.entry_id AND s.sense_order = r.sense_order
             JOIN ${CATALOG}lexicon_entries e ON e.id = s.entry_id`,
            [JSON.stringify(missing)],
          )
        : { rows: [] };
      return { existing: existing.rows, missing, senses: senses.rows };
    }, true);
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
        system: buildItemSystemPrompt(sense.language ?? "es", "es"),
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
          `INSERT INTO ${CATALOG}lexicon_items
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
lexiconRoutes.post("/api/lexicon/items/answer", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const correct = body?.correct;
  if (!id || id.length > 64 || typeof correct !== "boolean")
    return context.json({ error: "Falta la respuesta." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = context.get("session");
  if (!session)
    return context.json({ error: "Inicia sesión para practicar." }, 401);

  const updated = await withClient(context.env, async (client) => {
    const result = await client.query(
      `UPDATE ${CATALOG}lexicon_items
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
lexiconRoutes.post("/api/lexicon/verify-sentence", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const meaning = typeof body?.meaning === "string" ? body.meaning.trim() : "";
  const sentence = typeof body?.sentence === "string" ? body.sentence.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const nativeLanguage = typeof body?.nativeLanguage === "string" ? body.nativeLanguage.trim() : "es";
  if (!form || form.length > 100 || !meaning || meaning.length > 500 || !sentence || sentence.length > 300)
    return context.json({ error: "Falta la oración o la palabra." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = context.get("session");
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
    system: buildVerifySystemPrompt(language, nativeLanguage),
    user: buildVerifyPrompt(form, meaning, sentence, language),
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

// Explicación puntual del sentido de una palabra en la oración que el
// usuario está leyendo (botón «Explicar en esta oración» de la ficha).
// A diferencia de enrich: no escribe al catálogo ni compone fichas —
// el diccionario sigue siendo la respuesta gratuita; esto es el extra
// opcional. Privacidad: viajan solo la forma y la oración.
//
// Caché por aislante: un toque repetido a la misma palabra en la misma
// oración no vuelve a llamar a la IA ni gasta cuota del usuario. TTL
// y tope acotados; el dato es regenerable, así que perderlo al rotar
// el aislante no tiene costo.
const explainCache = createTtlCache<string>({ maxEntries: 200 });

lexiconRoutes.post("/api/lexicon/explain", requireLectaPlus, async (context) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const nativeLanguage = typeof body?.nativeLanguage === "string" ? body.nativeLanguage.trim() : "es";
  const contextText = typeof body?.context === "string" ? body.context.trim() : "";
  if (!form || form.length > 100 || !contextText || contextText.length > 500)
    return context.json({ error: "Faltan la palabra o la oración." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = context.get("session");
  if (!session)
    return context.json({ error: "Inicia sesión para pedir explicaciones." }, 401);

  const cacheKey = `${language}:${nativeLanguage}:${form.toLowerCase()}:${contextText}`;
  const shaKey = await computeAiCacheKey("word_context", `${language}:${nativeLanguage}:${form}:${contextText}`);
  const cached = getCachedAiText(shaKey) ?? explainCache.get(cacheKey);
  if (cached) return context.json({ explanation: cached, cached: true });

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    EXPLAIN_UNITS_PER_HOUR,
    "explain",
  );
  if (!allowed)
    return context.json(
      { error: "Llegaste al límite de explicaciones por hora. Intenta más tarde." },
      429,
    );

  const budget = AI_TASK_BUDGETS.word_context;

  const ai = await callDeepSeek(
    context.env,
    {
      system: buildExplainSystemPrompt(language, nativeLanguage),
      user: buildExplainPrompt(form, language, contextText, nativeLanguage),
    },
    {
      ...EXPLAIN_CALL_OPTIONS,
      maxTokens: budget.maxOutputTokens,
      temperature: budget.temperature,
    },
  );
  const parsed =
    ai.ok && ai.finishReason !== "length" ? parseExplain(ai.content) : null;
  logAiCall(
    EXPLAIN_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );
  if (!ai.ok) {
    // Degradación limpia: si la IA no responde y el catálogo tiene la
    // palabra, se sirve su definición general marcada como degradada.
    const entries = await withClient(context.env, (client) =>
      findEntries(client, language, form),
    true).catch(() => undefined);
    const definition = entries
      ?.flatMap((entry) => entry.senses)
      .find((sense) => sense.definition)?.definition;
    if (definition)
      return context.json({ explanation: definition, degraded: true });
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "Las explicaciones con IA no están configuradas."
            : ai.reason === "rate-limited"
              ? "La IA está saturada. Intenta de nuevo en unos minutos."
              : "La IA no pudo explicar la palabra.",
      },
      ai.reason === "api-error" ? 502 : 503,
    );
  }
  if (!parsed)
    return context.json({ error: "La IA no devolvió una explicación válida." }, 502);
  explainCache.set(cacheKey, parsed.explanation);
  setCachedAiText(shaKey, parsed.explanation);
  return context.json({ explanation: parsed.explanation });
});
