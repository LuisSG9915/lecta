import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { withTestSession } from "./helpers/session";

// La cuenta es obligatoria: sin sesión la app muestra la bienvenida.
test.beforeEach(async ({ context }) => {
  await withTestSession(context);
});

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
 * Biblioteca comunitaria «solo papel» (modelo A1): compartir genera la
 * GUÍA de vocabulario en el dispositivo (índice + formas, cero texto)
 * y la sube con el PUT /share; adjuntar devuelve la guía y crea la
 * entrada `paperOnly` local de 0 bytes — jamás se descarga un EPUB y
 * el toque lleva al índice del modo papel, nunca al lector.
 */
test.describe("Lecta — biblioteca comunitaria", () => {
  test("compartir sube la guía y adjuntar instala la copia «solo papel»", async ({
    page,
    context,
  }) => {
    await stubSession(context);
    await stubLexicon(page);

    const epubBytes = fs.readFileSync(MINIMAL_EPUB_PATH);
    // El libro propio es el fixture subido por el input — su hash real.
    const ownHash = crypto
      .createHash("sha256")
      .update(epubBytes)
      .digest("hex");
    const communityHash = "b".repeat(64);
    const communityGuide = {
      version: 1,
      bookHash: communityHash,
      title: "Libro de la comunidad",
      author: "Autora Vecina",
      language: "es",
      updatedAt: 1,
      chapters: [
        {
          id: "cap/uno.xhtml",
          label: "Capítulo 1",
          depth: 0,
          kind: "chapter",
          forms: ["antigua", "perenne"],
          capitalOnly: [],
        },
      ],
    };

    // Estado mutable del arnés: `shared` cambia tras el PUT /share y
    // `attached` tras el POST /attach — la estantería refleja la fila.
    let shared = false;
    let attached = false;
    let shareBodyGuide: unknown = null;

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
          sections: 0,
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
        try {
          shareBodyGuide = route.request().postDataJSON()?.guide ?? null;
        } catch {
          shareBodyGuide = null;
        }
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
              sizeBytes: 0,
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
          body: JSON.stringify({
            ok: true,
            hash: communityHash,
            guide: communityGuide,
          }),
        });
      },
    );

    // Defensa A1: jamás se pide el EPUB del hash comunitario. Si el
    // cliente lo intentara, el stub responde 403 y el test lo nota.
    let epubDownloaded = false;
    await page.route(`**/api/books/${communityHash}`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      epubDownloaded = true;
      await route.fulfill({ status: 403, body: "paper_only" });
    });

    await page.goto("/");
    await expect(page.locator(".shelf-main")).toBeVisible({ timeout: 10_000 });

    // Sube el fixture: la guía de «compartir» se genera del EPUB local.
    const fileInput = page.locator('input[type="file"][accept*="epub"]');
    await fileInput.setInputFiles(MINIMAL_EPUB_PATH);
    await expect(page.locator(".reader")).toBeVisible({ timeout: 15_000 });
    await page.goBack();
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

    // La guía viajó en el PUT: capítulos con formas, cero texto.
    expect(shareBodyGuide).toBeTruthy();
    const guide = shareBodyGuide as {
      bookHash: string;
      chapters: Array<{ forms: string[]; text?: string }>;
      text?: string;
    };
    expect(guide.bookHash).toBe(ownHash);
    expect(guide.chapters.length).toBeGreaterThan(0);
    expect(guide.text).toBeUndefined();
    for (const ch of guide.chapters) {
      expect(ch.text).toBeUndefined();
      expect(Array.isArray(ch.forms)).toBe(true);
    }

    // --- Comunidad: sección visible con la guía ajena ---
    const community = page.locator(".shelf-community");
    await expect(community).toBeVisible({ timeout: 10_000 });
    await expect(community).toContainText("Libro de la comunidad");
    await expect(community).toContainText("Guía de papel");

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
    // El índice sale de la guía (capítulo declarado por el donante).
    await expect(screen).toContainText("Capítulo 1", { timeout: 15_000 });

    // A1 verificado de punta a punta: ningún EPUB se descargó.
    expect(epubDownloaded).toBe(false);
  });
});
