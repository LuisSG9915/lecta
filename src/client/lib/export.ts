import {
  captureDbScope,
  listAllReviews,
  listAnnotations,
  listIntervals,
  listKnowledge,
  listPositions,
  listReadingDays,
  listReadingEvents,
  listSavedWords,
  listStoredBooks,
  listSessionKeys,
  loadSessionValue,
  type KnownWord,
  type ReadingEvent,
  type SavedAnnotation,
  type SavedBookPosition,
  type SavedInterval,
  type SavedReview,
  type SavedWord,
  type StoredBook,
} from "./idb";
import { USE_AI_KEY } from "./ai-pref";
import { HISTORY_KEY } from "./reading-events";
import { timeByDay } from "./reading-activity";

// Campos que empiezan con =, +, -, @ se interpretan como fórmulas en
// hojas de cálculo: se neutralizan con un apóstrofo inicial.
const neutralize = (text: string) => (/^[=+\-@]/.test(text) ? `'${text}` : text);

const csvField = (value: string | null | undefined) => {
  const clean = neutralize(String(value ?? "").replace(/[\r\n\t]+/g, " "));
  return `"${clean.replace(/"/g, '""')}"`;
};

const htmlEsc = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\r\n]+/g, " ");

// Descarga un texto como archivo: el patrón del Cuaderno reutilizado
// por los tres CSV (palabras, pasajes, actividad).
export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type BookNamer = (hash: string | undefined) => string | undefined;

// CSV UTF-8 con BOM para que Excel y Numbers reconozcan los acentos.
export function wordsToCsv(words: SavedWord[], bookName: BookNamer): string {
  const header = ["Palabra", "Lema", "Categoría", "Significado", "Oración", "Libro", "Idioma", "Guardada"];
  const rows = words.map((word) =>
    [
      word.form,
      word.lemma ?? "",
      word.pos ?? "",
      word.meaning ?? "",
      word.context ?? "",
      bookName(word.bookHash) ?? "",
      word.language,
      new Date(word.savedAt).toISOString().slice(0, 10),
    ]
      .map(csvField)
      .join(","),
  );
  return "﻿" + [header.map(csvField).join(","), ...rows].join("\r\n");
}

// TSV importable en Anki: frente = palabra, reverso = significado con
// la oración y el libro en HTML escapado. La tercera columna son
// etiquetas (idioma, libro) para filtrar el mazo.
export function wordsToAnkiTsv(words: SavedWord[], bookName: BookNamer): string {
  return words
    .map((word) => {
      const front = htmlEsc(word.form);
      const back = [
        htmlEsc(word.meaning ?? ""),
        word.context ? `<br><i>«${htmlEsc(word.context)}»</i>` : "",
        bookName(word.bookHash) ? `<br><small>${htmlEsc(bookName(word.bookHash) ?? "")}</small>` : "",
      ].join("");
      const tags = [word.language, bookName(word.bookHash)]
        .filter(Boolean)
        .map((tag) => (tag ?? "").replace(/\s+/g, "_"))
        .join(" ");
      return `${front}\t${back}\t${tags}`;
    })
    .join("\n");
}

// Pasajes guardados: solo el fragmento que eligió el lector y su nota,
// nunca texto corrido del libro.
export function passagesToCsv(
  passages: SavedAnnotation[],
  bookName: BookNamer,
): string {
  const header = ["Libro", "Capítulo", "Pasaje", "Nota", "Guardado"];
  const rows = passages
    .filter((item) => item.kind === "passage")
    .map((item) =>
      [
        bookName(item.bookHash) ?? "",
        item.sectionIndex > 0 ? `Capítulo ${item.sectionIndex + 1}` : "Inicio",
        item.text ?? "",
        item.note ?? "",
        new Date(item.createdAt).toISOString().slice(0, 10),
      ]
        .map(csvField)
        .join(","),
    );
  return "﻿" + [header.map(csvField).join(","), ...rows].join("\r\n");
}

