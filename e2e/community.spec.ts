import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const MINIMAL_EPUB_PATH = path.resolve(process.cwd(), "fixtures/minimal.epub");

const stubSession = async (context: import("@playwright/test").BrowserContext) => {
  await context.route("**/api/auth/get-session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "sess_community_test",
          userId: "u_community_test",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
        user: {
          id: "u_community_test",
          email: "community@test.com",
          name: "Community User",
        },
      }),
    });
  });
};

const stubLexicon = async (page: import("@playwright/test").Page) => {
  await page.route("**/api/lexicon/batch", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, entries: {} }),
    });
  });
};

/**
 * Biblioteca comunitaria «solo papel»: mi EPUB se ofrece desde Opciones;
 * los libros ajenos se listan en «Comunidad», se adjuntan como copia
 * `paperOnly` (sello «Papel») y jamás abren el lector — el toque lleva
 * al índice del modo papel tras descargar el EPUB para el análisis.
 */
test.describe("Lecta — biblioteca comunitaria", () => {
  test("compartir desde Opciones y adjuntar como copia «solo papel»", async ({
    page,
    context,
  }) => {
    await stubSession(context);
    await stubLexicon(page);

    const ownHash = "a".repeat(64);
    const communityHash = "b".repeat(64);
    const epubBytes = fs.readFileSync(MINIMAL_EPUB_PATH);

    // Estado mutable del arnés: `shared` cambia tras el PUT /share y
    // `attached` tras el POST /attach — la estantería refleja la fila.
    let shared = false;
    let attached = false;

    await page.route("**/api/books", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const books: Array<Record<string, unknown>> = [
        {
          hash: ownHash,
          uploaded: "2026-10-01T00:00:00Z",
          name: "mi-libro.epub",
          title: "Mi libro compartible",
          sections: 2,
          language: "es",
          shared,
        },
      ];
      if (attached) {
        books.push({
          hash: communityHash,
          uploaded: "2026-10-02T00:00:00Z",
          name: "libro-comunidad.epub",
          title: "Libro de la comunidad",
          sections: 2,
          language: "es",
          paperOnly: true,
        });
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ books }),
      });
    });

    await page.route(`**/api/books/${ownHash}/share`, async (route) => {
      if (route.request().method() === "PUT") {
        shared = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, shared: true }),
        });
        return;
      }
      return route.fallback();
    });

    await page.route("**/api/books/community", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          books: [
            {
              hash: communityHash,
              title: "Libro de la comunidad",
              author: "Autora Vecina",
              language: "es",
              sizeBytes: 12345,
              hasCover: false,
              sharers: 2,
            },
          ],
        }),
      });
    });

    await page.route(
      `**/api/books/community/${communityHash}/attach`,
      async (route) => {
        attached = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, hash: communityHash }),
        });
      },
    );

    await page.route(`**/api/books/${communityHash}`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/epub+zip",
        body: epubBytes,
      });
    });

    await page.goto("/");
    await expect(page.locator(".shelf-main")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".shelf-book").first()).toBeVisible({
      timeout: 15_000,
    });

    // --- Compartir: Opciones → «Compartir a la comunidad» ---
    await page.locator(".shelf-book-more").first().click();
    await page
      .getByRole("button", { name: "Compartir a la comunidad" })
      .click();
    // Tras compartir, la estantería se refresca y Opciones ofrece retirar.
    await page.locator(".shelf-book-more").first().click();
    await expect(
      page.getByRole("button", { name: "Dejar de compartir en la comunidad" }),
    ).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press("Escape");

    // --- Comunidad: sección visible con el libro ajeno ---
    const community = page.locator(".shelf-community");
    await expect(community).toBeVisible({ timeout: 10_000 });
    await expect(community).toContainText("Libro de la comunidad");
    await expect(community).toContainText("2 lectores");

    // --- Adjuntar: «Usar en papel» → copia con sello «Papel» ---
    await community.getByRole("button", { name: "Usar en papel" }).click();
    const paperBook = page.locator(".shelf-book", {
      hasText: "Libro de la comunidad",
    });
    await expect(paperBook).toBeVisible({ timeout: 15_000 });
    await expect(paperBook.locator(".shelf-paperonly-badge")).toBeVisible();

    // Opciones del libro «solo papel»: ni «Descargar y abrir» ni compartir.
    await paperBook.locator(".shelf-book-more").click();
    await expect(
      page.getByRole("button", { name: "Descargar y abrir" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Compartir a la comunidad" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    // El toque en la portada abre el índice de papel — nunca el lector.
    await paperBook.locator(".shelf-book-cover").first().click();
    const screen = page.locator(".paper-screen");
    await expect(screen).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".reader")).toHaveCount(0);
  });
});
