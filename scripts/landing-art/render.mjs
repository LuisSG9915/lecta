// Genera las imágenes de la landing con el gato real de la app.
//
//   node scripts/landing-art/render.mjs            → todas las escenas
//   node scripts/landing-art/render.mjs hero-noche og   → solo esas
//   node scripts/landing-art/render.mjs _hoja-contacto  → referencia del gato
//
// Empaqueta `studio.tsx` (componente Companion + CSS de la app) con
// esbuild, abre la página en Chromium y fotografía cada escena de
// `scenes.mjs` a 2×. Salida: `marketing/landing/<nombre>.png`.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";
import { SCENES } from "./scenes.mjs";

// esbuild no es dependencia directa: llega con vite (pnpm no lo iza).
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const buildDir = path.join(root, "artifacts/landing-art");
const outDir = path.join(root, "marketing/landing");

await mkdir(buildDir, { recursive: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(here, "studio.tsx")],
  bundle: true,
  outdir: buildDir,
  jsx: "automatic",
  loader: { ".woff2": "file" },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

const pagePath = path.join(buildDir, "studio.html");
await writeFile(
  pagePath,
  `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link rel="stylesheet" href="studio.css">
<style>html,body{margin:0;padding:0;background:#000}#stage{position:relative;overflow:hidden}
.cat{filter:none}</style>
</head><body><div id="stage"></div><script src="studio.js"></script></body></html>`,
);

const wanted = process.argv.slice(2);
// Las escenas con «_» (hoja de contacto) solo salen si se piden por nombre.
const scenes = wanted.length
  ? SCENES.filter((s) => wanted.includes(s.name))
  : SCENES.filter((s) => !s.name.startsWith("_"));
if (!scenes.length) {
  console.error(`Sin escenas. Disponibles: ${SCENES.map((s) => s.name).join(", ")}`);
  process.exit(1);
}

const browser = await chromium.launch();
for (const scene of scenes) {
  const ctx = await browser.newContext({
    viewport: { width: scene.width, height: scene.height },
    deviceScaleFactor: scene.scale ?? 2,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[${scene.name}]`, String(e).slice(0, 300)));
  await page.goto(pathToFileURL(pagePath).href);
  await page.evaluate(
    async ({ html, css, theme, width, height, transparent }) => {
      document.documentElement.dataset.theme = theme;
      if (transparent) document.documentElement.style.background = document.body.style.background = "transparent";
      const style = document.createElement("style");
      style.textContent = css;
      document.head.append(style);
      const stage = document.getElementById("stage");
      stage.style.width = `${width}px`;
      stage.style.height = `${height}px`;
      stage.innerHTML = html;
      window.mountCats(stage);
      await document.fonts.ready;
    },
    {
      html: scene.html,
      css: scene.css ?? "",
      theme: scene.theme ?? "papel",
      width: scene.width,
      height: scene.height,
      transparent: Boolean(scene.transparent),
    },
  );
  await page.waitForTimeout(250);
  const file = path.join(outDir, `${scene.name}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: scene.width, height: scene.height }, omitBackground: Boolean(scene.transparent) });
  console.log(`✓ ${path.relative(root, file)}  ${scene.width * (scene.scale ?? 2)}×${scene.height * (scene.scale ?? 2)}`);
  await ctx.close();
}
await browser.close();
