// Genera fixtures/minimal.epub — EPUB de 2 secciones con cargas XSS de prueba.
// Las cargas escriben window.__xss en vez de alert(): si alguna se ejecutara,
// no bloquearía la página y quedaría marcada para detectarla en pruebas.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = join(root, "node_modules/.fixture-epub");
const out = join(root, "fixtures/minimal.epub");

const files = {
  "mimetype": "application/epub+zip",
  "META-INF/container.xml": `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  "OEBPS/package.opf": `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">test-epub-1</dc:identifier><dc:title>Libro de prueba</dc:title><dc:language>es</dc:language><dc:creator>Equipo Lecta</dc:creator><dc:date>2026-10-03</dc:date></metadata><manifest><item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/><item id="chapter2" href="chapter2.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter1"/><itemref idref="chapter2"/></spine></package>`,
  "OEBPS/nav.xhtml": `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="chapter1.xhtml">Capítulo uno</a></li><li><a href="chapter2.xhtml">Capítulo dos</a></li></ol></nav></body></html>`,
  "OEBPS/chapter1.xhtml": `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="es"><head><title>Capítulo uno</title><script>window.__xss=1</script></head><body><h1>Capítulo uno</h1><p>La casa antigua tenía una puerta estrecha.</p><p>Luis leyó despacio una palabra difícil: perenne.</p><img src="x" onerror="window.__xss=1"/><a href="javascript:window.__xss=1">enlace</a></body></html>`,
  "OEBPS/chapter2.xhtml": `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="es"><head><title>Capítulo dos</title></head><body><h1>Capítulo dos</h1><p>Otra sección para comprobar navegación.</p></body></html>`,
};

rmSync(work, { recursive: true, force: true });
for (const [name, content] of Object.entries(files)) {
  const path = join(work, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

rmSync(out, { force: true });
execFileSync("zip", ["-X0", out, "mimetype"], { cwd: work });
execFileSync("zip", ["-X9rq", out, ".", "-x", "mimetype"], { cwd: work });
rmSync(work, { recursive: true, force: true });
console.log(`Listo: ${out}`);
