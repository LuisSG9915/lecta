import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import AxeBuilder from "@axe-core/playwright";

const MINIMAL_EPUB_PATH = path.resolve(process.cwd(), "fixtures/minimal.epub");
const EMOJI_REGEX = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2728}]/u;

test.describe("Lecta — 9 Recorridos Críticos E2E", () => {
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
    expect(pageText).not.toMatch(EMOJI_REGEX);

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

  test("Recorrido 5: Restaurar Respaldo CON Libro y Palabras", async ({
    page,
  }) => {
    // 1. Abrir libro de muestra en el lector y guardar al menos 1 palabra
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
    await expect(page.locator(".reader")).toBeVisible({ timeout: 10_000 });
    const bookContent = page.locator(".book-content");
    await expect(bookContent).toContainText("perenne");
    await page.waitForTimeout(600);

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

    const wordDialog = page.locator('[role="dialog"]').filter({ hasText: "perenne" });
    await expect(wordDialog).toBeVisible({ timeout: 6_000 });
    const saveBtn = wordDialog.locator("button:has-text('Guardar en mi cuaderno')");
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();
    await expect(wordDialog.locator(".word-panel-saved-badge")).toBeVisible({ timeout: 5_000 });
    await page.keyboard.press("Escape");

    // 2. Volver a la estantería y exportar respaldo JSON
    const backBtn = page.locator("button[aria-label='Volver a la estantería']");
    if (await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
    } else {
      await page.goto("/");
    }

    const accountTab = page.locator('button.app-nav-item[data-dest="account"]');
    await accountTab.click();
    await expect(page.locator(".account-page")).toBeVisible({ timeout: 10_000 });

    const advancedSummary = page.locator(".account-advanced-summary, summary:has-text('Avanzado y privacidad')");
    await advancedSummary.click();

    const downloadPromise = page.waitForEvent("download");
    await page.locator("button:has-text('Descargar mis datos (JSON)')").click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    expect(backupPath).toBeTruthy();

    const backupContent = fs.readFileSync(backupPath!, "utf-8");
    const parsed = JSON.parse(backupContent);
    expect(parsed.version).toBeGreaterThanOrEqual(1);
    expect(parsed.words?.length).toBeGreaterThan(0);
    expect(parsed.positions?.length).toBeGreaterThan(0);

    // 3. Borrar IndexedDB y recargar
    await page.evaluate(async () => {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs) {
        if (db.name) window.indexedDB.deleteDatabase(db.name);
      }
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    await expect(page.locator(".shelf-welcome-hero")).toBeVisible({ timeout: 10_000 });

    // 4. Ir a Cuenta y restaurar el respaldo desde el diálogo unificado
    const accountTabAfterWipe = page.locator('button.app-nav-item[data-dest="account"]');
    await accountTabAfterWipe.click();
    await expect(page.locator(".account-page")).toBeVisible({ timeout: 10_000 });

    const advancedSummaryAfterWipe = page.locator(".account-advanced-summary, summary:has-text('Avanzado y privacidad')");
    await advancedSummaryAfterWipe.click();

    const restoreInput = page.locator('input[type="file"][accept*="json"]').first();
    await restoreInput.setInputFiles(backupPath!);

    const restoreDialog = page.locator('[role="dialog"]').filter({ hasText: "Restaurar respaldo" });
    await expect(restoreDialog).toBeVisible({ timeout: 5_000 });
    await expect(restoreDialog).toContainText("Versión del formato");

    await restoreDialog
      .locator("button[data-testid='confirm-restore-btn'], button:has-text('Restaurar y fusionar datos'), button:has-text('Confirmar restauración')")
      .first()
      .click();

    await expect(restoreDialog).not.toBeVisible({ timeout: 5_000 });

    // 5. Volver a la estantería y verificar actualización sin recargar manualmente
    const shelfTab = page.locator('button.app-nav-item[data-dest="shelf"]');
    await shelfTab.click();
    await expect(page.locator(".shelf, .shelf-hero, .shelf-empty-state, .shelf-welcome-hero").first()).toBeVisible();

    // En IndexedDB NO debe existir ningún libro con data.size === 0
    const zeroByteBooks = await page.evaluate(async () => {
      return new Promise<unknown[]>((resolve) => {
        const req = indexedDB.open("lecta");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("books")) return resolve([]);
          const tx = db.transaction("books", "readonly");
          const store = tx.objectStore("books");
          const getAll = store.getAll();
          getAll.onsuccess = () => {
            const empty = getAll.result.filter((b: { data?: Blob }) => !b.data || b.data.size === 0);
            resolve(empty);
          };
          getAll.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      });
    });
    expect(zeroByteBooks.length).toBe(0);

    // Las palabras restauradas aparecen en Vocabulario
    const vocabTab = page.locator('button.app-nav-item[data-dest="vocabulary"]');
    await vocabTab.click();
    await expect(page.locator("h1:has-text('Cuaderno')")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("body")).toContainText("perenne");

    // Ningún componente muestra emojis en pantalla
    const vocabText = await page.locator("body").innerText();
    expect(vocabText).not.toMatch(EMOJI_REGEX);
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

  test("Recorrido 7: Controles del Lector (Índice, Búsqueda, Anotaciones y Modo Simple vs. Avanzado)", async ({
    page,
  }) => {
    // 1. Abrir libro minimal
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
    const reader = page.locator(".reader");
    await expect(reader).toBeVisible({ timeout: 10_000 });

    // 2. Abrir herramientas del libro en TopBar
    const moreBtn = page.locator("button[aria-label='Herramientas del libro'], .reader-bar-btn--more");
    await expect(moreBtn).toBeVisible({ timeout: 5_000 });
    await moreBtn.click();

    // 3. Verificar que por defecto está en Modo Simple y las opciones avanzadas están ocultas
    const simpleBtn = page.locator("button:has-text('Modo Simple')");
    await expect(simpleBtn).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".reader-more-assists-section")).not.toBeVisible();
    await expect(page.locator("button:has-text('Crear tarjeta de cita')")).not.toBeVisible();

    // 4. Cambiar a Modo Avanzado
    const advancedBtn = page.locator("button:has-text('Modo Avanzado')");
    await advancedBtn.click();

    // 5. Verificar que se despliegan las herramientas avanzadas
    await expect(page.locator(".reader-more-assists-section")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".reader-more-offline-section")).toBeVisible();

    // 6. Cerrar el menú de herramientas con Escape
    await page.keyboard.press("Escape");

    // 7. Abrir Índice (TOC)
    const tocBtn = page.locator("button[aria-label='Índice del libro']");
    await tocBtn.click();
    const tocPanel = page.locator("[role='dialog'], .sheet-panel").filter({ hasText: "Capítulo uno" });
    await expect(tocPanel).toBeVisible({ timeout: 5_000 });
    await expect(tocPanel).toContainText("Capítulo dos");

    // 8. Abrir Marcadores y pasajes desde el índice y guardar este lugar
    const marksBtn = tocPanel.locator("button:has-text('Marcadores y pasajes')");
    await expect(marksBtn).toBeVisible();
    await marksBtn.click();

    const saveMarkBtn = page.locator("button:has-text('Guardar este lugar')");
    await expect(saveMarkBtn).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(400);
    await saveMarkBtn.click();

    // 9. Verificar que el marcador quedó registrado ("Ir al marcador" disponible)
    await expect(page.locator("button:has-text('Ir al marcador')")).toBeVisible({ timeout: 10_000 });
  });

  test("Recorrido 8: Consentimiento TTS y Kill-Switches de función", async ({
    page,
  }) => {
    // 1. Abrir libro minimal
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
    await expect(page.locator(".reader")).toBeVisible({ timeout: 10_000 });

    // 2. Tocar botón "Escuchar" en el dock inferior
    const listenBtn = page.locator("button.dock-listen-trigger, button[aria-label*='Escuchar']");
    await expect(listenBtn).toBeVisible({ timeout: 5_000 });
    await listenBtn.click();

    // 3. Verificar diálogo de consentimiento TTS (TtsConsentDialog)
    const ttsDialog = page.locator("[role='dialog']").filter({ hasText: "voz alta" });
    await expect(ttsDialog).toBeVisible({ timeout: 5_000 });
    await expect(ttsDialog).toContainText("KittenTTS Neural");
    await expect(ttsDialog).toContainText("voz ligera del sistema");

    // 4. Descartar el diálogo
    await page.keyboard.press("Escape");
    await expect(ttsDialog).not.toBeVisible();

    // 5. Volver a la estantería e ir a Cuenta
    const backBtn = page.locator("button[aria-label='Volver a la estantería']");
    await backBtn.click();

    const accountTab = page.locator('button.app-nav-item[data-dest="account"]');
    await accountTab.click();
    await expect(page.locator(".account-page")).toBeVisible({ timeout: 10_000 });

    // 6. Abrir Centro de diagnóstico
    const advancedSummary = page.locator(".account-advanced-summary, summary:has-text('Avanzado y privacidad')");
    await advancedSummary.click();
    await page.locator("button:has-text('Centro de diagnóstico')").click();

    const diagModal = page.locator("[role='dialog']").filter({ hasText: "Diagnóstico" });
    await expect(diagModal).toBeVisible({ timeout: 5_000 });

    // 7. Desactivar kill-switch de Minijuegos
    const toggleBtn = diagModal.locator("button[data-flag='vocabGames']");
    await toggleBtn.click();
    await expect(toggleBtn).toHaveText("Desactivado");
    await diagModal.locator("button:has-text('Cerrar')").click();

    // 8. Ir a Vocabulario y comprobar que no hay minijuegos ni CTA de repaso lúdico
    const vocabTab = page.locator('button.app-nav-item[data-dest="vocabulary"]');
    await vocabTab.click();
    await expect(page.locator(".notebook-quick-review-cta")).not.toBeVisible();
    await expect(page.locator(".nb-free-modes")).not.toBeVisible();
  });

  test("Recorrido 9: Viewport Móvil (390x844) y Validación de Accesibilidad", async ({
    page,
  }) => {
    // 1. Establecer viewport móvil
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await expect(page.locator(".shelf-welcome-hero")).toBeVisible();

    // 2. Verificar indicador de sincronización en AppNav y que no se solapa con los botones del dock
    const syncIndicator = page.locator(".app-nav-sync-indicator");
    await expect(syncIndicator).toBeVisible();

    const syncBox = await syncIndicator.boundingBox();
    expect(syncBox).not.toBeNull();
    const navItems = page.locator(".app-nav-item");
    const count = await navItems.count();
    for (let i = 0; i < count; i++) {
      const itemBox = await navItems.nth(i).boundingBox();
      if (itemBox && syncBox) {
        const overlaps =
          syncBox.x < itemBox.x + itemBox.width &&
          syncBox.x + syncBox.width > itemBox.x &&
          syncBox.y < itemBox.y + itemBox.height &&
          syncBox.y + syncBox.height > itemBox.y;
        expect(overlaps).toBe(false);
      }
    }

    // 3. Auditoría de accesibilidad con Axe en la Estantería
    const shelfAxe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const criticalShelfViolations = shelfAxe.violations.filter((v) => v.impact === "critical");
    expect(criticalShelfViolations).toEqual([]);

    // 4. Abrir libro minimal y ejecutar auditoría de accesibilidad en el Lector
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
    await expect(page.locator(".reader")).toBeVisible({ timeout: 10_000 });

    const readerAxe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .disableRules(["color-contrast"])
      .analyze();
    const criticalReaderViolations = readerAxe.violations.filter((v) => v.impact === "critical");
    expect(criticalReaderViolations).toEqual([]);
  });
});
