#!/usr/bin/env node
// Auditoría verificable de la investigación sobre la estrategia de aprendizaje
// de Lecta (docs/estrategia-aprendizaje-2026-10-24.md).
//
// Cada afirmación del documento está registrada en docs/auditoria/claims.json
// como una afirmación falsable con tres tipos de comprobación:
//
//   1. anclaje de código: el archivo y la línea citados contienen el patrón
//      esperado (o el patrón NO existe, para las ausencias que el documento
//      afirma);
//   2. sonda ejecutable: se importa el módulo real y se observan valores;
//   3. referencia: el DOI/URL existe y sus metadatos coinciden con lo citado
//      (en línea; sin red queda sin verificar, no aprobado).
//
//   node scripts/audit-investigacion.mjs                 # sin red (CI)
//   node scripts/audit-investigacion.mjs --online         # resuelve DOI/URL
//   node scripts/audit-investigacion.mjs --pack /tmp/x    # exporta un paquete
//   node scripts/audit-investigacion.mjs --claim H3-theta-escala
//
// Sale con código 1 si alguna comprobación falla. Sin red, las referencias
// quedan UNVERIFIED y el veredicto global es PASS_WITH_UNVERIFIED.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";

export const TOOL = "audit-investigacion";
export const VERSION = 1;
export const DEFAULT_CLAIMS = "docs/auditoria/claims.json";
export const DEFAULT_DOC = "docs/estrategia-aprendizaje-2026-10-24.md";
export const DEFAULT_OUT = "docs/auditoria";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".wrangler",
  "coverage",
  "artifacts",
  "test-results",
  ".cache",
]);
const CODE_EXT = new Set([".ts", ".tsx", ".mjs", ".js", ".cjs", ".css", ".json"]);
const REF_LEVELS = new Set([
  "meta-análisis",
  "replicado",
  "estudio primario",
  "experimental",
  "correlacional",
  "corpus",
  "benchmark de logs",
  "preprint",
  "industria",
  "revisión",
  "modelo computacional",
]);

// ---------- utilidades de lectura ----------

const cache = new Map();

export function readText(root, rel) {
  const key = path.isAbsolute(rel) ? rel : path.join(root, rel);
  if (cache.has(key)) return cache.get(key);
  const text = fs.readFileSync(key, "utf8");
  cache.set(key, text);
  return text;
}

export function readLines(root, rel) {
  return readText(root, rel).split("\n");
}

export const normalizeWs = (value) => value.replace(/\s+/g, " ").trim();

export function sha256(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

// SHA del commit auditado: HEAD apunta a una rama; se resuelve en
// .git/refs o en packed-refs. Sin repositorio devuelve null.
export function resolveCommit(root) {
  try {
    const head = fs.readFileSync(path.join(root, ".git/HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    const loose = path.join(root, ".git", ref);
    if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim();
    const packed = fs.readFileSync(path.join(root, ".git/packed-refs"), "utf8");
    const line = packed.split("\n").find((entry) => entry.endsWith(` ${ref}`));
    return line ? line.split(" ")[0] : head;
  } catch {
    return null;
  }
}

function walk(root, dirs, visit) {
  for (const dir of dirs) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    const stack = [abs];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          stack.push(full);
          continue;
        }
        if (!CODE_EXT.has(path.extname(entry.name))) continue;
        visit(full);
      }
    }
  }
}

const relOf = (root, abs) => path.relative(root, abs).split(path.sep).join("/");

// ---------- comprobaciones de código ----------

export function checkAnchor(root, check) {
  const lines = readLines(root, check.file);
  const center = check.line;
  const window = check.window ?? 3;
  const regex = new RegExp(check.expect);
  const from = Math.max(1, center - window);
  const to = Math.min(lines.length, center + window);
  const hits = [];
  for (let n = from; n <= to; n += 1) {
    if (regex.test(lines[n - 1])) {
      hits.push({ line: n, text: lines[n - 1].trim().slice(0, 160) });
    }
  }
  if (hits.length) {
    const exact = hits.find((hit) => hit.line === center) ?? hits[0];
    return {
      kind: "code-anchor",
      status: "PASS",
      detail: `${check.file}:${exact.line} coincide con /${check.expect}/`,
      observed: { file: check.file, line: exact.line, text: exact.text },
    };
  }
  return {
    kind: "code-anchor",
    status: "FAIL",
    detail: `${check.file}:${from}-${to} no contiene /${check.expect}/`,
    observed: {
      file: check.file,
      asked: center,
      excerpt: lines.slice(from - 1, to).map((text, index) => `${from + index}: ${text}`),
    },
  };
}

