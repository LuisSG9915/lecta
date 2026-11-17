// Plantillas HTML generadas en servidor para la interfaz Kindle / E-ink de Lecta.
// Cero JavaScript en el cliente, alto contraste, objetivos táctiles amplios
// y tipografía optimizada para pantallas de tinta electrónica.

import type { LexiconEntryView } from "../lexicon";
import type { KindleMargin, KindlePrimingWord } from "./epub-reader";
import {
  DEFAULT_KINDLE_PREFS,
  KINDLE_ALIGNS,
  KINDLE_APPROACHES,
  KINDLE_FONT_FAMILIES,
  KINDLE_FONT_SIZES,
  KINDLE_LAYOUTS,
  KINDLE_LINE_HEIGHTS,
  KINDLE_MARGINS,
  KINDLE_PREF_LABELS,
  type KindlePrefs,
} from "../../shared/kindle-prefs";
export type { KindleMargin } from "./epub-reader";
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
  progressPercent?: number | null;
};

export type InlineLookupResult = {
  word: string;
  entries: LexiconEntryView[] | null;
  saved?: boolean;
  contextSentence?: string | null;
};

export type PracticeQuestionItem = {
  word: string;
  lemma: string;
  pos: string | null;
  contextSentence?: string | null;
  options: { key: "A" | "B" | "C"; text: string; correct: boolean }[];
  questionIndex: number;
  totalQuestions: number;
};

