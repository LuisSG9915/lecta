// Plantillas HTML generadas en servidor para la interfaz Kindle / E-ink de Lecta.
// Cero JavaScript en el cliente, alto contraste, objetivos táctiles amplios
// y tipografía optimizada para pantallas de tinta electrónica.

import type { LexiconEntryView } from "../lexicon";
import type { KindlePrimingWord } from "./epub-reader";
import { isHashLikeIdentifier } from "../../shared/epub-meta";

export type KindleUser = {
  id: string;
  email: string;
  name?: string | null;
};

export type KindleBookItem = {
  hash: string;
  title: string;
  author: string;
  sections: number;
  currentSection?: number | null;
  currentPage?: number | null;
  progressPercent?: number | null;
};

export type PageWordItem = {
  form: string;
  saved: boolean;
};

export type InlineLookupResult = {
  word: string;
  entries: LexiconEntryView[] | null;
  saved?: boolean;
};

export type PrepWordItem = {
  form: string;
  lemma: string;
  pos: string | null;
  meaning: string;
  exampleSentence?: string | null;
  saved: boolean;
  zipf?: number | null;
};

export type CatPageNoteItem = {
  form: string;
  lemma: string;
  pos: string | null;
  meaning: string;
  noteIndex: number;
  saved: boolean;
  known?: boolean;
};

export type PracticeQuestionItem = {
  word: string;
  lemma: string;
  pos: string | null;
  options: { key: "A" | "B" | "C"; text: string; correct: boolean }[];
  questionIndex: number;
  totalQuestions: number;
};

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderKindleCatSvg(mood: string, equippedItems: string[] = []): string {
  const isHappy = mood === "happy" || mood === "celebrating";
  const isCurious = mood === "curious";
  const isReading = mood === "reading";
  const hasScarf = equippedItems.some((i) => i.toLowerCase().includes("scarf"));

  // Expresión de los ojos (trazo limpio de tinta electrónica)
  let eyesSvg: string;
  if (isHappy) {
    eyesSvg = `
      <path d="M28 38 Q33 33 38 38" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" />
      <path d="M42 38 Q47 33 52 38" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" />
    `;
  } else if (isReading) {
    eyesSvg = `
      <path d="M28 37 Q33 42 38 39" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" />
      <path d="M42 39 Q47 42 52 37" fill="none" stroke="#000000" stroke-width="2.5" stroke-linecap="round" />
    `;
  } else if (isCurious) {
    eyesSvg = `
      <circle cx="33" cy="37" r="4.5" fill="#000000" />
      <circle cx="47" cy="37" r="3" fill="#000000" />
    `;
  } else {
    eyesSvg = `
      <circle cx="33" cy="37" r="3.5" fill="#000000" />
      <circle cx="47" cy="37" r="3.5" fill="#000000" />
    `;
  }

  const mouthSvg = isHappy
    ? `<path d="M36 45 Q38 48 40 45 Q42 48 44 45" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" />`
    : `<path d="M37 45 Q40 47 43 45" fill="none" stroke="#000000" stroke-width="2" stroke-linecap="round" />`;

  let scarfSvg = "";
  if (hasScarf) {
    scarfSvg = `
      <!-- Bufanda Kindle -->
      <path d="M26 53 Q40 58 54 53 L53 61 Q40 66 27 61 Z" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <path d="M43 60 L43 74 L50 74 L50 59 Z" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <line x1="43" y1="64" x2="50" y2="64" stroke="#000000" stroke-width="1.5" />
      <line x1="43" y1="68" x2="50" y2="68" stroke="#000000" stroke-width="1.5" />
      <line x1="43" y1="72" x2="50" y2="72" stroke="#000000" stroke-width="1.5" />
      <line x1="32" y1="56" x2="35" y2="60" stroke="#000000" stroke-width="1.5" />
      <line x1="37" y1="57" x2="40" y2="61" stroke="#000000" stroke-width="1.5" />
    `;
  }

  let extraSvg = "";
  if (isReading) {
    extraSvg = `
      <!-- Libro abierto en regazo -->
      <path d="M28 66 L40 63 L52 66 L52 74 L40 71 L28 74 Z" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <line x1="40" y1="63" x2="40" y2="71" stroke="#000000" stroke-width="2" />
      <line x1="31" y1="68" x2="37" y2="67" stroke="#000000" stroke-width="1.5" />
      <line x1="43" y1="67" x2="49" y2="68" stroke="#000000" stroke-width="1.5" />
    `;
  } else if (mood === "celebrating") {
    extraSvg = `
      <!-- Destellos de celebración -->
      <path d="M16 22 L18 16 L20 22 L26 24 L20 26 L18 32 L16 26 L10 24 Z" fill="#000000" />
      <path d="M60 20 L62 15 L64 20 L69 22 L64 24 L62 29 L60 24 L55 22 Z" fill="#000000" />
    `;
  }

  return `
    <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Gato Lecta (${escapeHtml(mood)})" role="img">
      <!-- Orejas -->
      <polygon points="22,32 15,14 34,22" fill="#ffffff" stroke="#000000" stroke-width="2" stroke-linejoin="round" />
      <polygon points="58,32 65,14 46,22" fill="#ffffff" stroke="#000000" stroke-width="2" stroke-linejoin="round" />
      <!-- Cabeza -->
      <ellipse cx="40" cy="38" rx="22" ry="19" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <!-- Ojos -->
      ${eyesSvg}
      <!-- Nariz -->
      <polygon points="38,42 42,42 40,44" fill="#000000" stroke="#000000" stroke-width="1" />
      <!-- Boca -->
      ${mouthSvg}
      <!-- Bigotes -->
      <line x1="16" y1="39" x2="27" y2="40" stroke="#000000" stroke-width="1.5" />
      <line x1="15" y1="44" x2="26" y2="43" stroke="#000000" stroke-width="1.5" />
      <line x1="64" y1="39" x2="53" y2="40" stroke="#000000" stroke-width="1.5" />
      <line x1="65" y1="44" x2="54" y2="43" stroke="#000000" stroke-width="1.5" />
      <!-- Cuerpo / Pecho -->
      <path d="M25 54 Q40 56 55 54 L58 75 Q40 78 22 75 Z" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <!-- Patitas -->
      <ellipse cx="32" cy="74" rx="5" ry="3" fill="#ffffff" stroke="#000000" stroke-width="2" />
      <ellipse cx="48" cy="74" rx="5" ry="3" fill="#ffffff" stroke="#000000" stroke-width="2" />
      ${scarfSvg}
      ${extraSvg}
    </svg>
  `.trim();
}

