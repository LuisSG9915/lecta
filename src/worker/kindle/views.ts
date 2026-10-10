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
  progressPercent?: number | null;
};

function escapeHtml(str: string): string {
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
    font-size: 1.15rem;
    line-height: 1.65;
    text-align: justify;
    word-break: break-word;
  }
  .epub-content p {
    margin: 0.8rem 0;
    text-indent: 1.2rem;
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
    margin-top: 24px;
    padding-top: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }
  .pagination-info {
    font-weight: bold;
    font-size: 0.95rem;
    text-align: center;
    flex-grow: 1;
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

          return `
            <div class="card">
              <h2 style="margin:0 0 6px 0; font-size:1.25rem;">${escapeHtml(b.title)}</h2>
              <p style="margin:0 0 10px 0; font-style:italic; color:#444;">${escapeHtml(b.author || "Autor desconocido")}</p>
              <p style="margin:0 0 14px 0; font-size:0.95rem;"><strong>Progreso:</strong> ${escapeHtml(progressText)}</p>
              <div>
                <a href="/k/read/${encodeURIComponent(b.hash)}" class="btn btn-primary">Continuar lectura →</a>
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
  } = options;

  const prevIndex = sectionIndex - 1;
  const nextIndex = sectionIndex + 1;
  const hasPrev = prevIndex >= 0;
  const hasNext = nextIndex < totalSections;

  const percent = totalSections > 1
    ? Math.round((sectionIndex / (totalSections - 1)) * 100)
    : 100;

  const currentUrl = `/k/read/${encodeURIComponent(bookHash)}?section=${sectionIndex}`;

  const bodyHtml = `
    <div class="reader-meta">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h1 class="reader-title">${escapeHtml(bookTitle)}</h1>
          <span class="reader-author">${escapeHtml(bookAuthor)}</span>
        </div>
        <div>
          <a href="/k" class="btn btn-sm">← Estantería</a>
        </div>
      </div>
    </div>

    ${chapterTitle ? `<h2 class="chapter-heading">${escapeHtml(chapterTitle)}</h2>` : ""}

    <div class="epub-content">
      ${contentHtml}
    </div>

    <nav class="pagination-nav">
      <div>
        ${
          hasPrev
            ? `<a href="/k/read/${encodeURIComponent(bookHash)}?section=${prevIndex}" class="btn">← Anterior</a>`
            : `<span class="btn disabled">← Anterior</span>`
        }
      </div>
      <div class="pagination-info">
        Capítulo ${sectionIndex + 1} de ${totalSections} (${percent}%)
      </div>
      <div>
        ${
          hasNext
            ? `<a href="/k/read/${encodeURIComponent(bookHash)}?section=${nextIndex}" class="btn">Siguiente →</a>`
            : `<span class="btn disabled">Siguiente →</span>`
        }
      </div>
    </nav>

    <div class="quick-lookup-box">
      <form action="/k/lookup" method="GET" class="quick-lookup-form">
        <input type="hidden" name="returnTo" value="${escapeHtml(currentUrl)}" />
        <input type="hidden" name="bookHash" value="${escapeHtml(bookHash)}" />
        <input type="text" name="q" class="form-control" placeholder="Consultar palabra en el diccionario..." required />
        <button type="submit" class="btn btn-primary">Definir</button>
      </form>
    </div>
  `;

  return renderBaseHtml({
    title: `${chapterTitle || bookTitle} (${sectionIndex + 1}/${totalSections})`,
    user,
    bodyHtml,
    returnTo: currentUrl,
  });
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
    ? `<p><a href="${escapeHtml(returnTo)}" class="btn btn-sm">← Volver a la lectura</a></p>`
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
  `;

  return renderBaseHtml({
    title: query ? `Definición de ${query}` : "Diccionario",
    user,
    bodyHtml,
    returnTo,
  });
}
