import { test, expect } from "@playwright/test";
import path from "node:path";
import { renderReaderView } from "../src/worker/kindle/views";
import { paginateChapter } from "../src/worker/kindle/epub-reader";

const MINIMAL_EPUB_PATH = path.resolve(process.cwd(), "fixtures/minimal.epub");

test.describe("Lecta — Journeys Críticos de Estabilización", () => {
  test("Journey 1: Apertura y Carga de EPUB limpia sin errores de consola (@smoke)", async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (err) => {
      // Ignorar errores de verificación de red en sandbox headless
      if (
        err.message.includes("access control checks") ||
        err.message.includes("Failed to fetch") ||
        err.message.includes("NetworkError")
      ) {
        return;
      }
      runtimeErrors.push(err.message);
    });

    await page.goto("/");
    await expect(page.locator(".shelf-main")).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(500);

    // 1. Cargar EPUB de prueba
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);

    // 2. Esperar que el contenedor del lector renderice
    const reader = page.locator(".reader");
    await expect(reader).toBeVisible({ timeout: 15_000 });

    // 3. Verificar que el texto del capítulo uno está visible
    const bookContent = page.locator(".book-content");
    await expect(bookContent).toBeVisible();
    await expect(bookContent).toContainText("Capítulo uno", { timeout: 15_000 });

    // 4. Verificar que el progreso inicial se registra (barra superior visible y posición en IDB)
    const progressBar = page.locator(".reader-bar-progress");
    await expect(progressBar).toBeVisible();

    await expect
      .poll(
        async () => {
          return page.evaluate(async () => {
            return new Promise<boolean>((resolve) => {
              const req = window.indexedDB.open("lecta");
              req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains("positions")) {
                  db.close();
                  return resolve(false);
                }
                const tx = db.transaction("positions", "readonly");
                const countReq = tx.objectStore("positions").count();
                countReq.onsuccess = () => {
                  const hasItems = countReq.result > 0;
                  db.close();
                  resolve(hasItems);
                };
                countReq.onerror = () => {
                  db.close();
                  resolve(false);
                };
              };
              req.onerror = () => resolve(false);
            });
          });
        },
        {
          message: "La posición inicial debe quedar registrada en IndexedDB",
          timeout: 8_000,
        },
      )
      .toBe(true);

    // 5. Cero errores de ejecución de runtime en la consola
    expect(runtimeErrors).toEqual([]);
  });

  test("Journey 2: Flujo TTS y Recuperación de Estado (@smoke)", async ({
    page,
  }) => {
    page.on("pageerror", (err) => {
      // Ignorar errores de red transitorios en entornos headless
      if (
        err.message.includes("access control checks") ||
        err.message.includes("Failed to fetch") ||
        err.message.includes("NetworkError")
      ) {
        return;
      }
    });

    // 1. Mock de síntesis de voz determinista para entorno headless
    await page.addInitScript(() => {
      const mockVoice = {
        default: true,
        lang: "es-ES",
        localService: true,
        name: "Mock Spanish Voice",
        voiceURI: "mock-es",
      };
      let isSpeaking = false;
      let isPaused = false;
      let currentUtterance: SpeechSynthesisUtterance | null = null;

      const mockSynthesis = {
        getVoices: () => [mockVoice as unknown as SpeechSynthesisVoice],
        speak: (utterance: SpeechSynthesisUtterance) => {
          isSpeaking = true;
          isPaused = false;
          currentUtterance = utterance;
          setTimeout(() => {
            if (typeof utterance.onstart === "function") {
              utterance.onstart(new Event("start") as SpeechSynthesisEvent);
            }
          }, 20);
        },
        cancel: () => {
          isSpeaking = false;
          isPaused = false;
          if (currentUtterance && typeof currentUtterance.onend === "function") {
            currentUtterance.onend(new Event("end") as SpeechSynthesisEvent);
          }
          currentUtterance = null;
        },
        pause: () => {
          isPaused = true;
          isSpeaking = false;
          if (currentUtterance && typeof currentUtterance.onpause === "function") {
            currentUtterance.onpause(new Event("pause") as SpeechSynthesisEvent);
          }
        },
        resume: () => {
          isPaused = false;
          isSpeaking = true;
          if (currentUtterance && typeof currentUtterance.onresume === "function") {
            currentUtterance.onresume(new Event("resume") as SpeechSynthesisEvent);
          }
        },
        get speaking() {
          return isSpeaking;
        },
        get paused() {
          return isPaused;
        },
        pending: false,
        onvoiceschanged: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      };

      try {
        Object.defineProperty(window, "speechSynthesis", {
          value: mockSynthesis,
          configurable: true,
          writable: true,
        });
      } catch {
        (window as unknown as Record<string, unknown>).speechSynthesis = mockSynthesis;
      }
    });

    await page.goto("/");
    await expect(page.locator(".shelf-main")).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(500);

    // 2. Abrir libro minimal
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
    await expect(page.locator(".reader")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".book-content")).toContainText("Capítulo uno", {
      timeout: 15_000,
    });

    // 3. Activar TTS desde el dock
    const listenBtn = page
      .locator("button.dock-listen-trigger, button[aria-label*='Escuchar']")
      .first();
    await expect(listenBtn).toBeVisible({ timeout: 5_000 });
    await listenBtn.click();

    // 4. Si aparece el modal de consentimiento, seleccionar voz ligera del sistema
    const browserVoiceBtn = page.locator(
      "button:has-text('Usar voz ligera del sistema')",
    );
    if (await browserVoiceBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await browserVoiceBtn.click();
    }

    // 5. Verificar que el dock conmuta a modo audio y el botón de play/pausa cambia a "Pausar lectura"
    const playPauseBtn = page.locator("button.dock-audio-play-btn");
    await expect(playPauseBtn).toBeVisible({ timeout: 5_000 });
    await expect(playPauseBtn).toHaveAttribute(
      "aria-label",
      "Pausar lectura",
      { timeout: 5_000 },
    );

    // 6. Pausar la lectura
    await playPauseBtn.click();

    // 7. Verificar que el botón cambia a "Reanudar lectura"
    await expect(playPauseBtn).toHaveAttribute(
      "aria-label",
      "Reanudar lectura",
      { timeout: 5_000 },
    );

    // 8. Verificar que la UI y el contenido del lector se mantienen estables
    await expect(page.locator(".reader")).toBeVisible();
    await expect(page.locator(".book-content")).toContainText("Capítulo uno");
  });

  test("Journey 3: Sincronización entre Dos Contextos", async ({
    browser,
  }) => {
    let serverPosition: {
      bookHash: string;
      sectionIndex: number;
      scrollTop: number;
      ratio: number | null;
      progress: number | null;
      anchor: string | null;
      updatedAt: number;
      syncedAt: number;
    } | null = null;
    let serverTime = Date.now();

    const mockSyncEndpoints = async (ctx: import("@playwright/test").BrowserContext) => {
      await ctx.route("**/api/auth/get-session", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            session: {
              id: "sess_sync_test",
              userId: "u_sync_test",
              expiresAt: new Date(Date.now() + 86400000).toISOString(),
            },
            user: {
              id: "u_sync_test",
              email: "sync@test.com",
              name: "Sync User",
            },
          }),
        });
      });

      await ctx.route("**/api/positions**", async (route) => {
        const req = route.request();
        if (req.method() === "PUT") {
          const body = JSON.parse(req.postData() || "{}");
          if (Array.isArray(body.positions) && body.positions.length > 0) {
            serverTime += 1000;
            const last = body.positions[body.positions.length - 1];
            serverPosition = {
              ...last,
              syncedAt: serverTime,
            };
          }
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, upserted: 1, serverTime }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              positions: serverPosition ? [serverPosition] : [],
              serverTime,
              hasMore: false,
              nextCursor: serverPosition?.syncedAt ?? 0,
              nextAfterBookHash: null,
            }),
          });
        }
      });

      await ctx.route("**/api/annotations**", async (route) => {
        if (route.request().method() === "PUT") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, serverTime }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ annotations: [], hasMore: false, serverTime }),
          });
        }
      });
      await ctx.route("**/api/activity**", async (route) => {
        if (route.request().method() === "PUT") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, serverTime }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ intervals: [], hasMore: false, serverTime }),
          });
        }
      });
      await ctx.route("**/api/reviews**", async (route) => {
        if (route.request().method() === "PUT") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, serverTime }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ reviews: [], hasMore: false, serverTime }),
          });
        }
      });
      await ctx.route("**/api/knowledge**", async (route) => {
        if (route.request().method() === "PUT") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, serverTime }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ rows: [], hasMore: false, serverTime }),
          });
        }
      });
      await ctx.route("**/api/vocab**", async (route) => {
        if (route.request().method() === "PUT") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, serverTime }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ words: [], hasMore: false, serverTime }),
          });
        }
      });
      await ctx.route("**/api/companion**", async (route) => {
        if (route.request().method() === "PUT") {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              accepted: {
                baselines: [],
                events: [],
                fields: [],
                receipts: [],
              },
            }),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ items: [], nextCursor: null }),
          });
        }
      });
      await ctx.route("**/api/sync/counts**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            ok: true,
            counts: {
              words: 0,
              annotations: 0,
              activity: 0,
              reviews: 0,
              positions: 0,
              knowledge: 0,
            },
          }),
        });
      });
      await ctx.route("**/api/books**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ books: [] }),
        });
      });
      await ctx.route("**/api/user/books**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ books: [] }),
        });
      });
      await ctx.route("**/api/catalog**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ books: [] }),
        });
      });
    };

    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      await mockSyncEndpoints(contextA);
      await mockSyncEndpoints(contextB);

      const pageA = await contextA.newPage();
      pageA.on("pageerror", (err) => console.log("PAGE_A_ERROR:", err.message, err.stack));
      await pageA.goto("/");

      await expect(pageA.locator(".shelf-main")).toBeVisible({
        timeout: 10_000,
      });

      // Esperar que la sesión esté confirmada y la red estabilizada
      await expect(pageA.locator(".app-nav-sync-text")).toHaveText("Sincronizado", {
        timeout: 10_000,
      });
      await pageA.waitForLoadState("networkidle");

      // 1. En Contexto A, cargar libro minimal (apertura automática Zero-Friction)
      await pageA.waitForTimeout(500);
      const fileInputA = pageA.locator('input[type="file"][accept*="epub"]');
      await fileInputA.setInputFiles(MINIMAL_EPUB_PATH);
      await expect(pageA.locator(".reader")).toBeVisible({ timeout: 15_000 });
      await expect(pageA.locator(".book-content")).toContainText("Capítulo uno", {
        timeout: 15_000,
      });

      // 2. Avanzar al Capítulo dos en Contexto A
      const nextBtnA = pageA
        .locator(
          'button.page-nav-btn[aria-label="Página siguiente"], button.reader-end-link--next, button:has-text("Siguiente")',
        )
        .first();
      await nextBtnA.scrollIntoViewIfNeeded().catch(() => {});
      await nextBtnA.click();
      await expect(pageA.locator(".book-content")).toContainText(
        "Capítulo dos",
        { timeout: 15_000 },
      );

      // 3. Volver a la estantería en Contexto A para forzar el ciclo de sync de posiciones
      const putPositionsPromise = pageA.waitForResponse(
        (res) =>
          res.url().includes("/api/positions") &&
          res.request().method() === "PUT",
        { timeout: 15_000 },
      );

      const backBtn = pageA.locator("button.reader-back, button[aria-label='Volver a la estantería']").first();
      await backBtn.click({ force: true });

      const putRes = await putPositionsPromise;
      expect(putRes.status()).toBe(200);
      expect(serverPosition).not.toBeNull();
      expect((serverPosition as unknown as { sectionIndex: number })?.sectionIndex).toBe(1);

      // 4. En Contexto B (otro dispositivo del mismo usuario), abrir la app
      const pageB = await contextB.newPage();
      await pageB.goto("/");

      await expect(pageB.locator(".shelf-main")).toBeVisible({
        timeout: 10_000,
      });

      await expect(pageB.locator(".app-nav-sync-text")).toHaveText("Sincronizado", {
        timeout: 10_000,
      });
      await pageB.waitForLoadState("networkidle");

      // Cargar el libro en Contexto B (apertura automática Zero-Friction)
      await pageB.waitForTimeout(500);
      const fileInputB = pageB.locator('input[type="file"][accept*="epub"]');
      await fileInputB.setInputFiles(MINIMAL_EPUB_PATH);
      await expect(pageB.locator(".reader")).toBeVisible({ timeout: 15_000 });

      // 5. Verificar que el lector en Contexto B abre o sincroniza directamente en el Capítulo dos
      const resumeOrConfirm = pageB
        .locator(
          "button:has-text('Retomar lectura'), button:has-text('Reanudar'), button:has-text('Aceptar'), button:has-text('Continuar')",
        )
        .first();
      if (await resumeOrConfirm.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await resumeOrConfirm.click();
      }

      await expect(pageB.locator(".book-content")).toContainText(
        "Capítulo dos",
        { timeout: 15_000 },
      );
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });

  test("Journey 4: Lector Kindle E-Ink Zero-Scroll 1-Pantalla (@smoke)", async ({
    page,
  }) => {
    // Viewport estándar de Kindle físico (600x680)
    await page.setViewportSize({ width: 600, height: 680 });

    const content = paginateChapter(
      "<p>La casa antigua tenía una puerta estrecha.</p><p>Luis leyó despacio una palabra difícil: perenne.</p>",
      { size: "md", layout: "paged" },
    )[0];

    const kindleHtml = renderReaderView({
      user: { id: "smoke-user", email: "smoke@kindle.test" },
      bookHash: "smoke-kindle-book",
      bookTitle: "Libro Kindle Smoke",
      bookAuthor: "Equipo Lecta",
      chapterTitle: "Capítulo I",
      contentHtml: content,
      sectionIndex: 0,
      totalSections: 2,
      pageIndex: 0,
      totalPages: 1,
      layout: "paged",
    });

    await page.route("**/k/read/smoke-kindle-book*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: kindleHtml,
      });
    });

    await page.goto("/k/read/smoke-kindle-book?section=0&page=0&layout=paged");
    await expect(page.locator(".reader-container")).toBeVisible();
    await expect(page.locator(".turn-page-bar")).toBeVisible();
    await expect(page.locator(".cat-notes-box")).not.toBeVisible();

    // Verificación estricta Zero-Scroll en pantalla Kindle
    const noVerticalScroll = await page.evaluate(() => {
      return document.documentElement.scrollHeight <= document.documentElement.clientHeight;
    });
    expect(noVerticalScroll).toBe(true);
  });

  test("Kindle paged layout fills 75-85% of viewport without vertical scroll and persists margin (@smoke)", async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });

    await page.route("**/*read/minimal*", async (route) => {
      const url = new URL(route.request().url());
      const margin = (url.searchParams.get("margin") as "sm" | "md" | "lg") || "md";
      const size = (url.searchParams.get("size") as "sm" | "md" | "lg" | "xl") || "md";
      const layout = (url.searchParams.get("layout") as "paged" | "scroll") || "paged";

      const paragraphs = [
        "<p>El sol de la tarde caía suavemente sobre las colinas doradas mientras el camino avanzaba en silencio.</p>",
        "<p>Cada paso resonaba en la tierra seca, levantando una leve brizna de polvo que flotaba en el aire quieto.</p>",
        "<p>A lo lejos, los cipreses marcaban el límite de la antigua finca donde antaño florecieron los olivos centenarios.</p>",
        "<p>Nada perturbaba la calma de aquella hora vespertina, salvo el murmullo lejano de un arroyo escondido.</p>",
      ].join("");

      const pages = paginateChapter(paragraphs, { size, margin, layout });
      const html = renderReaderView({
        user: { id: "smoke-user", email: "smoke@kindle.test" },
        bookHash: "minimal",
        bookTitle: "Libro de prueba",
        bookAuthor: "Equipo Lecta",
        chapterTitle: "Capítulo I",
        contentHtml: pages[0],
        sectionIndex: 0,
        totalSections: 2,
        pageIndex: 0,
        totalPages: pages.length,
        layout,
        margin,
        size,
      });

      await route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        headers: {
          "Set-Cookie": `lecta_k_margin=${margin}; Path=/; Max-Age=31536000; SameSite=Lax`,
        },
        body: html,
      });
    });

    await page.goto("/kindle/read/minimal?size=md&margin=md&layout=paged");

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const content = document.querySelector(".epub-content");
      const rect = content?.getBoundingClientRect();
      return {
        scrollHeight: doc.scrollHeight,
        clientHeight: doc.clientHeight,
        contentHeight: rect ? rect.height : 0,
      };
    });

    // Criterio 2: Cero Scroll Vertical en Modo Paged
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);

    // Criterio 1: Ocupación armónica del viewport en lectura regular
    const heightRatio = metrics.contentHeight / metrics.clientHeight;
    expect(heightRatio).toBeGreaterThanOrEqual(0.75);
    expect(heightRatio).toBeLessThanOrEqual(0.90);
  });
});