const KINDLE_CSS = `
  *, *:before, *:after {
    box-sizing: border-box;
    transition: none !important;
    animation: none !important;
    box-shadow: none !important;
    background-image: none !important;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #000000;
    font-family: Georgia, "Bookerly", "Amazon Ember", serif;
    font-size: 19px;
    line-height: 1.6;
    -webkit-text-size-adjust: 100%;
  }
  .container {
    max-width: 720px;
    margin: 0 auto;
    padding: 14px 16px;
  }
  header.top-bar {
    border-bottom: 2px solid #000000;
    padding-bottom: 10px;
    margin-bottom: 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .brand {
    font-size: 1.4rem;
    font-weight: bold;
    text-decoration: none;
    color: #000000;
    letter-spacing: -0.5px;
  }
  .nav-links a {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    border: 1.5px solid #000000;
    text-decoration: none;
    color: #000000;
    font-size: 0.95rem;
    margin-left: 4px;
    background: #ffffff;
    min-height: 44px;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 16px;
    border: 2px solid #000000;
    background: #ffffff;
    color: #000000;
    text-decoration: none;
    font-weight: bold;
    font-size: 1rem;
    cursor: pointer;
    text-align: center;
    min-height: 52px;
    line-height: 1.2;
    box-sizing: border-box;
  }
  .btn-primary {
    background: #000000;
    color: #ffffff;
  }
  .btn-sm {
    padding: 6px 12px;
    font-size: 0.9rem;
    min-height: 44px;
  }
  .btn:disabled, .btn.disabled {
    border-color: #888888;
    color: #888888;
    cursor: not-allowed;
    background: #f4f4f4;
  }
  .card {
    border: 2px solid #000000;
    padding: 16px;
    margin-bottom: 16px;
    background: #ffffff;
  }
  .form-group {
    margin-bottom: 14px;
  }
  .form-group label {
    display: block;
    font-weight: bold;
    margin-bottom: 6px;
  }
  .form-control {
    width: 100%;
    padding: 10px 12px;
    font-size: 1.05rem;
    border: 2px solid #000000;
    background: #ffffff;
    color: #000000;
    font-family: inherit;
  }
  .alert {
    border: 2px solid #000000;
    padding: 12px 14px;
    margin-bottom: 16px;
    font-weight: bold;
  }
  .alert-error {
    background: #000000;
    color: #ffffff;
  }
  .alert-success {
    background: #f0f0f0;
    border-style: dashed;
  }
  /* Lector */
  .reader-meta {
    border-bottom: 1px solid #000000;
    padding-bottom: 8px;
    margin-bottom: 16px;
    font-size: 0.95rem;
  }
  .reader-title {
    font-size: 1.15rem;
    font-weight: bold;
    margin: 0;
  }
  .reader-author {
    font-style: italic;
    color: #444444;
  }
  .chapter-heading {
    font-size: 1.5rem;
    margin: 1.2rem 0 1rem;
    text-align: center;
  }
  .epub-content {
    font-size: 1.18rem;
    line-height: 1.58;
    text-align: justify;
    text-justify: inter-word;
    word-break: break-word;
    hyphens: auto;
    -webkit-hyphens: auto;
  }
  .epub-content p {
    margin: 0;
    text-indent: 1.35em;
  }
  .epub-content > p:first-of-type,
  .epub-content h1 + p,
  .epub-content h2 + p,
  .epub-content h3 + p,
  .epub-content hr + p {
    text-indent: 0;
  }
  .epub-content img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 14px auto;
    filter: grayscale(100%);
  }
  .pagination-nav {
    border-top: 2px solid #000000;
    margin-top: 22px;
    padding-top: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .pagination-nav-top {
    border-top: none;
    border-bottom: 1px solid #000000;
    margin-top: 0;
    margin-bottom: 16px;
    padding-top: 0;
    padding-bottom: 10px;
  }
  .pagination-info {
    font-weight: bold;
    font-size: 0.95rem;
    text-align: center;
    flex-grow: 1;
  }
  /* Enlaces de palabras interactivas */
  a.w {
    color: inherit;
    text-decoration: none;
    cursor: pointer;
  }
  a.w:hover, a.w:active {
    background-color: #dcdcdc;
  }
  a.w.saved {
    border-bottom: 1px dotted #444444;
  }
  /* Sección de vocabulario de la página */
  .page-vocab-box {
    margin-top: 22px;
    padding: 12px 14px;
    border: 2px solid #000000;
    background: #fafafa;
  }
  .page-vocab-title {
    font-size: 1rem;
    font-weight: bold;
    margin: 0 0 10px 0;
    padding-bottom: 4px;
    border-bottom: 1px solid #000000;
  }
  .page-vocab-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .vocab-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid #000000;
    background: #ffffff;
    font-size: 0.9rem;
    line-height: 1.2;
  }
  .vocab-chip.saved {
    background: #e8e8e8;
    border-style: dashed;
  }
  .vocab-chip a.vocab-link {
    color: #000000;
    text-decoration: underline;
  }
  .vocab-inline-form {
    display: inline;
    margin: 0;
    padding: 0;
  }
  .btn-xs {
    padding: 3px 8px;
    font-size: 0.8rem;
    min-height: 28px;
    line-height: 1.2;
    border: 1px solid #000000;
    background: #000000;
    color: #ffffff;
    cursor: pointer;
    font-weight: bold;
  }
  .quick-lookup-box {
    margin-top: 24px;
    padding: 14px;
    border: 2px solid #000000;
    background: #fbfbfb;
  }
  .quick-lookup-form {
    display: flex;
    gap: 8px;
  }
  .quick-lookup-form input {
    flex-grow: 1;
  }
  /* Diccionario */
  .sense-list {
    margin: 10px 0 16px 20px;
    padding: 0;
  }
  .sense-item {
    margin-bottom: 10px;
  }
  .sense-example {
    font-style: italic;
    color: #444444;
    display: block;
    margin-top: 4px;
  }
  footer.footer-bar {
    margin-top: 40px;
    border-top: 1px solid #888888;
    padding-top: 12px;
    font-size: 0.85rem;
    text-align: center;
    color: #444444;
  }
  /* Lector dedicado E-ink */
  .reader-body {
    background: #ffffff;
    color: #000000;
  }
  .reader-container {
    max-width: 660px;
    margin: 0 auto;
    box-sizing: border-box;
    padding: 8px 14px;
  }
  /* Layout paged (1-pantalla Zero-Scroll para Kindle E-ink) */
  body.layout-paged {
    height: 100vh;
    max-height: 100vh;
    overflow: hidden;
  }
  body.layout-paged .reader-container {
    height: 100vh;
    max-height: 100vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  body.layout-paged .epub-content {
    flex: 1 1 auto;
    overflow: hidden;
    margin: 0;
  }
  /* Layout scroll (lectura continua opcional) */
  body.layout-scroll {
    height: auto;
    overflow-y: auto;
  }
  body.layout-scroll .reader-container {
    height: auto;
    max-height: none;
    overflow-y: auto;
    padding: 8px 14px 24px 14px;
  }

  /* Barra superior compacta (<= 36px) */
  .reader-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    height: 32px;
    max-height: 32px;
    min-height: 32px;
    padding: 0 0 2px 0;
    border-bottom: 1px solid #dcdcdc;
    margin-bottom: 4px;
    font-size: 0.8rem;
    line-height: 1.2;
    color: #444444;
    overflow: hidden;
  }
  .reader-header-left {
    display: flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }
  .reader-back-btn {
    display: inline-block;
    color: #222222;
    text-decoration: none;
    font-size: 0.8rem;
    white-space: nowrap;
  }
  .reader-back-btn:hover {
    text-decoration: underline;
  }
  .lookup-btn {
    display: inline-block;
    background: #ffffff;
    border: 1px solid #666666;
    color: #111111;
    font-size: 0.74rem;
    padding: 2px 5px;
    cursor: pointer;
    line-height: 1.2;
    border-radius: 0;
    font-family: inherit;
  }
  .lookup-btn.is-active {
    background: #000000;
    color: #ffffff;
    border-color: #000000;
  }
  .reader-header-info {
    flex-grow: 1;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 4px;
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .reader-header-title {
    font-weight: bold;
    color: #111111;
  }
  .reader-header-sep {
    margin: 0 3px;
    color: #888888;
  }
  .reader-header-author {
    color: #555555;
    font-style: normal;
  }
  .reader-header-meta {
    font-size: 0.78rem;
    white-space: nowrap;
    color: #222222;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .reader-header-prep {
    font-size: 0.75rem;
    color: #111111;
    text-decoration: none;
    border: 1px solid #888888;
    padding: 2px 5px;
    background: #ffffff;
  }
  .reader-header-menu {
    position: relative;
    display: inline-block;
  }
  .reader-menu-summary {
    cursor: pointer;
    font-size: 0.76rem;
    padding: 2px 5px;
    border: 1px solid #888888;
    background: #ffffff;
    list-style: none;
  }
  .reader-menu-summary::-webkit-details-marker {
    display: none;
  }
  .reader-menu-content {
    position: absolute;
    right: 0;
    top: 26px;
    background: #ffffff;
    border: 2px solid #000000;
    padding: 8px 10px;
    z-index: 100;
    min-width: 230px;
    box-shadow: none;
  }
  /* Tarjeta de definición en línea */
  .inline-lookup-card {
    border: 1px solid #111111;
    border-left: 4px solid #000000;
    background: #ffffff;
    padding: 10px 14px;
    margin-bottom: 8px;
  }
  .inline-lookup-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    border-bottom: 1px solid #e0e0e0;
    padding-bottom: 6px;
    margin-bottom: 8px;
  }
  .inline-lookup-word {
    font-family: Georgia, serif;
    font-weight: bold;
    font-size: 1.25rem;
    letter-spacing: -0.01em;
  }
  .inline-lookup-pos {
    font-style: italic;
    font-size: 0.88rem;
    color: #555555;
    margin-left: 8px;
  }
  .inline-lookup-close {
    display: inline-block;
    padding: 3px 8px;
    border: 1px solid #888888;
    color: #333333;
    background: #fbfbfb;
    text-decoration: none;
    font-size: 0.78rem;
  }
  .inline-lookup-def {
    font-size: 0.98rem;
    line-height: 1.5;
    margin-bottom: 8px;
    color: #111111;
  }
  /* Modos de lectura */
  .mode-selector {
    display: flex;
    gap: 6px;
    margin-bottom: 14px;
    flex-wrap: wrap;
    align-items: center;
  }
  .mode-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 6px 12px;
    border: 1.5px solid #000000;
    background: #ffffff;
    color: #000000;
    text-decoration: none;
    font-size: 0.88rem;
  }
  .mode-tab.is-active {
    background: #000000;
    color: #ffffff;
    border: 2px solid #000000;
    font-weight: bold;
  }
  .size-selector {
    display: inline-flex;
    gap: 4px;
    margin-left: auto;
    align-items: center;
  }
  .size-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 38px;
    min-width: 38px;
    padding: 4px 8px;
    border: 1.5px solid #000000;
    background: #ffffff;
    color: #000000;
    text-decoration: none;
    font-size: 0.82rem;
    font-weight: bold;
  }
  .size-btn.is-active {
    background: #000000;
    color: #ffffff;
  }
  /* Estilos según modo */
  .epub-content.mode-clean p {
    margin: 0;
    text-indent: 1.35em;
  }
  .epub-content.mode-clean > p:first-of-type,
  .epub-content.mode-clean h1 + p,
  .epub-content.mode-clean h2 + p {
    text-indent: 0;
  }
  .epub-content.mode-paragraphs p {
    margin: 0 0 1.4em 0;
    text-indent: 0;
    line-height: 1.6;
  }
  .epub-content.mode-paragraphs .p-num {
    font-size: 0.8em;
    font-weight: bold;
    color: #000000;
    margin-right: 6px;
    user-select: none;
  }
  .epub-content.mode-paragraphs p.p-guided {
    border-left: 2px solid #000000;
    padding-left: 10px;
    margin-left: -2px;
  }
  .epub-content.mode-lexicon p {
    margin: 0 0 0.8em 0;
    text-indent: 1.2em;
  }
  .epub-content.mode-lexicon > p:first-of-type {
    text-indent: 0;
  }
  /* Palabras interactivas (nodos span.w) */
  .w {
    color: inherit;
    cursor: pointer;
    text-decoration: none;
    border-bottom: none;
  }
  .w.saved {
    border-bottom: 1.5px dotted #000000;
  }
  .w.w-lexicon {
    border-bottom: 2px dotted #000000;
    font-weight: bold;
  }
  .w.w-lexicon sup {
    font-size: 0.72em;
    line-height: 0;
    vertical-align: super;
    font-weight: bold;
    margin-left: 1px;
  }
  .lookup-active .w {
    text-decoration: underline;
    text-decoration-style: dotted;
  }
  /* Tamaños de fuente */
  .epub-content.size-sm { font-size: 1.0rem; line-height: 1.5; }
  .epub-content.size-md { font-size: 1.18rem; line-height: 1.58; }
  .epub-content.size-lg { font-size: 1.35rem; line-height: 1.65; }
  .epub-content.size-xl { font-size: 1.55rem; line-height: 1.72; }

  /* Barra inferior compacta de una sola línea (<= 36px) */
  .turn-page-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 36px;
    max-height: 36px;
    min-height: 36px;
    margin: 4px 0 0 0;
    padding: 0 4px;
    border-top: 1px solid #dcdcdc;
    font-size: 0.82rem;
    line-height: 36px;
    box-sizing: border-box;
    width: 100%;
  }
  .turn-btn {
    display: inline-flex;
    align-items: center;
    padding: 0 6px;
    text-decoration: none;
    color: #000000;
    font-size: 0.82rem;
    white-space: nowrap;
    border: none;
    background: transparent;
    cursor: pointer;
  }
  .turn-btn.disabled {
    color: #888888;
    cursor: default;
  }
  .turn-page-indicator {
    font-size: 0.78rem;
    color: #444444;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: center;
    flex-grow: 1;
    padding: 0 4px;
  }
  /* Preparación previa al capítulo (Glosario de apertura) */
  .prep-title {
    font-size: 1.35rem;
    font-weight: bold;
    margin: 12px 0 6px 0;
    line-height: 1.25;
    letter-spacing: -0.01em;
  }
  .prep-subtitle {
    font-size: 0.95rem;
    color: #555555;
    margin-bottom: 16px;
    line-height: 1.45;
  }
  .prep-word-card {
    border: none;
    border-bottom: 1px solid #d5d5d5;
    padding: 14px 0;
    background: transparent;
  }
  .prep-word-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 4px;
  }
  .prep-word-term {
    font-family: Georgia, serif;
    font-size: 1.2rem;
    font-weight: bold;
  }
  .prep-word-pos {
    font-style: italic;
    font-size: 0.85rem;
    color: #666666;
    margin-left: 6px;
  }
  .prep-word-def {
    font-size: 0.98rem;
    line-height: 1.45;
    margin-bottom: 6px;
    color: #111111;
  }
  .prep-word-example {
    font-size: 0.88rem;
    font-style: italic;
    color: #333333;
    padding: 4px 10px;
    border-left: 2px solid #888888;
    margin: 6px 0 8px 0;
  }
  .prep-word-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .badge-saved {
    font-size: 0.8rem;
    font-weight: normal;
    color: #222222;
    border: 1px solid #555555;
    padding: 2px 6px;
  }
  .prep-empty-card {
    border: 1px dashed #999999;
    padding: 20px;
    text-align: center;
    margin: 24px 0;
    font-size: 1rem;
    color: #333333;
  }
  .reader-header-prep {
    font-size: 0.8rem;
    color: #000000;
    text-decoration: underline;
    margin-left: 8px;
    font-weight: normal;
  }
`;

