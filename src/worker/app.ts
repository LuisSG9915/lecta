import { Hono, type Context } from "hono";
import { chunks, getConnectionString, withClient, type WorkerEnv } from "./db";
import {
  CATALOG,
  findEntries,
  findEntriesForForms,
  insertEnrichment,
  pendingEnrichmentJobs,
  sampleForCalibration,
  type LexiconEntryView,
} from "./lexicon";
import {
  ENRICHMENT_MODEL,
  createTtlCache,
  EXPLAIN_CALL_OPTIONS,
  EVALUATE_CALL_OPTIONS,
  EVALUATE_SYSTEM_PROMPT,
  EXPLAIN_PASSAGE_CALL_OPTIONS,
  EXPLAIN_PASSAGE_SYSTEM_PROMPT,
  COMPANION_NOTE_SYSTEM_PROMPT,
  buildCompanionNotePrompt,
  parseCompanionNote,
  STORY_CALL_OPTIONS,
  STORY_SYSTEM_PROMPT,
  buildEvaluatePrompt,
  buildExplainInPassagePrompt,
  buildStoryPrompt,
  parseEvaluateSentence,
  parseMicroStory,
  parsePassageExplanation,
  type EvaluatedSentence,
  type MicroStory,
  type PassageExplanation,
  ITEM_CALL_OPTIONS,
  TIP_CALL_OPTIONS,
  TIP_PROMPT_VERSION,
  TIP_SYSTEM_PROMPT,
  VERIFY_CALL_OPTIONS,
  buildExplainPrompt,
  buildExplainSystemPrompt,
  buildItemPrompt,
  buildItemSystemPrompt,
  buildTipPrompt,
  buildVerifyPrompt,
  buildVerifySystemPrompt,
  callDeepSeek,
  COMPANION_NOTE_CALL_OPTIONS,
  PAGE_RECAP_CALL_OPTIONS,
  PAGE_RECAP_SYSTEM_PROMPT,
  buildPageRecapPrompt,
  parsePageRecap,
  deterministicPageRecapFallback,
  CHARACTER_RECAP_CALL_OPTIONS,
  CHARACTER_RECAP_SYSTEM_PROMPT,
  buildCharacterRecapPrompt,
  parseCharacterRecap,
  deterministicCharacterRecapFallback,
  type CharacterRecapResponse,
  logAiCall,
  parseExplain,
  parseItem,
  parseTip,
  parseVerify,
  requestEnrichment,
  sanitizeTipContext,
} from "./ai";
import { createAuth } from "./auth";
import { isStopword } from "../shared/stopwords";
import { hasUsableDefinition } from "../shared/lexicon";
import { isFsrsCardShape } from "../shared/reading-data";
import {
  calibrationBankVersion,
  type CalibrationProfile,
} from "../shared/calibration-bank";
import { checkEpubHeader, EPUB_MAX_BYTES } from "../shared/epub-check";
import { extractEpubMeta } from "../shared/epub-meta";
import { getSession } from "./session";
import { readingData } from "./reading-data";
import { companion } from "./companion";
import { catalog } from "./catalog";
import {
  kindleRoutes,
  handleKindleLinkPage,
  handleKindleStatus,
  handleKindleLinkAction,
} from "./kindle/routes";

export const app = new Hono<{ Bindings: WorkerEnv }>();

// Cabeceras anti-caché para respuestas HTML servidas por el worker
app.use("*", async (c, next) => {
  await next();
  const contentType = c.res.headers.get("content-type");
  if (contentType?.includes("text/html")) {
    c.res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    c.res.headers.set("Pragma", "no-cache");
    c.res.headers.set("Expires", "0");
  }
});

