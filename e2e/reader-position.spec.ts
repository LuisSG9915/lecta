import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

// La posición del lector es el único estado que, si se guarda mal, se
// pierde del todo: cada apertura vuelve a guardar lo que acaba de
// restaurar, así que un aterrizaje impreciso se consagra.
//
// Este arnés hace el viaje completo: leer a media página, dejar correr el
// guardado perezoso, reabrir el mismo libro y exigir que el bloque que
// estaba arriba siga arriba y con el mismo desplazamiento *dentro* del
// párrafo (la parte que el texto del ancla no puede reconstruir).
//
// `fixtures/scroll.epub` (scripts/make-scroll-fixture.mjs) trae párrafos
// cortos, medios y más altos que la ventana, cada uno con su token «Pnn».
const SCROLL_EPUB_PATH = path.resolve(process.cwd(), "fixtures/scroll.epub");

// Párrafo largo del capítulo 1 del fixture (55 palabras): más alto que
// media ventana, que es donde se notaba el salto de una pantalla.
const TARGET_TOKEN = "P05";

type ViewTop = {
  token: string | null;
  // Píxeles del bloque que ya quedaron fuera por arriba.
  offsetPx: number;
  heightPx: number;
  scrollY: number;
};

/**
 * Espera a que el alto del documento y el scroll dejen de moverse.
 * Importar el libro y asentar fuentes mueven la geometría durante un
 * rato: medir antes de tiempo hace fallar la prueba, no la app.
 */
const settle = (page: Page, quietMs = 250, timeoutMs = 8_000) =>
  page.evaluate(
    async ({ quietMs, timeoutMs }) => {
      await document.fonts?.ready.catch(() => undefined);
      const t0 = Date.now();
      let last = "";
      let since = Date.now();
      for (;;) {
        const key = `${document.documentElement.scrollHeight}:${Math.round(window.scrollY)}`;
        if (key !== last) {
          last = key;
          since = Date.now();
        } else if (Date.now() - since >= quietMs) {
          return key;
        }
        if (Date.now() - t0 > timeoutMs) return key;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
    { quietMs, timeoutMs },
  );

/** Mismo criterio que `viewTopAnchor`: primer bloque que cruza el horizonte. */
const readViewTop = (page: Page): Promise<ViewTop> =>
  page.evaluate(() => {
    const horizon = Math.min(window.innerHeight * 0.5, 400);
    const blocks = [
      ...document.querySelectorAll<HTMLElement>(".book-content p"),
    ];
    for (const el of blocks) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < horizon) {
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
        return {
          token: text.slice(0, 3),
          offsetPx: Math.max(0, Math.round(-rect.top)),
          heightPx: Math.round(rect.height),
          scrollY: Math.round(window.scrollY),
        };
      }
    }
    return {
      token: null,
      offsetPx: 0,
      heightPx: 0,
      scrollY: Math.round(window.scrollY),
    };
  });

const disableServiceWorker = async (page: Page) => {
  // El service worker puede recargar la página al tomar el control y eso
  // desmonta el lector a mitad de la prueba. La app ya no recarga en la
  // primera visita (src/client/lib/sw-register.ts), pero el arnés no
  // depende de ese detalle: aquí no se registra ninguno.
  await page.addInitScript(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    Object.defineProperty(sw, "register", {
      configurable: true,
      value: async () => ({
        update: async () => {},
        addEventListener() {},
        removeEventListener() {},
        waiting: null,
        active: null,
        installing: null,
      }),
    });
  });
};

const BOOK_TITLE = "Libro largo de prueba";

/** Estado de la pantalla, para que un fallo diga qué había en vez de solo «timeout». */
const describeScreen = (page: Page) =>
  page.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 240),
    books: document.querySelectorAll(".shelf-book").length,
    reading: document.querySelectorAll(".reader").length,
    content: document.querySelectorAll(".book-content p").length,
  }));

