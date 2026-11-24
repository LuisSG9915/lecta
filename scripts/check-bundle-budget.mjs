import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DIST_CLIENT_DIR = path.resolve("dist/client");
const INDEX_HTML_PATH = path.join(DIST_CLIENT_DIR, "index.html");

// Presupuestos estrictos con margen razonable sobre el peso actual
const MAX_JS_GZIP_KB = 215; // Presupuesto JS inicial gzip (<= 215 kB)
const MAX_CSS_GZIP_KB = 55; // Presupuesto CSS inicial gzip (<= 55 kB)
const WARN_THRESHOLD_RATIO = 0.90; // Umbral de aviso preventivo al 90%

if (!fs.existsSync(INDEX_HTML_PATH)) {
  console.error(`[Error] No se encontró ${INDEX_HTML_PATH}. Ejecuta 'pnpm run build' primero.`);
  process.exit(1);
}

const html = fs.readFileSync(INDEX_HTML_PATH, "utf8");

// Extraer scripts y modulepreloads
const jsRegex = /<(?:script[^>]*src=["']([^"']+)["']|link[^>]*rel=["']modulepreload["'][^>]*href=["']([^"']+)["']|link[^>]*href=["']([^"']+)["'][^>]*rel=["']modulepreload["'])/g;
const cssRegex = /<link[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']|<link[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/g;

const jsFiles = [];
let m;
while ((m = jsRegex.exec(html)) !== null) {
  const file = m[1] || m[2] || m[3];
  if (file && file.endsWith(".js")) {
    jsFiles.push(file.replace(/^\//, ""));
  }
}

const cssFiles = [];
while ((m = cssRegex.exec(html)) !== null) {
  const file = m[1] || m[2];
  if (file && file.endsWith(".css")) {
    cssFiles.push(file.replace(/^\//, ""));
  }
}

if (jsFiles.length === 0 || cssFiles.length === 0) {
  console.error(`❌ Error de auditoría: se encontraron ${jsFiles.length} archivos JS y ${cssFiles.length} archivos CSS iniciales.`);
  process.exit(1);
}

// Grafo estático real: los `import "./x.js"` de cada chunk se descargan al arrancar
// aunque no estén en el HTML. Contar solo las etiquetas dejaba ~120 kB sin medir.
{
  const known = new Set(jsFiles);
  const stack = [...jsFiles];
  const importRegex = /(?:^|;|\n)\s*import\s*(?:[^"'`();]*?from\s*)?"\.\/([^"]+\.js)"/g;
  while (stack.length) {
    const current = stack.pop();
    const filePath = path.join(DIST_CLIENT_DIR, current);
    if (!fs.existsSync(filePath)) continue;
    const code = fs.readFileSync(filePath, "utf8");
    for (const match of code.matchAll(importRegex)) {
      const dep = path.posix.join(path.posix.dirname(current), match[1]);
      if (!known.has(dep)) {
        known.add(dep);
        jsFiles.push(dep);
        stack.push(dep);
      }
    }
  }
}

// 1. Los bancos léxicos pesados solo pueden cargarse por import() dinámico.
const lexiconBanksPreloaded = jsFiles.some(
  (f) => f.includes("calibration-bank") || f.includes("english-core-lexicon") || f.includes("lexicon-banks"),
);
if (lexiconBanksPreloaded) {
  console.error("❌ Regresión de rendimiento: un banco léxico está en el grafo estático de arranque.");
  process.exit(1);
}

// 2. Calcular tamaños de JS inicial
let jsRawBytes = 0;
let jsGzipBytes = 0;
for (const file of jsFiles) {
  const filePath = path.join(DIST_CLIENT_DIR, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath);
    jsRawBytes += content.length;
    jsGzipBytes += zlib.gzipSync(content).length;
  } else {
    console.warn(`[Aviso] Archivo JS referenciado no encontrado: ${filePath}`);
  }
}

// 3. Calcular tamaños de CSS inicial
let cssRawBytes = 0;
let cssGzipBytes = 0;
for (const file of cssFiles) {
  const filePath = path.join(DIST_CLIENT_DIR, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath);
    cssRawBytes += content.length;
    cssGzipBytes += zlib.gzipSync(content).length;
  } else {
    console.warn(`[Aviso] Archivo CSS referenciado no encontrado: ${filePath}`);
  }
}

const jsGzipKb = jsGzipBytes / 1024;
const cssGzipKb = cssGzipBytes / 1024;
const jsRawKb = jsRawBytes / 1024;
const cssRawKb = cssRawBytes / 1024;

console.log("\n=======================================================");
console.log(" 📦 Presupuesto de Arranque Inicial (Bundle Budget)");
console.log("=======================================================");
console.table([
  {
    Tipo: "JS Inicial",
    Archivos: jsFiles.length,
    "Raw (kB)": jsRawKb.toFixed(2),
    "Gzip (kB)": jsGzipKb.toFixed(2),
    "Límite Gzip (kB)": MAX_JS_GZIP_KB.toFixed(2),
    Estado: jsGzipKb <= MAX_JS_GZIP_KB ? "✅ APROBADO" : "❌ EXCEDIDO",
  },
  {
    Tipo: "CSS Inicial",
    Archivos: cssFiles.length,
    "Raw (kB)": cssRawKb.toFixed(2),
    "Gzip (kB)": cssGzipKb.toFixed(2),
    "Límite Gzip (kB)": MAX_CSS_GZIP_KB.toFixed(2),
    Estado: cssGzipKb <= MAX_CSS_GZIP_KB ? "✅ APROBADO" : "❌ EXCEDIDO",
  },
  {
    Tipo: "Chunk lexicon-banks diferido",
    Archivos: 1,
    "Raw (kB)": "N/A",
    "Gzip (kB)": "N/A",
    "Límite Gzip (kB)": "No en preload",
    Estado: !lexiconBanksPreloaded ? "✅ APROBADO" : "❌ PRECARGADO",
  },
]);

let failed = false;

const jsRatio = jsGzipKb / MAX_JS_GZIP_KB;
if (jsGzipKb > MAX_JS_GZIP_KB) {
  console.error(`❌ Falló el presupuesto de JS: ${jsGzipKb.toFixed(2)} kB > ${MAX_JS_GZIP_KB} kB`);
  failed = true;
} else if (jsRatio >= WARN_THRESHOLD_RATIO) {
  const pct = (jsRatio * 100).toFixed(1);
  const marginKb = (MAX_JS_GZIP_KB - jsGzipKb).toFixed(2);
  console.warn(`⚠️ AVISO: El peso inicial de JS está al ${pct}% del presupuesto (quedan ${marginKb} kB de margen).`);
}

const cssRatio = cssGzipKb / MAX_CSS_GZIP_KB;
if (cssGzipKb > MAX_CSS_GZIP_KB) {
  console.error(`❌ Falló el presupuesto de CSS: ${cssGzipKb.toFixed(2)} kB > ${MAX_CSS_GZIP_KB} kB`);
  failed = true;
} else if (cssRatio >= WARN_THRESHOLD_RATIO) {
  const pct = (cssRatio * 100).toFixed(1);
  const marginKb = (MAX_CSS_GZIP_KB - cssGzipKb).toFixed(2);
  console.warn(`⚠️ AVISO: El peso inicial de CSS está al ${pct}% del presupuesto (quedan ${marginKb} kB de margen).`);
}

if (failed) {
  process.exit(1);
}

console.log("🎉 Todos los presupuestos de tamaño de arranque pasaron exitosamente.\n");