function renderBaseHtml(options: {
  title: string;
  user: KindleUser | null;
  bodyHtml: string;
  returnTo?: string;
}): string {
  const { title, user, bodyHtml } = options;
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Lecta Kindle</title>
  <style>${KINDLE_CSS}</style>
</head>
<body>
  <div class="container">
    <header class="top-bar">
      <a href="/k" class="brand">Lecta <span style="font-size:0.8rem; font-weight:normal;">[Kindle]</span></a>
      <nav class="nav-links">
        <a href="/k">Biblioteca</a>
        <a href="/k/practice">Práctica</a>
        <a href="/k/lookup">Diccionario</a>
        ${
          user
            ? `<a href="/k/logout">Cerrar sesión (${escapeHtml(user.email.split("@")[0] || "cuenta")})</a>`
            : `<a href="/k/login">Iniciar sesión</a>`
        }
      </nav>
    </header>

    <main>
      ${bodyHtml}
    </main>

    <footer class="footer-bar">
      Lecta E-ink Edition · Sincronizado en la nube
    </footer>
  </div>
</body>
</html>`;
}

export function renderHomeView(options: {
  user: KindleUser | null;
  books: KindleBookItem[];
}): string {
  const { user, books } = options;

  let bodyHtml: string;

  if (!user) {
    bodyHtml = `
      <div class="card" style="text-align:center; padding: 24px 16px;">
        <h1 style="margin-top:0;">Lecta para Kindle y E-ink</h1>
        <p>Lee tu biblioteca sin sobrecargar el procesador del Kindle. Páginas limpias, sincronización automática de posición y consulta rápida de definiciones.</p>
        <p style="margin-top: 20px;">
          <a href="/kindle" class="btn btn-primary" style="font-size: 1.15rem; padding: 12px 24px; display: inline-block;">Vincular con código (1 toque)</a>
          <br /><br />
          <a href="/k/login" style="font-size: 0.95rem; color: #555; text-decoration: underline;">O entrar con correo y contraseña</a>
        </p>
      </div>
    `;
  } else {
    const booksHtml = books.length === 0
      ? `
        <div class="card">
          <p><strong>Aún no tienes libros en tu estantería.</strong></p>
          <p>Sube tus libros en formato EPUB desde tu ordenador o móvil en la versión principal de Lecta, y aparecerán aquí automáticamente.</p>
        </div>
      `
      : books
        .map((b) => {
          const sectionNum = (b.currentSection ?? 0) + 1;
          const totalSec = b.sections || 1;
          const percent = b.progressPercent != null ? Math.round(b.progressPercent * 100) : null;
          const progressText = percent !== null
            ? `Sección ${sectionNum} de ${totalSec} (${percent}%)`
            : `Sin empezar · ${totalSec} secciones`;

          const targetSec = b.currentSection ?? 0;
          const targetPg = b.currentPage ?? 0;
          const isAtStart =
            (b.currentSection == null || b.currentSection === 0) &&
            (b.currentPage == null || b.currentPage === 0) &&
            (b.progressPercent == null || b.progressPercent === 0);
          const readUrl = isAtStart
            ? `/k/read/${encodeURIComponent(b.hash)}?section=${targetSec}&page=0`
            : `/k/read/${encodeURIComponent(b.hash)}?section=${targetSec}&page=${targetPg}`;
          const readLabel = isAtStart ? "Comenzar lectura →" : "Continuar lectura →";

          const displayTitle = (!b.title || isHashLikeIdentifier(b.title))
            ? (b.author && b.author !== "Autor desconocido" ? `Libro de ${b.author}` : "Libro sin título")
            : b.title;

          return `
            <div class="card">
              <h2 style="margin:0 0 6px 0; font-size:1.25rem;">${escapeHtml(displayTitle)}</h2>
              <p style="margin:0 0 10px 0; font-style:italic; color:#444;">${escapeHtml(b.author || "Autor desconocido")}</p>
              <p style="margin:0 0 14px 0; font-size:0.95rem;"><strong>Progreso:</strong> ${escapeHtml(progressText)}</p>
              <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <a href="${readUrl}" class="btn btn-primary">${readLabel}</a>
                <a href="/k/read/${encodeURIComponent(b.hash)}?section=${targetSec}&prep=1" class="btn btn-sm">📖 Antes de leer</a>
              </div>
            </div>
          `;
        })
        .join("");

    bodyHtml = `
      <div style="margin-bottom: 20px;">
        <h1 style="margin: 0 0 6px 0; font-size: 1.5rem;">Mis Libros</h1>
        <p style="margin: 0; color: #444; font-size: 0.95rem;">Selecciona un libro para reanudar donde lo dejaste:</p>
      </div>
      ${booksHtml}
    `;
  }

  return renderBaseHtml({
    title: "Biblioteca",
    user,
    bodyHtml,
  });
}

export function renderLoginView(options: {
  user: KindleUser | null;
  error?: string | null;
  email?: string;
  returnTo?: string;
}): string {
  const { user, error, email = "", returnTo = "/k" } = options;

  const errorBox = error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : "";

  const bodyHtml = `
    <div class="card" style="max-width: 500px; margin: 0 auto;">
      <h1 style="margin-top:0; font-size:1.4rem;">Iniciar sesión en Lecta</h1>
      <p style="font-size:0.95rem; color:#444;">Introduce tu correo y contraseña registrados en Lecta para acceder a tus libros y notas:</p>

      ${errorBox}

      <form method="POST" action="/k/login">
        <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />

        <div class="form-group">
          <label for="email">Correo electrónico:</label>
          <input type="email" id="email" name="email" class="form-control" value="${escapeHtml(email)}" required autofocus />
        </div>

        <div class="form-group">
          <label for="password">Contraseña:</label>
          <input type="password" id="password" name="password" class="form-control" required />
        </div>

        <div style="margin-top: 18px;">
          <button type="submit" class="btn btn-primary" style="width: 100%;">Entrar a mi biblioteca</button>
        </div>
      </form>
    </div>
  `;

  return renderBaseHtml({
    title: "Iniciar sesión",
    user,
    bodyHtml,
  });
}

export function renderKindleLinkView(options: {
  code: string;
  user?: KindleUser | null;
}): string {
  const { code, user = null } = options;

  const bodyHtml = `
    <div class="card" style="max-width: 520px; margin: 2rem auto; text-align: center; padding: 2.5rem 1.5rem;">
      <h1 style="font-size: 1.6rem; margin-top: 0; color: #111;">Vincular tu Kindle</h1>
      <p style="color: #444; font-size: 1rem; line-height: 1.5; margin: 1rem 0;">
        Introduce este código de 4 letras en tu celular o PC (donde tengas abierta tu sesión de Lecta en <strong>Cuenta → Conectar mi Kindle</strong>):
      </p>
      <div style="font-size: 3.5rem; font-weight: bold; letter-spacing: 0.6rem; margin: 1.5rem 0; color: #d97706; font-family: monospace;">
        ${escapeHtml(code)}
      </div>

      <div style="margin: 1.8rem 0 1rem 0;">
        <a href="/api/kindle/status?code=${encodeURIComponent(code)}&redirect=1" class="btn btn-primary" style="display: block; width: 100%; font-size: 1.1rem; padding: 12px; text-decoration: none;">
          Ya ingresé el código en mi celular → Entrar
        </a>
      </div>

      <p style="color: #666; font-size: 0.9rem; margin-top: 1.2rem;">
        O espera unos segundos; el dispositivo se conectará automáticamente.<br/>
        <a href="/k/login" style="display: inline-block; margin-top: 1rem; color: #555; text-decoration: underline;">O inicia sesión con correo y contraseña</a>
      </p>
    </div>
    <script>
      (function poll() {
        fetch('/api/kindle/status?code=${encodeURIComponent(code)}')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (data && data.linked) {
              window.location.href = data.redirectUrl || '/k';
            } else {
              setTimeout(poll, 4000);
            }
          })
          .catch(function() {
            setTimeout(poll, 4000);
          });
      })();
    </script>
    <noscript>
      <meta http-equiv="refresh" content="5" />
    </noscript>
  `;

  return renderBaseHtml({
    title: "Vincular Kindle",
    user,
    bodyHtml,
  });
}

export function renderReaderView(options: {
  user: KindleUser | null;
  bookHash: string;
  bookTitle: string;
  bookAuthor: string;
  chapterTitle: string;
  contentHtml: string;
  sectionIndex: number;
  totalSections: number;
  pageIndex: number;
  totalPages: number;
  pageWords?: PageWordItem[];
  savedNotice?: string | null;
  lookupResult?: InlineLookupResult | null;
  mode?: "clean" | "paragraphs" | "lexicon";
  size?: "sm" | "md" | "lg" | "xl";
  gloss?: boolean;
  catNotes?: CatPageNoteItem[];
  primingOff?: boolean;
  layout?: "paged" | "scroll";
}): string {
  const {
    user,
    bookHash,
    bookTitle,
    bookAuthor,
    chapterTitle,
    contentHtml,
    sectionIndex,
    totalSections,
    pageIndex,
    totalPages,
    savedNotice,
    lookupResult,
    mode = "clean",
    size = "md",
    gloss = false,
    catNotes: _catNotes = [],
    primingOff = false,
    layout = "paged",
  } = options;

  const querySuffix = `&mode=${encodeURIComponent(mode)}&size=${encodeURIComponent(size)}&layout=${layout}${gloss ? "&gloss=1" : ""}`;
  const cleanPageUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex}${querySuffix}`;

  const prevUrl =
    pageIndex > 0
      ? `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex - 1}${querySuffix}`
      : sectionIndex > 0
        ? `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex - 1}&page=last${querySuffix}`
        : null;

  let nextUrl: string | null = null;
  if (pageIndex < totalPages - 1) {
    nextUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex + 1}${querySuffix}`;
  } else if (sectionIndex < totalSections - 1) {
    nextUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex + 1}&page=0${querySuffix}`;
  }

  const hasPrev = prevUrl !== null;
  const hasNext = nextUrl !== null;

  const flashHtml = savedNotice
    ? `<div class="alert alert-success">${escapeHtml(savedNotice)}</div>`
    : "";

  let lookupHtml = "";
  if (lookupResult) {
    const firstEntry = lookupResult.entries && lookupResult.entries.length > 0 ? lookupResult.entries[0] : null;
    const firstMeaning = firstEntry?.senses[0]?.definition || null;

    lookupHtml = `
      <div class="inline-lookup-card">
        <div class="inline-lookup-header">
          <div>
            <span class="inline-lookup-word">${escapeHtml(lookupResult.word)}</span>
            ${firstEntry?.pos ? `<span class="inline-lookup-pos">(${escapeHtml(firstEntry.pos)})</span>` : ""}
          </div>
          <a href="${escapeHtml(cleanPageUrl)}" class="inline-lookup-close" title="Cerrar definición">✕ Cerrar</a>
        </div>
        <div class="inline-lookup-def">
          ${firstMeaning ? escapeHtml(firstMeaning) : "<em>Definición no encontrada en el catálogo.</em>"}
        </div>
        ${
          firstEntry?.senses[0]?.example
            ? `<div class="sense-example" style="font-size:0.85rem; margin-bottom:6px;">«${escapeHtml(firstEntry.senses[0].example)}»</div>`
            : ""
        }
        ${
          user && firstMeaning
            ? `
              <form method="POST" action="/k/vocab/add" style="margin-top:6px;">
                <input type="hidden" name="form" value="${escapeHtml(lookupResult.word)}" />
                <input type="hidden" name="lemma" value="${escapeHtml(firstEntry?.lemma || lookupResult.word)}" />
                <input type="hidden" name="pos" value="${escapeHtml(firstEntry?.pos || "")}" />
                <input type="hidden" name="meaning" value="${escapeHtml(firstMeaning)}" />
                <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
                <input type="hidden" name="returnTo" value="${escapeHtml(cleanPageUrl)}" />
                <button type="submit" class="btn btn-sm btn-primary" style="padding:6px 12px; font-size:0.85rem; min-height:44px;">+ Guardar en mi Cuaderno</button>
              </form>
            `
            : ""
        }
      </div>
    `;
  }

  // catNotesHtml retirado de la vista de lectura página a página para garantizar Zero-Scroll

  const baseParamUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex}`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bookTitle)} (${sectionIndex + 1}/${totalSections} — ${pageIndex + 1}/${totalPages}) — Lecta</title>
  <style>${KINDLE_CSS}</style>
</head>
<body class="reader-body layout-${escapeHtml(layout)}">
  <div class="reader-container">
    <header class="reader-header">
      <div class="reader-header-left">
        <a href="/k" class="reader-back-btn">← Libros</a>
        <button type="button" id="lookupToggle" class="lookup-btn" title="Alternar modo consulta">[ 🔍 Consultar ]</button>
      </div>
      <div class="reader-header-info">
        <span class="reader-header-title">${escapeHtml(bookTitle)}</span>
        <span class="reader-header-sep">·</span>
        <span class="reader-header-author">${escapeHtml(bookAuthor)}</span>
      </div>
      <div class="reader-header-meta">
        <details class="reader-header-menu">
          <summary class="reader-menu-summary">[ Modo / Aa ]</summary>
          <div class="reader-menu-content">
            <div class="mode-selector">
              <span style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:4px;">Modo:</span>
              <div style="display:flex; gap:4px; margin-bottom:8px; flex-wrap:wrap;">
                <a href="${baseParamUrl}&amp;mode=clean&amp;size=${size}&amp;layout=${layout}" class="mode-tab ${mode === "clean" ? "is-active" : ""}">[ Modo Limpio ]</a>
                <a href="${baseParamUrl}&amp;mode=paragraphs&amp;size=${size}&amp;layout=${layout}" class="mode-tab ${mode === "paragraphs" ? "is-active" : ""}">[ Modo Párrafos ]</a>
                <a href="${baseParamUrl}&amp;mode=lexicon&amp;size=${size}&amp;layout=${layout}" class="mode-tab ${mode === "lexicon" ? "is-active" : ""}">[ Modo Léxico ]</a>
              </div>
              <span style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:4px;">Letra:</span>
              <div class="size-selector" style="display:flex; gap:4px; margin-bottom:8px;">
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=sm&amp;layout=${layout}" class="size-btn ${size === "sm" ? "is-active" : ""}">P</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=md&amp;layout=${layout}" class="size-btn ${size === "md" ? "is-active" : ""}">M</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=lg&amp;layout=${layout}" class="size-btn ${size === "lg" ? "is-active" : ""}">G</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=xl&amp;layout=${layout}" class="size-btn ${size === "xl" ? "is-active" : ""}">XG</a>
              </div>
              <span style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:4px;">Disposición:</span>
              <div style="display:flex; gap:4px;">
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=paged" class="mode-tab ${layout === "paged" ? "is-active" : ""}">Paginado</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=scroll" class="mode-tab ${layout === "scroll" ? "is-active" : ""}">Scroll</a>
              </div>
            </div>
          </div>
        </details>
        <a href="/k/practice?bookHash=${encodeURIComponent(bookHash)}&amp;returnTo=${encodeURIComponent(cleanPageUrl)}" class="reader-header-prep" title="Practicar vocabulario">🎯 Práctica</a>
        <a href="/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&amp;prep=1" class="reader-header-prep" title="Ver vocabulario del capítulo">📖 Prep</a>
        ${
          primingOff
            ? `<form method="POST" action="/kindle/priming/action" style="display:inline; margin:0;"><input type="hidden" name="action" value="enable_all" /><input type="hidden" name="returnUrl" value="${escapeHtml(cleanPageUrl)}" /><button type="submit" class="reader-header-prep" style="background:#ffffff; border:1px solid #888888; cursor:pointer;" title="Reactivar antesala">✨ Antesala</button></form>`
            : `<form method="POST" action="/kindle/priming/action" style="display:inline; margin:0;"><input type="hidden" name="action" value="disable_all" /><input type="hidden" name="returnUrl" value="${escapeHtml(cleanPageUrl)}" /><button type="submit" class="reader-header-prep" style="background:#ffffff; border:1px solid #888888; cursor:pointer;" title="Silenciar antesala">✨ Antesala</button></form>`
        }
      </div>
    </header>

    ${flashHtml}

    ${lookupHtml}

    ${pageIndex === 0 && chapterTitle ? `<h2 class="chapter-heading">${escapeHtml(chapterTitle)}</h2>` : ""}

    <div class="epub-content mode-${escapeHtml(mode)} size-${escapeHtml(size)}">
      ${contentHtml}
    </div>

    <nav class="turn-page-bar">
      ${
        hasPrev && prevUrl
          ? `<a href="${escapeHtml(prevUrl)}" class="turn-btn turn-btn-prev">[ ← Ant. ]</a>`
          : `<span class="turn-btn turn-btn-prev disabled">[ ← Ant. ]</span>`
      }
      <div class="turn-page-indicator">
        Pág. ${pageIndex + 1} de ${totalPages} · Cap. ${sectionIndex + 1}${chapterTitle ? `: ${escapeHtml(chapterTitle)}` : ""}
      </div>
      ${
        hasNext && nextUrl
          ? `<a href="${escapeHtml(nextUrl)}" class="turn-btn turn-btn-next">[ Sig. → ]</a>`
          : `<span class="turn-btn turn-btn-next disabled">[ Fin ]</span>`
      }
    </nav>
  </div>

  <script>
  (function() {
    var lookupBase = ${JSON.stringify(cleanPageUrl)};
    var prevUrl = ${JSON.stringify(prevUrl || "")};
    var nextUrl = ${JSON.stringify(nextUrl || "")};

    function triggerLookup(rawWord) {
      if (!rawWord) return;
      var w = rawWord.trim().toLowerCase();
      if (!w || w.length < 2 || w.length > 40) return;
      var sep = lookupBase.indexOf('?') >= 0 ? '&' : '?';
      window.location.href = lookupBase + sep + 'lookup=' + encodeURIComponent(w);
    }

    var content = document.querySelector('.epub-content');
    var toggleBtn = document.getElementById('lookupToggle');

    if (toggleBtn && content) {
      toggleBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var active = content.classList.toggle('lookup-active');
        toggleBtn.classList.toggle('is-active', active);
        toggleBtn.textContent = active ? '[ ✕ Consulta ON ]' : '[ 🔍 Consultar ]';
      });
    }

    var pressTimer = null;
    var startX = 0;
    var startY = 0;

    function clearTimer() {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }

    if (content) {
      content.addEventListener('touchstart', function(e) {
        var t = e.target;
        while (t && t !== content && !t.getAttribute('data-w')) {
          t = t.parentElement;
        }
        if (t && t.getAttribute('data-w')) {
          var touch = e.touches[0];
          startX = touch.clientX;
          startY = touch.clientY;
          clearTimer();
          pressTimer = setTimeout(function() {
            pressTimer = null;
            triggerLookup(t.getAttribute('data-w'));
          }, 450);
        }
      }, false);

      content.addEventListener('touchmove', function(e) {
        if (pressTimer && e.touches[0]) {
          var dx = Math.abs(e.touches[0].clientX - startX);
          var dy = Math.abs(e.touches[0].clientY - startY);
          if (dx > 10 || dy > 10) {
            clearTimer();
          }
        }
      }, false);

      content.addEventListener('touchend', function() {
        clearTimer();
        var sel = window.getSelection ? window.getSelection().toString().trim() : '';
        if (sel && sel.length >= 2 && sel.length <= 35) {
          triggerLookup(sel);
        }
      }, false);

      content.addEventListener('touchcancel', clearTimer, false);

      content.addEventListener('click', function(e) {
        var sel = window.getSelection ? window.getSelection().toString().trim() : '';
        if (sel) return;

        var isLookupMode = content.classList.contains('lookup-active');
        if (isLookupMode) {
          var t = e.target;
          while (t && t !== content && !t.getAttribute('data-w')) {
            t = t.parentElement;
          }
          if (t && t.getAttribute('data-w')) {
            e.preventDefault();
            e.stopPropagation();
            triggerLookup(t.getAttribute('data-w'));
            return;
          }
        }

        if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;

        var w = window.innerWidth || document.documentElement.clientWidth || 600;
        if (e.clientX < w * 0.25) {
          if (prevUrl) window.location.href = prevUrl;
        } else {
          if (nextUrl) window.location.href = nextUrl;
        }
      }, false);
    }
  })();
  </script>
</body>
</html>`;
}

