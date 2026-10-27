import {
  captureDbScope,
  getStoredBook,
  listAllReviews,
  listAnnotations,
  listCompanionEvents,
  listCompanionReceipts,
  listIntervals,
  listKnowledge,
  listPositions,
  listReadingDays,
  listReadingEvents,
  listSavedWords,
  listStoredBooks,
  listSessionKeys,
  loadBookPosition,
  loadSessionValue,
  restoreBackupToDb,
  COMPANION_ACKED_KEY,
  COMPANION_BASELINES_KEY,
  COMPANION_DEVICE_PREFS_KEY,
  COMPANION_MIGRATION_KEY,
  COMPANION_PROFILE_KEY,
  GAME_KEY,
  GAME_STATE_KEY,
  type BackupRestoreResult,
  type DbScope,
  type KnownWord,
  type ReadingEvent,
  type SavedAnnotation,
  type SavedBookPosition,
  type SavedInterval,
  type SavedReview,
  type SavedWord,
  type StoredBook,
} from "./idb";
import type {
  CompanionReceipt,
  GameJournalEvent,
} from "../../shared/companion-data";
import { USE_AI_KEY } from "./ai-pref";
import { HISTORY_KEY } from "./reading-events";
import { timeByDay } from "./reading-activity";

export {
  MAX_BACKUP_WORDS,
  MAX_BACKUP_ANNOTATIONS,
  MAX_BACKUP_POSITIONS,
  MAX_BACKUP_ACTIVITY,
  MAX_BACKUP_REVIEWS,
  MAX_BACKUP_KNOWLEDGE,
  SHA256_HEX_RE,
  validateBackupPayloadStrict,
} from "./idb";

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
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
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

export interface AnkiTsvOptions {
  cloze?: boolean;
}

/**
 * Exporta el mazo de vocabulario a formato TSV para Anki.
 * Con cloze=true (por defecto), transforma la oración del contexto en una tarjeta
 * de supresión de partes con formato {{c1::palabra}}, permitiendo estudiar en contexto real.
 */
export function exportAnkiTsv(
  words: SavedWord[],
  bookName: BookNamer,
  options?: AnkiTsvOptions,
): string {
  const cloze = options?.cloze !== false;
  return words
    .filter((w) => !w.deleted && w.form.trim())
    .map((word) => {
      let front: string;
      const cleanForm = word.form.trim();
      const cleanCtx = word.context?.trim();

      if (cloze && cleanCtx) {
        const escReg = cleanForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`\\b${escReg}\\b`, "i");
        if (regex.test(cleanCtx)) {
          front = htmlEsc(cleanCtx.replace(regex, (m) => `{{c1::${m}}}`));
        } else {
          const lax = new RegExp(escReg, "i");
          if (lax.test(cleanCtx)) {
            front = htmlEsc(cleanCtx.replace(lax, (m) => `{{c1::${m}}}`));
          } else {
            front = `{{c1::${htmlEsc(cleanForm)}}} — <i>«${htmlEsc(cleanCtx)}»</i>`;
          }
        }
      } else if (cloze) {
        front = `{{c1::${htmlEsc(cleanForm)}}}`;
      } else {
        front = htmlEsc(cleanForm);
      }

      const backParts: string[] = [];
      if (word.meaning?.trim()) {
        backParts.push(htmlEsc(word.meaning.trim()));
      }
      if (word.lemma && word.lemma !== word.form) {
        backParts.push(`<br><small><b>Lema:</b> ${htmlEsc(word.lemma)}</small>`);
      }
      if (word.pos) {
        backParts.push(`<br><small><b>Categoría:</b> ${htmlEsc(word.pos)}</small>`);
      }
      const title = bookName(word.bookHash);
      if (title) {
        backParts.push(`<br><small><b>Libro:</b> ${htmlEsc(title)}</small>`);
      }
      const back = backParts.join("");

      const tagParts: string[] = [];
      if (word.language) tagParts.push(`Lecta::${word.language}`);
      if (title) tagParts.push(`Lecta::${sanitizeFilename(title)}`);
      if (word.pos) tagParts.push(word.pos.replace(/\s+/g, "_"));
      const tags = tagParts.join(" ");

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

function escapeYaml(val: string | null | undefined): string {
  return String(val ?? "").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ").trim();
}

export function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "lectura"
  );
}

