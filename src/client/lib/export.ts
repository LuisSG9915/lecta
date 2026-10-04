import type { SavedAnnotation, SavedInterval, SavedWord } from "./idb";
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
