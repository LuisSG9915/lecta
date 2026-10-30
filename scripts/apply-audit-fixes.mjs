#!/usr/bin/env node
/**
 * Script de integración para Gemini 3.8 Flash
 * Resuelve y optimiza los Huecos 2.1, 2.2, 3.1 y 3.2 en Lecta.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function patchFile(relPath, replacer) {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`[OMITIDO] No se encontró: ${relPath}`);
    return;
  }
  const original = fs.readFileSync(fullPath, "utf8");
  const updated = replacer(original);
  if (original === updated) {
    console.log(`[SIN CAMBIOS] ${relPath} (ya aplicado o patrón no encontrado)`);
  } else {
    fs.writeFileSync(fullPath, updated, "utf8");
    console.log(`[ACTUALIZADO] ${relPath}`);
  }
}

// ============================================================================
// 1. HUECO 2.1 — src/client/lib/reading-location.ts
// Separa el fin del bucle RAF (2500ms) de la interacción humana real para que
// imágenes lentas (>2.5s en redes 3G) y cambios de tamaño (ResizeObserver)
// sigan re-estabilizando el ancla hasta por 15s mientras el lector no toque
// ni desplace la vista.
// ============================================================================
patchFile("src/client/lib/reading-location.ts", (content) => {
  const targetBlock = `const ANCHOR_TOLERANCE_PX = 12;
const ANCHOR_KEEP_MS = 2_500;
// Ventana en la que la colocación recién restaurada se revisa cuadro a
// cuadro: la primera medida puede caer con los estilos a medio aplicar.
const ANCHOR_SETTLE_MS = 400;`;

  const replacementBlock = `const ANCHOR_TOLERANCE_PX = 12;
const ANCHOR_KEEP_MS = 2_500;
// Ventana extendida para reflujos tardíos de imágenes lentas (redes 3G/móviles).
const MEDIA_LATE_REFLOW_MS = 15_000;
// Ventana en la que la colocación recién restaurada se revisa cuadro a
// cuadro: la primera medida puede caer con los estilos a medio aplicar.
const ANCHOR_SETTLE_MS = 400;`;

  let next = content.replace(targetBlock, replacementBlock);

  const oldFn = /export function keepAnchorStable\([\s\S]*?\n\}\n/;
  const newFn = `export function keepAnchorStable(
  container: HTMLElement,
  anchor: string,
  offset = 0,
  options?: {
    durationMs?: number;
    mediaTimeoutMs?: number;
    tolerancePx?: number;
    settleMs?: number;
  },
): () => void {
  const target = normalizeBlockText(anchor).slice(0, 40);
  if (!target) return () => {};
  const fraction = clamp01(offset);
  const tolerance = options?.tolerancePx ?? ANCHOR_TOLERANCE_PX;
  const settleMs = options?.settleMs ?? ANCHOR_SETTLE_MS;
  const start = Date.now();
  const rafDeadline = start + (options?.durationMs ?? ANCHOR_KEEP_MS);
  const mediaDeadline =
    start + Math.max(options?.durationMs ?? ANCHOR_KEEP_MS, options?.mediaTimeoutMs ?? MEDIA_LATE_REFLOW_MS);

  let stopped = false;
  let rafFinished = false;
  let lastHeight = -1;
  let frame = 0;
  let mediaCleanupTimer: number | null = null;
  let node: HTMLElement | null = null;
  const imgCleanups: Array<() => void> = [];

  const correct = () => {
    if (stopped) return;
    if (Date.now() > mediaDeadline) {
      stop();
      return;
    }
    if (!node || !node.isConnected) node = findAnchorBlock(container, target);
    const el = node;
    if (!el || !el.isConnected) return;
    const rect = el.getBoundingClientRect();
    const height = rect.height || el.scrollHeight;
    if (height <= 0) return;
    const delta = rect.top + fraction * height;
    if (Math.abs(delta) <= tolerance) return;
    const max = Math.max(
      0,
      document.documentElement.scrollHeight - window.innerHeight,
    );
    const next = Math.min(Math.max(0, window.scrollY + delta), max);
    if (Math.abs(next - window.scrollY) >= 1) window.scrollTo(0, next);
  };

  const tick = () => {
    if (stopped || rafFinished) return;
    const height = document.documentElement.scrollHeight;
    if (Date.now() - start < settleMs || height !== lastHeight) {
      lastHeight = height;
      correct();
    }
    // Al cumplir los 2.500 ms se apaga solo el bucle RAF por cuadro,
    // pero se mantienen vivos los listeners de imágenes lentas hasta mediaDeadline
    // siempre que la persona no haya interactuado.
    if (Date.now() >= rafDeadline) {
      rafFinished = true;
      return;
    }
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    rafFinished = true;
    cancelAnimationFrame(frame);
    if (mediaCleanupTimer !== null) window.clearTimeout(mediaCleanupTimer);
    container.removeEventListener("load", onMediaLoad, true);
    while (imgCleanups.length > 0) imgCleanups.pop()?.();
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("wheel", stop, true);
    window.removeEventListener("touchstart", stop, true);
    window.removeEventListener("touchmove", stop, true);
    window.removeEventListener("keydown", stop, true);
  };

  const onMediaLoad = () => {
    if (stopped) return;
    lastHeight = document.documentElement.scrollHeight;
    correct();
  };

  // Registrar listeners directos sobre cada <img> pendiente y ResizeObserver
  // para cubrir decodificaciones asíncronas tardías después de los 2.500 ms.
  const images = container.querySelectorAll<HTMLImageElement>("img");
  images.forEach((img) => {
    if (img.complete && img.naturalHeight > 0) return;
    const onImgSettled = () => {
      if (stopped) return;
      if (typeof img.decode === "function") {
        void img.decode().then(onMediaLoad).catch(onMediaLoad);
      } else {
        onMediaLoad();
      }
    };
    img.addEventListener("load", onImgSettled, { once: true });
    img.addEventListener("error", onImgSettled, { once: true });
    imgCleanups.push(() => {
      img.removeEventListener("load", onImgSettled);
      img.removeEventListener("error", onImgSettled);
    });
  });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      if (!stopped && rafFinished) onMediaLoad();
    });
    ro.observe(container);
    imgCleanups.push(() => ro.disconnect());
  }

  container.addEventListener("load", onMediaLoad, true);
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("wheel", stop, true);
  window.addEventListener("touchstart", stop, true);
  window.addEventListener("touchmove", stop, true);
  window.addEventListener("keydown", stop, true);

  const fonts = (
    document as Document & { fonts?: { ready?: Promise<unknown> } }
  ).fonts;
  void fonts?.ready?.then(() => correct()).catch(() => undefined);

  mediaCleanupTimer = window.setTimeout(stop, Math.max(0, mediaDeadline - start));
  lastHeight = document.documentElement.scrollHeight;
  frame = requestAnimationFrame(tick);

  return stop;
}
`;

  return next.replace(oldFn, newFn);
});

// ============================================================================
// 2. HUECO 2.2 — Persistencia y protección de anchorOffset entre dispositivos
// 2.2.a: Migración SQL 019_positions_anchor_offset.sql
// ============================================================================
const migrationPath = path.join(root, "db/migrations/019_positions_anchor_offset.sql");
if (!fs.existsSync(migrationPath)) {
  fs.writeFileSync(
    migrationPath,
    `-- Añade fracción intra-párrafo (anchor_offset 0..1) para conservar la línea
-- exacta entre dispositivos de distinto ancho de pantalla.
ALTER TABLE lecta_user_positions
  ADD COLUMN IF NOT EXISTS anchor_offset FLOAT8;
`,
    "utf8"
  );
  console.log("[CREADO] db/migrations/019_positions_anchor_offset.sql");
}

// 2.2.b: Contrato compartido en src/shared/reading-data.ts
patchFile("src/shared/reading-data.ts", (content) => {
  let next = content.replace(
    `export type SyncPositionInput = {
  bookHash?: unknown;
  sectionIndex?: unknown;
  scrollTop?: unknown;
  ratio?: unknown;
  progress?: unknown;
  anchor?: unknown;
  updatedAt?: unknown;
};`,
    `export type SyncPositionInput = {
  bookHash?: unknown;
  sectionIndex?: unknown;
  scrollTop?: unknown;
  ratio?: unknown;
  progress?: unknown;
  anchor?: unknown;
  anchorOffset?: unknown;
  updatedAt?: unknown;
};`
  );

  next = next.replace(
    `export type CleanPosition = {
  bookHash: string;
  sectionIndex: number;
  scrollTop: number;
  ratio: number | null;
  progress: number | null;
  anchor: string | null;
  updatedAt: number;
};`,
    `export type CleanPosition = {
  bookHash: string;
  sectionIndex: number;
  scrollTop: number;
  ratio: number | null;
  progress: number | null;
  anchor: string | null;
  anchorOffset: number | null;
  updatedAt: number;
};`
  );

  next = next.replace(
    `    anchor: text(input.anchor, POSITION_LIMITS.anchor),
    updatedAt: stamp(input.updatedAt) ?? Date.now(),`,
    `    anchor: text(input.anchor, POSITION_LIMITS.anchor),
    anchorOffset: fraction(input.anchorOffset),
    updatedAt: stamp(input.updatedAt) ?? Date.now(),`
  );

  return next;
});

// 2.2.c: Worker SQL en src/worker/reading-data.ts
patchFile("src/worker/reading-data.ts", (content) => {
  let next = content.replace(
    `        \`SELECT book_hash AS "bookHash", section_index AS "sectionIndex",
                scroll_top AS "scrollTop", ratio, progress, anchor,
                updated_at AS "updatedAt", synced_at AS "syncedAt"
         FROM lecta_user_positions`,
    `        \`SELECT book_hash AS "bookHash", section_index AS "sectionIndex",
                scroll_top AS "scrollTop", ratio, progress, anchor,
                anchor_offset AS "anchorOffset",
                updated_at AS "updatedAt", synced_at AS "syncedAt"
         FROM lecta_user_positions`
  );

  next = next.replace(
    `      ratio: row.ratio != null ? Number(row.ratio) : null,
      progress: row.progress != null ? Number(row.progress) : null,
      updatedAt: Number(row.updatedAt),`,
    `      ratio: row.ratio != null ? Number(row.ratio) : null,
      progress: row.progress != null ? Number(row.progress) : null,
      anchorOffset: row.anchorOffset != null ? Number(row.anchorOffset) : undefined,
      updatedAt: Number(row.updatedAt),`
  );

  next = next.replace(
    `      \`INSERT INTO lecta_user_positions
         (user_id, book_hash, section_index, scroll_top, ratio, progress, anchor, updated_at, synced_at)
       SELECT $1,
              j.value ->> 'bookHash',
              (j.value ->> 'sectionIndex')::int8,
              (j.value ->> 'scrollTop')::float8,
              (j.value ->> 'ratio')::float8,
              (j.value ->> 'progress')::float8,
              j.value ->> 'anchor',
              (j.value ->> 'updatedAt')::int8,
              $3::int8
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, book_hash) DO UPDATE SET
          section_index = excluded.section_index,
          scroll_top = excluded.scroll_top,
          ratio = excluded.ratio,
          progress = excluded.progress,
          anchor = excluded.anchor,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at`,
    `      \`INSERT INTO lecta_user_positions
         (user_id, book_hash, section_index, scroll_top, ratio, progress, anchor, anchor_offset, updated_at, synced_at)
       SELECT $1,
              j.value ->> 'bookHash',
              (j.value ->> 'sectionIndex')::int8,
              (j.value ->> 'scrollTop')::float8,
              (j.value ->> 'ratio')::float8,
              (j.value ->> 'progress')::float8,
              j.value ->> 'anchor',
              (j.value ->> 'anchorOffset')::float8,
              (j.value ->> 'updatedAt')::int8,
              $3::int8
       FROM jsonb_array_elements($2::jsonb) AS j(value)
       ON CONFLICT (user_id, book_hash) DO UPDATE SET
          section_index = excluded.section_index,
          scroll_top = excluded.scroll_top,
          ratio = excluded.ratio,
          progress = excluded.progress,
          anchor = excluded.anchor,
          anchor_offset = excluded.anchor_offset,
          updated_at = excluded.updated_at,
          synced_at = excluded.synced_at`
  );

  return next;
});

// 2.2.d: Sincronización cliente en src/client/lib/positions-sync.ts
patchFile("src/client/lib/positions-sync.ts", (content) => {
  return content.replace(
    `      // El servidor guarda el ancla como texto, sin la fracción del
      // bloque que ya se había leído: si la fila remota apunta al mismo
      // párrafo, se conserva la precisión que este dispositivo conoce.
      const merged =
        existing?.anchorOffset != null &&
        existing.anchor != null &&
        existing.anchor === item.anchor
          ? { ...item, anchorOffset: existing.anchorOffset }
          : item;`,
    `      // Si el servidor ya trae anchorOffset válido (0..1), se usa directamente.
      // Si viene sin él, solo se conserva el anchorOffset local cuando el ancla
      // textual y la sección coinciden exactamente; si el ancla cambió, se limpia
      // a undefined para jamás aplicar un offset ajeno a otro párrafo.
      const remoteHasOffset =
        typeof item.anchorOffset === "number" &&
        Number.isFinite(item.anchorOffset) &&
        item.anchorOffset >= 0 &&
        item.anchorOffset <= 1;
      const sameParagraphAsLocal =
        existing?.anchorOffset != null &&
        existing.anchor != null &&
        item.anchor != null &&
        existing.sectionIndex === item.sectionIndex &&
        existing.anchor === item.anchor;
      const resolvedOffset = remoteHasOffset
        ? item.anchorOffset
        : sameParagraphAsLocal
          ? existing.anchorOffset
          : undefined;
      const merged: SavedBookPosition = {
        ...item,
        ...(resolvedOffset !== undefined ? { anchorOffset: resolvedOffset } : { anchorOffset: undefined }),
      };`
  );
});

// ============================================================================
// 3. HUECOS 3.1 y 3.2 — src/client/components/Vocabulary.tsx y src/client/lib/fsrs.ts
// - Hueco 3.1: Resalte morfológico en español/multilingüe con stemmer léxico,
//   normalización de diptongaciones (e↔ie, o↔ue, e↔i) y respeto de límites de palabra.
// - Hueco 3.2: Guardia defensiva de tipos/rangos en getStabilitySegments y en el
//   planificador FSRS para tarjetas importadas corruptas.
// ============================================================================
patchFile("src/client/components/Vocabulary.tsx", (content) => {
  if (content.includes("export function safeStability")) {
    return content;
  }
  const oldBlock = `// Nivel de estabilidad FSRS en 4 segmentos para el indicador visual
function getStabilitySegments(s: number): number {
  if (s >= 14) return 4;
  if (s >= 7) return 3;
  if (s >= 2) return 2;
  if (s > 0.5) return 1;
  return 0;
}

// Resalta la palabra dentro del contexto del libro con estilo ámbar suave
function renderHighlightedContext(context: string | null | undefined, form: string) {
  if (!context) return null;
  const target = form.trim();
  if (!target) return context;
  const lowerTarget = target.toLowerCase();
  const lowerContext = context.toLowerCase();
  const idx = lowerContext.indexOf(lowerTarget);
  if (idx !== -1) {
    const before = context.slice(0, idx);
    const match = context.slice(idx, idx + target.length);
    const after = context.slice(idx + target.length);
    return (
      <>
        {before}
        <mark className="nb-word-quote-highlight">{match}</mark>
        {after}
      </>
    );
  }
}`;

  const oldBlockRegex = /\/\/ Nivel de estabilidad FSRS en 4 segmentos para el indicador visual[\s\S]*?\n\}\n(?=\n\/\/ Etiqueta de estado)/;

  const newBlock = `// Sanitiza valores de estabilidad provenientes de tarjetas importadas o remotas
export function safeStability(s: unknown): number {
  return typeof s === "number" && Number.isFinite(s) && s > 0 ? s : 0;
}

// Nivel de estabilidad FSRS en 4 segmentos para el indicador visual (Hueco 3.2)
export function getStabilitySegments(s: unknown): number {
  const clean = safeStability(s);
  if (clean >= 14) return 4;
  if (clean >= 7) return 3;
  if (clean >= 2) return 2;
  if (clean > 0.5) return 1;
  return 0;
}

const stripDiacritics = (str: string) =>
  str.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();

// Normaliza alternancias vocálicas y diptongaciones frecuentes en raíces del español
// (pensar -> piensa, dormir -> duerme, pedir -> pidió, sentir -> sintió)
const foldSpanishDiphthongs = (str: string) =>
  stripDiacritics(str)
    .replace(/ie/g, "e")
    .replace(/ue/g, "o")
    .replace(/qu/g, "c")
    .replace(/gu(?=[ei])/g, "g");

// Extrae la raíz léxica aproximada eliminando desinencias verbales y nominales comunes
function extractLexicalStem(word: string): string {
  const clean = stripDiacritics(word).replace(/^[^\\p{L}]+|[^\\p{L}]+$/gu, "");
  if (clean.length <= 3) return clean;
  const stripped = clean.replace(
    /(?:amiento|imiento|aciones|iciones|abamos|ieramos|aramos|asteis|isteis|aremos|eremos|iremos|arian|erian|irian|ando|iendo|aron|ieron|aban|ian|ando|adas|ados|idas|idos|arse|erse|irse|acion|icion|mente|anza|idad|ar|er|ir|as|es|os|an|en|in|on|ado|ido|aba|ia|ad|ed|id|s)$/u,
    ""
  );
  return stripped.length >= 3 ? stripped : clean.slice(0, Math.max(3, clean.length - 2));
}

export function findEpisodicHighlightRange(
  context: string,
  form: string,
  lemma?: string,
): { start: number; end: number } | null {
  const cleanForm = form.trim().replace(/^[.,;:!?¡¿"'«»([]—–-]+|[.,;:!?¡¿"'«»([]—–-]+$/g, "");
  const cleanLemma = lemma?.trim().replace(/^[.,;:!?¡¿"'«»([]—–-]+|[.,;:!?¡¿"'«»([]—–-]+$/g, "");
  const candidates = [cleanForm, cleanLemma, form.trim()].filter(
    (c): c is string => Boolean(c && c.length > 0),
  );
  if (!candidates.length) return null;

  // 1. Si el candidato es una locución (contiene espacios), buscar subcadena directa sin signos externos
  for (const cand of candidates) {
    if (/\\s/.test(cand)) {
      const idx = stripDiacritics(context).indexOf(stripDiacritics(cand));
      if (idx !== -1) return { start: idx, end: idx + cand.length };
    }
  }

  // Tokenizar palabras del pasaje respetando caracteres Unicode
  const tokens = Array.from(context.matchAll(/[\\p{L}\\p{M}]+/gu));

  // 2. Coincidencia exacta de token completo (case-insensitive)
  for (const cand of candidates) {
    const lowerCand = cand.toLowerCase();
    const exact = tokens.find((t) => t[0].toLowerCase() === lowerCand);
    if (exact && exact.index !== undefined) {
      return { start: exact.index, end: exact.index + exact[0].length };
    }
  }

  // 3. Coincidencia de token completo ignorando tildes/diacríticos
  for (const cand of candidates) {
    const normCand = stripDiacritics(cand);
    const match = tokens.find((t) => stripDiacritics(t[0]) === normCand);
    if (match && match.index !== undefined) {
      return { start: match.index, end: match.index + match[0].length };
    }
  }

  // 4. Buscador de raíz morfológica (lexical stem matcher) para formas conjugadas o flexionadas
  for (const cand of candidates) {
    const rawStem = extractLexicalStem(cand);
    const foldedStem = foldSpanishDiphthongs(rawStem);
    if (rawStem.length < 3) continue;

    for (const token of tokens) {
      const tokenText = token[0];
      const normToken = stripDiacritics(tokenText);
      const tokenStem = extractLexicalStem(tokenText);

      const matchesRawStem =
        normToken.startsWith(rawStem) ||
        (tokenStem.length >= 3 && (rawStem.startsWith(tokenStem) || tokenStem.startsWith(rawStem)));

      const foldedToken = foldSpanishDiphthongs(tokenText);
      const foldedTokenStem = foldSpanishDiphthongs(tokenStem);
      const matchesFoldedStem =
        foldedStem.length >= 3 &&
        (foldedToken.startsWith(foldedStem) ||
          (foldedTokenStem.length >= 3 &&
            (foldedStem.startsWith(foldedTokenStem) || foldedTokenStem.startsWith(foldedStem))));

      if (matchesRawStem || matchesFoldedStem) {
        return { start: token.index!, end: token.index! + tokenText.length };
      }
    }
  }

  // 5. Fallback final por subcadena si contiene caracteres no léxicos
  const fallbackIdx = context.toLowerCase().indexOf(cleanForm.toLowerCase());
  if (fallbackIdx !== -1 && cleanForm.length > 0) {
    return { start: fallbackIdx, end: fallbackIdx + cleanForm.length };
  }

  return null;
}

// Resalta la palabra (o su flexión morfológica) dentro del contexto del libro con estilo ámbar suave (Hueco 3.1)
export function renderHighlightedContext(
  context: string | null | undefined,
  form: string,
  lemma?: string,
) {
  if (!context) return null;
  if (!form || !form.trim()) return context;
  const range = findEpisodicHighlightRange(context, form, lemma);
  if (!range) return context;
  const before = context.slice(0, range.start);
  const match = context.slice(range.start, range.end);
  const after = context.slice(range.end);
  return (
    <>
      {before}
      <mark className="nb-word-quote-highlight">{match}</mark>
      {after}
    </>
  );
}`;

  let next = content.includes(oldBlock)
    ? content.replace(oldBlock, newBlock)
    : content.replace(oldBlockRegex, newBlock);

  // Actualizar llamadas y lecturas de stability en Vocabulary.tsx
  next = next.replace(
    `const s = card?.stability ?? 0;`,
    `const s = safeStability(card?.stability);`
  );
  next = next.replace(
    `const cardStability = word.card?.stability ?? 0;`,
    `const cardStability = safeStability(word.card?.stability);`
  );
  next = next.replace(
    `“{renderHighlightedContext(word.context, word.form)}”`,
    `“{renderHighlightedContext(word.context, word.form, word.lemma)}”`
  );
  next = next.replace(
    `<blockquote className="notebook-word-quote">
                  “{item.sentenceContext}”
                </blockquote>`,
    `<blockquote className="notebook-word-quote">
                  “{renderHighlightedContext(item.sentenceContext, item.word)}”
                </blockquote>`
  );

  return next;
});

// Sanitización defensiva en el motor FSRS (src/client/lib/fsrs.ts)
patchFile("src/client/lib/fsrs.ts", (content) => {
  if (content.includes("function sanitizeCard")) {
    return content;
  }
  return content.replace(
    `export function scheduleReview(
  card: Card | undefined,
  rating: Grade,
  now = new Date(),
  options?: { requestRetention?: number },
): Card {
  const current: Card = card ?? createEmptyCard(now);
  const retention = options?.requestRetention ?? requestRetentionFor();
  return schedulerFor(retention).next(current, now, rating).card;
}`,
    `function sanitizeCard(card: Card | undefined, now: Date): Card {
  if (!card || typeof card !== "object") return createEmptyCard(now);
  const empty = createEmptyCard(now);
  let stability =
    typeof card.stability === "number" && Number.isFinite(card.stability) && card.stability > 0
      ? card.stability
      : 0;
  let difficulty =
    typeof card.difficulty === "number" && Number.isFinite(card.difficulty) && card.difficulty > 0
      ? Math.min(10, Math.max(1, card.difficulty))
      : 0;
  if (stability === 0 || difficulty === 0) {
    stability = 0;
    difficulty = 0;
  }
  const reps =
    typeof card.reps === "number" && Number.isInteger(card.reps) && card.reps >= 0
      ? card.reps
      : empty.reps;
  const lapses =
    typeof card.lapses === "number" && Number.isInteger(card.lapses) && card.lapses >= 0
      ? card.lapses
      : empty.lapses;
  const state =
    stability === 0 && difficulty === 0
      ? 0
      : typeof card.state === "number" && [0, 1, 2, 3].includes(card.state)
        ? card.state
        : 1;
  return {
    ...empty,
    ...card,
    stability,
    difficulty,
    reps,
    lapses,
    state,
  };
}

export function scheduleReview(
  card: Card | undefined,
  rating: Grade,
  now = new Date(),
  options?: { requestRetention?: number },
): Card {
  const current: Card = sanitizeCard(card, now);
  const retention = options?.requestRetention ?? requestRetentionFor();
  return schedulerFor(retention).next(current, now, rating).card;
}`
  );
});

// ============================================================================
// 4. ACTUALIZACIÓN Y ADICIÓN DE TESTS UNITARIOS
// ============================================================================
// 4.a: src/shared/reading-data.test.ts (soporte y guardas de anchorOffset)
patchFile("src/shared/reading-data.test.ts", (content) => {
  let next = content.replace(
    `      anchor: "capítulo tres",
      updatedAt: 1_700_000_000_000,
    });`,
    `      anchor: "capítulo tres",
      anchorOffset: null,
      updatedAt: 1_700_000_000_000,
    });`
  );

  const newTest = `  it("conserva anchorOffset si es fracción válida y recorta a 0..1", () => {
    expect(cleanPosition({ ...validPosition, anchorOffset: 0.45 })?.anchorOffset).toBe(0.45);
    expect(cleanPosition({ ...validPosition, anchorOffset: 1.5 })?.anchorOffset).toBe(1);
    expect(cleanPosition({ ...validPosition, anchorOffset: -0.2 })?.anchorOffset).toBe(0);
    expect(cleanPosition({ ...validPosition, anchorOffset: "invalid" })?.anchorOffset).toBeNull();
  });
});`;

  if (!next.includes("conserva anchorOffset si es fracción válida")) {
    next = next.replace(`  });\n});`, `  });\n\n${newTest}`);
  }

  return next;
});

// 4.b: src/client/lib/fsrs.test.ts (tarjetas corruptas en scheduleReview)
patchFile("src/client/lib/fsrs.test.ts", (content) => {
  const testCase = `  it("defiende contra tarjetas corruptas con tipos y rangos inválidos", () => {
    const corruptCard = {
      stability: "not-a-number",
      difficulty: 999,
      reps: -5,
      lapses: "NaN",
    } as unknown as import("ts-fsrs").Card;
    const reviewed = scheduleReview(corruptCard, Rating.Good);
    expect(typeof reviewed.stability).toBe("number");
    expect(reviewed.stability).toBeGreaterThan(0);
    expect(reviewed.difficulty).toBeLessThanOrEqual(10);
    expect(reviewed.reps).toBeGreaterThanOrEqual(1);
  });
});`;

  if (!content.includes("defiende contra tarjetas corruptas")) {
    return content.replace(/\n\}\);\s*$/, `\n\n${testCase}\n`);
  }
  return content;
});

// 4.c: src/client/components/Vocabulary.test.ts (resalte morfológico y estabilidad)
patchFile("src/client/components/Vocabulary.test.ts", (content) => {
  const testBlock = `describe("Hueco 3.1 & 3.2 — Estabilidad y Resalte Morfológico", () => {
  it("safeStability y getStabilitySegments manejan valores corruptos", async () => {
    const { safeStability, getStabilitySegments } = await import("./Vocabulary");
    expect(safeStability(undefined)).toBe(0);
    expect(safeStability(NaN)).toBe(0);
    expect(safeStability(-5)).toBe(0);
    expect(safeStability("10")).toBe(0);
    expect(safeStability(15)).toBe(15);

    expect(getStabilitySegments(undefined)).toBe(0);
    expect(getStabilitySegments(NaN)).toBe(0);
    expect(getStabilitySegments(0.4)).toBe(0);
    expect(getStabilitySegments(1)).toBe(1);
    expect(getStabilitySegments(3)).toBe(2);
    expect(getStabilitySegments(8)).toBe(3);
    expect(getStabilitySegments(20)).toBe(4);
  });

  it("findEpisodicHighlightRange encuentra formas flexionadas y alternancias vocálicas", async () => {
    const { findEpisodicHighlightRange } = await import("./Vocabulary");
    const ctx = "Él pensó en ella mientras caminaba.";
    const range = findEpisodicHighlightRange(ctx, "pensar");
    expect(range).not.toBeNull();
    expect(ctx.slice(range!.start, range!.end)).toBe("pensó");

    const ctx2 = "Siempre duerme profundamente.";
    const range2 = findEpisodicHighlightRange(ctx2, "dormir");
    expect(range2).not.toBeNull();
    expect(ctx2.slice(range2!.start, range2!.end)).toBe("duerme");
  });
});
`;

  if (!content.includes("Hueco 3.1 & 3.2 — Estabilidad y Resalte Morfológico")) {
    return `${content}\n${testBlock}`;
  }
  return content;
});

// 4.d: src/client/lib/reading-location.test.ts (reflujo tardío de imágenes)
patchFile("src/client/lib/reading-location.test.ts", (content) => {
  const testCase = `  it("sigue re-estabilizando ante carga tardía de imágenes mientras no haya interacción humana", () => {
    vi.useFakeTimers();
    const el = block("P05 · Mano mano", 508, 208);
    const img = document.createElement("img");
    el.appendChild(img);
    const c = container(el);
    const unmount = mount(c);
    const env = setup({ scrollY: 122 });

    try {
      const stop = keepAnchorStable(c, "P05 · Mano mano", 0.5468, { durationMs: 50, mediaTimeoutMs: 1000 });
      vi.advanceTimersByTime(100);
      env.scrollTo.mockClear();

      img.dispatchEvent(new Event("load"));
      expect(env.scrollTo).toHaveBeenCalled();
      stop();
    } finally {
      vi.useRealTimers();
      env.restore();
      unmount();
    }
  });
});`;

  if (!content.includes("sigue re-estabilizando ante carga tardía de imágenes")) {
    return content.replace(/\n\}\);\s*$/, `\n\n${testCase}\n`);
  }
  return content;
});

// 4.e: docs/auditoria/claims.json (actualización de anclajes de línea tras código nuevo en Vocabulary.tsx)
patchFile("docs/auditoria/claims.json", (content) => {
  return content
    .replace(`"file": "src/client/components/Vocabulary.tsx",\n          "line": 1582,`, `"file": "src/client/components/Vocabulary.tsx",\n          "line": 1659,`)
    .replace(`"file": "src/client/components/Vocabulary.tsx",\n          "line": 1181,`, `"file": "src/client/components/Vocabulary.tsx",\n          "line": 1258,`)
    .replace(`"file": "src/client/components/Vocabulary.tsx",\n          "line": 444,`, `"file": "src/client/components/Vocabulary.tsx",\n          "line": 521,`);
});

console.log("\\n✅ Todos los parches de los Módulos 2 y 3 se han procesado.");
