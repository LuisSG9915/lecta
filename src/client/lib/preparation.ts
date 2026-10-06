// Preparación «Antes de leer»: respuestas del lector, el borrador que
// las conserva en `session` y las transformaciones puras que las
// convierten en evidencia de conocimiento y candidatas del Cuaderno.
// Sin fechas, sin red, sin IndexedDB: las escrituras viven en idb.

import {
  captureDbScope,
  isDbScopeActive,
  knowledgeKey,
  loadSessionValue,
  savePreparationBatch,
  saveSessionValue,
  wordKey,
  type DbScope,
  type KnownWord,
  type SavedWord,
} from "./idb";
import { pushKnowledgeToServer } from "./reading-sync";
import type { PreparationMode } from "./settings";
import { pushWordsToServer } from "./vocab";

export type PreparationAnswer = "known" | "unknown";
export type PreparationAnswers = Record<string, PreparationAnswer>;
export type PreparationDisposition = "pending" | "skipped" | "reviewed";

export type PreparationRecord = {
  version: 1;
  bookHash: string;
  targetId: string;
  disposition: PreparationDisposition;
  answers: PreparationAnswers;
  entryAcknowledged: boolean;
  updatedAt: number;
};

// Fila tal como la ve la preparación: una forma con sus campos léxicos
// disponibles. El lema decide la clave de respuesta; sin lema manda la
// forma, como en la evidencia por lema.
export type PreparationRow = {
  form: string;
  lemma?: string | null;
  pos?: string | null;
  meaning?: string;
  context?: string;
  senseEntryId?: string | null;
  senseOrder?: number | null;
};

export const preparationRecordKey = (bookHash: string, targetId: string) =>
  `preparation:v1:${bookHash}:${encodeURIComponent(targetId)}`;

export const bookStartKey = (bookHash: string) => `bookStart:v1:${bookHash}`;

// Clave de respuesta de una fila: idioma + lema normalizado, con la
// forma normalizada como respaldo — la convención de knowledgeKey.
export const preparationAnswerKey = (language: string, row: PreparationRow) =>
  knowledgeKey(language, (row.lemma ?? row.form).toLowerCase());

// Valida el registro guardado: versión desconocida, campos con tipo
// distinto o respuestas fuera del conjunto se ignoran completos —
// nunca se usan como respuestas.
export function parsePreparationRecord(
  raw: string | null | undefined,
): PreparationRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PreparationRecord>;
    if (v?.version !== 1) return null;
    if (typeof v.bookHash !== "string" || !v.bookHash) return null;
    if (typeof v.targetId !== "string" || !v.targetId) return null;
    if (
      v.disposition !== "pending" &&
      v.disposition !== "skipped" &&
      v.disposition !== "reviewed"
    )
      return null;
    if (typeof v.entryAcknowledged !== "boolean") return null;
    if (typeof v.updatedAt !== "number" || !Number.isFinite(v.updatedAt))
      return null;
    const answers: PreparationAnswers = {};
    if (v.answers != null) {
      if (typeof v.answers !== "object" || Array.isArray(v.answers)) return null;
      for (const [key, value] of Object.entries(v.answers)) {
        if (value !== "known" && value !== "unknown") return null;
        answers[key] = value;
      }
    }
    return {
      version: 1,
      bookHash: v.bookHash,
      targetId: v.targetId,
      disposition: v.disposition,
      answers,
      entryAcknowledged: v.entryAcknowledged,
      updatedAt: v.updatedAt,
    };
  } catch {
    return null;
  }
}

// Filas cuya clave fue respondida, en el orden visual en que se
// mostraron. Una misma clave respondida por varias filas (dos formas
// del mismo lema) aparece una sola vez, con la primera que la trajo —
// así no puede haber respuestas contradictorias.
const answeredRows = (
  language: string,
  rows: PreparationRow[],
  answers: PreparationAnswers,
) => {
  const out: { row: PreparationRow; answer: PreparationAnswer }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const lemma = (row.lemma ?? row.form).toLowerCase();
    if (!lemma || !row.form) continue;
    const key = knowledgeKey(language, lemma);
    const answer = answers[key];
    if (!answer || seen.has(key)) continue;
    seen.add(key);
    out.push({ row, answer });
  }
  return out;
};