export function renderChapterPrepView(options: {
  user: KindleUser | null;
  bookHash: string;
  bookTitle: string;
  bookAuthor: string;
  chapterTitle: string;
  sectionIndex: number;
  totalSections: number;
  words: PrepWordItem[];
  savedNotice?: string | null;
  nextUrl: string;
  prevUrl?: string | null;
}): string {
  const {
    user,
    bookHash,
    bookTitle,
    bookAuthor,
    chapterTitle,
    sectionIndex,
    totalSections,
    words,
    savedNotice,
    nextUrl,
    prevUrl,
  } = options;

  const flashHtml = savedNotice
    ? `<div class="flash flash-success">${escapeHtml(savedNotice)}</div>`
    : "";

  const wordsHtml =
    words.length > 0
      ? `<div class="prep-word-list">
          ${words
            .map(
              (w) => `
            <div class="prep-word-card">
              <div class="prep-word-header">
                <div>
                  <span class="prep-word-term">${escapeHtml(w.form)}</span>
                  ${w.pos ? `<span class="prep-word-pos">(${escapeHtml(w.pos)})</span>` : ""}
                </div>
                ${w.saved ? `<span class="badge-saved">✓ En tu Cuaderno</span>` : ""}
              </div>
              <div class="prep-word-def">
                ${escapeHtml(w.meaning)}
              </div>
              ${
                w.exampleSentence
                  ? `<div class="prep-word-example">«${escapeHtml(w.exampleSentence)}»</div>`
                  : ""
              }
              <div class="prep-word-actions">
                ${
                  user && !w.saved
                    ? `
                      <form method="POST" action="/k/vocab/add" style="display:inline;">
                        <input type="hidden" name="form" value="${escapeHtml(w.form)}" />
                        <input type="hidden" name="lemma" value="${escapeHtml(w.lemma)}" />
                        <input type="hidden" name="pos" value="${escapeHtml(w.pos || "")}" />
                        <input type="hidden" name="meaning" value="${escapeHtml(w.meaning)}" />
                        <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
                        <input type="hidden" name="returnTo" value="/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&amp;prep=1" />
                        <button type="submit" class="btn-xs" style="padding:4px 10px; font-size:0.85rem; background:#000000; color:#ffffff; border:none; cursor:pointer;">+ Guardar</button>
                      </form>
                    `
                    : ""
                }
                ${
                  user
                    ? `
                      <form method="POST" action="/k/knowledge/mark" style="display:inline;">
                        <input type="hidden" name="lemma" value="${escapeHtml(w.lemma)}" />
                        <input type="hidden" name="known" value="1" />
                        <input type="hidden" name="returnTo" value="/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&amp;prep=1" />
                        <button type="submit" class="btn-xs" style="padding:4px 9px; font-size:0.82rem; background:#ffffff; color:#333333; border:1px solid #777777; cursor:pointer;">Ya la conozco</button>
                      </form>
                    `
                    : ""
                }
              </div>
            </div>
          `,
            )
            .join("")}
        </div>`
      : `<div class="prep-empty-card">
          <p>✓ No se detectaron palabras complejas desconocidas en este capítulo.</p>
          <p style="margin-top: 8px;">¡Todo listo para empezar la lectura!</p>
        </div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Antes de leer: ${escapeHtml(chapterTitle || `Capítulo ${sectionIndex + 1}`)} — ${escapeHtml(bookTitle)} — Lecta</title>
  <style>${KINDLE_CSS}</style>
</head>
<body class="reader-body">
  <div class="reader-container">
    <header class="reader-header">
      <a href="/k" class="reader-back-btn">← Biblioteca</a>
      <div class="reader-header-info">
        <span class="reader-header-title">${escapeHtml(bookTitle)}</span>
        <span class="reader-header-sep">·</span>
        <span class="reader-header-author">${escapeHtml(bookAuthor)}</span>
      </div>
      <div class="reader-header-meta">
        Cap. ${sectionIndex + 1}/${totalSections}
      </div>
    </header>

    ${flashHtml}

    <div class="prep-header">
      <h1 class="prep-title">Vocabulario de apertura · ${escapeHtml(chapterTitle || `Capítulo ${sectionIndex + 1}`)}</h1>
      <p class="prep-subtitle">
        Palabras seleccionadas para enriquecer tu lectura antes de comenzar este capítulo (${words.length} palabras clave):
      </p>
    </div>

    <div style="margin-bottom: 20px;">
      <a href="${escapeHtml(nextUrl)}" class="turn-btn turn-btn-next" style="display:block; text-align:center; text-decoration:none; padding:13px 18px; font-size:1.05rem;">
        Comenzar capítulo ${sectionIndex + 1} →
      </a>
    </div>

    ${wordsHtml}

    <nav class="turn-page-bar" style="margin-top: 24px;">
      ${
        prevUrl
          ? `<a href="${escapeHtml(prevUrl)}" class="turn-btn turn-btn-prev">← Anterior</a>`
          : `<a href="/k" class="turn-btn turn-btn-prev">← Biblioteca</a>`
      }
      <div class="turn-page-indicator">
        Cap. ${sectionIndex + 1} de ${totalSections}
      </div>
      <a href="${escapeHtml(nextUrl)}" class="turn-btn turn-btn-next">
        Comenzar capítulo ${sectionIndex + 1} →
      </a>
    </nav>
  </div>
</body>
</html>`;
}

