import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { withTestSession } from "./helpers/session";

// La cuenta es obligatoria: sin sesión la app muestra la bienvenida.
test.beforeEach(async ({ context }) => {
  await withTestSession(context);
});

const MINIMAL_EPUB_PATH = path.resolve(process.cwd(), "fixtures/minimal.epub");

// El arnés corre con la base simulada: el catálogo léxico responde con
// fichas mínimas para que el análisis del capítulo siga su ruta real
// (igual que haría en producción), no el camino de «sin conexión».
const lexiconEntry = (form: string) => ({
  entryId: `mock-${form}`,
  lemma: form,
  pos: "sust.",
  // Por debajo del umbral nativo (2.0): toda forma cuenta como rara y
  // la selección propone filas — el caso rico que el flujo ejercita.
  zipf: 1.9,
  senses: [
    { senseOrder: 1, definition: `Definición de ${form}`, example: "" },
  ],
});

const stubLexicon = async (page: import("@playwright/test").Page) => {
  await page.route("**/api/lexicon/batch", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}") as {
      forms?: string[];
    };
    const entries = Object.fromEntries(
      (body.forms ?? []).map((form) => [form, [lexiconEntry(form)]]),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, entries }),
    });
  });
  await page.route("**/api/lexicon/lookup**", async (route) => {
    const url = new URL(route.request().url());
    const form = url.searchParams.get("form") ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        found: true,
        entries: [lexiconEntry(form)],
      }),
    });
  });
};

/**
 * «Leo este libro en papel»: la entrada vive en Opciones del libro (no
 * en tocar la portada — eso sigue abriendo el lector), muestra el
 * índice de capítulos con estados en texto, la hoja con palabras del
 * capítulo, el alta manual por autocompletado y «Terminé este
 * capítulo» con su panel posterior.
 */
