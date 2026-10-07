// Genera cat-preview.html y cat-preview-papel.html en el directorio
// temporal del sistema: renderiza el gato a SVG estático con
// react-dom/server y vuelca todas las etapas/poses/humores con los
// estilos reales de tokens.css y game.css embebidos — sirve para
// revisar el arte sin levantar la app. No es una prueba del
// producto; es la herramienta de iteración visual de la fase 1b.
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { Companion, type CompanionPose, type CompanionProps } from "./Companion";

const css =
  readFileSync(resolve(__dirname, "../styles/tokens.css"), "utf8") +
  readFileSync(resolve(__dirname, "../styles/game.css"), "utf8");

const cell = (props: CompanionProps, label: string) =>
  `<div class="cell">${renderToStaticMarkup(h(Companion, props))}<span>${label}</span></div>`;

const row = (title: string, cells: string[]) =>
  `<h3>${title}</h3><div class="row">${cells.join("")}</div>`;

const stages = [0, 1, 2, 3, 4];
const poses: CompanionPose[] = ["idle", "greet", "pet", "eat", "play", "celebrate", "evolve"];
const moods = ["awake", "sleepy", "asleep"] as const;
const focus = ["reading", "deep_focus", "curious", "yawn", "sleep", "celebrating"] as const;
const coats = [
  "pelaje-atigrado",
  "pelaje-calico",
  "pelaje-gris",
  "pelaje-siames",
  "pelaje-negro",
  "pelaje-tuxedo",
  "pelaje-dorado",
];

const page = (theme: string, inner: string) => `<!doctype html><html${theme ? ` data-theme="${theme}"` : ""}><head><meta charset="utf-8"><style>
${css}
body{margin:0;background:var(--paper);font-family:sans-serif}
.row{display:flex;gap:10px;align-items:end;padding:10px 14px;flex-wrap:wrap}
.cell{text-align:center;font-size:11px;color:var(--ink)}
.cell svg{width:110px;height:110px;background:var(--paper);border-radius:8px;border:1px solid #0002}
h3{margin:10px 14px 0;color:var(--ink);font-size:13px}
</style></head><body>${inner}</body></html>`;

const full = [
  row("etapas", stages.map((s) => cell({ stage: s, mood: "awake", accessories: [] }, `s${s}`))),
  row("ropa completa", stages.map((s) => cell({ stage: s, mood: "awake", accessories: ["chaleco", "bufanda", "moño", "anteojos"] }, `s${s}+ropa`))),
  row("poses (s2)", poses.map((p) => cell({ stage: 2, mood: "awake", accessories: [], pose: p }, p))),
  row("humores (s3 collar)", moods.map((m) => cell({ stage: 3, mood: m, accessories: ["collar"] }, m))),
  row("foco lector (s1)", focus.map((f) => cell({ stage: 1, mood: "awake", accessories: [], focus: f }, f))),
  row("pelajes (s2)", coats.map((c) => cell({ stage: 2, mood: "awake", accessories: [c] }, c.replace("pelaje-", "")))),
  row("pelajes por etapa", stages.flatMap((s) => [cell({ stage: s, mood: "awake", accessories: ["pelaje-atigrado"] }, `s${s} atigrado`), cell({ stage: s, mood: "awake", accessories: ["pelaje-tuxedo"] }, `s${s} tuxedo`)])),
].join("");

const papel = [
  row("papel — etapas", stages.map((s) => cell({ stage: s, mood: "awake", accessories: [] }, `s${s}`))),
  row("papel — poses (s2)", poses.map((p) => cell({ stage: 2, mood: "awake", accessories: [], pose: p }, p))),
  row("papel — ropa", [cell({ stage: 4, mood: "awake", accessories: ["chaleco", "collar"] }, "s4+chaleco"), cell({ stage: 4, mood: "awake", accessories: ["bufanda", "anteojos"] }, "s4+bufanda"), cell({ stage: 0, mood: "awake", accessories: ["moño"] }, "s0+moño"), cell({ stage: 3, mood: "asleep", accessories: [] }, "s3 dormido")]),
  row("papel — pelajes (s2)", coats.map((c) => cell({ stage: 2, mood: "awake", accessories: [c] }, c.replace("pelaje-", "")))),
].join("");

const html = page("", full);
const htmlPapel = page("papel", papel);

describe("preview", () => {
  it("escribe el html", () => {
    writeFileSync(resolve(tmpdir(), "cat-preview.html"), html);
    writeFileSync(resolve(tmpdir(), "cat-preview-papel.html"), htmlPapel);
  });
});