const waitForReader = async (page: Page) => {
  try {
    await expect(page.locator(".reader")).toBeVisible({ timeout: 30_000 });
  } catch (error) {
    const screen = await describeScreen(page);
    throw new Error(
      `${String(error).split("\n")[0]} | pantalla: ${JSON.stringify(screen)}`,
      { cause: error },
    );
  }
  await expect(page.locator(".book-content")).toContainText("P01 ·", {
    timeout: 20_000,
  });
  // La sección termina de asentarse (fuentes, cromo, hidratación).
  await settle(page);
};

/** Primera apertura: importar el EPUB desde la estantería. */
const importScrollBook = async (page: Page) => {
  await page.goto("/");
  await expect(page.locator(".shelf-main")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  const fileInput = page.locator('input[type="file"][accept*="epub"]');
  await fileInput.setInputFiles(SCROLL_EPUB_PATH);
  try {
    await waitForReader(page);
  } catch (firstError) {
    // Arranque en frío del navegador (bundle, primer worker de zip.js): si a
    // los 30 s no hay lector y la estantería sigue ahí, se reintenta una vez
    // en vez de dejar la suite en rojo por el arranque.
    const screen = await describeScreen(page);
    if (screen.reading > 0) throw firstError;
    await fileInput.setInputFiles(SCROLL_EPUB_PATH);
    await waitForReader(page);
  }
};

/**
 * Reabrir como lo hace una persona: recargar, ver la estantería y tocar el
 * libro. Reimportar el mismo EPUB cada vez era el paso frágil de esta
 * prueba (parsea el zip y pega contra la API simulada del arnés), no la app.
 */
const reopenScrollBook = async (page: Page) => {
  await page.goto("/");
  await expect(page.locator(".shelf-main")).toBeVisible({ timeout: 15_000 });
  const book = page.locator(`button[aria-label="Abrir ${BOOK_TITLE}"]`).first();
  await expect(book).toBeVisible({ timeout: 15_000 });
  await book.click();
  await waitForReader(page);
};

const storedRow = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<{ anchor: string | null; anchorOffset?: number } | null>(
        (resolve) => {
          const req = window.indexedDB.open("lecta");
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction("positions", "readonly");
            const all = tx.objectStore("positions").getAll();
            all.onsuccess = () => {
              const rows = all.result as Array<{
                anchor?: string | null;
                anchorOffset?: number;
              }>;
              db.close();
              resolve(
                rows[0]
                  ? {
                      anchor: rows[0].anchor ?? null,
                      anchorOffset: rows[0].anchorOffset,
                    }
                  : null,
              );
            };
            all.onerror = () => {
              db.close();
              resolve(null);
            };
          };
          req.onerror = () => resolve(null);
        },
      ),
  );