app.route("/", readingData);
app.route("/", companion);
app.route("/", catalog);
app.route("/k", kindleRoutes);
app.get("/kindle", handleKindleLinkPage);
app.get("/api/kindle/status", handleKindleStatus);
app.post("/api/kindle/link", handleKindleLinkAction);
app.get("/kindle/*", (context) => {
  const p = context.req.path.replace(/^\/kindle/, "/k");
  return context.redirect(p);
});
app.post("/kindle/*", async (context) => {
  const url = new URL(context.req.url);
  url.pathname = url.pathname.replace(/^\/kindle/, "/k");
  return app.fetch(new Request(url.toString(), context.req.raw), context.env, context.executionCtx);
});

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
// lectura pública del catálogo, como lookup/batch (sin sesión). Cada
// lema de la muestra entra solo con definición cargada y zipf dentro
// de su banda — el selector verifica la medición real, nada entra a
// ciegas desde el banco.
// Disponible en español e inglés.
app.get("/api/lexicon/sample", async (context) => {
  const language = context.req.query("language")?.trim() || "es";
  const rawProfile = context.req.query("profile")?.trim();
  const profile: CalibrationProfile = rawProfile === "learner" ? "learner" : "native";
  if (language !== "es" && language !== "en")
    return context.json({ error: "La muestra solo existe en español e inglés por ahora." }, 400);

  let words;
  try {
    words = await withClient(context.env, (client) =>
      sampleForCalibration(client, language, profile),
    );
  } catch {
    return context.json({ error: "No se pudo consultar el catálogo." }, 502);
  }

  if (!words) return context.json({ error: "El catálogo no está configurado." }, 503);
  return context.json({ words, version: calibrationBankVersion(language, profile) });
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
  if (isStopword(form, language))
    return context.json({ error: "«" + form + "» es una palabra muy común; no necesita ficha de IA." }, 400);

  let existing: LexiconEntryView[] = [];
  if (getConnectionString(context.env)) {
    try {
      const found = await withClient(context.env, (client) =>
        findEntries(client, language, form),
      );
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

  if (getConnectionString(context.env)) {
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

app.post("/api/lexicon/enrich", handleEnrich);
app.post("/api/ai/enrich", handleEnrich);

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
// truncaría (…305 → …300). Se acepta también un entero seguro y se
// canoniza («007» → «7»); Postgres castea el texto a int8/int4.
const INT8_MAX = 9223372036854775807n;
const INT4_MAX = 2147483647n;
// Entero positivo en [1, max]: string de dígitos o number. Un number
// por encima de 2^53 ya perdió dígitos al serializarse — aceptarlo
// ligaría la acepción equivocada, así que se rechaza.
const toBoundedDigits = (value: unknown, max: bigint): string | null => {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 1 && BigInt(value) <= max
      ? String(value)
      : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const id = BigInt(trimmed);
  return id >= 1n && id <= max ? id.toString() : null;
};
const toCatalogId = (value: unknown): string | null => toBoundedDigits(value, INT8_MAX);
// sense_order es INT4 en el catálogo: su rango no es el de los ids.
const toSenseOrder = (value: unknown): string | null => toBoundedDigits(value, INT4_MAX);

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
app.post("/api/lexicon/verify-sentence", async (context) => {
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

app.post("/api/lexicon/explain", async (context) => {
  const body = await context.req.json().catch(() => null);
  const form = typeof body?.form === "string" ? body.form.trim() : "";
  const language = typeof body?.language === "string" ? body.language.trim() : "es";
  const nativeLanguage = typeof body?.nativeLanguage === "string" ? body.nativeLanguage.trim() : "es";
  const contextText = typeof body?.context === "string" ? body.context.trim() : "";
  if (!form || form.length > 100 || !contextText || contextText.length > 500)
    return context.json({ error: "Faltan la palabra o la oración." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El catálogo no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para pedir explicaciones." }, 401);

  const cacheKey = `${language}:${nativeLanguage}:${form.toLowerCase()}:${contextText}`;
  const cached = explainCache.get(cacheKey);
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

  const ai = await callDeepSeek(
    context.env,
    {
      system: buildExplainSystemPrompt(language, nativeLanguage),
      user: buildExplainPrompt(form, language, contextText, nativeLanguage),
    },
    EXPLAIN_CALL_OPTIONS,
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
    ).catch(() => undefined);
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
  return context.json({ explanation: parsed.explanation });
});

// Consejo diario de lectura en la estantería (única función IA
// proactiva — sin gesto del usuario). Viajan solo agregados saneados;
// el cliente guarda la cadencia (1/día) y los eventos de aceptación.
// El silencio ({tip:null}) es un resultado válido y se cachea igual
// que un consejo: una recarga no vuelve a preguntar.
//
// La caché es marcador de GENERACIÓN, no de contenido: una vez que la
// cuenta consultó hoy, cualquier otro dispositivo recibe silencio en
// vez del mismo tip — la cadencia «una al día» sería por cuenta y no
// serviría el mismo consejo dos veces. El TTL debe outlast el día: la
// clave ya lleva el día local, así que una entrada vieja jamás choca
// con el día siguiente.
const tipCache = createTtlCache<string>({
  maxEntries: 200,
  ttlMs: 20 * 3_600_000,
});

app.post("/api/lexicon/tip", async (context) => {
  const body = await context.req.json().catch(() => null);
  const tipContext = sanitizeTipContext(body);
  if (!tipContext)
    return context.json({ error: "Falta el día local." }, 400);
  if (!getConnectionString(context.env))
    return context.json({ error: "El servicio no está configurado." }, 503);
  const session = await getSession(context);
  if (!session)
    return context.json({ error: "Inicia sesión para recibir consejos." }, 401);

  const cacheKey = `${session.user.id}:${tipContext.dayKey}`;
  if (tipCache.get(cacheKey)) {
    // Ya hubo consulta hoy desde otro dispositivo: el consejo del día
    // ya se entregó (o la IA eligió silencio) — no se repite.
    return context.json({
      tip: null,
      action: "none",
      version: TIP_PROMPT_VERSION,
      cached: true,
    });
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    TIP_UNITS_PER_HOUR,
    "tip",
  );
  if (!allowed)
    return context.json(
      { error: "Llegaste al límite de consejos por ahora. Intenta más tarde." },
      429,
    );

  const ai = await callDeepSeek(
    context.env,
    { system: TIP_SYSTEM_PROMPT, user: buildTipPrompt(tipContext) },
    TIP_CALL_OPTIONS,
  );
  const parsed =
    ai.ok && ai.finishReason !== "length" ? parseTip(ai.content) : null;
  logAiCall(
    TIP_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );
  if (!ai.ok)
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "Los consejos con IA no están configurados."
            : ai.reason === "rate-limited"
              ? "La IA está saturada. Intenta de nuevo en unos minutos."
              : "La IA no pudo pensar un consejo.",
      },
      ai.reason === "api-error" ? 502 : 503,
    );
  if (!parsed)
    return context.json({ error: "La IA no devolvió un consejo válido." }, 502);
  const payload = {
    tip: parsed.tip,
    action: parsed.action,
    version: TIP_PROMPT_VERSION,
  };
  tipCache.set(cacheKey, JSON.stringify(payload));
  return context.json(payload);
});

// ---------- El Reto del Escritor y Cuento de Tinta IA ----------
const evaluateCache = createTtlCache<EvaluatedSentence>({ maxEntries: 150, ttlMs: 15 * 60_000 });
const storyCache = createTtlCache<MicroStory>({ maxEntries: 100, ttlMs: 30 * 60_000 });

app.post("/api/ai/evaluate-sentence", async (context) => {
  const body = await context.req.json().catch(() => null);
  const word = typeof body?.word === "string" ? body.word.trim() : "";
  const targetSense = typeof body?.targetSense === "string" ? body.targetSense.trim() : "";
  const userSentence = typeof body?.userSentence === "string" ? body.userSentence.trim() : "";
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;

  if (!word || !targetSense || !userSentence) {
    return context.json({ error: "Faltan la palabra, la acepción o la oración del usuario." }, 400);
  }
  if (userSentence.length > 400) {
    return context.json({ error: "La oración no puede superar 400 caracteres." }, 400);
  }

  const cacheKey = `${word.toLowerCase()}::${targetSense.toLowerCase()}::${userSentence.toLowerCase()}`;
  const cached = evaluateCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  const session = await getSession(context);
  if (!session) {
    return context.json({ error: "Inicia sesión para evaluar oraciones con IA." }, 401);
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    EVALUATE_UNITS_PER_HOUR,
    "evaluate",
  );
  if (!allowed) {
    return context.json(
      { error: "Llegaste al límite de evaluaciones por hora. Intenta más tarde." },
      429,
    );
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: EVALUATE_SYSTEM_PROMPT,
      user: buildEvaluatePrompt(word, targetSense, userSentence, bookTitle),
    },
    EVALUATE_CALL_OPTIONS,
  );

  const parsed = ai.ok && ai.finishReason !== "length" ? parseEvaluateSentence(ai.content) : null;
  logAiCall(
    EVALUATE_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );

  if (!ai.ok) {
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "La evaluación de frases con IA no está configurada."
            : ai.reason === "rate-limited"
              ? "La IA está saturada. Intenta de nuevo en unos minutos."
              : "La IA no pudo evaluar la oración.",
      },
      ai.reason === "api-error" ? 502 : 503,
    );
  }

  if (!parsed) {
    return context.json({ error: "La IA no devolvió una evaluación válida." }, 502);
  }

  evaluateCache.set(cacheKey, parsed);
  return context.json(parsed);
});

app.post("/api/ai/micro-story", async (context) => {
  const body = await context.req.json().catch(() => null);
  const wordsRaw = Array.isArray(body?.words) ? body.words : [];
  const styleHint = typeof body?.styleHint === "string" ? body.styleHint.trim().slice(0, 100) : undefined;

  const words: Array<{ word: string; meaning?: string }> = wordsRaw
    .filter(
      (w: unknown): w is Record<string, unknown> =>
        typeof w === "object" && w !== null && typeof (w as Record<string, unknown>).word === "string",
    )
    .map((w: Record<string, unknown>) => ({
      word: String(w.word).trim(),
      meaning: typeof w.meaning === "string" ? String(w.meaning).trim() : undefined,
    }))
    .filter((w: { word: string; meaning?: string }) => Boolean(w.word))
    .slice(0, 4);

  if (!words.length) {
    return context.json({ error: "Debes proporcionar al menos una palabra para el micro-relato." }, 400);
  }

  const cacheKey = words.map((w: { word: string }) => w.word.toLowerCase()).sort().join(",") + (styleHint ? `:${styleHint}` : "");
  const cached = storyCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  const session = await getSession(context);
  if (!session) {
    return context.json({ error: "Inicia sesión para generar micro-relatos con IA." }, 401);
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    STORY_UNITS_PER_HOUR,
    "story",
  );
  if (!allowed) {
    return context.json(
      { error: "Llegaste al límite de micro-relatos por hora. Intenta más tarde." },
      429,
    );
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: STORY_SYSTEM_PROMPT,
      user: buildStoryPrompt(words, styleHint),
    },
    STORY_CALL_OPTIONS,
  );

  const parsed = ai.ok && ai.finishReason !== "length" ? parseMicroStory(ai.content) : null;
  logAiCall(
    STORY_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );

  if (!ai.ok) {
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "Los micro-relatos con IA no están configurados."
            : ai.reason === "rate-limited"
              ? "La IA está saturada. Intenta de nuevo en unos minutos."
              : "La IA no pudo tejer el micro-relato.",
      },
      ai.reason === "api-error" ? 502 : 503,
    );
  }

  if (!parsed) {
    return context.json({ error: "La IA no devolvió un micro-relato estructurado correctamente." }, 502);
  }

  storyCache.set(cacheKey, parsed);
  return context.json(parsed);
});

// ---------- Explicación literaria en pasaje (B.3.3 & B.4) ----------
const explainPassageCache = createTtlCache<PassageExplanation>({
  maxEntries: 200,
  ttlMs: 15 * 60_000,
});

app.post("/api/ai/explain-in-passage", async (context) => {
  const body = await context.req.json().catch(() => null);
  const word = typeof body?.word === "string" ? body.word.trim().slice(0, 100) : undefined;
  const sentence = typeof body?.sentence === "string" ? body.sentence.trim() : "";
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;
  const author = typeof body?.author === "string" ? body.author.trim().slice(0, 100) : undefined;
  const language = typeof body?.language === "string" ? body.language.trim().slice(0, 10) : "es";
  const nativeLanguage = typeof body?.nativeLanguage === "string" ? body.nativeLanguage.trim().slice(0, 10) : "es";

  if (!sentence) {
    return context.json({ error: "Falta el pasaje u oración a explicar." }, 400);
  }
  if (sentence.length > 800) {
    return context.json({ error: "El pasaje no puede superar 800 caracteres." }, 400);
  }

  const cacheKey = `${(word ?? "").toLowerCase()}::${sentence.toLowerCase()}::${(bookTitle ?? "").toLowerCase()}::${language}::${nativeLanguage}`;
  const cached = explainPassageCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  const session = await getSession(context);
  if (!session) {
    return context.json({ error: "Inicia sesión para pedir explicaciones literarias con IA." }, 401);
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    EXPLAIN_UNITS_PER_HOUR,
    "explain",
  );
  if (!allowed) {
    return context.json(
      { error: "Llegaste al límite de explicaciones por hora. Intenta más tarde." },
      429,
    );
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: EXPLAIN_PASSAGE_SYSTEM_PROMPT,
      user: buildExplainInPassagePrompt({ word, sentence, bookTitle, author, language, nativeLanguage }),
    },
    EXPLAIN_PASSAGE_CALL_OPTIONS,
  );

  const parsed = ai.ok && ai.finishReason !== "length" ? parsePassageExplanation(ai.content) : null;
  logAiCall(
    EXPLAIN_PASSAGE_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );

  if (!ai.ok) {
    return context.json(
      {
        error:
          ai.reason === "not-configured"
            ? "Las explicaciones con IA no están configuradas."
            : ai.reason === "rate-limited"
              ? "La IA está saturada. Intenta de nuevo en unos minutos."
              : "La IA no pudo explicar el pasaje.",
      },
      ai.reason === "api-error" ? 502 : 503,
    );
  }

  if (!parsed) {
    return context.json({ error: "La IA no devolvió una explicación estructurada correctamente." }, 502);
  }

  explainPassageCache.set(cacheKey, parsed);
  return context.json(parsed);
});