export function escapeHtml(str: string | null | undefined): string {
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

export const KINDLE_CSS = `
  /* Fuentes autoalojadas (OFL) servidas como assets estáticos en /fonts/.
     unicode-range hace que el Kindle descargue solo el subset que usa;
     format("woff2") es el más compatible con navegadores e-ink viejos. */
  @font-face {
    font-family: "Literata";
    font-style: normal;
    font-display: swap;
    font-weight: 200 900;
    src: url("/fonts/literata-latin-standard-normal.woff2") format("woff2");
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
      U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
      U+2212, U+2215, U+FEFF, U+FFFD;
  }
  @font-face {
    font-family: "Literata";
    font-style: italic;
    font-display: swap;
    font-weight: 200 900;
    src: url("/fonts/literata-latin-standard-italic.woff2") format("woff2");
    unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
      U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193,
      U+2212, U+2215, U+FEFF, U+FFFD;
  }
  @font-face {
    font-family: "Literata";
    font-style: normal;
    font-display: swap;
    font-weight: 200 900;
    src: url("/fonts/literata-latin-ext-standard-normal.woff2") format("woff2");
    unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF,
      U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20AB,
      U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
  }
  @font-face {
    font-family: "Literata";
    font-style: italic;
    font-display: swap;
    font-weight: 200 900;
    src: url("/fonts/literata-latin-ext-standard-italic.woff2") format("woff2");
    unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF,
      U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20AB,
      U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
  }
  @font-face {
    font-family: "Source Serif 4";
    font-style: normal;
    font-display: swap;
    font-weight: 200 900;
    src: url("/fonts/source-serif-4-latin-opsz-normal.woff2") format("woff2");
  }
  @font-face {
    font-family: "Source Serif 4";
    font-style: italic;
    font-display: swap;
    font-weight: 200 900;
    src: url("/fonts/source-serif-4-latin-opsz-italic.woff2") format("woff2");
  }
  @font-face {
    font-family: "Atkinson Hyperlegible";
    font-style: normal;
    font-display: swap;
    font-weight: 400;
    src: url("/fonts/atkinson-next-latin-400-normal.woff2") format("woff2");
  }
  @font-face {
    font-family: "Atkinson Hyperlegible";
    font-style: normal;
    font-display: swap;
    font-weight: 700;
    src: url("/fonts/atkinson-next-latin-700-normal.woff2") format("woff2");
  }
  @font-face {
    font-family: "OpenDyslexic";
    font-style: normal;
    font-display: swap;
    font-weight: 400;
    src: url("/fonts/opendyslexic-latin-400-normal.woff2") format("woff2");
  }
  @font-face {
    font-family: "OpenDyslexic";
    font-style: normal;
    font-display: swap;
    font-weight: 700;
    src: url("/fonts/opendyslexic-latin-700-normal.woff2") format("woff2");
  }
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
  /* Ajustes de lectura (K2) — <select> nativos: funcionan sin JS y en
     navegadores e-ink antiguos donde :has() no existe. */
  .prefs-group {
    border: 2px solid #000000;
    padding: 12px 14px;
    margin-bottom: 14px;
  }
  .prefs-group legend {
    font-weight: bold;
    padding: 0 6px;
  }
  .prefs-group select {
    width: 100%;
    min-height: 48px;
    padding: 8px 10px;
    font-size: 1.05rem;
    border: 2px solid #000000;
    background: #ffffff;
    color: #000000;
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
  /* Layout paged (1-pantalla Zero-Scroll para Kindle E-ink).
     dvh va después de vh: los motores que lo soportan descuentan la
     barra propia del navegador; los viejos se quedan con vh. */
  body.layout-paged {
    height: 100vh;
    height: 100dvh;
    max-height: 100vh;
    max-height: 100dvh;
    overflow: hidden;
  }
  body.layout-paged .reader-container {
    height: 100vh;
    height: 100dvh;
    max-height: 100vh;
    max-height: 100dvh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .reader-container.margin-sm { padding: 6px 12px; max-width: 720px; }
  .reader-container.margin-md { padding: 8px 22px; max-width: 630px; }
  .reader-container.margin-lg { padding: 10px 38px; max-width: 550px; }

  body.layout-paged .epub-content {
    flex: 1 1 auto;
    overflow: hidden;
    margin: 4px 0 6px 0;
    max-height: calc(100vh - 82px);
    max-height: calc(100dvh - 82px);
  }
  /* Una figura nunca desborda la página: el alto tope es la caja misma. */
  body.layout-paged .epub-content img {
    max-height: 100%;
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

  /* Índice del libro (K6) */
  .toc-title {
    font-family: Georgia, "Bookerly", serif;
    font-size: 1.5rem;
    margin: 10px 0 8px 0;
    border-bottom: 2px solid #000000;
    padding-bottom: 6px;
  }
  .toc-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .toc-item a {
    display: block;
    padding: 11px 6px;
    border-bottom: 1px solid #999999;
    color: #000000;
    text-decoration: none;
    font-size: 1.05rem;
    line-height: 1.35;
  }
  .toc-item.is-current a {
    font-weight: bold;
    background: #eeeeee;
  }
  .toc-empty {
    padding: 14px 6px;
    color: #333333;
    font-size: 1rem;
    list-style: none;
  }

  /* Barra superior compacta (<= 36px) */
  .reader-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
    height: 36px;
    max-height: 36px;
    min-height: 36px;
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
    min-height: 44px;
    padding: 8px 4px;
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
    padding: 6px 10px;
    min-height: 44px;
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
    padding: 6px 10px;
    min-height: 44px;
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
    max-width: calc(100vw - 16px);
    min-width: 180px;
    box-shadow: none;
  }
  /* Tarjeta de definición en línea (Flotante en layout-paged para preservar Zero-Scroll) */
  .inline-lookup-backdrop {
    display: none;
  }
  body.layout-paged .inline-lookup-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 90;
    background: transparent;
    text-decoration: none;
  }
  .inline-lookup-card {
    border: 2px solid #000000;
    border-left: 5px solid #000000;
    background: #ffffff;
    padding: 10px 14px;
    margin-bottom: 8px;
    position: relative;
    z-index: 95;
  }
  body.layout-paged .inline-lookup-card {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 52px;
    max-width: 636px;
    margin: 0 auto;
  }
  /* Tarjetas de diccionario embebidas (sin recarga): ocultas por defecto,
     se muestran al coincidir el hash (#dict-<palabra>) con su id. */
  .dict-card {
    display: none;
  }
  .dict-card:target {
    display: block;
    border: 2px solid #000000;
    border-left: 5px solid #000000;
    background: #ffffff;
    color: #000000;
    padding: 10px 14px;
    margin-bottom: 8px;
    position: relative;
    z-index: 95;
  }
  body.layout-paged .dict-card:target {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 52px;
    max-width: 636px;
    margin: 0 auto;
  }
  .inline-lookup-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
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
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    min-width: 44px;
    padding: 6px 12px;
    border: 2px solid #000000;
    color: #000000;
    background: #ffffff;
    text-decoration: none;
    font-size: 0.82rem;
    font-weight: bold;
  }
  .eink-refresh-overlay {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 9999;
    pointer-events: none;
    background: #000000;
  }
  .practice-episodic-quote {
    margin: 0 0 16px 0;
    padding: 8px 12px;
    border-left: 3px solid #000000;
    background: #f8f8f8;
    font-size: 0.95rem;
    font-style: italic;
    line-height: 1.45;
    color: #111111;
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
    min-height: 44px;
    min-width: 44px;
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
  .epub-content.mode-clean p,
  .epub-content.mode-anchors p {
    margin: 0;
    text-indent: 1.35em;
  }
  .epub-content.mode-clean > p:first-of-type,
  .epub-content.mode-clean h1 + p,
  .epub-content.mode-clean h2 + p,
  .epub-content.mode-anchors > p:first-of-type,
  .epub-content.mode-anchors h1 + p,
  .epub-content.mode-anchors h2 + p {
    text-indent: 0;
  }
  .epub-content.mode-paragraphs p {
    margin: 0 0 1.4em 0;
    text-indent: 0;
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
  /* Subrayado de pasajes (progresivo, sin servidor) */
  mark.hl, .epub-content p.hl {
    background: transparent;
    text-decoration: underline;
    text-decoration-thickness: 2px;
    text-underline-offset: 3px;
  }
  .lookup-active .w {
    text-decoration: underline;
    text-decoration-style: dotted;
  }
  /* Tamaños de fuente */
  .epub-content.size-sm { font-size: 1.0rem; }
  .epub-content.size-md { font-size: 1.18rem; }
  .epub-content.size-lg { font-size: 1.35rem; }
  .epub-content.size-xl { font-size: 1.55rem; }
  .epub-content.size-xxl { font-size: 1.8rem; }
  /* Interlineado configurable (K2/K3) */
  .epub-content.lh-compact { line-height: 1.42; }
  .epub-content.lh-normal { line-height: 1.58; }
  .epub-content.lh-loose { line-height: 1.78; }
  /* Alineación */
  .epub-content.align-justify { text-align: justify; }
  .epub-content.align-left { text-align: left; }
  /* Familias tipográficas (stacks con fallback hasta el @font-face de K3) */
  .epub-content.font-literata { font-family: "Literata", Georgia, "Times New Roman", serif; }
  .epub-content.font-source-serif { font-family: "Source Serif 4", "Source Serif Pro", Georgia, serif; }
  .epub-content.font-atkinson { font-family: "Atkinson Hyperlegible", Verdana, sans-serif; }
  .epub-content.font-opendyslexic { font-family: "OpenDyslexic", "Atkinson Hyperlegible", Verdana, sans-serif; }
  /* Anclas de lectura */
  .epub-content.mode-anchors .w .anc {
    font-weight: bold;
  }

  /* Barra inferior compacta de una sola línea (<= 36px) */
  .turn-page-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 36px;
    max-height: 36px;
    min-height: 36px;
    margin: 2px 0 0 0;
    padding: 0 4px;
    border-top: 1px solid #dcdcdc;
    font-size: 0.78rem;
    line-height: 36px;
    box-sizing: border-box;
    width: 100%;
  }
  .turn-page-bar .turn-btn {
    min-height: 36px;
    line-height: 36px;
  }
  .turn-btn {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
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
  body.inverted {
    background: #000000;
    color: #ffffff;
  }
  body.inverted .epub-content img {
    filter: invert(1) grayscale(1);
  }
`;

function renderBaseHtml(options: {
  title: string;
  user: KindleUser | null;
  bodyHtml: string;
  returnTo?: string;
  lang?: string;
}): string {
  const { title, user, bodyHtml, lang = "es" } = options;
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
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
        <a href="/k/ajustes">Ajustes</a>
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
  /** Libro destacado «Seguir leyendo» (el de posición más reciente). */
  heroBook?: KindleBookItem | null;
  /** Palabras con repaso vencido hoy (FSRS due <= ahora). */
  dueCount?: number;
  page?: number;
  totalPages?: number;
}): string {
  const { user, books, heroBook, dueCount, page = 1, totalPages = 1 } = options;

  let bodyHtml: string;

  const bookCard = (b: KindleBookItem) => {
    const sectionNum = (b.currentSection ?? 0) + 1;
    const totalSec = b.sections || 1;
    const percent =
      b.progressPercent != null ? Math.round(b.progressPercent * 100) : null;
    const progressText =
      percent !== null
        ? `Sección ${sectionNum} de ${totalSec} (${percent}%)`
        : `Sin empezar · ${totalSec} secciones`;

    const targetSec = b.currentSection ?? 0;
    const isAtStart =
      (b.currentSection == null || b.currentSection === 0) &&
      (b.progressPercent == null || b.progressPercent === 0);
    // Con posición guardada NO se fija page= : la ruta resuelve la
    // página por ancla o ratio y reanuda dentro del capítulo.
    const readUrl = isAtStart
      ? `/k/read/${encodeURIComponent(b.hash)}?section=${targetSec}&page=0`
      : `/k/read/${encodeURIComponent(b.hash)}?section=${targetSec}`;
    const readLabel = isAtStart ? "Comenzar lectura →" : "Continuar lectura →";

    const displayTitle = !b.title || isHashLikeIdentifier(b.title)
      ? b.author && b.author !== "Autor desconocido"
        ? `Libro de ${b.author}`
        : "Libro sin título"
      : b.title;

    return `
      <div class="card">
        <h2 style="margin:0 0 6px 0; font-size:1.25rem;">${escapeHtml(displayTitle)}</h2>
        <p style="margin:0 0 10px 0; font-style:italic; color:#444;">${escapeHtml(b.author || "Autor desconocido")}</p>
        <p style="margin:0 0 14px 0; font-size:0.95rem;"><strong>Progreso:</strong> ${escapeHtml(progressText)}</p>
        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <a href="${readUrl}" class="btn btn-primary">${readLabel}</a>
          <a href="/k/read/${encodeURIComponent(b.hash)}?section=${targetSec}&prep=1" class="btn btn-sm">Antes de leer</a>
        </div>
      </div>
    `;
  };

  if (!user) {
    // Sin sesión la ruta redirige a /kindle; este es el respaldo sin bucket
    bodyHtml = `
      <div class="card" style="text-align:center; padding: 24px 16px;">
        <h1 style="margin-top:0;">Lecta para Kindle y E-ink</h1>
        <p>Vincula tu dispositivo con un código de un solo uso o entra con tu cuenta.</p>
        <p style="margin-top: 20px;">
          <a href="/kindle" class="btn btn-primary" style="font-size: 1.15rem; padding: 12px 24px; display: inline-block;">Vincular con código (1 toque)</a>
          <br /><br />
          <a href="/k/login" style="font-size: 0.95rem; color: #555; text-decoration: underline;">O entrar con correo y contraseña</a>
        </p>
      </div>
    `;
  } else {
    // — «Seguir leyendo»: el libro con la posición más reciente, un toque —
    let heroHtml = "";
    if (heroBook) {
      const targetSec = heroBook.currentSection ?? 0;
      const percent =
        heroBook.progressPercent != null
          ? Math.round(heroBook.progressPercent * 100)
          : null;
      const isAtStart =
        (heroBook.currentSection == null || heroBook.currentSection === 0) &&
        (heroBook.progressPercent == null || heroBook.progressPercent === 0);
      const readUrl = isAtStart
        ? `/k/read/${encodeURIComponent(heroBook.hash)}?section=${targetSec}&page=0`
        : `/k/read/${encodeURIComponent(heroBook.hash)}?section=${targetSec}`;
      const displayTitle =
        !heroBook.title || isHashLikeIdentifier(heroBook.title)
          ? heroBook.author && heroBook.author !== "Autor desconocido"
            ? `Libro de ${heroBook.author}`
            : "Libro sin título"
          : heroBook.title;
      heroHtml = `
        <div class="card" style="border:2px solid #000000; padding:18px; margin-bottom:16px;">
          <div style="font-size:0.82rem; font-weight:bold; letter-spacing:2px; margin-bottom:6px;">SEGUIR LEYENDO</div>
          <h1 style="margin:0 0 4px 0; font-size:1.45rem;">${escapeHtml(displayTitle)}</h1>
          <p style="margin:0 0 12px 0; color:#444; font-size:0.95rem;">
            ${escapeHtml(heroBook.author || "Autor desconocido")} · Sección ${targetSec + 1}${percent !== null ? ` · ${percent}%` : ""}
          </p>
          <a href="${readUrl}" class="btn btn-primary" style="display:block; text-align:center; font-size:1.2rem; padding:16px 20px; text-decoration:none;">${isAtStart ? "Comenzar lectura →" : "Continuar lectura →"}</a>
        </div>`;
    }

    const repasoHtml =
      dueCount && dueCount > 0
        ? `
        <div class="card" style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div>
            <strong>Repaso del día</strong><br />
            <span style="font-size:0.95rem; color:#444;">${dueCount} palabra${dueCount === 1 ? "" : "s"} esperan repaso.</span>
          </div>
          <a href="/k/practice" class="btn btn-primary">Practicar →</a>
        </div>`
        : "";

    const booksHtml =
      books.length === 0
        ? heroBook
          ? ""
          : `
        <div class="card">
          <p><strong>Aún no tienes libros en tu estantería.</strong></p>
          <p>Sube tus libros en formato EPUB desde tu ordenador o móvil en la versión principal de Lecta, y aparecerán aquí automáticamente.</p>
        </div>`
        : books.map(bookCard).join("");

    const pagerHtml =
      totalPages > 1
        ? `
        <nav class="turn-page-bar" style="margin-top:14px;">
          ${
            page > 1
              ? `<a href="/k?pag=${page - 1}" class="turn-btn turn-btn-prev">[ ← Ant. ]</a>`
              : `<span class="turn-btn turn-btn-prev disabled">[ ← Ant. ]</span>`
          }
          <div class="turn-page-indicator">Pág. ${page} de ${totalPages}</div>
          ${
            page < totalPages
              ? `<a href="/k?pag=${page + 1}" class="turn-btn turn-btn-next">[ Sig. → ]</a>`
              : `<span class="turn-btn turn-btn-next disabled">[ Sig. → ]</span>`
          }
        </nav>`
        : "";

    bodyHtml = `
      ${heroHtml}
      ${repasoHtml}
      ${
        booksHtml
          ? `<div style="margin: 6px 0 12px 0;">
        <h2 style="margin: 0; font-size: 1.2rem;">Biblioteca</h2>
      </div>
      ${booksHtml}
      ${pagerHtml}`
          : booksHtml
      }
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
      <div style="font-size: 3.5rem; font-weight: bold; letter-spacing: 0.6rem; margin: 1.5rem 0; color: #000000; font-family: monospace;">
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
      <meta http-equiv="refresh" content="6; url=/api/kindle/status?code=${encodeURIComponent(code)}&redirect=1" />
    </noscript>
  `;

  return renderBaseHtml({
    title: "Vincular Kindle",
    user,
    bodyHtml,
  });
}

/**
 * Nota al margen de Lecta+ (docs/designs/2026-11-12-planes-y-landing.md): el
 * portal e-ink es de Lecta+. Sin JavaScript; enlaza al Carné en la app.
 */
export function renderKindlePlanRequiredView(): string {
  const bodyHtml = `
    <div class="card" style="max-width: 520px; margin: 2rem auto; padding: 2rem 1.5rem;">
      <h1 style="font-size: 1.4rem; margin-top: 0;">Leer en tu Kindle es de Lecta+</h1>
      <p style="font-size: 1rem; line-height: 1.5;">
        Tu posición y tus palabras siguen guardadas en tu cuenta. Para leer aquí,
        activa Lecta+ desde «Tú» en tu celular o tu compu.
      </p>
      <p><a href="/?carne=1" class="btn btn-primary" style="display: block; text-align: center; padding: 12px; text-decoration: none;">Ver Lecta+</a></p>
      <p><a href="/k/logout">Cerrar sesión en este Kindle</a></p>
    </div>
  `;
  return renderBaseHtml({ title: "Lecta+", user: null, bodyHtml });
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
  savedNotice?: string | null;
  lookupResult?: InlineLookupResult | null;
  /** Tarjetas de diccionario embebidas (sin recarga), ocultas por defecto. */
  dictCardsHtml?: string;
  mode?: "clean" | "paragraphs" | "lexicon" | "anchors";
  size?: "sm" | "md" | "lg" | "xl" | "xxl";
  margin?: KindleMargin;
  fontFamily?: string;
  lineHeight?: string;
  align?: string;
  primingOff?: boolean;
  inverted?: boolean;
  layout?: "paged" | "scroll";
  language?: string;
  /** URL de la vista de índice (si el EPUB trae nav/NCX). */
  tocUrl?: string | null;
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
    dictCardsHtml = "",
    mode = "clean",
    size = "md",
    margin = "md",
    fontFamily = "literata",
    lineHeight = "normal",
    align = "justify",
    primingOff = false,
    inverted = false,
    layout = "paged",
    language = "es",
    tocUrl,
  } = options;

  const querySuffix = `&mode=${encodeURIComponent(mode)}&size=${encodeURIComponent(size)}&layout=${layout}&margin=${margin}`;
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
      <a href="${escapeHtml(cleanPageUrl)}" class="inline-lookup-backdrop" aria-label="Cerrar definición"></a>
      <div class="inline-lookup-card" role="dialog" aria-label="Definición de ${escapeHtml(lookupResult.word)}">
        <div class="inline-lookup-header">
          <div>
            <span class="inline-lookup-word">${escapeHtml(lookupResult.word)}</span>
            ${firstEntry?.pos ? `<span class="inline-lookup-pos">(${escapeHtml(firstEntry.pos)})</span>` : ""}
          </div>
          <a href="${escapeHtml(cleanPageUrl)}" class="inline-lookup-close">Cerrar</a>
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
                <input type="hidden" name="context" value="${escapeHtml(lookupResult.contextSentence || "")}" />
                <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
                <input type="hidden" name="language" value="${escapeHtml(language)}" />
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
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bookTitle)} (${sectionIndex + 1}/${totalSections} — ${pageIndex + 1}/${totalPages}) — Lecta</title>
  <style>${KINDLE_CSS}</style>
