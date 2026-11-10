// Verificación visual de la auditoría de diseño: temas, gato y
// reduced-motion sobre el dev server. Uso: node scripts/visual-audit.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Vite escucha solo en IPv6 (::1); 127.0.0.1 no responde.
const BASE = process.env.VISUAL_URL ?? "http://[::1]:5173/";
const OUT = "artifacts/visual-audit";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 160));
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 90000 });
// Esperar a que la app monte y el gato (si aparece) renderice.
await page.waitForTimeout(6000);

const state = await page.evaluate(() => ({
  rootChildren: document.getElementById("root")?.children.length ?? 0,
  catCount: document.querySelectorAll(".cat").length,
  catMotion: document.documentElement.dataset.catMotion,
  theme: document.documentElement.dataset.theme ?? null,
  prefersDark: matchMedia("(prefers-color-scheme: dark)").matches,
}));
console.log("estado inicial:", JSON.stringify(state));

// Localizar al gato en pantalla para recortarlo en las capturas.
const catBox = await page.evaluate(() => {
  const el = document.querySelector(".cat");
  if (!el) return null;
  const r = el.closest("svg")?.getBoundingClientRect() ?? el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
console.log("catBox:", JSON.stringify(catBox));

// Temas: forzar data-theme + esquema de color del sistema.
const themes = [
  { name: "papel", scheme: "light" },
  { name: "blanco", scheme: "light" },
  { name: "noche", scheme: "dark" },
  { name: "oled", scheme: "dark" },
];

for (const t of themes) {
  await page.emulateMedia({ colorScheme: t.scheme });
  await page.evaluate((theme) => {
    document.documentElement.dataset.theme = theme;
  }, t.name);
  await page.waitForTimeout(400);
  const metrics = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return {
      paper: cs.getPropertyValue("--paper").trim(),
      ink: cs.getPropertyValue("--ink").trim(),
      outline: cs.getPropertyValue("--cat-outline").trim(),
      fur: cs.getPropertyValue("--cat-fur").trim(),
      bg: getComputedStyle(document.body).backgroundColor,
    };
  });
  console.log(`tema ${t.name}:`, JSON.stringify(metrics));
  await page.screenshot({ path: `${OUT}/theme-${t.name}.png` });
  if (catBox) {
    await page.screenshot({
      path: `${OUT}/cat-${t.name}.png`,
      clip: {
        x: Math.max(0, catBox.x - 40),
        y: Math.max(0, catBox.y - 40),
        width: Math.min(1280, catBox.w + 80),
        height: Math.min(800, catBox.h + 80),
      },
    });
  }
}

// Reduced-motion: emular prefers-reduced-motion y recargar estado.
await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
await page.evaluate(() => {
  document.documentElement.dataset.theme = "oled";
  document.documentElement.dataset.catMotion = "system";
});
await page.waitForTimeout(400);
const rm = await page.evaluate(() => {
  const cat = document.querySelector(".cat");
  const eyesOpen = cat?.querySelector(".cat-eyes--open");
  const anim = eyesOpen ? getComputedStyle(eyesOpen).animationName : null;
  return {
    catMotion: document.documentElement.dataset.catMotion,
    blinkAnim: anim,
    stillClass: cat?.getAttribute("class")?.includes("cat--still") ?? null,
  };
});
console.log("reduced-motion:", JSON.stringify(rm));
await page.screenshot({ path: `${OUT}/theme-oled-reduced.png` });

// Zoom 200%: layout a 640px efectivos.
await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
await page.evaluate(() => {
  delete document.documentElement.dataset.theme;
});
await page.setViewportSize({ width: 640, height: 400 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/zoom200-mobile.png`, fullPage: false });
const overflow = await page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  clientW: document.documentElement.clientWidth,
  hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));
console.log("viewport 640px:", JSON.stringify(overflow));

await browser.close();
console.log(`Listo. Capturas en ${OUT}/`);