export function formatReadingDuration(minutes: number): string {
  if (minutes < 1) return "< 1 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} h ${m} min` : `${h} h`;
}

export interface BookExportOptions {
  book: {
    hash: string;
    title?: string;
    author?: string;
    language?: string;
    sectionCount?: number;
  };
  words: SavedWord[];
  annotations: SavedAnnotation[];
  intervals?: SavedInterval[];
  position?: SavedBookPosition | null;
  exportedAt?: number;
  vocabFormat?: "table" | "list";
}

/**
 * Ficha de lectura completa de una obra en formato Markdown para Obsidian, Notion o PKM.
 * Incluye frontmatter YAML estructurado, citas en bloque/callouts, notas personales y vocabulario.
 */
export function bookReadingNoteToMarkdown(options: BookExportOptions): string {
  const {
    book,
    words,
    annotations,
    intervals = [],
    position,
    exportedAt = Date.now(),
  } = options;

  const title = book.title?.trim() || "Sin título";
  const author = book.author?.trim() || "";
  const language = book.language?.trim() || "es";
  const dateIso = new Date(exportedAt).toISOString().slice(0, 10);

  const totalMinutes = Math.round(
    intervals.reduce(
      (sum, int) => sum + Math.max(0, int.endedAt - int.startedAt),
      0,
    ) / 60_000,
  );
  const readingTime = formatReadingDuration(totalMinutes);
  const progressPercent =
    position?.progress != null ? Math.round(position.progress * 100) : 0;

  const usableAnnotations = annotations
    .filter((item) => !item.deleted && (item.text?.trim() || item.note?.trim()))
    .sort((a, b) => a.sectionIndex - b.sectionIndex || a.createdAt - b.createdAt);

  const usableWords = words
    .filter((w) => !w.deleted && w.form.trim())
    .sort((a, b) => a.form.localeCompare(b.form, "es"));

  const quote = (text: string) =>
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

  const lines: string[] = [
    "---",
    `title: "${escapeYaml(title)}"`,
    ...(author ? [`author: "${escapeYaml(author)}"`] : []),
    "source: Lecta",
    `language: "${escapeYaml(language)}"`,
    `date_exported: "${dateIso}"`,
    ...(progressPercent > 0 ? [`progress: "${progressPercent}%"`] : []),
    ...(totalMinutes > 0 ? [`reading_time: "${readingTime}"`] : []),
    `words_saved: ${usableWords.length}`,
    `passages_saved: ${usableAnnotations.length}`,
    "tags:",
    "  - lecta/libro",
    "  - lectura",
    "  - pkm",
    "---",
    "",
    `# ${title}`,
    "",
  ];

  if (author) lines.push(`*Autor:* **${author}**  `);
  lines.push(`*Fecha de exportación:* ${dateIso}  `);
  if (progressPercent > 0) lines.push(`*Progreso en Lecta:* ${progressPercent}%  `);
  if (totalMinutes > 0) lines.push(`*Tiempo dedicado:* ${readingTime}  `);
  lines.push("");

  // Citas y pasajes
  if (usableAnnotations.length > 0) {
    lines.push("## Citas y pasajes destacados", "");
    let currentSection = -1;
    for (const item of usableAnnotations) {
      if (item.sectionIndex !== currentSection) {
        currentSection = item.sectionIndex;
        lines.push(
          currentSection > 0
            ? `### Capítulo ${currentSection + 1}`
            : "### Inicio",
          "",
        );
      }
      if (item.text?.trim()) {
        lines.push(quote(item.text.trim()), "");
      }
      const note = item.note?.trim();
      if (note) {
        lines.push(`> [!note] Reflexión`, `> ${note.replace(/\n/g, "\n> ")}`, "");
      }
    }
  }

  // Vocabulario adquirido
  if (usableWords.length > 0) {
    lines.push("## Vocabulario adquirido", "");
    if (options.vocabFormat === "list") {
      for (const w of usableWords) {
        const posTag = w.pos ? ` *(${w.pos})*` : "";
        const lemmaTag = w.lemma && w.lemma !== w.form ? ` — lema: *${w.lemma}*` : "";
        lines.push(`- **${w.form}**${posTag}${lemmaTag}`);
        if (w.meaning?.trim()) {
          lines.push(`  - **Significado:** ${w.meaning.trim()}`);
        }
        if (w.context?.trim()) {
          lines.push(`  - *«${w.context.trim()}»*`);
        }
      }
    } else {
      const cell = (str: string | null | undefined) =>
        String(str ?? "")
          .replace(/\|/g, "\\|")
          .replace(/[\r\n]+/g, " ")
          .trim();

      lines.push(
        "| Palabra | Lema | Categoría | Significado | Oración en el libro |",
        "| :--- | :--- | :--- | :--- | :--- |",
      );
      for (const w of usableWords) {
        const form = `**${cell(w.form)}**`;
        const lemma = cell(w.lemma || w.form);
        const pos = cell(w.pos || "—");
        const meaning = cell(w.meaning || "—");
        const context = cell(w.context || "—");
        lines.push(`| ${form} | ${lemma} | ${pos} | ${meaning} | ${context} |`);
      }
    }
    lines.push("");
  }

  // Resumen de sesiones si existen intervalos
  if (intervals.length > 0) {
    lines.push("## Sesiones de lectura", "");
    lines.push(`- **Tiempo total registrado:** ${readingTime}`);
    lines.push(`- **Sesiones completadas:** ${intervals.length}`);
    lines.push("");
  }

  lines.push("---", "*Exportado desde [Lecta](https://lecta.app) · Cuaderno de lectura*", "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export interface NotebookExportOptions {
  books: {
    hash: string;
    title?: string;
    author?: string;
    language?: string;
  }[];
  words: SavedWord[];
  annotations: SavedAnnotation[];
  intervals?: SavedInterval[];
  exportedAt?: number;
}

/**
 * Cuaderno integral consolidado de lectura en Markdown para Obsidian, Notion o PKM.
 * Incluye índice de obras, citas organizadas por libro y diccionario de vocabulario personal.
 */
export function fullNotebookToMarkdown(options: NotebookExportOptions): string {
  const {
    books,
    words,
    annotations,
    intervals = [],
    exportedAt = Date.now(),
  } = options;

  const dateIso = new Date(exportedAt).toISOString().slice(0, 10);
  const bookMap = new Map<string, { hash: string; title: string; author?: string; language?: string }>();
  for (const b of books) {
    bookMap.set(b.hash, {
      hash: b.hash,
      title: b.title?.trim() || "Sin título",
      author: b.author?.trim(),
      language: b.language?.trim() || "es",
    });
  }

  const usableWords = words.filter((w) => !w.deleted && w.form.trim());
  const usableAnnotations = annotations.filter(
    (a) => !a.deleted && (a.text?.trim() || a.note?.trim()),
  );

  const totalMinutes = Math.round(
    intervals.reduce(
      (sum, int) => sum + Math.max(0, int.endedAt - int.startedAt),
      0,
    ) / 60_000,
  );
  const readingTime = formatReadingDuration(totalMinutes);

  const lines: string[] = [
    "---",
    `title: "Cuaderno de Lectura — Lecta"`,
    "source: Lecta",
    `date_exported: "${dateIso}"`,
    ...(totalMinutes > 0 ? [`total_reading_time: "${readingTime}"`] : []),
    `total_books: ${books.length}`,
    `total_words: ${usableWords.length}`,
    `total_passages: ${usableAnnotations.length}`,
    "tags:",
    "  - lecta/cuaderno",
    "  - lectura",
    "  - pkm",
    "---",
    "",
    "# Cuaderno de Lectura — Lecta",
    "",
    `_Exportado el ${dateIso} · ${books.length} obra(s) · ${usableWords.length} palabra(s) · ${usableAnnotations.length} pasaje(s)_`,
    "",
  ];

  // Índice de obras
  if (books.length > 0) {
    lines.push("## Índice de obras", "");
    for (const b of books) {
      const bWords = usableWords.filter((w) => w.bookHash === b.hash);
      const bAnn = usableAnnotations.filter((a) => a.bookHash === b.hash);
      const t = b.title || "Sin título";
      lines.push(`- **${t}**${b.author ? ` (${b.author})` : ""} · ${bWords.length} palabra(s) · ${bAnn.length} pasaje(s)`);
    }
    lines.push("");
  }

  const quote = (text: string) =>
    text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

  const hashesWithContent = new Set<string>([
    ...books.map((b) => b.hash),
    ...usableWords.map((w) => w.bookHash ?? ""),
    ...usableAnnotations.map((a) => a.bookHash ?? ""),
  ]);

  for (const hash of hashesWithContent) {
    if (!hash) continue;
    const b = bookMap.get(hash);
    const title = b?.title || "Libro sin título";
    const author = b?.author;

    const bWords = usableWords
      .filter((w) => w.bookHash === hash)
      .sort((a, b) => a.form.localeCompare(b.form, "es"));
    const bAnn = usableAnnotations
      .filter((a) => a.bookHash === hash)
      .sort((a, b) => a.sectionIndex - b.sectionIndex || a.createdAt - b.createdAt);

    if (bWords.length === 0 && bAnn.length === 0) continue;

    lines.push(`## ${title}`, "");
    if (author) lines.push(`*Autor:* ${author}  `);
    lines.push(`*Contenido:* ${bWords.length} palabra(s) · ${bAnn.length} pasaje(s)`, "");

    if (bAnn.length > 0) {
      lines.push("### Citas y pasajes", "");
      let currentSection = -1;
      for (const item of bAnn) {
        if (item.sectionIndex !== currentSection) {
          currentSection = item.sectionIndex;
          lines.push(
            currentSection > 0
              ? `#### Capítulo ${currentSection + 1}`
              : "#### Inicio",
            "",
          );
        }
        if (item.text?.trim()) {
          lines.push(quote(item.text.trim()), "");
        }
        if (item.note?.trim()) {
          lines.push(`> [!note] Reflexión`, `> ${item.note.trim().replace(/\n/g, "\n> ")}`, "");
        }
      }
    }

    if (bWords.length > 0) {
      lines.push("### Vocabulario", "");
      for (const w of bWords) {
        const posTag = w.pos ? ` *(${w.pos})*` : "";
        const lemmaTag = w.lemma && w.lemma !== w.form ? ` — lema: *${w.lemma}*` : "";
        lines.push(`- **${w.form}**${posTag}${lemmaTag}`);
        if (w.meaning?.trim()) {
          lines.push(`  - **Significado:** ${w.meaning.trim()}`);
        }
        if (w.context?.trim()) {
          lines.push(`  - *«${w.context.trim()}»*`);
        }
      }
      lines.push("");
    }
  }

  // Palabras huérfanas sin libro asociado
  const orphanWords = usableWords
    .filter((w) => !w.bookHash)
    .sort((a, b) => a.form.localeCompare(b.form, "es"));
  const orphanAnn = usableAnnotations
    .filter((a) => !a.bookHash)
    .sort((a, b) => a.createdAt - b.createdAt);

  if (orphanWords.length > 0 || orphanAnn.length > 0) {
    lines.push("## Otras notas y palabras", "");
    if (orphanAnn.length > 0) {
      lines.push("### Pasajes", "");
      for (const item of orphanAnn) {
        if (item.text?.trim()) lines.push(quote(item.text.trim()), "");
        if (item.note?.trim()) lines.push(`> [!note] Reflexión\n> ${item.note.trim()}`, "");
      }
    }
    if (orphanWords.length > 0) {
      lines.push("### Vocabulario", "");
      for (const w of orphanWords) {
        lines.push(`- **${w.form}**${w.meaning ? `: ${w.meaning}` : ""}`);
      }
      lines.push("");
    }
  }

  lines.push("---", "*Exportado desde [Lecta](https://lecta.app) · Cuaderno de lectura*", "");
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export async function downloadBookMarkdown(
  bookHash: string,
  bookTitle?: string,
  scope?: DbScope,
): Promise<void> {
  const bound = scope ?? captureDbScope();
  const [stored, position, allWords, allAnnotations, allIntervals] =
    await Promise.all([
      getStoredBook(bookHash, bound).catch(() => null),
      loadBookPosition(bookHash, bound).catch(() => null),
      listSavedWords(undefined, bound).catch(() => []),
      listAnnotations(undefined, bound).catch(() => []),
      listIntervals(bound).catch(() => []),
    ]);

  const bookWords = allWords.filter(
    (w) => w.bookHash === bookHash && !w.deleted,
  );
  const bookAnnotations = allAnnotations.filter(
    (a) => a.bookHash === bookHash && !a.deleted,
  );
  const bookIntervals = allIntervals.filter((i) => i.bookHash === bookHash);

  const title = stored?.title || bookTitle || stored?.name || "Libro";
  const author = stored?.author;
  const language = stored?.language || "es";

  const md = bookReadingNoteToMarkdown({
    book: {
      hash: bookHash,
      title,
      author,
      language,
      sectionCount: stored?.sectionCount,
    },
    words: bookWords,
    annotations: bookAnnotations,
    intervals: bookIntervals,
    position,
  });

  const slug = sanitizeFilename(title);
  const date = new Date().toISOString().slice(0, 10);
  downloadText(`${slug}-lecta-${date}.md`, md, "text/markdown;charset=utf-8");
}

export async function downloadNotebookMarkdown(scope?: DbScope): Promise<void> {
  const bound = scope ?? captureDbScope();
  const [books, words, annotations, intervals] = await Promise.all([
    listStoredBooks(bound).catch(() => []),
    listSavedWords(undefined, bound).catch(() => []),
    listAnnotations(undefined, bound).catch(() => []),
    listIntervals(bound).catch(() => []),
  ]);

  const md = fullNotebookToMarkdown({
    books: books.map((b) => ({
      hash: b.hash,
      title: b.title || b.name,
      author: b.author,
      language: b.language,
    })),
    words: words.filter((w) => !w.deleted),
    annotations: annotations.filter((a) => !a.deleted),
    intervals,
  });

  const date = new Date().toISOString().slice(0, 10);
  downloadText(`cuaderno-lectura-lecta-${date}.md`, md, "text/markdown;charset=utf-8");
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
  "lecta:retention_horizon:v1",
  "learnExposure:v1",
  USE_AI_KEY,
  HISTORY_KEY,
  // Compañero: el gameState v1 sellado y el opt-out viejo se conservan
  // tal cual, junto a las colecciones nuevas del journal y el perfil.
  GAME_STATE_KEY,
  GAME_KEY,
  COMPANION_BASELINES_KEY,
  COMPANION_PROFILE_KEY,
  COMPANION_DEVICE_PREFS_KEY,
  COMPANION_MIGRATION_KEY,
  COMPANION_ACKED_KEY,
  // Índice del catálogo público: pequeño y mantiene Descubre dibujando
  // sin conexión tras una importación. Los manifiestos por libro se
  // quedan fuera — son voluminosos e inmutables, se re-descargan solos.
  "catalogIndex:v1",
] as const;

// Además de la lista explícita salen por prefijo los registros del
// ciclo del lector: elección de inicio, borrador/resultado de cada
// preparación y el análisis de vocabulario de cada libro (formatos
// congelados en preparation.ts y book-vocab.ts). Sellos de sync
// y ajustes internos fuera de la lista no se respaldan.
const BACKUP_SESSION_PREFIXES = [
  "bookStart:v1:",
  "preparation:v1:",
  "bookVocab:v1:",
  "chapterFollow:v1:",
] as const;

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
// blobs binarios que no se incluyen en el JSON ni se re-suben desde un respaldo
// (el usuario debe volver a importar sus archivos EPUB si borra su almacén local).
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
  // Compañero: el journal de premios y las recepciones tal cual están
  // en sus stores (los baselines/registros viajan dentro de session).
  companionEvents: GameJournalEvent[];
  companionReceipts: CompanionReceipt[];
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
      companionEvents: data.companionEvents,
      companionReceipts: data.companionReceipts,
      session: data.session,
    },
    null,
    2,
  );
}