// Notas y citas en Markdown para Obsidian/Notion: un documento con
// encabezado por libro, capítulo como subtítulo, el pasaje como cita
// en bloque y la nota del lector debajo. Solo viajan el fragmento
// elegido y la nota — nunca texto corrido del libro.
export function annotationsToMarkdown(
  annotations: SavedAnnotation[],
  bookName: BookNamer,
  exportedAt = Date.now(),
): string {
  const usable = annotations
    .filter((item) => !item.deleted && (item.text?.trim() || item.note?.trim()))
    .sort(
      (a, b) =>
        (bookName(a.bookHash) ?? a.bookHash ?? "").localeCompare(
          bookName(b.bookHash) ?? b.bookHash ?? "",
          "es",
        ) ||
        a.sectionIndex - b.sectionIndex ||
        a.createdAt - b.createdAt,
    );

  const quote = (text: string) =>
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

  const lines = [
    "# Notas y citas — Lecta",
    "",
    `_Exportado el ${new Date(exportedAt).toISOString().slice(0, 10)}_`,
    "",
  ];
  let book = "";
  let section = -1;
  for (const item of usable) {
    const title = bookName(item.bookHash) ?? "Sin libro";
    if (title !== book) {
      book = title;
      section = -1;
      lines.push(`## ${title}`, "");
    }
    if (item.sectionIndex !== section) {
      section = item.sectionIndex;
      if (section > 0) lines.push(`### Capítulo ${section + 1}`, "");
    }
    if (item.text?.trim()) lines.push(quote(item.text.trim()), "");
    const note = item.note?.trim().replace(/\s+/g, " ");
    if (note) lines.push(`**Nota:** ${note}`, "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

// Actividad por día y libro, en minutos enteros. Misma agregación que
// muestra el panel: los intervalos se unen antes de repartir, así el
// archivo tampoco duplica tiempo solapado.
export function activityToCsv(
  intervals: SavedInterval[],
  bookName: BookNamer,
  timeZone: string,
): string {
  const header = ["Fecha", "Libro", "Minutos"];
  const byBook = new Map<string, SavedInterval[]>();
  for (const item of intervals) {
    const list = byBook.get(item.bookHash);
    if (list) list.push(item);
    else byBook.set(item.bookHash, [item]);
  }
  const rows: string[] = [];
  for (const [bookHash, list] of byBook) {
    for (const day of timeByDay(list, timeZone)) {
      const minutes = Math.floor(day.ms / 60_000);
      if (minutes < 1) continue;
      rows.push(
        [day.dayKey, bookName(bookHash) ?? "", String(minutes)]
          .map(csvField)
          .join(","),
      );
    }
  }
  rows.sort();
  return "﻿" + [header.map(csvField).join(","), ...rows].join("\r\n");
}

// ---------- Respaldo completo (JSON) ----------

// Claves del almacén «session» que forman parte del respaldo. Las
// escriben vocab.ts, reading-sync.ts, positions-sync.ts, Reader.tsx,
// calibration.ts y ai-pref.ts; se listan a mano porque el store es
// clave-valor abierto
// y no hay un registro central. «readingDays» también vive ahí pero ya
// sale como sección propia (listReadingDays).
const BACKUP_SESSION_KEYS = [
  "latestBookHash",
  "vocabLastSyncAt",
  "annotationsLastSyncAt",
  "activityLastSyncAt",
  "reviewsLastSyncAt",
  "positionsLastSyncAt",
  "knowledgeLastSyncAt",
  "suggestionLevel",
  "readingWpm",
  "calibrationDone",
  "calibrationDraft",
  "readingGoal:v1",
  "learnExposure:v1",
  USE_AI_KEY,
  HISTORY_KEY,
] as const;

// Además de la lista explícita salen por prefijo los registros del
// ciclo del lector: elección de inicio y borrador/resultado de cada
// preparación (formatos congelados en preparation.ts). Sellos de sync
// y ajustes internos fuera de la lista no se respaldan.
const BACKUP_SESSION_PREFIXES = ["bookStart:v1:", "preparation:v1:"] as const;

// Lista definitiva de claves de session a respaldar: las explícitas
// más las que casen por prefijo, sin duplicadas.
export function sessionKeysForBackup(allKeys: string[]): string[] {
  const keys = new Set<string>(BACKUP_SESSION_KEYS);
  for (const key of allKeys) {
    if (BACKUP_SESSION_PREFIXES.some((prefix) => key.startsWith(prefix)))
      keys.add(key);
  }
  return [...keys];
}

// El respaldo lleva solo los metadatos del libro: `data` y `cover` son
// blobs que no caben en JSON y tampoco hacen falta — con cuenta el
// archivo se re-sube solo y la portada se regenera al abrirlo.
export type BackupBookMeta = Omit<StoredBook, "data" | "cover">;

export type BackupData = {
  words: SavedWord[];
  reviews: SavedReview[];
  annotations: SavedAnnotation[];
  activity: SavedInterval[];
  positions: SavedBookPosition[];
  knowledge: KnownWord[];
  books: BackupBookMeta[];
  readingDays: number[];
  // Trayecto local (diagnóstico): entra al respaldo para poder
  // revisar y mejorar las sugerencias; no se sincroniza al servidor.
  events: ReadingEvent[];
  session: Record<string, string>;
};

// Función pura: recibe los datos ya leídos y devuelve el JSON con
// versión, para poder interpretarlo si el formato cambia más adelante.
export function buildBackup(data: BackupData, exportedAt = Date.now()): string {
  return JSON.stringify(
    {
      version: 1,
      exportedAt: new Date(exportedAt).toISOString(),
      words: data.words,
      reviews: data.reviews,
      annotations: data.annotations,
      activity: data.activity,
      positions: data.positions,
      knowledge: data.knowledge,
      books: data.books,
      readingDays: data.readingDays,
      events: data.events,
      session: data.session,
    },
    null,
    2,
  );
}

// Reúne todo lo del dispositivo y lo descarga como
// lecta-respaldo-<fecha>.json (Cuenta → «Descargar mis datos»).
export async function downloadBackup() {
  // Un solo contexto para todo el respaldo: aunque la cuenta cambie a
  // mitad de las lecturas, el archivo sale completo de la base que
  // lo inició — nunca mezcla datos de dos cuentas.
  const bound = captureDbScope();
  const [words, reviews, annotations, activity, positions, knowledge, books, readingDays, events] =
    await Promise.all([
      listSavedWords(undefined, bound),
      listAllReviews(bound),
      listAnnotations(undefined, bound),
      listIntervals(bound),
      listPositions(bound),
      listKnowledge(undefined, bound),
      listStoredBooks(bound),
      listReadingDays(bound),
      listReadingEvents(undefined, bound),
    ]);
  const sessionPairs = await Promise.all(
    sessionKeysForBackup(await listSessionKeys(bound)).map(async (key) => {
      const value = await loadSessionValue(key, bound);
      return value === undefined ? null : ([key, value] as const);
    }),
  );
  const session = Object.fromEntries(
    sessionPairs.filter((pair) => pair !== null),
  );
  const booksMeta: BackupBookMeta[] = books.map((book) => ({
    hash: book.hash,
    name: book.name,
    addedAt: book.addedAt,
    title: book.title,
    author: book.author,
    language: book.language,
    sectionCount: book.sectionCount,
    metaVersion: book.metaVersion,
  }));
  downloadText(
    `lecta-respaldo-${new Date().toISOString().slice(0, 10)}.json`,
    buildBackup({
      words,
      reviews,
      annotations,
      activity,
      positions,
      knowledge,
      books: booksMeta,
      readingDays,
      events,
      session,
    }),
    "application/json",
  );
}
