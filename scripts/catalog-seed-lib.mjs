// Funciones puras del seed del catálogo: parseo del RDF de Gutenberg,
// regla de dominio público, y manifiesto de vocabulario. Separadas del
// CLI (catalog-seed.mjs) para que vitest las pruebe sin red.

export const RDF_URL = (id) => `https://www.gutenberg.org/ebooks/${id}.rdf`;
export const EPUB3_URL = (id) =>
  `https://www.gutenberg.org/ebooks/${id}.epub3.images`;
export const EPUB_URL = (id) =>
  `https://www.gutenberg.org/ebooks/${id}.epub.images`;
export const COVER_URL = (id) =>
  `https://www.gutenberg.org/cache/epub/${id}/pg${id}.cover.medium.jpg`;

// Roles del RDF que bloquean la publicación si su fecha de muerte es
// posterior al corte o desconocida: autor y traductor son derecho puro;
// el editor mete aparato propio al EPUB, así que también bloquea.
const BLOCKING_ROLES = new Set(["creator", "trl", "edt"]);
const ROLE_NAMES = {
  "dcterms:creator": "creator",
  "marcrel:trl": "trl",
  "marcrel:edt": "edt",
};

const AGENT_RE =
  /<pgterms:agent[^>]*>([\s\S]*?)<\/pgterms:agent>|<pgterms:agent[^>]*\/>/g;

