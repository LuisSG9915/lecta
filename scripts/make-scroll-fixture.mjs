// Genera fixtures/scroll.epub: un EPUB largo y determinista para probar la
// restauración de posición del lector (e2e/reader-position.spec.ts).
//
// Cada párrafo empieza con un token único («P07 · …») para que la prueba
// pueda decir exactamente qué bloque quedó arriba al guardar y al reabrir.
// Los párrafos alternan longitudes (corto / medio / muy largo) porque el
// fallo de posición se nota justo cuando el bloque ancla es más alto que
// la ventana: ahí es donde se pierde el desplazamiento dentro del bloque.
//
// Uso: node scripts/make-scroll-fixture.mjs

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";

const EPUB_PATH = resolve(process.cwd(), "fixtures/scroll.epub");

const WORDS = [
  "la", "casa", "puerta", "sombra", "camino", "silencio", "memoria", "viento",
  "piedra", "agua", "luz", "papel", "ventana", "huerto", "barro", "cuerda",
  "mano", "voz", "tarde", "invierno", "cuaderno", "lámpara", "escalera",
];

// PRNG con semilla: mismo texto en cada ejecución.
let seed = 20261029;
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

// Longitudes alternadas: corto, medio y largo (> una pantalla de móvil).
const LENGTHS = [8, 22, 55, 12, 34, 70, 9, 28, 48];

const paragraph = (chapter, index) => {
  const token = `P${String(index).padStart(2, "0")}`;
  const count = LENGTHS[index % LENGTHS.length];
  const sentences = [];
  let budget = count;
  while (budget > 0) {
    const take = Math.min(budget, 10 + Math.floor(rand() * 8));
    sentences.push(sentence(take));
    budget -= take;
  }
  return `<p>${token} · ${sentences.join(" ")}</p>`;
};

function chapter(chapterIndex) {
  const paragraphs = [];
  for (let i = 1; i <= 26; i += 1) {
    paragraphs.push(paragraph(chapterIndex, i));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head><title>Capítulo ${chapterIndex}</title></head>
<body>
<h1>Capítulo ${chapterIndex}</h1>
${paragraphs.join("\n")}
</body>
</html>`;
}

const CHAPTERS = [1, 2, 3];
const chapterFiles = CHAPTERS.map((n) => ({
  name: `OEBPS/cap${n}.xhtml`,
  body: chapter(n),
}));

const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol>
${CHAPTERS.map((n) => `<li><a href="cap${n}.xhtml">Capítulo ${n}</a></li>`).join("\n")}
</ol></nav></body></html>`;

const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">lecta-scroll-fixture</dc:identifier>
<dc:title>Libro largo de prueba</dc:title>
<dc:language>es</dc:language>
<dc:creator>Equipo Lecta</dc:creator>
<dc:date>2026-10-29</dc:date>
</metadata>
<manifest>
${CHAPTERS.map((n) => `<item id="cap${n}" href="cap${n}.xhtml" media-type="application/xhtml+xml"/>`).join("\n")}
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
</manifest>
<spine>
${CHAPTERS.map((n) => `<itemref idref="cap${n}"/>`).join("\n")}
</spine>
</package>`;

const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const writer = new ZipWriter(new BlobWriter("application/epub+zip"));
// El mimetype va primero y sin comprimir, como exige el formato.
await writer.add("mimetype", new TextReader("application/epub+zip"), { level: 0 });
await writer.add("META-INF/container.xml", new TextReader(container));
for (const file of chapterFiles) {
  await writer.add(file.name, new TextReader(file.body));
}
await writer.add("OEBPS/nav.xhtml", new TextReader(nav));
await writer.add("OEBPS/package.opf", new TextReader(opf));
const blob = await writer.close();
const bytes = new Uint8Array(await blob.arrayBuffer());
writeFileSync(EPUB_PATH, bytes);
console.log(`fixtures/scroll.epub → ${bytes.byteLength} bytes`);
