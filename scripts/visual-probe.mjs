import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://[::1]:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });

// Esperar hasta 20 s a que el gato aparezca.
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => ({
    cats: document.querySelectorAll(".cat").length,
    thumbs: document.querySelectorAll(".companion-thumb").length,
    companionBtn: !!document.querySelector(".companion-btn, [class*=companion]"),
    cls: [...document.querySelectorAll("[class*=companion]")].slice(0, 5).map(e => e.className.toString().slice(0, 60)),
  }));
  if (i % 4 === 0 || s.cats > 0) console.log(`t=${i + 1}s`, JSON.stringify(s));
  if (s.cats > 0) break;
}

// Si no hay gato, mirar qué dice el provider: buscar botones de ajustes/gato.
const ui = await page.evaluate(() => {
  const texts = [...document.querySelectorAll("button")].map(b => (b.innerText || b.getAttribute("aria-label") || "").trim()).filter(Boolean);
  return texts.filter(t => /gato|compañ|michi|miso|cuarto|armario/i.test(t)).slice(0, 10);
});
console.log("botones gato:", JSON.stringify(ui));
await page.screenshot({ path: "artifacts/visual-audit/probe-final.png" });
await browser.close();
