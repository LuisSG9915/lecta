// «Líneas sintácticas»: reformatea los párrafos del libro en
// unidades con sentido — cada corte cae tras puntuación o antes de
// un conector, así la longitud variable de las líneas acompaña las
// fijaciones sacádicas en lugar de depender del ancho de columna.
// Envuelve cada unidad en <span class="syn-line"> (display:block);
// quitar el modo desenrolla esos spans sin perder marcas ni notas.

import { isStopword } from "../../shared/stopwords";

export const SYNTACTIC_LINE_CLASS = "syn-line";
export const SYNTACTIC_CHUNK_CLASS = "lecta-syntactic-chunk";
export const FIXATION_ANCHOR_CLASS = "lecta-fixation-anchor";
export const BIONIC_ANCHOR_CLASS = "lecta-bionic-anchor";
export const BIONIC_WORD_CLASS = "lecta-bionic-word";
export const BIONIC_REST_CLASS = "lecta-bionic-rest";
export const SYNTACTIC_LINE_LEGACY_CLASS = "lecta-syntactic-line";

export interface SyntacticLinesOptions {
  chromaticGuide?: boolean;
  syntacticLines?: boolean;
  bionicAnchors?: boolean;
}

// Contenido que nunca se reparte: no es prosa o ya está intervenido.
const SKIP_INSIDE =
  "pre, code, script, style, img, image, svg, video, table, form, input";
// Zonas ajenas al texto del libro: la tarjeta «Antes de leer» vive
// dentro del contenedor (portal) y no debe reformatarse.
const SKIP_ANCESTOR = `.${SYNTACTIC_LINE_CLASS}, .section-preview-slot`;

// Puntuación por fuerza de corte: la fuerte parte siempre; la media
// y la débil solo si la línea acumulada ya tiene cuerpo; un conector
// parte antes de sí mismo solo con la misma condición.
const STRONG = ".!?…";
const MEDIUM = ":;—–";
const WEAK = ",·";
// Cierres pegados a un signo fuerte (». ”) ) pertenecen a ese corte.
const CLOSERS = "»”\")]";
const CONNECTOR =
  /^(que|del|de|y|e|o|u|ni|pero|mas|sino|porque|pues|como|cuando|donde|aunque|aun|si|mientras|entonces|además|también|tampoco|siquiera|así|ya|con|sin|para|por|hasta|desde|hacia|sobre|tras|entre|según)\b/i;

const MIN_BEFORE_CONNECTOR = 30;
const MIN_BEFORE_MEDIUM = 30;
const MIN_BEFORE_WEAK = 45;
// Un corte que deja un fragmento diminuto a cualquier lado se retira.
const MIN_SEGMENT = 16;

// Posiciones de corte dentro de `text` (índices entre 1 y len-1).
// Pura: la usa el reparto del DOM y las pruebas.
export function syntacticBreaks(text: string): number[] {
  const out: number[] = [];
  const n = text.length;
  let segStart = 0;
  let i = 0;
  while (i < n) {
    if (!/\s/.test(text[i])) {
      i += 1;
      continue;
    }
    // j = primer carácter no blanco tras el espacio: el corte cae ahí
    // para que ninguna línea empiece con espacios.
    let j = i;
    while (j < n && /\s/.test(text[j])) j += 1;
    if (j < n) {
      // Ancla del corte: el último carácter de contenido antes del
      // espacio, saltando cierres pegados (». se cuenta como .).
      let k = i - 1;
      while (k >= 0 && CLOSERS.includes(text[k])) k -= 1;
      const anchor = k >= 0 ? text[k] : "";
      const prev = i > 0 ? text[i - 1] : "";
      const word = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/u.exec(text.slice(j))?.[0] ?? "";
      const segLen = j - segStart;
      if (
        STRONG.includes(anchor) ||
        (MEDIUM.includes(prev) && segLen >= MIN_BEFORE_MEDIUM) ||
        (WEAK.includes(prev) && segLen >= MIN_BEFORE_WEAK) ||
        (CONNECTOR.test(word) && segLen >= MIN_BEFORE_CONNECTOR)
      ) {
        out.push(j);
        segStart = j;
      }
    }
    i = j;
  }
  // Segunda pasada codiciosa: un corte se acepta si deja cuerpo a
  // ambos lados — contra el último corte ACEPTADO y el siguiente
  // candidato crudo. Así los cortes densos no se anulan entre sí:
  // queda el último del grupo (los límites de oración mandan).
  const kept: number[] = [];
  let last = 0;
  for (let idx = 0; idx < out.length; idx += 1) {
    const pos = out[idx];
    const nextEnd = idx + 1 < out.length ? out[idx + 1] : n;
    if (pos - last < MIN_SEGMENT || nextEnd - pos < MIN_SEGMENT) continue;
    kept.push(pos);
    last = pos;
  }
  return kept;
}