test.describe("Lecta — la última posición real del lector", () => {
  // Ancho de móvil: los párrafos largos ocupan más de una pantalla, que es
  // donde se notaba el salto.
  test.use({ viewport: { width: 390, height: 844 } });

  test("reabrir el libro devuelve el mismo punto, no el inicio del párrafo", async ({
    page,
  }) => {
    await disableServiceWorker(page);
    await importScrollBook(page);

    // Leer a media página del párrafo largo del capítulo.
    const target = await page.evaluate((token) => {
      const el = [
        ...document.querySelectorAll<HTMLElement>(".book-content p"),
      ].find((node) => (node.textContent ?? "").trim().startsWith(token));
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      window.scrollTo(
        0,
        rect.top + window.scrollY + Math.round(rect.height * 0.55),
      );
      return {
        token: (el.textContent ?? "").slice(0, 3),
        height: Math.round(rect.height),
      };
    }, TARGET_TOKEN);
    expect(target, `no aparece el párrafo ${TARGET_TOKEN}`).not.toBeNull();
    expect(target!.height).toBeGreaterThan(150);

    // El guardado perezoso espera 400 ms de calma.
    await page.waitForTimeout(1_500);

    const before = await readViewTop(page);
    expect(before.token).toBe(target!.token);
    expect(before.offsetPx).toBeGreaterThan(100);

    const stored = await storedRow(page);
    expect(stored?.anchor?.startsWith(target!.token ?? "")).toBe(true);
    // La fracción guardada es la que reconstruye el punto: si el arnés
    // viera el párrafo correcto por casualidad, este sello lo delata.
    expect(stored?.anchorOffset ?? 0).toBeGreaterThan(0.2);

    // Reabrir el mismo libro (mismo contenido → mismo hash → misma fila).
    await reopenScrollBook(page);
    // El corrector de deriva puede tardar unos cuadros en asentar.
    await settle(page, 400, 6_000);

    const after = await readViewTop(page);

    // El bloque de arriba tiene que ser el mismo...
    expect(
      after.token,
      `se restauró en ${after.token} (${after.offsetPx}px dentro) en vez de ${before.token} (${before.offsetPx}px dentro)`,
    ).toBe(before.token);
    // ...y con el mismo desplazamiento dentro del párrafo: ahí es donde
    // se notaba el salto de hasta una pantalla por párrafo largo.
    expect(
      Math.abs(after.offsetPx - before.offsetPx),
      `desplazamiento dentro del párrafo: antes ${before.offsetPx}px, después ${after.offsetPx}px`,
    ).toBeLessThanOrEqual(24);

    // Reabrir otra vez no acumula deriva: cada apertura vuelve a guardar
    // lo que acaba de restaurar.
    await page.waitForTimeout(1_200);
    await reopenScrollBook(page);
    await settle(page, 400, 6_000);
    const again = await readViewTop(page);
    expect(
      again.token,
      `segunda reapertura en ${again.token} (${again.offsetPx}px dentro)`,
    ).toBe(before.token);
    expect(
      Math.abs(again.offsetPx - before.offsetPx),
      `deriva acumulada: antes ${before.offsetPx}px, tras dos aperturas ${again.offsetPx}px`,
    ).toBeLessThanOrEqual(24);
  });

  // «Atrás» del navegador (gesto o botón) no pasa por la flecha del lector:
  // cierra el libro desde App. Si ese camino no guarda y sincroniza, la
  // sesión de lectura termina sin dejar rastro y la próxima apertura puede
  // volver a un punto anterior.
  test("salir con el atrás del navegador conserva el punto de lectura", async ({
    page,
  }) => {
    await disableServiceWorker(page);
    await importScrollBook(page);

    await page.evaluate((token) => {
      const el = [
        ...document.querySelectorAll<HTMLElement>(".book-content p"),
      ].find((node) => (node.textContent ?? "").trim().startsWith(token));
      if (!el) return;
      const rect = el.getBoundingClientRect();
      window.scrollTo(
        0,
        rect.top + window.scrollY + Math.round(rect.height * 0.55),
      );
    }, TARGET_TOKEN);
    await page.waitForTimeout(1_500);
    const before = await readViewTop(page);
    expect(before.token).toBe(TARGET_TOKEN);
    expect(before.offsetPx).toBeGreaterThan(100);

    // El gesto de retroceso: el historial vuelve a la estantería y App
    // desmonta el lector por el callback del overlay (no por handleBack).
    await page.goBack();
    await expect(page.locator(".shelf-main")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".reader")).toHaveCount(0);

    const stored = await storedRow(page);
    expect(stored?.anchor?.startsWith(TARGET_TOKEN)).toBe(true);
    expect(stored?.anchorOffset ?? 0).toBeGreaterThan(0.2);

    // Volver a abrir desde la estantería, como haría la persona.
    const book = page
      .locator(`button[aria-label="Abrir ${BOOK_TITLE}"]`)
      .first();
    await expect(book).toBeVisible({ timeout: 15_000 });
    await book.click();
    await waitForReader(page);
    await settle(page, 400, 6_000);

    const after = await readViewTop(page);
    expect(
      after.token,
      `se restauró en ${after.token} (${after.offsetPx}px dentro) en vez de ${before.token} (${before.offsetPx}px dentro)`,
    ).toBe(before.token);
    expect(
      Math.abs(after.offsetPx - before.offsetPx),
      `tras el gesto de retroceso: antes ${before.offsetPx}px, después ${after.offsetPx}px`,
    ).toBeLessThanOrEqual(24);
  });
});