app.post("/api/ai/companion-note", async (context) => {
  const body = await context.req.json().catch(() => null);
  const catName = typeof body?.catName === "string" ? body.catName.trim().slice(0, 50) : "Michi";
  const achievement = typeof body?.achievement === "string" ? body.achievement.trim().slice(0, 100) : undefined;
  const rankName = typeof body?.rankName === "string" ? body.rankName.trim().slice(0, 100) : undefined;
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;
  const masteredWord = typeof body?.masteredWord === "string" ? body.masteredWord.trim().slice(0, 100) : undefined;

  const session = await getSession(context);
  if (!session) {
    return context.json({ error: "Inicia sesión para recibir cartas del compañero." }, 401);
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: COMPANION_NOTE_SYSTEM_PROMPT,
      user: buildCompanionNotePrompt({ catName, achievement, rankName, bookTitle, masteredWord }),
    },
    COMPANION_NOTE_CALL_OPTIONS,
  );

  const parsed = ai.ok ? parseCompanionNote(ai.content) : null;
  if (!parsed) {
    return context.json({
      title: "¡Felicidades por tu lectura, amigo!",
      note: `¡Qué gran paso diste hoy con tu lectura! Me encanta ver cómo sigues enriqueciendo tus libros día a día.`,
      signOff: `Con cariño, ${catName} 🐾`,
      fallback: true,
    });
  }

  return context.json(parsed);
});

