// Trayecto de lectura (readingEvents): registro local del recorrido
// — a qué destinos entró el lector, qué sugerencias vio de verdad y
// qué hizo después (responder, consultar, guardar, declarar). Es
// diagnóstico por dispositivo y cuenta: no se sincroniza al servidor,
// se exporta con el respaldo y se poda por antigüedad. La preferencia
// se apaga en Cuenta; con ella apagada no se escribe nada.

import {
  captureDbScope,
  loadSessionValue,
  pruneReadingEvents,
  putReadingEvent,
  saveSessionValue,
  type DbScope,
  type PresentedRow,
  type ReadingEvent,
} from "./idb";

export const HISTORY_KEY = "readingHistory";
// Retención del historial de diagnóstico: 90 días por cuenta local.
export const HISTORY_RETENTION_MS = 90 * 86_400_000;

// Ante un almacén que falla se asume encendido (mismo criterio que
// «Usar IA»): el interruptor muestra lo real cuando el almacén vuelve.
export async function loadHistoryEnabled(scope?: DbScope): Promise<boolean> {
  try {
    return (await loadSessionValue(HISTORY_KEY, scope)) !== "0";
  } catch {
    return true;
  }
}

export async function saveHistoryEnabled(on: boolean, scope?: DbScope) {
  await saveSessionValue(HISTORY_KEY, on ? "1" : "0", scope);
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
export async function trackReadingEvent(
  draft: ReadingEventDraft,
  scope?: DbScope,
) {
  const bound = scope ?? captureDbScope();
  try {
    if (!(await loadHistoryEnabled(bound))) return;
    // El evento aterriza en la base dueña del contexto aunque la
    // cuenta activa haya cambiado mientras se leía la preferencia.
    await putReadingEvent(
      {
        ...draft,
        id: crypto.randomUUID(),
        version: 1,
        createdAt: Date.now(),
      } as ReadingEvent,
      bound,
    );
  } catch {
    /* el trayecto es diagnóstico; un fallo no debe notarse */
  }
}

// Poda perezosa al abrir un libro: conserva el historial reciente.
export async function pruneReadingHistory(now = Date.now(), scope?: DbScope) {
  try {
    await pruneReadingEvents(now - HISTORY_RETENTION_MS, scope);
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
  // Telemetría de foco: retrocesos, tiempo en pantalla y avisos de
  // fatiga de la visita.
  regressed: number;
  dwellMs: number;
  fatigueFlags: number;
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
  let regressed = 0;
  let dwellMs = 0;
  let fatigueFlags = 0;

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
      case "page_regressed":
        regressed += 1;
        break;
      case "section_dwell":
        dwellMs += event.ms;
        break;
      case "fatigue_flag":
        fatigueFlags += 1;
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
    regressed,
    dwellMs,
    fatigueFlags,
    savedNotPresented,
  };
}

// ---------- Resumen de cierre de capítulo ----------

export type ChapterSummary = {
  // Formas únicas guardadas en el tramo (repetidas cuentan una).
  saved: number;
  consulted: number;
  declaredKnown: number;
  dwellMs: number;
};

// Cuenta solo lo ocurrido dentro del tramo físico del capítulo y en
// esta visita: las lecturas anteriores del mismo libro no se suman.
// Pura: quien llama ya filtró por libro (listReadingEvents lo hace).
export function chapterSummary(
  events: ReadingEvent[],
  range: { startSection: number; endSection: number },
  visitId: string,
): ChapterSummary {
  const saved = new Set<string>();
  let consulted = 0;
  let declaredKnown = 0;
  let dwellMs = 0;
  for (const event of events) {
    if (event.visitId !== visitId) continue;
    if (!("sectionIndex" in event)) continue;
    if (
      event.sectionIndex < range.startSection ||
      event.sectionIndex >= range.endSection
    )
      continue;
    switch (event.kind) {
      case "word_saved":
        saved.add(event.form.toLowerCase());
        break;
      case "word_consulted":
        consulted += 1;
        break;
      case "word_declared_known":
        declaredKnown += 1;
        break;
      case "section_dwell":
        dwellMs += event.ms;
        break;
    }
  }
  return { saved: saved.size, consulted, declaredKnown, dwellMs };
}

// ¿Hay algo que contar? La tarjeta no se muestra vacía: sin datos
// útiles el capítulo simplemente termina como siempre.
export function hasChapterSummary(summary: ChapterSummary): boolean {
  return (
    summary.saved > 0 ||
    summary.consulted > 0 ||
    summary.declaredKnown > 0 ||
    summary.dwellMs >= 60_000
  );
}

// Formas únicas guardadas dentro de un tramo físico del libro en
// cualquier visita — contexto del marcador de retomar. Pura: quien
// llama ya filtró los eventos por libro (listReadingEvents lo hace).
export function countSavedInRange(
  events: ReadingEvent[],
  range: { startSection: number; endSection: number },
): number {
  const forms = new Set<string>();
  for (const event of events) {
    if (event.kind !== "word_saved") continue;
    if (
      event.sectionIndex < range.startSection ||
      event.sectionIndex >= range.endSection
    )
      continue;
    forms.add(event.form.toLowerCase());
  }
  return forms.size;
}
