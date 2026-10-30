#!/usr/bin/env node
// Empaqueta automáticamente el repositorio limpio (ZIP sin binarios/diccionarios pesados)
// y genera el Dossier de Auditoría + Plan + Prompt para Gemini 4 Argon y Gemini 3.8 Flash,
// pre-ejecutando lecturas numeradas (read) y búsquedas (grep) sobre los archivos citados.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const EXCLUDED_PATTERNS = [
  /^public\/lexicon\/.*\.gz$/i,
  /^public\/lexicon\/locuciones\..*\.json$/i,
  /\.epub$/i,
  /\.woff2?$/i,
  /\.ttf$/i,
  /\.otf$/i,
  /\.wav$/i,
  /\.mp3$/i,
  /\.ogg$/i,
  /\.png$/i,
  /\.jpe?g$/i,
  /\.webp$/i,
  /\.ico$/i,
  /\.onnx$/i,
  /^pnpm-lock\.yaml$/i,
  /^package-lock\.json$/i,
  /^docs\/auditoria\/reporte\.json$/i,
  /^docs\/auditoria\/cuaderno\/evidencia\.json$/i,
  /^scripts\/catalog-curation\.json$/i,
];

export function shouldExcludePath(relPath) {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return EXCLUDED_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Ordena las rutas para que las reglas, esquema SQL y código fuente de src/
 * aparezcan al principio y nunca queden truncados al final del archivo.
 */
export function sortRepoPathsForGemini(paths) {
  const priorityOf = (p) => {
    if (p === "AGENTS.md" || p === "package.json") return 0;
    if (p.startsWith(".devin/") || p.startsWith(".agents/rules/")) return 1;
    if (p === "db/schema.sql" || p.startsWith("db/migrations/")) return 2;
    if (p.startsWith("src/shared/") && !p.endsWith(".test.ts")) return 3;
    if (p.startsWith("src/worker/") && !p.endsWith(".test.ts")) return 4;
    if (p.startsWith("src/client/") && !p.includes(".test.")) return 5;
    if (p.startsWith("src/") && p.includes(".test.")) return 6;
    if (p.startsWith("e2e/")) return 7;
    if (p.startsWith("mcp/")) return 8;
    if (p.startsWith("scripts/")) return 9;
    return 10;
  };
  return [...paths].sort((a, b) => {
    const pa = priorityOf(a);
    const pb = priorityOf(b);
    if (pa !== pb) return pa - pb;
    return a.localeCompare(b);
  });
}

/**
 * Extrae referencias a archivos y rangos de líneas desde un texto de investigación.
 * Soporta formatos como:
 * - src/worker/kindle/routes.ts:1257-1258
 * - src/worker/kindle/routes.ts:736, 786, 1656
 * - db/migrations/019_positions_anchor_offset.sql
 */
export function parseInvestigationReferences(text) {
  if (!text || !text.trim()) return { files: new Map(), symbols: [] };

  const files = new Map();
  const addLines = (filePath, lineNums) => {
    const clean = filePath.replace(/^`+|`+$/g, "").replace(/^\.\//, "");
    if (!files.has(clean)) files.set(clean, new Set());
    const set = files.get(clean);
    for (const n of lineNums) {
      if (Number.isFinite(n) && n > 0) set.add(n);
    }
  };

  // Patrón 1: ruta explícita con posibles líneas tras ":" (ej. src/foo/bar.ts:120-130, 145)
  const pathRegex =
    /\b((?:src|db|e2e|scripts|mcp|public)\/[A-Za-z0-9_./-]+\.(?:tsx|ts|mjs|jsx|js|sql|css|json))(?::(\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*))?/g;
  let lastMatchedPath = null;
  for (const match of text.matchAll(pathRegex)) {
    const filePath = match[1];
    lastMatchedPath = filePath;
    const rawLines = match[2];
    const lineNums = [];
    if (rawLines) {
      for (const part of rawLines.split(",")) {
        const range = part.trim().split(/\s*-\s*/);
        const start = parseInt(range[0], 10);
        const end = range[1] ? parseInt(range[1], 10) : start;
        if (Number.isFinite(start)) lineNums.push(start);
        if (Number.isFinite(end) && end !== start) lineNums.push(end);
      }
    }
    addLines(filePath, lineNums);
  }

  // Patrón 2: referencias abreviadas como "routes.ts:1828" o "epub-reader.ts:999"
  const shortFileRegex = /\b([A-Za-z0-9_-]+\.(?:tsx|ts|sql)):(\d+(?:\s*-\s*\d+)?)/g;
  for (const match of text.matchAll(shortFileRegex)) {
    const shortName = match[1];
    const rawRange = match[2].split(/\s*-\s*/);
    const nums = rawRange.map((n) => parseInt(n, 10)).filter(Number.isFinite);
    let resolved = null;
    for (const knownPath of files.keys()) {
      if (knownPath.endsWith(`/${shortName}`) || knownPath === shortName) {
        resolved = knownPath;
        break;
      }
    }
    if (!resolved && lastMatchedPath && lastMatchedPath.endsWith(`/${shortName}`)) {
      resolved = lastMatchedPath;
    }
    if (resolved) addLines(resolved, nums);
  }

  // Extraer identificadores técnicos entre backticks (funciones, columnas SQL, rutas)
  const symbolSet = new Set();
  const backtickRegex = /`([A-Za-z_][A-Za-z0-9_]{2,45})`/g;
  const ignoreWords = new Set([
    "true",
    "false",
    "null",
    "undefined",
    "string",
    "number",
    "boolean",
    "const",
    "return",
    "async",
    "await",
    "SELECT",
    "INSERT",
    "UPDATE",
    "WHERE",
    "VALUES",
  ]);
  for (const match of text.matchAll(backtickRegex)) {
    const sym = match[1];
    if (!ignoreWords.has(sym)) symbolSet.add(sym);
  }

  return {
    files,
    symbols: [...symbolSet].slice(0, 25),
  };
}

/**
 * Formatea un fragmento de archivo con números de línea exactos (1-based).
 */
export function formatNumberedSnippet(content, startLine = 1, endLine = null) {
  const lines = content.split("\n");
  const from = Math.max(1, startLine);
  const to = endLine ? Math.min(lines.length, endLine) : lines.length;
  const out = [];
  for (let i = from; i <= to; i++) {
    out.push(`${String(i).padStart(4, " ")}| ${lines[i - 1]}`);
  }
  return out.join("\n");
}

/**
 * Encuentra el archivo de pruebas hermano de un módulo.
 * En este repo los tests de `.tsx` se nombran `.test.ts` (jsdom), no `.test.tsx`.
 */
export function findTestSibling(rootDir, relPath) {
  const candidates = [
    relPath.replace(/\.(ts|tsx|js|mjs)$/, ".test.$1"),
    relPath.replace(/\.tsx$/, ".test.ts"),
    relPath.replace(/\.mjs$/, ".test.mjs"),
  ];
  for (const c of candidates) {
    if (c !== relPath && existsSync(join(rootDir, c))) return c;
  }
  return null;
}

/**
 * Construye ventanas fusionadas (±contextLines) alrededor de las líneas objetivo.
 */
export function mergeLineWindows(lineNumbers, totalLines, contextLines = 40) {
  if (!lineNumbers || lineNumbers.length === 0) {
    return [{ start: 1, end: Math.min(totalLines, 250) }];
  }
  const sorted = [...lineNumbers].sort((a, b) => a - b);
  const windows = [];
  for (const line of sorted) {
    const start = Math.max(1, line - contextLines);
    const end = Math.min(totalLines, line + contextLines);
    const prev = windows[windows.length - 1];
    if (prev && start <= prev.end + 10) {
      prev.end = Math.max(prev.end, end);
    } else {
      windows.push({ start, end });
    }
  }
  return windows;
}

/**
 * Busca coincidencias de símbolos en los archivos del repositorio para simular grep.
 */
export function grepSymbolsInRepo(rootDir, repoFiles, symbols, maxMatchesPerSymbol = 20) {
  if (!symbols.length) return "";
  const sourceFiles = repoFiles.filter(
    (f) => (f.startsWith("src/") || f.startsWith("db/")) && /\.(ts|tsx|sql)$/.test(f),
  );
  const fileLinesCache = new Map();
  for (const f of sourceFiles) {
    const abs = join(rootDir, f);
    if (existsSync(abs)) {
      fileLinesCache.set(f, readFileSync(abs, "utf-8").split("\n"));
    }
  }

  const sections = [];
  for (const sym of symbols) {
    const matches = [];
    const escaped = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escaped}\\b`);
    for (const [f, lines] of fileLinesCache.entries()) {
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push(`${f}:${i + 1} | ${lines[i].trim().slice(0, 140)}`);
          if (matches.length >= maxMatchesPerSymbol) break;
        }
      }
      if (matches.length >= maxMatchesPerSymbol) break;
    }
    if (matches.length > 0) {
      sections.push(`#### Símbolo \`${sym}\` (${matches.length} coincidencias)\n\`\`\`text\n${matches.join("\n")}\n\`\`\``);
    }
  }
  return sections.join("\n\n");
}