app.post("/api/ai/page-recap", async (context) => {
  const body = await context.req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;
  const chapterTitle = typeof body?.chapterTitle === "string" ? body.chapterTitle.trim().slice(0, 150) : undefined;

  if (!text) {
    return context.json({ error: "Se requiere el texto de la página para resumir." }, 400);
  }

  if (!context.env.DEEPSEEK_API_KEY) {
    return context.json(deterministicPageRecapFallback(text));
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: PAGE_RECAP_SYSTEM_PROMPT,
      user: buildPageRecapPrompt({ text, bookTitle, chapterTitle }),
    },
    PAGE_RECAP_CALL_OPTIONS,
  );

  const parsed = ai.ok ? parsePageRecap(ai.content) : null;
  if (!parsed) {
    return context.json(deterministicPageRecapFallback(text));
  }

  return context.json(parsed);
});

app.post("/api/ai/translate", async (context) => {
  const body = await context.req.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  const from = typeof body?.from === "string" ? body.from : "en";
  const to = typeof body?.to === "string" ? body.to : "es";

  if (!text) {
    return context.json({ error: "Se requiere texto para traducir." }, 400);
  }

  if (!context.env.DEEPSEEK_API_KEY) {
    return context.json({ translation: text });
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: `Eres un traductor literario bilingüe de ${from} a ${to}. Traduce el siguiente párrafo con fluidez, elegancia y fidelidad literaria. Devuelve ÚNICAMENTE la traducción directa, sin notas ni explicaciones.`,
      user: text,
    },
    {
      operation: "explain_passage",
      promptVersion: "bilingual_v1",
      maxTokens: 512,
    },
  );

  const translation = ai.ok && ai.content ? ai.content.trim() : text;
  return context.json({ translation });
});

