import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { touch } from "./helpers/touch";

const MINIMAL_EPUB_PATH = path.resolve(process.cwd(), "fixtures/minimal.epub");

/**
 * plan-lectura-flaquezas F3: en móvil, abrir una palabra con presión larga
 * no puede cerrar el camino a subrayar una cita. La selección nativa queda
 * viva; al extenderla a varias palabras la ficha se cierra y aparece la
 * barra de pasajes; «Tinta» guarda y pinta el pasaje en el libro.
 *
 * Los eventos son sintéticos: no prueban los tiradores reales del sistema
 * (eso queda para la verificación manual en Android del plan, paso 8).
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

test("presión larga + extender la selección → barra de pasajes y tinta en el libro", async ({ page }) => {
  await openMinimalBook(page);
  const card = page.locator(".word-unified-card");

  // 1. Presión sostenida sobre «perenne» abre la ficha.
  const one = await selectFromWord(page, "perenne", 1);
  expect(one?.text).toBe("perenne");
  await page.evaluate(() => window.getSelection()!.removeAllRanges());
  await touch(page, "pointerdown", one!.x, one!.y);
  await page.waitForTimeout(620);
  await expect(card).toBeVisible({ timeout: 3_000 });
  await touch(page, "pointerup", one!.x, one!.y);

  // 2. Llega la selección nativa de esa misma palabra: la ficha sigue
  //    (misma palabra, mismo sitio → no se reabre).
  await selectFromWord(page, "perenne", 1);
  await page.waitForTimeout(400);
  await expect(card).toBeVisible();

  // 3. Se extiende a 4 palabras: la ficha se cierra y aparece la barra.
  const four = await selectFromWord(page, "perenne", 4);
  expect(four?.text.split(/\s+/).length).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(400);
  await expect(card).not.toBeVisible();
  const bar = page.locator(".reader__passage-bar");
  await expect(bar).toBeVisible();

  // 4. «Tinta» guarda el pasaje y lo pinta en el texto.
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