export function buildArgonPrompt({ investigationText, preverifiedSection, repoTreeSummary }) {
  return `# DOSSIER DE AUDITORÍA DE ARQUITECTURA Y COMPILADOR DE PLANES
**Modelo Principal (Auditor y Arquitecto):** Google Gemini 4 Argon (\`gemini-4-argon\`)
**Modelo Ejecutor Destino:** Google Gemini 3.8 Flash

---

## 1. INSTRUCCIONES PARA GEMINI 4 ARGON (ROL: PRINCIPAL STAFF ENGINEER)

Actúa como **Principal Staff Engineer y Auditor de Sistemas** del proyecto **Lecta**.
Tu objetivo NO es dar por buena la investigación del usuario a ciegas, sino **auditarla rigurosamente contra el código real con líneas numeradas** que viene incluido en este documento, detectar cualquier trampa técnica en las soluciones propuestas, diseñar un **Plan de Trabajo cerrado** y escribir el **Prompt/Script de Ejecución Quirúrgica para Gemini 3.8 Flash**.

### Protocolo Obligatorio de 5 Verificaciones (Úsalo antes de escribir el plan):
1. **Verificación de Alcance y Variables (Scope Check):**
   Revisa las líneas numeradas exactas de cada archivo citado. ¿Las variables, parámetros, propiedades o columnas SQL que propone la solución (ej. \`totalPages\`, \`chapter\`, \`excluded.synced_at\`, \`exposure\`) existen realmente en esa línea y función? Si no existen en ese scope, diseña la solución correcta.
2. **Verificación de Contrato Cruzado entre Módulos:**
   Si un hallazgo modifica cómo se guarda o filtra un dato (ej. \`scroll_top\` vs \`ratio\`/\`anchor\`, \`isDue\` vs \`isLearnPending\`, \`synced_at\` en \`ON CONFLICT\`), revisa en la sección de \`grep\` todos los demás archivos que leen o escriben ese mismo dato para que el contrato quede 100% alineado en ambas puntas.
3. **Búsqueda de Instancias Olvidadas (Blast Radius):**
   Usa el barrido \`grep\` incluido abajo para detectar si el mismo bug ocurre en otras rutas, handlers o funciones hermanas que la investigación original no mencionó.
4. **Impacto en Pruebas Existentes (\`*.test.ts\`):**
   Revisa los archivos \`.test.ts\` incluidos. Si algún test unitario actual afirma el comportamiento antiguo (ej. esperar \`page=1\` desde \`scrollTop: 1\`), indícalo explícitamente para actualizar el test junto con el fix.
5. **Invariantes Inquebrantables de Lecta (\`AGENTS.md\`):**
   - Cursor incremental basado en \`synced_at\` (sello del servidor) y arbitraje LWW basado en \`updated_at\`.
   - No mutar ni renombrar campos internos de tarjetas FSRS (\`ts-fsrs\`).
   - En paginación y partición de HTML (\`splitLongParagraph\`), jamás partir a la mitad una etiqueta HTML inline (\`<span ...>\`, \`<a ...>\`, \`<em>\`).
   - En migraciones de CockroachDB: toda columna nueva referenciada en SQL del Worker exige aplicar la migración en la BD antes del deploy.
   - Mantener **0 warnings** en \`pnpm lint\`, tipado estricto en \`pnpm typecheck\` y presupuesto de bundle en \`pnpm check:size\`.

---

## 2. ESTRUCTURA OBLIGATORIA DE TU RESPUESTA

Divide tu respuesta exactamente en estos **3 Bloques**:

### BLOQUE A — Auditoría Crítica de la Investigación (Hallazgo por Hallazgo)
Para cada hallazgo (\`H1.1\`, \`H1.2\`, etc.):
- **Veredicto:** \`Confirmado\` | \`Confirmado PERO con trampa en la solución propuesta\` | \`Falso positivo / Ya resuelto\`.
- **Evidencia real en código:** Cita archivo y números de línea exactos verificados en este dossier.
- **Trampas cazadas:** Explica qué fallaría (ReferenceError, SQL incompleto, desalineación de estado con otro módulo, corrupción de tags HTML o rotura de tests) si se aplicara literalmente la solución sugerida en la investigación.
- **Instancias adicionales:** Otras líneas o funciones donde encontraste el mismo problema gracias al barrido \`grep\`.

### BLOQUE B — Plan de Trabajo por Fases Verificables
- Ordena los cambios en fases pequeñas, seguras e independientes (indicando prerrequisitos como migraciones SQL).
- Especifica qué archivos se tocan en cada fase y qué pruebas unitarias de regresión validan el cierre de la fase.

### BLOQUE C — Prompt / Script Quirúrgico listo para copiar a Gemini 3.8 Flash
Entrega un bloque de código \`\`\`markdown ... \`\`\` autocontenido y directo para pegarle a **Gemini 3.8 Flash**, que contenga:
1. **Reglas estrictas para Flash:** No inventar APIs, no eliminar comentarios existentes, mantener 0 warnings en \`pnpm lint\`.
2. **Cambios exactos archivo por archivo:**
   - Ruta del archivo y función.
   - Bloque **\`ANTES\`** (el código real actual tal como aparece en las líneas numeradas) y bloque **\`DESPUÉS\`** (el código corregido completo, con tipos y sin las trampas detectadas).
3. **Pruebas unitarias (\`*.test.ts\`):** Código exacto de los tests nuevos o actualizados.
4. **Comandos de validación:** \`pnpm typecheck && pnpm lint && pnpm test\`.

---

## 3. INVESTIGACIÓN ENVIADA PARA AUDITAR

${investigationText ? investigationText.trim() : "_(No se proporcionó un archivo de investigación específico; audita los módulos principales incluidos a continuación o pega tu investigación al final del prompt en el chat)._"}

---

## 4. PRE-VERIFICACIÓN AUTOMÁTICA (READ CON LÍNEAS NUMERADAS + GREP EN EL REPO)

${preverifiedSection || "_(Sin referencias específicas pre-extraídas)._"}

---

## 5. ÁRBOL DE ARCHIVOS DE CÓDIGO DEL REPOSITORIO (SIN BINARIOS NI DICCIONARIOS PESADOS)

\`\`\`text
${repoTreeSummary}
\`\`\`
`;
}

