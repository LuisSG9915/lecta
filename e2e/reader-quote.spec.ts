import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { touch } from "./helpers/touch";
import { withTestSession } from "./helpers/session";

// La cuenta es obligatoria: sin sesión la app muestra la bienvenida.
test.beforeEach(async ({ context }) => {
  await withTestSession(context);
});

const MINIMAL_EPUB_PATH = path.resolve(process.cwd(), "fixtures/minimal.epub");

/**
 * plan-lectura-flaquezas F3 (ajuste 2026-11-11 tras probar en Android): en
 * táctil la presión larga selecciona la palabra y abre un mini menú
 * («Significado», tinta, postal…), no la ficha. La selección queda viva para
 * ampliarla con los tiradores; con varias palabras el menú pasa a modo
 * pasaje y «Tinta» guarda y pinta el pasaje en el libro.
 *
 * Los eventos son sintéticos: los tiradores reales se probaron por adb en
 * un Android (Brave/Chrome 157).
 */
test.use({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });

async function openMinimalBook(page: Page) {
  await page.goto("/");
  await page.locator('input[type="file"][accept*="epub"]').setInputFiles(MINIMAL_EPUB_PATH);
  const bookContent = page.locator(".book-content");
  await expect(bookContent).toBeVisible({ timeout: 10_000 });
  await expect(bookContent).toContainText("perenne");
  await page.waitForTimeout(600);
}

/**
 * Selecciona «perenne» y, con `words > 1`, extiende la selección hacia
 * atrás dentro del mismo párrafo hasta cubrir `words` palabras.
 */
async function selectFromWord(page: Page, target: string, words: number) {
  return page.evaluate(
    ({ target, words }) => {
      const walker = document.createTreeWalker(
        document.querySelector(".book-content")!,
        NodeFilter.SHOW_TEXT,
      );
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const start = node.data.indexOf(target);
        if (start === -1) continue;
        const end = start + target.length;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        if (words > 1) {
          // Recorre hacia atrás los nodos del párrafo contando palabras.
          const block = node.parentElement!.closest("p")!;
          const back = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
          const nodes: Text[] = [];
          while (back.nextNode()) nodes.push(back.currentNode as Text);
          let count = 1;
          let i = nodes.indexOf(node);
          let offset = start;
          while (count < words && i >= 0) {
            const text = nodes[i].data.slice(0, offset);
            const matches = [...text.matchAll(/\p{L}+/gu)];
            for (let k = matches.length - 1; k >= 0 && count < words; k -= 1) {
              range.setStart(nodes[i], matches[k].index!);
              count += 1;
            }
            i -= 1;
            offset = i >= 0 ? nodes[i].data.length : 0;
          }
        }
        window.getSelection()!.setBaseAndExtent(range.startContainer, range.startOffset, node, end);
        const rect = range.getBoundingClientRect();
        return {
          text: window.getSelection()!.toString(),
          x: rect.right - 4,
          y: rect.bottom - 4,
        };
      }
      return null;
    },
    { target, words },
  );
}

test("presión larga → mini menú; ampliar la selección → tinta en el libro", async ({ page }) => {
  await openMinimalBook(page);
  const card = page.locator(".word-unified-card");
  const bar = page.locator(".reader__passage-bar");
  const define = bar.locator(".selection-define");

  // 1. Presión sostenida sobre «perenne»: selecciona la palabra y abre el
  //    mini menú con «Significado» (no la ficha).
  const one = await selectFromWord(page, "perenne", 1);
  expect(one?.text).toBe("perenne");
  await page.evaluate(() => window.getSelection()!.removeAllRanges());
  await touch(page, "pointerdown", one!.x, one!.y);
  await page.waitForTimeout(1_100);
  await touch(page, "pointerup", one!.x, one!.y);
  await expect(define).toBeVisible({ timeout: 3_000 });
  await expect(card).not.toBeVisible();
  expect(await page.evaluate(() => String(window.getSelection()))).toBe("perenne");
  // Tiradores propios (la barra «Copiar / Seleccionar todo» de Android se
  // oculta al reaplicar la selección) y «Copiar» en el menú.
  await expect(page.locator(".selection-handle")).toHaveCount(2);
  await expect(bar.locator(".selection-copy")).toHaveCount(1);
  // Deslizar la fila del menú no lo cierra.
  await bar.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    el.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(200);
  await expect(define).toBeVisible();

  // 2. Se amplía la selección a 4 palabras (como al arrastrar el tirador):
  //    el menú pasa a modo pasaje, sin «Significado».
  const four = await selectFromWord(page, "perenne", 4);
  expect(four?.text.split(/\s+/).length).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(400);
  await expect(bar).toBeVisible();
  await expect(define).toHaveCount(0);

  // 3. «Tinta» guarda el pasaje y lo pinta en el texto.
  await bar.locator(".selection-save").click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const highlights = (CSS as unknown as { highlights?: Map<string, { size: number }> }).highlights;
          const painted = highlights?.get("lecta-passage")?.size ?? 0;
          return painted + document.querySelectorAll("mark.saved-passage").length;
        }),
      { timeout: 5_000 },
    )
    .toBeGreaterThan(0);
});