// El párrafo en unidades de línea, útil para pruebas y diagnóstico.
export function syntacticSegments(text: string): string[] {
  const breaks = syntacticBreaks(text);
  const out: string[] = [];
  let start = 0;
  for (const pos of breaks) {
    out.push(text.slice(start, pos));
    start = pos;
  }
  out.push(text.slice(start));
  return out.map((seg) => seg.trim()).filter(Boolean);
}

// Conectores complejos para fijaciones sacádicas
export const COMPLEX_CONNECTORS =
  /\b(sin embargo|no obstante|por consiguiente|por lo tanto|por tanto|en consecuencia|de modo que|así que|a pesar de|en cambio)\b/gi;

// Desenrolla las líneas y anclajes: cada span devuelve sus hijos al flujo
// y el normalize vuelve a unir el texto (las marcas <mark> se conservan).
export function clearSyntacticLines(root: ParentNode) {
  root.querySelectorAll(`.${BIONIC_WORD_CLASS}`).forEach((span) => {
    span.replaceWith(...span.childNodes);
  });
  root.querySelectorAll(`.${BIONIC_REST_CLASS}`).forEach((span) => {
    span.replaceWith(...span.childNodes);
  });
  root.querySelectorAll(`.${FIXATION_ANCHOR_CLASS}, .${BIONIC_ANCHOR_CLASS}, .lecta-anchor`).forEach((span) => {
    span.replaceWith(...span.childNodes);
  });
  root.querySelectorAll(`[data-connector="true"]`).forEach((span) => {
    span.replaceWith(...span.childNodes);
  });
  root.querySelectorAll(`.${SYNTACTIC_LINE_CLASS}`).forEach((span) => {
    span.replaceWith(...span.childNodes);
  });
  root.querySelectorAll(`.${SYNTACTIC_CHUNK_CLASS}`).forEach((span) => {
    span.replaceWith(...span.childNodes);
  });
  root.querySelectorAll(`.${SYNTACTIC_LINE_LEGACY_CLASS}`).forEach((span) => {
    span.replaceWith(...span.childNodes);
  });
  if (root instanceof Element || root instanceof DocumentFragment)
    root.normalize();
}

function applyBionicAnchorsToTextNode(tNode: Text) {
  const val = tNode.nodeValue;
  if (!val || val.length < 3) return;
  const WORD_RE = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+/gu;
  let match: RegExpExecArray | null;
  let lastIdx = 0;
  let hasAnchor = false;
  const frag = document.createDocumentFragment();

  while ((match = WORD_RE.exec(val)) !== null) {
    const word = match[0];
    if (word.length >= 3 && !isStopword(word, "es")) {
      hasAnchor = true;
      if (match.index > lastIdx) {
        frag.appendChild(document.createTextNode(val.slice(lastIdx, match.index)));
      }
      const anchorLen = word.length <= 3 ? 1 : word.length <= 6 ? 2 : 3;
      const wordSpan = document.createElement("span");
      wordSpan.className = BIONIC_WORD_CLASS;

      const anchorSpan = document.createElement("span");
      anchorSpan.className = `${FIXATION_ANCHOR_CLASS} ${BIONIC_ANCHOR_CLASS} lecta-anchor`;
      anchorSpan.textContent = word.slice(0, anchorLen);
      wordSpan.appendChild(anchorSpan);

      const restSpan = document.createElement("span");
      restSpan.className = BIONIC_REST_CLASS;
      restSpan.textContent = word.slice(anchorLen);
      wordSpan.appendChild(restSpan);

      frag.appendChild(wordSpan);
      lastIdx = match.index + word.length;
    }
  }
  if (!hasAnchor) return;
  if (lastIdx < val.length) {
    frag.appendChild(document.createTextNode(val.slice(lastIdx)));
  }
  tNode.replaceWith(frag);
}