function getTrackedAndModifiedCodeFiles(rootDir) {
  const rawTracked = execFileSync("git", ["ls-files"], {
    cwd: rootDir,
    encoding: "utf-8",
  })
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const validFiles = [];
  for (const relPath of rawTracked) {
    if (shouldExcludePath(relPath)) continue;
    const abs = join(rootDir, relPath);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (!st.isFile()) continue;
    validFiles.push(relPath);
  }
  return sortRepoPathsForGemini(validFiles);
}

function buildPreverifiedSection(rootDir, repoFiles, investigationText) {
  if (!investigationText || !investigationText.trim()) return "";
  const { files, symbols } = parseInvestigationReferences(investigationText);
  const parts = [];

  if (files.size > 0) {
    parts.push("### 4.1 Fragmentos reales de archivos citados (con números de línea exactos)");
    for (const [relPath, lineSet] of files.entries()) {
      const abs = join(rootDir, relPath);
      if (!existsSync(abs)) {
        parts.push(`#### \`${relPath}\` — ⚠️ ARCHIVO NO ENCONTRADO EN EL REPOSITORIO`);
        continue;
      }
      const content = readFileSync(abs, "utf-8");
      const totalLines = content.split("\n").length;
      const windows = mergeLineWindows([...lineSet], totalLines, 45);
      for (const win of windows) {
        const numbered = formatNumberedSnippet(content, win.start, win.end);
        parts.push(
          `#### \`${relPath}\` (líneas ${win.start}–${win.end} de ${totalLines})\n\`\`\`typescript\n${numbered}\n\`\`\``,
        );
      }

      // Si existe un archivo de pruebas hermano, incluir también un extracto
      const testSibling = findTestSibling(rootDir, relPath);
      if (testSibling && !files.has(testSibling)) {
        const testContent = readFileSync(join(rootDir, testSibling), "utf-8");
        const testLines = testContent.split("\n").length;
        const previewEnd = Math.min(testLines, 120);
        parts.push(
          `#### Test hermano detectado: \`${testSibling}\` (primeras ${previewEnd} de ${testLines} líneas)\n\`\`\`typescript\n${formatNumberedSnippet(testContent, 1, previewEnd)}\n\`\`\``,
        );
      }
    }
  }

  const grepOutput = grepSymbolsInRepo(rootDir, repoFiles, symbols);
  if (grepOutput) {
    parts.push("### 4.2 Barrido `grep` automático de símbolos e invariantes en todo `src/` y `db/`");
    parts.push(grepOutput);
  }

  return parts.join("\n\n");
}

