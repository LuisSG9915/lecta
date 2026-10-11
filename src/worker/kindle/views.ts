// Plantillas HTML generadas en servidor para la interfaz Kindle / E-ink de Lecta.
// Cero JavaScript en el cliente, alto contraste, objetivos táctiles amplios
// y tipografía optimizada para pantallas de tinta electrónica.

import type { LexiconEntryView } from "../lexicon";

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

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const KINDLE_CSS = `
  *, *:before, *:after {
    box-sizing: border-box;
    transition: none !important;
    animation: none !important;
  }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #000000;
    font-family: Georgia, "Source Serif", "Literata", "Times New Roman", serif;
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
    display: inline-block;
    padding: 6px 10px;
    border: 1px solid #000000;
    text-decoration: none;
    color: #000000;
    font-size: 0.95rem;
    margin-left: 4px;
    background: #ffffff;
  }
  .btn {
    display: inline-block;
    padding: 10px 16px;
    border: 2px solid #000000;
    background: #ffffff;
    color: #000000;
    text-decoration: none;
    font-weight: bold;
    font-size: 1rem;
    cursor: pointer;
    text-align: center;
    min-height: 44px;
    line-height: 1.2;
  }
  .btn-primary {
    background: #000000;
    color: #ffffff;
  }
  .btn-sm {
    padding: 6px 12px;
    font-size: 0.9rem;
    min-height: 36px;
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
    padding: 10px 22px 20px 22px;
  }
  .reader-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid #dcdcdc;
    margin-bottom: 16px;
    font-size: 0.82rem;
    line-height: 1.2;
    color: #444444;
  }
  .reader-back-btn {
    display: inline-block;
    color: #222222;
    text-decoration: none;
    font-size: 0.82rem;
    white-space: nowrap;
  }
  .reader-back-btn:hover {
    text-decoration: underline;
  }
  .reader-header-info {
    flex-grow: 1;
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 8px;
    font-size: 0.78rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .reader-header-title {
    font-weight: bold;
    color: #111111;
  }
  .reader-header-sep {
    margin: 0 4px;
    color: #888888;
  }
  .reader-header-author {
    color: #555555;
    font-style: normal;
  }
  .reader-header-meta {
    font-size: 0.8rem;
    white-space: nowrap;
    color: #222222;
  }
  .reader-header-prep {
    font-size: 0.78rem;
    color: #111111;
    text-decoration: none;
    border: 1px solid #888888;
    padding: 2px 7px;
    margin-left: 6px;
    background: #ffffff;
  }
  /* Tarjeta de definición en línea */
  .inline-lookup-card {
    border: 1px solid #111111;
    border-left: 4px solid #000000;
    background: #ffffff;
    padding: 12px 16px;
    margin-bottom: 18px;
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
  /* Barra para pasar página con un toque */
  .turn-page-bar {
    display: flex;
    align-items: stretch;
    gap: 10px;
    margin-top: 24px;
    padding-top: 14px;
    border-top: 1px solid #e5e5e5;
  }
  .turn-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px 14px;
    border: 2px solid #000000;
    text-decoration: none;
    font-weight: bold;
    font-size: 1rem;
    cursor: pointer;
    min-height: 52px;
    text-align: center;
  }
  .turn-btn-prev {
    background: #ffffff;
    color: #000000;
    flex: 1;
    font-weight: normal;
  }
  .turn-btn-next {
    background: #000000;
    color: #ffffff;
    flex: 2;
    letter-spacing: 0.02em;
  }
  .turn-btn.disabled {
    border-color: #cccccc;
    color: #999999;
    background: #fafafa;
    cursor: not-allowed;
  }
  .turn-page-indicator {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    color: #444444;
    padding: 0 6px;
    white-space: nowrap;
    text-align: center;
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
          <a href="/k/login" class="btn btn-primary" style="font-size: 1.15rem; padding: 12px 24px;">Iniciar sesión en mi cuenta</a>
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

          return `
            <div class="card">
              <h2 style="margin:0 0 6px 0; font-size:1.25rem;">${escapeHtml(b.title)}</h2>
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
  } = options;

  const cleanPageUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex}`;

  const prevUrl =
    pageIndex > 0
      ? `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex - 1}`
      : `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&prep=1`;

  let nextUrl: string | null = null;
  if (pageIndex < totalPages - 1) {
    nextUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&page=${pageIndex + 1}`;
  } else if (sectionIndex < totalSections - 1) {
    // Al terminar el capítulo, pasar al siguiente lleva a su preparación
    nextUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex + 1}&prep=1`;
  }

  const pageRatio = totalPages > 1 ? pageIndex / (totalPages - 1) : 0;
  const percent = totalSections > 1
    ? Math.round(((sectionIndex + pageRatio) / totalSections) * 100)
    : Math.round(pageRatio * 100);

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
                <button type="submit" class="btn-xs" style="padding:4px 10px; font-size:0.85rem;">+ Guardar en mi Cuaderno</button>
              </form>
            `
            : ""
        }
      </div>
    `;
  }


  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(bookTitle)} (${sectionIndex + 1}/${totalSections} — ${pageIndex + 1}/${totalPages}) — Lecta</title>
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
        <a href="/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}&amp;prep=1" class="reader-header-prep" title="Ver vocabulario del capítulo">📖 Prep</a>
      </div>
    </header>

    ${flashHtml}

    ${lookupHtml}

    ${pageIndex === 0 && chapterTitle ? `<h2 class="chapter-heading">${escapeHtml(chapterTitle)}</h2>` : ""}

    <div class="epub-content">
      ${contentHtml}
    </div>

    <nav class="turn-page-bar">
      ${
        hasPrev && prevUrl
          ? `<a href="${escapeHtml(prevUrl)}" class="turn-btn turn-btn-prev">${
              pageIndex === 0 ? "← Antes de leer" : "← Anterior"
            }</a>`
          : `<span class="turn-btn turn-btn-prev disabled">← Anterior</span>`
      }
      <div class="turn-page-indicator">
        Pág. ${pageIndex + 1} de ${totalPages} (${percent}%)
      </div>
      ${
        hasNext && nextUrl
          ? `<a href="${escapeHtml(nextUrl)}" class="turn-btn turn-btn-next">${
              pageIndex === totalPages - 1 && sectionIndex < totalSections - 1
                ? "Siguiente capítulo →"
                : "Siguiente página →"
            }</a>`
          : `<span class="turn-btn turn-btn-next disabled">Fin del libro</span>`
      }
    </nav>
  </div>
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