function applyBionicToElement(container: Element) {
  const textNodes: Text[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (
        el.tagName.toLowerCase() === "mark" ||
        el.getAttribute("data-connector") === "true" ||
        el.classList.contains(FIXATION_ANCHOR_CLASS) ||
        el.classList.contains(BIONIC_ANCHOR_CLASS) ||
        el.classList.contains(BIONIC_WORD_CLASS)
      ) {
        return;
      }
      for (const child of el.childNodes) {
        walk(child);
      }
    } else if (node.nodeType === Node.TEXT_NODE && node.nodeValue?.trim()) {
      textNodes.push(node as Text);
    }
  };
  for (const child of container.childNodes) {
    walk(child);
  }
  for (const t of textNodes) {
    applyBionicAnchorsToTextNode(t);
  }
}

// Envuelve cada párrafo en líneas sintácticas o tramos cromáticos. Idempotente:
// primero limpia un reparto anterior. Solo corta dentro de nodos de texto directos
// del párrafo — ningún elemento anidado como <mark> queda rasgado entre líneas.
export function applySyntacticLines(
  root: ParentNode,
  options?: SyntacticLinesOptions,
) {
  clearSyntacticLines(root);

  const enableSyntactic = options?.syntacticLines ?? true;
  const enableChromatic = options?.chromaticGuide ?? false;
  const enableBionic = options?.bionicAnchors ?? false;

  if (!enableSyntactic && !enableChromatic && !enableBionic) return;

  let globalChunkCycle = 0;

  root.querySelectorAll("p, li").forEach((el) => {
    if (el.closest(SKIP_ANCESTOR) || el.querySelector(SKIP_INSIDE)) return;

    // Nodos de texto directos con su rango en el plano concatenado.
    const nodes: { node: Text; start: number; end: number }[] = [];
    let flat = "";
    for (const child of el.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const start = flat.length;
      flat += child.nodeValue ?? "";
      nodes.push({ node: child as Text, start, end: flat.length });
    }
    if (!flat.trim()) return;

    const breaks = syntacticBreaks(flat);

    if (enableSyntactic) {
      if (breaks.length > 0) {
        const starters = new Set<Node>([el.firstChild as Node]);
        for (const pos of breaks) {
          const boundary = nodes.find((t) => pos === t.start);
          if (boundary) {
            starters.add(boundary.node);
            continue;
          }
          const hit = nodes.find((t) => pos > t.start && pos < t.end);
          if (!hit) continue;
          const tail = hit.node.splitText(pos - hit.start);
          nodes.splice(
            nodes.indexOf(hit),
            1,
            { node: hit.node, start: hit.start, end: pos },
            { node: tail, start: pos, end: hit.end },
          );
          starters.add(tail);
        }

        let span: HTMLSpanElement | null = null;
        for (const child of [...el.childNodes]) {
          if (starters.has(child) || !span) {
            span = document.createElement("span");
            span.className = `${SYNTACTIC_LINE_CLASS} ${SYNTACTIC_CHUNK_CLASS} ${SYNTACTIC_LINE_LEGACY_CLASS}`;
            if (enableChromatic) {
              span.dataset.chunkCycle = String(globalChunkCycle % 4);
              globalChunkCycle++;
            }
            el.insertBefore(span, child);
          }
          span.appendChild(child);
        }
      } else {
        const span = document.createElement("span");
        span.className = `${SYNTACTIC_LINE_CLASS} ${SYNTACTIC_CHUNK_CLASS} ${SYNTACTIC_LINE_LEGACY_CLASS}`;
        if (enableChromatic) {
          span.dataset.chunkCycle = String(globalChunkCycle % 4);
          globalChunkCycle++;
        }
        while (el.firstChild) {
          span.appendChild(el.firstChild);
        }
        el.appendChild(span);
      }

      // Decoración sintáctica: cascada para subordinadas, respiración rítmica y conectores complejos
      const spans = el.querySelectorAll<HTMLSpanElement>(`.${SYNTACTIC_LINE_CLASS}`);
      let prevEndsWithStrong = false;
      spans.forEach((s, idx) => {
        const text = s.textContent?.trim() ?? "";
        if (idx > 0 && !prevEndsWithStrong && CONNECTOR.test(text)) {
          s.dataset.sub = "true";
        } else if (idx > 0 && prevEndsWithStrong) {
          s.dataset.newSentence = "true";
        }
        const rawText = s.textContent ?? "";
        const trimmedEnd = rawText.trimEnd();
        const lastChar = trimmedEnd.length > 0 ? trimmedEnd[trimmedEnd.length - 1] : "";
        prevEndsWithStrong = STRONG.includes(lastChar);

        // Identificar conectores complejos en nodos de texto directos para fijación sacádica
        const textNodes: Text[] = [];
        for (const child of s.childNodes) {
          if (child.nodeType === Node.TEXT_NODE && child.nodeValue) {
            textNodes.push(child as Text);
          }
        }
        for (const tNode of textNodes) {
          const val = tNode.nodeValue;
          if (!val) continue;
          COMPLEX_CONNECTORS.lastIndex = 0;
          if (!COMPLEX_CONNECTORS.test(val)) continue;
          COMPLEX_CONNECTORS.lastIndex = 0;

          const frag = document.createDocumentFragment();
          let lastIdx = 0;
          let match: RegExpExecArray | null;
          while ((match = COMPLEX_CONNECTORS.exec(val)) !== null) {
            if (match.index > lastIdx) {
              frag.appendChild(document.createTextNode(val.slice(lastIdx, match.index)));
            }
            const cSpan = document.createElement("span");
            cSpan.dataset.connector = "true";
            cSpan.textContent = match[0];
            frag.appendChild(cSpan);
            lastIdx = match.index + match[0].length;
          }
          if (lastIdx < val.length) {
            frag.appendChild(document.createTextNode(val.slice(lastIdx)));
          }
          tNode.replaceWith(frag);
        }

        if (enableBionic) {
          applyBionicToElement(s);
        }
      });
    } else if (enableChromatic) {
      // syntacticLines: false pero chromaticGuide: true -> agrupar inline
      if (breaks.length > 0) {
        const starters = new Set<Node>([el.firstChild as Node]);
        for (const pos of breaks) {
          const boundary = nodes.find((t) => pos === t.start);
          if (boundary) {
            starters.add(boundary.node);
            continue;
          }
          const hit = nodes.find((t) => pos > t.start && pos < t.end);
          if (!hit) continue;
          const tail = hit.node.splitText(pos - hit.start);
          nodes.splice(
            nodes.indexOf(hit),
            1,
            { node: hit.node, start: hit.start, end: pos },
            { node: tail, start: pos, end: hit.end },
          );
          starters.add(tail);
        }

        let span: HTMLSpanElement | null = null;
        for (const child of [...el.childNodes]) {
          if (starters.has(child) || !span) {
            span = document.createElement("span");
            span.className = `${SYNTACTIC_CHUNK_CLASS} ${SYNTACTIC_LINE_LEGACY_CLASS}`;
            span.dataset.chunkCycle = String(globalChunkCycle % 4);
            span.dataset.inline = "true";
            globalChunkCycle++;
            el.insertBefore(span, child);
          }
          span.appendChild(child);
        }
      } else {
        const span = document.createElement("span");
        span.className = `${SYNTACTIC_CHUNK_CLASS} ${SYNTACTIC_LINE_LEGACY_CLASS}`;
        span.dataset.chunkCycle = String(globalChunkCycle % 4);
        span.dataset.inline = "true";
        globalChunkCycle++;
        while (el.firstChild) {
          span.appendChild(el.firstChild);
        }
        el.appendChild(span);
      }

      if (enableBionic) {
        applyBionicToElement(el);
      }
    } else if (enableBionic) {
      // Solo bionicAnchors sin syntacticLines ni chromaticGuide
      applyBionicToElement(el);
    }
  });
}

