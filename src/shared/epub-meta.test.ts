import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectBookLanguage,
  extractEpubCover,
  extractEpubMeta,
  humanizeFilename,
  isHashLikeIdentifier,
} from "./epub-meta";

function createTestZip(files: Record<string, string | Uint8Array>): Uint8Array {
  const fileEntries: Array<{ name: string; data: Uint8Array; offset: number }> = [];
  const parts: Uint8Array[] = [];
  let currentOffset = 0;

  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const nameBytes = new TextEncoder().encode(name);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0, true); // no compression
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint32(14, 0, true); // crc
    view.setUint32(18, data.length, true); // compressed size
    view.setUint32(22, data.length, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    fileEntries.push({ name, data, offset: currentOffset });
    parts.push(localHeader, data);
    currentOffset += localHeader.length + data.length;
  }

  const cdStart = currentOffset;
  let cdSize = 0;

  for (const entry of fileEntries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const view = new DataView(cdHeader.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, 0, true);
    view.setUint16(12, 0, true);
    view.setUint16(14, 0, true);
    view.setUint32(16, 0, true);
    view.setUint32(20, entry.data.length, true);
    view.setUint32(24, entry.data.length, true);
    view.setUint16(28, nameBytes.length, true);
    view.setUint16(30, 0, true);
    view.setUint16(32, 0, true);
    view.setUint16(34, 0, true);
    view.setUint16(36, 0, true);
    view.setUint32(38, 0, true);
    view.setUint32(42, entry.offset, true);
    cdHeader.set(nameBytes, 46);

    parts.push(cdHeader);
    cdSize += cdHeader.length;
    currentOffset += cdHeader.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, fileEntries.length, true);
  eocdView.setUint16(10, fileEntries.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdStart, true);
  eocdView.setUint16(20, 0, true);
  parts.push(eocd);

  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of parts) {
    out.set(part, pos);
    pos += part.length;
  }
  return out;
}

describe("extractEpubMeta", () => {
  it("extrae título, autor y secciones de fixtures/minimal.epub", async () => {
    const fixturePath = resolve(__dirname, "../../fixtures/minimal.epub");
    const data = new Uint8Array(readFileSync(fixturePath));
    const meta = await extractEpubMeta(data);
    expect(meta).not.toBeNull();
    expect(meta?.title).toBe("Libro de prueba");
    expect(meta?.author).toBe("Equipo Lecta");
    expect(meta?.sections).toBe(2);
    expect(meta?.language).toBe("es");
  });

  it("devuelve null para bytes no válidos", async () => {
    const meta = await extractEpubMeta(new Uint8Array([1, 2, 3, 4]));
    expect(meta).toBeNull();
  });

  it("soporta atributos XML arbitrarios en dc:title y bloques CDATA", async () => {
    const containerXml = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

    const opfXml = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title id="t1" xml:lang="en" dir="ltr" opf:file-as="Adventures of Sherlock"><![CDATA[The Adventures of Sherlock & Watson]]></dc:title>
    <dc:creator id="c1" opf:role="aut"><![CDATA[Arthur Conan Doyle]]></dc:creator>
    <dc:language id="l1">en-GB</dc:language>
  </metadata>
  <spine>
    <itemref idref="sec1"/>
    <itemref idref="sec2"/>
    <itemref idref="sec3"/>
  </spine>
</package>`;

    const zipBytes = createTestZip({
      "META-INF/container.xml": containerXml,
      "OEBPS/package.opf": opfXml,
    });

    const meta = await extractEpubMeta(zipBytes);
    expect(meta).not.toBeNull();
    expect(meta?.title).toBe("The Adventures of Sherlock & Watson");
    expect(meta?.author).toBe("Arthur Conan Doyle");
    expect(meta?.language).toBe("en");
    expect(meta?.sections).toBe(3);
  });
});

describe("extractEpubCover", () => {
  it("extrae portada de EPUB 3 (properties='cover-image')", async () => {
    const fakeCoverBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    const containerXml = `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
    const opfXml = `<package version="3.0">
      <manifest>
        <item id="cov" href="images/cover.png" media-type="image/png" properties="cover-image"/>
      </manifest>
    </package>`;

    const zipBytes = createTestZip({
      "META-INF/container.xml": containerXml,
      "content.opf": opfXml,
      "images/cover.png": fakeCoverBytes,
    });

    const cover = await extractEpubCover(zipBytes);
    expect(cover).not.toBeNull();
    expect(cover?.mediaType).toBe("image/png");
    expect(cover?.data).toEqual(fakeCoverBytes);
  });

  it("extrae portada de EPUB 2 (<meta name='cover' content='cov-id'>)", async () => {
    const fakeCoverBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG header
    const containerXml = `<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>`;
    const opfXml = `<package version="2.0">
      <metadata>
        <meta name="cover" content="my-cover-item"/>
      </metadata>
      <manifest>
        <item id="my-cover-item" href="cover.jpg" media-type="image/jpeg"/>
      </manifest>
    </package>`;

    const zipBytes = createTestZip({
      "META-INF/container.xml": containerXml,
      "OEBPS/book.opf": opfXml,
      "OEBPS/cover.jpg": fakeCoverBytes,
    });

    const cover = await extractEpubCover(zipBytes);
    expect(cover).not.toBeNull();
    expect(cover?.mediaType).toBe("image/jpeg");
    expect(cover?.data).toEqual(fakeCoverBytes);
  });
});

describe("detectBookLanguage (shared)", () => {
  it("detecta idioma inglés desde XML OPF con dc:language", () => {
    const opf = `<package><metadata><dc:language>en-US</dc:language></metadata></package>`;
    expect(detectBookLanguage(opf)).toBe("en");
  });

  it("detecta idioma español desde XML OPF con dc:language", () => {
    const opf = `<package><metadata><dc:language>es-ES</dc:language></metadata></package>`;
    expect(detectBookLanguage(opf)).toBe("es");
  });

  it("resuelve código de idioma directo", () => {
    expect(detectBookLanguage("en")).toBe("en");
    expect(detectBookLanguage("eng")).toBe("en");
    expect(detectBookLanguage("es")).toBe("es");
    expect(detectBookLanguage("spa")).toBe("es");
  });

  it("usa muestra de texto cuando el OPF es ambiguo o falta", () => {
    const englishSample = "It was the best of times, it was the worst of times, it was the age of wisdom.";
    expect(detectBookLanguage(undefined, englishSample)).toBe("en");
    expect(detectBookLanguage("<dc:language>und</dc:language>", englishSample)).toBe("en");

    const spanishSample = "En un lugar de la Mancha de cuyo nombre no quiero acordarme vivía un hidalgo.";
    expect(detectBookLanguage(undefined, spanishSample)).toBe("es");
  });

  it("recae a 'es' ante entradas vacías", () => {
    expect(detectBookLanguage()).toBe("es");
    expect(detectBookLanguage("", "")).toBe("es");
  });
});

describe("isHashLikeIdentifier & humanizeFilename (shared)", () => {
  it("detecta identificadores estilo hash", () => {
    expect(isHashLikeIdentifier("ebe48104.epub")).toBe(true);
    expect(isHashLikeIdentifier("Libro ebe48104.epub")).toBe(true);
    expect(isHashLikeIdentifier("mi-libro.epub")).toBe(false);
  });

  it("humaniza nombres de archivo", () => {
    expect(humanizeFilename("mi-libro-genial.epub")).toBe("Mi Libro Genial");
    expect(humanizeFilename("ebe48104.epub")).toBe("");
  });
});
