// Corre la suite y, si algo falla, deja el log COMPLETO en
// artifacts/test-failures/ y resume en la terminal qué archivo y qué prueba
// fallaron.
//
// Existe porque una vez el `gate` falló en una prueba y el nombre se perdió:
// la salida se filtró con un grep y con ella el diagnóstico. Un fallo sin
// nombre cuesta una tarde; un fallo con log cuesta un minuto.
//
// `pnpm test` sigue siendo la vía normal (salida directa, sin archivos). Esto
// es sólo para el cierre de fase (`pnpm gate`).

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Líneas que identifican un fallo en la salida de Vitest:
//   « ×  src/x.test.ts > suite > caso 12ms»
//   « FAIL  src/x.test.ts > suite > caso»
//   «Unhandled Error: …» / «Error: Worker exited unexpectedly»
const FAIL_LINE = /^\s*(?:[×✕✗]|FAIL)\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)(?:\s+>\s+(.*))?$/;
// Cabecera por archivo con fallos: « ❯ src/x.test.ts (29 tests | 1 failed)».
// Es la fuente más fiable del nombre del archivo aunque el bloque FAIL se
// corte; el reporter en modo lista no siempre repite la ruta.
const FILE_HEADER = /^\s*[❯✗]\s+(\S+\.(?:test|spec)\.[cm]?[jt]sx?)\s+\(\d+ tests?(?:\s*\|\s*(\d+) failed)?\)/;
const FATAL_LINE = /^(?:Unhandled (?:Error|Rejection)|Error: Worker|Serialized Error)/;

export function summarizeVitestLog(text) {
  const files = new Set();
  const tests = [];
  let counts = "";

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const header = line.match(FILE_HEADER);
    if (header) {
      files.add(header[1]);
      continue;
    }
    const fail = line.match(FAIL_LINE);
    if (fail) {
      files.add(fail[1]);
      const caso = (fail[2] ?? "").replace(/\s+\d+ms$/, "").trim();
      if (caso) tests.push(`${fail[1]} > ${caso}`);
      continue;
    }
    if (FATAL_LINE.test(line.trim())) tests.push(line.trim());
    const c = line.match(/^\s*Tests\s+(.+)$/);
    if (c && !counts) counts = c[1].trim();
  }

  return { files: [...files], tests, counts };
}

// Resumen legible para la terminal (sin ruido cuando todo va bien).
export function formatSummary(summary, logPath) {
  const lines = [];
  if (summary.counts) lines.push(`Tests: ${summary.counts}`);
  if (summary.files.length === 0) {
    lines.push("Sin archivos identificados en el log.");
  } else {
    lines.push(`Archivos con fallos (${summary.files.length}):`);
    for (const f of summary.files) lines.push(`  · ${f}`);
  }
  if (summary.tests.length) {
    lines.push("Pruebas fallidas:");
    for (const t of summary.tests.slice(0, 20)) lines.push(`  · ${t}`);
    if (summary.tests.length > 20) {
      lines.push(`  … y ${summary.tests.length - 20} más (en el log)`);
    }
  }
  if (logPath) lines.push(`Log completo: ${logPath}`);
  return lines.join("\n");
}

function stamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function main() {
  const child = spawn("npx", ["vitest", "run", ...process.argv.slice(2)], {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env,
    shell: process.platform === "win32",
      });

  let captured = "";
  const forward = (stream, write) => {
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      captured += text;
      write.write(text);
    });
  };
  forward(child.stdout, process.stdout);
  forward(child.stderr, process.stderr);

  child.on("close", (code) => {
    if (code === 0) process.exit(0);

    const summary = summarizeVitestLog(captured);
    const dir = join(process.cwd(), "artifacts", "test-failures");
    let logPath = null;
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${stamp()}.log`);
      writeFileSync(file, captured, "utf8");
      logPath = file;
    } catch {
      // Sin permiso de escritura el resumen sigue siendo útil: se imprime igual.
    }

    process.stderr.write(`\n=== FALLO DE PRUEBAS ===\n${formatSummary(summary, logPath)}\n`);
    process.exit(code ?? 1);
  });
}

// Sólo corre el runner si se invoca como script (importarlo en pruebas no
// lanza la suite).
if (process.argv[1] && process.argv[1].endsWith("test-trace.mjs")) main();
