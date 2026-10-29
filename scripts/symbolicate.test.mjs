// Pruebas de scripts/symbolicate.mjs: las piezas puras (argumentos, frames,
// resolución contra un sourcemap real) sin tocar la base ni el índice del repo.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadIndex, parseArgs, resolveFrame, splitFrames } from "./symbolicate.mjs";

const dirs = [];

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), "lecta-symbols-"));
  dirs.push(dir);
  return dir;
}

// Sourcemap v3 mínimo y válido: un solo segmento en la línea 1, columna 0 del
// archivo generado, apuntando a sources[0]:1:0. El VLQ "AAAA" son cuatro
// deltas a cero (columna, índice de fuente, línea, columna).
function writeMap(dir, name, sources) {
  const map = {
    version: 3,
    file: name.replace(/\.map$/, ""),
    sources,
    names: [],
    mappings: "AAAA",
  };
  writeFileSync(join(dir, name), JSON.stringify(map));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    // Los directorios son temporales del sistema: se dejan a su suerte.
    void dir;
  }
});

describe("parseArgs", () => {
  it("separa frames de las banderas", () => {
    const options = parseArgs(["a-1.js:1:2", "--db", "b-2.js:3:4", "--json"]);
    expect(options.frames).toEqual(["a-1.js:1:2", "b-2.js:3:4"]);
    expect(options.db).toBe(true);
    expect(options.json).toBe(true);
    expect(options.days).toBe(7);
  });

  it("recorta --days al rango de la tabla (1..30) y --limit a 1000", () => {
    expect(parseArgs(["--days", "90"]).days).toBe(30);
    expect(parseArgs(["--days", "0"]).days).toBe(1);
    expect(parseArgs(["--days", "basura"]).days).toBe(7);
    expect(parseArgs(["--limit", "99999"]).limit).toBe(1000);
  });

  it("rechaza banderas desconocidas en vez de ignorarlas", () => {
    expect(() => parseArgs(["--verbose"])).toThrow(/Opción desconocida/);
  });
});

describe("splitFrames", () => {
  it("parte por la flecha con la que guarda sample_frames", () => {
    expect(splitFrames("index-A.js:1:2 -> Reader-B.js:3:4")).toEqual([
      "index-A.js:1:2",
      "Reader-B.js:3:4",
    ]);
  });

  it("tolera vacíos y null", () => {
    expect(splitFrames("")).toEqual([]);
    expect(splitFrames(null)).toEqual([]);
    expect(splitFrames("a.js:1:2 -> -> b.js:3:4")).toEqual(["a.js:1:2", "b.js:3:4"]);
  });
});

describe("loadIndex", () => {
  it("explica cómo generar el índice cuando falta", () => {
    expect(() => loadIndex(join(tempDir(), "index.json"))).toThrow(/pnpm build/);
  });

  it("lee el índice que escribe sourcemapVault", () => {
    const dir = tempDir();
    const file = join(dir, "index.json");
    writeFileSync(file, JSON.stringify({ builds: [], assets: { "a.js": { build: "b", map: "x.map" } } }));
    expect(loadIndex(file).assets["a.js"].build).toBe("b");
  });
});

describe("resolveFrame", () => {
  it("traduce un frame minificado a su archivo original", () => {
    const dir = tempDir();
    writeMap(dir, "index-ABC.js.map", ["../../src/client/lib/history.ts"]);
    const index = { assets: { "index-ABC.js": { build: "b", map: "index-ABC.js.map" } } };

    // V8 da la columna 1-based: 1 → columna 0 del mapa.
    expect(resolveFrame(index, "index-ABC.js:1:1", dir)).toEqual({
      asset: "index-ABC.js",
      original: "src/client/lib/history.ts:1:0",
    });
  });

  it("acepta el prefijo de ruta que mete sanitizeFrame", () => {
    const dir = tempDir();
    writeMap(dir, "index-ABC.js.map", ["src/client/App.tsx"]);
    const index = { assets: { "index-ABC.js": { build: "b", map: "index-ABC.js.map" } } };
    expect(resolveFrame(index, "assets/index-ABC.js:1:1", dir).original).toBe(
      "src/client/App.tsx:1:0",
    );
  });

  it("avisa cuando el build no tiene mapa (asset de otro deploy)", () => {
    const result = resolveFrame({ assets: {} }, "index-ZZZ.js:1:5");
    expect(result.original).toBeNull();
    expect(result.reason).toBe("sin mapa para ese build");
  });

  it("marca las líneas sin mapping en vez de inventar una posición", () => {
    const dir = tempDir();
    writeMap(dir, "index-ABC.js.map", ["src/client/App.tsx"]);
    const index = { assets: { "index-ABC.js": { build: "b", map: "index-ABC.js.map" } } };
    // Una columna pasada la última sí resuelve (cae en el mapping anterior,
    // que es lo correcto para un stack); una línea sin segmentos no.
    expect(resolveFrame(index, "index-ABC.js:1:5000", dir).original).toBe(
      "src/client/App.tsx:1:0",
    );
    const result = resolveFrame(index, "index-ABC.js:9:5", dir);
    expect(result.original).toBeNull();
    expect(result.reason).toBe("columna sin mapping");
  });

  it("deja pasar los frames que ya son código fuente", () => {
    const result = resolveFrame({ assets: {} }, "src/client/components/Reader.tsx:12:5");
    expect(result.original).toBe("src/client/components/Reader.tsx:12:5");
    expect(result.reason).toBe("ya es fuente");
  });

  it("no revienta con basura ni con un mapa corrupto", () => {
    expect(resolveFrame({ assets: {} }, "no-es-un-frame").reason).toBe("frame ilegible");

    const dir = tempDir();
    writeFileSync(join(dir, "roto.js.map"), "{no es json");
    const index = { assets: { "roto.js": { build: "b", map: "roto.js.map" } } };
    const result = resolveFrame(index, "roto.js:1:1", dir);
    expect(result.original).toBeNull();
    expect(result.reason).toMatch(/mapa inválido/);
  });
});