// Evidencia explícita lista para `knowledge`: una fila por respuesta
// válida, sin fecha ni lápida. Las respuestas que no corresponden a
// ninguna fila mostrada se ignoran.
export function buildPreparationEvidence(
  language: string,
  rows: PreparationRow[],
  answers: PreparationAnswers,
): Omit<KnownWord, "key" | "updatedAt">[] {
  return answeredRows(language, rows, answers).map(({ row, answer }) => ({
    language,
    lemma: (row.lemma ?? row.form).toLowerCase(),
    known: answer === "known",
    source: "preparation",
  }));
}

// Candidatas del Cuaderno: solo las marcadas como desconocidas, con
// los campos léxicos que traiga la fila. Sin fecha: la pone la
// transacción. Repetir una respuesta no duplica la palabra.
export function buildPreparationWords(
  language: string,
  rows: PreparationRow[],
  answers: PreparationAnswers,
  bookHash?: string,
): Omit<SavedWord, "key" | "savedAt">[] {
  const out: Omit<SavedWord, "key" | "savedAt">[] = [];
  const seen = new Set<string>();
  for (const { row, answer } of answeredRows(language, rows, answers)) {
    if (answer !== "unknown") continue;
    const key = wordKey(language, row.form);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      form: row.form,
      lemma: row.lemma ?? undefined,
      pos: row.pos ?? undefined,
      meaning: row.meaning,
      language,
      context: row.context,
      bookHash,
      senseEntryId: row.senseEntryId ?? undefined,
      senseOrder: row.senseOrder ?? undefined,
    });
  }
  return out;
}

// Intención de navegación hacia un destino del libro. Solo «enter»
// (abrir el capítulo para leerlo) puede interponer preparación;
// retomar una posición guardada o consultar un ancla jamás la
// interrumpen, y un análisis tardío o cambio de ajuste solo
// actualizan accesos, nunca abren de golpe.
export type PreparationIntent =
  | "enter"
  | "resume"
  | "consult"
  | "analysis-settled"
  | "settings-change";

export type PreparationOpening = "prepare" | "notice" | "summary" | "none";

export type PreparationDecision = {
  opening: PreparationOpening;
  // Hay borrador pendiente con respuestas para reanudar.
  resumeDraft: boolean;
  // El capítulo ya se preparó desde la intro pero su entrada aún no
  // se reconoce: el resumen está disponible aunque no se abra.
  summaryAvailable: boolean;
};

// Matriz de apertura (plan §5): qué se interpone al navegar según el
// modo, la intención y lo ya registrado para ese destino.
export function decidePreparation(input: {
  mode: PreparationMode;
  intent: PreparationIntent;
  record: PreparationRecord | null;
  // En «analysis-settled» distingue si el lector ya descartó el aviso.
  noticeDismissed?: boolean;
}): PreparationDecision {
  const { mode, intent, record } = input;
  const decide = (opening: PreparationOpening): PreparationDecision => ({
    opening,
    resumeDraft:
      record?.disposition === "pending" &&
      Object.keys(record.answers).length > 0,
    summaryAvailable:
      record?.disposition === "reviewed" && !record.entryAcknowledged,
  });

  // Retomar, consultar un ancla o cambiar el ajuste durante la
  // lectura nunca interponen nada: el aviso aplica al próximo ingreso.
  if (intent !== "enter" && intent !== "analysis-settled")
    return decide("none");

  if (intent === "analysis-settled") {
    // En auto el resultado solo actualiza el acceso manual; en notice
    // se refresca el aviso si el lector no lo había descartado.
    return decide(mode === "notice" && !input.noticeDismissed ? "notice" : "none");
  }

  if (record && record.disposition !== "pending") {
    // Entrada ya atendida (o preparación declinada): acceso manual.
    if (record.entryAcknowledged || record.disposition === "skipped")
      return decide("none");
    // Preparado desde la intro, entrada no atendida: en auto se
    // muestra el resumen (no un cuestionario nuevo); en notice el
    // aviso avisa que el resumen está disponible.
    if (mode === "auto") return decide("summary");
    if (mode === "notice") return decide("notice");
    return decide("none");
  }

  // Capítulo nuevo o borrador pendiente.
  if (mode === "auto") return decide("prepare");
  if (mode === "notice") return decide("notice");
  return decide("none");
}