export function checkAbsent(root, check) {
  const dirs = check.scope ?? (check.file ? [null] : ["src"]);
  const regex = new RegExp(check.pattern);
  const matches = [];
  const inspect = (abs) => {
    const text = fs.readFileSync(abs, "utf8");
    if (!regex.test(text)) return;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (regex.test(lines[i])) {
        matches.push({ file: relOf(root, abs), line: i + 1, text: lines[i].trim().slice(0, 140) });
        if (matches.length >= 5) return;
      }
    }
  };
  if (check.file) {
    inspect(path.join(root, check.file));
  } else {
    walk(root, dirs, inspect);
  }
  if (matches.length === 0) {
    return {
      kind: "code-absent",
      status: "PASS",
      detail: `/${check.pattern}/ no aparece en ${check.file ?? dirs.join(",")}`,
      observed: {},
    };
  }
  return {
    kind: "code-absent",
    status: "FAIL",
    detail: `/${check.pattern}/ aparece ${matches.length} vez/veces donde el documento dice que no`,
    observed: { matches },
  };
}

export function checkNoImporters(root, check) {
  const dirs = check.scope ?? ["src"];
  const symbol = check.symbol;
  const regex = new RegExp(`\\b${symbol}\\b`);
  const exclude = new Set(check.exclude ?? []);
  const hits = [];
  const visit = (abs) => {
    const rel = relOf(root, abs);
    if (exclude.has(rel)) return;
    if (/\.test\.[cm]?[jt]sx?$/.test(rel)) return;
    if (rel.endsWith(".d.ts")) return;
    const text = fs.readFileSync(abs, "utf8");
    if (!regex.test(text)) return;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      if (regex.test(lines[i]) && /from\s+["']|require\(/.test(lines[i])) {
        hits.push({ file: rel, line: i + 1, text: lines[i].trim().slice(0, 140) });
      }
    }
  };
  walk(root, dirs, visit);
  const callers = hits.filter((hit) => !(check.exclude ?? []).some((file) => hit.file === file));
  if (callers.length === 0) {
    return {
      kind: "no-importers",
      status: "PASS",
      detail: `${symbol} no tiene importadores fuera de su archivo ni de las pruebas`,
      observed: { symbol, callers: [] },
    };
  }
  return {
    kind: "no-importers",
    status: "FAIL",
    detail: `${symbol} tiene ${callers.length} importador(es) en producción`,
    observed: { symbol, callers },
  };
}

// Alcanzabilidad: ¿algún archivo de producción, fuera del que define el
// símbolo, lo USA? No cuentan pruebas, .d.ts, comentarios ni líneas de
// import/export...from (una reexportación no es un uso). Se conservan
// los saltos de línea para que el número de línea reportado sea real.
const keepNewlines = (match) => match.replace(/[^\n]/g, "");
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:"'`])\/\/.*$/gm;
const IMPORT_EXPORT_FROM =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s*["'][^"']+["'];?/g;

export function stripNonUsage(text) {
  return text
    .replace(BLOCK_COMMENT, keepNewlines)
    .replace(LINE_COMMENT, "$1")
    .replace(IMPORT_EXPORT_FROM, keepNewlines);
}

export function checkReachable(root, check) {
  const dirs = check.scope ?? ["src"];
  const symbol = check.symbol;
  const regex = new RegExp(`\\b${symbol}\\b`);
  const exclude = new Set([check.definedIn, ...(check.exclude ?? [])]);
  const users = [];
  walk(root, dirs, (abs) => {
    const rel = relOf(root, abs);
    if (exclude.has(rel)) return;
    if (/\.test\.[cm]?[jt]sx?$/.test(rel) || rel.endsWith(".d.ts")) return;
    const text = fs.readFileSync(abs, "utf8");
    if (!regex.test(text)) return;
    const lines = stripNonUsage(text).split("\n");
    const index = lines.findIndex((line) => regex.test(line));
    if (index < 0) return;
    users.push({ file: rel, line: index + 1, text: lines[index].trim().slice(0, 140) });
  });
  if (users.length) {
    return {
      kind: "reachable",
      status: "PASS",
      detail: `${symbol} se usa en producción (${users.length} archivo/s)`,
      observed: { symbol, callers: users.slice(0, 5) },
    };
  }
  return {
    kind: "reachable",
    status: "FAIL",
    detail: `${symbol} no tiene usos en producción fuera de ${check.definedIn} (solo pruebas, comentarios o reexportaciones)`,
    observed: { symbol, callers: [] },
  };
}

