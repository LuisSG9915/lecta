// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KindleAppearancePanel } from "./KindleAppearancePanel";

const accountFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../lib/account-fetch", () => ({
  accountFetch: (...args: unknown[]) => accountFetchMock(...args),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("KindleAppearancePanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  async function renderPanel() {
    accountFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        prefs: {
          fontFamily: "source-serif",
          fontSize: "lg",
          lineHeight: "loose",
          margin: "sm",
          align: "left",
          approach: "anchors",
          layout: "scroll",
          persisted: true,
        },
      }),
    });
    await act(async () => {
      root.render(h(KindleAppearancePanel));
      await Promise.resolve();
    });
  }

  it("carga las preferencias de la cuenta y pinta los 7 selectores", async () => {
    await renderPanel();
    const selects = host.querySelectorAll("select");
    expect(selects).toHaveLength(7);
    const labels = [...selects].map((s) => s.getAttribute("aria-label"));
    expect(labels).toContain("Tipografía");
    expect(labels).toContain("Tamaño de letra");
    expect(labels).toContain("Enfoque de lectura");
    // Valores de la cuenta reflejados
    const byLabel = (name: string) =>
      [...selects].find((s) => s.getAttribute("aria-label") === name);
    expect((byLabel("Tipografía") as HTMLSelectElement).value).toBe("source-serif");
    expect((byLabel("Enfoque de lectura") as HTMLSelectElement).value).toBe("anchors");
    expect(host.textContent).toContain("Anclas de lectura");
  });

  it("la vista previa embebida apunta a /k/preview/page con los ajustes", async () => {
    await renderPanel();
    const iframe = host.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const src = iframe!.getAttribute("src")!;
    expect(src).toContain("/k/preview/page?");
    expect(src).toContain("font=source-serif");
    expect(src).toContain("size=lg");
    expect(src).toContain("mode=anchors");
    expect(src).toContain("layout=scroll");
  });

  it("Guardar en mi Kindle hace PUT /api/kindle/prefs con los ajustes", async () => {
    await renderPanel();
    accountFetchMock.mockClear();
    accountFetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Guardar en mi Kindle"),
    )!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expect(accountFetchMock).toHaveBeenCalledWith(
      "/api/kindle/prefs",
      expect.objectContaining({ method: "PUT" }),
    );
    const body = JSON.parse(accountFetchMock.mock.calls[0][1].body as string);
    expect(body.prefs.approach).toBe("anchors");
    expect(body.prefs.fontFamily).toBe("source-serif");
    expect(host.textContent).toContain("Ajustes guardados");
  });

  it("muestra el error cuando el guardado falla", async () => {
    await renderPanel();
    accountFetchMock.mockClear();
    accountFetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "El servicio de ajustes no está disponible todavía." }),
    });

    const button = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Guardar en mi Kindle"),
    )!;
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(host.textContent).toContain("El servicio de ajustes no está disponible todavía.");
  });
});
