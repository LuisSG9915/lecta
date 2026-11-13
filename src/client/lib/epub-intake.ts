// Validación de un EPUB elegido por la persona (docs/designs/2026-11-12-planes-y-landing.md).
// Extraída de selectBook en App.tsx: tamaño, firma de los primeros 4096 bytes
// y, al adjuntar un libro de otra cuenta/dispositivo, el buffer completo.
import { checkEpubBuffer, checkEpubHeader, EPUB_MAX_BYTES } from "../../shared/epub-check";
import { sha256Hex } from "./hash";

export type EpubCheck = { ok: true } | { ok: false; reason: "size" | "format" };

export const EPUB_SIZE_ERROR = "El archivo está vacío o pesa más de 50 MB.";
export const EPUB_FORMAT_ERROR =
  "Este archivo no parece un EPUB válido. Lecta solo acepta .epub de texto adaptable y sin protección.";

export async function checkEpubFile(file: Blob, opts: { full?: boolean } = {}): Promise<EpubCheck> {
  if (!file.size || file.size > EPUB_MAX_BYTES) return { ok: false, reason: "size" };
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (!checkEpubHeader(head).ok) return { ok: false, reason: "format" };
  if (opts.full && !checkEpubBuffer(await file.arrayBuffer()).ok) {
    return { ok: false, reason: "format" };
  }
  return { ok: true };
}

export const epubCheckMessage = (check: Exclude<EpubCheck, { ok: true }>) =>
  check.reason === "size" ? EPUB_SIZE_ERROR : EPUB_FORMAT_ERROR;

export type AttachResult =
  | { ok: true }
  | { ok: false; reason: "size" | "format" | "mismatch" };

/**
 * Empareja el archivo adjunto con el libro de la estantería: solo por sha256
 * exacto, así la posición y las frases del Cuaderno corresponden al mismo
 * binario.
 */
export async function matchAttachedEpub(file: Blob, expectedHash: string): Promise<AttachResult> {
  const check = await checkEpubFile(file, { full: true });
  if (!check.ok) return check;
  const hash = await sha256Hex(file);
  return hash === expectedHash ? { ok: true } : { ok: false, reason: "mismatch" };
}