export interface BackupPreviewSummary {
  version: number;
  exportedAt: string;
  booksCount: number;
  wordsCount: number;
  annotationsCount: number;
  positionsCount: number;
  hasCompanionState: boolean;
  reviewsCount: number;
  activityCount: number;
}

export function inspectBackupPayload(jsonString: string): BackupPreviewSummary {
  if (typeof jsonString !== "string" || !jsonString.trim()) {
    throw new Error("El archivo de respaldo está vacío.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(jsonString);
  } catch {
    throw new Error("El archivo no tiene un formato JSON válido.");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("El archivo no contiene un objeto de respaldo válido.");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.version !== "number" || obj.version < 1) {
    throw new Error("El archivo no contiene una versión de respaldo válida.");
  }
  if (obj.version > 1) {
    throw new Error(
      `La versión del respaldo (${obj.version}) es más reciente que la versión soportada (1).`,
    );
  }

  const booksCount = Array.isArray(obj.books) ? obj.books.length : 0;
  const wordsCount = Array.isArray(obj.words) ? obj.words.length : 0;
  const annotationsCount = Array.isArray(obj.annotations) ? obj.annotations.length : 0;
  const positionsCount = Array.isArray(obj.positions) ? obj.positions.length : 0;
  const reviewsCount = Array.isArray(obj.reviews) ? obj.reviews.length : 0;
  const activityCount = Array.isArray(obj.activity) ? obj.activity.length : 0;
  const hasCompanionState = Boolean(
    (Array.isArray(obj.companionEvents) && obj.companionEvents.length > 0) ||
      (Array.isArray(obj.companionReceipts) && obj.companionReceipts.length > 0) ||
      (obj.session &&
        typeof obj.session === "object" &&
        Object.keys(obj.session).some((k) => k.startsWith("comp_"))),
  );

  return {
    version: obj.version,
    exportedAt:
      typeof obj.exportedAt === "string" ? obj.exportedAt : new Date().toISOString(),
    booksCount,
    wordsCount,
    annotationsCount,
    positionsCount,
    hasCompanionState,
    reviewsCount,
    activityCount,
  };
}

export async function restoreBackupPayload(
  payload: BackupData | string | Record<string, unknown>,
  _strategy: "merge-by-updated-at" = "merge-by-updated-at",
  scope?: DbScope,
): Promise<BackupRestoreResult> {
  const data: Partial<BackupData> =
    typeof payload === "string"
      ? (JSON.parse(payload) as Partial<BackupData>)
      : (payload as Partial<BackupData>);

  if (!data || typeof data !== "object") {
    throw new Error("Los datos de respaldo no son válidos para restaurar.");
  }
  return restoreBackupToDb(data as Parameters<typeof restoreBackupToDb>[0], scope);
}

// Reúne todo lo del dispositivo y lo descarga como
// lecta-respaldo-<fecha>.json (Cuenta → «Descargar mis datos»).
export async function downloadBackup() {
  // Un solo contexto para todo el respaldo: aunque la cuenta cambie a
  // mitad de las lecturas, el archivo sale completo de la base que
  // lo inició — nunca mezcla datos de dos cuentas.
  const bound = captureDbScope();
  const [words, reviews, annotations, activity, positions, knowledge, books, readingDays, events, companionEvents, companionReceipts] =
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
      listCompanionEvents(bound),
      listCompanionReceipts(bound),
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
      companionEvents,
      companionReceipts,
      session,
    }),
    "application/json",
  );
}
