/**
 * K5 — Arnés de calibración de paginación Kindle (Playwright).
 *
 * Renderiza cada página paginada de un EPUB con el HTML+CSS REALES del
 * lector (`renderReaderView`) en viewports de e-readers comunes y mide:
 *
 *   - %páginas con desborde  (scrollHeight > clientHeight en .epub-content)
 *   - llenado mediano        (scrollHeight / clientHeight — detecta medias páginas)
 *   - escala sugerida        (mediana de client/scroll en páginas desbordadas,
 *                             para re-ajustar KINDLE_PAGE_BUDGETS)
 *
 * El bucle de «encoger letra hasta que quepa» se elimina del HTML medido:
 * es la red de seguridad, no lo que calibramos — aquí interesa el presupuesto
 * de caracteres que produce el servidor ANTES de esa corrección.
 *
 * Uso:
 *   pnpm calibrate:kindle                          # Azul, md, 3 viewports
 *   pnpm calibrate:kindle -- --epub ruta.epub --sizes md,lg --sections 3
 *   pnpm calibrate:kindle -- --vp  # además repite con viewport reportado
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import {
  getEpubChapter,
  paginateChapter,
  type KindleFontSize,
  type PaginateOptions,
} from "../src/worker/kindle/epub-reader";
import { renderReaderView } from "../src/worker/kindle/views";

const VIEWPORTS = [
  { name: "PW3 ref 600x800", w: 600, h: 800 },
  { name: "PW5/Oasis 758x1024", w: 758, h: 1024 },
  { name: "Scribe 1072x1448", w: 1072, h: 1448 },
];

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const has = (flag: string) => process.argv.includes(flag);

const epubPath = resolve(
  process.cwd(),
  arg("--epub") ?? "public/libros/azul-ruben-dario.epub",
);
const sectionCount = Math.max(1, Number(arg("--sections") ?? 2) || 2);
const maxPages = Math.max(5, Number(arg("--pages") ?? 60) || 60);
const sizes = (arg("--sizes") ?? "md").split(",") as KindleFontSize[];
const withVp = has("--vp");

// Quita el bucle de encoger letra (medimos el presupuesto del servidor)
function stripFitGuard(html: string): string {
  return html.replace(
    /while \(content\.scrollHeight > content\.clientHeight \+ 1 && fitGuard < 12\) \{[\s\S]*?\n {6}\}/,
    "",
  );
}

interface PageMeasure {
  over: number; // px desbordados (>0 = página que no cabía)
  fill: number; // scrollHeight/clientHeight
}

async function main() {
  const bytes = new Uint8Array(readFileSync(epubPath));
  const browser = await chromium.launch();
  try {
    console.log(`EPUB: ${epubPath}  secciones:${sectionCount}  páginas tope:${maxPages}`);
    console.log(
      ["viewport", "size", "vp?", "páginas", "%desb", "llenado med", "escala sug"].join("\t"),
    );

    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
      try {
        for (const size of sizes) {
          for (const useVp of withVp ? [false, true] : [false]) {
            const options: PaginateOptions = {
              size,
              margin: "md",
              layout: "paged",
              mode: "clean",
              ...(useVp ? { viewport: { w: vp.w, h: vp.h } } : {}),
            };

            const measures: PageMeasure[] = [];
            for (let s = 0; s < sectionCount; s++) {
              const chapter = await getEpubChapter(bytes, s, "calib");
              if (!chapter) break;
              const pages = paginateChapter(chapter.contentHtml, options);
              for (const pageHtml of pages.slice(0, Math.ceil(maxPages / sectionCount))) {
                const html = stripFitGuard(
                  renderReaderView({
                    user: null,
                    bookHash: "calib",
                    bookTitle: chapter.bookTitle,
                    bookAuthor: chapter.bookAuthor,
                    chapterTitle: chapter.chapterTitle,
                    contentHtml: pageHtml,
                    sectionIndex: s,
                    totalSections: chapter.totalSections,
                    pageIndex: 0,
                    totalPages: pages.length,
                    size,
                    margin: "md",
                    layout: "paged",
                    mode: "clean",
                    language: chapter.language,
                  }),
                );
                await page.setContent(html, { waitUntil: "load" });
                const m = await page.evaluate(() => {
                  const c = document.querySelector(".epub-content");
                  if (!c) return null;
                  return {
                    scroll: (c as HTMLElement).scrollHeight,
                    client: (c as HTMLElement).clientHeight,
                  };
                });
                if (m && m.client > 0) {
                  measures.push({
                    over: Math.max(0, m.scroll - m.client),
                    fill: m.scroll / m.client,
                  });
                }
              }
            }

            const total = measures.length;
            const overPages = measures.filter((m) => m.over > 1);
            const fills = measures.map((m) => Math.min(m.fill, 1)).sort((a, b) => a - b);
            const medFill = fills.length ? fills[Math.floor(fills.length / 2)] : 0;
            // Escala sugerida: si hay desborde, la mediana del ajuste necesario
            // en esas páginas; si no, cuánto podría crecer sin pasar de 0.98.
            const sug = overPages.length
              ? overPages
                  .map((m) => 1 / m.fill)
                  .sort((a, b) => a - b)[Math.floor(overPages.length / 2)]
              : Math.min(1.25, 0.98 / Math.max(medFill, 0.01));

            console.log(
              [
                vp.name,
                size,
                useVp ? "sí" : "no",
                String(total),
                ((overPages.length / Math.max(total, 1)) * 100).toFixed(0) + "%",
                medFill.toFixed(2),
                sug.toFixed(3),
              ].join("\t"),
            );
          }
        }
      } finally {
        await page.close();
      }
    }

    console.log(
      "\nNota: fuentes de sistema (sin /fonts): en el dispositivo real Literata" +
        " cambia el ancho de línea. La escala sugerida ajusta KINDLE_PAGE_BUDGETS.",
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
