// Normaliza un archivo de subtítulos (.srt, .vtt, .ass/.ssa) al formato
// que consume `subtitleToForms` (src/shared/screen-guide.ts): líneas de
// diálogo con las marcas de tiempo y los números de bloque que ese
// parser ya sabe saltar. Corre en el navegador sobre el archivo que
// trae el usuario: el texto nunca sale del dispositivo.
//
// Lo que quita antes de entregarlo:
// - .vtt: cabecera WEBVTT y bloques NOTE / STYLE / REGION.
// - .ass/.ssa: todo salvo el campo Text de las líneas «Dialogue:»; las
//   etiquetas de estilo {\…} y los saltos \N se resuelven aquí.
// - .srt: ya viene en el formato esperado; se devuelve igual.

// BOM de UTF-8 al inicio del archivo (carácter U+FEFF).
const BOM = String.fromCharCode(0xfeff);
const BOM_RE = new RegExp(`^${BOM}`);

export type SubtitleFormat = "srt" | "vtt" | "ass";

// Tamaño máximo razonable de un archivo de subtítulos (la guía del
// servidor topaba en 1 MB; un episodio real pesa < 200 kB).
export const SUBTITLE_MAX_BYTES = 3 * 1024 * 1024;

export function detectSubtitleFormat(
  filename: string,
  text: string,
): SubtitleFormat {
  const lower = filename.toLowerCase();
  if (/\.vtt$/.test(lower) || new RegExp(`^${BOM}?WEBVTT`).test(text)) return "vtt";
  if (/\.(ass|ssa)$/.test(lower) || new RegExp(`^${BOM}?\\[Script Info\\]`, "i").test(text)) {
    return "ass";
  }
  return "srt";
}

// Decodifica los bytes: UTF-8 y, si deja una estela de U+FFFD (archivo
// en windows-1252, común en subtítulos viejos), reintenta con esa página.
export function decodeSubtitleBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const broken = (utf8.match(/�/g) ?? []).length;
  return broken > 5 ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

function vttToSrtLike(text: string): string {
  const out: string[] = [];
  let skipBlock = false;
  for (const raw of text.replace(BOM_RE, "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      skipBlock = false;
      out.push("");
      continue;
    }
    if (skipBlock) continue;
    if (/^WEBVTT/.test(line)) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(line)) {
      skipBlock = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function assToSrtLike(text: string): string {
  const out: string[] = [];
  let textIndex = -1;
  for (const raw of text.replace(BOM_RE, "").split(/\r?\n/)) {
    const line = raw.trim();
    const format = /^Format:\s*(.+)$/i.exec(line);
    if (format && /\bText\b/i.test(format[1]) && /\bStart\b/i.test(format[1])) {
      textIndex = format[1].split(",").map((f) => f.trim().toLowerCase()).indexOf("text");
      continue;
    }
    const dialogue = /^Dialogue:\s*(.*)$/i.exec(line);
    if (!dialogue) continue;
    // Text es el último campo y puede llevar comas: se parte solo hasta él.
    const fields = textIndex > 0 ? textIndex : 9;
    const parts = dialogue[1].split(",");
    if (parts.length <= fields) continue;
    const body = parts
      .slice(fields)
      .join(",")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\[Nn]/g, "\n")
      .replace(/\\h/g, " ");
    for (const piece of body.split("\n")) {
      if (piece.trim()) out.push(piece.trim());
    }
    out.push("");
  }
  return out.join("\n");
}

export function normalizeSubtitleText(
  filename: string,
  text: string,
): { format: SubtitleFormat; text: string } {
  const format = detectSubtitleFormat(filename, text);
  if (format === "vtt") return { format, text: vttToSrtLike(text) };
  if (format === "ass") return { format, text: assToSrtLike(text) };
  return { format, text };
}