export function renderLookupView(options: {
  user: KindleUser | null;
  query: string;
  entries: LexiconEntryView[] | null;
  saved?: boolean;
  returnTo?: string;
  bookHash?: string;
}): string {
  const { user, query, entries, saved, returnTo = "/k", bookHash = "" } = options;

  const backLink = returnTo
    ? `<p><a href="${escapeHtml(returnTo)}" class="btn btn-sm">← Volver al libro</a></p>`
    : "";

  let resultHtml = "";

  if (saved) {
    resultHtml += `<div class="alert alert-success">✓ Palabra «${escapeHtml(query)}» guardada en tu Cuaderno de Lecta.</div>`;
  }

  if (query && entries !== null) {
    if (entries.length === 0) {
      resultHtml += `
        <div class="card">
          <p>No se encontraron definiciones para «<strong>${escapeHtml(query)}</strong>» en el catálogo.</p>
        </div>
      `;
    } else {
      for (const entry of entries) {
        const firstMeaning = entry.senses[0]?.definition ?? "";
        resultHtml += `
          <div class="card">
            <h2 style="margin: 0 0 6px 0; font-size: 1.4rem;">
              ${escapeHtml(entry.lemma)}
              ${entry.pos ? `<span style="font-weight:normal; font-size:1rem; font-style:italic; color:#444;">(${escapeHtml(entry.pos)})</span>` : ""}
            </h2>

            <ol class="sense-list">
              ${entry.senses
                .map(
                  (s) => `
                <li class="sense-item">
                  ${escapeHtml(s.definition)}
                  ${s.example ? `<span class="sense-example">«${escapeHtml(s.example)}»</span>` : ""}
                </li>
              `,
                )
                .join("")}
            </ol>

            ${
              user && firstMeaning
                ? `
              <form method="POST" action="/k/vocab/add">
                <input type="hidden" name="form" value="${escapeHtml(query)}" />
                <input type="hidden" name="lemma" value="${escapeHtml(entry.lemma)}" />
                <input type="hidden" name="pos" value="${escapeHtml(entry.pos || "")}" />
                <input type="hidden" name="meaning" value="${escapeHtml(firstMeaning)}" />
                <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
                <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
                <button type="submit" class="btn btn-primary btn-sm">+ Guardar en mi Cuaderno</button>
              </form>
            `
                : ""
            }
          </div>
        `;
      }
    }
  }

  const bottomBackLink = returnTo
    ? `<p style="margin-top: 20px;"><a href="${escapeHtml(returnTo)}" class="btn btn-primary" style="width: 100%;">← Volver al libro</a></p>`
    : "";

  const bodyHtml = `
    ${backLink}

    <div class="card">
      <h1 style="margin-top:0; font-size: 1.3rem;">Diccionario de Lecta</h1>
      <form action="/k/lookup" method="GET" class="quick-lookup-form">
        <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
        <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
        <input type="text" name="q" class="form-control" value="${escapeHtml(query)}" placeholder="Escribe una palabra..." required autofocus />
        <button type="submit" class="btn btn-primary">Buscar</button>
      </form>
    </div>

    ${resultHtml}

    ${bottomBackLink}
  `;

  return renderBaseHtml({
    title: query ? `Definición de ${query}` : "Diccionario",
    user,
    bodyHtml,
    returnTo,
  });
}