const tag = (xml, name) => {
  const m = xml.match(
    new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`),
  );
  return m ? m[1].trim() : null;
};

// Parsea un RDF de Gutenberg. Devuelve metadatos + colaboradores con rol
// normalizado (creator/trl/edt/otro), nombre y fechas de nacimiento/muerte
// (entero de año o null). El RDF de Gutenberg usa <pgterms:agent> con
// <pgterms:name/birthdate/deathdate>, colgados de <dcterms:creator> y de
// <marcrel:xxx> dentro de <dcterms:agent>... en la práctica los agentes
// aparecen como hermanos referenciados por rdf:resource o anidados: aquí
// se cubre la forma anidada (la real del feed) y cada <marcrel:*> que
// envuelve un agente se traduce a su rol.
export function parseRdf(xml) {
  const work =
    xml.match(/<pgterms:ebook[\s\S]*?<\/pgterms:ebook>/)?.[0] ?? xml;

  const title = tag(work, "dcterms:title") ?? "";
  const rights = tag(work, "dcterms:rights") ?? "";

  const languages = [
    ...work.matchAll(/<dcterms:language[\s\S]*?<\/dcterms:language>/g),
  ].map((m) => {
    const v = tag(m[0], "rdf:value");
    return v ? v.trim().toLowerCase() : null;
  }).filter(Boolean);

  const issued = tag(work, "dcterms:issued");
  const subjects = [
    ...work.matchAll(/<dcterms:subject[\s\S]*?<\/dcterms:subject>/g),
  ]
    .map((m) => tag(m[0], "rdf:value"))
    .filter(Boolean);

  // Tipo de la obra (dcterms:type → rdf:value): «Text» es el valor del
  // catálogo para libros; igual que Gutendex, la ausencia se lee como
  // «Text» (el índice masivo solo admite ese tipo).
  const typeBlock = work.match(
    /<dcterms:type\b[^>]*>([\s\S]*?)<\/dcterms:type>/,
  );
  const typeValue = typeBlock ? tag(typeBlock[1], "rdf:value") : null;
  const type = typeValue?.trim() || "Text";

  // Descargas acumuladas (pgterms:downloads): las usa el índice para
  // ordenar la búsqueda; 0 cuando el RDF no lo trae o viene roto.
  const downloadsRaw = tag(work, "pgterms:downloads");
  const downloadsNum = Number.parseInt(
    String(downloadsRaw ?? "").replace(/<[^>]+>/g, "").trim(),
    10,
  );
  const downloads =
    Number.isFinite(downloadsNum) && downloadsNum > 0 ? downloadsNum : 0;

  // Formatos disponibles: cada <pgterms:file> lleva un <dcterms:format>
  // con <rdf:value> = tipo MIME (a veces con «; charset=…»). Se guarda
  // en minúsculas y sin parámetros — el índice exige application/epub+zip.
  const formats = new Set();
  for (const file of work.matchAll(
    /<pgterms:file\b[\s\S]*?<\/pgterms:file>/g,
  )) {
    for (const fmt of file[0].matchAll(
      /<dcterms:format\b[^>]*>([\s\S]*?)<\/dcterms:format>/g,
    )) {
      const value = tag(fmt[1], "rdf:value");
      if (value) formats.add(value.split(";")[0].trim().toLowerCase());
    }
  }

  const contributors = [];
  const seenAgents = new Set();

  // Recorre los bloques <dcterms:creator> y <marcrel:xxx> que contienen
  // agentes. El rol sale de la etiqueta envolvente; lo que no sea
  // bloqueante queda como advisory.
  const roleBlock =
    /<(dcterms:creator|marcrel:[a-z]+)[^>]*>([\s\S]*?)<\/\1>/g;
  for (const m of work.matchAll(roleBlock)) {
    const role = ROLE_NAMES[m[1]] ?? "other";
    const agents = [...m[2].matchAll(AGENT_RE)];
    for (const a of agents) {
      const body = a[1] ?? "";
      const name = tag(body, "pgterms:name") ?? "";
      if (!name || seenAgents.has(`${role}:${name}`)) continue;
      seenAgents.add(`${role}:${name}`);
      const birth = parseYear(tag(body, "pgterms:birthdate"));
      const death = parseYear(tag(body, "pgterms:deathdate"));
      contributors.push({ name, role, birth, death });
    }
  }

  return {
    title,
    rights,
    languages,
    issued,
    subjects,
    contributors,
    type,
    downloads,
    formats: [...formats].sort(),
  };
}

// Texto de búsqueda del índice Gutenberg: título + autor en
// minúsculas y sin acentos (misma normalización que aplica el worker
// sobre `q` antes de la búsqueda — las dos puntas deben coincidir).
// La puntuación se convierte en espacio para que la tokenización
// posterior produzca palabras limpias («becquer,» → «becquer»).
export function searchTextOf(...parts) {
  return parts
    .filter((part) => typeof part === "string" && part.trim())
    .join(" ")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokens de búsqueda del índice Gutenberg: palabras normalizadas del
// texto de búsqueda (título + autor), sin duplicados ni vacíos.
export function searchTokensOf(text) {
  const normalized = String(text ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];
  const seen = new Set();
  const out = [];
  for (const token of normalized.split(" ")) {
    if (token && !seen.has(token)) {
      seen.add(token);
      out.push(token);
    }
  }
  return out;
}

function parseYear(v) {
  if (v == null) return null;
  const m = String(v).match(/(\d{3,4})/);
  return m ? Number(m[1]) : null;
}

// Regla conservadora de dominio público: todo creator/trl/edt debe tener
// fecha de muerte ≤ deathYearMax. Muerte desconocida bloquea (mejor
// faltar que infringir) salvo que el agente sea anónimo o tenga
// nacimiento muy antiguo sin muerte registrada (p. ej. autores antiguos
// sin fecha exacta). Devuelve el veredicto y la lista de motivos.
export function rightsCheck(contributors, { deathYearMax = 1924 } = {}) {
  const blocking = [];
  const advisory = [];
  for (const c of contributors) {
    const isBlockingRole = BLOCKING_ROLES.has(c.role);
    if (c.death != null) {
      if (c.death > deathYearMax) {
        (isBlockingRole ? blocking : advisory).push({
          name: c.name,
          role: c.role,
          reason: `murió en ${c.death} (> ${deathYearMax})`,
        });
      }
      continue;
    }
    // Sin fecha de muerte: anónimo/antiguo pasa. Antiguo = nacimiento
    // remoto o el propio nombre con referencia de siglo («Gómez de
    // Tapia, Luis, 16th century» — el RDF no trae fecha pero el siglo
    // queda explícito).
    const ancient =
      (c.birth != null && c.birth <= deathYearMax - 120) ||
      /\d{1,2}(st|nd|rd|th)?[- ]?century|siglo\s+(x|ix|iv|v|i)+/i.test(c.name);
    const anonymous = /anon|an[oó]nimo|unknown|various|varios/i.test(c.name);
    if (!ancient && !anonymous && isBlockingRole) {
      blocking.push({
        name: c.name,
        role: c.role,
        reason: "fecha de muerte desconocida",
      });
    } else if (!ancient && !anonymous) {
      advisory.push({
        name: c.name,
        role: c.role,
        reason: "fecha de muerte desconocida",
      });
    }
  }
  return { ok: blocking.length === 0, blocking, advisory };
}

// Contrato compartido con src/shared/word-form.ts: solo letras del
// español (tildes, ñ, ü), ≥3 caracteres, en minúsculas. Se replica el
// patrón aquí porque el seed corre en Node sin transpilar TS.
const FORM_RE = /[a-záéíóúüñ]{3,}/gi;

const ENTITY = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  ntilde: "ñ", uuml: "ü", Aacute: "Á", Eacute: "É", Iacute: "Í",
  Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
  iexcl: "¡", iquest: "¿", laquo: "«", raquo: "»", mdash: "—",
  ndash: "–", hellip: "…", egrave: "è", agrave: "à", ugrave: "ù",
  ograve: "ò", euml: "ë", auml: "ä", ouml: "ö", ccedil: "ç",
  ordm: "º", ordf: "ª",
};

export function decodeEntities(text) {
  return text.replace(
    /&(#x?[0-9a-f]+|[a-z]+);/gi,
    (m, name) => {
      if (name[0] === "#") {
        const n = name[1]?.toLowerCase() === "x"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITY[name] ?? m;
    },
  );
}

// XHTML → texto plano suficiente para contar vocabulario: quita
// script/style, convierte cierres de bloque en saltos, elimina tags y
// decodifica entidades. No pretende ser un renderer: solo alimenta el
// tokenizador.
export function xhtmlToText(xhtml) {
  let t = xhtml;
  t = t.replace(/<script[\s\S]*?<\/script\s*>/gi, " ");
  t = t.replace(/<style[\s\S]*?<\/style\s*>/gi, " ");
  t = decodeEntities(t);
  t = t.replace(/<\/(p|div|h[1-6]|li|tr|section|article|blockquote|br)\s*>/gi, "\n");
  t = t.replace(/<br[^>]*>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  return t;
}

// Igual que epub.ts: los soft hyphens dividen palabras y ensucian las
// formas. Se eliminan antes de tokenizar.
export function tokenizeForms(text) {
  const clean = text.replace(/\u00AD/g, "");
  const out = [];
  for (const m of clean.matchAll(FORM_RE)) out.push(m[0].toLowerCase());
  return out;
}

// Manifiesto de vocabulario crudo (sin resolución léxica): formas
// únicas + conteos. Con el léxico, el seed lo convierte en
// `buildResolvedManifest` — la forma que entiende la cobertura.
export function buildVocabManifest(text) {
  const forms = tokenizeForms(text);
  const unique = [...new Set(forms)].sort();
  return {
    wordCount: forms.length,
    uniqueForms: unique.length,
    forms: unique,
  };
}

// ---------- Resolución contra el catálogo léxico ----------
//
// El manifest público (catalog/{id}.vocab.json) lleva entradas
// RESUELTAS, no formas crudas: el cliente calcula la cobertura local
// sin una consulta por libro. Formato compacto:
//   { v, wordCount, uniqueForms, entries: SlimEntry[],
//     byForm: { forma: [índice en entries, ...] }, missing: string[] }
// SlimEntry = lo que la clasificación consume: id, lemma, pos, zipf
// (sin senses — la cobertura no muestra definiciones).

// Réplica de cliticBaseForms (src/client/lib/knowledge.ts): quita uno
// o dos pronombres enclíticos y normaliza la tilde desplazada. El seed
// la usa para incluir las BASES en la consulta — la forma del libro
// («tomándose») queda resuelta con la ficha de «tomando».
const ENCLITIC_PRONOUNS = [
  "los", "las", "les", "lo", "la", "le", "me", "te", "se", "nos", "os",
];

const stripAccents = (text) =>
  text.normalize("NFD").replace(/\p{M}/gu, "");

export function cliticBaseForms(form) {
  const out = [];
  const seen = new Set();
  const push = (candidate) => {
    const clean = stripAccents(candidate);
    if (clean.length >= 3 && clean !== form && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  };
  for (const pronoun of ENCLITIC_PRONOUNS) {
    if (!form.endsWith(pronoun)) continue;
    const once = form.slice(0, -pronoun.length);
    push(once);
    for (const second of ENCLITIC_PRONOUNS) {
      if (!once.endsWith(second)) continue;
      push(once.slice(0, -second.length));
    }
  }
  return out;
}

// Réplica de menteBaseForms (src/shared/word-form.ts): base adjetiva
// de un adverbio en «-mente» («perfectamente» → «perfecta»/«perfecto»).
export function menteBaseForms(form) {
  if (!form.endsWith("mente")) return [];
  const root = form.slice(0, -"mente".length);
  if (root.length < 3) return [];
  return root.endsWith("a") ? [root, `${root.slice(0, -1)}o`] : [root];
}

// Réplica de las reglas inglesas de generateLookupCandidates
// (src/shared/word-form.ts): el seed corre en Node sin transpilar, así
// que las flexiones candidatas se derivan aquí con la misma prioridad.
export function englishBaseForms(form) {
  const clean = form.trim().toLowerCase();
  if (clean.length < 4) return [];
  const out = [];
  const push = (candidate) => {
    if (
      typeof candidate === "string" &&
      candidate.length >= 3 &&
      candidate !== clean &&
      !out.includes(candidate)
    ) {
      out.push(candidate);
    }
  };

  if (clean.endsWith("ies") && clean.length > 4) {
    push(`${clean.slice(0, -3)}y`);
  }
  if (clean.endsWith("ied") && clean.length > 4) {
    push(`${clean.slice(0, -3)}y`);
  }
  if (clean.endsWith("ing") && clean.length > 5) {
    const root = clean.slice(0, -3);
    push(root);
    push(`${root}e`);
    if (root.length >= 3 && root[root.length - 1] === root[root.length - 2]) {
      push(root.slice(0, -1));
    }
  }
  if (clean.endsWith("ed") && clean.length > 4) {
    const rootNoEd = clean.slice(0, -2);
    push(rootNoEd);
    push(clean.slice(0, -1));
    if (
      rootNoEd.length >= 3 &&
      rootNoEd[rootNoEd.length - 1] === rootNoEd[rootNoEd.length - 2]
    ) {
      push(rootNoEd.slice(0, -1));
    }
  }
  if (clean.endsWith("ly") && clean.length > 4) {
    push(clean.slice(0, -2));
    if (clean.endsWith("ily") && clean.length > 4) {
      push(`${clean.slice(0, -3)}y`);
    }
  }
  if (clean.endsWith("es") && clean.length > 3) {
    push(clean.slice(0, -2));
    push(clean.slice(0, -1));
  }
  if (clean.endsWith("s") && !clean.endsWith("ss") && clean.length > 3) {
    push(clean.slice(0, -1));
  }
  return out;
}

// Todas las formas a resolver: las del libro más sus bases verificables.
// En español son las bases clíticas/«-mente»; en inglés, las flexiones
// candidatas (plural, -ing, -ed, -ly, -ies/-ied) para que una forma del
// libro sin ficha propia aún resuelva contra el lema en el manifiesto.
export function formsWithBases(forms, language = "es") {
  const all = new Set(forms);
  for (const form of forms) {
    const bases =
      language === "en"
        ? englishBaseForms(form)
        : [...cliticBaseForms(form), ...menteBaseForms(form)];
    for (const base of bases) all.add(base);
  }
  return [...all];
}

// Lee la lista de stopwords directo de src/shared/stopwords.ts: el seed
// corre en Node sin transpilar, pero la lista es un array literal —
// extraerla mantiene una sola fuente (menos de 100 ítems = parseo
// roto, se aborta en vez de filtrar a medias).
export function loadStopwords(stopwordsTsSource, language = "es") {
  const constName =
    language === "en"
      ? "ENGLISH_STOPWORDS"
      : language === "es"
        ? "SPANISH_STOPWORDS"
        : null;
  if (!constName) {
    throw new Error(`Idioma de stopwords no soportado: ${language}`);
  }
  const block = stopwordsTsSource.match(
    new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\];`),
  );
  if (!block) {
    throw new Error(`No encontré ${constName} en stopwords.ts`);
  }
  const words = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (words.length < 100) {
    throw new Error(`Lista de stopwords sospechosamente corta (${words.length})`);
  }
  return new Set(words);
}