const characterRecapCache = createTtlCache<CharacterRecapResponse>({
  maxEntries: 200,
  ttlMs: 20 * 60_000,
});

app.post("/api/ai/character-recap", async (context) => {
  const body = await context.req.json().catch(() => null);
  const entityName = typeof body?.entityName === "string" ? body.entityName.trim().slice(0, 100) : "";
  const bookTitle = typeof body?.bookTitle === "string" ? body.bookTitle.trim().slice(0, 150) : undefined;
  const currentChapterTitle = typeof body?.currentChapterTitle === "string" ? body.currentChapterTitle.trim().slice(0, 150) : undefined;
  const excerptsRaw: unknown[] = Array.isArray(body?.excerptsSoFar) ? body.excerptsSoFar : [];
  const excerptsSoFar = excerptsRaw
    .filter((e: unknown): e is string => typeof e === "string" && Boolean(e.trim()))
    .map((e: string) => e.trim().slice(0, 300))
    .slice(0, 6);

  if (!entityName) {
    return context.json({ error: "Se requiere el nombre del personaje o lugar." }, 400);
  }

  const cacheKey = `${entityName.toLowerCase()}::${(bookTitle ?? "").toLowerCase()}::${excerptsSoFar.join("|").toLowerCase()}`;
  const cached = characterRecapCache.get(cacheKey);
  if (cached) return context.json({ ...cached, cached: true });

  if (!context.env.DEEPSEEK_API_KEY) {
    return context.json(deterministicCharacterRecapFallback(entityName, excerptsSoFar));
  }

  const session = await getSession(context);
  if (!session) {
    return context.json(deterministicCharacterRecapFallback(entityName, excerptsSoFar));
  }

  const allowed = await consumeRateUnits(
    context.env,
    session.user.id,
    1,
    EXPLAIN_UNITS_PER_HOUR,
    "explain",
  );
  if (!allowed) {
    return context.json(deterministicCharacterRecapFallback(entityName, excerptsSoFar));
  }

  const ai = await callDeepSeek(
    context.env,
    {
      system: CHARACTER_RECAP_SYSTEM_PROMPT,
      user: buildCharacterRecapPrompt({ entityName, bookTitle, currentChapterTitle, excerptsSoFar }),
    },
    CHARACTER_RECAP_CALL_OPTIONS,
  );

  const parsed = ai.ok && ai.finishReason !== "length" ? parseCharacterRecap(ai.content) : null;
  logAiCall(
    CHARACTER_RECAP_CALL_OPTIONS,
    ai,
    !ai.ok ? ai.reason : ai.finishReason === "length" ? "truncated" : parsed ? "ok" : "invalid",
  );

  if (!ai.ok || !parsed) {
    return context.json(deterministicCharacterRecapFallback(entityName, excerptsSoFar));
  }

  characterRecapCache.set(cacheKey, parsed);
  return context.json(parsed);
});

