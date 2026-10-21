// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LegalNotice from "./LegalNotice";

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
    expect(host.textContent).toContain("[PENDIENTE DE REVISIÓN POR TITULAR: Nombre/Razón Social, Domicilio y Correo Legal]");
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
    expect(host.textContent).toContain("lecta-lexicon-data");
    expect(host.textContent).toContain("forma → lema");
  });

  it("permite abrir directamente en la pestaña de términos", () => {
    act(() => {
      root.render(h(LegalNotice, { initialTab: "terms", onClose: vi.fn() }));
    });

    expect(host.textContent).toContain("Términos de Uso");
    expect(host.textContent).toContain("Propiedad de tus lecturas");
  });
});