function createCleanZip(rootDir, orderedFiles, outZipPath) {
  const stagingDir = join(rootDir, "artifacts", ".gemini-zip-staging");
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  for (const relPath of orderedFiles) {
    const srcAbs = join(rootDir, relPath);
    const destAbs = join(stagingDir, relPath);
    mkdirSync(dirname(destAbs), { recursive: true });
    cpSync(srcAbs, destAbs);
  }

  rmSync(outZipPath, { force: true });
  execFileSync("zip", ["-q", "-r", outZipPath, "."], { cwd: stagingDir });
  rmSync(stagingDir, { recursive: true, force: true });
}

function resolveInvestigationInput(args, rootDir) {
  const fileArg = args.find((a) => a.startsWith("--file="))?.slice("--file=".length);
  const positional = args.find((a) => !a.startsWith("--"));
  const targetPath = fileArg || positional;

  if (targetPath) {
    const abs = resolve(rootDir, targetPath);
    if (existsSync(abs)) {
      return { source: targetPath, text: readFileSync(abs, "utf-8") };
    }
  }

  if (args.includes("--clipboard") || args.includes("--pbpaste")) {
    try {
      const clip = execFileSync("pbpaste", [], { encoding: "utf-8" });
      if (clip && clip.trim()) {
        return { source: "portapapeles (pbpaste)", text: clip };
      }
    } catch {
      // Ignorar si pbpaste no está disponible
    }
  }

  for (const candidate of ["investigacion.md", "artifacts/investigacion.md"]) {
    const abs = join(rootDir, candidate);
    if (existsSync(abs)) {
      return { source: candidate, text: readFileSync(abs, "utf-8") };
    }
  }

  return { source: null, text: "" };
}