</head>
<body class="reader-body layout-${escapeHtml(layout)}${inverted ? " inverted" : ""}">
  <main class="reader-container margin-${escapeHtml(margin)}">
    <header class="reader-header">
      <div class="reader-header-left">
        <a href="/k" class="reader-back-btn">← Libros</a>
        <button type="button" id="lookupToggle" class="lookup-btn" aria-pressed="false">Consultar</button>
      </div>
      <div class="reader-header-info">
        <span class="reader-header-title">${escapeHtml(bookTitle)}</span>
        <span class="reader-header-sep">·</span>
        <span class="reader-header-author">${escapeHtml(bookAuthor)}</span>
      </div>
      <div class="reader-header-meta">
        <span id="fitIndicator" style="display:none; font-size:0.7rem; color:#888;" title="Letra ajustada a esta página">≈</span>
        ${tocUrl ? `<a href="${escapeHtml(tocUrl)}" class="reader-header-prep" title="Índice del libro">Índice</a>` : ""}
        <details class="reader-header-menu">
          <summary class="reader-menu-summary">Aa · Menú</summary>
          <div class="reader-menu-content">
            <div class="mode-selector">
              <span style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:4px;">Enfoque:</span>
              <div style="display:flex; gap:4px; margin-bottom:8px; flex-wrap:wrap;">
                <a href="${baseParamUrl}&amp;mode=clean&amp;size=${size}&amp;layout=${layout}&amp;margin=${margin}&amp;font=${fontFamily}" class="mode-tab ${mode === "clean" ? "is-active" : ""}">[ Limpio ]</a>
                <a href="${baseParamUrl}&amp;mode=paragraphs&amp;size=${size}&amp;layout=${layout}&amp;margin=${margin}&amp;font=${fontFamily}" class="mode-tab ${mode === "paragraphs" ? "is-active" : ""}">[ Párrafos aireados ]</a>
                <a href="${baseParamUrl}&amp;mode=anchors&amp;size=${size}&amp;layout=${layout}&amp;margin=${margin}&amp;font=${fontFamily}" class="mode-tab ${mode === "anchors" ? "is-active" : ""}">[ Anclas de lectura ]</a>
              </div>
              <span style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:4px;">Letra:</span>
              <div class="size-selector" style="display:flex; gap:4px; margin-bottom:8px;">
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=sm&amp;layout=${layout}&amp;margin=${margin}&amp;font=${fontFamily}" class="size-btn ${size === "sm" ? "is-active" : ""}">P</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=md&amp;layout=${layout}&amp;margin=${margin}&amp;font=${fontFamily}" class="size-btn ${size === "md" ? "is-active" : ""}">M</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=lg&amp;layout=${layout}&amp;margin=${margin}&amp;font=${fontFamily}" class="size-btn ${size === "lg" ? "is-active" : ""}">G</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=xl&amp;layout=${layout}&amp;margin=${margin}&amp;font=${fontFamily}" class="size-btn ${size === "xl" ? "is-active" : ""}">XG</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=xxl&amp;layout=${layout}&amp;margin=${margin}&amp;font=${fontFamily}" class="size-btn ${size === "xxl" ? "is-active" : ""}">EG</a>
              </div>
              <span style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:4px;">Tipografía:</span>
              <div style="display:flex; gap:4px; margin-bottom:8px; flex-wrap:wrap;">
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=${layout}&amp;margin=${margin}&amp;font=literata" class="size-btn ${fontFamily === "literata" ? "is-active" : ""}">Literata</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=${layout}&amp;margin=${margin}&amp;font=source-serif" class="size-btn ${fontFamily === "source-serif" ? "is-active" : ""}">Source</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=${layout}&amp;margin=${margin}&amp;font=atkinson" class="size-btn ${fontFamily === "atkinson" ? "is-active" : ""}">Atkinson</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=${layout}&amp;margin=${margin}&amp;font=opendyslexic" class="size-btn ${fontFamily === "opendyslexic" ? "is-active" : ""}">Dyslexic</a>
              </div>
              <span style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:4px;">Margen:</span>
              <div class="margin-selector" style="display:flex; gap:4px; margin-bottom:8px;">
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=${layout}&amp;margin=sm&amp;font=${fontFamily}" class="size-btn ${margin === 'sm' ? 'is-active' : ''}">Estrecho</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=${layout}&amp;margin=md&amp;font=${fontFamily}" class="size-btn ${margin === 'md' ? 'is-active' : ''}">Normal</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=${layout}&amp;margin=lg&amp;font=${fontFamily}" class="size-btn ${margin === 'lg' ? 'is-active' : ''}">Amplio</a>
              </div>
              <span style="font-size:0.8rem; font-weight:bold; display:block; margin-bottom:4px;">Disposición:</span>
              <div style="display:flex; gap:4px; margin-bottom:8px;">
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=paged&amp;margin=${margin}&amp;font=${fontFamily}" class="mode-tab ${layout === "paged" ? "is-active" : ""}">Paginado</a>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=scroll&amp;margin=${margin}&amp;font=${fontFamily}" class="mode-tab ${layout === "scroll" ? "is-active" : ""}">Scroll</a>
              </div>
              <a href="/k/ajustes?returnTo=${encodeURIComponent(cleanPageUrl)}" class="mode-tab" style="display:block; text-align:center;">Todos los ajustes (Aa) →</a>
              <form method="POST" action="/k/ajustes" style="margin:6px 0 0 0;">
                <input type="hidden" name="fontFamily" value="${escapeHtml(fontFamily)}" />
                <input type="hidden" name="fontSize" value="${escapeHtml(size)}" />
                <input type="hidden" name="lineHeight" value="${escapeHtml(lineHeight)}" />
                <input type="hidden" name="margin" value="${escapeHtml(margin)}" />
                <input type="hidden" name="align" value="${escapeHtml(align)}" />
                <input type="hidden" name="approach" value="${escapeHtml(mode === "lexicon" ? "clean" : mode)}" />
                <input type="hidden" name="layout" value="${escapeHtml(layout)}" />
                <input type="hidden" name="returnTo" value="${escapeHtml(cleanPageUrl)}" />
                <button type="submit" class="mode-tab" style="display:block; width:100%; text-align:center; cursor:pointer; font-family:inherit; font-size:inherit; background:#f4f4f4;">Guardar estos ajustes</button>
              </form>
              <div style="border-top:1px solid #000000; margin-top:8px; padding-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
                <a href="/k/practice?bookHash=${encodeURIComponent(bookHash)}&amp;returnTo=${encodeURIComponent(cleanPageUrl)}" class="mode-tab" title="Practicar vocabulario">Práctica</a>
                <button type="button" id="hlSaveBtn" class="mode-tab" title="Subrayar la selección actual" style="display:none; cursor:pointer; font-family:inherit; font-size:inherit; background:#f4f4f4;">Subrayar selección</button>
                <a href="${baseParamUrl}&amp;mode=${mode}&amp;size=${size}&amp;layout=${layout}&amp;margin=${margin}&amp;font=${fontFamily}&amp;invert=${inverted ? "0" : "1"}" class="mode-tab" title="Modo invertido para E-ink">${inverted ? "Modo normal" : "Modo invertido"}</a>
                <form id="hlForm" method="POST" action="/k/highlight/add" style="display:none;">
                  <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
                  <input type="hidden" name="section" value="${sectionIndex}" />
                  <input type="hidden" name="text" id="hlText" value="" />
                  <input type="hidden" name="returnTo" value="${escapeHtml(cleanPageUrl)}" />
                </form>
                <a href="/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&amp;prep=1" class="mode-tab" title="Antes de leer: vocabulario del capítulo">Antes de leer</a>
                ${
                  primingOff
                    ? `<form method="POST" action="/kindle/priming/action" style="display:inline; margin:0;"><input type="hidden" name="action" value="enable_all" /><input type="hidden" name="returnUrl" value="${escapeHtml(cleanPageUrl)}" /><button type="submit" class="mode-tab" style="background:#ffffff; border:1px solid #888888; cursor:pointer; font-family:inherit; font-size:inherit;" title="Reactivar la antesala automática">Antesala: apagada</button></form>`
                    : `<form method="POST" action="/kindle/priming/action" style="display:inline; margin:0;"><input type="hidden" name="action" value="disable_all" /><input type="hidden" name="returnUrl" value="${escapeHtml(cleanPageUrl)}" /><button type="submit" class="mode-tab" style="background:#ffffff; border:1px solid #888888; cursor:pointer; font-family:inherit; font-size:inherit;" title="Silenciar la antesala automática">Antesala: activa</button></form>`
                }
              </div>
            </div>
          </div>
        </details>
      </div>
    </header>

    ${flashHtml}

    ${lookupHtml}

    ${dictCardsHtml}

    ${pageIndex === 0 && chapterTitle ? `<h2 class="chapter-heading">${escapeHtml(chapterTitle)}</h2>` : ""}

    <div class="epub-content mode-${escapeHtml(mode)} size-${escapeHtml(size)} font-${escapeHtml(fontFamily)} lh-${escapeHtml(lineHeight)} align-${escapeHtml(align)}">
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
  </main>

  <div id="einkRefreshOverlay" class="eink-refresh-overlay" aria-hidden="true"></div>
  <script>
  (function() {
    var lookupBase = ${JSON.stringify(cleanPageUrl)};
    var hlMode = false;
    var prevUrl = ${JSON.stringify(prevUrl || "")};
    var nextUrl = ${JSON.stringify(nextUrl || "")};

    var overlay = document.getElementById('einkRefreshOverlay');
    function runEinkWaveformReset() {
      if (!overlay) return;
      overlay.style.background = '#000000';
      overlay.style.display = 'block';
      setTimeout(function() {
        overlay.style.background = '#ffffff';
        setTimeout(function() {
          overlay.style.display = 'none';
        }, 80);
      }, 80);
    }

    try {
      var turns = parseInt(sessionStorage.getItem('lecta_eink_turns') || '0', 10) + 1;
      sessionStorage.setItem('lecta_eink_turns', String(turns));
      if (turns % 12 === 0) {
        runEinkWaveformReset();
      }
    } catch (_e) {}

    function triggerLookup(rawWord) {
      if (!rawWord) return;
      var w = rawWord.trim().toLowerCase();
      if (!w || w.length < 2 || w.length > 40) return;
      // Si hay tarjeta embebida para esta palabra, mostrarla sin recarga.
      var card = document.getElementById('dict-' + w);
      if (card) {
        if (location.hash !== '#dict-' + w) {
          location.hash = 'dict-' + w;
        }
        return;
      }
      // Fallback (mejora progresiva): navegación completa con ?lookup=.
      var sep = lookupBase.indexOf('?') >= 0 ? '&' : '?';
      window.location.href = lookupBase + sep + 'lookup=' + encodeURIComponent(w);
    }

    function closeDictCard() {
      try { history.replaceState(null, '', lookupBase); } catch (e) { location.hash = ''; }
    }

    // Cierre de tarjetas embebidas sin recarga.
    document.addEventListener('click', function(e) {
      var t = e.target;
      while (t && t !== document.body && (!t.getAttribute || !t.getAttribute('data-dict-close'))) {
        // buscar enlace de cierre dentro de .dict-card
        if (t.classList && t.classList.contains('inline-lookup-close')) {
          var parent = t;
          while (parent && parent !== document.body && !(parent.classList && parent.classList.contains('dict-card'))) {
            parent = parent.parentElement;
          }
          if (parent && parent.classList && parent.classList.contains('dict-card')) {
            e.preventDefault();
            closeDictCard();
            return;
          }
        }
        t = t.parentElement;
      }
    }, false);

    // Guardar en Cuaderno sin recarga (fire-and-forget).
    document.addEventListener('submit', function(e) {
      var form = e.target;
      if (!form || !form.getAttribute || form.getAttribute('data-dict-save') !== '1') return;
      if (typeof fetch !== 'function') return; // fallback submit normal
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      var action = form.getAttribute('action') || '/k/vocab/add';
      try {
        var fd = new FormData(form);
        fetch(action, { method: 'POST', body: fd }).then(function() {
          if (btn) btn.textContent = 'Guardada';
        }).catch(function() { form.submit(); });
      } catch (err) {
        form.submit();
      }
    }, false);

    var content = document.querySelector('.epub-content');
    var toggleBtn = document.getElementById('lookupToggle');

    // Ajuste al área visible real (solo modo paginado): el navegador de
    // Kindle declara un viewport más alto que la zona que su barra
    // inferior deja libre, y el último renglón quedaba tapado a media
    // letra. Se toma la medida más conservadora entre las fuentes.
    var isPaged = document.body && document.body.className.indexOf('layout-paged') >= 0;
    var container = isPaged ? document.querySelector('.reader-container') : null;
    var vv = window.visualViewport;
    var visibleH = 0;
    var vSources = [
      vv && vv.height,
      window.innerHeight,
      document.documentElement ? document.documentElement.clientHeight : 0
    ];
    for (var vi = 0; vi < vSources.length; vi++) {
      var hv = Math.round(vSources[vi] || 0);
      if (hv > 0 && (visibleH === 0 || hv < visibleH)) visibleH = hv;
    }
    if (
      container &&
      visibleH > 320 &&
      (!vv || !vv.scale || vv.scale < 1.05) &&
      container.clientHeight > visibleH + 2
    ) {
      container.style.height = visibleH + 'px';
      container.style.maxHeight = visibleH + 'px';
    }

    // Garantía Zero-Scroll: si aun así el contenido desborda la caja
    // (aviso de palabra guardada, título largo, imagen, margen de bloque),
    // se reduce la letra de ESTA página hasta que quepa sin recortar
    // renglones — el texto tapado era ilegible e irrecuperable.
    if (content && isPaged) {
      var imgs = content.getElementsByTagName('img');
      for (var ii = 0; ii < imgs.length; ii++) {
        imgs[ii].style.maxHeight = Math.max(60, content.clientHeight - 12) + 'px';
      }
      var cs = window.getComputedStyle ? getComputedStyle(content) : null;
      var basePx = cs && cs.fontSize ? parseFloat(cs.fontSize) : 0;
      if (!basePx || basePx <= 0) basePx = 22;
      var fitGuard = 0;
      while (content.scrollHeight > content.clientHeight + 1 && fitGuard < 3) {
        fitGuard++;
        content.style.fontSize = (basePx * (1 - fitGuard * 0.028)).toFixed(2) + 'px';
      }
      if (fitGuard > 0) {
        try {
          var ind = document.getElementById('fitIndicator');
          if (ind) ind.style.display = 'inline';
        } catch (e) {}
      }
    }

    // Reporte del viewport real (K5): una cookie por dispositivo, para que
    // el servidor escale los presupuestos de página a ESTA pantalla en el
    // siguiente paso. Sin recarga: la medida viaja con el próximo toque.
    try {
      var kvw = Math.round(window.innerWidth || 0);
      var kvh = Math.round(window.innerHeight || 0);
      if (kvw >= 240 && kvh >= 240) {
        var vpVal = kvw + 'x' + kvh;
        var vpCur = (document.cookie.match(/(?:^|; *)lecta_k_vp=([^;]*)/) || [])[1];
        if (vpCur !== vpVal) {
          document.cookie =
            'lecta_k_vp=' + vpVal + ';path=/k;max-age=31536000;SameSite=Lax';
        }
      }
    } catch (e) { /* sin cookie el servidor usa el presupuesto de referencia */ }

    if (toggleBtn && content) {
      toggleBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        var active = content.classList.toggle('lookup-active');
        toggleBtn.classList.toggle('is-active', active);
        toggleBtn.textContent = active ? 'Consultando' : 'Consultar';
        toggleBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }

    var pressTimer = null;
    var startX = 0;
    var startY = 0;
    var startTime = 0;
    var lastGestureAt = 0;

    function clearTimer() {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }

    if (content) {
      content.addEventListener('touchstart', function(e) {
        if (!e.touches || !e.touches[0]) return;
        var touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        startTime = Date.now();
        clearTimer();

        var t = e.target;
        while (t && t !== content && (!t.getAttribute || !t.getAttribute('data-w'))) {
          t = t.parentElement;
        }
        if (t && t.getAttribute && t.getAttribute('data-w')) {
          var word = t.getAttribute('data-w');
          pressTimer = setTimeout(function() {
            pressTimer = null;
            lastGestureAt = Date.now();
            triggerLookup(word);
          }, 450);
        }
      }, false);

      content.addEventListener('touchmove', function(e) {
        if (pressTimer && e.touches && e.touches[0]) {
          var dx = Math.abs(e.touches[0].clientX - startX);
          var dy = Math.abs(e.touches[0].clientY - startY);
          if (dx > 12 || dy > 12) {
            clearTimer();
          }
        }
      }, false);

      content.addEventListener('touchend', function(e) {
        clearTimer();
        var dt = Date.now() - startTime;
        if (e.changedTouches && e.changedTouches[0] && startTime > 0) {
          var dx = e.changedTouches[0].clientX - startX;
          var dy = e.changedTouches[0].clientY - startY;
          if (Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.8 && dt >= 30 && dt <= 900) {
            lastGestureAt = Date.now();
            if (dx < 0 && nextUrl) {
              window.location.href = nextUrl;
              return;
            } else if (dx > 0 && prevUrl) {
              window.location.href = prevUrl;
              return;
            }
          }
        }

        var sel = window.getSelection ? window.getSelection().toString().trim() : '';
        if (sel && sel.length >= 2 && sel.length <= 35) {
          lastGestureAt = Date.now();
          triggerLookup(sel);
        }
      }, false);

      content.addEventListener('touchcancel', clearTimer, false);

      content.addEventListener('click', function(e) {
        if (hlMode) return;
        if (Date.now() - lastGestureAt < 500) {
          e.preventDefault();
          return;
        }
        var sel = window.getSelection ? window.getSelection().toString().trim() : '';
        if (sel) return;

        var isLookupMode = content.classList.contains('lookup-active');
        if (isLookupMode) {
          var t = e.target;
          while (t && t !== content && (!t.getAttribute || !t.getAttribute('data-w'))) {
            t = t.parentElement;
          }
          if (t && t.getAttribute && t.getAttribute('data-w')) {
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

    // --- Subrayado de pasajes: selección -> POST /k/highlight/add ---
    var hlBtn = document.getElementById('hlSaveBtn');
    var hlText = document.getElementById('hlText');
    var hlForm = document.getElementById('hlForm');
    function currentSelection() {
      try { return (window.getSelection ? window.getSelection().toString() : '').trim(); }
      catch (e) { return ''; }
    }
    if (content) {
      content.addEventListener('mouseup', function() {
        var sel = currentSelection();
        if (sel.length >= 4 && sel.length <= 600 && hlBtn) {
          hlBtn.style.display = 'inline-flex';
        } else if (hlBtn) {
          hlBtn.style.display = 'none';
        }
      });
      content.addEventListener('touchend', function() {
        setTimeout(function() {
          var sel = currentSelection();
          if (sel.length >= 4 && sel.length <= 600 && hlBtn) hlBtn.style.display = 'inline-flex';
          else if (hlBtn) hlBtn.style.display = 'none';
        }, 50);
      });
    }
    if (hlBtn && hlText && hlForm) {
      hlBtn.addEventListener('click', function() {
        var sel = currentSelection();
        if (!sel) return;
        hlText.value = sel;
        hlForm.submit();
      });
    }
  })();
  </script>
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
  language?: string;
}): string {
  const { user, query, entries, saved, returnTo = "/k", bookHash = "", language = "es" } = options;

  const backLink = returnTo
    ? `<p><a href="${escapeHtml(returnTo)}" class="btn btn-sm">← Volver al libro</a></p>`
    : "";

  let resultHtml = "";

  if (saved) {
    resultHtml += `<div class="alert alert-success">Palabra «${escapeHtml(query)}» guardada en tu Cuaderno de Lecta.</div>`;
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
                <input type="hidden" name="language" value="${escapeHtml(language)}" />
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
        <input type="text" name="q" class="form-control" aria-label="Palabra a buscar en el diccionario" value="${escapeHtml(query)}" placeholder="Escribe una palabra..." required />
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

        ${
          question.contextSentence
            ? `<blockquote class="practice-episodic-quote">«${escapeHtml(question.contextSentence)}»</blockquote>`
            : ""
        }

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
              <button type="submit" class="k-btn k-btn--small">Ya la sé</button>
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
<html lang="${escapeHtml(bookLang)}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
      min-height: 44px;
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
        if (btn) { btn.textContent = 'Guardada'; btn.disabled = true; }
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


// ── /k/ajustes — Preferencias de lectura Kindle (K2) ──────────────────────

/** K6 — Vista de índice del libro (TOC real del EPUB). */
export function renderKindleTocView(options: {
  user: KindleUser | null;
  bookHash: string;
  bookTitle: string;
  bookAuthor: string;
  toc: { title: string; sectionIndex: number }[];
  currentSection: number;
  querySuffix: string;
  backUrl: string;
  language?: string;
}): string {
  const {
    bookHash,
    bookTitle,
    bookAuthor,
    toc,
    currentSection,
    querySuffix,
    backUrl,
    language = "es",
  } = options;

  const currentIdx = toc.findIndex((e) => e.sectionIndex === currentSection);
  const progressPercent =
    toc.length > 0 && currentIdx >= 0
      ? Math.round(((currentIdx + 1) / toc.length) * 100)
      : null;
  const items =
    toc.length > 0
      ? toc
          .map(
            (entry) => `
      <li class="toc-item ${entry.sectionIndex === currentSection ? "is-current" : ""}">
        <a href="/k/read/${encodeURIComponent(bookHash)}?section=${entry.sectionIndex}&amp;page=0${querySuffix}">
          ${entry.sectionIndex === currentSection ? "▸ " : ""}${escapeHtml(entry.title)}
          ${entry.sectionIndex < currentSection ? " ✓" : ""}
        </a>
      </li>`,
          )
          .join("")
      : `<li class="toc-empty">Este libro no trae índice navegable. Avanza con «Siguiente» para recorrerlo.</li>`;

  return `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Índice — ${escapeHtml(bookTitle)} — Lecta</title>
  <style>${KINDLE_CSS}</style>
</head>
<body class="reader-body">
  <main class="reader-container">
    <header class="reader-header">
      <div class="reader-header-left">
        <a href="${escapeHtml(backUrl)}" class="reader-back-btn">← Volver al libro</a>
      </div>
      <div class="reader-header-info">
        <span class="reader-header-title">${escapeHtml(bookTitle)}</span>
        <span class="reader-header-sep">·</span>
        <span class="reader-header-author">${escapeHtml(bookAuthor)}</span>
      </div>
      <div class="reader-header-meta">
        ${progressPercent !== null ? `<span class="reader-header-prep" title="Progreso en el índice">${progressPercent}%</span>` : ""}
        <a href="/k/ajustes?returnTo=${encodeURIComponent(backUrl)}" class="reader-header-prep">Ajustes</a>
      </div>
    </header>

    <h1 class="toc-title">Índice</h1>
    <ol class="toc-list">
      ${items}
    </ol>
  </main>
</body>
</html>`;
}

function prefsSelect(
  name: string,
  legend: string,
  options: readonly string[],
  current: string,
): string {
  const opts = options
    .map(
      (v) =>
        `<option value="${escapeHtml(v)}"${v === current ? " selected" : ""}>${escapeHtml(
          KINDLE_PREF_LABELS[name]?.[v] ?? v,
        )}</option>`,
    )
    .join("");
  return `<fieldset class="prefs-group">
      <legend>${escapeHtml(legend)}</legend>
      <select name="${escapeHtml(name)}" aria-label="${escapeHtml(legend)}">${opts}</select>
    </fieldset>`;
}

export function renderKindleSettingsView(options: {
  prefs?: KindlePrefs;
  returnTo?: string;
  saved?: boolean;
  error?: string | null;
  user?: KindleUser | null;
}): string {
  const {
    prefs = DEFAULT_KINDLE_PREFS,
    returnTo = "/k",
    saved = false,
    error = null,
    user = null,
  } = options;

  const body = `
    <h1 style="font-size:1.5rem; margin:0 0 14px;">Ajustes de lectura</h1>
    ${saved ? `<div class="alert alert-success">Ajustes guardados. Tu Kindle los usará al abrir cualquier página.</div>` : ""}
    ${error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ""}
    <p style="margin:0 0 16px;">Estos ajustes se guardan en tu cuenta y se aplican en cualquier Kindle vinculado.</p>
    <form method="POST" action="/k/ajustes">
      <input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}" />
      ${prefsSelect("fontFamily", "Tipografía", KINDLE_FONT_FAMILIES, prefs.fontFamily)}
      ${prefsSelect("fontSize", "Tamaño de letra", KINDLE_FONT_SIZES, prefs.fontSize)}
      ${prefsSelect("lineHeight", "Interlineado", KINDLE_LINE_HEIGHTS, prefs.lineHeight)}
      ${prefsSelect("margin", "Margen", KINDLE_MARGINS, prefs.margin)}
      ${prefsSelect("align", "Alineación", KINDLE_ALIGNS, prefs.align)}
      ${prefsSelect("approach", "Enfoque de lectura", KINDLE_APPROACHES, prefs.approach)}
      ${prefsSelect("layout", "Disposición", KINDLE_LAYOUTS, prefs.layout)}
      <button type="submit" class="btn btn-primary" style="width:100%; min-height:52px; font-size:1.1rem;">Guardar en mi Kindle</button>
    </form>
    <p style="margin-top:14px;"><a href="${escapeHtml(returnTo)}">← Volver</a></p>
  `;

  return renderBaseHtml({
    title: "Ajustes de lectura",
    user,
    bodyHtml: body,
    lang: "es",
  });
}
