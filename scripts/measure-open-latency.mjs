// Mide la apertura de un libro con una cuenta real y /api/positions frenado.
//
// Uso:
//   LECTA_STATE=auth.json node scripts/measure-open-latency.mjs
//   LECTA_COOKIE='better-auth.session_token=...' node scripts/measure-open-latency.mjs
//   LECTA_EMAIL=... LECTA_PASSWORD=... node scripts/measure-open-latency.mjs
//
// Variables:
//   BASE_URL      default https://lecta.luis-sg9915.workers.dev
//   BOOK_TITLE    fragmento del título; sin él usa el primer libro
//   DELAY_MS      retraso de /api/positions (default 2600)
//   RUNS          repeticiones (default 5)
//   LECTA_STATE   storageState de Playwright ya autenticado (recomendado)
//   LECTA_COOKIE  cabecera Cookie copiada de DevTools
//   LECTA_EMAIL / LECTA_PASSWORD  alternativa por API
//
// No crea datos: abre un libro que ya existe en la cuenta. La primera
// pasada (warm-up) descarga el EPUB si hace falta y no se mide.

import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";

// Atajo local: carga `.env` (donde ya vive la cookie si la pegaste ahí) y
// luego `.env.measure` para los ajustes de la medición. El primero gana, así
// que una cookie real en `.env` no se pisa con la plantilla. Ambos están
// ignorados por git.
for (const file of [".env", ".env.measure"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const base = process.env.BASE_URL ?? "https://lecta.luis-sg9915.workers.dev";
const delay = Number(process.env.DELAY_MS ?? 2600);
const runs = Math.max(1, Number(process.env.RUNS ?? 5));
const title = process.env.BOOK_TITLE ?? "";
const statePath = process.env.LECTA_STATE;
const email = process.env.LECTA_EMAIL;
const password = process.env.LECTA_PASSWORD;
const cookie = process.env.LECTA_COOKIE;

const stateExists = statePath ? await stat(statePath).then(() => true, () => false) : false;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  storageState: stateExists ? statePath : undefined,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => {
  // Chrome avisa cuando una ViewTransition se reemplaza por otra; no es
  // un fallo de la apertura y no debe contaminar la medición.
  if (!error.message.includes("Transition was skipped")) errors.push(error.message);
});

if (cookie) {
  const url = new URL(base);
  const cookies = cookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      return {
        name: part.slice(0, index),
        value: part.slice(index + 1),
        domain: url.hostname,
        path: "/",
        secure: url.protocol === "https:",
        httpOnly: true,
        sameSite: "Lax",
      };
    });
  await context.addCookies(cookies);
}

if (!stateExists && !cookie) {
  if (!email || !password) {
    throw new Error("Falta LECTA_STATE, LECTA_COOKIE o LECTA_EMAIL + LECTA_PASSWORD.");
  }
  const response = await page.request.post(`${base}/api/auth/sign-in/email`, {
    data: { email, password },
  });
  if (!response.ok()) {
    throw new Error(`Login falló (${response.status()}). Usa LECTA_STATE.`);
  }
}

async function openOnce(measure) {
  await page.goto(base, { waitUntil: "networkidle" });
  const card = title
    ? page.locator(".shelf-book").filter({ hasText: title }).first()
    : page.locator(".shelf-book").first();
  await card.waitFor({ state: "visible", timeout: 20_000 });

  const positionsResponse = page
    .waitForResponse(
      (response) =>
        response.url().includes("/api/positions") &&
        response.request().method() === "GET",
      { timeout: delay + 8_000 },
    )
    .catch(() => null);

  const startedAt = Date.now();
  await card.click();
  await page.waitForSelector(".book-content", { state: "attached" });
  const openMs = Date.now() - startedAt;
  const chapterText = () =>
    page.locator(".dock-chapter-text").first().innerText({ timeout: 2_000 }).catch(() => "");
  const firstChapter = await chapterText();

  if (!measure) return { openMs, firstChapter };

  const response = await positionsResponse;
  // El salto se aplica en un efecto: dar un tick antes de leer el título.
  await page.waitForTimeout(250);
  const afterSync = await chapterText();
  const prompt = await page.locator(".dialog-scrim").count();
  return {
    openMs,
    firstChapter,
    positionsStatus: response?.status() ?? null,
    afterSync,
    prompt,
    remoteApplied: afterSync !== firstChapter,
  };
}

const warm = await openOnce(false);

// El freno se instala una sola vez y solo afecta a la lectura de
// posiciones: la descarga del EPUB y el resto de la API no se tocan.
await page.route("**/api/positions**", async (route) => {
  if (route.request().method() === "GET") {
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  await route.continue();
});

const samples = [];
for (let index = 0; index < runs; index++) {
  samples.push(await openOnce(true));
  // Cerrar por JS: la barra puede estar fuera del viewport en modo
  // inmersivo y un clic normal falla. Sin recarga se conservan los
  // chunks y la medición no paga la descarga inicial en cada muestra.
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const back = document.querySelector(".reader-back");
    back?.click();
  });
  // Esperar a que el lector termine de desmontarse evita encadenar una
  // apertura con la transición de cierre anterior.
  await page.waitForSelector(".reader", { state: "detached", timeout: 8_000 }).catch(() => null);
  await page.waitForSelector(".shelf-book", { state: "visible" });
  await page.waitForTimeout(500);
}

const times = samples.map((sample) => sample.openMs).sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)];
console.log(JSON.stringify({
  base,
  delayMs: delay,
  book: title || "(primero)",
  warmUpMs: warm.openMs,
  medianOpenMs: median,
  samples,
  errors,
}, null, 2));

await browser.close();
