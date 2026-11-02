import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

const MINIMAL_EPUB_PATH = path.resolve(process.cwd(), "fixtures/minimal.epub");

/**
 * Fase 9 — la tarjeta de palabra.
 * Cubre los criterios C3–C6 del plan §16:
 *  C3  tocar el hueco no abre la ficha de la palabra vecina
 *  C4  cambiar de palabra reemplaza la ficha (sin apilar historial)
 *  C5  la ficha de una palabra conserva las acciones de pasaje
 *  C6  la palabra consultada queda resaltada mientras la ficha está abierta
 */

async function openMinimalBook(page: Page) {
  await page.goto("/");
  const fileInput = page.locator('input[type="file"][accept*="epub"]');
  await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
  const bookContent = page.locator(".book-content");
  await expect(bookContent).toBeVisible({ timeout: 10_000 });
  await expect(bookContent).toContainText("perenne");
  // Dejar asentar fuentes/resaltados antes de medir coordenadas.
  await page.waitForTimeout(600);
  return bookContent;
}

/** Coordenadas del centro de trazado de una palabra dentro de .book-content. */
async function wordCoords(page: Page, word: string) {
  const coords = await page.evaluate((target) => {
    const p = Array.from(document.querySelectorAll(".book-content p")).find(
      (el) => el.textContent?.includes(target),
    );
    if (!p) return null;
    const textNode =
      Array.from(p.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes(target),
      ) || p.firstChild;
    if (!textNode || !textNode.textContent) return null;
    const range = document.createRange();
    const idx = textNode.textContent.indexOf(target);
    range.setStart(textNode, idx);
    range.setEnd(textNode, idx + target.length);
    const rect = range.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, word);
  expect(coords, `no se halló la palabra "${word}" en el contenido`).not.toBeNull();
  return coords!;
}

test.describe("Tarjeta de palabra (F9)", () => {
  test("una palabra conserva las acciones de pasaje: Tinta, Reflexión, Postal y Preguntar (C5)", async ({
    page,
  }) => {
    await openMinimalBook(page);
    const coords = await wordCoords(page, "perenne");
    await page.mouse.click(coords.x, coords.y);

    const card = page.locator(".word-unified-card");
    await expect(card).toBeVisible({ timeout: 6_000 });
    await expect(card.locator(".word-card-passage-actions")).toBeVisible();
    await expect(
      card.locator('button[aria-label="Resaltar con tinta"]'),
    ).toBeVisible();
    await expect(card.locator("button:has-text('Reflexión')")).toBeVisible();
    await expect(card.locator("button:has-text('Postal')")).toBeVisible();
    await expect(card.locator("button:has-text('Preguntar')")).toBeVisible();
  });

  test("tocar el hueco no abre la ficha de la palabra vecina (C3)", async ({
    page,
  }) => {
    await openMinimalBook(page);

    // Punto muerto: a la derecha del encabezado «Capítulo uno», fuera de la
    // caja de la palabra más cercana ampliada un 25 %.
    const gap = await page.evaluate(() => {
      const h1 = document.querySelector(".book-content h1");
      if (!h1 || !h1.textContent) return null;
      const range = document.createRange();
      range.selectNodeContents(h1);
      const rect = range.getBoundingClientRect();
      return { x: rect.right + 80, y: rect.top + rect.height / 2 };
    });
    expect(gap).not.toBeNull();
    await page.mouse.click(gap!.x, gap!.y);
    await page.waitForTimeout(400);
    await expect(page.locator(".word-unified-card")).not.toBeVisible();

    // Con la ficha abierta, el hueco tampoco abre la palabra vecina: como
    // mucho cierra la abierta, jamás muestra otra palabra.
    const coords = await wordCoords(page, "perenne");
    await page.mouse.click(coords.x, coords.y);
    const card = page.locator(".word-unified-card");
    await expect(card).toBeVisible({ timeout: 6_000 });
    await page.mouse.click(gap!.x, gap!.y);
    await page.waitForTimeout(400);
    await expect(card).not.toContainText("Capítulo");
  });

  test("cambiar de palabra reemplaza la ficha y el historial queda estable (C4)", async ({
    page,
  }) => {
    await openMinimalBook(page);
    const historyAtStart = await page.evaluate(() => history.length);

    const first = await wordCoords(page, "perenne");
    await page.mouse.click(first.x, first.y);
    const card = page.locator(".word-unified-card");
    await expect(card).toBeVisible({ timeout: 6_000 });
    await expect(card).toContainText("perenne");
    expect(await page.evaluate(() => history.length)).toBe(historyAtStart + 1);

    // Tocar otra palabra reutiliza la capa (swap), no apila una entrada.
    const second = await wordCoords(page, "casa");
    await page.mouse.click(second.x, second.y);
    await expect(card).toContainText("casa");
    expect(await page.evaluate(() => history.length)).toBe(historyAtStart + 1);

    // La X libera la misma capa con history.back(): la entrada queda como
    // "adelante" en la sesión, así que la longitud NO baja — lo que exige
    // C4 es que no crece: un nuevo ciclo abrir/cerrar la reutiliza y la
    // longitud se mantiene estable, sin apilar capas huérfanas.
    await card.locator('button[aria-label="Cerrar panel de palabra"]').click();
    await expect(card).not.toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => history.length)).toBe(historyAtStart + 1);

    // Segundo ciclo: abrir vuelve a una sola capa, cerrar la libera otra vez.
    await page.mouse.click(first.x, first.y);
    await expect(card).toContainText("perenne");
    expect(await page.evaluate(() => history.length)).toBe(historyAtStart + 1);
    await page.keyboard.press("Escape");
    await expect(card).not.toBeVisible();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => history.length)).toBe(historyAtStart + 1);

    // Atrás del navegador sale del lector a la estantería, sin capa huérfana.
    await page.goBack();
    await expect(page.locator(".reader")).not.toBeVisible({ timeout: 8_000 });
  });

  test("la palabra consultada queda resaltada hasta cerrar la ficha (C6)", async ({
    page,
  }) => {
    await openMinimalBook(page);
    const coords = await wordCoords(page, "perenne");
    await page.mouse.click(coords.x, coords.y);

    const card = page.locator(".word-unified-card");
    await expect(card).toBeVisible({ timeout: 6_000 });

    // El resaltado vive en CSS.highlights (Highlight API) — sin mutar el EPUB.
    const highlighted = await page.evaluate(
      () =>
        typeof CSS !== "undefined" &&
        "highlights" in CSS &&
        (CSS.highlights as Map<string, unknown>).has("lecta-consulted"),
    );
    expect(highlighted).toBe(true);

    await page.keyboard.press("Escape");
    await expect(card).not.toBeVisible();
    const cleared = await page.evaluate(
      () =>
        !(
          typeof CSS !== "undefined" &&
          "highlights" in CSS &&
          (CSS.highlights as Map<string, unknown>).has("lecta-consulted")
        ),
    );
    expect(cleared).toBe(true);
  });
});
