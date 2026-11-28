import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import "../../marketing/landing/nivel.js";

const helpers = (globalThis as unknown as {
  __LECTA_NIVEL_HELPERS__: {
    extractEpubSample: (
      buffer: ArrayBuffer,
      opts?: { inflateRaw?: (bytes: Uint8Array) => Promise<Uint8Array> },
    ) => Promise<{
      title: string;
      author: string;
      language: string;
      totalWords: number;
      length: string;
      sampleWordCounts: Record<string, number>;
      sampleTotalTokens: number;
      candidateForms: string[];
    }>;
    scoreCustomEpub: (
      sample: { sampleWordCounts: Record<string, number> },
      entriesByForm: Record<string, Array<{ lemma: string; pos: string | null; zipf: number | null; senses: { definition: string }[] }>>,
      lvl: "beginner" | "intermediate" | "advanced",
    ) => {
      percent: number;
      words: Array<{ word: string; pos: string; gloss: string }>;
      usedFallback: boolean;
    };
  };
}).__LECTA_NIVEL_HELPERS__;

function buildZip(entries: Array<{ name: string; content: string; deflate?: boolean }>): ArrayBuffer {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const cdParts: Uint8Array[] = [];
  let offset = 0;

  for (const item of entries) {
    const nameBytes = encoder.encode(item.name);
    const rawBytes = encoder.encode(item.content);
    const compressed = item.deflate ? new Uint8Array(deflateRawSync(rawBytes)) : rawBytes;
    const method = item.deflate ? 8 : 0;

    const local = new Uint8Array(30 + nameBytes.length + compressed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, compressed.length, true);
    lv.setUint32(22, rawBytes.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(compressed, 30 + nameBytes.length);
    localParts.push(local);

    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, compressed.length, true);
    cv.setUint32(24, rawBytes.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    cdParts.push(cd);

    offset += local.length;
  }

  const cdSize = cdParts.reduce((acc, b) => acc + b.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + cdSize + eocd.length);
  let pos = 0;
  for (const part of [...localParts, ...cdParts, eocd]) {
    out.set(part, pos);
    pos += part.length;
  }
  return out.buffer;
}

describe("M1 — /nivel escáner EPUB 100 % local", () => {
  it("extrae título, autor, idioma y capítulo sustancial de un EPUB comprimido con deflate", async () => {
    const fillerWords = Array.from({ length: 190 }, (_, i) =>
      i % 7 === 0 ? "melancholy" : i % 5 === 0 ? "lantern" : "journey",
    ).join(" ");

    const epub = buildZip([
      {
        name: "META-INF/container.xml",
        content: `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
      },
      {
        name: "OEBPS/content.opf",
        deflate: true,
        content: `<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>The Silent Lantern</dc:title>
          <dc:creator>Ada Lovelace</dc:creator>
          <dc:language>en-GB</dc:language>
        </metadata><manifest>
          <item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>
          <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        </manifest><spine>
          <itemref idref="cover"/>
          <itemref idref="ch1"/>
        </spine></package>`,
      },
      {
        name: "OEBPS/text/cover.xhtml",
        deflate: true,
        content: `<html><body><h1>Title Page</h1></body></html>`,
      },
      {
        name: "OEBPS/text/ch1.xhtml",
        deflate: true,
        content: `<html><body><p>In the quiet harbor the ${fillerWords} lingered past dusk.</p></body></html>`,
      },
    ]);

    const sample = await helpers.extractEpubSample(epub);
    expect(sample.title).toBe("The Silent Lantern");
    expect(sample.author).toBe("Ada Lovelace");
    expect(sample.language).toBe("en");
    expect(sample.totalWords).toBeGreaterThanOrEqual(195);
    expect(sample.sampleWordCounts.melancholy).toBeGreaterThan(20);
    expect(sample.candidateForms).toContain("melancholy");
  });

  it("rechaza archivos no-ZIP y EPUBs protegidos con DRM", async () => {
    const bad = new TextEncoder().encode("not a zip at all").slice().buffer;
    await expect(helpers.extractEpubSample(bad)).rejects.toThrow(/EPUB válido/);

    const drmEpub = buildZip([
      {
        name: "META-INF/encryption.xml",
        content: `<encryption><EncryptedData><EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/></EncryptedData></encryption>`,
      },
      {
        name: "META-INF/container.xml",
        content: `<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`,
      },
    ]);
    await expect(helpers.extractEpubSample(drmEpub)).rejects.toThrow(/DRM/);
  });

  it("scoreCustomEpub escala el porcentaje por nivel y devuelve hasta 10 palabras clave con glosa", () => {
    const sample = {
      sampleWordCounts: {
        the: 20,
        house: 15,
        river: 12,
        lantern: 10,
        melancholy: 8,
        recondite: 6,
      },
    };
    const entriesByForm = {
      house: [{ lemma: "house", pos: "sustantivo", zipf: 5.8, senses: [{ definition: "casa" }] }],
      river: [{ lemma: "river", pos: "sustantivo", zipf: 4.8, senses: [{ definition: "río" }] }],
      lantern: [{ lemma: "lantern", pos: "sustantivo", zipf: 4.0, senses: [{ definition: "farol" }] }],
      melancholy: [{ lemma: "melancholy", pos: "adjetivo", zipf: 3.3, senses: [{ definition: "melancolía" }] }],
      recondite: [{ lemma: "recondite", pos: "adjetivo", zipf: 2.1, senses: [{ definition: "recóndito" }] }],
    };

    const beg = helpers.scoreCustomEpub(sample, entriesByForm, "beginner");
    const mid = helpers.scoreCustomEpub(sample, entriesByForm, "intermediate");
    const adv = helpers.scoreCustomEpub(sample, entriesByForm, "advanced");

    expect(beg.usedFallback).toBe(false);
    expect(beg.percent).toBeLessThan(mid.percent);
    expect(mid.percent).toBeLessThan(adv.percent);
    expect(beg.words.map((w) => w.word)).toContain("lantern");
    expect(beg.words[0]?.gloss).toBeTruthy();
    expect(adv.words.map((w) => w.word)).toEqual(["recondite"]);
  });
});