test.describe("Lecta — Leo este libro en papel", () => {
  test("tap directo abre el lector; Opciones abre el modo papel completo", async ({
    page,
  }) => {
    const runtimeErrors: string[] = [];
    page.on("pageerror", (err) => {
      // Errores de red del arnés (API simulada): no son del flujo.
      if (
        err.message.includes("access control checks") ||
        err.message.includes("Failed to fetch") ||
        err.message.includes("NetworkError")
      ) {
        return;
      }
      runtimeErrors.push(err.message);
    });

    await stubLexicon(page);

    await page.goto("/");
    await expect(page.locator(".shelf-main")).toBeVisible({
      timeout: 10_000,
    });
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);

    // Regla intacta: importar/tocar el libro abre el lector, no el
    // índice de papel.
    await expect(page.locator(".reader")).toBeVisible({ timeout: 15_000 });

    await page.goBack();
    await expect(page.locator(".shelf-main")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".reader")).toHaveCount(0);

    // Entrada única: Opciones del libro → «Leo este libro en papel».
    await page.locator(".shelf-book-more").first().click();
    await page
      .getByRole("button", { name: "Leo este libro en papel" })
      .click();

    const screen = page.locator(".paper-screen");
    await expect(screen).toBeVisible({ timeout: 15_000 });
    await expect(screen).toContainText("Leo este libro en papel");
    await expect(screen).toContainText(
      "Elige el capítulo que vas a leer. Te mostramos las palabras que podrían costarte.",
    );

    // Índice con estados en texto; sin hashes ni jerga técnica.
    const chapters = screen.locator(".paper-chapter");
    await expect(chapters.first()).toBeVisible({ timeout: 15_000 });
    await expect(screen).toContainText("Sin revisar");
    await expect(screen).not.toContainText("Entrar al capítulo");
    await expect(screen).not.toContainText("Estrategia");

    // La hoja del capítulo carga y muestra las filas sugeridas.
    await chapters.first().click();
    const sheet = page.locator(".sheet");
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet).toContainText("Palabras que podrían costarte", {
      timeout: 20_000,
    });
    await expect(sheet).not.toContainText("Entrar al capítulo");

    // La respuesta queda como borrador (se confirma al cerrar).
    const firstRow = sheet.locator(".section-preview-item").first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
    await firstRow
      .getByRole("button", { name: "No la conozco" })
      .click();

    // Alta manual: «perenne» aparece en el capítulo del fixture; el
    // autocompletado la sugiere antes que el diccionario.
    await sheet.locator("#paper-add-input").fill("per");
    const suggestion = sheet.locator(".paper-suggestion", {
      hasText: "perenne",
    });
    await expect(suggestion).toBeVisible({ timeout: 10_000 });
    await suggestion.click();
    await expect(sheet).toContainText("guardada en tu Herbario", {
      timeout: 10_000,
    });

    // «Terminé este capítulo»: confirma, marca leído y muestra el
    // panel posterior sin falsificar un repaso.
    await sheet
      .getByRole("button", { name: "Terminé este capítulo" })
      .click();
    await expect(sheet).toContainText("Capítulo marcado como leído", {
      timeout: 10_000,
    });
    await sheet
      .getByRole("button", { name: "Volver a los capítulos" })
      .click();

    await expect(screen).toContainText("Leído", { timeout: 10_000 });
    await expect(screen).toContainText("Aquí te quedaste");

    // El release() de la hoja viaja tras el autoguardado (async): un
    // gesto «atrás» instantáneo aterrizaría en la entrada de la hoja
    // ya cerrada en vez de en la de la pantalla. Se espera a que el
    // back sintético se asiente antes de navegar, como una persona.
    await page.waitForTimeout(400);

    // «Atrás» desde la pantalla vuelve a la estantería.
    await page.goBack();
    await expect(page.locator(".shelf-main")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator(".paper-screen")).toHaveCount(0);

    expect(
      runtimeErrors,
      `errores de consola inesperados: ${runtimeErrors.join(" | ")}`,
    ).toEqual([]);
  });

  /**
   * Libro que solo vive en la cuenta (sin EPUB local): la estantería lo
   * muestra como remoto y «Leo este libro en papel» lo descarga por la
   * misma ruta de «Descargar y abrir» antes de entrar al índice.
   */
  test("libro solo-en-cuenta: descarga primero y entra al modo papel", async ({
    page,
    context,
  }) => {
    await stubLexicon(page);

    // La estantería solo lista libros de la cuenta con sesión activa
    // (refreshLibrary); el arnés la simula como en smoke-journeys.
    await context.route("**/api/auth/get-session", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session: {
            id: "sess_paper_test",
            userId: "u_paper_test",
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
          user: {
            id: "u_paper_test",
            email: "paper@test.com",
            name: "Paper User",
          },
        }),
      });
    });

    const remoteHash = "remote-paper-book";
    const epubBytes = fs.readFileSync(MINIMAL_EPUB_PATH);
    await page.route("**/api/books", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          books: [
            {
              hash: remoteHash,
              uploaded: "2026-10-01T00:00:00Z",
              name: "libro-nube.epub",
              title: "Libro en la nube",
              sections: 2,
              language: "es",
            },
          ],
        }),
      });
    });
    await page.route(`**/api/books/${remoteHash}`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/epub+zip",
        body: epubBytes,
      });
    });

    await page.goto("/");
    await expect(page.locator(".shelf-main")).toBeVisible({
      timeout: 10_000,
    });
    const remoteBook = page.locator(".shelf-book").first();
    await expect(remoteBook).toBeVisible({ timeout: 15_000 });
    await expect(remoteBook).toContainText("Libro en la nube");

    await page.locator(".shelf-book-more").first().click();
    await page
      .getByRole("button", { name: "Leo este libro en papel" })
      .click();

    // Descarga → guardado → la pantalla abre con el índice real.
    const screen = page.locator(".paper-screen");
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await expect(screen.locator(".paper-chapter").first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