/**
 * Divide una oración en 4 a 6 fragmentos con sentido gramatical (chunks sintácticos).
 * Pega la puntuación a cada fragmento para que el usuario arme estructuras literarias
 * en vez de adivinar signos o lidiar con demasiados botones individuales.
 */
export function splitSentenceIntoSyntacticChunks(sentence: string): string[] {
  const clean = sentence.trim().replace(/\s+/g, " ");
  if (!clean) return [];

  const words = clean.split(" ").filter(Boolean);
  if (words.length <= 5) {
    return words;
  }

  // Objetivo: entre 4 y 6 fragmentos con sentido
  const targetChunks = Math.min(6, Math.max(4, Math.round(words.length / 3)));
  const n = words.length;

  // Evaluar posibles puntos de corte (índices entre 1 y n - 1)
  const cutScores = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const prev = words[i - 1];
    const curr = words[i].replace(/[^\p{L}\p{N}]/gu, "");
    if (/[,;:—–.!?]/.test(prev)) {
      cutScores[i] += 12;
    }
    if (CONNECTOR.test(curr)) {
      cutScores[i] += 6;
    }
    if (
      /^(el|la|los|las|un|una|unos|unas|este|esta|estos|estas|aquel|aquella|aquellos|aquellas)$/i.test(
        curr,
      )
    ) {
      cutScores[i] += 4;
    }
  }

  // Programación dinámica para encontrar la partición óptima en targetChunks
  const dp: number[][] = Array.from({ length: targetChunks + 1 }, () =>
    new Array(n + 1).fill(-Infinity),
  );
  const parent: number[][] = Array.from({ length: targetChunks + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  dp[0][0] = 0;
  const idealLen = n / targetChunks;

  for (let k = 1; k <= targetChunks; k++) {
    for (let i = k; i <= n; i++) {
      for (let j = k - 1; j < i; j++) {
        if (dp[k - 1][j] === -Infinity) continue;
        const len = i - j;
        let score = -2 * Math.pow(len - idealLen, 2);
        if (j > 0) {
          score += cutScores[j];
        }
        if (len < 2 && n >= targetChunks * 2) {
          score -= 40;
        }
        const total = dp[k - 1][j] + score;
        if (total > dp[k][i]) {
          dp[k][i] = total;
          parent[k][i] = j;
        }
      }
    }
  }

  // Reconstruir los cortes
  const cuts: number[] = [];
  let currIdx = n;
  for (let k = targetChunks; k >= 1; k--) {
    const prevIdx = parent[k][currIdx];
    cuts.unshift(prevIdx);
    currIdx = prevIdx;
  }

  // Si falló por alguna razón atípica, dividir uniformemente
  if (cuts.length !== targetChunks || cuts[0] !== 0) {
    const uniformChunks: string[] = [];
    const step = Math.ceil(n / targetChunks);
    for (let i = 0; i < n; i += step) {
      uniformChunks.push(words.slice(i, i + step).join(" "));
    }
    return uniformChunks;
  }

  const chunks: string[] = [];
  for (let k = 0; k < targetChunks; k++) {
    const start = cuts[k];
    const end = k + 1 < targetChunks ? cuts[k + 1] : n;
    chunks.push(words.slice(start, end).join(" "));
  }

  return chunks.filter(Boolean);
}
