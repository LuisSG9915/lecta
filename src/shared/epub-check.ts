// Comprobación mínima de un EPUB sin descomprimirlo (§13 del plan):
// firma ZIP, primera entrada llamada "mimetype" y guardada sin comprimir
// con el contenido "application/epub+zip". Sirve en el cliente, que solo
// lee los primeros KB del archivo, y en el servidor.

export const EPUB_MAX_BYTES = 50 * 1024 * 1024;

export type EpubCheck = { ok: true } | { ok: false; reason: string };

const ZIP_SIGNATURE = 0x04034b50;
const EPUB_MIMETYPE = "application/epub+zip";
const METHOD_STORED = 0;
const LOCAL_HEADER_SIZE = 30;

export function checkEpubHeader(bytes: Uint8Array): EpubCheck {
  if (bytes.length < LOCAL_HEADER_SIZE) return { ok: false, reason: "not-zip" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== ZIP_SIGNATURE) return { ok: false, reason: "not-zip" };

  const method = view.getUint16(8, true);
  const nameLen = view.getUint16(26, true);
  const extraLen = view.getUint16(28, true);
  const dataStart = LOCAL_HEADER_SIZE + nameLen + extraLen;
  if (bytes.length < dataStart + EPUB_MIMETYPE.length)
    return { ok: false, reason: "truncated" };

  const decoder = new TextDecoder();
  if (decoder.decode(bytes.subarray(30, 30 + nameLen)) !== "mimetype")
    return { ok: false, reason: "no-mimetype" };
  if (method !== METHOD_STORED) return { ok: false, reason: "bad-mimetype" };
  if (
    decoder.decode(bytes.subarray(dataStart, dataStart + EPUB_MIMETYPE.length)) !== EPUB_MIMETYPE
  )
    return { ok: false, reason: "bad-mimetype" };
  return { ok: true };
}

export function checkEpubBuffer(buffer: ArrayBuffer | Uint8Array): EpubCheck {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return checkEpubHeader(bytes);
}
