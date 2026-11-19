// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LegalNotice from "./LegalNotice";
import { DICTIONARY_PACKS } from "../lib/dictionaryPack";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("LegalNotice", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  it("renderiza el aviso de privacidad por defecto", () => {
    act(() => {
      root.render(h(LegalNotice, { onClose: vi.fn() }));
    });

    expect(host.textContent).toContain("Aviso de Privacidad");
    expect(host.textContent).toContain("local primero (local-first)");
    expect(host.textContent).toContain("Consultas de Inteligencia Artificial");
    expect(host.textContent).toContain("LFPDPPP");
    expect(host.textContent).toContain("Luis Alberto Santos Gaona");
    expect(host.textContent).toContain("contacto@lectal.app");
    expect(host.textContent).not.toContain("PENDIENTE");
    expect(host.textContent).toContain("derechos ARCO");
  });

  it("permite alternar a la pestaña de términos de uso", () => {
    act(() => {
      root.render(h(LegalNotice, { onClose: vi.fn() }));
    });

    const termsTab = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Términos"),
    );
    expect(termsTab).toBeTruthy();

    act(() => {
      termsTab!.click();
    });

    expect(host.textContent).toContain("Términos de Uso");
    expect(host.textContent).toContain("Propiedad de tus lecturas");
    expect(host.textContent).toContain("ODbL 1.0");
    expect(host.textContent).toContain("forma → lema");
    expect(host.textContent).not.toContain("lecta-lexicon-data");

    // Los enlaces de descarga apuntan a assets que existen en public/.
    const publicDir = path.resolve(process.cwd(), "public");
    for (const file of [
      "lexicon/forms-es.tsv.gz",
      "lexicon/forms-en.tsv.gz",
      "lexicon/lemmas-freq-es.tsv.gz",
      "lexicon/lemmas-freq-en.tsv.gz",
      "lexicon/senses-es.csv.gz",
      "lexicon/README.md",
    ]) {
      expect(fs.existsSync(path.join(publicDir, file)), `falta public/${file}`).toBe(true);
    }
    const hrefs = [...host.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/lexicon/forms-es.tsv.gz");
    expect(hrefs).toContain("/lexicon/forms-en.tsv.gz");
    expect(hrefs).toContain("/lexicon/lemmas-freq-es.tsv.gz");
    expect(hrefs).toContain("/lexicon/lemmas-freq-en.tsv.gz");
    expect(hrefs).toContain("/lexicon/senses-es.csv.gz");
    expect(hrefs).toContain("/lexicon/README.md");
    // La atribución enlaza el paquete que la app descarga hoy, no una
    // versión anterior, y el README público documenta esa misma versión.
    const readme = fs.readFileSync(path.join(publicDir, "lexicon/README.md"), "utf8");
    for (const pack of Object.values(DICTIONARY_PACKS)) {
      expect(hrefs).toContain(pack.url);
      expect(fs.existsSync(path.join(publicDir, pack.url)), `falta public${pack.url}`).toBe(true);
      expect(readme).toContain(pack.url);
      expect(readme).toContain(pack.sha256);
    }
  });

  it("permite abrir directamente en la pestaña de términos", () => {
    act(() => {
      root.render(h(LegalNotice, { initialTab: "terms", onClose: vi.fn() }));
    });

    expect(host.textContent).toContain("Términos de Uso");
    expect(host.textContent).toContain("Propiedad de tus lecturas");
  });
});