export function renderPracticeView(options: {
  user: KindleUser | null;
  question?: PracticeQuestionItem | null;
  isFinished?: boolean;
  correctCount?: number;
  totalQuestions?: number;
  returnTo?: string;
  bookHash?: string;
  equippedItems?: string[];
}): string {
  const {
    user,
    question,
    isFinished,
    correctCount = 0,
    totalQuestions = 3,
    returnTo = "/k",
    bookHash = "",
    equippedItems = [],
  } = options;

  let bodyHtml: string;

  if (isFinished) {
    const earnedXp = correctCount * 15;
    bodyHtml = `
      <div class="card" style="text-align: center; padding: 24px 16px;">
        <div style="margin-bottom: 16px;">
          ${renderKindleCatSvg("celebrating", equippedItems)}
        </div>
        <h1 style="margin-top: 0; font-size: 1.5rem;">¡Sesión de Práctica Completada!</h1>
        <p style="font-size: 1.1rem; margin: 12px 0;">
          Acertaste <strong>${correctCount} de ${totalQuestions}</strong> palabras.
        </p>
        <p style="font-size: 1rem; color: #333; margin-bottom: 24px;">
          Tu compañero ronronea con satisfacción (+${earnedXp} XP para el gato).
        </p>
        <div style="display: flex; flex-direction: column; gap: 10px; max-width: 380px; margin: 0 auto;">
          <a href="${escapeHtml(returnTo)}" class="btn btn-primary" style="font-size: 1.1rem;">[ Volver a leer → ]</a>
          <a href="/k/practice${bookHash ? `?bookHash=${encodeURIComponent(bookHash)}` : ""}" class="btn">[ Practicar 3 más ]</a>
          <a href="/k" class="btn">[ Ir a la Biblioteca ]</a>
        </div>
      </div>
    `;
  } else if (question) {
    bodyHtml = `
      <div class="card" style="padding: 20px 16px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000000; padding-bottom: 10px; margin-bottom: 16px;">
          <span style="font-weight: bold; font-size: 0.95rem;">
            Palabra ${question.questionIndex + 1} de ${question.totalQuestions}
          </span>
          <span style="font-size: 0.85rem; color: #444;">
            Aciertos: ${correctCount}
          </span>
        </div>

        <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 16px;">
          <div>${renderKindleCatSvg("curious", equippedItems)}</div>
          <div>
            <span style="font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #555;">Pregunta de vocabulario</span>
            <h2 style="margin: 2px 0 0 0; font-size: 1.5rem;">
              «${escapeHtml(question.word)}»
            </h2>
            ${question.pos ? `<span style="font-style: italic; font-size: 0.9rem; color: #444;">(${escapeHtml(question.pos)})</span>` : ""}
          </div>
        </div>

        <p style="font-size: 1.05rem; margin: 0 0 16px 0; font-weight: bold;">
          ¿Cuál es la definición correcta?
        </p>

        <form method="POST" action="/k/practice/answer">
          <input type="hidden" name="word" value="${escapeHtml(question.word)}" />
          <input type="hidden" name="lemma" value="${escapeHtml(question.lemma)}" />
          <input type="hidden" name="questionIndex" value="${question.questionIndex}" />
          <input type="hidden" name="totalQuestions" value="${question.totalQuestions}" />
          <input type="hidden" name="correctCount" value="${correctCount}" />
          <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
          <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />

          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${question.options
              .map(
                (opt) => `
              <button type="submit" name="selectedOption" value="${opt.key}" class="btn" style="min-height: 56px; text-align: left; justify-content: flex-start; padding: 12px 14px; font-size: 0.98rem; line-height: 1.35; width: 100%;">
                <span style="display: inline-block; min-width: 32px; font-weight: bold; font-size: 1.05rem;">[ ${opt.key} ]</span>
                <span style="flex: 1;">${escapeHtml(opt.text)}</span>
              </button>
            `,
              )
              .join("")}
          </div>
        </form>
      </div>

      <div style="margin-top: 14px; text-align: center;">
        <a href="${escapeHtml(returnTo)}" style="color: #444; font-size: 0.9rem; text-decoration: underline;">
          Saltar práctica y volver a la lectura
        </a>
      </div>
    `;
  } else {
    bodyHtml = `
      <div class="card" style="text-align: center; padding: 24px 16px;">
        <h2>No hay palabras pendientes para practicar</h2>
        <p>¡Tu cuaderno está al día! Puedes volver a tu libro o explorar tu biblioteca.</p>
        <p style="margin-top: 18px;">
          <a href="/k" class="btn btn-primary">[ Ir a la Biblioteca ]</a>
        </p>
      </div>
    `;
  }

  return renderBaseHtml({
    title: "Práctica de Vocabulario",
    user,
    bodyHtml,
    returnTo,
  });
}

