import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

await page.goto("http://[::1]:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(5000);

// Sembrar dos libros mínimos en IndexedDB para salir de «primera vez».
const seeded = await page.evaluate(async () => {
  const req = indexedDB.open("lecta");
  const db = await new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const names = [...db.objectStoreNames];
  if (!names.includes("books")) return { ok: false, names };
  const tx = db.transaction("books", "readwrite");
  const store = tx.objectStore("books");
  const now = Date.now();
  for (const [i, title] of ["Caperucita en Manhattan", "El principito"].entries()) {
    store.put({
      hash: `audit-book-${i}`,
      name: `${title}.epub`,
      addedAt: now - i * 1000,
      data: new Uint8Array([1, 2, 3]),
      title,
      author: "Auditoría",
      language: "es",
      sectionCount: 3,
      metaVersion: 1,
    });
  }
  await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
  db.close();
  return { ok: true, names };
});
console.log("seed:", JSON.stringify(seeded));

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

const state = await page.evaluate(() => ({
  cats: document.querySelectorAll(".cat").length,
  catClass: document.querySelector(".cat")?.getAttribute("class")?.slice(0, 140),
  companionBtns: document.querySelectorAll(".companion-btn").length,
}));
console.log("después de sembrar:", JSON.stringify(state));
await page.screenshot({ path: "artifacts/visual-audit/with-cat-papel.png" });

if (state.cats > 0) {
  const box = await page.evaluate(() => {
    const el = document.querySelector(".cat");
    const svg = el.closest("svg") ?? el;
    const r = svg.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log("catBox:", JSON.stringify(box));

  for (const [theme, scheme] of [["papel", "light"], ["noche", "dark"], ["oled", "dark"]]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `artifacts/visual-audit/cat-${theme}.png`,
      clip: { x: Math.max(0, box.x - 60), y: Math.max(0, box.y - 60), width: Math.min(1280 - Math.max(0, box.x - 60), box.w + 120), height: Math.min(800 - Math.max(0, box.y - 60), box.h + 120) },
    });
    const m = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { paper: cs.getPropertyValue("--paper").trim(), outline: cs.getPropertyValue("--cat-outline").trim(), fur: cs.getPropertyValue("--cat-fur").trim() };
    });
    console.log(`cat en ${theme}:`, JSON.stringify(m));
  }

  // Reduced-motion con gato visible.
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "oled"; document.documentElement.dataset.catMotion = "system"; });
  await page.waitForTimeout(500);
  const rm = await page.evaluate(() => {
    const cat = document.querySelector(".cat");
    const anims = cat ? getComputedStyle(cat).animationName : null;
    const bodyAnim = cat?.querySelector(".cat-body") ? getComputedStyle(cat.querySelector(".cat-body")).animationName : null;
    return { anims, bodyAnim, motion: document.documentElement.dataset.catMotion };
  });
  console.log("reduced-motion cat:", JSON.stringify(rm));
  await page.screenshot({ path: "artifacts/visual-audit/cat-oled-reduced.png" });
}

await browser.close();
