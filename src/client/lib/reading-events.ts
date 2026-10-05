// Trayecto de lectura (readingEvents): registro local del recorrido
// — a qué destinos entró el lector, qué sugerencias vio de verdad y
// qué hizo después (responder, consultar, guardar, declarar). Es
// diagnóstico por dispositivo y cuenta: no se sincroniza al servidor,
// se exporta con el respaldo y se poda por antigüedad. La preferencia
// se apaga en Cuenta; con ella apagada no se escribe nada.

import {
  loadSessionValue,
  pruneReadingEvents,
  putReadingEvent,
  saveSessionValue,
  type PresentedRow,
  type ReadingEvent,
} from "./idb";

export const HISTORY_KEY = "readingHistory";
// Retención del historial de diagnóstico: 90 días por cuenta local.
export const HISTORY_RETENTION_MS = 90 * 86_400_000;

// Ante un almacén que falla se asume encendido (mismo criterio que
// «Usar IA»): el interruptor muestra lo real cuando el almacén vuelve.
export async function loadHistoryEnabled(): Promise<boolean> {
  try {
    return (await loadSessionValue(HISTORY_KEY)) !== "0";
  } catch {
    return true;
  }
}

export async function saveHistoryEnabled(on: boolean) {
  await saveSessionValue(HISTORY_KEY, on ? "1" : "0");
}

// Omit sobre una unión no distribuye (colapsaría a las claves
// comunes); esta variante conserva cada caso del evento.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

export type ReadingEventDraft = DistributiveOmit<
  ReadingEvent,
  "id" | "version" | "createdAt"
>;

// Borrador ya situado en una visita y un libro: lo que escribe el
// controlador por cada evento.
export type VisitEventDraft = DistributiveOmit<
  ReadingEventDraft,
  "visitId" | "bookHash"
>;

// Registra un evento si el historial está encendido. Es auxiliar:
// nunca interrumpe lectura, guardado ni navegación — el llamador
// puede invocarlo con `void` y olvidarse.
export async function trackReadingEvent(draft: ReadingEventDraft) {
  try {
    if (!(await loadHistoryEnabled())) return;
    await putReadingEvent({
      ...draft,
      id: crypto.randomUUID(),
      version: 1,
      createdAt: Date.now(),
    } as ReadingEvent);
  } catch {
    /* el trayecto es diagnóstico; un fallo no debe notarse */
  }
}

// Poda perezosa al abrir un libro: conserva el historial reciente.
export async function pruneReadingHistory(now = Date.now()) {
  try {
    await pruneReadingEvents(now - HISTORY_RETENTION_MS);
  } catch {
    /* mismo criterio: auxiliar, jamás bloquea */
  }
}

// ---------- Resumen de una visita ----------

export type VisitSummary = {
  // Destinos a los que entró, en orden de primera entrada.
  targetsEntered: string[];
  // Filas presentadas en preparación, en orden y sin duplicar por
  // rerenders (un mismo evento puede llegar en dos lotes).
  presented: PresentedRow[];
  // Respuestas por clave (la última gana, como en el registro).
  answeredKnown: number;
  answeredUnknown: number;
  skipped: number;
  consulted: number;
  saved: number;
  declaredKnown: number;
  // Guardadas que NUNCA aparecieron en una sugerencia presentada:
  // la señal más útil para evaluar qué se le escapó al modelo. Es
  // una cota parcial — un guardado no es censo de lo desconocido.
  savedNotPresented: string[];
};

// Resume los eventos de una visita (mismo visitId) o de un rango
// cualquiera. Pura: los eventos ya vienen leídos y ordenados.
export function summarizeReadingEvents(events: ReadingEvent[]): VisitSummary {
  const targetsEntered: string[] = [];
  const seenTargets = new Set<string>();
  const presented = new Map<string, PresentedRow>();
  const answers = new Map<string, "known" | "unknown">();
  const savedForms = new Set<string>();
  const savedRows: { form: string; lemma?: string }[] = [];
  let skipped = 0;
  let consulted = 0;
  let declaredKnown = 0;

  for (const event of events) {
    switch (event.kind) {
      case "target_entered":
        if (!seenTargets.has(event.targetId)) {
          seenTargets.add(event.targetId);
          targetsEntered.push(event.targetId);
        }
        break;
      case "preparation_presented":
        for (const row of event.rows) {
          if (!presented.has(row.key)) presented.set(row.key, row);
        }
        break;
      case "preparation_answered":
        answers.set(event.key, event.answer);
        break;
      case "preparation_skipped":
        skipped += 1;
        break;
      case "word_consulted":
        consulted += 1;
        break;
      case "word_saved":
        savedRows.push({ form: event.form, lemma: event.lemma });
        for (const term of [event.form, event.lemma])
          if (term) savedForms.add(term.toLowerCase());
        break;
      case "word_declared_known":
        declaredKnown += 1;
        break;
    }
  }

  const presentedTerms = new Set<string>();
  for (const row of presented.values()) {
    presentedTerms.add(row.form.toLowerCase());
    if (row.lemma) presentedTerms.add(row.lemma.toLowerCase());
  }
  const savedNotPresented = savedRows
    .filter(
      (row) =>
        !presentedTerms.has(row.form.toLowerCase()) &&
        !(row.lemma && presentedTerms.has(row.lemma.toLowerCase())),
    )
    .map((row) => row.form);
  // «Guardada» cuenta formas únicas, no eventos repetidos.
  let answeredKnown = 0;
  let answeredUnknown = 0;
  for (const answer of answers.values()) {
    if (answer === "known") answeredKnown += 1;
    else answeredUnknown += 1;
  }

  return {
    targetsEntered,
    presented: [...presented.values()],
    answeredKnown,
    answeredUnknown,
    skipped,
    consulted,
    saved: savedForms.size,
    declaredKnown,
    savedNotPresented,
  };
}