export function checkDocMention(root, quote, docRel = DEFAULT_DOC) {
  const haystack = normalizeWs(readText(root, docRel));
  const needle = normalizeWs(quote);
  const found = haystack.includes(needle);
  return {
    kind: "doc-mention",
    status: found ? "PASS" : "FAIL",
    detail: found
      ? `el documento contiene «${needle.slice(0, 90)}»`
      : `el documento NO contiene «${needle.slice(0, 90)}»`,
    observed: {},
  };
}

// ---------- referencias ----------

function doiShapeOk(doi) {
  return typeof doi === "string" && /^10\.\d{4,9}\/[-._;()/:a-z0-9]+$/i.test(doi);
}

function urlAllowed(url) {
  try {
    const { hostname } = new URL(url);
    return [
      "doi.org",
      "eric.ed.gov",
      "osf.io",
      "pubmed.ncbi.nlm.nih.gov",
      "nber.org",
      "behaviormodel.org",
      "bjorklab.psych.ucla.edu",
      "pirls2021.org",
      "blog.duolingo.com",
      "github.com",
    ].some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function titleMatches(message, ref) {
  const expected = ref.titleIncludes ?? [];
  if (!expected.length) return { ok: true, checked: false };
  const raw = Array.isArray(message.title) ? message.title[0] : message.title;
  const title = normalizeWs(String(raw ?? "")).toLowerCase();
  const missing = expected.filter((needle) => !title.includes(needle.toLowerCase()));
  return { ok: missing.length === 0, checked: true, title, missing };
}

function yearOk(message, ref) {
  const years = ref.yearAnyOf ?? null;
  if (!years) return { ok: true, checked: false };
  const parts =
    message.issued?.["date-parts"]?.[0] ??
    message["published-print"]?.["date-parts"]?.[0] ??
    [];
  const year = parts[0];
  return { ok: years.includes(year), checked: true, year };
}

export async function checkReference(ref, { online = false, fetchImpl = fetch } = {}) {
  const base = { kind: "reference", id: ref.id, cite: ref.cite };
  const problems = [];
  if (!ref.cite) problems.push("falta cita textual");
  if (!REF_LEVELS.has(ref.level)) problems.push(`nivel de evidencia desconocido: ${ref.level}`);
  const hasDoi = Boolean(ref.doi);
  const hasUrl = Boolean(ref.url);
  if (!hasDoi && !hasUrl) {
    return {
      ...base,
      status: ref.textOnly ? "NOT_CHECKABLE" : "UNVERIFIED",
      detail: ref.textOnly
        ? "cita sin identificador (texto completo no enlazado): revisar a mano"
        : "sin DOI ni URL",
      observed: {},
    };
  }
  if (hasDoi && !doiShapeOk(ref.doi)) problems.push(`DOI con forma inválida: ${ref.doi}`);
  if (hasUrl && !urlAllowed(ref.url)) problems.push(`host no permitido en la auditoría: ${ref.url}`);
  if (problems.length) {
    return { ...base, status: "FAIL", detail: problems.join("; "), observed: {} };
  }
  if (!online) {
    return {
      ...base,
      status: "UNVERIFIED",
      detail: "forma válida; sin red no se resuelven metadatos (usar --online)",
      observed: { doi: ref.doi ?? null, url: ref.url ?? null },
    };
  }
  try {
    if (hasDoi) {
      const response = await fetchImpl(`https://api.crossref.org/works/${encodeURIComponent(ref.doi)}`, {
        headers: { "user-agent": "lecta-audit/1.0 (mailto:audit@lecta.local)" },
      });
      if (response.status === 404) {
        return { ...base, status: "FAIL", detail: `Crossref 404 para ${ref.doi}`, observed: {} };
      }
      if (!response.ok) {
        return {
          ...base,
          status: "UNVERIFIED",
          detail: `Crossref respondió ${response.status}; no se puede concluir`,
          observed: {},
        };
      }
      const body = await response.json();
      const message = body.message;
      const title = titleMatches(message, ref);
      const year = yearOk(message, ref);
      const problemsOnline = [];
      if (!title.ok) problemsOnline.push(`título no coincide; faltan: ${title.missing.join(", ")}`);
      if (!year.ok) problemsOnline.push(`año ${year.year} fuera de ${ref.yearAnyOf.join("/")}`);
      return {
        ...base,
        status: problemsOnline.length ? "FAIL" : "PASS",
        detail: problemsOnline.length
          ? problemsOnline.join("; ")
          : `Crossref: ${year.year} · ${title.title?.slice(0, 90) ?? "(sin título)"}`,
        observed: { doi: ref.doi, year: year.year ?? null, title: title.title ?? null },
      };
    }
    const response = await fetchImpl(ref.url, { redirect: "follow" });
    if (response.status === 404) {
      return { ...base, status: "FAIL", detail: `404 en ${ref.url}`, observed: {} };
    }
    return {
      ...base,
      status: response.ok ? "PASS" : "UNVERIFIED",
      detail: `${ref.url} → HTTP ${response.status}`,
      observed: { url: ref.url, http: response.status },
    };
  } catch (error) {
    return {
      ...base,
      status: "UNVERIFIED",
      detail: `red no disponible (${error instanceof Error ? error.message : String(error)})`,
      observed: {},
    };
  }
}

// ---------- sondas ejecutables ----------

async function importTs(root, rel) {
  return import(pathToFileURL(path.join(root, rel)).href);
}

const PROBES = {
  async "theta-escalas"(root) {
    const pm = await importTs(root, "src/client/lib/profile-models.ts");
    const profileSrc = readText(root, "src/client/lib/profile-models.ts");
    const calibrationSrc = readText(root, "src/client/lib/calibration.ts");
    const readerSrc = readText(root, "src/client/components/Reader.tsx");
    const wordPanelSrc = readText(root, "src/client/components/WordPanel.tsx");
    const sectionWordsSrc = readText(root, "src/client/lib/section-words.ts");
    const legacyExports = [
      "wordDifficulty",
      "thetaFromThreshold",
      "defaultTheta",
      "adjustThetaOnKnown",
      "adjustThetaOnEasyPin",
      "probUnknown",
      "loadThetaByLang",
      "saveThetaForLang",
    ].filter((name) => typeof pm[name] === "function");
    const observed = {
      betaFromZipf_zipf6: pm.betaFromZipf(6),
      theta_L1_porDefecto: pm.getThetaForLanguage({}, "es", "es"),
      theta_L2_porDefecto: pm.getThetaForLanguage({}, "en", "es"),
      theta_L2_esperado: pm.DEFAULT_THETA_L2,
      exporta_escala_vieja: legacyExports,
      escribe_llave_vieja: /setItem\(\s*USER_THETA_KEY/.test(profileSrc),
      migracion_resta: Number(profileSrc.match(/clampTheta\(legacy - (\d+)\)/)?.[1]),
      saveUserTheta_en_calibracion: (calibrationSrc.match(/saveUserTheta\(/g) ?? []).length,
      updateLanguageTheta_en_reader: (readerSrc.match(/updateLanguageTheta\(/g) ?? []).length,
      applyPreviewKnownSignal_en_wordPanel: (wordPanelSrc.match(/applyPreviewKnownSignal\(/g) ?? []).length,
      ajustes_por_acto_en_wordPanel:
        (wordPanelSrc.match(/applyPreviewKnownSignal\(/g) ?? []).length,
      sectionWords_usa_7_menos_zipf: /7\.0\s*-\s*(?:opts\.)?zipf/.test(sectionWordsSrc),
      sectionWords_usa_4_menos_zipf: /4\.0\s*-\s*opts\.zipf/.test(sectionWordsSrc),
    };
    const ok =
      observed.betaFromZipf_zipf6 === -2 &&
      observed.theta_L1_porDefecto === 0 &&
      observed.theta_L2_porDefecto === observed.theta_L2_esperado &&
      observed.exporta_escala_vieja.length === 0 &&
      observed.escribe_llave_vieja === false &&
      observed.migracion_resta === 3 &&
      observed.saveUserTheta_en_calibracion === 0 &&
      observed.updateLanguageTheta_en_reader === 2 &&
      observed.applyPreviewKnownSignal_en_wordPanel === 1 &&
      observed.sectionWords_usa_7_menos_zipf === false &&
      observed.sectionWords_usa_4_menos_zipf === true;
    return {
      kind: "probe",
      probe: "theta-escalas",
      status: ok ? "PASS" : "FAIL",
      detail: ok
        ? "una sola escala (β = 4 − zipf, neutra en 0), una sola llave y un solo ajuste por acto; la llave vieja solo se migra restando 3"
        : "el código todavía mezcla escalas o ajusta θ más de una vez por acto",
      observed,
    };
  },

  async "xp-proxies"(root) {
    const g = await importTs(root, "src/shared/gamification.ts");
    const now = Date.UTC(2026, 9, 24, 12, 0, 0);
    let n = 0;
    const idFor = () => `audit-${(n += 1)}`;
    const fresh = () => g.emptyGameState();
    const consulted = g.applyGameEvent(fresh(), { kind: "consulted" }, now, idFor);
    const saved = g.applyGameEvent(fresh(), { kind: "saved", zipf: 2.9 }, now, idFor);
    const savedCommon = g.applyGameEvent(fresh(), { kind: "saved", zipf: 5.5 }, now, idFor);
    const reviewed = g.applyGameEvent(fresh(), { kind: "review", rating: "good" }, now, idFor);
    const chapter = g.applyGameEvent(fresh(), { kind: "book_finished", bookHash: "x" }, now, idFor);
    const observed = {
      RARE_ZIPF_BELOW: g.RARE_ZIPF_BELOW,
      STREAK_XP_BONUS: g.STREAK_XP_BONUS,
      xp_consulta: consulted.gained,
      xp_guardada_rara: saved.gained,
      rareSaved_tras_rara: saved.state.stats.rareSaved,
      xp_guardada_comun: savedCommon.gained,
      xp_repaso_good: reviewed.gained,
      xp_libro_terminado: chapter.gained,
      logros_de_rarezas: g.ACHIEVEMENTS.filter((a) => a.family === "raras").map((a) => a.id),
    };
    const ok =
      observed.xp_consulta === 2 &&
      observed.xp_guardada_rara === 7 &&
      observed.xp_guardada_comun === 3 &&
      observed.xp_libro_terminado === 50 &&
      observed.logros_de_rarezas.length > 0;
    return {
      kind: "probe",
      probe: "xp-proxies",
      status: ok ? "PASS" : "FAIL",
      detail: ok
        ? "consultar y guardar pagan XP; guardar una palabra rara paga el doble que una común; terminar un libro paga 50"
        : "el reparto de XP no coincide con lo que describe el documento",
      observed,
    };
  },

};

// ---------- motor ----------

export async function runAudit(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const claimsPath = options.claimsPath ?? DEFAULT_CLAIMS;
  const docRel = options.docRel ?? DEFAULT_DOC;
  const online = Boolean(options.online);
  const only = options.only ? new Set(Array.isArray(options.only) ? options.only : [options.only]) : null;
  const fetchImpl = options.fetchImpl ?? fetch;

  const registry = JSON.parse(readText(root, claimsPath));
  const references = registry.references ?? {};
  const claims = (registry.claims ?? []).filter((claim) => !only || only.has(claim.id));
  const report = {
    tool: TOOL,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    root,
    commit: resolveCommit(root),
    doc: docRel,
    registry: claimsPath,
    online,
    summary: { claims: claims.length, pass: 0, fail: 0, unverified: 0, skipped: 0, refutedExpected: 0 },
    results: [],
    references: [],
  };

  const refResults = new Map();
  for (const claim of claims) {
    const checks = [];
    if (claim.docQuote) checks.push(checkDocMention(root, claim.docQuote, docRel));
    for (const check of claim.checks ?? []) {
      if (check.type === "code-anchor") checks.push(checkAnchor(root, check));
      else if (check.type === "code-absent") checks.push(checkAbsent(root, check));
      else if (check.type === "no-importers") checks.push(checkNoImporters(root, check));
      else if (check.type === "reachable") checks.push(checkReachable(root, check));
      else if (check.type === "probe") {
        const probe = PROBES[check.probe];
        if (!probe) {
          checks.push({
            kind: "probe",
            probe: check.probe,
            status: "SKIP",
            detail: `sonda desconocida: ${check.probe}`,
            observed: {},
          });
        } else {
          try {
            checks.push(await probe(root));
          } catch (error) {
            checks.push({
              kind: "probe",
              probe: check.probe,
              status: "SKIP",
              detail: `la sonda no pudo ejecutarse en Node: ${error instanceof Error ? error.message : String(error)}`,
              observed: {},
            });
          }
        }
      } else {
        checks.push({ kind: check.type ?? "?", status: "SKIP", detail: "tipo de comprobación desconocido" });
      }
    }
    for (const refId of claim.citations ?? []) {
      const ref = references[refId];
      if (!ref) {
        checks.push({ kind: "reference", id: refId, status: "FAIL", detail: `referencia inexistente: ${refId}` });
        continue;
      }
      if (!refResults.has(refId)) {
        refResults.set(refId, await checkReference({ id: refId, ...ref }, { online, fetchImpl }));
      }
      checks.push(refResults.get(refId));
    }
    const codeChecks = checks.filter((check) => check.kind !== "reference");
    const refChecks = checks.filter((check) => check.kind === "reference");
    const codeStatus = codeChecks.some((check) => check.status === "FAIL")
      ? "FAIL"
      : codeChecks.some((check) => check.status === "UNVERIFIED" || check.status === "SKIP")
        ? "UNVERIFIED"
        : codeChecks.length
          ? "PASS"
          : "SKIP";
    const refStatus = refChecks.some((check) => check.status === "FAIL")
      ? "FAIL"
      : refChecks.some((check) => check.status === "UNVERIFIED" || check.status === "NOT_CHECKABLE")
        ? "UNVERIFIED"
        : refChecks.length
          ? "PASS"
          : "SKIP";
    const status =
      codeStatus === "FAIL" || refStatus === "FAIL"
        ? "FAIL"
        : codeStatus === "UNVERIFIED" || refStatus === "UNVERIFIED"
          ? "UNVERIFIED"
          : "PASS";
    const auditVerdict = claim.auditVerdict ?? null;
    let finalStatus = status;
    if (auditVerdict?.status === "REFUTADA") {
      // Refutada por auditoría: se espera que sus comprobaciones fallen.
      // Si dejan de fallar, el veredicto quedó viejo y hay que revisarlo.
      finalStatus = status === "FAIL" ? "REFUTED_EXPECTED" : "VERDICT_STALE";
    }
    report.results.push({
      id: claim.id,
      title: claim.title,
      statement: claim.statement,
      section: claim.section ?? null,
      status: finalStatus,
      auditVerdict,
      codeStatus,
      refStatus,
      checks,
    });
  }
  report.references = [...refResults.values()];
  report.summary.pass = report.results.filter((r) => r.status === "PASS").length;
  report.summary.fail = report.results.filter(
    (r) => r.status === "FAIL" || r.status === "VERDICT_STALE",
  ).length;
  report.summary.refutedExpected = report.results.filter((r) => r.status === "REFUTED_EXPECTED").length;
  report.summary.unverified = report.results.filter((r) => r.status === "UNVERIFIED").length;
  report.summary.skipped = report.results.flatMap((r) => r.checks).filter((c) => c.status === "SKIP").length;
  report.summary.codePass = report.results.filter((r) => r.codeStatus === "PASS").length;
  report.summary.codeFail = report.results.filter((r) => r.codeStatus === "FAIL").length;
  report.summary.referencePass = report.references.filter((r) => r.status === "PASS").length;
  report.summary.referenceUnverified = report.references.filter((r) => r.status === "UNVERIFIED").length;
  report.summary.referenceFail = report.references.filter((r) => r.status === "FAIL").length;
  report.summary.referenceNotCheckable = report.references.filter(
    (r) => r.status === "NOT_CHECKABLE",
  ).length;
  report.verdict = report.summary.fail
    ? "FAIL"
    : report.summary.unverified
      ? "PASS_WITH_UNVERIFIED"
      : "PASS";
  return report;
}

// ---------- salida ----------

const ICON = {
  PASS: "✅",
  FAIL: "❌",
  UNVERIFIED: "⚠️",
  SKIP: "⏭️",
  NOT_CHECKABLE: "📄",
  REFUTED_EXPECTED: "🚫",
  VERDICT_STALE: "❗",
};

export function renderMarkdown(report) {
  const lines = [];
  lines.push("# Reporte de auditoría — estrategia de aprendizaje de Lecta");
  lines.push("");
  lines.push(`Generado: ${report.generatedAt}`);
  lines.push(`Documento auditado: \`${report.doc}\``);
  lines.push(`Registro: \`${report.registry}\``);
  lines.push(`Commit: \`${report.commit ?? "desconocido"}\``);
  lines.push(`Red: ${report.online ? "sí (DOI/URL resueltos)" : "no (solo forma de las referencias)"}`);
  lines.push("");
  lines.push(
    `**Veredicto: ${report.verdict}** — ${report.summary.pass} afirmaciones aprobadas, ` +
      `${report.summary.fail} refutadas, ${report.summary.refutedExpected ?? 0} refutadas por auditoría, ` +
      `${report.summary.unverified} sin verificar, ` +
      `${report.summary.skipped} comprobaciones omitidas.`,
  );
  lines.push("");
  lines.push("## Afirmaciones");
  lines.push("");
  for (const result of report.results) {
    lines.push(`### ${ICON[result.status] ?? ""} ${result.id} — ${result.title}`);
    lines.push("");
    lines.push(`> ${result.statement}`);
    lines.push("");
    lines.push(`Código: **${result.codeStatus ?? "—"}** · Referencias: **${result.refStatus ?? "—"}**`);
    lines.push("");
    if (result.auditVerdict) {
      lines.push(
        `**Veredicto de auditoría (${result.auditVerdict.date}): ${result.auditVerdict.status}** — ${result.auditVerdict.motivo}`,
      );
      for (const evidence of result.auditVerdict.evidencia ?? []) {
        lines.push(`- evidencia: \`${evidence}\``);
      }
      lines.push("");
    }
    for (const check of result.checks) {
      const icon = ICON[check.status] ?? "";
      const label = check.kind === "reference" ? `referencia ${check.id}` : check.kind;
      lines.push(`- ${icon} **${check.status}** · ${label}: ${check.detail}`);
      if (check.observed && Object.keys(check.observed).length) {
        const compact = JSON.stringify(check.observed);
        lines.push(`  - observado: \`${compact.length > 480 ? `${compact.slice(0, 480)}…` : compact}\``);
      }
    }
    lines.push("");
  }
  lines.push("## Referencias");
  lines.push("");
  lines.push("| id | estado | cita | detalle |");
  lines.push("|---|---|---|---|");
  for (const ref of report.references) {
    lines.push(
      `| ${ref.id} | ${ICON[ref.status] ?? ""} ${ref.status} | ${ref.cite ?? ""} | ${String(ref.detail ?? "").replace(/\|/g, "\\|")} |`,
    );
  }
  lines.push("");
  lines.push("## Cómo reproducir");
  lines.push("");
  lines.push("```bash");
  lines.push("node scripts/audit-investigacion.mjs            # sin red");
  lines.push("node scripts/audit-investigacion.mjs --online    # resuelve DOI y URLs");
  lines.push("node scripts/audit-investigacion.mjs --pack /tmp/pack");
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

export function writePack(report, root, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const excerptsDir = path.join(outDir, "excerpts");
  fs.mkdirSync(excerptsDir, { recursive: true });
  const files = new Map();
  const collect = (file) => {
    if (!file || files.has(file)) return;
    try {
      files.set(file, readText(root, file));
    } catch {
      files.set(file, null);
    }
  };
  for (const result of report.results) {
    for (const check of result.checks) {
      if (check.observed?.file) collect(check.observed.file);
      for (const match of check.observed?.matches ?? []) collect(match.file);
      for (const caller of check.observed?.callers ?? []) collect(caller.file);
    }
  }
  const manifest = {
    tool: TOOL,
    version: VERSION,
    generatedAt: report.generatedAt,
    doc: report.doc,
    verdict: report.verdict,
    files: [],
  };
  for (const [file, content] of files) {
    if (content == null) continue;
    const lines = content.split("\n");
    const excerptName = file.replace(/[^a-z0-9._-]+/gi, "_");
    const excerpt = lines
      .map((text, index) => `${String(index + 1).padStart(5, " ")} | ${text}`)
      .join("\n");
    fs.writeFileSync(path.join(excerptsDir, excerptName), `${excerpt}\n`, "utf8");
    manifest.files.push({ file, bytes: content.length, sha256: sha256(content), excerpt: excerptName });
  }
  manifest.claims = report.results.map((r) => ({
    id: r.id,
    status: r.status,
    auditVerdict: r.auditVerdict?.status ?? null,
  }));
  // El paquete viaja con lo que el auditor necesita leer: documento, encargo y registro.
  const extras = [
    { rel: report.doc, as: path.basename(report.doc) },
    { rel: "docs/auditoria/PROMPT-AUDITOR.md", as: "PROMPT-AUDITOR.md" },
    { rel: "docs/auditoria/README.md", as: "README.md" },
  ];
  manifest.documentos = [];
  for (const extra of extras) {
    const abs = path.join(root, extra.rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, "utf8");
    fs.copyFileSync(abs, path.join(outDir, extra.as));
    manifest.documentos.push({ file: extra.rel, copia: extra.as, sha256: sha256(content) });
  }
  fs.writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.copyFileSync(path.join(root, report.registry), path.join(outDir, "claims.json"));
  fs.writeFileSync(path.join(outDir, "reporte.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "reporte.md"), renderMarkdown(report), "utf8");
  return manifest;
}

// ---------- CLI ----------

function parseArgs(argv) {
  const options = { online: false, pack: null, out: DEFAULT_OUT, jsonOnly: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--online") options.online = true;
    else if (arg === "--json-only") options.jsonOnly = true;
    else if (arg === "--quiet") options.quiet = true;
    else if (arg === "--root") options.root = argv[(i += 1)];
    else if (arg === "--claims") options.claimsPath = argv[(i += 1)];
    else if (arg === "--doc") options.docRel = argv[(i += 1)];
    else if (arg === "--claim") options.only = [...(options.only ?? []), argv[(i += 1)]];
    else if (arg === "--pack") options.pack = argv[(i += 1)];
    else if (arg === "--out") options.out = argv[(i += 1)];
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`argumento desconocido: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2), io = { out: process.stdout, err: process.stderr }) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.err.write(`${error.message}\n`);
    return 2;
  }
  if (options.help) {
    io.out.write(
      [
        "audit-investigacion — audita las afirmaciones de docs/estrategia-aprendizaje-2026-10-24.md",
        "",
        "  --online           resuelve DOI (Crossref) y URLs",
        "  --claim ID         audita solo esa afirmación (repetible)",
        "  --pack DIR         exporta claims + extractos con SHA-256",
        "  --out DIR          destino del reporte (default docs/auditoria)",
        "  --json-only        imprime solo el JSON",
        "  --quiet            no imprime el resumen humano",
        "",
        "Códigos de salida: 0 aprobado (o aprobado con pendientes), 1 refutado, 2 uso.",
      ].join("\n") + "\n",
    );
    return 0;
  }
  const report = await runAudit(options);
  const outDir = path.resolve(options.root ?? process.cwd(), options.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "reporte.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "reporte.md"), renderMarkdown(report), "utf8");
  if (options.pack) {
    const manifest = writePack(report, path.resolve(options.root ?? process.cwd()), path.resolve(options.pack));
    if (!options.quiet) {
      io.out.write(`Paquete: ${path.resolve(options.pack)} (${manifest.files.length} archivos, ${manifest.claims.length} afirmaciones)\n`);
    }
  }
  if (options.jsonOnly) {
    io.out.write(`${JSON.stringify(report, null, 2)}\n`);
  } else if (!options.quiet) {
    io.out.write(
      `${report.verdict}: ${report.summary.pass}/${report.summary.claims} aprobadas, ` +
        `${report.summary.fail} refutadas, ${report.summary.refutedExpected} refutadas por auditoría · ` +
        `${report.summary.unverified} sin verificar · ` +
        `código ${report.summary.codePass}/${report.summary.claims} en verde · ` +
        `referencias ${report.summary.referencePass} verificadas, ` +
        `${report.summary.referenceUnverified} sin red, ${report.summary.referenceFail} rotas\n`,
    );
    for (const result of report.results.filter((r) => r.status !== "PASS")) {
      io.out.write(`  - ${result.status} ${result.id} (${result.title})\n`);
      for (const check of result.checks.filter((c) => c.status === "FAIL" || c.status === "UNVERIFIED")) {
        io.out.write(`      ${check.status} ${check.kind}: ${check.detail}\n`);
      }
    }
    io.out.write(`Reporte: ${path.join(outDir, "reporte.md")}\n`);
  }
  return report.verdict === "FAIL" ? 1 : 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().then((code) => {
    process.exitCode = code;
  });
}