// Arma el manifest resuelto a partir de la respuesta del léxico:
// `entriesByForm` = { forma: [{entryId, lemma, pos, zipf}, ...] } con la
// misma forma que devuelve findEntriesForForms/groupEntries (sin senses).
export function buildResolvedManifest(
  text,
  entriesByForm,
  { stopwords, language = "es" } = {},
) {
  const raw = buildVocabManifest(text);
  const bookForms = new Set(
    stopwords ? raw.forms.filter((f) => !stopwords.has(f)) : raw.forms,
  );
  const entries = [];
  const entryIndex = new Map();
  const byForm = {};
  const missing = [];
  // byForm lleva llave por CADA forma resuelta (del libro y bases):
  // predictSection consulta la forma del libro y, sin ficha propia,
  // las bases clíticas/«-mente» — deben estar como llaves propias.
  for (const form of Object.keys(entriesByForm)) {
    const list = entriesByForm[form];
    if (!list?.length) continue;
    const idxs = [];
    for (const e of list) {
      const k = e.entryId != null ? `id:${e.entryId}` : `${e.lemma}::${e.pos ?? ""}`;
      let idx = entryIndex.get(k);
      if (idx == null) {
        idx = entries.length;
        entryIndex.set(k, idx);
        entries.push({
          id: e.entryId,
          lemma: e.lemma,
          pos: e.pos,
          zipf: e.zipf,
        });
      }
      idxs.push(idx);
    }
    byForm[form] = idxs;
  }
  // En inglés predictSection no conoce las flexiones: la forma del libro
  // se aliasa a la primera base candidata que sí resolvió en el léxico
  // («houses» → «house») para que la cobertura no la marque como nueva.
  if (language === "en") {
    for (const form of bookForms) {
      if (byForm[form]) continue;
      const idxs = [];
      for (const candidate of englishBaseForms(form)) {
        const list = byForm[candidate];
        if (list?.length) idxs.push(...list);
      }
      if (idxs.length) byForm[form] = [...new Set(idxs)];
    }
  }
  for (const form of bookForms) {
    if (byForm[form]) continue;
    if (language === "en") {
      missing.push(form);
      continue;
    }
    const bases = [...cliticBaseForms(form), ...menteBaseForms(form)];
    if (!bases.some((b) => byForm[b]?.length)) missing.push(form);
  }
  return {
    v: 1,
    wordCount: raw.wordCount,
    uniqueForms: bookForms.size,
    // Formas propias del libro (sin stopwords): la cobertura las cuenta
    // una a una — las llaves extra de byForm son solo bases de respaldo.
    forms: [...bookForms].sort(),
    entries,
    byForm,
    missing,
  };
}

// Valida una entrada de la curación antes de tocar la red.
export function validateCurationItem(item) {
  const errors = [];
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(item.id ?? "")) {
    errors.push(`id inválido: ${item.id}`);
  }
  if (!Number.isInteger(item.gutenbergId) || item.gutenbergId <= 0) {
    errors.push(`gutenbergId inválido: ${item.gutenbergId}`);
  }
  if (!item.title?.trim()) errors.push("falta title");
  if (!item.author?.trim()) errors.push("falta author");
  const language = item.language ?? "es";
  if (language !== "es" && language !== "en") {
    errors.push(`language inválido: ${item.language}`);
  }
  if (item.synopsis !== undefined) {
    if (typeof item.synopsis !== "string" || !item.synopsis.trim()) {
      errors.push("synopsis inválida");
    } else if (item.synopsis.trim().length > 320) {
      errors.push("synopsis demasiado larga");
    }
  }
  return errors;
}
