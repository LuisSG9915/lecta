import { describe, expect, it } from "vitest";
import { checkEpubHeader, checkEpubBuffer } from "./epub-check";

const enc = (text: string) => [...new TextEncoder().encode(text)];

// Cabecera local ZIP mínima: firma, método y nombre de la primera entrada.
const localHeader = (name: string, method = 0): number[] => {
  const nameBytes = enc(name);
  return [
    0x50, 0x4b, 0x03, 0x04,
    20, 0, // versión
    0, 0, // banderas
    method, 0,
    0, 0, 0, 0, // hora y fecha
    0, 0, 0, 0, // crc32
    0, 0, 0, 0, // tamaño comprimido
    0, 0, 0, 0, // tamaño original
    nameBytes.length, 0,
    0, 0, // sin extra
    ...nameBytes,
  ];
};

const MIMETYPE = enc("application/epub+zip");

describe("checkEpubHeader", () => {
  it("acepta un EPUB con mimetype primero y sin comprimir", () => {
    const epub = new Uint8Array([...localHeader("mimetype"), ...MIMETYPE]);
    expect(checkEpubHeader(epub)).toEqual({ ok: true });
  });

  it("rechaza un archivo que no es ZIP", () => {
    expect(checkEpubHeader(new Uint8Array(enc("esto no es un libro"))).ok).toBe(false);
  });

  it("rechaza cuando la primera entrada no es mimetype", () => {
    const epub = new Uint8Array([...localHeader("META-INF/container.xml"), ...MIMETYPE]);
    expect(checkEpubHeader(epub)).toEqual({ ok: false, reason: "no-mimetype" });
  });

  it("rechaza un mimetype comprimido (la espec lo exige sin comprimir)", () => {
    const epub = new Uint8Array([...localHeader("mimetype", 8), ...MIMETYPE]);
    expect(checkEpubHeader(epub)).toEqual({ ok: false, reason: "bad-mimetype" });
  });

  it("rechaza un mimetype con contenido distinto", () => {
    const epub = new Uint8Array([...localHeader("mimetype"), ...enc("text/plain; charset=x")]);
    expect(checkEpubHeader(epub)).toEqual({ ok: false, reason: "bad-mimetype" });
  });

  it("rechaza un encabezado cortado", () => {
    const epub = new Uint8Array([...localHeader("mimetype")]);
    expect(checkEpubHeader(epub)).toEqual({ ok: false, reason: "truncated" });
  });

  it("checkEpubBuffer valida correctamente tanto ArrayBuffer como Uint8Array", () => {
    const epub = new Uint8Array([...localHeader("mimetype"), ...MIMETYPE]);
    expect(checkEpubBuffer(epub)).toEqual({ ok: true });
    expect(checkEpubBuffer(epub.buffer)).toEqual({ ok: true });
  });
});
