// bench-kindle — CPU del pipeline Kindle por paso de página.
// Mide parseEpub → getEpubChapter → paginateChapter → wrapWordsWithLinks
// sobre el EPUB de muestra y sobre un EPUB sintético de ~8 MB.
//
// Uso: pnpm bench:kindle [--save]
//   --save  guarda el reporte en artifacts/kindle-bench/baseline.txt
//
// Solo mide CPU del proceso (Node). La latencia de R2 y de la base se
// lee en la cabecera Server-Timing de /k/read/*.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import {
  getEpubChapter,
  paginateChapter,
  parseEpub,
  wrapWordsWithLinks,
} from "../src/worker/kindle/epub-reader.ts";

const WORDS = [
  "la", "casa", "puerta", "sombra", "camino", "silencio", "memoria", "viento",
  "piedra", "agua", "luz", "papel", "ventana", "huerto", "barro", "cuerda",
  "mano", "voz", "tarde", "invierno", "cuaderno", "lámpara", "escalera",
];

// PRNG con semilla: mismo texto en cada ejecución.
let seed = 20261101;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const sentence = (words) => {
  const parts = [];
  for (let i = 0; i < words; i += 1) parts.push(WORDS[Math.floor(rand() * WORDS.length)]);
  const text = parts.join(" ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
};

const paragraph = (index) => {
  const count = [8, 22, 55, 12, 34, 70][index % 6];
  const sentences = [];
  let budget = count;
  while (budget > 0) {
    const take = Math.min(budget, 10 + Math.floor(rand() * 8));
    sentences.push(sentence(take));
    budget -= take;
  }
  return `<p>${sentences.join(" ")}</p>`;
};

const sectionHtml = (n, paragraphs) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<body><h1>Capítulo ${n}</h1>
${paragraphs.join("\n")}
</body></html>`;

// EPUB sintético de ~8 MB de texto descomprimido: 6 secciones de
// ~1.35 MB de párrafos (el zip lo deja en ~0.4 MB por la repetición).
async function makeSyntheticEpub() {
  const SECTIONS = 6;
  const PARAGRAPHS_PER_SECTION = 1500;
  const files = [];
  for (let s = 1; s <= SECTIONS; s++) {
    const paragraphs = [];
    for (let i = 0; i < PARAGRAPHS_PER_SECTION; i++) paragraphs.push(paragraph(i));
    files.push({ name: `OEBPS/s${s}.xhtml`, body: sectionHtml(s, paragraphs) });
  }
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">lecta-bench</dc:identifier>
<dc:title>EPUB sintético</dc:title><dc:language>es</dc:language>
<dc:creator>Equipo Lecta</dc:creator>
</metadata>
<manifest>
${files.map((f, i) => `<item id="s${i + 1}" href="s${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine>
${files.map((_, i) => `<itemref idref="s${i + 1}"/>`).join("\n")}
</spine>
</package>`;
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
  await writer.add("mimetype", new TextReader("application/epub+zip"), { level: 0 });
  await writer.add("META-INF/container.xml", new TextReader(container));
  for (const f of files) await writer.add(f.name, new TextReader(f.body));
  await writer.add("OEBPS/package.opf", new TextReader(opf));
  const blob = await writer.close();
  return new Uint8Array(await blob.arrayBuffer());
}

const sortedPercentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];

async function bench(name, bytes, reps) {
  const stages = { parse: [], chapter: [], paginate: [], wrap: [] };
  const saved = new Set(["casa", "memoria", "puerta"]);
  let spineCount = 0;
  let lastPages = 0;
  for (let i = 0; i < reps + 2; i += 1) {
    const t0 = performance.now();
    const epub = await parseEpub(bytes);
    const t1 = performance.now();
    spineCount = epub?.spine.length ?? 0;
    const sectionIndex = spineCount > 0 ? i % spineCount : 0;
    const chapter = await getEpubChapter(bytes, sectionIndex, "bench-hash");
    const t2 = performance.now();
    const pages = chapter
      ? paginateChapter(chapter.contentHtml, { size: "md", margin: "md", layout: "paged", mode: "clean" })
      : [];
    const t3 = performance.now();
    for (const p of pages.slice(0, 3)) {
      wrapWordsWithLinks(p, saved, { anchors: false });
    }
    const t4 = performance.now();
    lastPages = pages.length;
    if (i < 2) continue; // calentamiento
    stages.parse.push(t1 - t0);
    stages.chapter.push(t2 - t1);
    stages.paginate.push(t3 - t2);
    stages.wrap.push(t4 - t3);
  }
  const lines = [`${name} — ${bytes.byteLength.toLocaleString("es-MX")} bytes, ${spineCount} secciones, ${reps} rep.`];
  for (const [stage, arr] of Object.entries(stages)) {
    const s = [...arr].sort((a, b) => a - b);
    lines.push(`  ${stage.padEnd(10)} p50 ${sortedPercentile(s, 0.5).toFixed(1)} ms · p95 ${sortedPercentile(s, 0.95).toFixed(1)} ms`);
  }
  lines.push(`  (última sección paginada: ${lastPages} páginas)`);
  return lines.join("\n");
}

const azul = new Uint8Array(
  readFileSync(resolve(process.cwd(), "public/libros/azul-ruben-dario.epub")),
);
const synthetic = await makeSyntheticEpub();

const report = [
  `bench-kindle — CPU del pipeline por paso de página`,
  `fecha: ${new Date().toISOString()}  node: ${process.version}`,
  "",
  await bench("azul-ruben-dario.epub", azul, 20),
  "",
  await bench("epub-sintetico (~8 MB de texto)", synthetic, 10),
].join("\n");

console.log(report);

if (process.argv.includes("--save")) {
  const outDir = resolve(process.cwd(), "artifacts/kindle-bench");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, "baseline.txt"), `${report}\n`);
  console.log(`\nGuardado en artifacts/kindle-bench/baseline.txt`);
}
