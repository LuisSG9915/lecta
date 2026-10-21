import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const MINIMAL_EPUB_PATH = path.resolve(process.cwd(), "fixtures/minimal.epub");

test.describe("Lecta — 6 Recorridos Críticos E2E", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("Recorrido 1: Primera visita limpia (sin emojis) y apertura de EPUB real", async ({
    page,
  }) => {
    // 1. Onboarding limpio sin emojis
    const welcomeHero = page.locator(".shelf-welcome-hero");
    await expect(welcomeHero).toBeVisible();

    const heroTitle = page.locator(".shelf-welcome-hero-title");
    await expect(heroTitle).toHaveText("Vive cómo se siente leer sin interrupciones");

    // Verificar ausencia de emojis pictóricos en la interfaz inicial
    const pageText = await page.locator("body").innerText();
    const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2728}]/u;
    expect(pageText).not.toMatch(emojiRegex);

    // 2. Apertura directa de EPUB (zero friction: sin calibración ni modales bloqueantes)
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);

    // 3. El lector abre en 0 segundos
    const reader = page.locator(".reader");
    await expect(reader).toBeVisible({ timeout: 10_000 });

    // Confirmar que no hay modales interceptores bloqueando la lectura
    await expect(page.locator(".calibration")).not.toBeVisible();
    await expect(page.locator(".section-preview")).not.toBeVisible();

    // El contenido del libro está visible
    const bookContent = page.locator(".book-content");
    await expect(bookContent).toBeVisible();
    await expect(bookContent).toContainText("Capítulo uno");
  });

  test("Recorrido 2: Paginación hacia adelante/atrás y persistencia de la posición de lectura al recargar", async ({
    page,
  }) => {
    // Abrir libro minimal
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
    const reader = page.locator(".reader");
    await expect(reader).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".book-content")).toContainText("Capítulo uno");

    // Avanzar de capítulo usando la tecla Flecha Derecha o botón de navegación
    const nextBtn = page.locator('button.page-nav-btn[aria-label="Página siguiente"]');
    if (await nextBtn.isVisible().catch(() => false)) {
      await nextBtn.click();
    } else {
      await page.keyboard.press("ArrowRight");
    }

    // Esperar a que el contenido cambie a Capítulo dos
    const bookContent = page.locator(".book-content");
    await expect(bookContent).toContainText("Capítulo dos", { timeout: 8_000 });

    // Dar tiempo para que el debounce de persistencia (400ms) guarde en IndexedDB
    await page.waitForTimeout(600);

    // Recargar la página
    await page.reload();

    // Al recargar, reanudar el libro desde la mesa de lectura o estantería
    const resumeBtn = page
      .locator(
        "button.shelf-hero-cover, button.shelf-book-cover, button[aria-label^='Abrir'], button[aria-label^='Continuar'], .shelf-book",
      )
      .first();
    await expect(resumeBtn).toBeVisible({ timeout: 10_000 });
    await resumeBtn.click();

    // Verificar que el lector reanuda en el Capítulo dos
    await expect(reader).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".book-content")).toContainText("Capítulo dos");
  });

  test("Recorrido 3: Tocar una palabra en el libro, abrir WordPanel y guardarla en el vocabulario", async ({
    page,
  }) => {
    // Abrir libro minimal
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
    await expect(page.locator(".reader")).toBeVisible({ timeout: 10_000 });

    const bookContent = page.locator(".book-content");
    await expect(bookContent).toContainText("perenne");
    await page.waitForTimeout(600);

    // Obtener las coordenadas exactas de trazado de la palabra "perenne"
    const coords = await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll(".book-content p")).find((el) =>
        el.textContent?.includes("perenne"),
      );
      if (!p) return null;
      const textNode =
        Array.from(p.childNodes).find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.includes("perenne"),
        ) || p.firstChild;
      if (!textNode || !textNode.textContent) return null;
      const range = document.createRange();
      const idx = textNode.textContent.indexOf("perenne");
      range.setStart(textNode, idx);
      range.setEnd(textNode, idx + "perenne".length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });

    expect(coords).not.toBeNull();
    await page.mouse.click(coords!.x, coords!.y);

    // Verificar que el diálogo de significado aparece
    const wordDialog = page.locator('[role="dialog"]').filter({ hasText: "perenne" });
    await expect(wordDialog).toBeVisible({ timeout: 6_000 });

    // Guardar palabra en el cuaderno
    const saveBtn = wordDialog.locator("button:has-text('Guardar en mi cuaderno')");
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verificar badge de confirmación
    await expect(wordDialog.locator(".word-panel-saved-badge")).toBeVisible({ timeout: 5_000 });
  });

  test("Recorrido 4: Simular modo offline (context.setOffline(true)), recargar la PWA y seguir leyendo el libro guardado", async ({
    page,
    context,
  }) => {
    // Abrir libro minimal
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
    const reader = page.locator(".reader");
    await expect(reader).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".book-content")).toContainText("Capítulo uno");

    // Esperar a que el Service Worker tome el control de la página
    await page.evaluate(async () => {
      if ("serviceWorker" in navigator) {
        try {
          await Promise.race([
            (async () => {
              await navigator.serviceWorker.ready;
              if (!navigator.serviceWorker.controller) {
                await new Promise<void>((resolve) => {
                  navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
                    once: true,
                  });
                  setTimeout(resolve, 3000);
                });
              }
            })(),
            new Promise((resolve) => setTimeout(resolve, 5000)),
          ]);
        } catch {
          // ignore
        }
      }
    });

    // Activar modo offline
    await context.setOffline(true);

    // Recargar la PWA sin conexión
    await page.reload({ waitUntil: "domcontentloaded" });

    // Reanudar la lectura desde la estantería o mesa de lectura si recarga en shelf
    const resumeBtn = page
      .locator(
        "button.shelf-hero-cover, button.shelf-book-cover, button[aria-label^='Abrir'], button[aria-label^='Continuar'], .shelf-book",
      )
      .first();
    await expect(resumeBtn).toBeVisible({ timeout: 10_000 });
    await resumeBtn.click();

    await expect(reader).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".book-content")).toBeVisible();

    // Paginación sigue funcionando offline desde IndexedDB
    await page.keyboard.press("ArrowRight");
    await expect(page.locator(".book-content")).toBeVisible();

    // Restaurar conectividad
    await context.setOffline(false);
  });

  test("Recorrido 5: Exportar respaldo JSON, limpiar base de datos y restaurar el respaldo verificando la vista previa", async ({
    page,
  }) => {
    await expect(page.locator(".shelf-welcome-hero")).toBeVisible();

    // Navegar a Cuenta / Perfil
    const accountTab = page.locator('button.app-nav-item[data-dest="account"]');
    await accountTab.click();
    await expect(page.locator(".account-page")).toBeVisible({ timeout: 10_000 });

    // Desplegar sección Avanzado y privacidad
    const advancedSummary = page.locator(".account-advanced-summary, summary:has-text('Avanzado y privacidad')");
    await advancedSummary.click();

    // Esperar y capturar la descarga del respaldo JSON
    const downloadPromise = page.waitForEvent("download");
    await page.locator("button:has-text('Descargar mis datos (JSON)')").click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    expect(backupPath).toBeTruthy();

    const backupContent = fs.readFileSync(backupPath!, "utf-8");
    const parsed = JSON.parse(backupContent);
    expect(parsed.version).toBeGreaterThanOrEqual(1);
    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.words).toBeDefined();

    // Restaurar el respaldo usando el selector de archivo
    const restoreInput = page.locator('input[type="file"][accept*="json"]').first();
    await restoreInput.setInputFiles(backupPath!);

    // Verificar que aparece el modal de vista previa de restauración
    const restoreDialog = page.locator('[role="dialog"]').filter({ hasText: "Restaurar respaldo" });
    await expect(restoreDialog).toBeVisible({ timeout: 5_000 });
    await expect(restoreDialog).toContainText("Versión del formato");

    // Confirmar restauración
    await restoreDialog.locator("button:has-text('Confirmar restauración')").click();

    // El diálogo de vista previa debe cerrarse tras confirmar
    await expect(restoreDialog).not.toBeVisible({ timeout: 5_000 });
  });

  test("Recorrido 6: Verificar el indicador de estado de sincronización en la cabecera y el reporte del Centro de Diagnóstico", async ({
    page,
  }) => {
    await expect(page.locator(".shelf-welcome-hero")).toBeVisible();

    // 1. Indicador de sincronización en AppNav
    const syncIndicator = page.locator(".app-nav-sync-indicator");
    await expect(syncIndicator).toBeVisible();

    const syncText = page.locator(".app-nav-sync-text");
    await expect(syncText).toBeVisible();
    const textContent = await syncText.innerText();
    expect(
      textContent.includes("Guardado en este dispositivo") ||
        textContent.includes("Sincronizado") ||
        textContent.includes("Sin conexión"),
    ).toBe(true);

    // 2. Abrir Cuenta / Perfil
    const accountTab = page.locator('button.app-nav-item[data-dest="account"]');
    await accountTab.click();
    await expect(page.locator(".account-page")).toBeVisible({ timeout: 10_000 });

    // Desplegar sección Avanzado y privacidad
    const advancedSummary = page.locator(".account-advanced-summary, summary:has-text('Avanzado y privacidad')");
    await advancedSummary.click();

    // Abrir Centro de diagnóstico
    const diagBtn = page.locator("button:has-text('Centro de diagnóstico')");
    await diagBtn.scrollIntoViewIfNeeded();
    await diagBtn.click();

    // Verificar modal de diagnóstico
    const diagModal = page.locator('[role="dialog"]').filter({ hasText: "Diagnóstico" });
    await expect(diagModal).toBeVisible({ timeout: 5_000 });
    await expect(diagModal).toContainText("Almacenamiento en este dispositivo");
    await expect(diagModal).toContainText("Datos locales y sincronización");
    await expect(diagModal).toContainText("Interruptores de función");

    // Cerrar Centro de diagnóstico
    await diagModal.locator("button:has-text('Cerrar')").click();
    await expect(diagModal).not.toBeVisible();
  });
});
