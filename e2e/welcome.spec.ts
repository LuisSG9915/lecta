import { test, expect } from "@playwright/test";

// Cuenta obligatoria (docs/designs/2026-11-12-planes-y-landing.md): sin sesión
// la app muestra la bienvenida con el gato elegido en el landing.
test.describe("Bienvenida sin sesión", () => {
  test("?gato=calico llega a la bienvenida con el calicó y limpia la URL", async ({ page }) => {
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "null" }),
    );
    await page.goto("/?gato=calico");
    await expect(page.locator(".welcome")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".welcome")).toContainText("Calicó Literario");
    await expect(page.locator(".shelf-main")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");
    expect(await page.evaluate(() => localStorage.getItem("lecta:gato"))).toBe("calico");
  });
});