// Registro nuevo para un destino sin preparación previa.
export const newPreparationRecord = (input: {
  bookHash: string;
  targetId: string;
  updatedAt: number;
  answers?: PreparationAnswers;
}): PreparationRecord => ({
  version: 1,
  bookHash: input.bookHash,
  targetId: input.targetId,
  disposition: "pending",
  answers: input.answers ?? {},
  entryAcknowledged: false,
  updatedAt: input.updatedAt,
});

// La entrada del capítulo quedó reconocida (el resumen ya se vio una
// vez). El registro conserva sus respuestas para el acceso manual.
export const acknowledgePreparationEntry = (
  record: PreparationRecord,
  updatedAt: number,
): PreparationRecord => ({
  ...record,
  entryAcknowledged: true,
  updatedAt,
});

// Borrador/estado del registro por destino, sobre el store `session`
// — separado del confirmar, que usa la transacción del lote. Se
// rechaza lo guardado bajo una clave que no corresponde al registro.
export async function loadPreparationRecord(
  bookHash: string,
  targetId: string,
  scope?: DbScope,
): Promise<PreparationRecord | null> {
  const raw = await loadSessionValue(
    preparationRecordKey(bookHash, targetId),
    scope,
  ).catch(() => undefined);
  const record = parsePreparationRecord(raw);
  if (!record || record.bookHash !== bookHash || record.targetId !== targetId)
    return null;
  return record;
}

export async function savePreparationRecord(
  record: PreparationRecord,
  scope?: DbScope,
) {
  await saveSessionValue(
    preparationRecordKey(record.bookHash, record.targetId),
    JSON.stringify(record),
    scope,
  );
}

// Resultado explícito de confirmar una ronda: lo local nunca se
// deshace; `synced` dice si además llegó al servidor en este intento.
export type PreparationConfirmResult = {
  saved: boolean;
  synced: boolean;
  knowledge: KnownWord[];
  words: SavedWord[];
};

// Confirma una ronda de preparación: primero la transacción local
// (todo o nada) y solo si esa salió, el empuje al servidor con las
// filas realmente escritas. Si el guardado local falla no se intenta
// sincronizar; si la sincronización falla se reporta `synced:false`
// sin deshacer nada — el lector conserva sus datos y el sync normal
// los alcanzará después.
export async function confirmPreparation(
  input: {
    record: PreparationRecord;
    recordKey: string;
    knowledge: Omit<KnownWord, "key" | "updatedAt">[];
    words: Omit<SavedWord, "key" | "savedAt">[];
  },
  scope?: DbScope,
): Promise<PreparationConfirmResult> {
  const bound = scope ?? captureDbScope();
  let batch: { knowledge: KnownWord[]; words: SavedWord[] };
  try {
    // El lote aterriza en la base dueña del contexto aunque la activa
    // ya sea otra.
    batch = await savePreparationBatch(input, bound);
  } catch {
    return { saved: false, synced: false, knowledge: [], words: [] };
  }

  // La cuenta cambió mientras se guardaba: no empujar con la sesión
  // nueva datos escritos bajo la anterior. La sincronización normal
  // los propagará bajo la cuenta correcta.
  if (!isDbScopeActive(bound)) {
    return { saved: true, synced: false, ...batch };
  }

  const [knowledgeSynced, wordsSynced] = await Promise.all([
    pushKnowledgeToServer(batch.knowledge, bound),
    pushWordsToServer(batch.words, bound),
  ]);
  return { saved: true, synced: knowledgeSynced && wordsSynced, ...batch };
}