export interface KindleChapterPrimingViewProps {
  bookId: string;
  bookTitle: string;
  chapterIndex: number;
  chapterTitle: string;
  bookLang: string;
  isForeignLang: boolean;
  words: KindlePrimingWord[];
  bookAuthor?: string;
  readUrl?: string;
  currentUrl?: string;
  user?: KindleUser | null;
  bookHash?: string;
  sectionIndex?: number;
  totalSections?: number;
  lang?: string;
  savedNotice?: string | null;
}

export type KindlePrimingViewParams = KindleChapterPrimingViewProps;

export function renderKindleChapterPrimingView(props: KindleChapterPrimingViewProps): string {
  const bookId = props.bookId || props.bookHash || "";
  const bookTitle = props.bookTitle || "";
  const chapterIndex = props.chapterIndex ?? props.sectionIndex ?? 0;
  const chapterTitle = props.chapterTitle || `Capítulo ${chapterIndex + 1}`;
  const bookLang = props.bookLang || props.lang || "es";
  const isForeignLang = props.isForeignLang ?? (bookLang !== "es");
  const words = props.words || [];

  const startReadingUrl =
    props.readUrl ||
    `/kindle/read/${encodeURIComponent(bookId)}?chapter=${chapterIndex}&page=0&primed=1`;
  const currentUrl =
    props.currentUrl ||
    `/kindle/read/${encodeURIComponent(bookId)}?chapter=${chapterIndex}&page=0`;

  const cardsHtml = words
    .map(
      (w) => `
      <li class="k-priming-card" id="k-word-${escapeHtml(w.lemma)}">
        <div class="k-priming-card__header">
          <div class="k-priming-card__term">
            <strong class="k-priming-card__surface">${escapeHtml(w.surfaceForm)}</strong>${w.partOfSpeech ? `<span class="k-priming-card__pos">(${escapeHtml(w.partOfSpeech)})</span>` : ""}
          </div>
          <div class="k-priming-card__actions">
            <form method="POST" action="/kindle/priming/action" class="k-inline-form" onsubmit="return window.lectaKindleAction(event, this, '${escapeHtml(w.lemma)}', 'known')">
              <input type="hidden" name="action" value="known" />
              <input type="hidden" name="bookId" value="${escapeHtml(bookId)}" />
              <input type="hidden" name="chapter" value="${chapterIndex}" />
              <input type="hidden" name="lemma" value="${escapeHtml(w.lemma)}" />
              <input type="hidden" name="lang" value="${escapeHtml(bookLang)}" />
              <input type="hidden" name="returnUrl" value="${escapeHtml(currentUrl)}" />
              <button type="submit" class="k-btn k-btn--small">✓ Ya la sé</button>
            </form>
            <form method="POST" action="/kindle/priming/action" class="k-inline-form" onsubmit="return window.lectaKindleAction(event, this, '${escapeHtml(w.lemma)}', 'save')">
              <input type="hidden" name="action" value="save" />
              <input type="hidden" name="bookId" value="${escapeHtml(bookId)}" />
              <input type="hidden" name="chapter" value="${chapterIndex}" />
              <input type="hidden" name="lemma" value="${escapeHtml(w.lemma)}" />
              <input type="hidden" name="lang" value="${escapeHtml(bookLang)}" />
              <input type="hidden" name="returnUrl" value="${escapeHtml(currentUrl)}" />
              <button type="submit" class="k-btn k-btn--small k-btn--outline">+ Repasar</button>
            </form>
          </div>
        </div>
        <p class="k-priming-card__gloss">${escapeHtml(w.shortGloss)}</p>${
          w.contextSentence
            ? `<blockquote class="k-priming-card__quote">«${escapeHtml(w.contextSentence)}»</blockquote>`
            : ""
        }
      </li>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Antes de leer · ${escapeHtml(chapterTitle)}</title>
  <style>
    /* E-Ink High Contrast Zero-Flicker Styles */
    * { box-sizing: border-box; transition: none !important; animation: none !important; }
    body {
      margin: 0;
      padding: 16px 20px;
      background: #ffffff;
      color: #000000;
      font-family: Georgia, "Bookerly", "Literata", serif;
      line-height: 1.45;
    }
    .k-topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #000000;
      padding-bottom: 10px;
      margin-bottom: 16px;
      font-family: sans-serif;
      font-size: 14px;
    }
    .k-badge {
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border: 1.5px solid #000;
      padding: 2px 8px;
    }
    .k-title {
      font-size: 22px;
      margin: 0 0 6px 0;
      font-weight: bold;
    }
    .k-subtitle {
      font-size: 15px;
      margin: 0 0 16px 0;
    }
    .k-priming-list {
      list-style: none;
      padding: 0;
      margin: 0 0 20px 0;
    }
    .k-priming-card {
      border: 2px solid #000000;
      padding: 12px 14px;
      margin-bottom: 12px;
    }
    .k-priming-card__header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 6px;
    }
    .k-priming-card__surface {
      font-size: 19px;
    }
    .k-priming-card__pos {
      font-size: 14px;
      font-style: italic;
      margin-left: 4px;
    }
    .k-priming-card__gloss {
      margin: 4px 0 8px 0;
      font-size: 16px;
      font-weight: bold;
    }
    .k-priming-card__quote {
      margin: 0;
      padding-left: 10px;
      border-left: 3px solid #000000;
      font-size: 14px;
      font-style: italic;
    }
    .k-inline-form { display: inline-block; margin: 0; }
    .k-btn {
      min-height: 44px;
      padding: 8px 14px;
      font-size: 15px;
      font-family: sans-serif;
      font-weight: bold;
      background: #000000;
      color: #ffffff;
      border: 2px solid #000000;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .k-btn--outline {
      background: #ffffff;
      color: #000000;
    }
    .k-btn--small {
      min-height: 38px;
      padding: 6px 10px;
      font-size: 14px;
    }
    .k-btn--full {
      width: 100%;
      min-height: 50px;
      font-size: 18px;
      margin-bottom: 16px;
    }
    .k-footer-Prefs {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      border-top: 1px solid #000000;
      padding-top: 12px;
    }
  </style>
</head>
<body>
  <header class="k-topbar">
    <span>${escapeHtml(bookTitle)}</span>
    <span class="k-badge">${isForeignLang ? `Idioma: ${escapeHtml(bookLang.toUpperCase())}` : "Pre-lectura"} · ${words.length} palabras</span>
  </header>

  <main>
    <h1 class="k-title">${escapeHtml(chapterTitle)}</h1>
    <p class="k-subtitle">Conoce estas palabras clave antes de empezar para leer el capítulo sin pausas.</p>

    <a href="${escapeHtml(startReadingUrl)}" class="k-btn k-btn--full">
      Comenzar a leer capítulo →
    </a>

    <ul class="k-priming-list">
      ${cardsHtml}
    </ul>

    <div class="k-footer-Prefs">
      <form method="POST" action="/kindle/priming/action" class="k-inline-form">
        <input type="hidden" name="action" value="mute_book" />
        <input type="hidden" name="bookId" value="${escapeHtml(bookId)}" />
        <input type="hidden" name="chapter" value="${chapterIndex}" />
        <input type="hidden" name="returnUrl" value="${escapeHtml(startReadingUrl)}" />
        <button type="submit" class="k-btn k-btn--outline k-btn--small">Ocultar en este libro</button>
      </form>

      <form method="POST" action="/kindle/priming/action" class="k-inline-form">
        <input type="hidden" name="action" value="disable_all" />
        <input type="hidden" name="bookId" value="${escapeHtml(bookId)}" />
        <input type="hidden" name="chapter" value="${chapterIndex}" />
        <input type="hidden" name="returnUrl" value="${escapeHtml(startReadingUrl)}" />
        <button type="submit" class="k-btn k-btn--outline k-btn--small">Desactivar siempre</button>
      </form>
    </div>
  </main>

  <script>
    // Mejora progresiva E-Ink: evita recargar toda la página al marcar palabras
    window.lectaKindleAction = function(ev, formEl, lemma, actionType) {
      if (!window.fetch) return true;
      ev.preventDefault();
      var card = document.getElementById('k-word-' + lemma);
      if (card && actionType === 'known') {
        card.style.display = 'none';
      } else if (card && actionType === 'save') {
        var btn = formEl.querySelector('button');
        if (btn) { btn.textContent = '✓ Guardada'; btn.disabled = true; }
      }
      var data = new FormData(formEl);
      fetch(formEl.action, { method: 'POST', body: data });
      return false;
    };
  </script>
</body>
</html>`;
}

/**
 * Inyecta un anclaje sutil en el HTML del capítulo para las 3-5 palabras pre-vistas
 */
export function injectKindlePrimedAnchors(
  chapterHtml: string,
  primedWords: KindlePrimingWord[],
): string {
  if (!primedWords.length) return chapterHtml;
  let output = chapterHtml;

  for (const item of primedWords) {
    const escaped = item.surfaceForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Solo ancla la primera aparición fuera de etiquetas HTML
    const regex = new RegExp(`(^|>[^<]*?)\\b(${escaped})\\b`, "i");
    output = output.replace(
      regex,
      `$1<span style="border-bottom: 1.5px dashed #000; font-weight: 500;">$2</span> <small style="font-family: sans-serif; font-size: 0.78em;">[${escapeHtml(item.shortGloss)}]</small>`,
    );
  }

  return output;
}

