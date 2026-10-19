import type { ReaderSettings } from './settings';
import { applyChapterMarks, clearChapterMarks } from './marks';
import { applyPhraseMarks, clearPhraseMarks, type PhraseEntry } from './phrases';
import { hyphenateWord } from './syllables';
import { applySyntacticLines, clearSyntacticLines } from './syntactic-lines';

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'CODE',
  'PRE',
  'SVG',
  'MATH',
  'NOSCRIPT',
  'TEXTAREA',
  'BUTTON',
]);

const BIONIC_CLASS = 'lecta-bionic';
const BIONIC_PROCESSED_ATTR = 'data-lecta-bionic';
const SYLLABLE_ATTR = 'data-lecta-syllables';
const WORD_RE = /(\p{L}+)/gu;

/**
 * Ejecuta una tarea en tiempo ocioso del navegador con fallback seguro para Safari/iOS.
 */
function scheduleIdleTask(cb: () => void, signal: AbortSignal): void {
  if (signal.aborted) return;
  const ric = (globalThis as unknown as {
    requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  }).requestIdleCallback;

  if (typeof ric === 'function') {
    const id = ric(
      () => {
        if (!signal.aborted) cb();
      },
      { timeout: 120 },
    );
    signal.addEventListener(
      'abort',
      () => {
        const cic = (globalThis as unknown as { cancelIdleCallback?: (id: number) => void })
          .cancelIdleCallback;
        cic?.(id);
      },
      { once: true },
    );
  } else {
    const timer = setTimeout(() => {
      if (!signal.aborted) cb();
    }, 16);
    signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  }
}

/**
 * Limpia en un solo barrido las transformaciones previas de sílabas y lectura biónica.
 */
export function clearInlineTypographyTransforms(doc: Document): void {
  if (!doc?.body) return;

  // 1. Revertir nodos biónicos a texto plano
  const bionicNodes = doc.querySelectorAll(`span.${BIONIC_CLASS}`);
  bionicNodes.forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    parent.replaceChild(doc.createTextNode(span.textContent || ''), span);
    parent.normalize();
  });

  // 2. Revertir separación silábica (·)
  const syllableNodes = doc.querySelectorAll(`[${SYLLABLE_ATTR}]`);
  syllableNodes.forEach((el) => {
    el.removeAttribute(SYLLABLE_ATTR);
  });

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.nodeValue && node.nodeValue.includes('·')) {
      node.nodeValue = node.nodeValue.replace(/·/g, '');
    }
    node = walker.nextNode() as Text | null;
  }

  doc.body.removeAttribute(BIONIC_PROCESSED_ATTR);
  doc.body.normalize();
}

/**
 * Aplica en un ÚNICO recorrido de TreeWalker tanto la separación silábica
 * como la Guía Visual de Sílabas (Lectura Biónica), evitando crear múltiples
 * reflujos de DOM sobre los mismos TextNodes.
 */
export function applyUnifiedTextTransforms(
  doc: Document,
  options: { syllableBreaks?: boolean; bionicReading?: boolean },
): void {
  if (!doc?.body) return;
  clearInlineTypographyTransforms(doc);

  const syllableBreaks = Boolean(options.syllableBreaks);
  const bionicReading = Boolean(options.bionicReading);
  if (!syllableBreaks && !bionicReading) return;

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`.${BIONIC_CLASS}, .lecta-bilingue-wrap`)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  let current = walker.nextNode() as Text | null;
  while (current) {
    textNodes.push(current);
    current = walker.nextNode() as Text | null;
  }

  for (const textNode of textNodes) {
    const raw = textNode.nodeValue;
    if (!raw) continue;

    // Si sólo está activa la división silábica, mutamos nodeValue in-place sin crear nodos DOM
    if (syllableBreaks && !bionicReading) {
      const nextValue = raw.replace(WORD_RE, (word) =>
        word.length >= 8 ? hyphenateWord(word) : word,
      );
      if (nextValue !== raw) {
        textNode.nodeValue = nextValue;
        textNode.parentElement?.setAttribute(SYLLABLE_ATTR, '1');
      }
      continue;
    }

    // Si está activa la Guía Visual (con o sin sílabas), construimos un único DocumentFragment
    WORD_RE.lastIndex = 0;
    if (!WORD_RE.test(raw)) continue;
    WORD_RE.lastIndex = 0;

    const frag = doc.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = WORD_RE.exec(raw)) !== null) {
      const word = match[0];
      const start = match.index;

      if (start > lastIndex) {
        frag.appendChild(doc.createTextNode(raw.slice(lastIndex, start)));
      }

      const processedWord =
        syllableBreaks && word.length >= 8 ? hyphenateWord(word) : word;

      if (processedWord.length <= 1) {
        frag.appendChild(doc.createTextNode(processedWord));
      } else {
        const boldLen = Math.max(1, Math.ceil(processedWord.length * 0.45));
        const wrapper = doc.createElement('span');
        wrapper.className = BIONIC_CLASS;
        const b = doc.createElement('b');
        b.textContent = processedWord.slice(0, boldLen);
        wrapper.appendChild(b);
        wrapper.appendChild(doc.createTextNode(processedWord.slice(boldLen)));
        frag.appendChild(wrapper);
      }

      lastIndex = start + word.length;
    }

    if (lastIndex < raw.length) {
      frag.appendChild(doc.createTextNode(raw.slice(lastIndex)));
    }

    if (syllableBreaks) {
      textNode.parentElement?.setAttribute(SYLLABLE_ATTR, '1');
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }

  if (bionicReading) {
    doc.body.setAttribute(BIONIC_PROCESSED_ATTR, '1');
  }
}

export interface DomPipelineInput {
  doc: Document;
  settings: Pick<
    ReaderSettings,
    'syllableBreaks' | 'syntacticLines' | 'bionicReading'
  >;
  phrases: PhraseEntry[];
  wordsToMark: Set<string>;
  savedWords: Set<string>;
}

/**
 * Orquesta todas las decoraciones del capítulo en dos fases no bloqueantes:
 * Fase 1 (Inmediata en rAF): Subrayado de palabras/locuciones para interacción táctil.
 * Fase 2 (Idle): Transformaciones tipográficas (sílabas, biónica, líneas sintácticas).
 */
export function runChapterDomPipeline(input: DomPipelineInput): () => void {
  const controller = new AbortController();
  const { signal } = controller;
  const { doc, settings, phrases, wordsToMark, savedWords } = input;

  const rafId = requestAnimationFrame(() => {
    if (signal.aborted || !doc?.body) return;

    // Limpiar marcas previas antes de re-aplicar
    clearPhraseMarks(doc);
    clearChapterMarks(doc);

    if (phrases.length > 0) {
      applyPhraseMarks(doc, phrases);
    }
    if (wordsToMark.size > 0 || savedWords.size > 0) {
      applyChapterMarks(doc, wordsToMark, savedWords);
    }

    // Fase 2 en Idle: transformaciones de lectura asistida
    scheduleIdleTask(() => {
      if (signal.aborted || !doc?.body) return;

      clearSyntacticLines(doc);
      if (settings.syntacticLines) {
        applySyntacticLines(doc);
      }

      applyUnifiedTextTransforms(doc, {
        syllableBreaks: settings.syllableBreaks,
        bionicReading: settings.bionicReading,
      });
    }, signal);
  });

  return () => {
    controller.abort();
    cancelAnimationFrame(rafId);
  };
}