function main() {
  const args = process.argv.slice(2);
  const outDir = join(ROOT, "artifacts");
  mkdirSync(outDir, { recursive: true });

  const orderedFiles = getTrackedAndModifiedCodeFiles(ROOT);
  const { source, text: investigationText } = resolveInvestigationInput(args, ROOT);

  // 1. Generar ZIP limpio sin binarios ni diccionarios pesados
  const zipPath = join(outDir, "lecta-gemini.zip");
  createCleanZip(ROOT, orderedFiles, zipPath);
  const zipSizeKb = (statSync(zipPath).size / 1024).toFixed(1);

  // 2. Generar sección pre-verificada (read + grep) si hay investigación
  const preverifiedSection = buildPreverifiedSection(ROOT, orderedFiles, investigationText);

  // 3. Construir el Dossier Markdown autocontenido.
  // Gemini NO descomprime ZIP ni gz: solo texto plano. Para no reventar su
  // ventana de contexto, incluimos COMPLETOS únicamente los archivos citados
  // por la investigación (+ sus tests hermanos) y el núcleo de reglas/esquema;
  // el resto del repo va como árbol. Con --full vuelca todo src/ (~4 MB).
  const { files: citedFilesMap } = parseInvestigationReferences(investigationText);
  const dossierSet = new Set();
  for (const f of orderedFiles) {
    if (
      f === "AGENTS.md" ||
      f === "package.json" ||
      f === "db/schema.sql" ||
      f.startsWith("db/migrations/") ||
      f.startsWith(".devin/rules/") ||
      f.startsWith(".agents/rules/")
    ) {
      dossierSet.add(f);
    }
  }
  for (const relPath of citedFilesMap.keys()) {
    if (!existsSync(join(ROOT, relPath))) continue;
    dossierSet.add(relPath);
    const testSibling = findTestSibling(ROOT, relPath);
    if (testSibling) {
      dossierSet.add(testSibling);
    }
  }
  if (args.includes("--full")) {
    for (const f of orderedFiles) {
      if (f.startsWith("src/") || f.startsWith("e2e/") || f.startsWith("mcp/")) {
        dossierSet.add(f);
      }
    }
  }
  const dossierFiles = sortRepoPathsForGemini([...dossierSet]);

  let bundledSourceSection = `\n\n---\n\n## 6. CÓDIGO FUENTE COMPLETO Y NUMERADO (archivos citados + tests + núcleo)\n\n`;
  for (const relPath of dossierFiles) {
    const content = readFileSync(join(ROOT, relPath), "utf-8");
    const ext = relPath.endsWith(".sql")
      ? "sql"
      : relPath.endsWith(".md")
        ? "markdown"
        : relPath.endsWith(".css")
          ? "css"
          : "typescript";
    const numbered = formatNumberedSnippet(content);
    bundledSourceSection += `### ARCHIVO: \`${relPath}\`\n\`\`\`${ext}\n${numbered}\n\`\`\`\n\n`;
  }

  const promptHeader = buildArgonPrompt({
    investigationText,
    preverifiedSection,
    repoTreeSummary: orderedFiles.join("\n"),
  });

  const fullDossier = promptHeader + bundledSourceSection;
  const dossierPath = join(outDir, "lecta-gemini-dossier.md");
  const promptOnlyPath = join(outDir, "lecta-gemini-prompt.md");

  writeFileSync(dossierPath, fullDossier, "utf-8");
  writeFileSync(promptOnlyPath, promptHeader, "utf-8");

  const dossierSizeKb = (statSync(dossierPath).size / 1024).toFixed(1);
  const promptSizeKb = (statSync(promptOnlyPath).size / 1024).toFixed(1);

  console.log("===================================================================");
  console.log("  🚀 PAQUETE GEMINI 4 ARGON + FLASH GENERADO AUTOMÁTICAMENTE");
  console.log("===================================================================");
  console.log(`Archivos limpios incluidos: ${orderedFiles.length} (0 binarios .gz / .epub / .woff2)`);
  console.log(
    `Investigación detectada:    ${source ? `${source} (${investigationText.length.toLocaleString()} chars)` : "Ninguna (usa pnpm gemini <archivo.md> o --clipboard)"}`,
  );
  console.log("-------------------------------------------------------------------");
  console.log(`📦 1. ZIP limpio del repo:    artifacts/lecta-gemini.zip (${zipSizeKb} KB)`);
  console.log(`📄 2. Prompt + Pre-auditoría: artifacts/lecta-gemini-prompt.md (${promptSizeKb} KB)`);
  console.log(`📘 3. Dossier Todo-en-Uno:    artifacts/lecta-gemini-dossier.md (${dossierSizeKb} KB)`);
  console.log("===================================================================");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