// Presupuestos por hora y por alcance: cada función IA gasta de su
// propia bolsa (columna scope de lecta_rate_log), así una tanda de
// ítems o de correcciones no consume la cuota de enriquecimiento.
const ENRICH_UNITS_PER_HOUR = 60;
const ITEM_UNITS_PER_HOUR = 24;
const VERIFY_UNITS_PER_HOUR = 30;
const EXPLAIN_UNITS_PER_HOUR = 30;
const TIP_UNITS_PER_HOUR = 6;
const EVALUATE_UNITS_PER_HOUR = 40;
const STORY_UNITS_PER_HOUR = 20;
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
  const booksBucket = context.env.BOOKS;
  if (!booksBucket)
    return context.json({ error: "El almacenamiento no está configurado." }, 503);
  const session = await getSession(context);
  if (!session) return context.json({ error: "Inicia sesión para ver tus libros." }, 401);

  const listed = await booksBucket.list({ prefix: `books/${session.user.id}/` });
  const books = await Promise.all(
    listed.objects.map(async (object) => {
      const hash = object.key.split("/").pop()?.replace(/\.epub$/, "") ?? "";
      let title = object.customMetadata?.title ?? "";
      let author = object.customMetadata?.author ?? "";
      let name = object.customMetadata?.name ?? "";
      let sections = Number(object.customMetadata?.sections) || 0;
      let language = object.customMetadata?.language ?? "";

      // Si el libro remoto no tiene título guardado, intentamos extraerlo
      // del EPUB en R2 para que la estantería siempre lo muestre antes de descargarlo.
      if (!title || !language) {
        try {
          const r2Obj = await booksBucket.get(object.key);
          if (r2Obj) {
            const data = new Uint8Array(await r2Obj.arrayBuffer());
            const meta = await extractEpubMeta(data);
            if (meta?.title) {
              title = title || meta.title;
              author = author || (meta.author ?? "");
              sections = sections || (meta.sections ?? 0);
              language = language || (meta.language ?? "");
              name = name || `${title}.epub`;

              // Actualiza metadatos en segundo plano para que las siguientes peticiones
              // no tengan que releer el archivo.
              context.executionCtx?.waitUntil?.(
                booksBucket.put(object.key, data, {
                  httpMetadata: { contentType: "application/epub+zip" },
                  customMetadata: {
                    name,
                    title,
                    author,
                    sections: sections ? String(sections) : "",
                    language,
                  },
                }).catch(() => null),
              );
            }
          }
        } catch {
          // Ignora fallos silenciosos y responde con lo que haya
        }
      }

      return {
        hash,
        uploaded: object.uploaded,
        name: name || (title ? `${title}.epub` : ""),
        title,
        author,
        sections,
        language,
      };
    }),
  );

  return context.json({ books });
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

  const meta = context.req.query();
  let title = meta.title?.slice(0, 200) ?? "";
  let author = meta.author?.slice(0, 200) ?? "";
  let sections = /^\d{1,5}$/.test(meta.sections ?? "") ? meta.sections! : "";
  let name = meta.name?.slice(0, 200) ?? "";
  let language = meta.language?.slice(0, 10) ?? "";

  if (!title || !language) {
    const extracted = await extractEpubMeta(data).catch(() => null);
    if (extracted?.title) {
      title = title || extracted.title.slice(0, 200);
      author = author || (extracted.author?.slice(0, 200) ?? "");
      sections = sections || (extracted.sections ? String(extracted.sections) : "");
      name = name || `${title}.epub`;
      language = language || (extracted.language?.slice(0, 10) ?? "");
    }
  }

  await context.env.BOOKS.put(bookKey(session.user.id, hash), data, {
    httpMetadata: { contentType: "application/epub+zip" },
    // Título/autor/secciones viajan con el objeto para que otros
    // dispositivos pinten la ficha sin bajar el EPUB completo.
    customMetadata: {
      name,
      title,
      author,
      sections,
      language,
    },
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
        // Referencia a la acepción guardada: los mismos validadores del
        // catálogo (int8/int4 positivos); lo inválido queda en null.
        senseEntryId: toCatalogId(input.senseEntryId),
        senseOrder: toSenseOrder(input.senseOrder),
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
    let total = 0;
    for (const chunk of chunks(words)) {
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
         card = COALESCE(excluded.card, lecta_user_words.card),
         updated_at = excluded.updated_at,
         deleted = excluded.deleted
       WHERE lecta_user_words.updated_at < excluded.updated_at`,
      [session.user.id, JSON.stringify(chunk)],
      );
      total += result.rowCount ?? 0;
    }
    return total;
  });
  if (upserted === undefined)
    return context.json({ error: "El vocabulario no está configurado." }, 503);
  return context.json({ ok: true, upserted });
});
